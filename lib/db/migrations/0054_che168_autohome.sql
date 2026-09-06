-- Che168 / Autohome Global China export catalog (+ CNY FX tracking note via app).
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
    'Che168',
    'che168',
    'classifieds',
    'CN',
    'https://global.che168.com',
    true,
    30,
    'che168-v1.0.0',
    'Autohome Global / Che168 export (globalapi.che168.com). EN language API: USD asking price, km mileage, gallery, EN fuel/color/gearbox. Public vincode masked. Full crawl then ~6h listing_refresh. Domestic www.che168.com / usedcar.autohome.com.cn not reachable abroad.',
    now(),
    now()
  ),
  (
    'Autohome',
    'autohome',
    'classifieds',
    'CN',
    'https://global.autohome.com',
    true,
    30,
    'che168-v1.0.0',
    'Autohome Global export — same inventory as che168 (fleet-skipped to avoid duplicates). Domestic Autohome used-car sites blocked / 403 abroad.',
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
