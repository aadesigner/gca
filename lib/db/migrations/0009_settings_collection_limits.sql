-- Add default collection limit columns to settings
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "default_max_pages"    integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "default_max_listings"  integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "default_delay_ms"      integer NOT NULL DEFAULT 2000;
