import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";
import { listingsTable } from "./listings";

export const rawSourceRecordsTable = pgTable("raw_source_records", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providersTable.id),
  listingId: integer("listing_id").references(() => listingsTable.id),
  sourceId: text("source_id").notNull(),
  requestUrl: text("request_url"),
  parserVersion: text("parser_version"),
  rawHtml: text("raw_html"),
  rawJson: text("raw_json"),
  contentHash: text("content_hash"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("raw_source_records_provider_id_idx").on(table.providerId),
  index("raw_source_records_source_id_idx").on(table.sourceId),
]);

export const insertRawSourceRecordSchema = createInsertSchema(rawSourceRecordsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRawSourceRecord = z.infer<typeof insertRawSourceRecordSchema>;
export type RawSourceRecord = typeof rawSourceRecordsTable.$inferSelect;
