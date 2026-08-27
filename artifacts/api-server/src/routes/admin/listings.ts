import { Router, type IRouter } from "express";
import { db, listingsTable, providersTable } from "@workspace/db";
import { eq, count, and, sql } from "drizzle-orm";
import {
  ListListingsQueryParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { withListingMileage } from "../../lib/mileage";
import { getKrwFxSnapshot, getUsdFxTable, withPriceFx } from "../../lib/fx";
import { streamListingCsv, type ListingExportQuery } from "../../lib/listing-export";

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

  const { providerId, vin, limit = 50, offset = 0 } = params.data;

  const conditions = [];
  if (providerId) conditions.push(eq(listingsTable.providerId, providerId));
  if (vin) conditions.push(eq(listingsTable.vin, vin));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [listings, [totalRow]] = await Promise.all([
    db
      .select({
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
      })
      .from(listingsTable)
      .leftJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
      .where(whereClause)
      .orderBy(sql`${listingsTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(listingsTable).where(whereClause),
  ]);

  const fx = await getKrwFxSnapshot();
  const usdTable = await getUsdFxTable();
  res.json({
    items: listings.map((row) => withPriceFx(withListingMileage(row), fx, usdTable)),
    total: Number(totalRow?.c ?? 0),
  });
});

export default router;
