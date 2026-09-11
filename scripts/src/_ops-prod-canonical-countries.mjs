/**
 * Backfill non-English country labels to English canonical names on prod.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-canonical-countries.mjs
 */
import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

/** Native / alternate spellings → English (must stay in sync with geo.ts aliases). */
const MAP = [
  ["Polska", "Poland"],
  ["polska", "Poland"],
  ["Deutschland", "Germany"],
  ["Österreich", "Austria"],
  ["Osterreich", "Austria"],
  ["Česko", "Czechia"],
  ["Cesko", "Czechia"],
  ["Slovensko", "Slovakia"],
  ["Magyarország", "Hungary"],
  ["Magyarorszag", "Hungary"],
  ["Italia", "Italy"],
  ["España", "Spain"],
  ["Espana", "Spain"],
  ["Nederland", "Netherlands"],
  ["België", "Belgium"],
  ["Belgie", "Belgium"],
  ["Belgique", "Belgium"],
  ["Hrvatska", "Croatia"],
  ["Srbija", "Serbia"],
  ["Slovenija", "Slovenia"],
  ["Türkiye", "Turkey"],
  ["Turkiye", "Turkey"],
];

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();

for (const [from, to] of MAP) {
  const listings = await c.query(`UPDATE listings SET country = $2 WHERE country = $1`, [from, to]);
  const vehicles = await c.query(`UPDATE vehicles SET country = $2 WHERE country = $1`, [from, to]);
  const locListings = await c.query(
    `UPDATE listings SET location = replace(location, $1, $2) WHERE location ILIKE '%' || $1 || '%'`,
    [from, to],
  );
  if (listings.rowCount || vehicles.rowCount || locListings.rowCount) {
    console.log({ from, to, listings: listings.rowCount, vehicles: vehicles.rowCount, locations: locListings.rowCount });
  }
}

const check = await c.query(`
  SELECT country, count(*)::int AS n FROM listings
  WHERE country ILIKE '%polsk%' OR country = 'Poland'
  GROUP BY country ORDER BY n DESC
`);
console.log("poland_check", check.rows);
await c.end();
