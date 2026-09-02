/**
 * Public VIN API endpoints (v1)
 *
 * GET /api/v1/vin/check/:vin  — Bearer required, no credit, returns existence + country
 * GET /api/v1/vin/:vin        — Bearer required, returns full vehicle history (1 credit on success)
 */
import { Router } from "express";
import {
  db,
  vehiclesTable,
  listingsTable,
  vehicleObservationsTable,
  vehicleEventsTable,
  photosTable,
  apiRequestLogsTable,
  providersTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { requireApiToken } from "../../middlewares/apiTokenAuth";
import { checkRateLimits } from "../../lib/rateLimiter";
import { consumeOneCredit } from "../../lib/credits";
import { requireApiFeature } from "../../lib/apiAccess";
import { withListingMileage, withVehicleMileage } from "../../lib/mileage";
import { translateEncarEventDescription } from "../../lib/providers/encar-locale";
import { isEmptyInsuranceAccidentEvent } from "../../lib/providers/encar-history";
import {
  publicAccident,
  publicAuctionSale,
  publicEvent,
  publicListing,
  publicMileageRow,
  publicObservation,
  publicOwnerChange,
  publicPhoto,
  resolveVinCountrySlug,
} from "../../lib/vin-public-api";
import { buildOwnerChangeTable } from "../../lib/owner-changes";
import { buildAuctionSales } from "../../lib/auction-sales";
import { buildAccidentTable } from "../../lib/accidents";
import { buildMileageHistory } from "../../lib/mileage-history";
import { buildSalvageRecord } from "../../lib/salvage-title";
import { buildVehicleExtra, filterTimelineEvents } from "../../lib/vehicle-extra";
import { isHostedCdnUrl, isImportMotorPhotoUrl, publicPhotoUrl, splitPhotosNewOld } from "../../lib/photo-response";
import { isTestVin } from "../../lib/test-vins";
import { rejectTestTokenNonTestVin } from "../../lib/testToken";

const router = Router();

/** Normalize a VIN: uppercase, strip whitespace */
function normalizeVin(raw: string | string[]): string {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return (s ?? "").toUpperCase().trim();
}

function validateVin(vin: string): string | null {
  if (!vin || vin.length < 5 || vin.length > 17) {
    return "VIN must be between 5 and 17 characters";
  }
  if (!/^[A-Z0-9]+$/.test(vin)) {
    return "VIN must contain only alphanumeric characters";
  }
  return null;
}

// ── GET /api/v1/vin/check/:vin ────────────────────────────────────────────────
// Bearer required — no credit consumed.
router.get(
  "/check/:vin",
  requireApiToken,
  requireApiFeature("vin_check"),
  async (req, res): Promise<void> => {
  const vin = normalizeVin(req.params.vin ?? "");
  const client = req.apiClient!;
  const token = req.apiToken!;
  const startTime = Date.now();

  const err = validateVin(vin);
  if (err) {
    db.insert(apiRequestLogsTable)
      .values({
        clientId: client.id,
        tokenId: token.id,
        vin,
        method: req.method,
        path: `/v1/vin/check/${vin}`,
        statusCode: 400,
        durationMs: Date.now() - startTime,
        ipAddress: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
      })
      .catch(() => {});

    res.status(400).json({ success: false, error: { code: "INVALID_VIN", message: err } });
    return;
  }

  if (rejectTestTokenNonTestVin(req, res, vin)) {
    db.insert(apiRequestLogsTable)
      .values({
        clientId: client.id,
        tokenId: token.id,
        vin,
        method: req.method,
        path: `/v1/vin/check/${vin}`,
        statusCode: 403,
        durationMs: Date.now() - startTime,
        ipAddress: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
      })
      .catch(() => {});
    return;
  }

  const [vehicle] = await db
    .select({ id: vehiclesTable.id, country: vehiclesTable.country })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.vin, vin));

  if (!vehicle) {
    db.insert(apiRequestLogsTable)
      .values({
        clientId: client.id,
        tokenId: token.id,
        vin,
        method: req.method,
        path: `/v1/vin/check/${vin}`,
        statusCode: 200,
        durationMs: Date.now() - startTime,
        ipAddress: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
      })
      .catch(() => {});

    res.json({ success: true, data: { vin, exists: false, hasHistory: false, country: null } });
    return;
  }

  const listingRows = await db
    .select({
      country: listingsTable.country,
      providerCountry: providersTable.country,
    })
    .from(listingsTable)
    .leftJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
    .where(eq(listingsTable.vin, vin))
    .limit(50);

  const country = resolveVinCountrySlug(
    vehicle.country,
    listingRows.map((r) => r.country),
    listingRows.map((r) => r.providerCountry),
  );

  const [obsRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(vehicleObservationsTable)
    .where(eq(vehicleObservationsTable.vehicleId, vehicle.id));

  db.insert(apiRequestLogsTable)
    .values({
      clientId: client.id,
      tokenId: token.id,
      vin,
      method: req.method,
      path: `/v1/vin/check/${vin}`,
      statusCode: 200,
      durationMs: Date.now() - startTime,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string) ?? null,
    })
    .catch(() => {});

  res.json({
    success: true,
    data: {
      vin,
      exists: true,
      hasHistory: Number(obsRow?.c ?? 0) > 0,
      country,
    },
  });
},
);

