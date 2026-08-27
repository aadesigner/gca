-- Phase 4: Live Feed Provider Framework
-- Add live_providers table for configured live data feed adapters

CREATE TABLE IF NOT EXISTS live_providers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  internal_name text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  cache_ttl_seconds integer NOT NULL DEFAULT 60,
  credentials_encrypted text,
  credentials_iv text,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add live_provider_cache table for TTL-based response caching
CREATE TABLE IF NOT EXISTS live_provider_cache (
  id serial PRIMARY KEY,
  provider_id integer NOT NULL REFERENCES live_providers(id) ON DELETE CASCADE,
  query_fingerprint text NOT NULL,
  response_data text NOT NULL,
  total_count integer NOT NULL DEFAULT 0,
  cached_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  UNIQUE (provider_id, query_fingerprint)
);

CREATE INDEX IF NOT EXISTS live_cache_expires_idx ON live_provider_cache (expires_at);
CREATE INDEX IF NOT EXISTS live_cache_provider_idx ON live_provider_cache (provider_id);

-- Insert default Encar live provider stub (disabled until credentials are configured)
INSERT INTO live_providers (name, internal_name, is_enabled, cache_ttl_seconds)
VALUES ('Encar Live', 'encar_live', false, 60)
ON CONFLICT (internal_name) DO NOTHING;
