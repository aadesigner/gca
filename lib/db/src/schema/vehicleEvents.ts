import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const vehicleEventsTable = pgTable("vehicle_events", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  eventType: text("event_type").notNull(), // price_change | status_change | new_listing | delisted
  description: text("description"),
  metadata: text("metadata"), // JSON string
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("vehicle_events_vehicle_id_idx").on(table.vehicleId),
  index("vehicle_events_occurred_at_idx").on(table.occurredAt),
  uniqueIndex("vehicle_events_vehicle_type_day_desc_uidx").on(
    table.vehicleId,
    table.eventType,
    sql`DATE(${table.occurredAt} AT TIME ZONE 'UTC')`,
    sql`md5(coalesce(${table.description}, ''))`,
  ),
]);

export const insertVehicleEventSchema = createInsertSchema(vehicleEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertVehicleEvent = z.infer<typeof insertVehicleEventSchema>;
export type VehicleEvent = typeof vehicleEventsTable.$inferSelect;
