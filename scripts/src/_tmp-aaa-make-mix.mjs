import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

const aaa = (await c.query(`SELECT id FROM providers WHERE internal_name='aaaauto'`)).rows[0].id;

const top = await c.query(
  `
  SELECT v.make, v.model, count(*)::int n
  FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
  WHERE l.provider_id=$1
  GROUP BY 1,2 ORDER BY n DESC LIMIT 20
  `,
  [aaa],
);
console.log("aaaauto top make/model:");
for (const r of top.rows) console.log(String(r.n).padStart(5), r.make, r.model);

const recent = await c.query(
  `
  SELECT v.make, v.model, v.year, v.vin, l.mileage, l.price_amount, l.source_url,
    (SELECT count(*)::int FROM photos p WHERE p.listing_id=l.id) photos
  FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
  WHERE l.provider_id=$1
  ORDER BY l.id DESC LIMIT 15
  `,
  [aaa],
);
console.log("\nmost recent aaaauto:");
for (const r of recent.rows) {
  console.log(
    r.year,
    r.make,
    r.model,
    r.mileage + "km",
    r.price_amount + "EUR",
    "photos=" + r.photos,
    r.vin,
    (r.source_url || "").slice(0, 70),
  );
}

const share = await c.query(
  `
  SELECT
    count(*) FILTER (WHERE lower(v.make) IN ('chery','jaecoo','omoda','dongfeng') OR lower(v.model) LIKE '%tiggo%' OR lower(v.model) LIKE '%jaecoo%')::int AS chinese_new,
    count(*)::int AS total
  FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
  WHERE l.provider_id=$1
  `,
  [aaa],
);
console.log("\nchery/jaecoo/omoda-ish share:", share.rows[0]);

await c.end();
