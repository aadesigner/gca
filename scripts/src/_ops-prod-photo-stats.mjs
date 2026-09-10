import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  const user = get("PGUSER") || get("POSTGRES_USER");
  const pass = get("PGPASSWORD") || get("POSTGRES_PASSWORD");
  const db = get("PGDATABASE") || get("POSTGRES_DB") || "railway";
  const host = get("RAILWAY_TCP_PROXY_DOMAIN");
  const port = get("RAILWAY_TCP_PROXY_PORT");
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
}

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
  statement_timeout: 180000,
});
await c.connect();

const totals = await c.query(`
  SELECT
    count(*)::bigint AS total_photos,
    count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/')::bigint AS cdn,
    count(*) FILTER (WHERE stored_path IS NULL)::bigint AS pending_mirror,
    count(*) FILTER (WHERE stored_path IS NOT NULL AND stored_path !~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/')::bigint AS other_stored
  FROM photos
`);

const noPhotoVehicles = await c.query(`
  SELECT count(*)::int AS vehicles_no_photo_rows
  FROM vehicles v
  WHERE NOT EXISTS (SELECT 1 FROM photos p WHERE p.vehicle_id = v.id)
`);

const activeNoCdn = await c.query(`
  SELECT count(DISTINCT l.vehicle_id)::int AS active_vehicles_no_cdn_thumb
  FROM listings l
  WHERE l.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM photos p
      WHERE p.vehicle_id = l.vehicle_id
        AND p.stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'
    )
`);

const pendingByProv = await c.query(`
  SELECT COALESCE(pr.internal_name, '(unknown)') AS provider, count(*)::int AS pending
  FROM photos p
  LEFT JOIN listings l ON l.id = p.listing_id
  LEFT JOIN providers pr ON pr.id = l.provider_id
  WHERE p.stored_path IS NULL
  GROUP BY 1
  ORDER BY pending DESC
  LIMIT 15
`);

const imOnlyNoCdn = await c.query(`
  SELECT count(*)::int AS vehicles
  FROM (
    SELECT vehicle_id
    FROM photos
    GROUP BY vehicle_id
    HAVING count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/') = 0
       AND count(*) FILTER (WHERE source_url ~* 'import-motor\\.com') > 0
  ) t
`);

const recentPending = await c.query(`
  SELECT count(*)::int AS pending_created_24h
  FROM photos
  WHERE stored_path IS NULL AND created_at > now() - interval '24 hours'
`);

console.log(JSON.stringify({
  totals: totals.rows[0],
  noPhotoVehicles: noPhotoVehicles.rows[0],
  activeNoCdn: activeNoCdn.rows[0],
  imOnlyNoCdn: imOnlyNoCdn.rows[0],
  recentPending: recentPending.rows[0],
  pendingByProvider: pendingByProv.rows,
}, null, 2));

await c.end();
