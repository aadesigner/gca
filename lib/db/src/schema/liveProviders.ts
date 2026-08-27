import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const liveProvidersTable = pgTable("live_providers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  internalName: text("internal_name").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  cacheTtlSeconds: integer("cache_ttl_seconds").notNull().default(60),
  /** AES-256-GCM encrypted JSON: { apiUrl, apiToken } */
  credentialsEncrypted: text("credentials_encrypted"),
  credentialsIv: text("credentials_iv"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestOk: boolean("last_test_ok"),
  lastTestError: text("last_test_error"),
  /**
   * Lifetime counters — incremented on every upstream API call or cache hit.
   * These persist through cache entry expiry/upsert cycles so stats are accurate
   * historical totals, not just a reflection of currently retained cache rows.
   */
  totalUpstreamCalls: integer("total_upstream_calls").notNull().default(0),
  totalCacheHits: integer("total_cache_hits").notNull().default(0),
  /** Timestamp of the last successful upstream provider call. Persisted on the
   *  provider row so it survives cache-entry TTL expiry and cleanup. */
  lastUpstreamCallAt: timestamp("last_upstream_call_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLiveProviderSchema = createInsertSchema(liveProvidersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  credentialsEncrypted: true,
  credentialsIv: true,
  lastTestedAt: true,
  lastTestOk: true,
  lastTestError: true,
  totalUpstreamCalls: true,
  totalCacheHits: true,
  lastUpstreamCallAt: true,
});
export type InsertLiveProvider = z.infer<typeof insertLiveProviderSchema>;
export type LiveProvider = typeof liveProvidersTable.$inferSelect;
