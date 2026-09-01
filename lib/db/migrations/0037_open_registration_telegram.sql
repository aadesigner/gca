ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "telegram_username" text;
--> statement-breakpoint
UPDATE "settings" SET "registration_enabled" = true;
