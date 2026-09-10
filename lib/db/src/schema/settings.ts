import { pgTable, serial, timestamp, boolean, integer, text, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Single-row settings table (id=1 always)
export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  defaultRateLimit: integer("default_rate_limit"),
  maxCollectionJobsParallel: integer("max_collection_jobs_parallel").notNull().default(8),
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
  minCryptoDepositUsd: numeric("min_crypto_deposit_usd", { precision: 10, scale: 2 }).notNull().default("50.00"),
  recaptchaEnabled: boolean("recaptcha_enabled").notNull().default(false),
  recaptchaSiteKey: text("recaptcha_site_key"),
  recaptchaSecretKey: text("recaptcha_secret_key"),
  /** Minimum v3 score (0–1). */
  recaptchaMinScore: numeric("recaptcha_min_score", { precision: 3, scale: 2 }).notNull().default("0.50"),
  registrationEnabled: boolean("registration_enabled").notNull().default(true),
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

  // —— Email / SMTP ——
  smtpEnabled: boolean("smtp_enabled").notNull().default(false),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port").notNull().default(587),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpFromName: text("smtp_from_name").default("GetCarAPI"),
  smtpFromEmail: text("smtp_from_email"),
  /** Staff inbox for new-ticket / client-reply notifications. */
  emailStaffInbox: text("email_staff_inbox"),
  /** Public site origin used in email links (e.g. https://getcarapi.com). */
  emailPublicBaseUrl: text("email_public_base_url").default("https://getcarapi.com"),

  emailPasswordResetEnabled: boolean("email_password_reset_enabled").notNull().default(false),
  emailSupportStaffReplyEnabled: boolean("email_support_staff_reply_enabled").notNull().default(false),
  emailSupportNewTicketAdminEnabled: boolean("email_support_new_ticket_admin_enabled").notNull().default(false),
  emailSupportClientReplyAdminEnabled: boolean("email_support_client_reply_admin_enabled").notNull().default(false),
  emailPaymentApprovedEnabled: boolean("email_payment_approved_enabled").notNull().default(false),

  emailTplPasswordResetSubject: text("email_tpl_password_reset_subject"),
  emailTplPasswordResetBody: text("email_tpl_password_reset_body"),
  emailTplSupportStaffReplySubject: text("email_tpl_support_staff_reply_subject"),
  emailTplSupportStaffReplyBody: text("email_tpl_support_staff_reply_body"),
  emailTplSupportNewTicketAdminSubject: text("email_tpl_support_new_ticket_admin_subject"),
  emailTplSupportNewTicketAdminBody: text("email_tpl_support_new_ticket_admin_body"),
  emailTplSupportClientReplyAdminSubject: text("email_tpl_support_client_reply_admin_subject"),
  emailTplSupportClientReplyAdminBody: text("email_tpl_support_client_reply_admin_body"),
  emailTplPaymentApprovedSubject: text("email_tpl_payment_approved_subject"),
  emailTplPaymentApprovedBody: text("email_tpl_payment_approved_body"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
