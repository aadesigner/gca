CREATE TABLE IF NOT EXISTS "fx_rates" (
  "id" serial PRIMARY KEY NOT NULL,
  "base_currency" text NOT NULL,
  "quote_currency" text NOT NULL,
  "rate" numeric(18, 10) NOT NULL,
  "inverse_rate" numeric(18, 10),
  "source" text NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "fx_rates_pair_fetched_idx"
  ON "fx_rates" ("base_currency", "quote_currency", "fetched_at");
