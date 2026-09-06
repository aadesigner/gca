-- OntarioCars.ca (UCDA member dealer inventory — Carpages-powered).
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
    'OntarioCars',
    'ontariocars',
    'classifieds',
    'CA',
    'https://www.ontariocars.ca',
    true,
    20,
    'ontariocars-v1.0.0',
    'Ontario UCDA dealer inventory (Carpages). Make+truck category shards avoid ES 10k window — VIN, km, CAD, gallery from detail HTML.',
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
