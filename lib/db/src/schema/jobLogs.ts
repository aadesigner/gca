import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { collectionJobsTable } from "./collectionJobs";

/**
 * Per-job detailed log stream.
 * Collector pipeline writes one row per step (fetch, parse, VIN match,
 * observation created/skipped) so the admin UI can stream live job progress.
 */
export const jobLogsTable = pgTable("job_logs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => collectionJobsTable.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("info"), // info | warning | error
  stage: text("stage").notNull(), // fetch | parse | vin_match | observation | skip | complete | error
  message: text("message").notNull(),
  details: text("details"), // JSON blob (e.g. sourceId, vin, priceAmount)
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("job_logs_job_id_idx").on(table.jobId),
  index("job_logs_occurred_at_idx").on(table.occurredAt),
  index("job_logs_job_occurred_idx").on(table.jobId, table.occurredAt),
]);

export const insertJobLogSchema = createInsertSchema(jobLogsTable).omit({
  id: true,
});
export type InsertJobLog = z.infer<typeof insertJobLogSchema>;
export type JobLog = typeof jobLogsTable.$inferSelect;
