-- Unique hash so reset lookups are exact; drop duplicates first if any.
DELETE FROM password_reset_tokens a
  USING password_reset_tokens b
 WHERE a.id > b.id
   AND a.token_hash = b.token_hash;

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_uidx"
  ON "password_reset_tokens" ("token_hash");

-- Speeds expiry cleanup / unused-token invalidation per client.
CREATE INDEX IF NOT EXISTS "password_reset_tokens_client_unused_idx"
  ON "password_reset_tokens" ("client_id")
  WHERE "used_at" IS NULL;
