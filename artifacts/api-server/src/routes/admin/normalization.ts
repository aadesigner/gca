import { Router, type IRouter } from "express";
import { db, vehiclesTable, normalizationOverridesTable, listingsTable } from "@workspace/db";
import { eq, isNull, or, count, sql } from "drizzle-orm";
import {
  ListLowConfidenceVehiclesQueryParams,
  ListLowConfidenceVehiclesResponse,
  CreateNormalizationOverrideParams,
  CreateNormalizationOverrideBody,
  CreateNormalizationOverrideResponse,
  ListNormalizationOverridesParams,
  ListNormalizationOverridesResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";

const router: IRouter = Router();

// Key normalization fields we track quality for
const KEY_FIELDS = ["make", "model", "year", "trim", "bodyType", "fuelType", "transmission", "driveType"] as const;

// GET /api/admin/normalization/low-confidence
router.get("/admin/normalization/low-confidence", requireAdmin, async (req, res): Promise<void> => {
  const params = ListLowConfidenceVehiclesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { field, limit = 50, offset = 0 } = params.data;

  // Find vehicles with missing key normalization fields
  // "Low confidence" = one or more of the key fields is null
  let whereClause;
  if (field) {
    // Filter to a specific field being null
    const col = vehiclesTable[field as keyof typeof vehiclesTable] as any;
    if (!col) {
      res.status(400).json({ error: `Unknown field: ${field}` });
      return;
    }
    whereClause = isNull(col);
  } else {
    // Any key field is null — must match all advertised fields
    whereClause = or(
      isNull(vehiclesTable.make),
      isNull(vehiclesTable.model),
      isNull(vehiclesTable.year),
      isNull(vehiclesTable.trim),
      isNull(vehiclesTable.bodyType),
      isNull(vehiclesTable.fuelType),
      isNull(vehiclesTable.transmission),
      isNull(vehiclesTable.driveType),
    );
  }

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
        currentKnownMileage: vehiclesTable.currentKnownMileage,
        lastSeenAt: vehiclesTable.lastSeenAt,
        listingCount: sql<number>`(SELECT COUNT(*) FROM ${listingsTable} WHERE ${listingsTable.vehicleId} = ${vehiclesTable.id})`,
        observationCount: sql<number>`0`,
        createdAt: vehiclesTable.createdAt,
        updatedAt: vehiclesTable.updatedAt,
      })
      .from(vehiclesTable)
      .where(whereClause)
      .orderBy(sql`${vehiclesTable.updatedAt} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(vehiclesTable).where(whereClause),
  ]);

  // Compute missing/low-confidence fields per vehicle
  const items = vehicles.map(v => {
    const missingFields: string[] = [];
    if (!v.make) missingFields.push("make");
    if (!v.model) missingFields.push("model");
    if (!v.year) missingFields.push("year");
    if (!v.trim) missingFields.push("trim");
    if (!v.bodyType) missingFields.push("bodyType");
    if (!v.fuelType) missingFields.push("fuelType");
    if (!v.transmission) missingFields.push("transmission");
    if (!v.driveType) missingFields.push("driveType");

    return { ...v, missingFields, confidenceIssues: [] as string[] };
  });

  res.json(
    ListLowConfidenceVehiclesResponse.parse({
      items,
      total: Number(totalRow?.c ?? 0),
    }),
  );
});

// POST /api/admin/normalization/:vehicleId/override
router.post("/admin/normalization/:vehicleId/override", requireAdmin, async (req, res): Promise<void> => {
  const pathParams = CreateNormalizationOverrideParams.safeParse(req.params);
  if (!pathParams.success) {
    res.status(400).json({ error: pathParams.error.message });
    return;
  }

  const body = CreateNormalizationOverrideBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { vehicleId } = pathParams.data;
  const { field, overriddenValue, reason } = body.data;

  // Verify vehicle exists
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  // Upsert the override (one override per vehicle+field)
  const existing = await db
    .select()
    .from(normalizationOverridesTable)
    .where(
      sql`${normalizationOverridesTable.vehicleId} = ${vehicleId} AND ${normalizationOverridesTable.field} = ${field}`
    );

  let override;
  if (existing.length > 0) {
    // Preserve the originalValue from the first override — it represents the
    // pre-override normalized value. Overwriting it on edits would corrupt the
    // audit trail (the vehicle table already has the overridden value by now).
    const preservedOriginalValue = existing[0]!.originalValue;
    [override] = await db
      .update(normalizationOverridesTable)
      .set({
        originalValue: preservedOriginalValue,
        overriddenValue,
        overriddenBy: req.session.adminId ?? null,
        overriddenByEmail: req.session.adminEmail ?? null,
        reason: reason ?? null,
      })
      .where(eq(normalizationOverridesTable.id, existing[0]!.id))
      .returning();
  } else {
    // First override: capture current normalized value as the original
    const originalValue = vehicle[field as keyof typeof vehicle];
    [override] = await db
      .insert(normalizationOverridesTable)
      .values({
        vehicleId,
        field,
        originalValue: originalValue != null ? String(originalValue) : null,
        overriddenValue,
        confidence: "low",
        overriddenBy: req.session.adminId ?? null,
        overriddenByEmail: req.session.adminEmail ?? null,
        reason: reason ?? null,
      })
      .returning();
  }

  // Apply the override to the vehicles table
  const updatePayload: Record<string, unknown> = {};
  if (field === "year") {
    updatePayload.year = parseInt(overriddenValue, 10) || null;
  } else {
    updatePayload[field] = overriddenValue;
  }

  await db.update(vehiclesTable).set(updatePayload).where(eq(vehiclesTable.id, vehicleId));

  await writeAuditLog({
    req,
    action: "data.override",
    entityType: "vehicle",
    entityId: vehicleId,
    details: { field, originalValue: override!.originalValue, overriddenValue, reason },
  });

  res.json(CreateNormalizationOverrideResponse.parse(override!));
});

// GET /api/admin/normalization/:vehicleId/overrides
router.get("/admin/normalization/:vehicleId/overrides", requireAdmin, async (req, res): Promise<void> => {
  const pathParams = ListNormalizationOverridesParams.safeParse(req.params);
  if (!pathParams.success) {
    res.status(400).json({ error: pathParams.error.message });
    return;
  }

  const { vehicleId } = pathParams.data;

  // Verify vehicle exists
  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));

  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const overrides = await db
    .select()
    .from(normalizationOverridesTable)
    .where(eq(normalizationOverridesTable.vehicleId, vehicleId))
    .orderBy(sql`${normalizationOverridesTable.createdAt} DESC`);

  res.json(ListNormalizationOverridesResponse.parse(overrides));
});

export default router;
