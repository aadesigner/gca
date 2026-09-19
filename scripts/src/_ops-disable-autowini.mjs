/**
 * Disable Autowini from fleet + live + API (keep historical rows).
 * Cancels active Autowini collection jobs.
 *
 * Usage:
 *   node scripts/src/_ops-disable-autowini.mjs          # prod (Railway Postgres)
 *   DATABASE_URL=... node scripts/src/_ops-disable-autowini.mjs
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
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("no postgres vars json");
  return JSON.parse(raw.slice(start));
}

function urlFromVars(parsed) {
  const vars = parsed.variables || parsed;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  const user = get("PGUSER") || get("POSTGRES_USER");
  const pass = get("PGPASSWORD") || get("POSTGRES_PASSWORD");
  const db = get("PGDATABASE") || get("POSTGRES_DB") || "railway";
  const host = get("RAILWAY_TCP_PROXY_DOMAIN");
  const port = get("RAILWAY_TCP_PROXY_PORT");
  if (!user || !pass || !host || !port) throw new Error("missing proxy fields");
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
}

const url = process.env.DATABASE_URL || urlFromVars(fetchPgVars());
const c = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_URL ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});
await c.connect();

try {
  await c.query("BEGIN");

  const prov = await c.query(
    `UPDATE providers
     SET enabled = false, updated_at = now()
     WHERE internal_name = 'autowini'
     RETURNING id, internal_name, enabled`,
  );
  console.log("providers:", prov.rows);

  const live = await c.query(
    `UPDATE live_providers
     SET is_enabled = false, updated_at = now()
     WHERE internal_name IN ('autowini', 'autowini_live')
        OR internal_name ILIKE '%autowini%'
     RETURNING id, internal_name, is_enabled`,
  );
  console.log("live_providers:", live.rows);

  const jobs = await c.query(
    `UPDATE collection_jobs cj
     SET status = 'cancelled',
         error_message = COALESCE(error_message, '') || ' [cancelled: autowini disabled]',
         updated_at = now(),
         completed_at = COALESCE(completed_at, now())
     FROM providers p
     WHERE cj.provider_id = p.id
       AND p.internal_name = 'autowini'
       AND cj.status IN ('pending', 'queued', 'running', 'paused')
     RETURNING cj.id, cj.status, cj.job_type`,
  );
  console.log("cancelled_jobs:", jobs.rows.length, jobs.rows.slice(0, 20));

  await c.query("COMMIT");
  console.log("ok: autowini disabled");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
