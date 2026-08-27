import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  vin: text("vin").notNull().unique(),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  trim: text("trim"),
  bodyType: text("body_type"),
  fuelType: text("fuel_type"),
  transmission: text("transmission"),
  driveType: text("drive_type"),
  engineDisplacement: text("engine_displacement"),
  color: text("color"),
  country: text("country"),
  currentKnownMileage: integer("current_known_mileage"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("vehicles_vin_idx").on(table.vin),
  index("vehicles_country_idx").on(table.country),
  index("vehicles_created_at_idx").on(table.createdAt),
]);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
