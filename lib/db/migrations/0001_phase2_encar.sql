-- Phase 2: Encar Collector & VIN History additions

-- vehicles: add last_seen_at and current_known_mileage
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "current_known_mileage" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint

-- vehicle_observations: add fingerprint_hash for dedup
ALTER TABLE "vehicle_observations" ADD COLUMN IF NOT EXISTS "fingerprint_hash" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_obs_fingerprint_idx" ON "vehicle_observations" USING btree ("fingerprint_hash");--> statement-breakpoint

-- raw_source_records: add request_url and parser_version
ALTER TABLE "raw_source_records" ADD COLUMN IF NOT EXISTS "request_url" text;--> statement-breakpoint
ALTER TABLE "raw_source_records" ADD COLUMN IF NOT EXISTS "parser_version" text;--> statement-breakpoint

-- collection_jobs: add job_config and detailed progress counters
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "job_config" text;--> statement-breakpoint
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "pages_processed" integer;--> statement-breakpoint
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "listings_fetched" integer;--> statement-breakpoint
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "vins_found" integer;--> statement-breakpoint
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "vins_new" integer;--> statement-breakpoint
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "new_observations" integer;--> statement-breakpoint
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "duplicates_skipped" integer;
