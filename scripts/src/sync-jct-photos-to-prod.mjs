/**
 * Push richer JapaneseCarTrade galleries from local → prod for VINs that already
 * exist in production with a thin (≤1–2 photo) JCT listing.
 *
 * Local must already be repaired (pnpm backfill:jct-photos). This only INSERTs
 * missing source_url rows — never deletes prod photos.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/sync-jct-photos-to-prod.mjs --dry-run
 *   node --import ./scripts/load-env.mjs ./scripts/src/sync-jct-photos-to-prod.mjs --apply --limit=500
 *
 * Env: same as sync-new-vins-to-prod (PROD_PG_* / PROD_DATABASE_URL / gca-pg-vars-prod.json)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const apply = args.has("--apply");
if (!dryRun && !apply) {
  console.error("Pass --dry-run or --apply");
  process.exit(1);
}
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "500");
const minLocal = Number(process.argv.find((a) => a.startsWith("--min-local="))?.split("=")[1] ?? "3");
const maxProd = Number(process.argv.find((a) => a.startsWith("--max-prod="))?.split("=")[1] ?? "2");

const LOCAL =
  process.env.LOCAL_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";

function loadProdFromRailwayJson() {
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw.slice(raw.indexOf("{")));
    const vars = j.variables || j;
    const get = (n) =>
      vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
    const proxyHost = get("RAILWAY_TCP_PROXY_DOMAIN");
    const proxyPort = Number(get("RAILWAY_TCP_PROXY_PORT") || 0);
    const internalHost = get("PGHOST") || get("host");
    // Prefer public TCP proxy — postgres.railway.internal only resolves inside Railway.
    const host =
      proxyHost ||
      (internalHost && !/\.railway\.internal$/i.test(String(internalHost)) ? internalHost : null) ||
      "yamanote.proxy.rlwy.net";
    const port =
      proxyPort ||
      Number(get("PGPORT") || get("port") || 0) ||
      15622;
    return {
      host,
      port,
      user: get("PGUSER") || get("POSTGRES_USER") || get("user") || "postgres",
      password: get("PGPASSWORD") || get("POSTGRES_PASSWORD") || get("password"),
      database: get("PGDATABASE") || get("database") || "railway",
    };
  } catch {
    return null;
  }
}

const railway = loadProdFromRailwayJson();
const prodConfig = process.env.PROD_DATABASE_URL
  ? { connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.PROD_PG_HOST ?? railway?.host ?? "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT ?? railway?.port ?? "15622"),
      user: process.env.PROD_PG_USER ?? railway?.user ?? "postgres",
      password: process.env.PROD_PG_PASSWORD ?? railway?.password,
      database: process.env.PROD_PG_DATABASE ?? railway?.database ?? "railway",
      // Railway TCP proxy speaks plain Postgres; SSL negotiation is flaky on the proxy path.
      ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
    };

if (!process.env.PROD_DATABASE_URL && !prodConfig.password) {
  console.error("Set PROD_PG_PASSWORD or PROD_DATABASE_URL (or %TEMP%/gca-pg-vars-prod.json)");
  process.exit(1);
}

const local = new pg.Client({ connectionString: LOCAL });
const prod = new pg.Client(prodConfig);
await local.connect();
await prod.connect();

// Local JCT vehicles with a real album (≥ minLocal photos)
const { rows: localRich } = await local.query(
  `
  SELECT v.vin, l.source_id, l.id AS local_listing_id, v.id AS local_vehicle_id,
    count(p.id)::int AS photo_count,
    count(p.id) FILTER (
      WHERE p.source_url NOT ILIKE '%/jct/thumbnail/%'
        AND p.source_url NOT ILIKE '%sim_image%'
    )::int AS album_n
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  JOIN photos p ON p.vehicle_id = v.id
  WHERE pr.internal_name = 'japanesecartrade'
  GROUP BY v.vin, l.source_id, l.id, v.id
  HAVING count(p.id) >= $1
  ORDER BY photo_count DESC, album_n DESC
  LIMIT $2
`,
  [minLocal, limit],
);

console.log({
  mode: apply ? "APPLY" : "DRY_RUN",
  localRichCandidates: localRich.length,
  minLocal,
  maxProd,
});

let syncedVehicles = 0;
let photosInserted = 0;
let skipped = 0;

for (const row of localRich) {
  const { rows: prodRows } = await prod.query(
    `
    SELECT v.id AS vehicle_id, l.id AS listing_id,
      (SELECT count(*)::int FROM photos ph WHERE ph.vehicle_id = v.id) AS photo_count
    FROM vehicles v
    JOIN listings l ON l.vehicle_id = v.id
    JOIN providers pr ON pr.id = l.provider_id
    WHERE v.vin = $1 AND pr.internal_name = 'japanesecartrade'
    ORDER BY l.last_seen_at DESC NULLS LAST
    LIMIT 1
  `,
    [row.vin],
  );
  const prodHit = prodRows[0];
  if (!prodHit) {
    skipped++;
    continue;
  }
  if (Number(prodHit.photo_count) > maxProd) {
    skipped++;
    continue;
  }

  const { rows: localPhotos } = await local.query(
    `
    SELECT source_url, stored_path, width, height, is_primary, sort_order, photo_group, created_at
    FROM photos
    WHERE vehicle_id = $1
      AND source_url NOT ILIKE '%/jct/thumbnail/%'
      AND source_url NOT ILIKE '%sim_image%'
      AND (
        source_url ~* '\\.(jpe?g|webp|png)(\\?|$)'
        OR source_url ILIKE '%/vehicle_image/%'
      )
    ORDER BY sort_order NULLS LAST, id
  `,
    [row.local_vehicle_id],
  );

  if (localPhotos.length <= Number(prodHit.photo_count)) {
    skipped++;
    continue;
  }

  console.log(
    `${row.vin} local=${localPhotos.length} prod=${prodHit.photo_count} → insert up to ${localPhotos.length}`,
  );

  if (!apply) {
    syncedVehicles++;
    continue;
  }

  let inserted = 0;
  for (const p of localPhotos) {
    const stored =
      p.stored_path && /imgsv\.getcarapi\.com|\.r2\.dev\//i.test(String(p.stored_path))
        ? p.stored_path
        : null;
    const res = await prod.query(
      `
      INSERT INTO photos (
        vehicle_id, listing_id, source_url, stored_path, width, height,
        is_primary, sort_order, photo_group, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()))
      ON CONFLICT (listing_id, source_url) DO NOTHING
    `,
      [
        prodHit.vehicle_id,
        prodHit.listing_id,
        p.source_url,
        stored,
        p.width,
        p.height,
        p.is_primary,
        p.sort_order,
        p.photo_group ?? "gallery",
        p.created_at,
      ],
    );
    inserted += res.rowCount ?? 0;
  }
  // Also try vehicle_id unique for any without listing conflict path
  photosInserted += inserted;
  syncedVehicles++;
  console.log(`  inserted=${inserted}`);
}

console.log({ syncedVehicles, photosInserted, skipped });
await local.end();
await prod.end();
