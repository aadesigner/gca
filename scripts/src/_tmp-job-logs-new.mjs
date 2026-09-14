import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

for (const jobId of [486, 487, 488]) {
  const logs = await c.query(
    `
    SELECT level, stage, left(message, 240) msg, left(COALESCE(details::text,''), 180) details, occurred_at
    FROM job_logs
    WHERE job_id = $1
    ORDER BY occurred_at DESC
    LIMIT 15
    `,
    [jobId],
  );
  console.log("\nJOB", jobId, "logs", logs.rows.length);
  for (const row of logs.rows) console.log(row);
}

const jobs = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.items_discovered, j.items_processed, j.items_failed,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.id = ANY($1::int[])
`, [[486,487,488]]);
console.log("\nNOW", jobs.rows);

await c.end();
