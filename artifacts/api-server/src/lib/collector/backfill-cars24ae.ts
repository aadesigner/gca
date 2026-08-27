/**
 * Fix Cars24.ae make/model/price/photos from stored raw HTML.
 */
import {
  collectCars24Photos,
  extractCars24Content,
  parseCars24Listing,
} from "../providers/cars24ae";

interface SqlPool {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface Cars24BackfillStats {
  scanned: number;
  listingsUpdated: number;
  vehiclesUpdated: number;
  photosReplaced: number;
  skipped: number;
}

const BATCH = 40;
const MAX_PHOTOS = 40;

export async function backfillCars24FromRaw(pool: SqlPool): Promise<Cars24BackfillStats> {
  const stats: Cars24BackfillStats = {
    scanned: 0,
    listingsUpdated: 0,
    vehiclesUpdated: 0,
    photosReplaced: 0,
    skipped: 0,
  };

  const { rows: providers } = await pool.query(
    `SELECT id FROM providers WHERE internal_name = 'cars24ae' LIMIT 1`,
  );
  const providerId = (providers[0] as { id: number } | undefined)?.id;
  if (!providerId) return stats;

  let lastId = 0;
  for (;;) {
    const { rows } = await pool.query(
      `
      SELECT r.id, r.source_id, r.listing_id, r.raw_html
      FROM (
        SELECT DISTINCT ON (source_id)
          id, source_id, listing_id, raw_html
        FROM raw_source_records
        WHERE provider_id = $1
          AND raw_html IS NOT NULL
          AND length(raw_html) > 1000
        ORDER BY source_id, id DESC
      ) r
      WHERE r.id > $2
      ORDER BY r.id
      LIMIT $3
      `,
      [providerId, lastId, BATCH],
    );
    if (!rows.length) break;

    for (const row of rows as Array<{
      id: number;
      source_id: string;
      listing_id: number | null;
      raw_html: string;
    }>) {
      lastId = row.id;
      stats.scanned++;

      const content = extractCars24Content(row.raw_html);
      if (!content?.make && content?.price == null) {
        stats.skipped++;
        continue;
      }

      const parsed = parseCars24Listing({
        url: `https://www.cars24.ae/${row.source_id}`,
        html: row.raw_html,
        statusCode: 200,
        headers: {},
      });

      let listingId = row.listing_id;
      let vehicleId: number | null = null;
      if (listingId != null) {
        const listingRow = await pool.query(
          `SELECT id, vehicle_id FROM listings WHERE id = $1`,
          [listingId],
        );
        vehicleId =
          (listingRow.rows[0] as { vehicle_id: number | null } | undefined)?.vehicle_id ?? null;
      } else {
        const found = await pool.query(
          `SELECT id, vehicle_id FROM listings WHERE provider_id = $1 AND source_id = $2 LIMIT 1`,
          [providerId, row.source_id],
        );
        listingId = (found.rows[0] as { id: number } | undefined)?.id ?? null;
        vehicleId =
          (found.rows[0] as { vehicle_id: number | null } | undefined)?.vehicle_id ?? null;
      }
      if (listingId == null) {
        stats.skipped++;
        continue;
      }

      await pool.query(
        `
        UPDATE listings
        SET title = COALESCE($1, title),
            price_amount = COALESCE($2, price_amount),
            price_currency = 'AED',
            mileage = COALESCE($3, mileage),
            mileage_unit = 'km',
            location = COALESCE($4, location),
            country = COALESCE($5, country),
            is_active = COALESCE($6, is_active),
            first_seen_at = CASE
              WHEN $7::timestamptz IS NOT NULL THEN LEAST(first_seen_at, $7::timestamptz)
              ELSE first_seen_at
            END,
            last_seen_at = CASE
              WHEN $7::timestamptz IS NOT NULL THEN $7::timestamptz
              ELSE last_seen_at
            END
        WHERE id = $8
        `,
        [
          parsed.title ?? null,
          parsed.priceAmount ?? null,
          parsed.mileage ?? null,
          parsed.location ?? null,
          parsed.country ?? null,
          parsed.isActive ?? true,
          parsed.sourceListedAt ?? null,
          listingId,
        ],
      );
      stats.listingsUpdated++;

      if (vehicleId != null && parsed.vehicle) {
        await pool.query(
          `
          UPDATE vehicles
          SET make = COALESCE($1, make),
              model = COALESCE($2, model),
              trim = COALESCE($3, trim),
              year = COALESCE($4, year),
              fuel_type = COALESCE($5, fuel_type),
              transmission = COALESCE($6, transmission),
              body_type = COALESCE($7, body_type),
              drive_type = COALESCE($8, drive_type),
              engine_displacement = COALESCE($9, engine_displacement),
              color = COALESCE($10, color),
              country = COALESCE($11, country),
              current_known_mileage = CASE
                WHEN $12::int IS NOT NULL AND (current_known_mileage IS NULL OR $12::int > current_known_mileage)
                  THEN $12::int
                ELSE current_known_mileage
              END
          WHERE id = $13
          `,
          [
            parsed.vehicle.make ?? null,
            parsed.vehicle.model ?? null,
            parsed.vehicle.trim ?? null,
            parsed.vehicle.year ?? null,
            parsed.vehicle.fuelType ?? null,
            parsed.vehicle.transmission ?? null,
            parsed.vehicle.bodyType ?? null,
            parsed.vehicle.driveType ?? null,
            parsed.vehicle.engineDisplacement ?? null,
            parsed.vehicle.color ?? null,
            parsed.vehicle.country ?? null,
            parsed.mileage ?? null,
            vehicleId,
          ],
        );
        stats.vehiclesUpdated++;
      }

      await pool.query(
        `
        UPDATE vehicle_observations
        SET price_amount = COALESCE($1, price_amount),
            price_currency = 'AED',
            mileage = COALESCE($2, mileage),
            source_listed_at = COALESCE(source_listed_at, $3::timestamptz),
            source_updated_at = COALESCE(source_updated_at, $3::timestamptz),
            observed_at = CASE
              WHEN $3::timestamptz IS NOT NULL AND $3::timestamptz < observed_at - interval '1 day'
                THEN $3::timestamptz
              ELSE observed_at
            END
        WHERE listing_id = $4 OR (provider_id = $5 AND source_listing_id = $6)
        `,
        [
          parsed.priceAmount ?? null,
          parsed.mileage ?? null,
          parsed.sourceListedAt ?? null,
          listingId,
          providerId,
          row.source_id,
        ],
      );

      if (vehicleId != null) {
        const photos = collectCars24Photos(content);
        if (photos.length) {
          await pool.query(`DELETE FROM photos WHERE listing_id = $1`, [listingId]);
          await pool.query(
            `
            DELETE FROM photos
            WHERE vehicle_id = $1
              AND (
                source_url ILIKE '%/production/consumer-web%'
                OR source_url ILIKE '%/icon/%'
                OR source_url ILIKE '%.svg%'
                OR source_url ILIKE '%.gif%'
              )
            `,
            [vehicleId],
          );

          const haveRes = await pool.query(
            `SELECT count(*)::int AS c FROM photos WHERE vehicle_id = $1`,
            [vehicleId],
          );
          let have = (haveRes.rows[0] as { c: number }).c;
          let sort = 0;
          for (const photo of photos) {
            if (have >= MAX_PHOTOS) break;
            const ins = await pool.query(
              `
              INSERT INTO photos (vehicle_id, listing_id, source_url, is_primary, sort_order)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT DO NOTHING
              RETURNING id
              `,
              [vehicleId, listingId, photo.sourceUrl, have === 0 && sort === 0, sort],
            );
            if ((ins.rowCount ?? 0) > 0) {
              have++;
              sort++;
              stats.photosReplaced++;
            }
          }
        }
      }
    }

    console.log(`… cars24 scanned ${stats.scanned}`);
  }

  return stats;
}
