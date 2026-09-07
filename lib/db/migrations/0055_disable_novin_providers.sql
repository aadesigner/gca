-- Disable marketplaces that cannot produce VIN history listings:
-- public VIN masked / members-only, or full crawls completed with 0 persisted rows.
UPDATE "providers"
SET
  "enabled" = false,
  "notes" = CASE
    WHEN "internal_name" IN ('che168', 'autohome') THEN
      coalesce("notes", '') || ' [disabled: public VIN masked — history DB requires VIN]'
    WHEN "internal_name" = 'ssancar' THEN
      coalesce("notes", '') || ' [disabled: full VIN members-only]'
    WHEN "internal_name" IN ('heydealer', 'bobaedream', 'bobaedreamcyber') THEN
      coalesce("notes", '') || ' [disabled: public VIN rare/absent]'
    WHEN "internal_name" IN ('autobell', 'kcar', 'mango', 'auctionwini') THEN
      coalesce("notes", '') || ' [disabled: no usable public VIN inventory]'
    ELSE
      coalesce("notes", '') || ' [disabled: crawl ran with 0 VIN listings persisted]'
  END,
  "updated_at" = now()
WHERE "internal_name" IN (
  'che168',
  'autohome',
  'ssancar',
  'heydealer',
  'bobaedream',
  'bobaedreamcyber',
  'autobell',
  'kcar',
  'mango',
  'auctionwini',
  'automobileit',
  'autoscout24_es',
  'autoscout24_be',
  'autotradernl',
  'subito',
  'standvirtual',
  'mobilebg'
);

UPDATE "collection_jobs" AS j
SET
  "status" = 'cancelled',
  "completed_at" = COALESCE(j."completed_at", now()),
  "error_message" = COALESCE(
    NULLIF(j."error_message", ''),
    'cancelled: provider disabled (no public VIN / 0 listings after crawl)'
  ),
  "updated_at" = now()
FROM "providers" AS p
WHERE p."id" = j."provider_id"
  AND p."internal_name" IN (
    'che168',
    'autohome',
    'ssancar',
    'heydealer',
    'bobaedream',
    'bobaedreamcyber',
    'autobell',
    'kcar',
    'mango',
    'auctionwini',
    'automobileit',
    'autoscout24_es',
    'autoscout24_be',
    'autotradernl',
    'subito',
    'standvirtual',
    'mobilebg'
  )
  AND j."status" IN ('pending', 'running', 'paused');
