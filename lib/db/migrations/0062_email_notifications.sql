-- SMTP + per-event email notification settings
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_host" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_port" integer DEFAULT 587 NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_secure" boolean DEFAULT false NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_user" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_password" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_from_name" text DEFAULT 'GetCarAPI';
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "smtp_from_email" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_staff_inbox" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_public_base_url" text DEFAULT 'https://getcarapi.com';

ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_password_reset_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_support_staff_reply_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_support_new_ticket_admin_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_support_client_reply_admin_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_payment_approved_enabled" boolean DEFAULT false NOT NULL;

ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_password_reset_subject" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_password_reset_body" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_support_staff_reply_subject" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_support_staff_reply_body" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_support_new_ticket_admin_subject" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_support_new_ticket_admin_body" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_support_client_reply_admin_subject" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_support_client_reply_admin_body" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_payment_approved_subject" text;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "email_tpl_payment_approved_body" text;

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" integer NOT NULL REFERENCES "api_clients"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_client_id_idx" ON "password_reset_tokens" ("client_id");
