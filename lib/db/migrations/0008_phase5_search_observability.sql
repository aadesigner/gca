-- Phase 5: Advanced Search & Observability
-- New tables: system_events, job_logs, normalization_overrides
-- Additional composite indexes on existing tables for performance

-- ── System Events (observability) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "system_events" (
  "id" serial PRIMARY KEY,
  "event_type" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'error',
  "provider_id" integer REFERENCES "providers"("id"),
  "job_id" integer REFERENCES "collection_jobs"("id"),
  "message" text NOT NULL,
  "details" text,
  "source_url" text,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "system_events_event_type_idx" ON "system_events" ("event_type");
CREATE INDEX IF NOT EXISTS "system_events_occurred_at_idx" ON "system_events" ("occurred_at");
CREATE INDEX IF NOT EXISTS "system_events_provider_id_idx" ON "system_events" ("provider_id");
CREATE INDEX IF NOT EXISTS "system_events_job_id_idx" ON "system_events" ("job_id");
CREATE INDEX IF NOT EXISTS "system_events_severity_idx" ON "system_events" ("severity");

-- ── Job Logs (per-job detailed log stream) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "job_logs" (
  "id" serial PRIMARY KEY,
  "job_id" integer NOT NULL REFERENCES "collection_jobs"("id") ON DELETE CASCADE,
  "level" text NOT NULL DEFAULT 'info',
  "stage" text NOT NULL,
  "message" text NOT NULL,
  "details" text,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "job_logs_job_id_idx" ON "job_logs" ("job_id");
CREATE INDEX IF NOT EXISTS "job_logs_occurred_at_idx" ON "job_logs" ("occurred_at");
CREATE INDEX IF NOT EXISTS "job_logs_job_occurred_idx" ON "job_logs" ("job_id", "occurred_at");

-- ── Normalization Overrides ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "normalization_overrides" (
  "id" serial PRIMARY KEY,
  "vehicle_id" integer NOT NULL REFERENCES "vehicles"("id"),
  "field" text NOT NULL,
  "original_value" text,
  "overridden_value" text NOT NULL,
  "confidence" text,
  "overridden_by" integer REFERENCES "admin_users"("id"),
  "overridden_by_email" text,
  "reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "norm_overrides_vehicle_id_idx" ON "normalization_overrides" ("vehicle_id");
CREATE INDEX IF NOT EXISTS "norm_overrides_field_idx" ON "normalization_overrides" ("field");

-- ── Performance indexes on existing tables ────────────────────────────────
-- Composite index for vehicle search (make + model + year)
CREATE INDEX IF NOT EXISTS "vehicles_make_model_year_idx" ON "vehicles" ("make", "model", "year");
-- Index for year range queries
CREATE INDEX IF NOT EXISTS "vehicles_year_idx" ON "vehicles" ("year");
-- Composite for listings price queries
CREATE INDEX IF NOT EXISTS "listings_price_idx" ON "listings" ("price_amount");
CREATE INDEX IF NOT EXISTS "listings_mileage_idx" ON "listings" ("mileage");
-- Composite for observations price/mileage timeseries
CREATE INDEX IF NOT EXISTS "vehicle_obs_vehicle_observed_idx" ON "vehicle_observations" ("vehicle_id", "observed_at");
-- Audit logs action index
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");
