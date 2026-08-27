DROP INDEX IF EXISTS "vehicle_events_vehicle_type_day_uidx";

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_events_vehicle_type_day_desc_uidx"
  ON "vehicle_events" (
    "vehicle_id",
    "event_type",
    DATE("occurred_at" AT TIME ZONE 'UTC'),
    md5(COALESCE("description", ''))
  );
