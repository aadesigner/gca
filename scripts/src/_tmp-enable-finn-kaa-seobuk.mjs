/**
 * Enable Finn / KAA / Seobuk for production full crawl + queue jobs.
 * Carpool stays disabled (site redesigned).
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_tmp-enable-finn-kaa-seobuk.mjs
 *   (or via TEMP/gca-pg-vars-prod.json like other _ops scripts)
 */
import fs from "node:fs";
import pg from "pg";

const ENABLE = ["finn", "koreaauto_auction", "seobuk"];
const KEEP_DISABLED = ["carpoolkr"];

function loadProdClient() {
  const path = `${process.env.TEMP}/gca-pg-vars-prod.json`;
  if (fs.existsSync(path)) {
    const raw = fs.readFileSync(path, "utf8");
    const j = JSON.parse(raw.slice(raw.indexOf("{")));
    const vars = j.variables || j;
    const get = (n) => {
      const v = vars[n];
      return v && typeof v === "object" && "value" in v ? v.value : v;
    };
    return new pg.Client({
      host: get("RAILWAY_TCP_PROXY_DOMAIN"),
      port: Number(get("RAILWAY_TCP_PROXY_PORT")),
      user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
      password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
      database: get("PGDATABASE") || get("POSTGRES_DB") || "railway",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 25000,
    });
  }
  const url = process.env.DATABASE_URL || process.env.PROD_DATABASE_URL;
  if (!url) throw new Error("No prod DB credentials (TEMP/gca-pg-vars-prod.json or DATABASE_URL)");
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
}

const c = loadProdClient();
await c.connect();

const enabled = await c.query(
  `
  UPDATE providers
  SET enabled = true, updated_at = NOW()
  WHERE internal_name = ANY($1::text[])
  RETURNING internal_name, id, enabled
  `,
  [ENABLE],
);

const disabled = await c.query(
  `
  UPDATE providers
  SET enabled = false, updated_at = NOW()
  WHERE internal_name = ANY($1::text[])
  RETURNING internal_name, enabled
  `,
  [KEEP_DISABLED],
);

const queued = [];
for (const row of enabled.rows) {
  await c.query(
    `
    UPDATE collection_jobs
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'superseded — enable full crawl'),
        updated_at = NOW()
    WHERE provider_id = $1
      AND status IN ('running', 'pending', 'paused')
    `,
    [row.id],
  );

  const cfg = JSON.stringify({
    nextRunAt: new Date().toISOString(),
    repeatHours: row.internal_name === "koreaauto_auction" ? 6 : 5,
    source: "ops-enable-finn-kaa-seobuk",
  });

  const ins = await c.query(
    `
    INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
    VALUES ($1, 'full_collection', 'pending', $2, NOW() - interval '1 day', NOW())
    RETURNING id
    `,
    [row.id, cfg],
  );
  queued.push({ name: row.internal_name, jobId: ins.rows[0].id });
}

const proxyHint = await c.query(`
  SELECT internal_name, enabled,
    (SELECT count(*)::int FROM listings l WHERE l.provider_id = p.id) AS listings
  FROM providers p
  WHERE internal_name = ANY($1::text[])
  ORDER BY 1
`, [[...ENABLE, ...KEEP_DISABLED]]);

console.log(JSON.stringify({ enabled: enabled.rows, disabled: disabled.rows, queued, status: proxyHint.rows }, null, 2));
await c.end();
