-- AAA Auto Slovakia marketplace (used-car dealer stock).
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
VALUES (
  'AAA Auto SK',
  'aaaauto',
  'dealer',
  'SK',
  'https://www.aaaauto.sk',
  true,
  25,
  'aaaauto-v1.0.0',
  'Slovak AAA Auto used cars. Angular SSR ng-state: VIN, mileage, photos, STK, history labels.',
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
