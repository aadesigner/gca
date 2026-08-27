import { pgTable, serial, text, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Snapshots of live FX rates used when converting KRW prices. */
export const fxRatesTable = pgTable("fx_rates", {
  id: serial("id").primaryKey(),
  baseCurrency: text("base_currency").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  /** Quote units per 1 base unit (e.g. USD per 1 KRW). */
  rate: numeric("rate", { precision: 18, scale: 10 }).notNull(),
  /** Base units per 1 quote unit (e.g. KRW per 1 USD). */
  inverseRate: numeric("inverse_rate", { precision: 18, scale: 10 }),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("fx_rates_pair_fetched_idx").on(table.baseCurrency, table.quoteCurrency, table.fetchedAt),
]);

export const insertFxRateSchema = createInsertSchema(fxRatesTable).omit({
  id: true,
  fetchedAt: true,
});
export type InsertFxRate = z.infer<typeof insertFxRateSchema>;
export type FxRate = typeof fxRatesTable.$inferSelect;
