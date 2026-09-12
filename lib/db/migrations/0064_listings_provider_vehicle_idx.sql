-- Speed up admin provider filters (Import Motor / Copart / Autowini scale).
CREATE INDEX IF NOT EXISTS "listings_provider_vehicle_idx"
  ON "listings" ("provider_id", "vehicle_id");
