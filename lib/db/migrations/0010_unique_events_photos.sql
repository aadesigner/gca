-- Unique functional index for vehicle_events: one event per (vehicle, type, calendar day).
-- This makes ON CONFLICT DO NOTHING work correctly for re-run deduplication.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_events_vehicle_type_day_uidx
  ON vehicle_events (vehicle_id, event_type, DATE(occurred_at AT TIME ZONE 'UTC'));

-- Unique index for photos: one row per (listing, source_url).
CREATE UNIQUE INDEX IF NOT EXISTS photos_listing_source_url_uidx
  ON photos (listing_id, source_url);
