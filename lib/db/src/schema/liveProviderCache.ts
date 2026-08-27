import { pgTable, text, serial, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { liveProvidersTable } from "./liveProviders";

export const liveProviderCacheTable = pgTable(
  "live_provider_cache",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => liveProvidersTable.id, { onDelete: "cascade" }),
    queryFingerprint: text("query_fingerprint").notNull(),
    /** JSON array of LiveVehicle objects */
    responseData: text("response_data").notNull(),
    totalCount: integer("total_count").notNull().default(0),
    cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    hitCount: integer("hit_count").notNull().default(0),
  },
  (t) => [
    unique("live_cache_provider_fingerprint").on(t.providerId, t.queryFingerprint),
    index("live_cache_expires_idx").on(t.expiresAt),
    index("live_cache_provider_idx").on(t.providerId),
  ]
);

export type LiveProviderCache = typeof liveProviderCacheTable.$inferSelect;
