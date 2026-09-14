/**
 * Post-publish check: fleet + IM lot/stock match on recent photos + GTI.
 */
import fs from "node:fs";
import pg from "pg";

function clientFrom(pathOrUrl, label) {
  if (pathOrUrl.startsWith("postgres")) {
    return { label, c: new pg.Client({ connectionString: pathOrUrl, ssl: pathOrUrl.includes("localhost") || pathOrUrl.includes("127.0.0.1") ? false : { rejectUnauthorized: false } }) };
  }
  const raw = fs.readFileSync(pathOrUrl, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => {
    const v = vars[n];
    return v && typeof v === "object" && "value" in v ? v.value : v;
  };
  return {
    label,
    c: new pg.Client({
      host: get("RAILWAY_TCP_PROXY_DOMAIN"),
      port: Number(get("RAILWAY_TCP_PROXY_PORT")),
      user: get("PGUSER") || "postgres",
      password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
      database: get("PGDATABASE") || "railway",
      ssl: { rejectUnauthorized: false },
    }),
  };
}

async function check(db) {
  await db.c.connect();
  const out = { env: db.label };

  const fleet = await db.c.query(`
    SELECT count(*) FILTER (WHERE status='running')::int AS running,
           count(*) FILTER (WHERE status='pending')::int AS pending,
           count(*) FILTER (WHERE status='running' AND updated_at < NOW()-interval '20 minutes')::int AS quiet_20m
    FROM collection_jobs WHERE status IN ('running','pending')
  `);
  out.fleet = fleet.rows[0];

  const imJob = await db.c.query(`
    SELECT j.id, j.status, j.job_type,
      COALESCE(j.items_processed,0)::int proc,
      COALESCE(j.items_failed,0)::int fail,
      round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m,
      left(COALESCE(j.error_message,''),80) err
    FROM collection_jobs j
    JOIN providers p ON p.id=j.provider_id
    WHERE p.internal_name='import_motor' AND j.status IN ('running','pending')
    ORDER BY CASE j.status WHEN 'running' THEN 0 ELSE 1 END, j.updated_at DESC
    LIMIT 3
  `);
  out.imJobs = imJob.rows;

  const mismatch = await db.c.query(`
    SELECT count(*)::int n, count(DISTINCT v.vin)::int vins
    FROM photos p
    JOIN listings l ON l.id = p.listing_id
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE pr.internal_name = 'import_motor'
      AND l.source_id ~ '^im-\\d{6,}$'
      AND COALESCE(
        (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
      ) IS NOT NULL
      AND COALESCE(
        (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
      ) <> (regexp_match(l.source_id, '^im-(\\d{6,})$', 'i'))[1]
  `);
  out.lotMismatch = mismatch.rows[0];

  const recent = await db.c.query(`
    WITH recent AS (
      SELECT l.id, l.source_id, v.vin, p.source_url, p.created_at, p.photo_group
      FROM photos p
      JOIN listings l ON l.id = p.listing_id
      JOIN providers pr ON pr.id = l.provider_id
      JOIN vehicles v ON v.id = l.vehicle_id
      WHERE pr.internal_name = 'import_motor'
        AND p.created_at > NOW() - interval '2 hours'
      ORDER BY p.created_at DESC
      LIMIT 500
    )
    SELECT
      count(*)::int photos_2h,
      count(DISTINCT vin)::int vins_2h,
      count(*) FILTER (WHERE photo_group IN ('exterior_3d','interior_3d'))::int spin_2h,
      count(*) FILTER (
        WHERE COALESCE(
          (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
        ) IS NOT NULL
        AND source_id ~ '^im-\\d{6,}$'
        AND COALESCE(
          (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
        ) = (regexp_match(source_id, '^im-(\\d{6,})$', 'i'))[1]
      )::int matched_stock,
      count(*) FILTER (
        WHERE COALESCE(
          (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
        ) IS NOT NULL
        AND source_id ~ '^im-\\d{6,}$'
        AND COALESCE(
          (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
          (regexp_match(source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
        ) <> (regexp_match(source_id, '^im-(\\d{6,})$', 'i'))[1]
      )::int mismatched_stock
    FROM recent
  `);
  out.recentImPhotos = recent.rows[0];

  const samples = await db.c.query(`
    SELECT v.vin, l.source_id,
      count(*)::int n,
      count(DISTINCT COALESCE(
        (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
        (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
      ))::int stocks,
      max(p.created_at) AS last_photo
    FROM photos p
    JOIN listings l ON l.id = p.listing_id
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE pr.internal_name = 'import_motor'
      AND p.created_at > NOW() - interval '2 hours'
      AND l.source_id ~ '^im-\\d{6,}$'
    GROUP BY 1,2
    ORDER BY last_photo DESC
    LIMIT 8
  `);
  out.recentSamples = samples.rows.map((r) => ({
    ...r,
    lotOk: !r.stocks || [...new Set([(r.source_id || "").replace(/^im-/i, "")])].every(() => true),
  }));

  // Annotate samples with lot match
  for (const r of out.recentSamples) {
    const lot = String(r.source_id || "").replace(/^im-/i, "");
    const stockCheck = await db.c.query(
      `
      SELECT count(*) FILTER (
        WHERE stock IS NOT NULL AND stock <> $2
      )::int bad,
      count(*) FILTER (WHERE stock IS NOT NULL AND stock = $2)::int good
      FROM (
        SELECT COALESCE(
          (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
          (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1],
          (regexp_match(p.source_url, '/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
        ) stock
        FROM photos p
        JOIN listings l ON l.id = p.listing_id
        JOIN vehicles v ON v.id = l.vehicle_id
        WHERE v.vin = $1 AND l.source_id = $3
          AND p.created_at > NOW() - interval '2 hours'
      ) s
    `,
      [r.vin, lot, r.source_id],
    );
    r.good = stockCheck.rows[0].good;
    r.bad = stockCheck.rows[0].bad;
    delete r.lotOk;
  }

  const gti = await db.c.query(`
    SELECT l.source_id, count(p.id)::int photos
    FROM listings l
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    LEFT JOIN photos p ON p.listing_id = l.id
    WHERE v.vin = 'WVWED71K98W309297' AND pr.internal_name = 'import_motor'
    GROUP BY 1
  `);
  out.gti = gti.rows;

  await db.c.end();
  return out;
}

const prod = await check(clientFrom(`${process.env.TEMP}/gca-pg-vars-prod.json`, "prod"));
console.log(JSON.stringify(prod, null, 2));

try {
  const local = await check(
    clientFrom("postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable", "local"),
  );
  console.log(JSON.stringify(local, null, 2));
} catch (e) {
  console.log(JSON.stringify({ env: "local", error: String(e.message || e) }, null, 2));
}
