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
const r = await c.query(`
  SELECT v.vin, l.source_id, p.photo_group, left(p.source_url, 120) u,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) stock
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND l.source_id ~ '^im-\\d{6,}$'
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) IS NOT NULL
    AND COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ) <> (regexp_match(l.source_id, '^im-(\\d{6,})$', 'i'))[1]
  LIMIT 10
`);
console.log("leftover", r.rows);
await c.end();
