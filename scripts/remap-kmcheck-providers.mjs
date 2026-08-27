/**
 * Remap kmcheck / carstat / kmcheck_manual listings → encar | copart | iaa | autowini | getcarapi
 * based on source_url + vehicle_events signals.
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function infer(blob, sourceUrl) {
  const s = `${sourceUrl || ""}\n${blob || ""}`.toLowerCase();
  if (/copart\.com|cs\.copart|\bcopart\b/.test(s)) return "copart";
  if (/iaai\.com|vis\.iaai|mediaretriever\.iaai|\biaai\b/.test(s)) return "iaa";
  if (/encar\.com|ci\.encar|fem\.encar|\bencar\b/.test(s)) return "encar";
  if (/autowini\.com|\bautowini\b/.test(s)) return "autowini";
  if (
    /"country"\s*:\s*"kr"|south korea|₩|\bkrw\b/.test(s) &&
    /(daejeon|seoul|busan|incheon|gwangju|ulsan|suwon|finalprice|auction)/.test(s)
  ) {
    return "encar";
  }
  return "getcarapi";
}

const NAMES = {
  encar: "Encar",
  copart: "Copart",
  iaa: "IAA",
  autowini: "Autowini",
  getcarapi: "GetCarAPI",
};

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // Ensure target providers exist
  for (const [internal, name] of Object.entries(NAMES)) {
    await client.query(
      `INSERT INTO providers (name, internal_name, type, country, enabled, notes)
       VALUES ($1, $2, 'classifieds', 'Unknown', true, 'Catalog remap target')
       ON CONFLICT (internal_name) DO NOTHING`,
      [name, internal],
    );
  }

  const { rows: idRows } = await client.query(
    `SELECT internal_name, id FROM providers WHERE internal_name = ANY($1::text[])`,
    [Object.keys(NAMES)],
  );
  const ids = Object.fromEntries(idRows.map((r) => [r.internal_name, r.id]));

  const { rows } = await client.query(`
    SELECT l.id AS listing_id, l.vehicle_id, l.source_url, p.internal_name AS from_provider,
           coalesce((
             SELECT string_agg(coalesce(e.description,'') || ' ' || coalesce(e.metadata::text,''), ' ')
             FROM vehicle_events e WHERE e.vehicle_id = l.vehicle_id
           ), '') AS blob
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name IN ('kmcheck', 'kmcheck_manual', 'carstat')
  `);

  const tallies = {};
  let updatedListings = 0;
  let updatedObs = 0;

  for (const r of rows) {
    const to = infer(r.blob, r.source_url);
    tallies[to] = (tallies[to] || 0) + 1;
    const providerId = ids[to];
    if (!providerId) throw new Error(`missing provider ${to}`);

    const u = await client.query(
      `UPDATE listings SET provider_id = $1 WHERE id = $2 AND provider_id IS DISTINCT FROM $1`,
      [providerId, r.listing_id],
    );
    updatedListings += u.rowCount || 0;

    const o = await client.query(
      `UPDATE vehicle_observations SET provider_id = $1
       WHERE listing_id = $2 AND provider_id IS DISTINCT FROM $1`,
      [providerId, r.listing_id],
    );
    updatedObs += o.rowCount || 0;
  }

  // Disable leftover catalog-only providers if they have no listings left
  const disabled = await client.query(`
    UPDATE providers p
    SET enabled = false,
        notes = coalesce(notes, '') || ' [disabled: remapped catalog provider]'
    WHERE p.internal_name IN ('kmcheck', 'kmcheck_manual', 'carstat')
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.provider_id = p.id)
    RETURNING internal_name
  `);

  await client.query("COMMIT");

  const sample = await pool.query(
    `SELECT p.internal_name, p.name, l.source_id
     FROM vehicles v
     JOIN listings l ON l.vehicle_id = v.id
     JOIN providers p ON p.id = l.provider_id
     WHERE v.vin = 'KMHJC81CBMU007695'`,
  );

  console.log(
    JSON.stringify(
      {
        scanned: rows.length,
        tallies,
        updatedListings,
        updatedObs,
        disabled: disabled.rows.map((r) => r.internal_name),
        sampleVin: sample.rows,
      },
      null,
      2,
    ),
  );
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
