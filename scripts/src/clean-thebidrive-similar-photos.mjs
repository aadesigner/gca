/**
 * Ops: drop TheBidrive "Similar" CDN thumbs (other IC/CI folders) from prod photos.
 * Keep majority catalog IC (+ any CI) per vehicle.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/clean-thebidrive-similar-photos.mjs
 */
import pg from "pg";

function keysFromUrl(u) {
  const keys = [];
  const ic = u.match(/\/catalog\/(IC\d+)\//i)?.[1];
  if (ic) keys.push(`ic:${ic.toUpperCase()}`);
  const ci = u.match(/\/car\/(CI\d+)\//i)?.[1];
  if (ci) keys.push(`ci:${ci.toUpperCase()}`);
  const encar = u.match(/ci\.encar\.com\/carpicture\/[^/]+\/(pic\d+)\/(\d+)_/i);
  if (encar) keys.push(`encar:${encar[1].toLowerCase()}/${encar[2]}`);
  const lot = u.match(/cdn\.thebidrive\.com\/(?:lots?|auctions?)\/([a-f0-9-]{36})\//i);
  if (lot) keys.push(`lot:${lot[1].toLowerCase()}`);
  const bd = u.match(/cdn\.thebidrive\.com\/(encar|copart|iaa|iaai|carpages)\/(\d{4,})\//i);
  if (bd) keys.push(`bd:${bd[1].toLowerCase()}:${bd[2]}`);
  const iaaiKeys = u.match(/[?&]imageKeys=([^&]+)/i)?.[1];
  if (iaaiKeys && /vis\.iaai\.com/i.test(u)) {
    const stock = decodeURIComponent(iaaiKeys).split("~")[0]?.trim();
    if (stock) keys.push(`iaai:${stock.toLowerCase()}`);
  }
  return keys;
}

const c = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT),
  user: process.env.PROD_PG_USER,
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE,
  ssl: false,
  connectionTimeoutMillis: 60000,
});
await c.connect();

const multi = await c.query(`
  WITH keys AS (
    SELECT l.vehicle_id, v.vin,
      array_agg(DISTINCT upper((regexp_match(ph.source_url, '/catalog/(IC\\d+)/', 'i'))[1]))
        FILTER (WHERE ph.source_url ~* '/catalog/(IC\\d+)/') AS ics
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    JOIN photos ph ON ph.vehicle_id = l.vehicle_id
    WHERE p.internal_name = 'thebidrive'
    GROUP BY l.vehicle_id, v.vin
  )
  SELECT vehicle_id, vin, ics FROM keys WHERE coalesce(cardinality(ics),0) > 1
`);
console.log("multi-IC vehicles", multi.rows.length);

let deleted = 0;
for (const row of multi.rows) {
  const photos = await c.query(
    `SELECT id, source_url, stored_path FROM photos WHERE vehicle_id=$1 ORDER BY sort_order ASC NULLS LAST, id`,
    [row.vehicle_id],
  );
  const counts = new Map();
  for (const p of photos.rows) {
    const ic = keysFromUrl(p.source_url || p.stored_path || "").find((k) => k.startsWith("ic:"));
    if (ic) counts.set(ic, (counts.get(ic) || 0) + 1);
  }
  let best = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  const allowed = new Set();
  if (best) allowed.add(best);
  for (const p of photos.rows) {
    for (const k of keysFromUrl(p.source_url || p.stored_path || "")) {
      if (k.startsWith("ci:") || k.startsWith("lot:")) allowed.add(k);
    }
  }
  // Majority-vote numeric BidDrive / Encar / IAAI scopes (same idea as IC).
  for (const prefix of ["bd:", "encar:", "iaai:"]) {
    const counts = new Map();
    for (const p of photos.rows) {
      for (const k of keysFromUrl(p.source_url || p.stored_path || "")) {
        if (k.startsWith(prefix)) counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    let bestK = null;
    let bestN = -1;
    for (const [k, n] of counts) {
      if (n > bestN) {
        bestK = k;
        bestN = n;
      }
    }
    if (bestK) allowed.add(bestK);
  }
  const drop = [];
  for (const p of photos.rows) {
    const ks = keysFromUrl(p.source_url || p.stored_path || "");
    if (!ks.length) continue;
    if (!ks.some((k) => allowed.has(k))) drop.push(p.id);
  }
  if (!drop.length) continue;
  const res = await c.query(`DELETE FROM photos WHERE id = ANY($1::int[])`, [drop]);
  deleted += res.rowCount || 0;
  await c.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC NULLS LAST, id ASC) AS rn
       FROM photos WHERE vehicle_id=$1
     )
     UPDATE photos ph SET is_primary = (ranked.rn = 1)
     FROM ranked WHERE ph.id = ranked.id`,
    [row.vehicle_id],
  );
}

const left = await c.query(`
  WITH keys AS (
    SELECT l.vehicle_id,
      cardinality(array_agg(DISTINCT upper((regexp_match(ph.source_url, '/catalog/(IC\\d+)/', 'i'))[1]))
        FILTER (WHERE ph.source_url ~* '/catalog/(IC\\d+)/')) AS ic_n
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN photos ph ON ph.vehicle_id = l.vehicle_id
    WHERE p.internal_name = 'thebidrive'
    GROUP BY l.vehicle_id
  )
  SELECT count(*) FILTER (WHERE ic_n > 1)::int AS multi_ic FROM keys
`);
console.log({ deleted, multi_ic_left: left.rows[0]?.multi_ic });
await c.end();
