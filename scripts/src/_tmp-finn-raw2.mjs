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

for (const sid of ["476506249", "476506345", "476506378"]) {
  const r = await c.query(
    `SELECT id, listing_id, source_id, collected_at, parser_version,
            length(raw_json::text) AS raw_len,
            left(raw_json::text, 200) AS raw_head
     FROM raw_source_records WHERE source_id = $1 ORDER BY id DESC LIMIT 2`,
    [sid],
  );
  console.log(sid, r.rows);
}

// Finn zero-photo created today
const today = await c.query(`
  SELECT l.id, l.vin, l.source_id, l.created_at,
    (SELECT count(*)::int FROM photos p WHERE p.listing_id = l.id) AS photos
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id AND pr.internal_name = 'finn'
  WHERE l.created_at > now() - interval '24 hours'
  ORDER BY l.id DESC
  LIMIT 30
`);
console.log("finnLast24h", today.rows);

const zeroToday = await c.query(`
  SELECT count(*)::int AS n
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id AND pr.internal_name = 'finn'
  WHERE l.created_at > now() - interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.listing_id = l.id)
`);
console.log("finnZeroPhotosLast24h", zeroToday.rows[0]);

await c.end();
