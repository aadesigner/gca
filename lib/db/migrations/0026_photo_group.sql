ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS photo_group text NOT NULL DEFAULT 'gallery';

CREATE INDEX IF NOT EXISTS photos_vehicle_group_idx
  ON photos (vehicle_id, photo_group);
