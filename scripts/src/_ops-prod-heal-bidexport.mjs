/**
 * Heal BidExport / Bid.cars on production:
 *  - move damage/loss/airbag noise from timeline → Extra (metadata.field)
 *  - drop Secondary damage: Unknown + year-as-first-registration
 *  - requeue unmirrored photos for CDN
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-heal-bidexport.mjs
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

const providerIds = (
  await c.query(`SELECT id, internal_name FROM providers WHERE internal_name IN ('bidexport','bidcars')`)
).rows;
console.log("providers", providerIds);
const ids = providerIds.map((r) => r.id);
if (!ids.length) {
  await c.end();
  process.exit(0);
}

const delUnknown = await c.query(
  `
  DELETE FROM vehicle_events ve
  USING listings l
  WHERE l.vehicle_id = ve.vehicle_id
    AND l.provider_id = ANY($1::int[])
    AND ve.description ILIKE 'Secondary damage: Unknown%'
  `,
  [ids],
);
console.log("deleted_secondary_unknown", delUnknown.rowCount);

const delFirstReg = await c.query(
  `
  DELETE FROM vehicle_events ve
  USING listings l
  WHERE l.vehicle_id = ve.vehicle_id
    AND l.provider_id = ANY($1::int[])
    AND ve.event_type = 'delivery'
    AND (
      ve.metadata::text ILIKE '%productionYear%'
      OR ve.description ~ '^First registration: [0-9]{4}$'
    )
  `,
  [ids],
);
console.log("deleted_year_first_reg", delFirstReg.rowCount);

const rules = [
  { like: "Primary damage:%", field: "condition", kinds: ["primaryDamage"] },
  { like: "Secondary damage:%", field: "secondary_damage", kinds: ["secondaryDamage"] },
  { like: "Loss type:%", field: "loss_type", kinds: ["lossType"] },
  { like: "Airbag:%", field: "airbags", kinds: ["airbag"] },
  { like: "Keys available:%", field: "keys", kinds: ["keys"] },
];

for (const rule of rules) {
  const r = await c.query(
    `
    UPDATE vehicle_events ve
    SET
      event_type = 'other',
      metadata = (
        COALESCE(ve.metadata::jsonb, '{}'::jsonb)
        || jsonb_build_object(
             'field', $3::text,
             'value', coalesce(
               nullif(ve.metadata::jsonb->>'value',''),
               nullif(trim(both FROM substring(ve.description from position(':' in ve.description)+1)), ''),
               ve.description
             )
           )
      )::text
    FROM listings l
    WHERE l.vehicle_id = ve.vehicle_id
      AND l.provider_id = ANY($1::int[])
      AND (
        ve.description ILIKE $2
        OR ve.metadata::jsonb->>'kind' = ANY($4::text[])
      )
      AND coalesce(ve.metadata::jsonb->>'field','') <> $3
    `,
    [ids, rule.like, rule.field, rule.kinds],
  );
  console.log("to_extra", rule.field, r.rowCount);
}

// Reset failed / non-CDN stored_path so the mirror worker requeues them (pending = stored_path IS NULL).
const mirror = await c.query(
  `
  UPDATE photos ph
  SET stored_path = NULL
  FROM listings l
  WHERE l.id = ph.listing_id
    AND l.provider_id = ANY($1::int[])
    AND ph.source_url ILIKE 'http%'
    AND coalesce(ph.stored_path, '') !~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'
  `,
  [ids],
);
console.log("photos_reset_for_mirror", mirror.rowCount);

const link = await c.query(
  `
  UPDATE photos ph
  SET vehicle_id = l.vehicle_id
  FROM listings l
  WHERE l.id = ph.listing_id
    AND l.provider_id = ANY($1::int[])
    AND ph.vehicle_id IS DISTINCT FROM l.vehicle_id
    AND l.vehicle_id IS NOT NULL
  `,
  [ids],
);
console.log("photos_linked_vehicle", link.rowCount);

const photoStats = await c.query(
  `
  SELECT p.internal_name,
    count(*)::int AS photo_rows,
    count(*) FILTER (WHERE ph.stored_path IS NULL AND ph.source_url ILIKE 'http%')::int AS pending,
    count(*) FILTER (WHERE ph.stored_path ~* 'imgsv|r2\\.dev')::int AS mirrored,
    count(*) FILTER (WHERE ph.stored_path ILIKE 'mirror-failed%')::int AS failed
  FROM providers p
  JOIN listings l ON l.provider_id = p.id
  JOIN photos ph ON ph.listing_id = l.id
  WHERE p.id = ANY($1::int[])
  GROUP BY p.internal_name
  `,
  [ids],
);
console.log("photo_stats", photoStats.rows);

const sample = await c.query(
  `
  SELECT left(ve.description,70) AS d, ve.event_type, ve.metadata::jsonb->>'field' AS field, count(*)::int AS n
  FROM vehicle_events ve
  JOIN listings l ON l.vehicle_id = ve.vehicle_id
  WHERE l.provider_id = ANY($1::int[])
  GROUP BY 1,2,3
  ORDER BY n DESC
  LIMIT 15
  `,
  [ids],
);
console.log("event_sample", sample.rows);
await c.end();
