ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "client_login_enabled" boolean NOT NULL DEFAULT true;

-- Invite-only by default: admins create accounts in the console.
UPDATE "settings" SET "registration_enabled" = false WHERE id = 1;

ALTER TABLE "settings" ALTER COLUMN "registration_enabled" SET DEFAULT false;
