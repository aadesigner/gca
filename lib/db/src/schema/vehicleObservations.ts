import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";
import { providersTable } from "./providers";
import { listingsTable } from "./listings";

export const vehicleObservationsTable = pgTable("vehicle_observations", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  providerId: integer("provider_id").notNull().references(() => providersTable.id),
  listingId: integer("listing_id").references(() => listingsTable.id),
  sourceListingId: text("source_listing_id"),
  fingerprintHash: text("fingerprint_hash"),
  priceAmount: integer("price_amount"),
  priceCurrency: text("price_currency").default("USD"),
  /** Frozen USD major units at observation time. */
  priceUsd: integer("price_usd"),
  /** Frozen EUR major units at observation time. */
  priceEur: integer("price_eur"),
  mileage: integer("mileage"),
  mileageUnit: text("mileage_unit").default("km"),
  listingStatus: text("listing_status"), // active | sold | expired
  location: text("location"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  /** Source-site first publish / advertise time when known. */
  sourceListedAt: timestamp("source_listed_at", { withTimezone: true }),
  /** Source-site last modified time when known. */
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("vehicle_obs_vehicle_id_idx").on(table.vehicleId),
  index("vehicle_obs_provider_id_idx").on(table.providerId),
  index("vehicle_obs_observed_at_idx").on(table.observedAt),
  index("vehicle_obs_source_listing_idx").on(table.sourceListingId),
  index("vehicle_obs_fingerprint_idx").on(table.fingerprintHash),
  uniqueIndex("vehicle_obs_fingerprint_unique_idx").on(table.fingerprintHash),
]);

export const insertVehicleObservationSchema = createInsertSchema(vehicleObservationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertVehicleObservation = z.infer<typeof insertVehicleObservationSchema>;
export type VehicleObservation = typeof vehicleObservationsTable.$inferSelect;
