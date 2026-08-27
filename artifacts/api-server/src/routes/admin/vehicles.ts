import { Router, type IRouter } from "express";
import {
  db,
  vehiclesTable,
  vehicleObservationsTable,
  vehicleEventsTable,
  providersTable,
  listingsTable,
  photosTable,
} from "@workspace/db";
import { eq, count, ilike, or, and, gte, lte, sql, inArray } from "drizzle-orm";
import {
  ListVehiclesQueryParams,
  GetVehicleParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import { withListingMileage, withVehicleMileage } from "../../lib/mileage";
import { deleteAllVehicles, deleteVehicleByVin } from "../../lib/vehicle-delete";
import { translateEncarEventDescription } from "../../lib/providers/encar-locale";
import { isEmptyInsuranceAccidentEvent } from "../../lib/providers/encar-history";
import { getKrwFxSnapshot, getUsdFxTable, withPriceFx } from "../../lib/fx";
import { buildOwnerChangeTable } from "../../lib/owner-changes";
import { buildAuctionSales } from "../../lib/auction-sales";
import { buildAccidentTable } from "../../lib/accidents";
import { buildSalvageRecord } from "../../lib/salvage-title";
import { splitPhotosNewOld } from "../../lib/photo-response";

const router: IRouter = Router();

function buildVehicleConditions(query: Record<string, unknown>) {
  const parsed = ListVehiclesQueryParams.safeParse(query);
  if (!parsed.success) return { error: parsed.error.message as string };

  const {
    search,
    make,
    model,
    yearFrom,
    yearTo,
    fuelType,
    transmission,
    providerId,
    country,
  } = parsed.data;

  // Accept `brand` as alias for `make` (job filterParams use brand)
  const brandFilter =
    typeof query.brand === "string" && query.brand.trim()
      ? query.brand.trim()
      : undefined;
  const makeFilter = make ?? brandFilter;

  const conditions: ReturnType<typeof eq>[] = [];

  if (search) {
    const q = search.trim();
    // Exact/prefix VIN search uses vin index; avoid leading-% scan for chassis lookups.
    if (/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(q)) {
      conditions.push(ilike(vehiclesTable.vin, `${q}%`) as any);
    } else {
      conditions.push(
        or(
          ilike(vehiclesTable.vin, `%${q}%`),
          ilike(vehiclesTable.make, `%${q}%`),
          ilike(vehiclesTable.model, `%${q}%`),
        ) as any,
      );
    }
  }

  if (makeFilter) conditions.push(ilike(vehiclesTable.make, `%${makeFilter}%`) as any);
  if (model) conditions.push(ilike(vehiclesTable.model, `%${model}%`) as any);
  if (yearFrom) conditions.push(gte(vehiclesTable.year, yearFrom) as any);
  if (yearTo) conditions.push(lte(vehiclesTable.year, yearTo) as any);
  if (fuelType) conditions.push(ilike(vehiclesTable.fuelType, `%${fuelType}%`) as any);
  if (transmission) conditions.push(ilike(vehiclesTable.transmission, `%${transmission}%`) as any);
  if (country) conditions.push(ilike(vehiclesTable.country, `%${country}%`) as any);

  if (providerId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${listingsTable} WHERE ${listingsTable.vehicleId} = ${vehiclesTable.id} AND ${listingsTable.providerId} = ${providerId})` as any,
    );
  }

  const whereClause = conditions.length > 0 ? and(...(conditions as any[])) : undefined;

  return { whereClause, params: parsed.data };
}

// GET /api/admin/vehicles/stats
router.get("/admin/vehicles/stats", requireAdmin, async (req, res): Promise<void> => {
  const built = buildVehicleConditions(req.query);
  if ("error" in built) {
    res.status(400).json({ error: built.error });
    return;
  }

  const { whereClause } = built;

  const [[totalRow], [withListingsRow], [withObsRow], byMakeRows, byCountryRows, byProviderRows] = await Promise.all([
    db.select({ c: count() }).from(vehiclesTable).where(whereClause),
    db
      .select({ c: count() })
      .from(vehiclesTable)
      .where(
        whereClause
          ? and(
              whereClause,
              sql`EXISTS (SELECT 1 FROM ${listingsTable} WHERE ${listingsTable.vehicleId} = ${vehiclesTable.id})`,
            )
          : sql`EXISTS (SELECT 1 FROM ${listingsTable} WHERE ${listingsTable.vehicleId} = ${vehiclesTable.id})`,
      ),
    db
      .select({ c: count() })
      .from(vehiclesTable)
      .where(
        whereClause
          ? and(
              whereClause,
              sql`EXISTS (SELECT 1 FROM ${vehicleObservationsTable} WHERE ${vehicleObservationsTable.vehicleId} = ${vehiclesTable.id})`,
            )
          : sql`EXISTS (SELECT 1 FROM ${vehicleObservationsTable} WHERE ${vehicleObservationsTable.vehicleId} = ${vehiclesTable.id})`,
      ),
    db
      .select({
        make: vehiclesTable.make,
        count: sql<number>`count(*)::int`,
      })
      .from(vehiclesTable)
      .where(whereClause)
      .groupBy(vehiclesTable.make)
      .orderBy(sql`count(*) DESC`)
      .limit(30),
    db
      .select({
        country: vehiclesTable.country,
        count: sql<number>`count(*)::int`,
      })
      .from(vehiclesTable)
      .where(whereClause)
      .groupBy(vehiclesTable.country)
      .orderBy(sql`count(*) DESC`)
      .limit(20),
    db
      .select({
        id: providersTable.id,
        name: providersTable.name,
        count: sql<number>`count(distinct ${listingsTable.vehicleId})::int`,
      })
      .from(listingsTable)
      .innerJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
      .where(sql`${listingsTable.vehicleId} IS NOT NULL`)
      .groupBy(providersTable.id, providersTable.name)
      .orderBy(sql`count(distinct ${listingsTable.vehicleId}) DESC`),
  ]);

  res.json({
    total: Number(totalRow?.c ?? 0),
    withListings: Number(withListingsRow?.c ?? 0),
    withObservations: Number(withObsRow?.c ?? 0),
    byMake: byMakeRows.map((r) => ({ make: r.make, count: Number(r.count) })),
    byCountry: byCountryRows.map((r) => ({ country: r.country, count: Number(r.count) })),
    byProvider: byProviderRows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })),
  });
});

// DELETE /api/admin/vehicles/purge — remove all vehicles and related history
router.delete("/admin/vehicles/purge", requireAdmin, async (req, res): Promise<void> => {
  const deleted = await deleteAllVehicles();

  await writeAuditLog({
    req,
    action: "vehicle.purge_all",
    entityType: "vehicle",
    details: { deleted },
  });

  res.json({ deleted });
});

// GET /api/admin/vehicles
router.get("/admin/vehicles", requireAdmin, async (req, res): Promise<void> => {
  const built = buildVehicleConditions(req.query);
  if ("error" in built) {
    res.status(400).json({ error: built.error });
    return;
  }

  const { whereClause, params } = built;
  const limit = Math.min(100, Math.max(1, Number(params.limit ?? 50) || 50));
  const offset = Math.max(0, Number(params.offset ?? 0) || 0);

  // Page vehicles first — avoid full-table GROUP BY joins on listings/observations.
  const [vehicles, [totalRow]] = await Promise.all([
    db
      .select({
        id: vehiclesTable.id,
        vin: vehiclesTable.vin,
        make: vehiclesTable.make,
        model: vehiclesTable.model,
        year: vehiclesTable.year,
        trim: vehiclesTable.trim,
        bodyType: vehiclesTable.bodyType,
        fuelType: vehiclesTable.fuelType,
        transmission: vehiclesTable.transmission,
        driveType: vehiclesTable.driveType,
        engineDisplacement: vehiclesTable.engineDisplacement,
        color: vehiclesTable.color,
        country: vehiclesTable.country,
        currentKnownMileage: vehiclesTable.currentKnownMileage,
        lastSeenAt: vehiclesTable.lastSeenAt,
        createdAt: vehiclesTable.createdAt,
        updatedAt: vehiclesTable.updatedAt,
      })
      .from(vehiclesTable)
      .where(whereClause)
      .orderBy(sql`${vehiclesTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(vehiclesTable).where(whereClause),
  ]);

  const vehicleIds = vehicles.map((v) => v.id).filter((id): id is number => id != null);
  if (vehicleIds.length === 0) {
    res.json({ items: [], total: Number(totalRow?.c ?? 0) });
    return;
  }

  const [listingCountRows, observationCountRows, providerRows, photoAggRows, thumbRows] =
    await Promise.all([
      db
        .select({
          vehicleId: listingsTable.vehicleId,
          listingCount: sql<number>`count(*)::int`,
        })
        .from(listingsTable)
        .where(inArray(listingsTable.vehicleId, vehicleIds))
        .groupBy(listingsTable.vehicleId),
      db
        .select({
          vehicleId: vehicleObservationsTable.vehicleId,
          observationCount: sql<number>`count(*)::int`,
        })
        .from(vehicleObservationsTable)
        .where(inArray(vehicleObservationsTable.vehicleId, vehicleIds))
        .groupBy(vehicleObservationsTable.vehicleId),
      db
        .select({
          vehicleId: listingsTable.vehicleId,
          name: providersTable.name,
        })
        .from(listingsTable)
        .innerJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
        .where(inArray(listingsTable.vehicleId, vehicleIds)),
      // List UI only needs CDN thumb + counts — do not load every photo/source URL.
      db
        .select({
          vehicleId: photosTable.vehicleId,
          photosNewCount: sql<number>`count(*) FILTER (
            WHERE ${photosTable.storedPath} ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'
          )::int`,
          photosOldCount: sql<number>`count(*) FILTER (
            WHERE ${photosTable.sourceUrl} ~* '^https?://'
          )::int`,
        })
        .from(photosTable)
        .where(inArray(photosTable.vehicleId, vehicleIds))
        .groupBy(photosTable.vehicleId),
      db
        .select({
          vehicleId: photosTable.vehicleId,
          id: photosTable.id,
          url: photosTable.storedPath,
          isPrimary: photosTable.isPrimary,
          sortOrder: photosTable.sortOrder,
        })
        .from(photosTable)
        .where(
          and(
            inArray(photosTable.vehicleId, vehicleIds),
            sql`${photosTable.storedPath} ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'`,
          ),
        )
        .orderBy(
          sql`${photosTable.isPrimary} DESC NULLS LAST`,
          photosTable.sortOrder,
          photosTable.id,
        ),
    ]);

  const listingByVehicle = new Map(
    listingCountRows.map((r) => [r.vehicleId!, Number(r.listingCount)]),
  );
  const obsByVehicle = new Map(
    observationCountRows.map((r) => [r.vehicleId!, Number(r.observationCount)]),
  );
  const providersByVehicle = new Map<number, string[]>();
  for (const row of providerRows) {
    if (row.vehicleId == null || !row.name) continue;
    const list = providersByVehicle.get(row.vehicleId) ?? [];
    if (!list.includes(row.name)) list.push(row.name);
    providersByVehicle.set(row.vehicleId, list);
  }
  const photoCounts = new Map(
    photoAggRows.map((r) => [
      r.vehicleId!,
      { neu: Number(r.photosNewCount), old: Number(r.photosOldCount) },
    ]),
  );
  const thumbByVehicle = new Map<number, { id: number; url: string; isPrimary: boolean; sortOrder: number }>();
  for (const row of thumbRows) {
    if (row.vehicleId == null || !row.url || thumbByVehicle.has(row.vehicleId)) continue;
    thumbByVehicle.set(row.vehicleId, {
      id: row.id,
      url: row.url,
      isPrimary: Boolean(row.isPrimary),
      sortOrder: row.sortOrder ?? 0,
    });
  }

  res.json({
    items: vehicles.map((v) => {
      const counts = photoCounts.get(v.id) ?? { neu: 0, old: 0 };
      const thumb = thumbByVehicle.get(v.id);
      // Keep photosNew/photosOld shape for admin UI: one CDN thumb + length via padded empty slots avoided —
      // UI uses length for counts; prefer photoCounts when present (updated dashboard).
      const photosNew = thumb
        ? [
            {
              id: thumb.id,
              url: thumb.url,
              provider: "cloudflare" as const,
              isPrimary: thumb.isPrimary,
              sortOrder: thumb.sortOrder,
              width: null,
              height: null,
              group: "gallery" as const,
            },
          ]
        : [];
      return {
        ...withVehicleMileage({
          ...v,
          listingCount: listingByVehicle.get(v.id) ?? 0,
          observationCount: obsByVehicle.get(v.id) ?? 0,
        }),
        providerNames: providersByVehicle.get(v.id) ?? [],
        photosNew,
        // Empty array — counts carried separately so we don't ship Import Motor / provider URLs on list.
        photosOld: [],
        photoCounts: { new: counts.neu, old: counts.old },
      };
    }),
    total: Number(totalRow?.c ?? 0),
  });
});

