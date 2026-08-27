/**
 * Fill Encar listing/observation prices that the old dummy-ask heuristic dropped.
 * Idempotent: only writes when price_amount is currently null (or sold status changed).
 */
import crypto from "crypto";
import {
  extractEncarAdvertisementFields,
  normalizeEncarListedPrice,
  normalizeEncarListingActivity,
} from "../providers/encar-catalog";

interface SqlPool {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

const BATCH = 100;

export interface EncarPriceBackfillStats {
  scanned: number;
  listingsPriced: number;
  observationsPriced: number;
  soldMarked: number;
}

type ListingRow = {
  id: number;
  provider_id: number;
  source_id: string;
  listing_vin: string | null;
  mileage: number | null;
  price_amount: number | null;
  is_active: boolean;
  vehicle_vin: string | null;
  raw_json: string;
};

type ObservationRow = {
  id: number;
  source_listing_id: string | null;
  mileage: number | null;
  listing_status: string | null;
};

function fingerprint(
  vin: string,
  providerId: number,
  priceAmount?: number | null,
  mileage?: number | null,
  listingStatus?: string | null,
): string {
  const parts = [
    vin,
    String(providerId),
    String(priceAmount ?? ""),
    String(mileage ?? ""),
    listingStatus ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(parts).digest("hex");
}

function parseRaw(rawJson: string): {
  krw?: number;
  isActive: boolean;
  listingStatus: "active" | "sold" | "reserved" | "inactive";
} {
  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return { isActive: true, listingStatus: "active" };
  }
  const fields = extractEncarAdvertisementFields(payload);
  const listed = normalizeEncarListedPrice(fields.price);
  const activity = normalizeEncarListingActivity(fields.status);
  return {
    krw: listed.onRequest ? undefined : listed.krw,
    ...activity,
  };
}

export async function backfillEncarPricesFromRaw(pool: SqlPool): Promise<EncarPriceBackfillStats> {
  const stats: EncarPriceBackfillStats = {
    scanned: 0,
    listingsPriced: 0,
    observationsPriced: 0,
    soldMarked: 0,
  };

  let afterId = 0;
  for (;;) {
    const { rows } = (await pool.query(
      `SELECT
         l.id,
         l.provider_id,
         l.source_id,
         l.vin AS listing_vin,
         l.mileage,
         l.price_amount,
         l.is_active,
         v.vin AS vehicle_vin,
         r.raw_json
       FROM listings l
       JOIN providers p ON p.id = l.provider_id AND p.internal_name = 'encar'
       JOIN LATERAL (
         SELECT raw_json
         FROM raw_source_records
         WHERE listing_id = l.id
           AND raw_json IS NOT NULL
           AND length(raw_json) > 2
         ORDER BY collected_at DESC NULLS LAST, id DESC
         LIMIT 1
       ) r ON true
       LEFT JOIN vehicles v ON v.id = l.vehicle_id
       WHERE l.id > $1
         AND (
           l.price_amount IS NULL
           OR EXISTS (
             SELECT 1 FROM vehicle_observations vo
             WHERE vo.listing_id = l.id AND vo.price_amount IS NULL
           )
         )
       ORDER BY l.id
       LIMIT $2`,
      [afterId, BATCH],
    )) as { rows: ListingRow[] };

    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      afterId = row.id;
      const parsed = parseRaw(row.raw_json);
      const nextPrice = parsed.krw ?? row.price_amount;
      const nextActive = parsed.isActive;

      if (nextPrice != null && row.price_amount == null) {
        await pool.query(
          `UPDATE listings SET price_amount = $1, price_currency = COALESCE(price_currency, 'KRW'), updated_at = NOW()
           WHERE id = $2 AND price_amount IS NULL`,
          [nextPrice, row.id],
        );
        stats.listingsPriced += 1;
      }

      if (row.is_active !== nextActive) {
        await pool.query(`UPDATE listings SET is_active = $1, updated_at = NOW() WHERE id = $2`, [
          nextActive,
          row.id,
        ]);
        if (!nextActive) stats.soldMarked += 1;
      }

      if (nextPrice == null) continue;

      const { rows: observations } = (await pool.query(
        `SELECT id, source_listing_id, mileage, listing_status
         FROM vehicle_observations
         WHERE listing_id = $1 AND price_amount IS NULL`,
        [row.id],
      )) as { rows: ObservationRow[] };

      const vin = row.vehicle_vin ?? row.listing_vin;
      for (const obs of observations) {
        const listingStatus = parsed.listingStatus !== "active"
          ? parsed.listingStatus
          : (obs.listing_status ?? "active");
        const nextHash = vin
          ? fingerprint(vin, row.provider_id, nextPrice, obs.mileage ?? row.mileage, listingStatus)
          : null;

        try {
          await pool.query(
            `UPDATE vehicle_observations
             SET price_amount = $1,
                 price_currency = COALESCE(price_currency, 'KRW'),
                 listing_status = $2,
                 fingerprint_hash = COALESCE($3, fingerprint_hash)
             WHERE id = $4 AND price_amount IS NULL`,
            [nextPrice, listingStatus, nextHash, obs.id],
          );
          stats.observationsPriced += 1;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code !== "23505") throw err;
          await pool.query(
            `UPDATE vehicle_observations
             SET price_amount = $1,
                 price_currency = COALESCE(price_currency, 'KRW'),
                 listing_status = $2
             WHERE id = $3 AND price_amount IS NULL`,
            [nextPrice, listingStatus, obs.id],
          );
          stats.observationsPriced += 1;
        }
      }
    }
  }

  return stats;
}
