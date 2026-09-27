/**
 * Fix fake IAA 360 rows on recently added cars only.
 * Does not scan photos. Uses listings_created_at + photos_listing_id.
 * Keeps ThreeSixtyImageRetriever and old long STP spins (16+ frames).
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-heal-fake-iaai-360.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-heal-fake-iaai-360.mjs --apply
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-heal-fake-iaai-360.mjs --prod
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-heal-fake-iaai-360.mjs --prod --apply
 */
import fs from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const WANT_PROD = process.argv.includes("--prod");
const SINCE = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] || "7 days";

function prodUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

function kindExpr(alias = "p") {
  return `
    CASE
      WHEN ${alias}.source_url ILIKE '%ThreeSixtyImageRetriever%' THEN 'retriever'
      WHEN ${alias}.source_url ILIKE '%~SID~STP~%' OR ${alias}.source_url ILIKE '%SID%7ESTP%' THEN 'stp'
      WHEN ${alias}.source_url ILIKE '%~SID~INT~%' OR ${alias}.source_url ILIKE '%SID%7EINT%' THEN 'int'
      WHEN ${alias}.source_url ILIKE '%~S0~%' OR ${alias}.source_url ILIKE '%S0~I%' THEN 's0_still'
      WHEN ${alias}.source_url ILIKE '%vis.iaai.com%' THEN 'iaa_resizer_other'
      ELSE 'other'
    END
  `;
}

async function run(name, cfg) {
  const c = new pg.Client(cfg);
  await c.connect();
  await c.query("SET statement_timeout = '15s'");

  const recent = await c.query(
    `SELECT l.id FROM listings l WHERE l.created_at > now() - $1::interval`,
    [SINCE],
  );
  const ids = recent.rows.map((r) => r.id);
  console.log(name, { recentListings: ids.length, since: SINCE });
  if (!ids.length) {
    await c.end();
    return;
  }

  const kinds = await c.query(
    `
    SELECT ${kindExpr("p")} AS kind, count(*)::int AS n, count(DISTINCT p.vehicle_id)::int AS vehicles
    FROM photos p
    WHERE p.listing_id = ANY($1::int[])
      AND p.photo_group = 'exterior_3d'
    GROUP BY 1
    ORDER BY n DESC
    `,
    [ids],
  );

  const stpByVin = await c.query(
    `
    SELECT v.vin, count(*)::int AS n, min(left(p.source_url, 120)) AS sample
    FROM photos p
    JOIN vehicles v ON v.id = p.vehicle_id
    WHERE p.listing_id = ANY($1::int[])
      AND p.photo_group = 'exterior_3d'
      AND (p.source_url ILIKE '%~SID~STP~%' OR p.source_url ILIKE '%SID%7ESTP%')
    GROUP BY v.vin
    ORDER BY n ASC, v.vin
    `,
    [ids],
  );

  const known = await c.query(
    `
    SELECT v.vin, p.photo_group, ${kindExpr("p")} AS kind, count(*)::int AS n
    FROM vehicles v
    JOIN photos p ON p.vehicle_id = v.id
    WHERE v.vin IN (
      '3VWD17AJ9EM396350',
      '5NMSH73E37H070877',
      '5NPEC4AC3BH125075',
      '5XYZUDLB1EG141788'
    )
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
    `,
  );

  console.log(name, "recent360", kinds.rows);
  console.log(name, "recentStpVins", stpByVin.rows);
  console.log(name, "knownVins", known.rows);

  const shortStpVins = stpByVin.rows.filter((r) => r.n < 16).map((r) => r.vin);
  console.log(name, { shortStpVinCount: shortStpVins.length, keepLongStp: stpByVin.rows.filter((r) => r.n >= 16).length });

  if (APPLY && shortStpVins.length) {
    const del = await c.query(
      `
      DELETE FROM photos p
      USING vehicles v
      WHERE p.vehicle_id = v.id
        AND v.vin = ANY($1::text[])
        AND p.photo_group = 'exterior_3d'
        AND (p.source_url ILIKE '%~SID~STP~%' OR p.source_url ILIKE '%SID%7ESTP%')
      `,
      [shortStpVins],
    );
    console.log(name, { deletedShortStp: del.rowCount, vins: shortStpVins });
  } else if (!APPLY) {
    console.log(name, "dry-run — pass --apply to delete short STP on those VINs only");
  }

  await c.end();
}

if (!WANT_PROD) {
  await run("local", { connectionString: process.env.DATABASE_URL });
} else {
  await run("local", { connectionString: process.env.DATABASE_URL });
  await run("prod", { connectionString: prodUrl(), ssl: { rejectUnauthorized: false } });
}
