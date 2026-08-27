ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "password_hash" text;
CREATE UNIQUE INDEX IF NOT EXISTS "api_clients_email_uidx" ON "api_clients" (lower(email)) WHERE email IS NOT NULL;
