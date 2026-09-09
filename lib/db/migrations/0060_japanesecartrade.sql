-- JapaneseCarTrade.com (JCT) — Japan used-car export portal.
-- Enabled for production fleet: unbounded full_collection then ~6h listing_refresh.
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
    'JapaneseCarTrade',
    'japanesecartrade',
    'classifieds',
    'JP',
    'https://www.japanesecartrade.com',
    true,
    20,
    'japanesecartrade-v1.0.0',
    'JapaneseCarTrade.com (~250k JP export stock). Make-sharded HTML list; ISO VIN or JP chassis; km + FOB USD; gallery via ___ShowOtherImages. Full crawl then ~6h listing_refresh. Cloudflare: set JCT_CDP_URL / IMPORT_MOTOR_CDP_URL if Node fetch is challenged.',
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
