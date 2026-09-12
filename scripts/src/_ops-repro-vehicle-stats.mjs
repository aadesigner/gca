/**
 * Reproduce admin vehicles/stats drizzle queries against prod for a provider.
 */
import fs from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { count, eq, sql, and } from "drizzle-orm";
import {
  vehiclesTable,
  listingsTable,
  providersTable,
  vehicleObservationsTable,
} from "../../lib/db/src/schema/index.ts";
import { mergeCountryCounts } from "../../artifacts/api-server/src/lib/geo.ts";
import { mergeModelCounts } from "../../artifacts/api-server/src/lib/model-normalize.ts";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const providerId = Number(process.env.PROVIDER_ID || 165);
const pool = new pg.Pool({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  max: 20,
  options: "-c statement_timeout=180000",
});
const db = drizzle(pool);

const whereClause = sql`EXISTS (SELECT 1 FROM ${listingsTable} WHERE ${listingsTable.vehicleId} = ${vehiclesTable.id} AND ${listingsTable.providerId} = ${providerId})`;

console.log("running Promise.all for provider", providerId);
try {
  const [
    [totalRow],
    [withListingsRow],
    [withObsRow],
    byMakeRows,
    byModelRows,
    byCountryRows,
    byYearRows,
    byProviderRows,
    byFuelRows,
  ] = await Promise.all([
    db.select({ c: count() }).from(vehiclesTable).where(whereClause),
    db
      .select({ c: count() })
      .from(vehiclesTable)
      .where(and(whereClause, sql`EXISTS (SELECT 1 FROM ${listingsTable} WHERE ${listingsTable.vehicleId} = ${vehiclesTable.id})`)),
    db
      .select({ c: count() })
      .from(vehiclesTable)
      .where(
        and(
          whereClause,
          sql`EXISTS (SELECT 1 FROM ${vehicleObservationsTable} WHERE ${vehicleObservationsTable.vehicleId} = ${vehiclesTable.id})`,
        ),
      ),
    db
      .select({ make: vehiclesTable.make, count: sql`count(*)::int` })
      .from(vehiclesTable)
      .where(whereClause)
      .groupBy(vehiclesTable.make)
      .orderBy(sql`count(*) DESC`)
      .limit(200),
    Promise.resolve([]),
    db
      .select({ country: vehiclesTable.country, count: sql`count(*)::int` })
      .from(vehiclesTable)
      .where(whereClause)
      .groupBy(vehiclesTable.country)
      .orderBy(sql`count(*) DESC`)
      .limit(80),
    db
      .select({ year: vehiclesTable.year, count: sql`count(*)::int` })
      .from(vehiclesTable)
      .where(whereClause)
      .groupBy(vehiclesTable.year)
      .orderBy(sql`${vehiclesTable.year} DESC NULLS LAST`)
      .limit(80),
    db
      .select({
        id: providersTable.id,
        name: providersTable.name,
        count: sql`count(distinct ${listingsTable.vehicleId})::int`,
      })
      .from(listingsTable)
      .innerJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
      .innerJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id))
      .groupBy(providersTable.id, providersTable.name)
      .orderBy(sql`count(distinct ${listingsTable.vehicleId}) DESC`),
    db
      .select({ fuelType: vehiclesTable.fuelType, count: sql`count(*)::int` })
      .from(vehiclesTable)
      .where(whereClause)
      .groupBy(vehiclesTable.fuelType)
      .orderBy(sql`count(*) DESC`)
      .limit(40),
  ]);

  const body = {
    total: Number(totalRow?.c ?? 0),
    withListings: Number(withListingsRow?.c ?? 0),
    withObservations: Number(withObsRow?.c ?? 0),
    byMake: byMakeRows.map((r) => ({ make: r.make, count: Number(r.count) })),
    byModel: mergeModelCounts([]),
    byCountry: mergeCountryCounts(
      byCountryRows.map((r) => ({ country: r.country, count: Number(r.count) })),
    ),
    byYear: byYearRows
      .filter((r) => r.year != null && r.year >= 1980 && r.year <= 2035)
      .map((r) => ({ year: r.year, count: Number(r.count) })),
    byProvider: byProviderRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })),
    byFuel: byFuelRows
      .filter((r) => r.fuelType != null && String(r.fuelType).trim() !== "")
      .map((r) => ({ fuelType: r.fuelType, count: Number(r.count) })),
  };
  console.log("OK", {
    total: body.total,
    makes: body.byMake.length,
    providers: body.byProvider.length,
    countries: body.byCountry,
    jsonBytes: JSON.stringify(body).length,
  });
} catch (e) {
  console.error("FAIL", e);
}
await pool.end();
