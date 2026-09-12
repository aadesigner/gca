import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const providerId = Number(process.env.PROVIDER_ID || 165);
const c = new pg.Client({ connectionString: loadProdUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();

const exists = `EXISTS (SELECT 1 FROM listings WHERE listings.vehicle_id = vehicles.id AND listings.provider_id = $1)`;

try {
  console.log("total...");
  console.log((await c.query(`SELECT count(*)::int AS c FROM vehicles WHERE ${exists}`, [providerId])).rows[0]);
} catch (e) {
  console.error("total FAIL", e.message);
}

try {
  console.log("byMake...");
  console.log((await c.query(`SELECT make, count(*)::int AS count FROM vehicles WHERE ${exists} GROUP BY make ORDER BY count(*) DESC LIMIT 5`, [providerId])).rows);
} catch (e) {
  console.error("byMake FAIL", e.message);
}

try {
  console.log("byProvider join...");
  // Mimic drizzle: provider facets omit providerId — full join
  console.log((await c.query(`
    SELECT providers.id, providers.name, count(distinct listings.vehicle_id)::int AS count
    FROM listings
    INNER JOIN providers ON listings.provider_id = providers.id
    INNER JOIN vehicles ON listings.vehicle_id = vehicles.id
    GROUP BY providers.id, providers.name
    ORDER BY count(distinct listings.vehicle_id) DESC
    LIMIT 5
  `)).rows);
} catch (e) {
  console.error("byProvider FAIL", e.message);
}

try {
  console.log("withListings...");
  console.log((await c.query(`
    SELECT count(*)::int AS c FROM vehicles
    WHERE ${exists}
      AND EXISTS (SELECT 1 FROM listings WHERE listings.vehicle_id = vehicles.id)
  `, [providerId])).rows[0]);
} catch (e) {
  console.error("withListings FAIL", e.message);
}

try {
  console.log("byFuel...");
  console.log((await c.query(`
    SELECT fuel_type, count(*)::int AS count FROM vehicles
    WHERE ${exists}
    GROUP BY fuel_type ORDER BY count(*) DESC LIMIT 10
  `, [providerId])).rows);
} catch (e) {
  console.error("byFuel FAIL", e.message);
}

const names = await c.query(`SELECT id, internal_name FROM providers WHERE id = ANY($1::int[])`, [[1, 2, 165]]);
console.log("providers", names.rows);

await c.end();
