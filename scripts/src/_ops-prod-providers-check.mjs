import fs from "node:fs";
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

const NEWISH = [
  "japanesecartrade",
  "thebidrive",
  "bidexport",
  "ontariocars",
  "autoplac",
  "aaaauto",
  "sauto",
  "otomoto",
  "willhaben",
  "autoscout24",
  "che168",
  "autohome",
];

const url = urlFromVars(fetchPgVars());
const c = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});
await c.connect();

const providers = await c.query(
  `SELECT internal_name, enabled, id FROM providers WHERE internal_name = ANY($1::text[]) ORDER BY 1`,
  [NEWISH],
);

const jobs = await c.query(
  `SELECT cj.id, p.internal_name, cj.job_type, cj.status,
          cj.pages_processed, cj.listings_fetched, cj.vins_new, cj.items_processed,
          cj.updated_at,
          ROUND(EXTRACT(EPOCH FROM (now() - cj.updated_at))/3600.0, 2) AS hours_stale,
          left(cj.error_message, 100) AS err
   FROM collection_jobs cj
   JOIN providers p ON p.id = cj.provider_id
   WHERE p.internal_name = ANY($1::text[])
   ORDER BY p.internal_name, cj.id DESC`,
  [NEWISH],
);

const running = await c.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status, cj.updated_at,
         ROUND(EXTRACT(EPOCH FROM (now() - cj.updated_at))/3600.0, 2) AS hours_stale,
         cj.vins_new, cj.items_processed, cj.pages_processed
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status = 'running'
  ORDER BY cj.updated_at ASC
`);

const today = await c.query(`
  SELECT p.internal_name, count(*)::int AS listings_today
  FROM listings l JOIN providers p ON p.id = l.provider_id
  WHERE l.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
  GROUP BY 1 ORDER BY listings_today DESC LIMIT 15
`);

const jct = await c.query(`
  SELECT count(*)::int AS listings FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'japanesecartrade'
`);

console.log(
  JSON.stringify(
    {
      providers: providers.rows,
      newProviderJobs: jobs.rows,
      runningNow: running.rows,
      listingsTodayTop: today.rows,
      jctListingsTotal: jct.rows[0],
    },
    null,
    2,
  ),
);
await c.end();
