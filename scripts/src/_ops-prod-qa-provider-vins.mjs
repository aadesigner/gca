/**
 * Quick QA: one recent VIN per enabled provider on prod.
 * Scores identity / trim / engine / extras / photos / events.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-qa-provider-vins.mjs
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

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});
await c.connect();

const providers = await c.query(`
  SELECT p.id, p.internal_name, p.name, p.enabled,
    count(l.id)::int AS listings
  FROM providers p
  LEFT JOIN listings l ON l.provider_id = p.id
  WHERE p.enabled = true
  GROUP BY p.id
  HAVING count(l.id) > 0
  ORDER BY p.internal_name
`);

const report = [];
for (const p of providers.rows) {
  const sample = await c.query(
    `
    SELECT v.vin, v.make, v.model, v.trim, v.year, v.engine_displacement, v.fuel_type, v.transmission,
      v.drive_type, v.body_type, v.color, v.country,
      l.id AS listing_id, l.title, l.price_amount, l.mileage, l.source_url,
      (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photos,
      (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id AND ph.stored_path ~* 'imgsv|r2\\.dev') AS cdn,
      (SELECT count(*)::int FROM vehicle_events ve WHERE ve.vehicle_id = v.id) AS events,
      (SELECT count(*)::int FROM vehicle_events ve WHERE ve.vehicle_id = v.id
         AND coalesce(ve.metadata::jsonb->>'field','') <> '') AS extra_like,
      (SELECT left(string_agg(distinct left(ve.description,60), ' | '), 200)
         FROM vehicle_events ve WHERE ve.vehicle_id = v.id
         AND coalesce(ve.metadata::jsonb->>'field','') <> '') AS extra_sample
    FROM listings l
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE l.provider_id = $1 AND v.vin IS NOT NULL AND length(v.vin) >= 11
    ORDER BY l.id DESC
    LIMIT 1
    `,
    [p.id],
  );
  const s = sample.rows[0];
  if (!s) {
    report.push({ provider: p.internal_name, listings: p.listings, ok: false, reason: "no_vin_sample" });
    continue;
  }
  const missing = [];
  if (!s.make) missing.push("make");
  if (!s.model) missing.push("model");
  if (!s.year) missing.push("year");
  if (!s.trim) missing.push("trim");
  if (!s.engine_displacement) missing.push("engine");
  if (!s.fuel_type) missing.push("fuel");
  if (!s.transmission) missing.push("transmission");
  if (!s.mileage) missing.push("mileage");
  if (!s.price_amount) missing.push("price");
  if (!s.photos) missing.push("photos");
  if (s.photos > 0 && s.cdn === 0) missing.push("cdn");
  // Title has token that looks like trim/chassis but trim empty
  const titleHint =
    s.title &&
    !s.trim &&
    (/\([A-Za-z][0-9]{2}[A-Za-z]?\)/.test(s.title) ||
      /\b\d{3}[iIeEdDxXsS]\b/.test(s.title) ||
      /\b(?:W|C|V|X|A)\d{3}\b/.test(s.title));
  if (titleHint) missing.push("title_trim_unused");

  report.push({
    provider: p.internal_name,
    listings: p.listings,
    vin: s.vin,
    title: (s.title || "").slice(0, 90),
    make: s.make,
    model: s.model,
    trim: s.trim,
    year: s.year,
    engine: s.engine_displacement,
    fuel: s.fuel_type,
    photos: s.photos,
    cdn: s.cdn,
    events: s.events,
    extras: s.extra_like,
    extra_sample: s.extra_sample,
    missing,
    url: s.source_url,
  });
}

const weak = report.filter((r) => (r.missing?.length ?? 0) >= 3 || r.missing?.includes("title_trim_unused"));
console.log(JSON.stringify({ total_providers: report.length, weak_count: weak.length, weak, all: report }, null, 2));
fs.writeFileSync(`${process.env.TEMP}/gca-qa-providers.json`, JSON.stringify(report, null, 2));
console.log("wrote", `${process.env.TEMP}/gca-qa-providers.json`);
await c.end();
