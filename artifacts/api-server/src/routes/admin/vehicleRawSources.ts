import { Router, type IRouter } from "express";
import { db, rawSourceRecordsTable, listingsTable, vehiclesTable, providersTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import {
  GetVehicleRawSourcesParams,
  GetVehicleRawSourcesQueryParams,
  GetVehicleRawSourcesResponse,
  GetVehiclePhotosParams,
  GetVehiclePhotosResponse,
} from "@workspace/api-zod";
import { photosTable } from "@workspace/db";
import { requireAdmin } from "../../middlewares/auth";
import { splitPhotosNewOld } from "../../lib/photo-response";

const router: IRouter = Router();

// GET /api/admin/vehicles/:vin/raw-sources
router.get("/admin/vehicles/:vin/raw-sources", requireAdmin, async (req, res): Promise<void> => {
  const pathParams = GetVehicleRawSourcesParams.safeParse(req.params);
  if (!pathParams.success) {
    res.status(400).json({ error: pathParams.error.message });
    return;
  }

  const queryParams = GetVehicleRawSourcesQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { vin } = pathParams.data;
  const { limit = 20, offset = 0 } = queryParams.data;

  // Look up vehicle
  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.vin, vin));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // Get raw records by joining via listings → vehicles
  const [records, [totalRow]] = await Promise.all([
    db
      .select({
        id: rawSourceRecordsTable.id,
        providerId: rawSourceRecordsTable.providerId,
        providerName: providersTable.name,
        listingId: rawSourceRecordsTable.listingId,
        sourceId: rawSourceRecordsTable.sourceId,
        requestUrl: rawSourceRecordsTable.requestUrl,
        parserVersion: rawSourceRecordsTable.parserVersion,
        rawJson: rawSourceRecordsTable.rawJson,
        contentHash: rawSourceRecordsTable.contentHash,
        collectedAt: rawSourceRecordsTable.collectedAt,
      })
      .from(rawSourceRecordsTable)
      .innerJoin(listingsTable, eq(rawSourceRecordsTable.listingId, listingsTable.id))
      .leftJoin(providersTable, eq(rawSourceRecordsTable.providerId, providersTable.id))
      .where(eq(listingsTable.vehicleId, vehicle.id))
      .orderBy(sql`${rawSourceRecordsTable.collectedAt} DESC`)
      .limit(limit)
      .offset(offset),
    db
      .select({ c: count() })
      .from(rawSourceRecordsTable)
      .innerJoin(listingsTable, eq(rawSourceRecordsTable.listingId, listingsTable.id))
      .where(eq(listingsTable.vehicleId, vehicle.id)),
  ]);

  res.json(
    GetVehicleRawSourcesResponse.parse({
      items: records,
      total: Number(totalRow?.c ?? 0),
    }),
  );
});

// GET /api/admin/vehicles/:vin/photos
router.get("/admin/vehicles/:vin/photos", requireAdmin, async (req, res): Promise<void> => {
  const pathParams = GetVehiclePhotosParams.safeParse(req.params);
  if (!pathParams.success) {
    res.status(400).json({ error: pathParams.error.message });
    return;
  }

  const { vin } = pathParams.data;

  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.vin, vin));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const photos = await db
    .select()
    .from(photosTable)
    .where(eq(photosTable.vehicleId, vehicle.id))
    .orderBy(photosTable.isPrimary, photosTable.sortOrder);

  const { photosNew, photosOld } = splitPhotosNewOld(photos, {
    includeImportMotorSources: true,
  });
  // Keep flat `items` for older clients; prefer photosNew / photosOld.
  res.json({
    photosNew,
    photosOld,
    items: GetVehiclePhotosResponse.parse(photos),
  });
});

export default router;
