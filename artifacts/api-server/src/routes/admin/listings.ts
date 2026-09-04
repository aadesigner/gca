import { Router, type IRouter } from "express";
import { db, listingsTable, providersTable, vehiclesTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import {
  ListListingsQueryParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { withListingMileage } from "../../lib/mileage";
import { getKrwFxSnapshot, getUsdFxTable, withPriceFx, shouldAttachKrw } from "../../lib/fx";
import { streamListingCsv, type ListingExportQuery, buildListingFilterWhere } from "../../lib/listing-export";

const router: IRouter = Router();

function numQuery(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function strQuery(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.trim();
}

// GET /api/admin/listings/export — CSV of crawled VINs (one or all enabled sites)
router.get("/admin/listings/export", requireAdmin, async (req, res): Promise<void> => {
  const q = req.query as Record<string, unknown>;
  const enabledOnly = q.enabledOnly === "1" || q.enabledOnly === "true" || q.enabledOnly === undefined;
  const providerId = numQuery(q.providerId);
  const query: ListingExportQuery = {
    providerId,
    enabledOnly: providerId ? false : enabledOnly,
    make: strQuery(q.make) ?? strQuery(q.brand),
    model: strQuery(q.model),
    yearFrom: numQuery(q.yearFrom),
    yearTo: numQuery(q.yearTo),
    fuel: strQuery(q.fuel),
    transmission: strQuery(q.transmission),
    minMileage: numQuery(q.minMileage),
    maxMileage: numQuery(q.maxMileage),
    minPrice: numQuery(q.minPrice),
    maxPrice: numQuery(q.maxPrice),
    location: strQuery(q.location),
    country: strQuery(q.country),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = providerId
    ? `provider-${providerId}-vins-${stamp}.csv`
    : `all-enabled-vins-${stamp}.csv`;
  await streamListingCsv(res, query, filename);
});

// GET /api/admin/listings
router.get("/admin/listings", requireAdmin, async (req, res): Promise<void> => {
  const params = ListListingsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const q = params.data as {
    providerId?: number;
    vin?: string;
    make?: string;
    model?: string;
    country?: string;
    yearFrom?: number;
    yearTo?: number;
    minPrice?: number;
    maxPrice?: number;
    limit?: number;
    offset?: number;
  };
  const {
    providerId,
    vin,
    make,
    model,
    country,
    yearFrom,
    yearTo,
    minPrice,
    maxPrice,
    limit = 50,
    offset = 0,
  } = q;

  const needsVehicleJoin = Boolean(make || model || yearFrom || yearTo || country);
  const whereClause = buildListingFilterWhere({
    providerId,
    vin,
    make,
    model,
    country,
    yearFrom,
    yearTo,
    minPrice,
    maxPrice,
  });

  const selectFields = {
    id: listingsTable.id,
    providerId: listingsTable.providerId,
    providerName: providersTable.name,
    vehicleId: listingsTable.vehicleId,
    vin: listingsTable.vin,
    sourceId: listingsTable.sourceId,
    sourceUrl: listingsTable.sourceUrl,
    title: listingsTable.title,
    priceAmount: listingsTable.priceAmount,
    priceCurrency: listingsTable.priceCurrency,
    mileage: listingsTable.mileage,
    mileageUnit: listingsTable.mileageUnit,
    location: listingsTable.location,
    country: listingsTable.country,
    isActive: listingsTable.isActive,
    createdAt: listingsTable.createdAt,
    updatedAt: listingsTable.updatedAt,
  };

  let listQ = db
    .select(selectFields)
    .from(listingsTable)
    .leftJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
    .$dynamic();
  let countQ = db.select({ c: count() }).from(listingsTable).$dynamic();

  if (needsVehicleJoin) {
    listQ = listQ.leftJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id));
    countQ = countQ.leftJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id));
  }

  const [listings, [totalRow]] = await Promise.all([
    listQ.where(whereClause).orderBy(sql`${listingsTable.createdAt} DESC`).limit(limit).offset(offset),
    countQ.where(whereClause),
  ]);

  const fx = await getKrwFxSnapshot();
  const usdTable = await getUsdFxTable();
  res.json({
    items: listings.map((row) =>
      withPriceFx(withListingMileage(row), fx, usdTable, shouldAttachKrw(row.country, row.priceCurrency)),
    ),
    total: Number(totalRow?.c ?? 0),
  });
});

export default router;
