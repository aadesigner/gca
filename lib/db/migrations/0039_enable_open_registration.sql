-- Open self-registration at /account/?register=1 (undo 0025 invite-only default).
UPDATE "settings" SET "registration_enabled" = true WHERE id = 1;
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "registration_enabled" SET DEFAULT true;
