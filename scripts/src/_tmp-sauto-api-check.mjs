import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

const p = (await c.query(`SELECT id FROM providers WHERE internal_name='sauto'`)).rows[0];
const rows = (
  await c.query(
    `SELECT l.source_url, l.mileage, l.price_amount, l.price_currency, v.year, v.vin, v.make, v.model,
      (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id) AS photos
     FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.provider_id=$1 AND l.mileage>5000 ORDER BY random() LIMIT 3`,
    [p.id],
  )
).rows;

for (const s of rows) {
  const id = s.source_url.match(/\/(\d+)(?:\?|$)/)?.[1];
  const url = `https://www.sauto.cz/api/v1/items/${id}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      "Accept-Language": "cs-CZ,cs;q=0.9",
      Referer: "https://www.sauto.cz/",
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  console.log("\nDB", s.vin, s.make, s.model, s.year, s.mileage + "km", s.price_amount, s.price_currency, "photos", s.photos);
  console.log("API status", res.status, "keys", j && Object.keys(j).slice(0, 15));
  if (j) {
    console.log(
      "API fields",
      j.tachometer ?? j.item?.tachometer,
      j.price ?? j.item?.price,
      j.vin ?? j.item?.vin,
      "imgs",
      (j.images || j.item?.images)?.length,
    );
    const kmMatch = s.mileage === (j.tachometer ?? j.item?.tachometer);
    const priceMatch = s.price_amount === (j.price ?? j.item?.price);
    console.log("match km", kmMatch, "price", priceMatch);
  } else {
    console.log("body", text.slice(0, 200));
  }
}

// aaaauto: compare photo uniqueness + mileage distribution sanity
const aaa = (await c.query(`SELECT id FROM providers WHERE internal_name='aaaauto'`)).rows[0];
const dist = await c.query(
  `SELECT
     percentile_cont(0.5) WITHIN GROUP (ORDER BY mileage) AS med_km,
     count(*) FILTER (WHERE mileage BETWEEN 1000 AND 400000)::int AS sane_km,
     count(*)::int AS n,
     count(*) FILTER (WHERE price_amount BETWEEN 500 AND 200000)::int AS sane_price
   FROM listings WHERE provider_id=$1`,
  [aaa.id],
);
console.log("\naaaauto sanity", dist.rows[0]);

const shared = await c.query(
  `SELECT ph.cdn_url, count(DISTINCT l.id)::int AS cars
   FROM photos ph
   JOIN listings l ON l.id = ph.listing_id
   WHERE l.provider_id=$1 AND ph.cdn_url IS NOT NULL
   GROUP BY 1 HAVING count(DISTINCT l.id) >= 5
   ORDER BY 2 DESC LIMIT 5`,
  [aaa.id],
);
console.log("aaaauto shared cdn (>=5 cars)", shared.rows);

await c.end();
