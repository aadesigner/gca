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

// Any listing created during purge window with 0 photos?
const r = await c.query(`
  SELECT pr.internal_name, count(*)::int AS n
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  WHERE l.created_at BETWEEN '2026-09-15 18:00:00+00' AND '2026-09-15 19:00:00+00'
    AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.listing_id = l.id)
  GROUP BY 1
  ORDER BY 2 DESC
`);
console.log("zeroPhotoListingsDuringPurgeHour", r.rows);

const total = await c.query(`
  SELECT count(*)::int AS n
  FROM listings l
  WHERE l.created_at BETWEEN '2026-09-15 18:00:00+00' AND '2026-09-15 19:00:00+00'
`);
console.log("totalListingsThatHour", total.rows[0]);

await c.end();
