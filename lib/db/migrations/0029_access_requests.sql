CREATE TABLE IF NOT EXISTS "access_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "telegram_username" text,
  "service_interest" text NOT NULL,
  "message" text NOT NULL,
  "status" text NOT NULL DEFAULT 'new',
  "admin_note" text,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_created_at_idx" ON "access_requests" ("created_at");-->statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_status_idx" ON "access_requests" ("status");
