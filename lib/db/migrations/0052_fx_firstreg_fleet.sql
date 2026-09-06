-- Raise fleet parallel cap to 8 and clean AAA Auto bogus first-registration events.
UPDATE "settings"
SET "max_collection_jobs_parallel" = GREATEST(COALESCE("max_collection_jobs_parallel", 0), 8),
    "updated_at" = now()
WHERE "id" = 1;

UPDATE "providers"
SET "parser_version" = 'aaaauto-v1.0.4',
    "notes" = 'Slovak AAA Auto. VIN/mileage/photos; first-reg from production year; history labels in English.',
    "updated_at" = now()
WHERE "internal_name" = 'aaaauto';

UPDATE "providers"
SET "parser_version" = 'willhaben-v1.1.0',
    "notes" = 'Austria classifieds. EU locale→EN; first-reg or production year fallback.',
    "updated_at" = now()
WHERE "internal_name" = 'willhaben';

-- History chips were stored as delivery with crawl timestamp → showed as first reg 2026.
DELETE FROM "vehicle_events" e
USING "listings" l, "providers" p
WHERE e."vehicle_id" = l."vehicle_id"
  AND l."provider_id" = p."id"
  AND p."internal_name" = 'aaaauto'
  AND e."event_type" = 'delivery'
  AND (
    e."description" ~* '(k[uú]pen|bought new|predv[aá]dz|demo vehicle|nov[eé] vozidlo)'
    OR (
      e."description" !~* 'first registration'
      AND e."occurred_at"::date >= DATE '2026-01-01'
    )
  );

-- Restore first registration from production year when missing.
INSERT INTO "vehicle_events" ("vehicle_id", "event_type", "description", "occurred_at", "metadata", "created_at")
SELECT DISTINCT ON (v."id")
  v."id",
  'delivery',
  'First registration: ' || v."year"::text,
  make_date(v."year", 1, 1),
  jsonb_build_object(
    'kind', 'firstRegistration',
    'field', 'firstRegistration',
    'value', v."year"::text,
    'source', 'productionYear'
  ),
  now()
FROM "vehicles" v
JOIN "listings" l ON l."vehicle_id" = v."id"
JOIN "providers" p ON p."id" = l."provider_id"
WHERE p."internal_name" = 'aaaauto'
  AND v."year" IS NOT NULL
  AND v."year" BETWEEN 1980 AND 2030
  AND NOT EXISTS (
    SELECT 1 FROM "vehicle_events" e
    WHERE e."vehicle_id" = v."id"
      AND e."event_type" = 'delivery'
      AND (
        e."description" ~* 'first registration'
        OR e."metadata"::text ~* 'firstRegistration'
      )
  );
