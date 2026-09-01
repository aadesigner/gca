ALTER TABLE "credit_purchases" ADD COLUMN IF NOT EXISTS "proof_path" text;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "min_crypto_deposit_usd" numeric(10, 2) NOT NULL DEFAULT 40.00;
