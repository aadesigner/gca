/**
 * Fast SQL backfill of site publish / last-updated dates onto listings + observations.
 * Uses stored raw JSON and source-id patterns (Kolon PT…, Auctionauto ObjectId).
 */
interface SqlPool {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface SourceDateBackfillStats {
  listingsUpdated: number;
  observationsUpdated: number;
  steps: Record<string, number>;
}

async function run(pool: SqlPool, label: string, sql: string, stats: SourceDateBackfillStats): Promise<void> {
  console.log(`→ ${label}…`);
  const res = await pool.query(sql);
  const n = res.rowCount ?? 0;
  stats.steps[label] = n;
  console.log(`  ${label}: ${n} rows`);
}

export async function backfillSourceDatesFromRaw(pool: SqlPool): Promise<SourceDateBackfillStats> {
  const stats: SourceDateBackfillStats = {
    listingsUpdated: 0,
    observationsUpdated: 0,
    steps: {},
  };

  // Latest raw JSON per provider+source (materialize once).
  await pool.query(`DROP TABLE IF EXISTS _src_dates_tmp`);
  await pool.query(`
    CREATE TEMP TABLE _src_dates_tmp AS
    SELECT DISTINCT ON (r.provider_id, r.source_id)
      r.provider_id,
      r.source_id,
      r.listing_id,
      p.internal_name,
      r.raw_json
    FROM raw_source_records r
    JOIN providers p ON p.id = r.provider_id
    WHERE p.internal_name IN (
      'encar', 'autowini', 'lotte_autoglobal', 'kolon_auto',
      'auctionauto', 'auctionwini', 'salvagebid'
    )
      AND r.raw_json IS NOT NULL
      AND length(r.raw_json) > 2
    ORDER BY r.provider_id, r.source_id, r.id DESC
  `);
  await pool.query(`CREATE INDEX ON _src_dates_tmp (provider_id, source_id)`);
  await pool.query(`CREATE INDEX ON _src_dates_tmp (listing_id)`);

  // Parsed site dates.
  await pool.query(`DROP TABLE IF EXISTS _src_dates_parsed`);
  await pool.query(`
    CREATE TEMP TABLE _src_dates_parsed AS
    SELECT
      t.provider_id,
      t.source_id,
      t.listing_id,
      t.internal_name,
      CASE t.internal_name
        WHEN 'encar' THEN COALESCE(
          NULLIF(t.raw_json::json->'detail'->'manage'->>'firstAdvertisedDateTime', '')::timestamptz,
          NULLIF(t.raw_json::json->'detail'->'manage'->>'registDateTime', '')::timestamptz,
          NULLIF(t.raw_json::json->'meta'->>'sourceModifiedAt', '')::timestamptz
        )
        WHEN 'autowini' THEN (
          SELECT make_timestamptz(
            substring(code from 3 for 4)::int,
            substring(code from 7 for 2)::int,
            substring(code from 9 for 2)::int,
            0, 0, 0, 'UTC'
          )
          FROM (
            SELECT COALESCE(
              t.raw_json::json->'detail'->>'itemCode',
              t.raw_json::json->'search'->>'code',
              t.raw_json::json->'search'->>'itemCode'
            ) AS code
          ) s
          WHERE code ~* '^CI[0-9]{8}'
        )
        WHEN 'auctionwini' THEN (
          SELECT make_timestamptz(
            substring(code from 3 for 4)::int,
            substring(code from 7 for 2)::int,
            substring(code from 9 for 2)::int,
            0, 0, 0, 'UTC'
          )
          FROM (
            SELECT COALESCE(
              t.raw_json::json->'detail'->>'itemCode',
              t.raw_json::json->>'itemCode',
              t.source_id
            ) AS code
          ) s
          WHERE code ~* '^CI[0-9]{8}'
        )
        WHEN 'lotte_autoglobal' THEN (
          SELECT make_timestamptz(
            substring(ymd from 1 for 4)::int,
            substring(ymd from 5 for 2)::int,
            substring(ymd from 7 for 2)::int,
            0, 0, 0, 'UTC'
          )
          FROM (
            SELECT COALESCE(
              t.raw_json::json->'data'->>'gdRegDe',
              t.raw_json::json->>'gdRegDe',
              t.raw_json::json->'data'->>'dpStartDe',
              t.raw_json::json->>'dpStartDe'
            ) AS ymd
          ) s
          WHERE ymd ~ '^[0-9]{8}$'
        )
        WHEN 'kolon_auto' THEN (
          SELECT make_timestamptz(
            CASE WHEN yy >= 70 THEN 1900 + yy ELSE 2000 + yy END,
            mm, dd, 0, 0, 0, 'UTC'
          )
          FROM (
            SELECT
              substring(t.source_id from 3 for 2)::int AS yy,
              substring(t.source_id from 5 for 2)::int AS mm,
              substring(t.source_id from 7 for 2)::int AS dd
          ) s
          WHERE t.source_id ~* '^PT[0-9]{6}'
        )
        WHEN 'auctionauto' THEN COALESCE(
          to_timestamp((('x' || substring(t.source_id from 1 for 8))::bit(32)::bigint))::timestamptz,
          (
            SELECT make_timestamptz(
              substring(m[1] from 1 for 4)::int,
              substring(m[1] from 5 for 2)::int,
              substring(m[1] from 7 for 2)::int,
              0, 0, 0, 'UTC'
            )
            FROM regexp_match(t.raw_json, 'CI([0-9]{8})', 'i') AS m
            WHERE m IS NOT NULL
          )
        )
        WHEN 'salvagebid' THEN COALESCE(
          NULLIF(t.raw_json::json->>'createdAt', '')::timestamptz,
          NULLIF(t.raw_json::json->>'listedAt', '')::timestamptz,
          NULLIF(t.raw_json::json->>'updatedAt', '')::timestamptz
        )
        ELSE NULL
      END AS listed_at,
      CASE t.internal_name
        WHEN 'encar' THEN COALESCE(
          NULLIF(t.raw_json::json->'detail'->'manage'->>'modifyDateTime', '')::timestamptz,
          NULLIF(t.raw_json::json->'meta'->>'sourceModifiedAt', '')::timestamptz,
          NULLIF(t.raw_json::json->'detail'->'manage'->>'firstAdvertisedDateTime', '')::timestamptz,
          NULLIF(t.raw_json::json->'detail'->'manage'->>'registDateTime', '')::timestamptz
        )
        WHEN 'lotte_autoglobal' THEN (
          SELECT make_timestamptz(
            substring(ymd from 1 for 4)::int,
            substring(ymd from 5 for 2)::int,
            substring(ymd from 7 for 2)::int,
            0, 0, 0, 'UTC'
          )
          FROM (
            SELECT COALESCE(
              t.raw_json::json->'data'->>'dpStartDe',
              t.raw_json::json->>'dpStartDe',
              t.raw_json::json->'data'->>'gdRegDe',
              t.raw_json::json->>'gdRegDe'
            ) AS ymd
          ) s
          WHERE ymd ~ '^[0-9]{8}$'
        )
        ELSE NULL
      END AS updated_at
    FROM _src_dates_tmp t
  `);

  // Fill updated_at from listed_at when missing.
  await pool.query(`
    UPDATE _src_dates_parsed
    SET updated_at = listed_at
    WHERE updated_at IS NULL AND listed_at IS NOT NULL
  `);
  await pool.query(`
    UPDATE _src_dates_parsed
    SET listed_at = updated_at
    WHERE listed_at IS NULL AND updated_at IS NOT NULL
  `);
  await pool.query(`DELETE FROM _src_dates_parsed WHERE listed_at IS NULL AND updated_at IS NULL`);
  await pool.query(`CREATE INDEX ON _src_dates_parsed (provider_id, source_id)`);
  await pool.query(`CREATE INDEX ON _src_dates_parsed (listing_id)`);

  // Resolve listing_id when missing.
  await pool.query(`
    UPDATE _src_dates_parsed p
    SET listing_id = l.id
    FROM listings l
    WHERE p.listing_id IS NULL
      AND l.provider_id = p.provider_id
      AND l.source_id = p.source_id
  `);

  await run(
    pool,
    "listings from raw",
    `
    UPDATE listings l
    SET
      first_seen_at = LEAST(l.first_seen_at, p.listed_at),
      last_seen_at = COALESCE(p.updated_at, p.listed_at)
    FROM _src_dates_parsed p
    WHERE l.id = p.listing_id
      AND p.listed_at IS NOT NULL
      AND (
        l.first_seen_at > p.listed_at
        OR l.last_seen_at IS DISTINCT FROM COALESCE(p.updated_at, p.listed_at)
      )
    `,
    stats,
  );
  stats.listingsUpdated += stats.steps["listings from raw"] ?? 0;

  await run(
    pool,
    "observations from raw by listing_id",
    `
    UPDATE vehicle_observations o
    SET
      source_listed_at = CASE
        WHEN o.source_listed_at IS NULL THEN p.listed_at
        WHEN p.listed_at < o.source_listed_at THEN p.listed_at
        ELSE o.source_listed_at
      END,
      source_updated_at = CASE
        WHEN o.source_updated_at IS NULL THEN COALESCE(p.updated_at, p.listed_at)
        WHEN COALESCE(p.updated_at, p.listed_at) > o.source_updated_at
          THEN COALESCE(p.updated_at, p.listed_at)
        ELSE o.source_updated_at
      END,
      observed_at = CASE
        WHEN p.listed_at < o.observed_at - interval '1 day' THEN p.listed_at
        ELSE o.observed_at
      END
    FROM _src_dates_parsed p
    WHERE p.listing_id IS NOT NULL
      AND o.listing_id = p.listing_id
      AND p.listed_at IS NOT NULL
    `,
    stats,
  );
  stats.observationsUpdated += stats.steps["observations from raw by listing_id"] ?? 0;

  await run(
    pool,
    "observations from raw by source_listing_id",
    `
    UPDATE vehicle_observations o
    SET
      source_listed_at = CASE
        WHEN o.source_listed_at IS NULL THEN p.listed_at
        WHEN p.listed_at < o.source_listed_at THEN p.listed_at
        ELSE o.source_listed_at
      END,
      source_updated_at = CASE
        WHEN o.source_updated_at IS NULL THEN COALESCE(p.updated_at, p.listed_at)
        WHEN COALESCE(p.updated_at, p.listed_at) > o.source_updated_at
          THEN COALESCE(p.updated_at, p.listed_at)
        ELSE o.source_updated_at
      END,
      observed_at = CASE
        WHEN p.listed_at < o.observed_at - interval '1 day' THEN p.listed_at
        ELSE o.observed_at
      END
    FROM _src_dates_parsed p
    WHERE o.provider_id = p.provider_id
      AND o.source_listing_id = p.source_id
      AND (o.listing_id IS NULL OR o.listing_id IS DISTINCT FROM p.listing_id)
      AND p.listed_at IS NOT NULL
    `,
    stats,
  );
  stats.observationsUpdated += stats.steps["observations from raw by source_listing_id"] ?? 0;

  // Kolon id-only (even without raw).
  await run(
    pool,
    "kolon listings from source_id",
    `
    UPDATE listings l
    SET
      first_seen_at = LEAST(
        l.first_seen_at,
        make_timestamptz(
          CASE WHEN substring(l.source_id from 3 for 2)::int >= 70
            THEN 1900 + substring(l.source_id from 3 for 2)::int
            ELSE 2000 + substring(l.source_id from 3 for 2)::int
          END,
          substring(l.source_id from 5 for 2)::int,
          substring(l.source_id from 7 for 2)::int,
          0, 0, 0, 'UTC'
        )
      ),
      last_seen_at = make_timestamptz(
        CASE WHEN substring(l.source_id from 3 for 2)::int >= 70
          THEN 1900 + substring(l.source_id from 3 for 2)::int
          ELSE 2000 + substring(l.source_id from 3 for 2)::int
        END,
        substring(l.source_id from 5 for 2)::int,
        substring(l.source_id from 7 for 2)::int,
        0, 0, 0, 'UTC'
      )
    FROM providers p
    WHERE p.id = l.provider_id
      AND p.internal_name = 'kolon_auto'
      AND l.source_id ~* '^PT[0-9]{6}'
    `,
    stats,
  );
  stats.listingsUpdated += stats.steps["kolon listings from source_id"] ?? 0;

  await run(
    pool,
    "kolon observations from source_id",
    `
    UPDATE vehicle_observations o
    SET
      source_listed_at = COALESCE(LEAST(o.source_listed_at, d.listed_at), d.listed_at),
      source_updated_at = COALESCE(GREATEST(o.source_updated_at, d.listed_at), d.listed_at),
      observed_at = CASE
        WHEN d.listed_at < o.observed_at - interval '1 day' THEN d.listed_at
        ELSE o.observed_at
      END
    FROM (
      SELECT
        l.id AS listing_id,
        make_timestamptz(
          CASE WHEN substring(l.source_id from 3 for 2)::int >= 70
            THEN 1900 + substring(l.source_id from 3 for 2)::int
            ELSE 2000 + substring(l.source_id from 3 for 2)::int
          END,
          substring(l.source_id from 5 for 2)::int,
          substring(l.source_id from 7 for 2)::int,
          0, 0, 0, 'UTC'
        ) AS listed_at
      FROM listings l
      JOIN providers p ON p.id = l.provider_id
      WHERE p.internal_name = 'kolon_auto'
        AND l.source_id ~* '^PT[0-9]{6}'
    ) d
    WHERE o.listing_id = d.listing_id
    `,
    stats,
  );
  stats.observationsUpdated += stats.steps["kolon observations from source_id"] ?? 0;

  // Auctionauto ObjectId creation time.
  await run(
    pool,
    "auctionauto listings from ObjectId",
    `
    UPDATE listings l
    SET
      first_seen_at = LEAST(l.first_seen_at, to_timestamp((('x' || substring(l.source_id from 1 for 8))::bit(32)::bigint))::timestamptz),
      last_seen_at = to_timestamp((('x' || substring(l.source_id from 1 for 8))::bit(32)::bigint))::timestamptz
    FROM providers p
    WHERE p.id = l.provider_id
      AND p.internal_name = 'auctionauto'
      AND l.source_id ~* '^[a-f0-9]{24}$'
    `,
    stats,
  );
  stats.listingsUpdated += stats.steps["auctionauto listings from ObjectId"] ?? 0;

  await run(
    pool,
    "auctionauto observations from ObjectId",
    `
    UPDATE vehicle_observations o
    SET
      source_listed_at = COALESCE(LEAST(o.source_listed_at, d.listed_at), d.listed_at),
      source_updated_at = COALESCE(GREATEST(o.source_updated_at, d.listed_at), d.listed_at),
      observed_at = CASE
        WHEN d.listed_at < o.observed_at - interval '1 day' THEN d.listed_at
        ELSE o.observed_at
      END
    FROM (
      SELECT
        l.id AS listing_id,
        to_timestamp((('x' || substring(l.source_id from 1 for 8))::bit(32)::bigint))::timestamptz AS listed_at
      FROM listings l
      JOIN providers p ON p.id = l.provider_id
      WHERE p.internal_name = 'auctionauto'
        AND l.source_id ~* '^[a-f0-9]{24}$'
    ) d
    WHERE o.listing_id = d.listing_id
    `,
    stats,
  );
  stats.observationsUpdated += stats.steps["auctionauto observations from ObjectId"] ?? 0;

  await pool.query(`DROP TABLE IF EXISTS _src_dates_parsed`);
  await pool.query(`DROP TABLE IF EXISTS _src_dates_tmp`);

  return stats;
}
