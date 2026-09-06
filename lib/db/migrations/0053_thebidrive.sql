-- TheBidrive.com (global auctions + marketplaces aggregator).
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
    'TheBidrive',
    'thebidrive',
    'auction',
    'INTL',
    'https://thebidrive.com',
    true,
    25,
    'thebidrive-v1.0.0',
    'TheBidrive.com auctions (/lot) + marketplaces (/listing). EN LD+JSON: VIN, mileage (km), USD price/sold, CDN gallery. Full crawl then ~5h refresh.',
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
