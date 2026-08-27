/**
 * One-shot backfill: set price_usd/price_eur on listings that have a non-null
 * price but missing converted columns.
 */
import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});

const fxRes = await fetch(
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
);
const fxJson = await fxRes.json();
const perUsd = { USD: 1, ...(fxJson.usd || {}) };
const eurPerUsd = perUsd.eur;
if (!eurPerUsd) throw new Error("no EUR rate");

function convert(amount, currency) {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "USD") return { usd: Math.round(amount), eur: Math.round(amount * eurPerUsd) };
  if (cur === "EUR") return { usd: Math.round(amount / eurPerUsd), eur: Math.round(amount) };
  const units = perUsd[cur.toLowerCase()];
  if (!units) return null;
  const usd = amount / units;
  return { usd: Math.round(usd), eur: Math.round(usd * eurPerUsd) };
}

const rows = await pool.query(`
  SELECT id, price_amount, price_currency
  FROM listings
  WHERE price_amount IS NOT NULL
    AND (price_usd IS NULL OR price_eur IS NULL)
`);
console.log("to_backfill", rows.rows.length);

let ok = 0;
let skip = 0;
for (const row of rows.rows) {
  const conv = convert(Number(row.price_amount), row.price_currency);
  if (!conv) {
    skip++;
    continue;
  }
  await pool.query(`UPDATE listings SET price_usd = $2, price_eur = $3 WHERE id = $1`, [
    row.id,
    conv.usd,
    conv.eur,
  ]);
  ok++;
}

await pool.query(`
  UPDATE vehicle_observations o
  SET price_usd = l.price_usd, price_eur = l.price_eur
  FROM listings l
  WHERE o.listing_id = l.id
    AND l.price_usd IS NOT NULL
    AND (o.price_usd IS NULL OR o.price_eur IS NULL)
`);

const sample = await pool.query(`
  SELECT l.price_amount, l.price_currency, l.price_usd, l.price_eur, p.internal_name, v.transmission, v.color
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  LEFT JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name = 'otomoto'
  ORDER BY l.id DESC LIMIT 5
`);
console.log("backfilled", ok, "skipped", skip);
console.log("otomoto sample", sample.rows);

await pool.end();
