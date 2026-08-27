CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"internal_name" text NOT NULL,
	"type" text NOT NULL,
	"country" text NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit" integer,
	"parser_version" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_internal_name_unique" UNIQUE("internal_name")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"trim" text,
	"body_type" text,
	"fuel_type" text,
	"transmission" text,
	"drive_type" text,
	"engine_displacement" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"vehicle_id" integer,
	"vin" text,
	"source_id" text NOT NULL,
	"source_url" text,
	"title" text,
	"price_amount" integer,
	"price_currency" text DEFAULT 'USD',
	"mileage" integer,
	"mileage_unit" text DEFAULT 'km',
	"location" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"listing_id" integer,
	"source_listing_id" text,
	"price_amount" integer,
	"price_currency" text DEFAULT 'USD',
	"mileage" integer,
	"mileage_unit" text DEFAULT 'km',
	"listing_status" text,
	"location" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"description" text,
	"metadata" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_source_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"listing_id" integer,
	"source_id" text NOT NULL,
	"raw_html" text,
	"raw_json" text,
	"content_hash" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer,
	"listing_id" integer,
	"source_url" text NOT NULL,
	"stored_path" text,
	"width" integer,
	"height" integer,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"job_type" text NOT NULL,
	"target_url" text,
	"items_discovered" integer,
	"items_processed" integer,
	"items_failed" integer,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"rate_limit_per_minute" integer,
	"rate_limit_per_day" integer,
	"allowed_endpoints" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "api_request_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"token_id" integer,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer,
	"admin_email" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"default_rate_limit" integer,
	"max_collection_jobs_parallel" integer DEFAULT 3 NOT NULL,
	"vin_extraction_enabled" boolean DEFAULT true NOT NULL,
	"photo_storage_enabled" boolean DEFAULT false NOT NULL,
	"raw_data_retention_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_observations" ADD CONSTRAINT "vehicle_observations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_observations" ADD CONSTRAINT "vehicle_observations_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_observations" ADD CONSTRAINT "vehicle_observations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD CONSTRAINT "vehicle_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_source_records" ADD CONSTRAINT "raw_source_records_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_source_records" ADD CONSTRAINT "raw_source_records_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_jobs" ADD CONSTRAINT "collection_jobs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_client_id_api_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicles_vin_idx" ON "vehicles" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "listings_provider_id_idx" ON "listings" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "listings_vin_idx" ON "listings" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "listings_source_id_idx" ON "listings" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "vehicle_obs_vehicle_id_idx" ON "vehicle_observations" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_obs_provider_id_idx" ON "vehicle_observations" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "vehicle_obs_observed_at_idx" ON "vehicle_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "vehicle_obs_source_listing_idx" ON "vehicle_observations" USING btree ("source_listing_id");--> statement-breakpoint
CREATE INDEX "vehicle_events_vehicle_id_idx" ON "vehicle_events" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_events_occurred_at_idx" ON "vehicle_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "raw_source_records_provider_id_idx" ON "raw_source_records" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "raw_source_records_source_id_idx" ON "raw_source_records" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "photos_vehicle_id_idx" ON "photos" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "photos_listing_id_idx" ON "photos" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "collection_jobs_provider_id_idx" ON "collection_jobs" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "collection_jobs_status_idx" ON "collection_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collection_jobs_created_at_idx" ON "collection_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_tokens_client_id_idx" ON "api_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "api_tokens_token_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_request_logs_client_id_idx" ON "api_request_logs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "api_request_logs_requested_at_idx" ON "api_request_logs" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");