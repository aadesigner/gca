import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiClientsTable = pgTable("api_clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  passwordHash: text("password_hash"),
  companyName: text("company_name"),
  websiteUrl: text("website_url"),
  telegramUsername: text("telegram_username"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  /** Prepaid VIN-retrieve credits (1 successful retrieve = 1 credit). */
  creditBalance: integer("credit_balance").notNull().default(0),
  /** Demo until the client has an API token; token issuance marks paid. */
  isDemo: boolean("is_demo").notNull().default(true),
  rateLimitPerMinute: integer("rate_limit_per_minute"),
  rateLimitPerDay: integer("rate_limit_per_day"),
  requestsPerVin: integer("requests_per_vin"),
  monthlyGlobalLimit: integer("monthly_global_limit"),
  allowedEndpoints: text("allowed_endpoints"),
  /**
   * Live stock API access. Default off — enable per client in admin.
   * When on, live calls do not consume VIN credits (unlimited within token/rate limits).
   */
  liveFeedEnabled: boolean("live_feed_enabled").notNull().default(false),
  /** When set and in the past, live feed is treated as disabled even if enabled=true. */
  liveFeedExpiresAt: timestamp("live_feed_expires_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApiClientSchema = createInsertSchema(apiClientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertApiClient = z.infer<typeof insertApiClientSchema>;
export type ApiClient = typeof apiClientsTable.$inferSelect;
