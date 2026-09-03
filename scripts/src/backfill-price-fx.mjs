/**
 * Backfill price_usd / price_eur on listings and vehicle_observations.
 * Usage: node --import ./scripts/load-env.mjs ./scripts/src/backfill-price-fx.mjs [--dry-run|--apply]
 */
import pg from "pg";

const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");
if (!dryRun && !apply) {
  console.error("Pass --dry-run or --apply");
  process.exit(1);
}

const client = process.env.PROD_PG_PASSWORD
  ? new pg.Client({
      host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT ?? "15622"),
      user: "postgres",
      password: process.env.PROD_PG_PASSWORD,
      database: "railway",
      ssl: false,
    })
  : new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

const FX_URL = "https://open.er-api.com/v6/latest/USD";
const fxRes = await fetch(FX_URL);
const fxJson = await fxRes.json();
if (fxJson.result !== "success" || !fxJson.rates) throw new Error("FX fetch failed");
const perUsd = { USD: 1, ...fxJson.rates };

function convert(amount, currency) {
  const cur = (currency ?? "USD").toUpperCase();
  const eurPerUsd = perUsd.EUR;
  if (!eurPerUsd || amount == null || !Number.isFinite(amount)) return { usd: null, eur: null };
  if (cur === "USD") return { usd: Math.round(amount), eur: Math.round(amount * eurPerUsd) };
  if (cur === "EUR") return { usd: Math.round(amount / eurPerUsd), eur: Math.round(amount) };
  const units = perUsd[cur];
  if (!units || units <= 0) return { usd: null, eur: null };
  const usd = amount / units;
  return { usd: Math.round(usd), eur: Math.round(usd * eurPerUsd) };
}

async function backfillTable(table) {
  const { rows } = await client.query(`
    SELECT id, price_amount, price_currency
    FROM ${table}
    WHERE price_amount IS NOT NULL
      AND (price_usd IS NULL OR price_eur IS NULL)
    ORDER BY id
    LIMIT 50000
  `);
  console.log(`${table}: ${rows.length} rows to update`);
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const { usd, eur } = convert(Number(row.price_amount), row.price_currency);
    if (usd == null || eur == null) {
      skipped += 1;
      continue;
    }
    if (apply) {
      await client.query(
        `UPDATE ${table} SET price_usd = $1, price_eur = $2 WHERE id = $3`,
        [usd, eur, row.id],
      );
    }
    updated += 1;
  }
  console.log(`${table}: ${apply ? "updated" : "would update"} ${updated}, skipped ${skipped}`);
}

if (dryRun) console.log("DRY RUN");
await backfillTable("listings");
await backfillTable("vehicle_observations");
await client.end();
