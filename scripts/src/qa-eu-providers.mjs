/**
 * QA new EU marketplace providers: photos, mileage, core details.
 *   node --import ./scripts/load-env.mjs ./scripts/src/qa-eu-providers.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/qa-eu-providers.mjs --prod
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const PROVIDERS = [
  "aaaauto",
  "sauto",
  "automobileit",
  "subito",
  "standvirtual",
  "mobilebg",
  "autoscout24_es",
  "autoscout24_be",
  "autotradernl",
];

const useProd = process.argv.includes("--prod") || process.env.FIX_TARGET === "prod" || true;
const client = useProd
  ? new pg.Client({
      host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT || 15622),
      user: process.env.PROD_PG_USER || "postgres",
      password: process.env.PROD_PG_PASSWORD,
      database: process.env.PROD_PG_DATABASE || "railway",
    })
  : new pg.Client(process.env.DATABASE_URL);

await client.connect();
console.log(`QA target=${useProd ? "PROD" : "LOCAL"} providers=${PROVIDERS.length}\n`);

const findings = [];

function flag(provider, severity, issue, detail = "") {
  findings.push({ provider, severity, issue, detail });
  const tag = severity === "high" ? "HIGH" : severity === "med" ? "MED " : "LOW ";
  console.log(`  [${tag}] ${issue}${detail ? " — " + detail : ""}`);
}

for (const name of PROVIDERS) {
  console.log(`\n======== ${name} ========`);
  const prov = (
    await client.query(`SELECT id, parser_version, base_url FROM providers WHERE internal_name=$1`, [name])
  ).rows[0];
  if (!prov) {
    flag(name, "high", "provider missing from DB");
    continue;
  }
  console.log(`id=${prov.id} parser=${prov.parser_version || "-"}`);

  const overview = await client.query(
    `
    SELECT
      count(*)::int AS listings,
      count(*) FILTER (WHERE l.is_active)::int AS active,
      count(*) FILTER (WHERE l.vin IS NOT NULL AND length(l.vin)=17)::int AS with_vin,
      count(*) FILTER (WHERE l.mileage IS NULL)::int AS mileage_null,
      count(*) FILTER (WHERE l.mileage = 0)::int AS mileage_zero,
      count(*) FILTER (WHERE l.mileage > 0 AND l.mileage < 50)::int AS mileage_tiny,
      count(*) FILTER (WHERE l.mileage > 800000)::int AS mileage_huge,
      count(*) FILTER (WHERE l.mileage_unit IS DISTINCT FROM 'km' AND l.mileage_unit IS DISTINCT FROM 'mi')::int AS mileage_unit_odd,
      count(*) FILTER (WHERE coalesce(l.mileage_unit,'km') = 'mi')::int AS mileage_mi,
      count(*) FILTER (WHERE l.price_amount IS NULL OR l.price_amount <= 0)::int AS price_missing,
      count(*) FILTER (WHERE l.title IS NULL OR length(trim(l.title)) < 3)::int AS title_bad,
      count(*) FILTER (WHERE l.country IS NULL OR length(trim(l.country)) < 2)::int AS country_bad,
      count(*) FILTER (WHERE v.make IS NULL OR length(trim(v.make)) < 1)::int AS make_bad,
      count(*) FILTER (WHERE v.model IS NULL OR length(trim(v.model)) < 1)::int AS model_bad,
      count(*) FILTER (WHERE v.year IS NULL OR v.year < 1985 OR v.year > extract(year from now())::int + 1)::int AS year_bad,
      avg(l.mileage) FILTER (WHERE l.mileage > 0 AND l.mileage < 800000)::int AS avg_mileage
    FROM listings l
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE l.provider_id = $1
    `,
    [prov.id],
  );
  const o = overview.rows[0];
  console.log(
    `listings=${o.listings} active=${o.active} vin=${o.with_vin} avg_km≈${o.avg_mileage ?? "-"} mi_unit=${o.mileage_mi}`,
  );
  console.log(
    `mileage null=${o.mileage_null} zero=${o.mileage_zero} tiny(<50)=${o.mileage_tiny} huge(>800k)=${o.mileage_huge} unit_odd=${o.mileage_unit_odd}`,
  );
  console.log(
    `price_missing=${o.price_missing} title_bad=${o.title_bad} country_bad=${o.country_bad} make_bad=${o.make_bad} model_bad=${o.model_bad} year_bad=${o.year_bad}`,
  );

  if (o.listings === 0) {
    flag(name, "high", "zero listings ingested");
    continue;
  }

  const pct = (n) => Math.round((100 * Number(n)) / Number(o.listings));
  if (pct(o.with_vin) < 40) flag(name, "high", "low VIN coverage", `${pct(o.with_vin)}%`);
  if (pct(o.mileage_null) > 40) flag(name, "med", "many null mileages", `${pct(o.mileage_null)}%`);
  if (pct(o.mileage_zero) > 15) flag(name, "med", "many zero mileages", `${pct(o.mileage_zero)}%`);
  if (Number(o.mileage_tiny) > 20) flag(name, "med", "suspicious tiny mileages", `${o.mileage_tiny} cars`);
  if (Number(o.mileage_huge) > 10) flag(name, "med", "suspicious huge mileages", `${o.mileage_huge} cars`);
  if (Number(o.mileage_unit_odd) > 0) flag(name, "high", "odd mileage units", `${o.mileage_unit_odd}`);
  if (pct(o.make_bad) > 10) flag(name, "high", "missing make", `${pct(o.make_bad)}%`);
  if (pct(o.model_bad) > 15) flag(name, "med", "missing model", `${pct(o.model_bad)}%`);
  if (pct(o.year_bad) > 10) flag(name, "med", "bad years", `${pct(o.year_bad)}%`);
  if (pct(o.country_bad) > 20) flag(name, "med", "missing country", `${pct(o.country_bad)}%`);

  // Photos
  const photos = await client.query(
    `
    SELECT
      count(DISTINCT l.id)::int AS listings,
      count(DISTINCT l.id) FILTER (WHERE pc.c IS NULL OR pc.c = 0)::int AS no_photos,
      count(DISTINCT l.id) FILTER (WHERE pc.c = 1)::int AS one_photo,
      count(DISTINCT l.id) FILTER (WHERE pc.c >= 5)::int AS rich,
      avg(pc.c)::numeric(10,2) AS avg_photos,
      count(*) FILTER (
        WHERE ph.source_url ~* 'nophoto|no[_-]?photo|placeholder|sprite|favicon|/logo'
      )::int AS junk_urls,
      count(DISTINCT ph.source_url)::int AS unique_urls,
      count(ph.id)::int AS photo_rows
    FROM listings l
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS c FROM photos p WHERE p.vehicle_id = l.vehicle_id
    ) pc ON true
    LEFT JOIN photos ph ON ph.vehicle_id = l.vehicle_id
    WHERE l.provider_id = $1
    `,
    [prov.id],
  );
  const ph = photos.rows[0];
  console.log(
    `photos avg=${ph.avg_photos} none=${ph.no_photos} one=${ph.one_photo} rich(>=5)=${ph.rich} junk=${ph.junk_urls} unique=${ph.unique_urls}/${ph.photo_rows}`,
  );

  if (Number(ph.junk_urls) > 0) flag(name, "high", "placeholder/junk photo URLs still stored", `${ph.junk_urls}`);
  if (pct(ph.no_photos) > 50 && Number(o.listings) > 20) {
    flag(name, "med", "majority of listings have no photos", `${pct(ph.no_photos)}%`);
  }

  const shared = await client.query(
    `
    SELECT coalesce(p.stored_path, p.source_url) AS url, count(DISTINCT l.vehicle_id)::int AS vehicles
    FROM photos p
    JOIN listings l ON l.vehicle_id = p.vehicle_id
    WHERE l.provider_id = $1
      AND p.source_url !~* 'nophoto|placeholder'
    GROUP BY 1
    HAVING count(DISTINCT l.vehicle_id) >= 5
    ORDER BY vehicles DESC
    LIMIT 5
    `,
    [prov.id],
  );
  if (shared.rows.length) {
    flag(
      name,
      "high",
      "same photo URL reused across many vehicles",
      shared.rows.map((r) => `${r.vehicles}× ${(r.url || "").slice(0, 70)}`).join(" | "),
    );
  } else {
    console.log("  shared real photos across >=5 vehicles: none");
  }

  // Sample outliers
  const samples = await client.query(
    `
    SELECT v.vin, v.make, v.model, v.year, l.mileage, l.mileage_unit, l.price_amount, l.country,
           l.source_url, l.title,
           (SELECT count(*)::int FROM photos p WHERE p.vehicle_id=l.vehicle_id) AS photos,
           (SELECT p.source_url FROM photos p WHERE p.vehicle_id=l.vehicle_id
             ORDER BY p.is_primary DESC NULLS LAST, p.sort_order, p.id LIMIT 1) AS first_photo
    FROM listings l
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE l.provider_id = $1
    ORDER BY l.created_at DESC
    LIMIT 5
    `,
    [prov.id],
  );
  console.log("  recent samples:");
  for (const r of samples.rows) {
    console.log(
      `    ${r.make || "?"} ${r.model || "?"} ${r.year || "?"} vin=${r.vin || "-"} km=${r.mileage ?? "null"}${r.mileage_unit || ""} €=${r.price_amount ?? "-"} photos=${r.photos} ${(r.first_photo || "").slice(0, 70)}`,
    );
  }

  const weirdMileage = await client.query(
    `
    SELECT v.make, v.model, v.year, l.mileage, l.mileage_unit, l.source_url
    FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
    WHERE l.provider_id=$1
      AND (
        (l.mileage > 0 AND l.mileage < 30)
        OR l.mileage > 900000
      )
    ORDER BY l.mileage ASC
    LIMIT 5
    `,
    [prov.id],
  );
  if (weirdMileage.rows.length) {
    console.log("  mileage outliers:");
    for (const r of weirdMileage.rows) {
      console.log(`    ${r.mileage}${r.mileage_unit || ""} ${r.make} ${r.model} ${r.year} ${r.source_url}`);
    }
  }
}

console.log("\n\n======== SUMMARY ========");
const highs = findings.filter((f) => f.severity === "high");
const meds = findings.filter((f) => f.severity === "med");
console.log(`high=${highs.length} med=${meds.length} low=${findings.length - highs.length - meds.length}`);
for (const f of findings.sort((a, b) => (a.severity === "high" ? -1 : 1))) {
  console.log(`${f.severity.toUpperCase().padEnd(4)} ${f.provider.padEnd(16)} ${f.issue} ${f.detail}`);
}

await client.end();
process.exit(highs.length ? 2 : 0);
