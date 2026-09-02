/**
 * Collection pipeline: VIN matching, observation dedup, raw record storage, photo storage.
 */

import crypto from "crypto";
import {
  db,
  vehiclesTable,
  vehicleObservationsTable,
  vehicleEventsTable,
  listingsTable,
  rawSourceRecordsTable,
  photosTable,
  type InsertVehicle,
  type InsertVehicleObservation,
  type InsertVehicleEvent,
  type InsertListing,
  type InsertRawSourceRecord,
  type InsertPhoto,
  type Vehicle,
} from "@workspace/db";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import type { NormalizedEvent, NormalizedListing, NormalizedVehicle, NormalizedPhoto, FetchedListing } from "@workspace/providers";
import { logger } from "../logger";
import { vinCheckDigitOk } from "../providers/kr-common";
import { isUsableMileage, salvageListingMileage } from "../providers/mileage";
import { isUsableVehicleIdentity, salvageVehicleIdentity } from "../providers/vehicle-identity";
import { toMileageKm } from "../mileage";
import { isJunkPhotoUrl, photoIdentityKey } from "../providers/web-html";
import { attachListingFx } from "../fx";
import {
  earlierDate,
  isReasonableDate,
  laterDate,
  resolveListingFirstSeenAt,
  resolveListingLastSeenAt,
  resolveObservationAt,
} from "../providers/listing-dates";
import { MAX_VEHICLE_PHOTOS, selectMixedVehiclePhotos, type ListingPhotoMeta } from "./photo-mix";
import { scheduleVehiclePhotoMirror } from "../photo-mirror";
import { canonicalCountry, isKoreaCountry } from "../geo";

export interface PipelineInput {
  providerId: number;
  jobId: number;
  fetched: FetchedListing;
  listing: NormalizedListing;
  vehicle: NormalizedVehicle;
  vin: string | undefined;
  photos: NormalizedPhoto[];
  parserVersion: string;
}

export interface PipelineResult {
  vehicleId?: number;
  listingId?: number;
  isNewVehicle: boolean;
  isNewObservation: boolean;
  isDuplicate: boolean;
  vinFound: boolean;
  /** True when the listing was fetched but not persisted (no VIN). */
  skippedNoVin: boolean;
  /** True when VIN was present but mileage was missing/unusable — history requires both. */
  skippedNoMileage: boolean;
  /** True when VIN+mileage ok but make/model unknown — history requires a known vehicle. */
  skippedNoIdentity: boolean;
}

/**
 * Store provider JSON only (never HTML). Deduped by content hash.
 */
