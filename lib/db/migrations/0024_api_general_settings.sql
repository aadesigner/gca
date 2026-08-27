ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "api_vin_retrieve_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "api_live_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "api_vin_check_enabled" boolean NOT NULL DEFAULT true;
