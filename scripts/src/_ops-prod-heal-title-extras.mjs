/**
 * Heal missing trim / junk engine / dubicars make-model from listing titles.
 * Literal tokens only — never invent CC from badges. No photo changes.
 * Batched UPDATEs for prod TCP proxy.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-heal-title-extras.mjs
 *   DRY_RUN=1 ...
 */
import fs from "node:fs";
import pg from "pg";

const MULTI_WORD_MAKES = [
  "Mercedes-Benz",
  "Mercedes Benz",
  "Land Rover",
  "Alfa Romeo",
  "Aston Martin",
  "Rolls-Royce",
  "Range Rover",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanEngineDisplacement(raw) {
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text || text === "-") return null;
  if (/^0+(\.0+)?(?:\s*(?:cc|cm3|l))?$/i.test(text)) return null;
  if (/^0+(\.0+)?$/.test(text.replace(/[^\d.]/g, ""))) return null;
  return text;
}

function titleRemainderTrim(title, parts) {
  let rest = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!rest) return undefined;
  if (parts.year && parts.year >= 1980 && parts.year <= 2035) {
    rest = rest.replace(new RegExp(`^${parts.year}\\s+`), "").trim();
  } else {
    rest = rest.replace(/^(?:19|20)\d{2}\s+/, "").trim();
  }
  if (parts.make) rest = rest.replace(new RegExp(`^${escapeRegExp(parts.make)}\\s+`, "i"), "").trim();
  if (parts.model) rest = rest.replace(new RegExp(`^${escapeRegExp(parts.model)}\\s+`, "i"), "").trim();
  if (!rest || /^[-–—.?]+$/.test(rest)) return undefined;
  return rest;
}

function parseDubicarsTitle(title) {
  let rest = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!rest) return {};
  let year;
  const leadingYear = rest.match(/^((?:19|20)\d{2})\s+/);
  if (leadingYear) {
    year = Number(leadingYear[1]);
    rest = rest.slice(leadingYear[0].length).trim();
  }
  const multi = MULTI_WORD_MAKES.find(
    (name) => rest.toLowerCase() === name.toLowerCase() || rest.toLowerCase().startsWith(`${name.toLowerCase()} `),
  );
  let make;
  if (multi) {
    make = multi === "Mercedes Benz" ? "Mercedes-Benz" : multi;
    rest = rest.slice(multi.length).trim();
  } else {
    const single = rest.match(/^([A-Za-z][A-Za-z0-9-]*)\b/);
    if (single?.[1]) {
      make = single[1];
      rest = rest.slice(single[0].length).trim();
    }
  }
  const modelTok = rest.match(/^([A-Za-z0-9][A-Za-z0-9-]*)\b/);
  const model = modelTok?.[1];
  if (model) rest = rest.slice(modelTok[0].length).trim();
  return { make, model, trim: rest || undefined, year };
}

function splitShortModelTrim(raw) {
  const m = String(raw ?? "")
    .trim()
    .match(/^([A-Za-z]{1,5}\d{0,2})\s+((?:\d|\d\.\d|[A-Za-z]*\d).+)$/);
  if (!m?.[1] || !m[2]) return undefined;
  const badge = m[1];
  const model = /^[a-z]+\d*$/i.test(badge) && badge.length <= 5 ? badge.toUpperCase() : badge;
  return { model, trim: m[2].trim() };
}

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

async function flushBatch(client, batch) {
  if (!batch.length) return;
  const ids = batch.map((b) => b.id);
  const makes = batch.map((b) => b.make);
  const models = batch.map((b) => b.model);
  const trims = batch.map((b) => b.trim);
  const engines = batch.map((b) => b.engine);
  await client.query(
    `
    UPDATE vehicles AS v SET
      make = u.make,
      model = u.model,
      trim = u.trim,
      engine_displacement = u.engine,
      updated_at = now()
    FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[]) AS u(id, make, model, trim, engine)
    WHERE v.id = u.id
    `,
    [ids, makes, models, trims, engines],
  );
}

const dry = process.env.DRY_RUN === "1";
const providers = (process.env.PROVIDERS || "dubicars,auctionauto,koreaauto_auction")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();

let scanned = 0;
let updated = 0;
const samples = [];
const batch = [];

for (const pname of providers) {
  const rows = await c.query(
    `
    SELECT v.id AS vehicle_id, v.vin, v.make, v.model, v.trim, v.year, v.engine_displacement,
      l.title, p.internal_name AS provider
    FROM listings l
    JOIN vehicles v ON v.id = l.vehicle_id
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name = $1
      AND l.title IS NOT NULL
      AND (
        v.trim IS NULL OR btrim(v.trim) = '' OR v.trim = '-'
        OR v.engine_displacement ~* '^0+(\\.0+)?(\\s*(cc|cm3|l))?$'
        OR (p.internal_name = 'dubicars' AND (
          v.make IS NULL
          OR v.make ~* '^(x[0-9]|gle|glc|gla|glb|q[0-9]|a[0-9]|c[0-9]|e[- ]?class|s[- ]?class|nx|rx|gx|lx|rav4|camry|civic|accord|stinger|silverado|wrangler|optima|sorento|sportage|benz)$'
        ))
        OR (p.internal_name = 'koreaauto_auction' AND v.trim IS NULL AND v.model ~ '\\s')
      )
    ORDER BY l.id DESC
    LIMIT $2
    `,
    [pname, Number(process.env.LIMIT || 20000)],
  );

  let providerUpdated = 0;
  for (const row of rows.rows) {
    scanned++;
    let make = row.make;
    let model = row.model;
    let trim = row.trim?.trim() || null;
    if (trim === "-") trim = null;
    let engine = cleanEngineDisplacement(row.engine_displacement);

    if (row.provider === "dubicars" && row.title) {
      const parsed = parseDubicarsTitle(row.title);
      if (parsed.make && parsed.model) {
        if (!make || make.toLowerCase() !== parsed.make.toLowerCase()) {
          make = parsed.make;
          model = parsed.model;
          // Identity rewrite — drop stale trim from the previous wrong make.
          trim = parsed.trim || null;
        } else if (!trim) {
          trim = parsed.trim || null;
        }
      }
    }

    if (row.provider === "koreaauto_auction" && !trim && model) {
      const split = splitShortModelTrim(model);
      if (split) {
        model = split.model;
        trim = split.trim;
      }
    }

    if (!trim) {
      const rem = titleRemainderTrim(row.title, { year: row.year, make, model });
      if (rem) trim = rem;
    }

    const changed =
      make !== row.make ||
      model !== row.model ||
      (trim || null) !== (row.trim || null) ||
      (engine || null) !== (row.engine_displacement || null);

    if (!changed) continue;

    if (samples.length < 15) {
      samples.push({
        provider: row.provider,
        vin: row.vin,
        before: { make: row.make, model: row.model, trim: row.trim, engine: row.engine_displacement },
        after: { make, model, trim, engine },
        title: String(row.title).slice(0, 80),
      });
    }

    batch.push({ id: row.vehicle_id, make, model, trim, engine });
    updated++;
    providerUpdated++;

    if (!dry && batch.length >= 200) {
      await flushBatch(c, batch);
      batch.length = 0;
      process.stdout.write(`\r${pname} flushed ${providerUpdated}/${rows.rows.length}`);
    }
  }

  if (!dry && batch.length) {
    await flushBatch(c, batch);
    batch.length = 0;
  }
  console.log(`\n${pname} candidates ${rows.rows.length} updated ${providerUpdated}`);
}

console.log(JSON.stringify({ dry, scanned, updated, samples }, null, 2));
await c.end();
