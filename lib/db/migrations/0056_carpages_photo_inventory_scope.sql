-- Fix Carpages/OntarioCars galleries: remove related-vehicle CDN thumbs
-- (images.carpages.ca/inventory/{OTHER_ID}.*) and bump parser versions.
UPDATE "providers"
SET
  "parser_version" = CASE "internal_name"
    WHEN 'ontariocars' THEN 'ontariocars-v1.0.1'
    WHEN 'carpages' THEN 'carpages-v1.1.1'
    ELSE "parser_version"
  END,
  "notes" = CASE "internal_name"
    WHEN 'ontariocars' THEN
      'Ontario UCDA dealer inventory (Carpages). Make+truck shards; VIN/km/CAD; photos scoped to inventory id only.'
    WHEN 'carpages' THEN
      'Canadian classifieds. VIN from labeled specs; photos filtered to listing inventory id only (no related thumbs).'
    ELSE "notes"
  END,
  "updated_at" = now()
WHERE "internal_name" IN ('ontariocars', 'carpages');

-- Delete foreign Carpages CDN photos attached to OntarioCars / Carpages vehicles.
WITH target AS (
  SELECT
    l.id AS listing_id,
    l.vehicle_id,
    COALESCE(
      (regexp_match(l.source_id, '/(\d{5,})$'))[1],
      (regexp_match(l.source_id, '-(\d{5,})$'))[1],
      (regexp_match(l.source_url, '/(\d{5,})(?:/|$|\?)'))[1],
      (regexp_match(l.source_url, '-(\d{5,})(?:/|$|\?)'))[1]
    ) AS inv_id
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name IN ('ontariocars', 'carpages')
)
DELETE FROM photos ph
USING target t
WHERE ph.vehicle_id = t.vehicle_id
  AND t.inv_id IS NOT NULL
  AND coalesce(ph.source_url, ph.stored_path, '') ~* 'images\.carpages\.ca/inventory/'
  AND coalesce(ph.source_url, ph.stored_path, '') !~* ('inventory/' || t.inv_id || '\.');

-- Re-primary remaining galleries (lowest sort_order / id per vehicle).
WITH ranked AS (
  SELECT
    ph.id,
    ROW_NUMBER() OVER (
      PARTITION BY ph.vehicle_id
      ORDER BY ph.sort_order ASC NULLS LAST, ph.id ASC
    ) AS rn
  FROM photos ph
  JOIN listings l ON l.vehicle_id = ph.vehicle_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name IN ('ontariocars', 'carpages')
)
UPDATE photos ph
SET is_primary = (ranked.rn = 1)
FROM ranked
WHERE ph.id = ranked.id;
