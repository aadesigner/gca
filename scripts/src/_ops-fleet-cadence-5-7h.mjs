/**
 * Patch production (or local) fleet job repeatHours into the 5–7h band.
 * Usage:
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-fleet-cadence-5-7h.mjs --local
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-fleet-cadence-5-7h.mjs --prod
 */
import pg from "pg";

const useProd = process.argv.includes("--prod");
const client = useProd
  ? new pg.Client({
      host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT || "15622"),
      user: process.env.PROD_PG_USER || "postgres",
      password: process.env.PROD_PG_PASSWORD || process.env.PGPASSWORD,
      database: process.env.PROD_PG_DATABASE || "railway",
      ssl: false,
      connectionTimeoutMillis: 20_000,
    })
  : new pg.Client({ connectionString: process.env.DATABASE_URL });

const VARIANTS = [5, 6, 7];
function hash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}
function wantRepeat(internalName) {
  const overrides = { encar: 6, import_motor: 6, copart: 5, iaa: 5 };
  if (overrides[internalName] != null) return overrides[internalName];
  return VARIANTS[hash(internalName) % VARIANTS.length];
}

await client.connect();
console.log(`Target: ${useProd ? "PROD" : "LOCAL"}`);

const parallel = await client.query(`
  UPDATE settings SET max_collection_jobs_parallel = LEAST(max_collection_jobs_parallel, 6)
  WHERE id = 1
  RETURNING max_collection_jobs_parallel
`);
console.log("parallel cap:", parallel.rows[0]?.max_collection_jobs_parallel);

const { rows } = await client.query(`
  SELECT j.id, j.status, j.job_type, j.job_config, p.internal_name
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('pending','running','paused','completed','failed')
    AND p.internal_name NOT IN ('getcarapi','kmcheck','kmcheck_manual','carstat','import_motor')
`);

let patched = 0;
for (const row of rows) {
  let cfg = {};
  try {
    cfg = row.job_config ? JSON.parse(row.job_config) : {};
  } catch {
    cfg = {};
  }
  const want = wantRepeat(row.internal_name);
  const have = Number(cfg.repeatHours ?? 0);
  if (have === want) continue;
  cfg.repeatHours = want;
  // Keep concurrency Railway-safe
  if (Number(cfg.concurrency ?? 0) > 8) cfg.concurrency = 8;
  await client.query(`UPDATE collection_jobs SET job_config = $1, updated_at = now() WHERE id = $2`, [
    JSON.stringify(cfg),
    row.id,
  ]);
  patched += 1;
}
console.log(`Patched repeatHours on ${patched}/${rows.length} jobs`);

// Encar pinned
for (const id of [361, 362]) {
  const { rows: jr } = await client.query(`SELECT job_config FROM collection_jobs WHERE id=$1`, [id]);
  if (!jr[0]) continue;
  let cfg = {};
  try {
    cfg = JSON.parse(jr[0].job_config || "{}");
  } catch {
    cfg = {};
  }
  cfg.repeatHours = 6;
  if (Number(cfg.concurrency ?? 0) > 6) cfg.concurrency = 6;
  await client.query(`UPDATE collection_jobs SET job_config=$1, updated_at=now() WHERE id=$2`, [
    JSON.stringify(cfg),
    id,
  ]);
  console.log(`pinned job ${id} → repeatHours=6`);
}

await client.end();
