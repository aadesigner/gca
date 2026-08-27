ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "credit_balance" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "is_demo" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "credit_price_usd" numeric(10, 2) NOT NULL DEFAULT 1.00;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "crypto_payment_instructions" text;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "recaptcha_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "recaptcha_site_key" text;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "recaptcha_secret_key" text;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "recaptcha_min_score" numeric(3, 2) NOT NULL DEFAULT 0.50;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "registration_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "demo_starting_credits" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL REFERENCES "api_clients"("id") ON DELETE CASCADE,
  "delta" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "reason" text NOT NULL,
  "ref_type" text,
  "ref_id" text,
  "created_by_admin_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_client_idx" ON "credit_ledger" ("client_id", "created_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_purchases" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL REFERENCES "api_clients"("id") ON DELETE CASCADE,
  "credits" integer NOT NULL,
  "amount_usd" numeric(12, 2) NOT NULL,
  "crypto_currency" text NOT NULL DEFAULT 'USDT',
  "tx_hash" text,
  "payer_note" text,
  "status" text NOT NULL DEFAULT 'pending',
  "admin_note" text,
  "reviewed_by_admin_id" integer,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_purchases_status_idx" ON "credit_purchases" ("status", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_purchases_client_idx" ON "credit_purchases" ("client_id", "created_at" DESC);
--> statement-breakpoint
-- Seed credits for existing clients. Guard missing columns (0018 was not in the journal).
DO $$
BEGIN
  UPDATE "api_clients"
  SET "is_demo" = false,
      "credit_balance" = GREATEST(
        COALESCE("monthly_global_limit", 0),
        COALESCE("rate_limit_per_day", 0),
        100
      )
  WHERE "credit_balance" = 0;
EXCEPTION
  WHEN undefined_column THEN
    NULL;
  WHEN undefined_table THEN
    NULL;
END $$;
