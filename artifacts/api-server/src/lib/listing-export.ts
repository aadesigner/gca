/**
 * Stream collected listings (VIN + specs) as CSV for admin export.
 */
import type { Response } from "express";
import { db, listingsTable, vehiclesTable, providersTable } from "@workspace/db";
import { and, eq, gt, gte, ilike, isNotNull, lte, or, sql } from "drizzle-orm";
import { getKrwFxSnapshot, getUsdFxTable, livePriceUsd, type FxSnapshot, type UsdFxTable } from "./fx";

const BATCH = 1000;

export type ListingExportQuery = {
  providerId?: number;
  enabledOnly?: boolean;
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  fuel?: string;
  transmission?: string;
  minMileage?: number;
  maxMileage?: number;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  country?: string;
};

const HEADER = [
  "vin",
  "make",
  "model",
  "year",
  "trim",
  "fuel",
  "transmission",
  "drivetrain",
  "engine",
  "color",
  "body_type",
  "mileage_km",
  "mileage_miles",
  "price",
  "currency",
  "price_usd",
  "price_eur",
  "location",
  "country",
  "active",
  "source_id",
  "listing_url",
  "provider",
  "first_seen",
  "last_seen",
].join(",");

function csvCell(value: unknown): string {
  if (value == null || value === "") return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function priceUsdEur(
  amount: number | null | undefined,
  currency: string | null | undefined,
  fx: FxSnapshot | null,
  usdTable: UsdFxTable | null,
  persistedUsd?: number | null,
  persistedEur?: number | null,
): { usd: string; eur: string } {
  if (persistedUsd != null && Number.isFinite(persistedUsd)) {
    const eur =
      persistedEur != null && Number.isFinite(persistedEur)
        ? Number(persistedEur)
        : fx && fx.usdPerKrw > 0
          ? roundMoney(Number(persistedUsd) * (fx.eurPerKrw / fx.usdPerKrw))
          : null;
    return {
      usd: String(roundMoney(Number(persistedUsd))),
      eur: eur != null ? String(eur) : "",
    };
  }
  const usd = livePriceUsd({ price: amount ?? undefined, currency: currency ?? undefined }, fx, usdTable);
  if (usd == null) return { usd: "", eur: "" };
  const eur =
    usdTable?.perUsd.EUR && usdTable.perUsd.EUR > 0
      ? roundMoney(usd * usdTable.perUsd.EUR)
      : fx && fx.usdPerKrw > 0
        ? roundMoney(usd * (fx.eurPerKrw / fx.usdPerKrw))
        : null;
  return {
    usd: String(roundMoney(usd)),
    eur: eur != null ? String(eur) : "",
  };
}

export function parseJobConfigFilters(raw?: string | null): ListingExportQuery {
  if (!raw) return {};
  try {
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    return {
      make: str(cfg.brand) ?? str(cfg.make),
      model: str(cfg.model),
      yearFrom: num(cfg.yearFrom),
      yearTo: num(cfg.yearTo),
      fuel: str(cfg.fuel),
      transmission: str(cfg.transmission),
      minMileage: num(cfg.minMileage),
      maxMileage: num(cfg.maxMileage),
      minPrice: num(cfg.minPrice),
      maxPrice: num(cfg.maxPrice),
      location: str(cfg.location),
      country: str(cfg.country),
    };
  } catch {
    return {};
  }
}

function buildWhere(query: ListingExportQuery) {
  const conditions = [
    or(isNotNull(listingsTable.vin), isNotNull(vehiclesTable.vin)),
  ];
  if (query.providerId) conditions.push(eq(listingsTable.providerId, query.providerId));
  if (query.enabledOnly) conditions.push(eq(providersTable.enabled, true));
  if (query.make) conditions.push(ilike(vehiclesTable.make, `%${query.make}%`));
  if (query.model) conditions.push(ilike(vehiclesTable.model, `%${query.model}%`));
  if (query.yearFrom != null) conditions.push(gte(vehiclesTable.year, query.yearFrom));
  if (query.yearTo != null) conditions.push(lte(vehiclesTable.year, query.yearTo));
  if (query.fuel) conditions.push(ilike(vehiclesTable.fuelType, `%${query.fuel}%`));
  if (query.transmission) conditions.push(ilike(vehiclesTable.transmission, `%${query.transmission}%`));
  if (query.minMileage != null) conditions.push(gte(listingsTable.mileage, query.minMileage));
  if (query.maxMileage != null) conditions.push(lte(listingsTable.mileage, query.maxMileage));
  if (query.minPrice != null) conditions.push(gte(listingsTable.priceAmount, query.minPrice));
  if (query.maxPrice != null) conditions.push(lte(listingsTable.priceAmount, query.maxPrice));
  if (query.location) conditions.push(ilike(listingsTable.location, `%${query.location}%`));
  if (query.country) {
    conditions.push(
      or(ilike(listingsTable.country, `%${query.country}%`), ilike(vehiclesTable.country, `%${query.country}%`))!,
    );
  }
  return and(...conditions);
}

export async function streamListingCsv(
  res: Response,
  query: ListingExportQuery,
  filename: string,
): Promise<void> {
  const fx = await getKrwFxSnapshot();
  const usdTable = await getUsdFxTable();
  const where = buildWhere(query);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.write("\uFEFF");
  res.write(`${HEADER}\n`);

  let lastId = 0;
  for (;;) {
    const rows = await db
      .select({
        id: listingsTable.id,
        vin: sql<string>`COALESCE(${listingsTable.vin}, ${vehiclesTable.vin})`,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        year: vehiclesTable.year,
        trim: vehiclesTable.trim,
        fuel: vehiclesTable.fuelType,
        transmission: vehiclesTable.transmission,
        drivetrain: vehiclesTable.driveType,
        engine: vehiclesTable.engineDisplacement,
        color: vehiclesTable.color,
        bodyType: vehiclesTable.bodyType,
        mileageKm: listingsTable.mileage,
        price: listingsTable.priceAmount,
        currency: listingsTable.priceCurrency,
        priceUsd: listingsTable.priceUsd,
        priceEur: listingsTable.priceEur,
        location: listingsTable.location,
        country: sql<string>`COALESCE(${listingsTable.country}, ${vehiclesTable.country})`,
        active: listingsTable.isActive,
        sourceId: listingsTable.sourceId,
        listingUrl: listingsTable.sourceUrl,
        provider: providersTable.name,
        firstSeen: listingsTable.firstSeenAt,
        lastSeen: listingsTable.lastSeenAt,
      })
      .from(listingsTable)
      .innerJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
      .leftJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id))
      .where(and(gt(listingsTable.id, lastId), where))
      .orderBy(listingsTable.id)
      .limit(BATCH);

    if (rows.length === 0) break;

    for (const row of rows) {
      const miles =
        row.mileageKm != null ? Math.round(row.mileageKm * 0.621371) : null;
      const fxPrices = priceUsdEur(row.price, row.currency, fx, usdTable, row.priceUsd, row.priceEur);
      res.write(
        [
          csvCell(row.vin),
          csvCell(row.make),
          csvCell(row.model),
          csvCell(row.year),
          csvCell(row.trim),
          csvCell(row.fuel),
          csvCell(row.transmission),
          csvCell(row.drivetrain),
          csvCell(row.engine),
          csvCell(row.color),
          csvCell(row.bodyType),
          csvCell(row.mileageKm),
          csvCell(miles),
          csvCell(row.price),
          csvCell(row.currency),
          csvCell(fxPrices.usd),
          csvCell(fxPrices.eur),
          csvCell(row.location),
          csvCell(row.country),
          csvCell(row.active ? "yes" : "no"),
          csvCell(row.sourceId),
          csvCell(row.listingUrl),
          csvCell(row.provider),
          csvCell(row.firstSeen),
          csvCell(row.lastSeen),
        ].join(",") + "\n",
      );
    }

    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }

  res.end();
}
