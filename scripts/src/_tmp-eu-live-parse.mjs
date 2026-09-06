/**
 * Live-parse sample URLs for EU providers and print mileage/price/year/photos/vin.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Use compiled adapters if built, else ts via tsx — prefer dynamic import of source via tsx path.
const { fetchHtml } = await import("../../artifacts/api-server/src/lib/providers/web-html.ts").catch(() =>
  import("../../artifacts/api-server/dist/lib/providers/web-html.js"),
);

async function tryImport(path) {
  try {
    return await import(path);
  } catch (e) {
    console.error("import fail", path, e.message);
    return null;
  }
}

const adapters = {};
for (const [name, modPath, cls] of [
  ["standvirtual", "../../artifacts/api-server/src/lib/providers/standvirtual.ts", "StandvirtualHistoricalAdapter"],
  ["mobilebg", "../../artifacts/api-server/src/lib/providers/mobilebg.ts", "MobilebgHistoricalAdapter"],
  ["subito", "../../artifacts/api-server/src/lib/providers/subito.ts", "SubitoHistoricalAdapter"],
  ["automobileit", "../../artifacts/api-server/src/lib/providers/automobileit.ts", "AutomobileitHistoricalAdapter"],
  ["sauto", "../../artifacts/api-server/src/lib/providers/sauto.ts", "SautoHistoricalAdapter"],
  ["aaaauto", "../../artifacts/api-server/src/lib/providers/aaaauto.ts", "AaaautoHistoricalAdapter"],
]) {
  const m = await tryImport(modPath);
  if (m?.[cls]) adapters[name] = new m[cls]();
}

const pg = require("../../lib/db/node_modules/pg");
const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

async function sampleUrls(name, n = 2) {
  const p = (await c.query(`SELECT id FROM providers WHERE internal_name=$1`, [name])).rows[0];
  if (!p) return [];
  const rows = await c.query(
    `SELECT source_url FROM listings WHERE provider_id=$1 AND source_url IS NOT NULL ORDER BY id DESC LIMIT $2`,
    [p.id, n],
  );
  return rows.rows.map((r) => r.source_url);
}

async function checkAdapter(name, urls) {
  const a = adapters[name];
  if (!a) {
    console.log(`\n## ${name}: no adapter loaded`);
    return;
  }
  console.log(`\n## ${name}`);
  // discovery
  try {
    const disc = await a.discoverListings(1);
    console.log(`  discover page1: ${disc.listings.length} refs hasMore=${disc.pagination?.hasMore}`);
    if (!urls.length && disc.listings.length) {
      urls = disc.listings.slice(0, 2).map((l) => l.url);
    }
  } catch (e) {
    console.log(`  discover ERR: ${e.message}`);
  }
  for (const url of urls.slice(0, 2)) {
    try {
      const fetched = await a.fetchListing(url);
      const parsed = await a.parseListing(fetched);
      const v = parsed.vehicle || {};
      console.log(`  URL ${url.slice(0, 90)}`);
      console.log(
        `    make=${v.make} model=${v.model} year=${v.year} vin=${v.vin || "-"} km=${parsed.mileage} price=${parsed.priceAmount ?? parsed.price} ${parsed.priceCurrency || parsed.currency || ""} photos=${(parsed.photos || []).length}`,
      );
    } catch (e) {
      console.log(`  PARSE ERR ${url.slice(0, 70)}: ${e.message}`);
    }
  }
}

const names = ["standvirtual", "mobilebg", "subito", "automobileit", "sauto", "aaaauto"];
for (const name of names) {
  const urls = await sampleUrls(name, 2);
  await checkAdapter(name, urls);
}

// AS24 BE via shared module
const as24 = await tryImport("../../artifacts/api-server/src/lib/providers/autoscout24.ts");
if (as24?.Autoscout24BeHistoricalAdapter || as24?.createAutoscout24BeAdapter) {
  console.log("\n## autoscout24_be module exports", Object.keys(as24).filter((k) => /Adapter|BE|NL|ES/i.test(k)));
}

await c.end();
