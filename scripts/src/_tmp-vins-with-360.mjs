import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});
await c.connect();

const rows = await c.query(`
  SELECT v.vin, v.make, v.model, v.year,
         count(*) FILTER (WHERE p.photo_group = 'exterior_3d')::int AS exterior_frames,
         count(*) FILTER (WHERE p.photo_group = 'interior_3d')::int AS interior_frames,
         count(*) FILTER (WHERE p.photo_group = 'gallery')::int AS gallery,
         array_agg(DISTINCT pr.internal_name) FILTER (WHERE pr.internal_name IS NOT NULL) AS providers,
         max(p.created_at) AS last_photo_at,
         min(left(COALESCE(p.source_url, p.stored_path, ''), 90))
           FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d')) AS sample_url
  FROM photos p
  JOIN vehicles v ON v.id = p.vehicle_id
  LEFT JOIN listings l ON l.id = p.listing_id
  LEFT JOIN providers pr ON pr.id = l.provider_id
  WHERE p.photo_group IN ('exterior_3d', 'interior_3d')
    AND v.vin IS NOT NULL
    AND length(v.vin) >= 11
  GROUP BY v.id, v.vin, v.make, v.model, v.year
  HAVING count(*) FILTER (WHERE p.photo_group = 'exterior_3d') >= 8
  ORDER BY (count(*) FILTER (WHERE p.photo_group = 'exterior_3d')) DESC,
           (count(*) FILTER (WHERE p.photo_group = 'interior_3d')) DESC,
           max(p.created_at) DESC NULLS LAST
  LIMIT 15
`);
console.log(JSON.stringify(rows.rows, null, 2));

// Prefer known good IAA example if present
const known = await c.query(`
  SELECT v.vin, v.make, v.model, v.year,
         count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
         count(*) FILTER (WHERE p.photo_group='interior_3d')::int int
  FROM vehicles v
  JOIN photos p ON p.vehicle_id = v.id
  WHERE v.vin = ANY($1::text[])
    AND p.photo_group IN ('exterior_3d','interior_3d')
  GROUP BY 1,2,3,4
`, [["JTHD51FF7L5012169", "1FMCU0MN8PUA00785"]]);
console.log("known", known.rows);

await c.end();
