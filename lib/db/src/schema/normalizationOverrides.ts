import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";
import { adminUsersTable } from "./adminUsers";

/**
 * Manual normalization overrides written by admins for low-confidence fields.
 * Stored separately so the original normalized values are preserved for audit,
 * and so we can track provenance (who changed what, and when).
 */
export const normalizationOverridesTable = pgTable("normalization_overrides", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  field: text("field").notNull(), // make | model | year | trim | bodyType | fuelType | transmission | driveType
  originalValue: text("original_value"), // value before override (may be null if field was missing)
  overriddenValue: text("overridden_value").notNull(),
  confidence: text("confidence"), // low | medium | high — confidence of the original normalized value
  overriddenBy: integer("overridden_by").references(() => adminUsersTable.id),
  overriddenByEmail: text("overridden_by_email"),
  reason: text("reason"), // optional admin note
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("norm_overrides_vehicle_id_idx").on(table.vehicleId),
  index("norm_overrides_field_idx").on(table.field),
]);

export const insertNormalizationOverrideSchema = createInsertSchema(normalizationOverridesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNormalizationOverride = z.infer<typeof insertNormalizationOverrideSchema>;
export type NormalizationOverride = typeof normalizationOverridesTable.$inferSelect;