// GET /api/admin/vehicles/:vin
router.get("/admin/vehicles/:vin", requireAdmin, async (req, res): Promise<void> => {
  const params = GetVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.vin, params.data.vin));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const [observations, events, photos, listings] = await Promise.all([
    db
      .select({
        id: vehicleObservationsTable.id,
        vehicleId: vehicleObservationsTable.vehicleId,
        providerId: vehicleObservationsTable.providerId,
        providerName: providersTable.name,
        sourceListingId: vehicleObservationsTable.sourceListingId,
        priceAmount: vehicleObservationsTable.priceAmount,
        priceCurrency: vehicleObservationsTable.priceCurrency,
        mileage: vehicleObservationsTable.mileage,
        mileageUnit: vehicleObservationsTable.mileageUnit,
        listingStatus: vehicleObservationsTable.listingStatus,
        location: vehicleObservationsTable.location,
        observedAt: vehicleObservationsTable.observedAt,
      })
      .from(vehicleObservationsTable)
      .leftJoin(providersTable, eq(vehicleObservationsTable.providerId, providersTable.id))
      .where(eq(vehicleObservationsTable.vehicleId, vehicle.id))
      .orderBy(sql`${vehicleObservationsTable.observedAt} DESC`)
      .limit(100),
    db
      .select()
      .from(vehicleEventsTable)
      .where(eq(vehicleEventsTable.vehicleId, vehicle.id))
      .orderBy(sql`${vehicleEventsTable.occurredAt} DESC`)
      .limit(100),
    db
      .select({
        id: photosTable.id,
        sourceUrl: photosTable.sourceUrl,
        storedPath: photosTable.storedPath,
        isPrimary: photosTable.isPrimary,
        sortOrder: photosTable.sortOrder,
        width: photosTable.width,
        height: photosTable.height,
        photoGroup: photosTable.photoGroup,
      })
      .from(photosTable)
      .where(eq(photosTable.vehicleId, vehicle.id))
      .orderBy(photosTable.sortOrder, photosTable.id),
    db
      .select({
        id: listingsTable.id,
        providerId: listingsTable.providerId,
        providerName: providersTable.name,
        providerInternalName: providersTable.internalName,
        sourceId: listingsTable.sourceId,
        sourceUrl: listingsTable.sourceUrl,
        title: listingsTable.title,
        isActive: listingsTable.isActive,
        lastSeenAt: listingsTable.lastSeenAt,
      })
      .from(listingsTable)
      .leftJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
      .where(eq(listingsTable.vehicleId, vehicle.id))
      .orderBy(sql`${listingsTable.lastSeenAt} DESC NULLS LAST`)
      .limit(50),
  ]);

  const [listingRow, obsRow] = await Promise.all([
    db.select({ c: count() }).from(listingsTable).where(eq(listingsTable.vehicleId, vehicle.id)),
    db.select({ c: count() }).from(vehicleObservationsTable).where(eq(vehicleObservationsTable.vehicleId, vehicle.id)),
  ]);

  const fx = await getKrwFxSnapshot();
  const usdTable = await getUsdFxTable();
  const mappedEvents = events
    .map((e) => ({
      ...e,
      description: translateEncarEventDescription(e.description) ?? e.description,
    }))
    .filter((e) => !isEmptyInsuranceAccidentEvent(e));

  const { photosNew, photosOld } = splitPhotosNewOld(photos, {
    includeImportMotorSources: true,
  });

  res.json({
    ...withVehicleMileage(vehicle),
    listingCount: Number(listingRow[0]?.c ?? 0),
    observationCount: Number(obsRow[0]?.c ?? 0),
    observations: observations.map((o) => withPriceFx(withListingMileage(o), fx, usdTable)),
    events: mappedEvents,
    ownerChanges: buildOwnerChangeTable(mappedEvents, observations.map((o) => withListingMileage(o))),
    auctionSales: buildAuctionSales(mappedEvents, observations).map((row) =>
      withPriceFx(
        {
          ...row,
          priceAmount: row.amount ?? null,
          priceCurrency: row.currency ?? "KRW",
          priceUsd: row.priceUsd,
          priceEur: row.priceEur,
        },
        fx,
        usdTable,
      ),
    ),
    accidents: buildAccidentTable(mappedEvents),
    salvage: buildSalvageRecord(mappedEvents),
    /** Includes Import Motor source URLs for admin ops — never on public /v1/vin. */
    listings,
    photosNew,
    photosOld,
  });
});

// DELETE /api/admin/vehicles/:vin
router.delete("/admin/vehicles/:vin", requireAdmin, async (req, res): Promise<void> => {
  const params = GetVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const removed = await deleteVehicleByVin(params.data.vin);
  if (!removed) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "vehicle.delete",
    entityType: "vehicle",
    details: { vin: params.data.vin },
  });

  res.status(204).send();
});

export default router;
