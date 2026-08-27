ALTER TABLE "collection_jobs"
ADD COLUMN IF NOT EXISTS "crawl_state" text;
