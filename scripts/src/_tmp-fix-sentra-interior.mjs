/**
 * Replace fake INT=STP interiors with InteriorImageRetriever for one VIN.
 */
import fs from "node:fs";
import pg from "pg";
import { expandIaaiSpinPhotos } from "../../artifacts/api-server/src/lib/providers/iaai-spin.ts";

const VIN = process.env.VIN || "3N1AB7AP6KY202307";
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

const meta = await c.query(
  `
  SELECT v.id AS vehicle_id, l.id AS listing_id,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1]
    ) AS stock
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN photos p ON p.listing_id = l.id
  WHERE v.vin = $1 AND pr.internal_name = 'import_motor'
    AND p.photo_group = 'exterior_3d'
  GROUP BY 1,2,3
  ORDER BY count(*) DESC
  LIMIT 1
`,
  [VIN],
);
if (!meta.rows[0]?.stock) {
  console.error("no stock", meta.rows);
  await c.end();
  process.exit(1);
}
const { vehicle_id, listing_id, stock } = meta.rows[0];
console.log({ vehicle_id, listing_id, stock });

const spin = await expandIaaiSpinPhotos(stock);
const interior = spin.filter((p) => p.group === "interior_3d");
const exterior = spin.filter((p) => p.group === "exterior_3d");
console.log({
  interior: interior.map((p) => p.sourceUrl.slice(0, 120)),
  exteriorN: exterior.length,
});

const del = await c.query(
  `
  DELETE FROM photos
  WHERE listing_id = $1 AND photo_group IN ('interior_3d','exterior_3d')
  RETURNING id
`,
  [listing_id],
);
console.log("deleted3d", del.rowCount);

for (const p of [...exterior, ...interior]) {
  await c.query(
    `
    INSERT INTO photos (vehicle_id, listing_id, source_url, is_primary, sort_order, photo_group, created_at)
    VALUES ($1,$2,$3,false,$4,$5,NOW())
    ON CONFLICT DO NOTHING
  `,
    [vehicle_id, listing_id, p.sourceUrl, p.sortOrder ?? 0, p.group],
  );
}

const check = await c.query(
  `
  SELECT photo_group, count(*)::int n, min(left(source_url,120)) sample
  FROM photos WHERE listing_id=$1 AND photo_group IN ('interior_3d','exterior_3d')
  GROUP BY 1
`,
  [listing_id],
);
console.log("after", check.rows);
await c.end();
