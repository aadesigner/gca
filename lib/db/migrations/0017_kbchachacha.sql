INSERT INTO "providers" (
  "name", "internal_name", "type", "country", "base_url", "enabled",
  "rate_limit", "parser_version", "notes"
)
VALUES (
  'KB ChaChaCha',
  'kbchachacha',
  'auction',
  'KR',
  'https://www.kbchachacha.com',
  true,
  30,
  'kbchachacha-v1.0.0',
  'KB ChaChaCha used-car marketplace (South Korea). Historical persist is VIN-only from the inspection sheet; live feed shows all listings. Prices in KRW.'
)
ON CONFLICT ("internal_name") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "base_url" = EXCLUDED."base_url",
  "enabled" = EXCLUDED."enabled",
  "rate_limit" = EXCLUDED."rate_limit",
  "parser_version" = EXCLUDED."parser_version",
  "notes" = EXCLUDED."notes";

INSERT INTO "live_providers" ("name", "internal_name", "is_enabled", "cache_ttl_seconds")
VALUES ('KB ChaChaCha Live', 'kbchachacha_live', true, 60)
ON CONFLICT ("internal_name") DO NOTHING;