// ── GET /api/v1/vin/:vin ──────────────────────────────────────────────────────
// Token-authenticated, rate-limited, consumes one credit per 200 response.
router.get("/:vin", requireApiToken, requireApiFeature("vin_retrieve"), async (req, res): Promise<void> => {
  const vin = normalizeVin(req.params.vin ?? "");
  const client = req.apiClient!;
  const token = req.apiToken!;
  const startTime = Date.now();

  const vinErr = validateVin(vin);
  if (vinErr) {
    res.status(400).json({ success: false, error: { code: "INVALID_VIN", message: vinErr } });
    return;
  }

  if (rejectTestTokenNonTestVin(req, res, vin)) {
    db.insert(apiRequestLogsTable)
      .values({
        clientId: client.id,
        tokenId: token.id,
        vin,
        method: req.method,
        path: `/v1/vin/${vin}`,
        statusCode: 403,
        durationMs: Date.now() - startTime,
        ipAddress: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
      })
      .catch(() => {});
    return;
  }

  const testVin = isTestVin(vin);

  // ── Rate limit check (test VINs skip per-VIN cap; global limits still apply) ─
  const rateCheck = testVin
    ? await checkRateLimits({ ...client, requestsPerVin: null }, vin)
    : await checkRateLimits(client, vin);

  if (!rateCheck.allowed) {
    // Log the rejected request (status 429, no credit consumed)
    db.insert(apiRequestLogsTable)
      .values({
        clientId: client.id,
        tokenId: token.id,
        vin,
        method: req.method,
        path: `/v1/vin/${vin}`,
        statusCode: 429,
        durationMs: Date.now() - startTime,
        ipAddress: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
      })
      .catch(() => {});

    res.status(429).json({
      success: false,
      error: {
        code: rateCheck.errorCode ?? "RATE_LIMITED",
        message: rateCheck.reason ?? "Rate limit exceeded",
      },
    });
    return;
  }

  // ── Query vehicle ─────────────────────────────────────────────────────────
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.vin, vin));

  if (!vehicle) {
    // Log 404 but do NOT consume a credit (no 2xx)
    db.insert(apiRequestLogsTable)
      .values({
        clientId: client.id,
        tokenId: token.id,
        vin,
        method: req.method,
        path: `/v1/vin/${vin}`,
        statusCode: 404,
        durationMs: Date.now() - startTime,
        ipAddress: req.ip ?? null,
        userAgent: (req.headers["user-agent"] as string) ?? null,
      })
      .catch(() => {});

    res.status(404).json({
      success: false,
      error: { code: "VIN_NOT_FOUND", message: "No vehicle found for this VIN" },
    });
    return;
  }

  // ── Prepaid credit (1 successful retrieve = 1 credit; test VINs are free) ─
  if (!testVin) {
    const spent = await consumeOneCredit({ clientId: client.id, vin });
    if (!spent) {
      db.insert(apiRequestLogsTable)
        .values({
          clientId: client.id,
          tokenId: token.id,
          vin,
          method: req.method,
          path: `/v1/vin/${vin}`,
          statusCode: 402,
          durationMs: Date.now() - startTime,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers["user-agent"] as string) ?? null,
        })
        .catch(() => {});

      res.status(402).json({
        success: false,
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: "No VIN retrieve credits remaining. Buy credits in the client area or ask your operator.",
        },
      });
      return;
    }
  }

  // ── Fetch full history in parallel ────────────────────────────────────────
  const [listings, observations, events, photos] = await Promise.all([
    db
      .select()
      .from(listingsTable)
      .where(eq(listingsTable.vin, vin))
      .orderBy(sql`${listingsTable.firstSeenAt} DESC`),
    db
      .select()
      .from(vehicleObservationsTable)
      .where(eq(vehicleObservationsTable.vehicleId, vehicle.id))
      .orderBy(sql`${vehicleObservationsTable.observedAt} DESC`),
    db
      .select()
      .from(vehicleEventsTable)
      .where(eq(vehicleEventsTable.vehicleId, vehicle.id))
      .orderBy(sql`${vehicleEventsTable.occurredAt} DESC`),
    db
      .select()
      .from(photosTable)
      .where(eq(photosTable.vehicleId, vehicle.id))
      .orderBy(sql`${photosTable.sortOrder} ASC`),
  ]);

  // Resolve providers (internal only — never exposed in public JSON)
  const providerIds = [...new Set([
    ...listings.map((l) => l.providerId),
    ...observations.map((o) => o.providerId),
  ])];
  const providerById = new Map<number, { internalName: string; name: string }>();
  if (providerIds.length > 0) {
    const rows = await db
      .select({
        id: providersTable.id,
        internalName: providersTable.internalName,
        name: providersTable.name,
      })
      .from(providersTable)
      .where(inArray(providersTable.id, providerIds));
    for (const r of rows) {
      if (r.internalName !== "import_motor") {
        providerById.set(r.id, { internalName: r.internalName, name: r.name });
      }
    }
  }
  const sources = [...providerById.entries()].map(([providerId, p]) => ({
    providerId,
    internalName: p.internalName,
    name: p.name,
  }));

  const durationMs = Date.now() - startTime;

  // ── Log successful request (credit consumed) ──────────────────────────────
  db.insert(apiRequestLogsTable)
    .values({
      clientId: client.id,
      tokenId: token.id,
      vin,
      method: req.method,
      path: `/v1/vin/${vin}`,
      statusCode: 200,
      durationMs,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string) ?? null,
    })
    .catch(() => {});

  const originFallback =
    sources.find((s) => s.internalName === "copart")?.internalName ||
    sources.find((s) => s.internalName === "iaa")?.internalName ||
    sources.find((s) => s.internalName === "encar")?.internalName ||
    sources.find((s) => s.internalName === "autowini")?.internalName ||
    "copart";

  const mappedEvents = events
    .map((e) => {
      let metadata = e.metadata ? JSON.parse(e.metadata) : null;
      if (metadata && typeof metadata === "object") {
        if (metadata.source === "import_motor") {
          metadata = { ...metadata, source: originFallback };
        } else if (metadata.source === "bidscan") {
          const auction =
            typeof metadata.provider === "string" && metadata.provider.trim()
              ? metadata.provider.trim()
              : originFallback;
          metadata = { ...metadata, source: auction };
        }
      }
      return {
        id: e.id,
        eventType: e.eventType,
        description: translateEncarEventDescription(e.description) ?? e.description,
        occurredAt: e.occurredAt,
        metadata,
      };
    })
    .filter((e) => !isEmptyInsuranceAccidentEvent(e));
  const mappedListings = listings.map((l) =>
    withListingMileage({
      id: l.id,
      providerId: l.providerId,
      sourceId: l.sourceId,
      sourceUrl:
        l.sourceUrl && !isImportMotorPhotoUrl(l.sourceUrl) ? l.sourceUrl : null,
      title: l.title,
      priceAmount: l.priceAmount,
      priceCurrency: l.priceCurrency,
      mileage: l.mileage,
      mileageUnit: l.mileageUnit,
      location: l.location,
      isActive: l.isActive,
      firstSeenAt: l.firstSeenAt,
      lastSeenAt: l.lastSeenAt,
    }),
  );
  const mappedObservations = observations.map((o) =>
    withListingMileage({
      id: o.id,
      providerId: o.providerId,
      priceAmount: o.priceAmount,
      priceCurrency: o.priceCurrency,
      mileage: o.mileage,
      mileageUnit: o.mileageUnit,
      listingStatus: o.listingStatus,
      location: o.location,
      observedAt: o.observedAt,
    }),
  );

  const ownerChanges = buildOwnerChangeTable(mappedEvents, mappedObservations);
  const accidents = buildAccidentTable(mappedEvents);
  const extra = buildVehicleExtra(mappedEvents);
  const timelineEvents = filterTimelineEvents(mappedEvents);

  res.json({
    success: true,
    data: {
      vin,
      vehicle: withVehicleMileage({
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        trim: vehicle.trim,
        bodyType: vehicle.bodyType,
        fuelType: vehicle.fuelType,
        transmission: vehicle.transmission,
        driveType: vehicle.driveType,
        engineDisplacement: vehicle.engineDisplacement,
        color: vehicle.color,
        currentKnownMileage: vehicle.currentKnownMileage,
        lastSeenAt: vehicle.lastSeenAt,
      }),
      listings: mappedListings.map((l) => publicListing(l as Record<string, unknown>)),
      observations: mappedObservations.map((o) => publicObservation(o as Record<string, unknown>)),
      events: timelineEvents.map((e) => publicEvent(e)),
      ...(extra ? { extra } : {}),
      ownerChanges: ownerChanges.map((r) => publicOwnerChange(r as Record<string, unknown>)),
      auctionSales: buildAuctionSales(
        mappedEvents,
        observations.map((o) => ({
          ...o,
          providerName: sources.find((s) => s.providerId === o.providerId)?.name,
        })),
      ).map((r) => publicAuctionSale(r as Record<string, unknown>)),
      accidents: accidents.map((r) => publicAccident(r as Record<string, unknown>)),
      salvage: buildSalvageRecord(mappedEvents),
      mileageHistory: buildMileageHistory({
        observations: mappedObservations.map((o) => ({
          ...o,
          providerName: sources.find((s) => s.providerId === o.providerId)?.name,
        })),
        events: mappedEvents,
        ownerChanges,
        accidents,
      }).map((r) => publicMileageRow(r as Record<string, unknown>)),
      ...(() => {
        const {
          photosNew,
          photosOld,
          photosExterior3d,
          photosInterior3d,
          photosExterior3dOld,
          photosInterior3dOld,
        } = splitPhotosNewOld(photos);
        return {
          photosNew,
          photosOld,
          photosExterior3d,
          photosInterior3d,
          photosExterior3dOld,
          photosInterior3dOld,
          photos: photos.flatMap((p) => {
            const url = publicPhotoUrl(p);
            if (!url) return [];
            const onCdn = isHostedCdnUrl(p.storedPath);
            return [
              publicPhoto({
                id: p.id,
                url,
                storedPath: onCdn ? p.storedPath : null,
                sourceUrl: onCdn || isImportMotorPhotoUrl(p.sourceUrl) ? null : p.sourceUrl,
                isPrimary: p.isPrimary,
                sortOrder: p.sortOrder,
                group: p.photoGroup || "gallery",
              } as Record<string, unknown>),
            ];
          }),
        };
      })(),
    },
    meta: {
      creditCharged: testVin ? 0 : 1,
      ...(testVin ? { testVin: true } : {}),
    },
  });
});

export default router;
