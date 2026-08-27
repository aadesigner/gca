-- Phase 3: Public VIN API additions
-- Add per-VIN and monthly rate-limit columns to api_clients
ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS requests_per_vin integer;
ALTER TABLE api_clients ADD COLUMN IF NOT EXISTS monthly_global_limit integer;

-- Add VIN column to api_request_logs for per-VIN rate limit tracking
ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS vin text;

-- Index for per-VIN rate limit queries
CREATE INDEX IF NOT EXISTS api_request_logs_vin_idx ON api_request_logs (client_id, vin, requested_at);
