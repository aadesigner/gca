/**
 * Broader Sauto year heal: re-fetch listings and correct year when manufacturing_date
 * disagrees with a suspicious vehicle.year (future, or >> manufacturing).
 *
 *   node scripts/src/_ops-heal-sauto-years.mjs
 */
import pg from "pg";
import { spawnSync } from "node:child_process";

function fetchPgVars() {
  const r = spawnSync(
    "npx",
    ["--yes", "@railway/cli", "variables", "--service", "Postgres", "--json"],
    { encoding: "utf8", cwd: process.cwd(), shell: true },
  );
  const raw = (r.stdout || "") + (r.stderr || "");
  return JSON.parse(raw.slice(raw.indexOf("{")));
}

function urlFromVars(parsed) {
  const vars = parsed.variables || parsed;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || get("POSTGRES_DB") || "railway"}`;
}

function parseYear(raw) {
  if (!raw) return undefined;
  const m = String(raw).match(/(19|20)\d{2}/);
  if (!m) return undefined;
  const year = Number(m[0]);
  return year >= 1980 && year <= 2035 ? year : undefined;
}

function resolveYear(item) {
  const manufacturing = parseYear(item.manufacturing_date);
  const inOp = parseYear(item.in_operation_date);
  const stk = parseYear(item.stk_date);
  const maxY = new Date().getUTCFullYear() + 1;
  const inOpLooksLikeStk =
    inOp != null &&
    ((stk != null && inOp === stk) ||
      inOp > maxY ||
      (manufacturing != null && inOp > manufacturing + 3));
  return (
    manufacturing ??
    (inOp != null && !inOpLooksLikeStk && inOp <= maxY ? inOp : undefined)
  );
}

function bodyName(item) {
  return item.vehicle_body_cb?.name || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const c = new pg.Client({
  connectionString: urlFromVars(fetchPgVars()),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});
await c.connect();

const maxY = new Date().getUTCFullYear() + 1;

// Suspicious: future-ish years, or any sauto row we'll spot-check when year >= 2020
// Full pass on year > manufacturing+2 candidates: fetch all sauto with year >= 2024 first,
// then also any with year > maxY (already handled) and year where body looks like condition.
const { rows } = await c.query(
  `SELECT DISTINCT ON (v.id)
          v.id AS vehicle_id, v.vin, v.year AS old_year, v.body_type,
          l.source_id
   FROM listings l
   JOIN providers p ON p.id = l.provider_id
   JOIN vehicles v ON v.vin = l.vin
   WHERE p.internal_name = 'sauto'
     AND v.year IS NOT NULL
     AND (
       v.year > $1
       OR v.year >= 2024
       OR v.body_type ~* '^(ojet|nov|osob)'
     )
   ORDER BY v.id, l.last_seen_at DESC NULLS LAST`,
  [maxY],
);

console.log("candidates:", rows.length);

let fixed = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  try {
    const res = await fetch(`https://www.sauto.cz/api/v1/items/${encodeURIComponent(row.source_id)}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "cs-CZ,cs;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      failed++;
      continue;
    }
    const json = await res.json();
    const item = json.result || json;
    const year = resolveYear(item);
    const body = bodyName(item);
    const junkBody = row.body_type && /^(ojet[ée]|nov[ée]|osobn[ií])/i.test(String(row.body_type));

    const yearNeedsFix = year != null && year !== row.old_year && (
      row.old_year > maxY ||
      (year < row.old_year && row.old_year - year >= 2) ||
      (row.old_year > maxY)
    );

    if (!yearNeedsFix && !junkBody) {
      skipped++;
      continue;
    }

    if (yearNeedsFix) {
      await c.query(
        `UPDATE vehicles
         SET year = $1,
             body_type = CASE WHEN $3::boolean THEN COALESCE($4, body_type) ELSE body_type END,
             updated_at = now()
         WHERE id = $2`,
        [year, row.vehicle_id, junkBody, body],
      );
      console.log("fixed year", row.vin, row.old_year, "→", year, junkBody && body ? `body→${body}` : "");
      fixed++;
    } else if (junkBody && body) {
      await c.query(
        `UPDATE vehicles SET body_type = $1, updated_at = now() WHERE id = $2`,
        [body, row.vehicle_id],
      );
      console.log("fixed body", row.vin, row.body_type, "→", body);
      fixed++;
    } else {
      skipped++;
    }
  } catch (e) {
    console.log("error", row.vin, e.message);
    failed++;
  }
  if (i % 25 === 24) await sleep(200);
}

console.log({ fixed, skipped, failed, total: rows.length });

const verify = await c.query(
  `SELECT year, make, model, body_type, current_known_mileage FROM vehicles WHERE vin='WAUZZZ8E68A137335'`,
);
console.log("WAUZZZ8E68A137335:", verify.rows[0]);
await c.end();
