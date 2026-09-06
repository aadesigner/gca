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
const q = async (sql, params = []) => (await c.query(sql, params)).rows;

for (const name of [
  "sauto",
  "standvirtual",
  "mobilebg",
  "aaaauto",
  "autoscout24_be",
  "autotradernl",
]) {
  const p = (await q("SELECT id FROM providers WHERE internal_name=$1", [name]))[0];
  if (!p) continue;
  const cur = await q(
    `SELECT price_currency, count(*)::int n FROM listings WHERE provider_id=$1 GROUP BY 1 ORDER BY 2 DESC`,
    [p.id],
  );
  const sample = await q(
    `SELECT l.price_amount, l.price_currency, l.mileage, v.year, v.vin, v.make, v.model, l.source_url
     FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.provider_id=$1 ORDER BY l.id DESC LIMIT 3`,
    [p.id],
  );
  console.log("\n" + name, "currency:", JSON.stringify(cur));
  for (const s of sample) {
    console.log(
      " ",
      s.year,
      s.make,
      s.model,
      s.price_amount,
      s.price_currency,
      s.mileage + "km",
      s.vin,
      (s.source_url || "").slice(0, 90),
    );
  }
}
await c.end();
