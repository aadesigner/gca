import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";
import { collectionJobsTable } from "./collectionJobs";

/**
 * Structured error / observability event log.
 * Written by the collector pipeline, API middleware, and provider adapters
 * for provider errors, parser failures, VIN extraction failures, HTTP errors,
 * rate-limit events, and DB errors.
 */
export const systemEventsTable = pgTable("system_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(), // provider_error | parser_error | vin_extraction_failure | http_error | rate_limit | db_error | api_error
  severity: text("severity").notNull().default("error"), // info | warning | error | critical
  providerId: integer("provider_id").references(() => providersTable.id),
  jobId: integer("job_id").references(() => collectionJobsTable.id),
  message: text("message").notNull(),
  details: text("details"), // JSON blob for structured context
  sourceUrl: text("source_url"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("system_events_event_type_idx").on(table.eventType),
  index("system_events_occurred_at_idx").on(table.occurredAt),
  index("system_events_provider_id_idx").on(table.providerId),
  index("system_events_job_id_idx").on(table.jobId),
  index("system_events_severity_idx").on(table.severity),
]);

export const insertSystemEventSchema = createInsertSchema(systemEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSystemEvent = z.infer<typeof insertSystemEventSchema>;
export type SystemEvent = typeof systemEventsTable.$inferSelect;
