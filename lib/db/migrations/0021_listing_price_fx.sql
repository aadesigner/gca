ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "price_usd" integer;
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "price_eur" integer;
ALTER TABLE "vehicle_observations" ADD COLUMN IF NOT EXISTS "price_usd" integer;
ALTER TABLE "vehicle_observations" ADD COLUMN IF NOT EXISTS "price_eur" integer;
