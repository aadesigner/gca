import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const finn = await c.query(`
  SELECT id, status, items_discovered, items_processed, items_failed, vins_new,
         round(extract(epoch from (NOW()-updated_at))/60)::int quiet_m, updated_at
  FROM collection_jobs WHERE id=491 OR (provider_id=(SELECT id FROM providers WHERE internal_name='finn') AND status IN ('running','pending'))
  ORDER BY updated_at DESC LIMIT 3
`);
console.log("finn", finn.rows);

const growth = await c.query(`
  SELECT p.internal_name,
    count(*) FILTER (WHERE l.first_seen_at > NOW()-interval '30 minutes')::int new_30m,
    count(*) FILTER (WHERE l.last_seen_at > NOW()-interval '30 minutes')::int seen_30m
  FROM providers p LEFT JOIN listings l ON l.provider_id=p.id
  WHERE p.internal_name = ANY($1::text[]) GROUP BY 1 ORDER BY 1
`, [["finn","seobuk","koreaauto_auction"]]);
console.log("growth30m", growth.rows);

const vins = ["WP0AB2A92TS227786","WP1AB2A53HLB11672","JTHD51FF7L5012169","3C4NJCBB3LT170041"];
const photo = await c.query(`
  SELECT v.vin,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int
  FROM vehicles v LEFT JOIN photos p ON p.vehicle_id=v.id
  WHERE v.vin = ANY($1::text[]) GROUP BY v.vin ORDER BY v.vin
`, [vins]);
console.log("photoSpot", photo.rows);

// Any NEW bad mixes created in last 2h?
const recentBad = await c.query(`
  SELECT count(*)::int frames, count(DISTINCT p.vehicle_id)::int vehicles
  FROM photos p
  JOIN listings l ON l.id=p.listing_id
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND p.created_at > NOW()-interval '2 hours'
    AND (p.source_url ILIKE '%vis.iaai.com%' OR p.source_url ILIKE '%mediaretriever.iaai.com%')
    AND EXISTS (
      SELECT 1 FROM photos g WHERE g.listing_id=l.id AND g.photo_group='gallery'
        AND (g.source_url ILIKE '%/copart/%' OR g.source_url ILIKE '%cs.copart%')
    )
    AND NOT EXISTS (
      SELECT 1 FROM photos g2 WHERE g2.listing_id=l.id AND g2.photo_group='gallery'
        AND (g2.source_url ILIKE '%/iaai/%' OR g2.source_url ILIKE '%vis.iaai%' OR g2.source_url ILIKE '%mediaretriever.iaai%')
    )
`);
console.log("newBadMixLast2h", recentBad.rows[0]);

const running = await c.query(`SELECT count(*) FILTER (WHERE status='running')::int running, count(*) FILTER (WHERE status='pending')::int pending FROM collection_jobs WHERE status IN ('running','pending')`);
console.log("fleet", running.rows[0]);
await c.end();
