import { pgTable, serial, timestamp, boolean, integer, text, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Single-row settings table (id=1 always)
export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  defaultRateLimit: integer("default_rate_limit"),
  maxCollectionJobsParallel: integer("max_collection_jobs_parallel").notNull().default(6),
  vinExtractionEnabled: boolean("vin_extraction_enabled").notNull().default(true),
  photoStorageEnabled: boolean("photo_storage_enabled").notNull().default(false),
  rawDataRetentionDays: integer("raw_data_retention_days").notNull().default(30),
  defaultMaxPages: integer("default_max_pages").notNull().default(200),
  defaultMaxListings: integer("default_max_listings").notNull().default(5000),
  defaultDelayMs: integer("default_delay_ms").notNull().default(1500),
  /** Plaintext marketing demo key shown on the public live playground. */
  publicDemoToken: text("public_demo_token"),
  /** USD price per VIN-retrieve credit (default $2). */
  creditPriceUsd: numeric("credit_price_usd", { precision: 10, scale: 2 }).notNull().default("2.00"),
  /** Wallet addresses / payment memo shown to clients buying credits. */
  cryptoPaymentInstructions: text("crypto_payment_instructions"),
  /** Minimum USD amount for a crypto credit purchase. */
  minCryptoDepositUsd: numeric("min_crypto_deposit_usd", { precision: 10, scale: 2 }).notNull().default("40.00"),
  recaptchaEnabled: boolean("recaptcha_enabled").notNull().default(false),
  recaptchaSiteKey: text("recaptcha_site_key"),
  recaptchaSecretKey: text("recaptcha_secret_key"),
  /** Minimum v3 score (0–1). */
  recaptchaMinScore: numeric("recaptcha_min_score", { precision: 3, scale: 2 }).notNull().default("0.50"),
  registrationEnabled: boolean("registration_enabled").notNull().default(false),
  /** Allow email/password sign-in on /account/ */
  clientLoginEnabled: boolean("client_login_enabled").notNull().default(true),
  /** Credits granted on self-registration (usually 0). */
  demoStartingCredits: integer("demo_starting_credits").notNull().default(0),
  /** Public API: allow GET /api/v1/vin/{vin} (billed retrieve). */
  apiVinRetrieveEnabled: boolean("api_vin_retrieve_enabled").notNull().default(true),
  /** Public API: allow GET /api/v1/vin/check/{vin} (free). */
  apiVinCheckEnabled: boolean("api_vin_check_enabled").notNull().default(true),
  /** Public API: allow /api/v1/live/* */
  apiLiveEnabled: boolean("api_live_enabled").notNull().default(true),
  /** Shown to clients when live feed is off — pricing / providers / details. */
  liveFeedContactEmail: text("live_feed_contact_email").default("info@getcarapi.com"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
