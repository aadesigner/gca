-- TheBidrive gallery scope bump (Similar thumbs cleaned via ops; parser v1.0.2).
UPDATE "providers"
SET
  "parser_version" = 'thebidrive-v1.0.2',
  "notes" = 'TheBidrive.com auctions+marketplaces. Gallery from LD when present (no Similar thumbs).',
  "updated_at" = now()
WHERE "internal_name" = 'thebidrive';

UPDATE "providers"
SET
  "parser_version" = 'willhaben-v1.1.1',
  "updated_at" = now()
WHERE "internal_name" = 'willhaben';

UPDATE "providers"
SET
  "parser_version" = 'autoplac-v1.0.1',
  "updated_at" = now()
WHERE "internal_name" = 'autoplac';
