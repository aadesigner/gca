-- Phase 4 patch: add last_upstream_call_at column to live_providers
-- This timestamp is updated on every successful upstream call, so it survives
-- cache-entry TTL expiry (unlike computing MAX(cached_at) from the cache table).

ALTER TABLE live_providers ADD COLUMN IF NOT EXISTS last_upstream_call_at timestamptz;
