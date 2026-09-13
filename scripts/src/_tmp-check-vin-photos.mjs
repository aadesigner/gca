await import("../load-env.mjs");
import pg from "pg";

const vin = (process.argv[2] || "2C3CDZBT0MH536241").toUpperCase();
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const v = await c.query(
  `select id, vin, make, model, year from vehicles where upper(vin)=$1`,
  [vin],
);
console.log("vehicle", v.rows);
if (!v.rows[0]) {
  await c.end();
  process.exit(0);
}
const vid = v.rows[0].id;

const listings = await c.query(
  `select l.id, p.internal_name, l.source_id, left(coalesce(l.source_url,''),120) src,
    (select count(*)::int from photos ph where ph.listing_id=l.id) n
   from listings l
   join providers p on p.id=l.provider_id
   where l.vehicle_id=$1
   order by l.id`,
  [vid],
);
console.log("listings", listings.rows);

const photos = await c.query(
  `select ph.id, ph.listing_id, ph.sort_order, left(ph.source_url,160) src,
    left(coalesce(ph.stored_path,''),70) stored
   from photos ph
   where ph.vehicle_id=$1
      or ph.listing_id in (select id from listings where vehicle_id=$1)
   order by coalesce(ph.sort_order,9999), ph.id`,
  [vid],
);
console.log("photo_count", photos.rows.length);
const hosts = {};
for (const r of photos.rows) {
  let host = "?";
  try {
    host = new URL(r.src).host;
  } catch {}
  hosts[host] = (hosts[host] || 0) + 1;
  console.log(r.sort_order, r.listing_id, r.src);
}
console.log("by_host", hosts);
await c.end();
