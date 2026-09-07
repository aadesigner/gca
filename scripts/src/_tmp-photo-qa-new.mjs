import pg from "pg";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT),
  user: process.env.PROD_PG_USER,
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE,
  ssl: false,
  connectionTimeoutMillis: 25000,
});
await c.connect();

const providers = ["thebidrive", "bidexport", "autoplac", "willhaben", "ontariocars", "carpages"];

for (const name of providers) {
  const samples = await c.query(
    `SELECT l.source_id, l.source_url, v.vin, left(l.title,50) AS title,
            (SELECT count(*)::int FROM photos p WHERE p.vehicle_id=l.vehicle_id) AS n,
            (SELECT array_agg(left(coalesce(p.source_url,p.stored_path),120) ORDER BY p.sort_order, p.id)
               FROM (SELECT * FROM photos p WHERE p.vehicle_id=l.vehicle_id ORDER BY sort_order, id LIMIT 8) p) AS urls
     FROM listings l
     JOIN providers pr ON pr.id=l.provider_id
     JOIN vehicles v ON v.id=l.vehicle_id
     WHERE pr.internal_name=$1
     ORDER BY l.created_at DESC NULLS LAST
     LIMIT 4`,
    [name],
  );
  console.log(`\n=== ${name} n=${samples.rows.length} ===`);
  for (const r of samples.rows) {
    console.log(JSON.stringify({ vin: r.vin, title: r.title, n: r.n, source_id: r.source_id }));
    for (const u of r.urls || []) console.log(" ", u);
  }

  // Host diversity for thebidrive / others
  const hosts = await c.query(
    `SELECT
       count(ph.id)::int AS photos,
       count(DISTINCT l.id)::int AS listings,
       count(ph.id) FILTER (WHERE coalesce(ph.source_url,ph.stored_path,'') ~* 'logo|icon|sprite|avatar|favicon|placeholder|blank')::int AS junkish,
       count(ph.id) FILTER (WHERE coalesce(ph.source_url,ph.stored_path,'') ~* '\\.(svg)(\\?|$)')::int AS svg
     FROM listings l
     JOIN providers p ON p.id=l.provider_id
     JOIN photos ph ON ph.vehicle_id=l.vehicle_id
     WHERE p.internal_name=$1`,
    [name],
  );
  console.log("stats", hosts.rows[0]);
}

await c.end();
