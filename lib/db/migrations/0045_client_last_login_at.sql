-- Persist portal last login on the client row (fingerprint table remains for abuse tracing).
ALTER TABLE "api_clients" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "api_clients" AS c
SET "last_login_at" = fp.last_at
FROM (
  SELECT "client_id", max("created_at") AS last_at
  FROM "client_auth_fingerprints"
  WHERE "event_type" IN ('login', 'register')
  GROUP BY "client_id"
) AS fp
WHERE c.id = fp.client_id
  AND (c."last_login_at" IS NULL OR c."last_login_at" < fp.last_at);
