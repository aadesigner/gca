-- Phase 2: enforce fingerprint uniqueness to prevent duplicate observations
-- Uses a partial unique index so NULL fingerprints (no-VIN rows) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_obs_fingerprint_unique_idx
  ON vehicle_observations (fingerprint_hash)
  WHERE fingerprint_hash IS NOT NULL;
