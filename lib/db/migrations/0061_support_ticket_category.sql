ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'other' NOT NULL;
CREATE INDEX IF NOT EXISTS "support_tickets_category_idx" ON "support_tickets" ("category");
