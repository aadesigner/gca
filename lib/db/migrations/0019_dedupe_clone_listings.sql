CREATE UNIQUE INDEX IF NOT EXISTS listings_provider_source_uidx
  ON listings (provider_id, source_id);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS photos_vehicle_source_url_uidx
  ON photos (vehicle_id, source_url)
  WHERE vehicle_id IS NOT NULL;