export async function storeRawRecord(
  providerId: number,
  sourceId: string,
  fetched: FetchedListing,
  listingId: number | undefined,
  parserVersion: string,
): Promise<void> {
  if (fetched.json == null) return;
  if (typeof fetched.json === "string" && /<(!DOCTYPE|html|head|body)\b/i.test(fetched.json)) {
    return;
  }

  const RAW_STORE_LIMIT = 2 * 1024 * 1024;
  let rawJson = JSON.stringify(fetched.json);
  if (!rawJson || rawJson === "null") return;
  if (rawJson.length > RAW_STORE_LIMIT) rawJson = rawJson.slice(0, RAW_STORE_LIMIT);
  const contentHash = crypto.createHash("sha256").update(rawJson).digest("hex");

  const existing = await db
    .select({ id: rawSourceRecordsTable.id })
    .from(rawSourceRecordsTable)
    .where(
      and(
        eq(rawSourceRecordsTable.providerId, providerId),
        eq(rawSourceRecordsTable.sourceId, sourceId),
        eq(rawSourceRecordsTable.contentHash, contentHash),
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(rawSourceRecordsTable).values({
    providerId,
    listingId,
    sourceId,
    requestUrl: fetched.url,
    parserVersion,
    rawJson,
    contentHash,
    collectedAt: new Date(),
  } satisfies InsertRawSourceRecord);
}

/**
 * Get or create listing row without overwriting on unchanged re-crawls.
 * Clone ads (same provider + valid VIN + same price/mileage, different source ids)
 * reuse the existing row so VIN history is not doubled.
 */
async function ensureListing(providerId: number, listing: NormalizedListing, vin?: string): Promise<number> {
  listing.sourceId = normalizeSourceId(listing.sourceId);

  // Prefer the oldest clone (same provider + VIN + price + mileage) even when this
  // source id already has its own row — otherwise re-crawls keep updating extras.
  if (vin && vinCheckDigitOk(vin)) {
    const [clone] = await db
      .select({ id: listingsTable.id })
      .from(listingsTable)
      .where(
        and(
          eq(listingsTable.providerId, providerId),
          eq(listingsTable.vin, vin),
          sql`${listingsTable.priceAmount} IS NOT DISTINCT FROM ${listing.priceAmount ?? null}`,
          sql`${listingsTable.mileage} IS NOT DISTINCT FROM ${listing.mileage ?? null}`,
        ),
      )
      .orderBy(asc(listingsTable.id))
      .limit(1);
    if (clone) return clone.id;
  }

  const [existing] = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(
      and(
        eq(listingsTable.providerId, providerId),
        eq(listingsTable.sourceId, listing.sourceId),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const now = new Date();
  const firstSeenAt = resolveListingFirstSeenAt(listing, now);
  const lastSeenAt = resolveListingLastSeenAt(listing, now);

  const inserted = await db
    .insert(listingsTable)
    .values({
      providerId,
      vin: listing.vehicle?.vin ?? vin ?? null,
      sourceId: listing.sourceId,
      sourceUrl: listing.sourceUrl ?? null,
      title: listing.title ?? null,
      priceAmount: listing.priceAmount ?? null,
      priceCurrency: listing.priceCurrency ?? "USD",
      priceUsd: listing.priceUsd ?? null,
      priceEur: listing.priceEur ?? null,
      mileage: listing.mileage ?? null,
      mileageUnit: listing.mileageUnit ?? "km",
      location: listing.location ?? null,
      country: canonicalCountry(listing.country) ?? null,
      isActive: listing.isActive ?? true,
      firstSeenAt,
      lastSeenAt,
    } satisfies InsertListing)
    .onConflictDoNothing()
    .returning({ id: listingsTable.id });

  if (inserted[0]) return inserted[0].id;

  const [again] = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(
      and(
        eq(listingsTable.providerId, providerId),
        eq(listingsTable.sourceId, listing.sourceId),
      ),
    )
    .limit(1);
  return again!.id;
}

async function updateListingFromSnapshot(
  listingId: number,
  listing: NormalizedListing,
  vehicleId: number,
  vin: string,
): Promise<void> {
  const now = new Date();
  const hasSiteDates =
    isReasonableDate(listing.sourceListedAt) || isReasonableDate(listing.sourceModifiedAt);
  const siteFirst = resolveListingFirstSeenAt(listing, now);
  const siteLast = resolveListingLastSeenAt(listing, now);

  const [existing] = await db
    .select({
      firstSeenAt: listingsTable.firstSeenAt,
      lastSeenAt: listingsTable.lastSeenAt,
    })
    .from(listingsTable)
    .where(eq(listingsTable.id, listingId))
    .limit(1);

  await db
    .update(listingsTable)
    .set({
      // When the site gave publish/update times, do not keep a later crawl clock as "last seen".
      lastSeenAt: hasSiteDates
        ? siteLast
        : (laterDate(existing?.lastSeenAt, now) ?? now),
      firstSeenAt: earlierDate(existing?.firstSeenAt, siteFirst) ?? existing?.firstSeenAt ?? siteFirst,
      vehicleId,
      vin,
      title: listing.title ?? undefined,
      priceAmount: listing.priceAmount ?? undefined,
      priceCurrency: listing.priceCurrency ?? undefined,
      priceUsd: listing.priceUsd ?? undefined,
      priceEur: listing.priceEur ?? undefined,
      mileage: listing.mileage ?? undefined,
      mileageUnit: listing.mileageUnit ?? "km",
      location: listing.location ?? undefined,
      country: canonicalCountry(listing.country) ?? undefined,
      isActive: listing.isActive ?? true,
    })
    .where(eq(listingsTable.id, listingId));
}

function mergeVehicleFields(
  existing: Vehicle,
  vehicle: NormalizedVehicle,
  mileage: number | undefined,
  sourceModifiedAt?: Date,
): Partial<InsertVehicle> {
  // Do not let aggregators without a source timestamp (BidScan, import-motor) overwrite
  // make/model/etc. already filled by Encar or another primary crawl.
  const incomingIsNewer =
    !!sourceModifiedAt &&
    (!existing.updatedAt || sourceModifiedAt.getTime() > existing.updatedAt.getTime());

  const update: Partial<InsertVehicle> = { lastSeenAt: new Date() };

  const maybeSet = <K extends keyof InsertVehicle>(key: K, value: InsertVehicle[K] | undefined) => {
    if (value == null || value === "") return;
    const current = existing[key as keyof Vehicle];
    if (current == null || current === "" || incomingIsNewer) {
      update[key] = value;
    }
  };

  maybeSet("make", vehicle.make ?? undefined);
  maybeSet("model", vehicle.model ?? undefined);
  maybeSet("year", vehicle.year ?? undefined);
  maybeSet("trim", vehicle.trim ?? undefined);
  if (isJunkVehicleTrim(existing.trim)) {
    update.trim = (vehicle.trim && !isJunkVehicleTrim(vehicle.trim) ? vehicle.trim : null) as InsertVehicle["trim"];
  }
  maybeSet("bodyType", vehicle.bodyType ?? undefined);
  maybeSet("fuelType", vehicle.fuelType ?? undefined);
  maybeSet("transmission", vehicle.transmission ?? undefined);
  maybeSet("driveType", vehicle.driveType ?? undefined);
  maybeSet("engineDisplacement", vehicle.engineDisplacement ?? undefined);
  maybeSet("color", vehicle.color ?? undefined);
  maybeSet("country", canonicalCountry(vehicle.country) ?? undefined);
  if (isKoreaCountry(existing.country) && vehicle.country && !isKoreaCountry(vehicle.country)) {
    update.country = canonicalCountry(vehicle.country) ?? vehicle.country;
  }

  if (mileage != null && (existing.currentKnownMileage == null || mileage > existing.currentKnownMileage)) {
    // `mileage` is always km (caller converts).
    update.currentKnownMileage = mileage;
  }

  return update;
}

function isJunkVehicleTrim(value: unknown): boolean {
  const t = String(value ?? "");
  return /VIN\s*:/i.test(t) || /Auto history/i.test(t) || /\b[A-HJ-NPR-Z0-9]{17}\b/.test(t);
}

async function hasObservationFingerprint(fingerprintHash: string): Promise<boolean> {
  const [row] = await db
    .select({ id: vehicleObservationsTable.id })
    .from(vehicleObservationsTable)
    .where(eq(vehicleObservationsTable.fingerprintHash, fingerprintHash))
    .limit(1);
  return !!row;
}

/**
 * Upsert a listing record (first seen / last seen, update title/price/mileage).
 * @deprecated Use ensureListing + updateListingFromSnapshot in processFetchedListing.
 */
export async function upsertListing(
  providerId: number,
  listing: NormalizedListing,
  vehicleId?: number,
): Promise<number> {
  listing.sourceId = normalizeSourceId(listing.sourceId);
  const existing = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(
      and(
        eq(listingsTable.providerId, providerId),
        eq(listingsTable.sourceId, listing.sourceId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    // Update last seen and mutable fields
    await db
      .update(listingsTable)
      .set({
        lastSeenAt: new Date(),
        priceAmount: listing.priceAmount ?? undefined,
        priceCurrency: listing.priceCurrency ?? undefined,
        priceUsd: listing.priceUsd ?? undefined,
        priceEur: listing.priceEur ?? undefined,
        mileage: listing.mileage ?? undefined,
        location: listing.location ?? undefined,
        country: canonicalCountry(listing.country) ?? undefined,
        vehicleId: vehicleId ?? undefined,
        vin: listing.vehicle?.vin ?? undefined,
      })
      .where(eq(listingsTable.id, existing[0]!.id));

    return existing[0]!.id;
  }

  const [row] = await db
    .insert(listingsTable)
    .values({
      providerId,
      vehicleId,
      vin: listing.vehicle?.vin ?? null,
      sourceId: listing.sourceId,
      sourceUrl: listing.sourceUrl ?? null,
      title: listing.title ?? null,
      priceAmount: listing.priceAmount ?? null,
      priceCurrency: listing.priceCurrency ?? "USD",
      priceUsd: listing.priceUsd ?? null,
      priceEur: listing.priceEur ?? null,
      mileage: listing.mileage ?? null,
      mileageUnit: listing.mileageUnit ?? "km",
      location: listing.location ?? null,
      country: canonicalCountry(listing.country) ?? null,
      isActive: true,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    } satisfies InsertListing)
    .returning({ id: listingsTable.id });

  return row!.id;
}

/**
 * Look up or create a Vehicle record by VIN.
 * `mileage` may be in mi or km — pass `mileageUnit` so we always store km on the vehicle.
 * Returns { vehicleId, isNew }.
 */
export async function upsertVehicle(
  vin: string,
  vehicle: NormalizedVehicle,
  mileage?: number,
  sourceModifiedAt?: Date,
  mileageUnit?: string | null,
): Promise<{ vehicleId: number; isNew: boolean }> {
  const mileageKm = toMileageKm(mileage, mileageUnit);
  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.vin, vin))
    .limit(1);

  if (existing) {
    const updateFields = mergeVehicleFields(existing, vehicle, mileageKm, sourceModifiedAt);
    await db.update(vehiclesTable).set(updateFields).where(eq(vehiclesTable.id, existing.id));
    return { vehicleId: existing.id, isNew: false };
  }

  const [row] = await db
    .insert(vehiclesTable)
    .values({
      vin,
      make: vehicle.make ?? null,
      model: vehicle.model ?? null,
      year: vehicle.year ?? null,
      trim: vehicle.trim ?? null,
      bodyType: vehicle.bodyType ?? null,
      fuelType: vehicle.fuelType ?? null,
      transmission: vehicle.transmission ?? null,
      driveType: vehicle.driveType ?? null,
      engineDisplacement: vehicle.engineDisplacement ?? null,
      color: vehicle.color ?? null,
      country: canonicalCountry(vehicle.country) ?? null,
      currentKnownMileage: mileageKm ?? null,
      lastSeenAt: new Date(),
    } satisfies InsertVehicle)
    .returning({ id: vehiclesTable.id });

  return { vehicleId: row!.id, isNew: true };
}

function observationStatus(listing: NormalizedListing): string {
  return listing.listingStatus ?? (listing.isActive === false ? "inactive" : "active");
}

/**
 * Compute the deterministic fingerprint hash for an observation.
 * VIN + provider + price + mileage + status — clone ads of the same car
 * must not create a second identical history row.
 */
export function computeFingerprintHash(
  vin: string,
  providerId: number,
  priceAmount?: number,
  mileage?: number,
  listingStatus?: string,
): string {
  const parts = [vin, String(providerId), String(priceAmount ?? ""), String(mileage ?? ""), listingStatus ?? ""].join("|");
  return crypto.createHash("sha256").update(parts).digest("hex");
}

export function normalizeSourceId(sourceId: string): string {
  return String(sourceId ?? "").trim().replace(/\/+$/, "");
}

export function canonicalPhotoUrl(url: string): string {
  const raw = url.trim();
  // IAAI frames require query params (imageKeys / partitionKey) to be fetchable.
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, "");
    if (/vis\.iaai\.com$/i.test(host) && /\/resizer/i.test(parsed.pathname)) {
      const keys = parsed.searchParams.get("imageKeys");
      if (keys) {
        const width = parsed.searchParams.get("width") || "845";
        const height = parsed.searchParams.get("height");
        const q = new URLSearchParams({ imageKeys: keys, width });
        if (height) q.set("height", height);
        return `${parsed.origin}${parsed.pathname}?${q.toString()}`;
      }
    }
    if (/mediaretriever\.iaai\.com$/i.test(host)) {
      const pk = parsed.searchParams.get("partitionKey");
      const tenant = parsed.searchParams.get("tenant") || "iaai";
      const order = parsed.searchParams.get("imageOrder");
      if (pk && /ThreeSixtyImageRetriever/i.test(parsed.pathname) && order) {
        return `${parsed.origin}${parsed.pathname}?tenant=${tenant}&partitionKey=${pk}&imageOrder=${order}`;
      }
      if (pk && /InteriorImageRetriever/i.test(parsed.pathname)) {
        return `${parsed.origin}${parsed.pathname}?tenant=${tenant}&partitionKey=${pk}`;
      }
    }
  } catch {
    /* fall through */
  }
  // Keep a fetchable URL; only strip query/hash noise. Identity / dedupe uses photoIdentityKey.
  return raw.split("#")[0]!.split("?")[0]!.trim().replace(/\/+$/, "");
}

/**
 * Append a VehicleObservation if not a duplicate.
 * Returns { isNew: true } when inserted, { isNew: false } when skipped as duplicate.
 */
export async function appendObservation(
  vehicleId: number,
  providerId: number,
  listingId: number,
  listing: NormalizedListing,
  vin: string,
): Promise<{ isNew: boolean }> {
  const listingStatus = observationStatus(listing);
  const fingerprintHash = computeFingerprintHash(
    vin,
    providerId,
    listing.priceAmount,
    listing.mileage,
    listingStatus,
  );

  const observedAt = resolveObservationAt(listing);
  const sourceListedAt = listing.sourceListedAt ?? null;
  const sourceUpdatedAt = listing.sourceModifiedAt ?? null;

  const inserted = await db
    .insert(vehicleObservationsTable)
    .values({
      vehicleId,
      providerId,
      listingId,
      sourceListingId: listing.sourceId,
      fingerprintHash,
      priceAmount: listing.priceAmount ?? null,
      priceCurrency: listing.priceCurrency ?? "USD",
      priceUsd: listing.priceUsd ?? null,
      priceEur: listing.priceEur ?? null,
      mileage: listing.mileage ?? null,
      mileageUnit: listing.mileageUnit ?? "km",
      listingStatus,
      location: listing.location ?? null,
      observedAt,
      sourceListedAt,
      sourceUpdatedAt,
    } satisfies InsertVehicleObservation)
    .onConflictDoNothing()
    .returning({ id: vehicleObservationsTable.id });

  if (inserted.length === 0) {
    await refreshObservationDates(fingerprintHash, listing);
  }

  return { isNew: inserted.length > 0 };
}

/** When a fingerprint already exists, still upgrade crawl-time dates to site dates. */
async function refreshObservationDates(
  fingerprintHash: string,
  listing: NormalizedListing,
): Promise<void> {
  const listed = listing.sourceListedAt;
  const updated = listing.sourceModifiedAt;
  if (!listed && !updated) return;

  const [row] = await db
    .select({
      id: vehicleObservationsTable.id,
      observedAt: vehicleObservationsTable.observedAt,
      sourceListedAt: vehicleObservationsTable.sourceListedAt,
      sourceUpdatedAt: vehicleObservationsTable.sourceUpdatedAt,
    })
    .from(vehicleObservationsTable)
    .where(eq(vehicleObservationsTable.fingerprintHash, fingerprintHash))
    .limit(1);
  if (!row) return;

  const nextListed = earlierDate(row.sourceListedAt, listed) ?? row.sourceListedAt ?? listed ?? null;
  const nextUpdated = laterDate(row.sourceUpdatedAt, updated) ?? row.sourceUpdatedAt ?? updated ?? null;
  const preferred = resolveObservationAt({
    ...listing,
    sourceListedAt: nextListed ?? undefined,
    sourceModifiedAt: nextUpdated ?? undefined,
  });
  // Prefer site publish/update over a much-later crawl timestamp.
  const nextObserved =
    preferred.getTime() + 24 * 60 * 60 * 1000 < row.observedAt.getTime() ? preferred : row.observedAt;

  await db
    .update(vehicleObservationsTable)
    .set({
      sourceListedAt: nextListed,
      sourceUpdatedAt: nextUpdated,
      observedAt: nextObserved,
    })
    .where(eq(vehicleObservationsTable.id, row.id));
}

export function saleEventFromListing(listing: NormalizedListing): NormalizedEvent | undefined {
  if (listing.listingStatus !== "sold") return undefined;
  const occurredAt = listing.soldAt ?? listing.sourceModifiedAt;
  if (!occurredAt) return undefined;
  const amount = listing.priceAmount;
  const currency = listing.priceCurrency ?? "KRW";
  const amountLabel =
    amount != null
      ? currency === "KRW"
        ? `₩${amount.toLocaleString("en-US")}`
        : `${amount.toLocaleString("en-US")} ${currency}`
      : "undisclosed amount";
  const fxBits =
    listing.priceUsd != null || listing.priceEur != null
      ? ` (≈ $${listing.priceUsd?.toLocaleString("en-US") ?? "—"} / €${listing.priceEur?.toLocaleString("en-US") ?? "—"})`
      : "";
  return {
    eventType: "sale",
    description: `Sold for ${amountLabel}${fxBits}`,
    occurredAt,
    metadata: {
      field: "sale",
      soldDate: occurredAt.toISOString().slice(0, 10),
      priceAmount: amount,
      priceCurrency: currency,
      priceUsd: listing.priceUsd ?? null,
      priceEur: listing.priceEur ?? null,
      sourceListingId: listing.sourceId,
    },
  };
}

/**
 * Store vehicle history events (accidents, owner changes, inspections, sales).
 * De-duplicates by (vehicleId, eventType, occurredAt) to avoid re-inserting
 * the same event on subsequent collector runs.
 */
export async function storeEvents(
  vehicleId: number,
  listing: NormalizedListing,
): Promise<void> {
  const events = [...(listing.events ?? [])];
  const sale = saleEventFromListing(listing);
  if (sale && !events.some((event) => event.eventType === "sale")) events.push(sale);
  if (events.length === 0) return;

  // Batch-insert all events in one statement. The unique index on
  // (vehicle_id, event_type, occurred_at::date) silently skips duplicates.
  const rows = events.map(event => ({
    vehicleId,
    eventType: event.eventType,
    description: event.description ?? null,
    metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    occurredAt: event.occurredAt,
  } satisfies InsertVehicleEvent));

  await db.insert(vehicleEventsTable).values(rows).onConflictDoNothing();
}

/**
 * Store extracted photos for a VIN, capped at MAX_VEHICLE_PHOTOS.
 * Gallery uses one canonical listing — never mixes photos from catalog + live crawl.
 */
export async function storePhotos(
  vehicleId: number,
  listingId: number,
  photos: NormalizedPhoto[],
): Promise<void> {
  if (photos.length === 0) return;

  const incoming: Array<{
    listingId: number;
    sourceUrl: string;
    isPrimary: boolean;
    sortOrder: number;
    width: number | null;
    height: number | null;
    photoGroup: string;
    identityKey: string;
  }> = [];
  const seenIncoming = new Set<string>();
  for (const photo of photos) {
    if (isJunkPhotoUrl(photo.sourceUrl)) continue;
    const sourceUrl = canonicalPhotoUrl(photo.sourceUrl);
    if (!sourceUrl) continue;
    const identityKey = photoIdentityKey(sourceUrl);
    if (seenIncoming.has(identityKey)) continue;
    seenIncoming.add(identityKey);
    const photoGroup =
      photo.group === "exterior_3d" || photo.group === "interior_3d" ? photo.group : "gallery";
    incoming.push({
      listingId,
      sourceUrl,
      isPrimary: photo.isPrimary ?? false,
      sortOrder: photo.sortOrder ?? 0,
      width: photo.width ?? null,
      height: photo.height ?? null,
      photoGroup,
      identityKey,
    });
  }
  if (incoming.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(87201, ${vehicleId})`);

    const existing = await tx
      .select({
        id: photosTable.id,
        listingId: photosTable.listingId,
        sourceUrl: photosTable.sourceUrl,
        isPrimary: photosTable.isPrimary,
        sortOrder: photosTable.sortOrder,
        width: photosTable.width,
        height: photosTable.height,
        photoGroup: photosTable.photoGroup,
      })
      .from(photosTable)
      .where(eq(photosTable.vehicleId, vehicleId));

    type Candidate = {
      id?: number;
      listingId: number | null;
      sourceUrl: string;
      isPrimary: boolean;
      sortOrder: number;
      width: number | null;
      height: number | null;
      photoGroup: string;
      identityKey: string;
    };

    const candidates: Candidate[] = [];
    const byIdentity = new Map<string, Candidate>();

    for (const row of existing) {
      const identityKey = photoIdentityKey(row.sourceUrl);
      const candidate: Candidate = {
        id: row.id,
        listingId: row.listingId,
        sourceUrl: row.sourceUrl,
        isPrimary: row.isPrimary,
        sortOrder: row.sortOrder,
        width: row.width,
        height: row.height,
        photoGroup: row.photoGroup || "gallery",
        identityKey,
      };
      if (byIdentity.has(identityKey)) continue;
      byIdentity.set(identityKey, candidate);
      candidates.push(candidate);
    }

    for (const row of incoming) {
      const prev = byIdentity.get(row.identityKey);
      if (prev) {
        // Upgrade gallery → 3d group when we rediscover the same asset tagged.
        if (prev.photoGroup === "gallery" && row.photoGroup !== "gallery") {
          prev.photoGroup = row.photoGroup;
          prev.sortOrder = row.sortOrder;
        }
        continue;
      }
      const candidate: Candidate = { ...row };
      byIdentity.set(row.identityKey, candidate);
      candidates.push(candidate);
    }

    const listingIds = [
      ...new Set(candidates.map((c) => c.listingId).filter((id): id is number => id != null)),
    ];
    const metaByListingId = new Map<number, ListingPhotoMeta>();
    if (listingIds.length > 0) {
      const metaRows = await tx
        .select({
          id: listingsTable.id,
          sourceId: listingsTable.sourceId,
          isActive: listingsTable.isActive,
        })
        .from(listingsTable)
        .where(inArray(listingsTable.id, listingIds));
      for (const row of metaRows) {
        metaByListingId.set(row.id, {
          listingId: row.id,
          sourceId: row.sourceId,
          isActive: row.isActive,
        });
      }
    }

    const selected = selectMixedVehiclePhotos(candidates, MAX_VEHICLE_PHOTOS, metaByListingId);
    const keepIds = new Set(selected.map((p) => p.id).filter((id): id is number => id != null));
    const dropIds = existing.map((r) => r.id).filter((id) => !keepIds.has(id));

    if (dropIds.length) {
      await tx.delete(photosTable).where(inArray(photosTable.id, dropIds));
    }

    const toInsert = selected.filter((p) => p.id == null);
    if (toInsert.length) {
      await tx.insert(photosTable).values(
        toInsert.map(
          (photo) =>
            ({
              vehicleId,
              listingId: photo.listingId,
              sourceUrl: photo.sourceUrl,
              isPrimary: photo.isPrimary,
              sortOrder: photo.sortOrder,
              width: photo.width,
              height: photo.height,
              photoGroup: photo.photoGroup || "gallery",
            }) satisfies InsertPhoto,
        ),
      ).onConflictDoNothing();
    }

    // Re-read after insert so new rows get sort/primary/group assigned too.
    const kept = await tx
      .select({
        id: photosTable.id,
        sourceUrl: photosTable.sourceUrl,
      })
      .from(photosTable)
      .where(eq(photosTable.vehicleId, vehicleId));

    const sortByUrl = new Map(selected.map((p) => [p.sourceUrl, p]));
    for (const row of kept) {
      const want = sortByUrl.get(row.sourceUrl);
      if (!want) continue;
      await tx
        .update(photosTable)
        .set({
          isPrimary: want.isPrimary,
          sortOrder: want.sortOrder,
          photoGroup: want.photoGroup || "gallery",
        })
        .where(eq(photosTable.id, row.id));
    }
  });

  // Async R2 mirror — keeps source_url; fills stored_path when upload succeeds.
  scheduleVehiclePhotoMirror(vehicleId);
}

/** Re-apply canonical listing selection for an existing vehicle gallery. */
export async function reconcileVehiclePhotos(vehicleId: number): Promise<{ before: number; after: number }> {
  const existing = await db
    .select({
      id: photosTable.id,
      listingId: photosTable.listingId,
      sourceUrl: photosTable.sourceUrl,
      isPrimary: photosTable.isPrimary,
      sortOrder: photosTable.sortOrder,
      width: photosTable.width,
      height: photosTable.height,
      photoGroup: photosTable.photoGroup,
    })
    .from(photosTable)
    .where(eq(photosTable.vehicleId, vehicleId));

  if (existing.length === 0) return { before: 0, after: 0 };

  type Candidate = {
    id: number;
    listingId: number | null;
    sourceUrl: string;
    isPrimary: boolean;
    sortOrder: number;
    width: number | null;
    height: number | null;
    photoGroup: string;
    identityKey: string;
  };

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const row of existing) {
    const identityKey = photoIdentityKey(row.sourceUrl);
    if (seen.has(identityKey)) continue;
    seen.add(identityKey);
    candidates.push({
      id: row.id,
      listingId: row.listingId,
      sourceUrl: row.sourceUrl,
      isPrimary: row.isPrimary,
      sortOrder: row.sortOrder,
      width: row.width,
      height: row.height,
      photoGroup: row.photoGroup || "gallery",
      identityKey,
    });
  }

  const listingIds = [
    ...new Set(candidates.map((c) => c.listingId).filter((id): id is number => id != null)),
  ];
  const metaByListingId = new Map<number, ListingPhotoMeta>();
  if (listingIds.length > 0) {
    const metaRows = await db
      .select({
        id: listingsTable.id,
        sourceId: listingsTable.sourceId,
        isActive: listingsTable.isActive,
      })
      .from(listingsTable)
      .where(inArray(listingsTable.id, listingIds));
    for (const row of metaRows) {
      metaByListingId.set(row.id, {
        listingId: row.id,
        sourceId: row.sourceId,
        isActive: row.isActive,
      });
    }
  }

  const selected = selectMixedVehiclePhotos(candidates, MAX_VEHICLE_PHOTOS, metaByListingId);
  const keepIds = new Set(selected.map((p) => p.id).filter((id): id is number => id != null));
  const dropIds = existing.map((r) => r.id).filter((id) => !keepIds.has(id));

  await db.transaction(async (tx) => {
    if (dropIds.length) {
      await tx.delete(photosTable).where(inArray(photosTable.id, dropIds));
    }
    const sortByUrl = new Map(selected.map((p) => [p.sourceUrl, p]));
    for (const row of existing) {
      if (!keepIds.has(row.id)) continue;
      const want = sortByUrl.get(row.sourceUrl);
      if (!want) continue;
      await tx
        .update(photosTable)
        .set({
          isPrimary: want.isPrimary,
          sortOrder: want.sortOrder,
          photoGroup: want.photoGroup || "gallery",
        })
        .where(eq(photosTable.id, row.id));
    }
  });

  scheduleVehiclePhotoMirror(vehicleId);
  return { before: existing.length, after: selected.length };
}

/**
 * Full pipeline: process a single fetched listing through to persistence.
 *
 * Historical storage is VIN + mileage + known vehicle (make or model) —
 * listings without those are not written to the database (no listing, raw
 * record, vehicle, or observation rows). Live inventory is served separately
 * via /api/v1/live (short-TTL cache only).
 */
export async function processFetchedListing(input: PipelineInput): Promise<PipelineResult> {
  const { providerId, fetched, vin, photos, parserVersion } = input;
  const listing = await attachListingFx(input.listing);
  const vehicle = { ...input.vehicle };

  // Recover mileage from metadata / JSON / title / HTML before the hard gate.
  const salvaged = salvageListingMileage({
    mileage: listing.mileage,
    title: listing.title,
    metadata: (fetched.metadata ?? undefined) as Record<string, unknown> | undefined,
    json: fetched.json,
    html: fetched.html,
  });
  if (salvaged != null) {
    listing.mileage = salvaged;
  } else {
    listing.mileage = undefined;
  }

  // Recover make/model/year from title when parsers left them blank.
  const identity = salvageVehicleIdentity({
    make: vehicle.make ?? listing.vehicle?.make,
    model: vehicle.model ?? listing.vehicle?.model,
    year: vehicle.year ?? listing.vehicle?.year,
    title: listing.title,
  });
  if (identity.make) vehicle.make = identity.make;
  if (identity.model) vehicle.model = identity.model;
  if (identity.year != null) vehicle.year = identity.year;
  listing.vehicle = { ...(listing.vehicle ?? {}), ...vehicle };

  const result: PipelineResult = {
    isNewVehicle: false,
    isNewObservation: false,
    isDuplicate: false,
    vinFound: !!vin,
    skippedNoVin: !vin,
    skippedNoMileage: false,
    skippedNoIdentity: false,
  };

  if (!vin) {
    logger.debug(
      { sourceId: listing.sourceId, url: listing.sourceUrl ?? fetched.url },
      "Skipping listing without VIN — history DB requires a VIN",
    );
    return result;
  }

  if (!isUsableMileage(listing.mileage)) {
    result.skippedNoMileage = true;
    logger.debug(
      { sourceId: listing.sourceId, vin, url: listing.sourceUrl ?? fetched.url },
      "Skipping listing without mileage — history DB requires an odometer reading",
    );
    return result;
  }

  if (!isUsableVehicleIdentity(vehicle)) {
    result.skippedNoIdentity = true;
    logger.debug(
      { sourceId: listing.sourceId, vin, title: listing.title, url: listing.sourceUrl ?? fetched.url },
      "Skipping listing without make/model — history DB requires a known vehicle",
    );
    return result;
  }

  try {
    const listingId = await ensureListing(providerId, listing, vin);
    result.listingId = listingId;

    const fingerprintHash = computeFingerprintHash(
      vin,
      providerId,
      listing.priceAmount,
      listing.mileage,
      observationStatus(listing),
    );

    if (await hasObservationFingerprint(fingerprintHash)) {
      const { vehicleId } = await upsertVehicle(
        vin,
        vehicle,
        listing.mileage,
        listing.sourceModifiedAt,
        listing.mileageUnit,
      );
      await updateListingFromSnapshot(listingId, listing, vehicleId, vin);
      await refreshObservationDates(fingerprintHash, listing);
      // Always merge history/registry events — fingerprint match must not drop Korean registry.
      await storeEvents(vehicleId, listing);
      if (photos.length) await storePhotos(vehicleId, listingId, photos);
      result.vehicleId = vehicleId;
      result.isDuplicate = true;
      logger.debug(
        { sourceId: listing.sourceId, vin },
        "Unchanged listing snapshot — refreshed title/specs/dates/events, skipped new observation",
      );
      return result;
    }

    await storeRawRecord(providerId, listing.sourceId, fetched, listingId, parserVersion);

    const { vehicleId, isNew } = await upsertVehicle(
      vin,
      vehicle,
      listing.mileage,
      listing.sourceModifiedAt,
      listing.mileageUnit,
    );
    result.vehicleId = vehicleId;
    result.isNewVehicle = isNew;

    await updateListingFromSnapshot(listingId, listing, vehicleId, vin);

    const obs = await appendObservation(vehicleId, providerId, listingId, listing, vin);
    result.isNewObservation = obs.isNew;
    result.isDuplicate = !obs.isNew;

    // Persist events even when the observation row already existed (dedupe is in storeEvents).
    await storeEvents(vehicleId, listing);
    if (photos.length) {
      await storePhotos(vehicleId, listingId, photos);
    }
  } catch (err) {
    logger.error({ err, sourceId: listing.sourceId }, "Pipeline error for listing");
    throw err;
  }

  return result;
}

/**
 * Listing disappeared from the provider (404 / removed). Keep the VIN row,
 * mark the listing inactive, and record an inactive observation when possible.
 */
export async function markListingGone(
  providerId: number,
  sourceId: string,
): Promise<{ marked: boolean; observation: boolean }> {
  const [listing] = await db
    .select()
    .from(listingsTable)
    .where(and(eq(listingsTable.providerId, providerId), eq(listingsTable.sourceId, sourceId)))
    .limit(1);

  if (!listing) return { marked: false, observation: false };

  await db
    .update(listingsTable)
    .set({ isActive: false, lastSeenAt: new Date() })
    .where(eq(listingsTable.id, listing.id));

  if (!listing.vin || listing.vehicleId == null) {
    return { marked: true, observation: false };
  }

  const snapshot = {
    sourceId,
    sourceUrl: listing.sourceUrl ?? undefined,
    priceAmount: listing.priceAmount ?? undefined,
    priceCurrency: listing.priceCurrency ?? undefined,
    mileage: listing.mileage ?? undefined,
    mileageUnit: listing.mileageUnit ?? undefined,
    location: listing.location ?? undefined,
    listingStatus: "inactive" as const,
    isActive: false,
  };

  const obs = await appendObservation(
    listing.vehicleId,
    providerId,
    listing.id,
    snapshot,
    listing.vin,
  );
  return { marked: true, observation: obs.isNew };
}
