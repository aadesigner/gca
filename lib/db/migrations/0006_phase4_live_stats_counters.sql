-- Phase 4 patch: add lifetime counter columns to live_providers
-- These track total upstream calls and cache hits independently of cache-entry
-- retention, so stats remain correct across TTL expiry and upsert cycles.

ALTER TABLE live_providers ADD COLUMN IF NOT EXISTS total_upstream_calls integer NOT NULL DEFAULT 0;
ALTER TABLE live_providers ADD COLUMN IF NOT EXISTS total_cache_hits integer NOT NULL DEFAULT 0;
