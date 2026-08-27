ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "country" text;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "country" text;

CREATE INDEX IF NOT EXISTS "vehicles_country_idx" ON "vehicles" ("country");
CREATE INDEX IF NOT EXISTS "listings_country_idx" ON "listings" ("country");

UPDATE "listings"
SET "location" = "location" || ', South Korea'
WHERE "location" IS NOT NULL
  AND btrim("location") <> ''
  AND "location" !~* '(south[[:space:]]+)?korea';

UPDATE "vehicle_observations"
SET "location" = "location" || ', South Korea'
WHERE "location" IS NOT NULL
  AND btrim("location") <> ''
  AND "location" !~* '(south[[:space:]]+)?korea';

UPDATE "listings" SET "country" = 'South Korea' WHERE "country" IS NULL;
UPDATE "vehicles" SET "country" = 'South Korea' WHERE "country" IS NULL;

INSERT INTO "providers" (
  "name", "internal_name", "type", "country", "base_url", "enabled",
  "rate_limit", "parser_version", "notes"
)
VALUES (
  'Autowini',
  'autowini',
  'auction',
  'KR',
  'https://www.autowini.com',
  true,
  30,
  'autowini-v1.0.0',
  'Autowini used-car marketplace (South Korea). Historical persist is VIN-only; live feed shows all listings.'
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
VALUES ('Autowini Live', 'autowini_live', true, 60)
ON CONFLICT ("internal_name") DO NOTHING;
