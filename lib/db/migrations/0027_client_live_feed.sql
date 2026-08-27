ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "live_feed_enabled" boolean DEFAULT false NOT NULL;-->statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "live_feed_expires_at" timestamp with time zone;-->statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "live_feed_contact_email" text DEFAULT 'info@getcarapi.com';
