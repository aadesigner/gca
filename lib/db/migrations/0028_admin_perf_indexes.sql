-- Admin list / join hot paths (safe additive indexes)
CREATE INDEX IF NOT EXISTS "listings_vehicle_id_idx" ON "listings" ("vehicle_id");-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_created_at_idx" ON "listings" ("created_at");-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_created_at_idx" ON "vehicles" ("created_at");-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_tokens_client_active_idx" ON "api_tokens" ("client_id", "is_active");-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_jobs_created_at_idx" ON "collection_jobs" ("created_at");
