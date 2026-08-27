ALTER TABLE "vehicle_observations" ADD COLUMN IF NOT EXISTS "source_listed_at" timestamptz;
ALTER TABLE "vehicle_observations" ADD COLUMN IF NOT EXISTS "source_updated_at" timestamptz;
