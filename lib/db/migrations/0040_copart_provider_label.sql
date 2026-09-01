-- Drop BidScan from the public Copart provider label; cars stay attributed to iaa or copart.
UPDATE "providers"
SET
  "name" = 'Copart',
  "base_url" = 'https://www.copart.com',
  "notes" = 'US salvage auction (Copart lots). IAAI lots from the same crawl persist under iaa.'
WHERE "internal_name" = 'copart';
--> statement-breakpoint
UPDATE "vehicle_events"
SET "metadata" = (
  jsonb_set(
    "metadata"::jsonb,
    '{source}',
    to_jsonb(COALESCE("metadata"::jsonb->>'provider', 'copart'))
  )
)::text
WHERE "metadata" IS NOT NULL
  AND "metadata"::jsonb->>'source' = 'bidscan';
