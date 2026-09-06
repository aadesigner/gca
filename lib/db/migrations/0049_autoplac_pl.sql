-- Autoplac.pl (Poland / Yanosik) marketplace provider.
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
    'Autoplac',
    'autoplac',
    'classifieds',
    'PL',
    'https://www.autoplac.pl',
    true,
    20,
    'autoplac-v1.0.0',
    'Poland Autoplac.pl. List via Angular SSR ng-state; detail via api.autoplac.pl — VIN, mileage, photos, PLN.',
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
