/**
 * Ops: drop BidExport/TheBidrive junk photos that are bare IAAI resizer URLs
 * (missing ?imageKeys=) — these are not real car images.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/clean-bare-iaai-resizer-photos.mjs
 */
import pg from "pg";

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

const junk = await c.query(`
  SELECT ph.id, ph.vehicle_id, ph.source_url, p.internal_name
  FROM photos ph
  JOIN listings l ON l.vehicle_id = ph.vehicle_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name IN ('bidexport', 'thebidrive')
    AND ph.source_url ~* 'vis\\.iaai\\.com/resizer'
    AND ph.source_url !~* '[?&]imageKeys='
`);
console.log("bare iaai resizer photos", junk.rows.length);

const byVehicle = new Map();
for (const row of junk.rows) {
  if (!byVehicle.has(row.vehicle_id)) byVehicle.set(row.vehicle_id, []);
  byVehicle.get(row.vehicle_id).push(row.id);
}

let deleted = 0;
for (const [vehicleId, ids] of byVehicle) {
  const res = await c.query(`DELETE FROM photos WHERE id = ANY($1::int[])`, [ids]);
  deleted += res.rowCount || 0;
  await c.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC NULLS LAST, id ASC) AS rn
       FROM photos WHERE vehicle_id=$1
     )
     UPDATE photos ph SET is_primary = (ranked.rn = 1)
     FROM ranked WHERE ph.id = ranked.id`,
    [vehicleId],
  );
}

const left = await c.query(`
  SELECT count(*)::int AS n
  FROM photos ph
  JOIN listings l ON l.vehicle_id = ph.vehicle_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name IN ('bidexport', 'thebidrive')
    AND ph.source_url ~* 'vis\\.iaai\\.com/resizer'
    AND ph.source_url !~* '[?&]imageKeys='
`);
console.log({ deleted, bare_left: left.rows[0]?.n });
await c.end();
