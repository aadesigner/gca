import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";

export const collectionJobsTable = pgTable("collection_jobs", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providersTable.id),
  status: text("status").notNull().default("pending"), // pending | running | paused | completed | failed | cancelled
  jobType: text("job_type").notNull(), // full_collection | incremental | single_listing | listing_refresh
  targetUrl: text("target_url"),
  jobConfig: text("job_config"), // JSON blob of filter/options params
  // Legacy progress counters (kept for backward compat)
  itemsDiscovered: integer("items_discovered"),
  itemsProcessed: integer("items_processed"),
  itemsFailed: integer("items_failed"),
  // Detailed progress counters
  pagesProcessed: integer("pages_processed"),
  listingsFetched: integer("listings_fetched"),
  vinsFound: integer("vins_found"),
  vinsNew: integer("vins_new"),
  newObservations: integer("new_observations"),
  duplicatesSkipped: integer("duplicates_skipped"),
  crawlState: text("crawl_state"), // JSON blob of shard/cooldown/health checkpoints
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("collection_jobs_provider_id_idx").on(table.providerId),
  index("collection_jobs_status_idx").on(table.status),
  index("collection_jobs_created_at_idx").on(table.createdAt),
]);

export const insertCollectionJobSchema = createInsertSchema(collectionJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCollectionJob = z.infer<typeof insertCollectionJobSchema>;
export type CollectionJob = typeof collectionJobsTable.$inferSelect;
