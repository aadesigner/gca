ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "is_test_only" boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS "api_tokens_client_test_active_idx"
  ON "api_tokens" ("client_id", "is_test_only", "is_active");
