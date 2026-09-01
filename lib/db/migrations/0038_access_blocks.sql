CREATE TABLE IF NOT EXISTS "access_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"block_type" text NOT NULL,
	"block_value" text NOT NULL,
	"reason" text,
	"source_client_id" integer,
	"created_by_admin_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "access_blocks" ADD CONSTRAINT "access_blocks_source_client_id_api_clients_id_fk" FOREIGN KEY ("source_client_id") REFERENCES "public"."api_clients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_blocks_type_value_uidx" ON "access_blocks" USING btree ("block_type", "block_value");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_blocks_type_idx" ON "access_blocks" USING btree ("block_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_auth_fingerprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"ip_address" text,
	"device_id" text,
	"user_agent" text,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_auth_fingerprints" ADD CONSTRAINT "client_auth_fingerprints_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_auth_fp_client_id_idx" ON "client_auth_fingerprints" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_auth_fp_device_id_idx" ON "client_auth_fingerprints" USING btree ("device_id");
