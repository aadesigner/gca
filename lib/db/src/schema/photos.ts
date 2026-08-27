import { pgTable, text, serial, timestamp, integer, boolean, index, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { listingsTable } from "./listings";
import { vehiclesTable } from "./vehicles";

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  listingId: integer("listing_id").references(() => listingsTable.id),
  sourceUrl: text("source_url").notNull(),
  storedPath: text("stored_path"),
  width: integer("width"),
  height: integer("height"),
  isPrimary: boolean("is_primary").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  /** gallery | exterior_3d | interior_3d */
  photoGroup: text("photo_group").notNull().default("gallery"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("photos_vehicle_id_idx").on(table.vehicleId),
  index("photos_listing_id_idx").on(table.listingId),
  index("photos_vehicle_group_idx").on(table.vehicleId, table.photoGroup),
  unique("photos_listing_source_url_uidx").on(table.listingId, table.sourceUrl),
  uniqueIndex("photos_vehicle_source_url_uidx").on(table.vehicleId, table.sourceUrl),
]);

export const insertPhotoSchema = createInsertSchema(photosTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
