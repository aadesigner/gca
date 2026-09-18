-- BE FORWARD, Japanese Used Cars, Syarah.
-- beforward: enabled for fleet (public Chassis No. + gallery).
-- japaneseusedcars / syarah: adapters ready but enabled=false (masked / missing public VIN).

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
    'BE FORWARD',
    'beforward',
    'classifieds',
    'JP',
    'https://www.beforward.jp',
    true,
    12,
    'beforward-v1.0.1',
    'BE FORWARD JP export marketplace. Make-sharded stocklist; Chassis No. (ISO VIN or JP frame ~45% unmasked); USD FOB; ordered image-cdn gallery. Full crawl then ~6h listing_refresh. Slow crawl (concurrency 1, 429 backoff); optional BEFORWARD_CDP_URL.',
    now(),
    now()
  ),
  (
    'Japanese Used Cars',
    'japaneseusedcars',
    'classifieds',
    'JP',
    'https://japaneseusedcars.com',
    false,
    10,
    'japaneseusedcars-v1.0.0',
    'Fixed-price WordPress catalogs. Public chassis usually masked (****) — history persist requires unmasked VIN. AJES photos when present.',
    now(),
    now()
  ),
  (
    'Syarah',
    'syarah',
    'dealer',
    'SA',
    'https://syarah.com',
    false,
    20,
    'syarah-v1.0.0',
    'Saudi marketplace. FULL_PAGE_DATA specs + ordered CDN gallery (SAR). Public pages omit VIN; api.syarah.com geo-restricted outside SA/JO/EG/BD.',
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
