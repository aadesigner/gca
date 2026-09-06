-- BidExport.com (US auction broker — automobiles & trucks).
INSERT INTO "providers" (
  "name",
  "internal_name",
  "type",
  "country",
  "base_url",
  "enabled",
  "rate_limit",
  "parser_version",
  "notes",
  "created_at",
  "updated_at"
)
VALUES
  (
    'BidExport',
    'bidexport',
    'auction',
    'US',
    'https://bidexport.com',
    true,
    20,
    'bidexport-v1.0.0',
    'US BidExport auction broker. POST /filter for Automobile+Truck — VIN, mileage (mi), IAA gallery, damage/title.',
    now(),
    now()
  )
ON CONFLICT ("internal_name") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "country" = EXCLUDED."country",
  "base_url" = EXCLUDED."base_url",
  "enabled" = EXCLUDED."enabled",
  "rate_limit" = EXCLUDED."rate_limit",
  "parser_version" = EXCLUDED."parser_version",
  "notes" = EXCLUDED."notes",
  "updated_at" = now();
