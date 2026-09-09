-- BidExport: keep IAAI imageKeys (asPhotos no longer strips query).
-- TheBidrive: scope encar/CDN folders + strip Similar; skip junk/bare resizer.
UPDATE "providers"
SET
  "parser_version" = 'bidexport-v1.0.1',
  "notes" = 'US BidExport auction broker. POST /filter for Automobile+Truck — VIN, mileage (mi), full IAAI gallery (imageKeys preserved), damage/title. Skip lots with no usable photos.',
  "updated_at" = now()
WHERE "internal_name" = 'bidexport';

UPDATE "providers"
SET
  "parser_version" = 'thebidrive-v1.0.4',
  "notes" = 'TheBidrive.com auctions+marketplaces. Gallery scoped to LD/og catalog + encar/CDN folder ids (full same-folder shots, no Similar thumbs). Skip listings with no usable photos.',
  "updated_at" = now()
WHERE "internal_name" = 'thebidrive';
