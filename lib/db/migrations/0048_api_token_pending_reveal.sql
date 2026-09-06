ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "pending_reveal" text;
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "pending_reveal_expires_at" timestamp with time zone;
