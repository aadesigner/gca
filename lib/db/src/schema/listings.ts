import { pgTable, text, serial, timestamp, boolean, integer, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { providersTable } from "./providers";
import { vehiclesTable } from "./vehicles";

export const listingsTable = pgTable("listings", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => providersTable.id),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  vin: text("vin"),
  sourceId: text("source_id").notNull(), // provider's own listing ID
  sourceUrl: text("source_url"),
  title: text("title"),
  priceAmount: integer("price_amount"), // original currency major units
  priceCurrency: text("price_currency").default("USD"),
  /** Frozen USD major units at fetch time (null until converted). */
  priceUsd: integer("price_usd"),
  /** Frozen EUR major units at fetch time (null until converted). */
  priceEur: integer("price_eur"),
  mileage: integer("mileage"),
  mileageUnit: text("mileage_unit").default("km"),
  location: text("location"),
  country: text("country"),
  isActive: boolean("is_active").notNull().default(true),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("listings_provider_id_idx").on(table.providerId),
  index("listings_vehicle_id_idx").on(table.vehicleId),
  index("listings_vin_idx").on(table.vin),
  index("listings_source_id_idx").on(table.sourceId),
  index("listings_country_idx").on(table.country),
  index("listings_created_at_idx").on(table.createdAt),
  unique("listings_provider_source_uidx").on(table.providerId, table.sourceId),
]);

export const insertListingSchema = createInsertSchema(listingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertListing = z.infer<typeof insertListingSchema>;
export type Listing = typeof listingsTable.$inferSelect;
