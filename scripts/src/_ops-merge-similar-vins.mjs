/**
 * Merge catalog-import duplicates into existing Encar cars when they share
 * an Encar lot or a 1-character VIN (typo) with the same make/model/year.
 * Local DB only.
 */
import fs from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host) || /rlwy\.net|railway\.(app|internal)/i.test(url)) {
  throw new Error(`Refusing merge — host ${host}`);
}

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 99;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const catalog = JSON.parse(
  fs.readFileSync(
    "c:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/attachments/f697aa6f-10bd-47bc-bc7a-59eb19217877/getcarapi-vin-catalog-2026-10-28.json",
    "utf8",
  ),
);
const lotByVin = new Map();
for (const l of catalog.listings) {
  const lot = String(l.sourceId || "").replace(/^catalog:/, "");
  if (/^\d+$/.test(lot)) lotByVin.set(l.vin, lot);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const catalogRows = (
  await c.query(`
    SELECT l.id AS listing_id, l.vin, l.vehicle_id, l.source_id, v.make, v.model, v.year
    FROM listings l
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE l.source_id LIKE 'catalog:%'
  `)
).rows;

const stats = { lotMerge: 0, vinMerge: 0, skipped: 0, errors: [] };

async function mergeVehicle(fromId, toId, fromListingId) {
  if (!fromId || !toId || fromId === toId) return;
  await c.query(`UPDATE photos SET vehicle_id = $1 WHERE vehicle_id = $2`, [toId, fromId]);
  await c.query(`UPDATE listings SET vehicle_id = $1, vin = COALESCE(vin, (SELECT vin FROM vehicles WHERE id = $1)) WHERE vehicle_id = $2`, [toId, fromId]);
  await c.query(`UPDATE vehicle_observations SET vehicle_id = $1 WHERE vehicle_id = $2`, [toId, fromId]);
  await c.query(
    `INSERT INTO vehicle_events (vehicle_id, event_type, description, metadata, occurred_at)
     SELECT $1, event_type, description, metadata, occurred_at
     FROM vehicle_events WHERE vehicle_id = $2
     ON CONFLICT DO NOTHING`,
    [toId, fromId],
  );
  await c.query(`DELETE FROM vehicle_events WHERE vehicle_id = $1`, [fromId]);
  await c.query(`DELETE FROM vehicle_observations WHERE vehicle_id = $1`, [fromId]);
  await c.query(`DELETE FROM photos WHERE vehicle_id = $1`, [fromId]);
  if (fromListingId) {
    await c.query(`DELETE FROM photos WHERE listing_id = $1`, [fromListingId]);
    await c.query(`DELETE FROM vehicle_observations WHERE listing_id = $1`, [fromListingId]);
    await c.query(`DELETE FROM listings WHERE id = $1`, [fromListingId]);
  }
  await c.query(`DELETE FROM vehicles WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM listings x WHERE x.vehicle_id = $1)`, [fromId]);
}

for (const row of catalogRows) {
  const lot = lotByVin.get(row.vin);
  let keeper = null;
  let reason = null;

  if (lot) {
    const hit = (
      await c.query(
        `
        SELECT l.id, l.vin, l.vehicle_id, v.make, v.model, v.year
        FROM listings l
        JOIN vehicles v ON v.id = l.vehicle_id
        JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar'
          AND l.source_id = $1
          AND l.id <> $2
        LIMIT 1
        `,
        [lot, row.listing_id],
      )
    ).rows[0];
    if (hit) {
      keeper = hit;
      reason = "lot";
    }
  }

  if (!keeper) {
    const near = (
      await c.query(
        `
        SELECT v.id AS vehicle_id, v.vin, v.make, v.model, v.year, l.id
        FROM vehicles v
        JOIN listings l ON l.vehicle_id = v.id
        WHERE v.id <> $1
          AND length(v.vin) = 17
          AND left(v.vin, 8) = left($2, 8)
          AND right(v.vin, 6) = right($2, 6)
        LIMIT 5
        `,
        [row.vehicle_id, row.vin],
      )
    ).rows;
    const typed = near.find((n) => {
      const d = hamming(String(n.vin), String(row.vin));
      return (
        d === 1 &&
        String(n.make || "").toLowerCase() === String(row.make || "").toLowerCase() &&
        String(n.model || "").toLowerCase() === String(row.model || "").toLowerCase()
      );
    });
    if (typed) {
      keeper = typed;
      reason = "vin";
    }
  }

  if (!keeper) {
    stats.skipped++;
    continue;
  }

  try {
    await c.query("BEGIN");
    await mergeVehicle(row.vehicle_id, keeper.vehicle_id, row.listing_id);
    await c.query("COMMIT");
    if (reason === "lot") stats.lotMerge++;
    else stats.vinMerge++;
  } catch (err) {
    await c.query("ROLLBACK");
    stats.errors.push(`${row.vin}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const leftover = (
  await c.query(`SELECT count(*)::int AS n FROM listings WHERE source_id LIKE 'catalog:%'`)
).rows[0];

console.log(JSON.stringify({ host, ...stats, leftoverCatalogListings: leftover.n }, null, 2));
await c.end();
