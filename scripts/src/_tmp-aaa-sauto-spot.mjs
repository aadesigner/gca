/**
 * Spot-check aaaauto + sauto samples: mileage/photos look sane vs live HTML/API.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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

async function samples(name, n = 3) {
  const p = (await c.query(`SELECT id FROM providers WHERE internal_name=$1`, [name])).rows[0];
  return (
    await c.query(
      `SELECT l.source_url, l.mileage, l.price_amount, l.price_currency, v.year, v.vin, v.make, v.model,
        (SELECT count(*)::int FROM photos ph WHERE ph.listing_id=l.id) AS photos
       FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
       WHERE l.provider_id=$1 AND l.mileage > 1000
       ORDER BY random() LIMIT $2`,
      [p.id, n],
    )
  ).rows;
}

console.log("=== aaaauto live vs db ===");
for (const s of await samples("aaaauto", 2)) {
  const res = await fetch(s.source_url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  const html = await res.text();
  const km = html.match(/([\d\s]+)\s*km/i)?.[1]?.replace(/\s/g, "");
  const year = html.match(/(20\d{2}|19\d{2})/)?.[1];
  const imgs = [...html.matchAll(/https:\/\/[^"'\\\s]+aaaauto[^"'\\\s]+\.(?:jpe?g|webp)/gi)].length;
  console.log("DB ", s.make, s.model, s.year, s.mileage + "km", s.price_amount, s.price_currency, "photos", s.photos);
  console.log("LIVE km~", km, "yearHit", year, "imgUrls", imgs, "status", res.status);
}

console.log("\n=== sauto API vs db ===");
for (const s of await samples("sauto", 2)) {
  const id = s.source_url.match(/\/(\d+)(?:\?|$)/)?.[1];
  const res = await fetch(`https://www.sauto.cz/api/v1/items/${id}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json();
  console.log("DB ", s.make, s.model, s.year, s.mileage, s.price_amount, s.price_currency, "photos", s.photos);
  console.log("API", j.manufacturer_cb?.name, j.model_cb?.name, j.tachometer, j.price, "CZK", "images", j.images?.length, "vin", j.vin);
}
await c.end();
