/**
 * Portable VIN catalog: export/import listings, specs, photo URLs,
 * observations, and events keyed by provider internal name (not numeric ids).
 */
import type { Response } from "express";
import {
  db,
  listingsTable,
  vehiclesTable,
  providersTable,
  photosTable,
  vehicleObservationsTable,
  vehicleEventsTable,
  type InsertListing,
  type InsertPhoto,
  type InsertVehicleObservation,
  type InsertVehicleEvent,
} from "@workspace/db";
import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { computeFingerprintHash, canonicalPhotoUrl, storePhotos, upsertVehicle } from "./collector/pipeline";
import { scheduleVehiclePhotoMirror } from "./photo-mirror";
import { streamListingCsv } from "./listing-export";
import { normalizeKrVin } from "./providers/kr-common";
import { photoIdentityKey } from "./providers/web-html";
import { isEphemeralPhotoHost, isHostedCdnUrl } from "./photo-response";
import { resolveVehicleOriginCountry } from "./geo";
import { attachListingFx } from "./fx";

export const VIN_CATALOG_FORMAT = "getcarapi-vin-catalog";
export const VIN_CATALOG_VERSION = 1;

/** Catalog import accepts EU/KR VINs that may not use a digit/X in the NA check-digit slot. */
function normalizeCatalogVin(raw?: string | null): string | undefined {
  const strict = normalizeKrVin(raw);
  if (strict) return strict;
  if (!raw) return undefined;
  const clean = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (clean.length !== 17) return undefined;
  if (/^(.)\1{16}$/.test(clean)) return undefined;
  if (/^\d+$/.test(clean)) return undefined;
  if (!/[A-HJ-NPR-Z]/i.test(clean)) return undefined;
  return clean;
}

const BATCH = 200;

export type CatalogVehicle = {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  trim?: string | null;
  bodyType?: string | null;
  fuelType?: string | null;
  transmission?: string | null;
  driveType?: string | null;
  engineDisplacement?: string | null;
  color?: string | null;
  country?: string | null;
  currentKnownMileage?: number | null;
};

export type CatalogListing = {
  vin: string;
  provider: string;
  providerName?: string;
  sourceId: string;
  sourceUrl?: string | null;
  title?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  priceUsd?: number | null;
  priceEur?: number | null;
  mileage?: number | null;
  mileageUnit?: string | null;
  location?: string | null;
  country?: string | null;
  isActive?: boolean;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  vehicle?: CatalogVehicle;
  photos?: Array<{
    sourceUrl: string;
    isPrimary?: boolean;
    sortOrder?: number;
    width?: number | null;
    height?: number | null;
  }>;
  observations?: Array<{
    priceAmount?: number | null;
    priceCurrency?: string | null;
    priceUsd?: number | null;
    priceEur?: number | null;
    mileage?: number | null;
    mileageUnit?: string | null;
    listingStatus?: string | null;
    location?: string | null;
    observedAt?: string | null;
    fingerprintHash?: string | null;
  }>;
  events?: Array<{
    eventType: string;
    description?: string | null;
    metadata?: string | null;
    occurredAt?: string | null;
  }>;
};

export type VinCatalogFile = {
  format: typeof VIN_CATALOG_FORMAT;
  version: number;
  exportedAt: string;
  listings: CatalogListing[];
};

export type VinImportResult = {
  listingsRead: number;
  vehiclesUpserted: number;
  listingsUpserted: number;
  photosAdded: number;
  observationsAdded: number;
  eventsAdded: number;
  skippedNoVin: number;
  providersCreated: string[];
  errors: string[];
};

function catalogPhotoSourceUrl(sourceUrl: string, storedPath?: string | null): string {
  if (isHostedCdnUrl(storedPath)) return storedPath!;
  return sourceUrl;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function streamVinCatalogJson(
  res: Response,
  opts: { providerId?: number; providerInternalName?: string },
): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = opts.providerInternalName || (opts.providerId ? `provider-${opts.providerId}` : "all");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="vins-${slug}-${stamp}.json"`);

  res.write(
    `{"format":${JSON.stringify(VIN_CATALOG_FORMAT)},"version":${VIN_CATALOG_VERSION},"exportedAt":${JSON.stringify(new Date().toISOString())},"listings":[`,
  );

  const conditions = [or(isNotNull(listingsTable.vin), isNotNull(vehiclesTable.vin))];
  if (opts.providerId) conditions.push(eq(listingsTable.providerId, opts.providerId));
  if (opts.providerInternalName) conditions.push(eq(providersTable.internalName, opts.providerInternalName));
  const where = and(...conditions);

  let lastId = 0;
  let written = 0;
  const eventsEmitted = new Set<number>();

  for (;;) {
    const rows = await db
      .select({
        listingId: listingsTable.id,
        vehicleId: listingsTable.vehicleId,
        vin: sql<string>`COALESCE(${listingsTable.vin}, ${vehiclesTable.vin})`,
        sourceId: listingsTable.sourceId,
        sourceUrl: listingsTable.sourceUrl,
        title: listingsTable.title,
        priceAmount: listingsTable.priceAmount,
        priceCurrency: listingsTable.priceCurrency,
        priceUsd: listingsTable.priceUsd,
        priceEur: listingsTable.priceEur,
        mileage: listingsTable.mileage,
        mileageUnit: listingsTable.mileageUnit,
        location: listingsTable.location,
        country: sql<string | null>`COALESCE(${listingsTable.country}, ${vehiclesTable.country})`,
        isActive: listingsTable.isActive,
        firstSeenAt: listingsTable.firstSeenAt,
        lastSeenAt: listingsTable.lastSeenAt,
        provider: providersTable.internalName,
        providerName: providersTable.name,
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
        vehicleCountry: vehiclesTable.country,
        currentKnownMileage: vehiclesTable.currentKnownMileage,
      })
      .from(listingsTable)
      .innerJoin(providersTable, eq(listingsTable.providerId, providersTable.id))
      .leftJoin(vehiclesTable, eq(listingsTable.vehicleId, vehiclesTable.id))
      .where(and(gt(listingsTable.id, lastId), where))
      .orderBy(listingsTable.id)
      .limit(BATCH);

    if (!rows.length) break;

    const listingIds = rows.map((r) => r.listingId);
    const vehicleIds = [...new Set(rows.map((r) => r.vehicleId).filter((id): id is number => id != null))];

    const [photos, observations, events] = await Promise.all([
      db
        .select({
          listingId: photosTable.listingId,
          sourceUrl: photosTable.sourceUrl,
          storedPath: photosTable.storedPath,
          isPrimary: photosTable.isPrimary,
          sortOrder: photosTable.sortOrder,
          width: photosTable.width,
          height: photosTable.height,
        })
        .from(photosTable)
        .where(inArray(photosTable.listingId, listingIds)),
      db
        .select({
          listingId: vehicleObservationsTable.listingId,
          priceAmount: vehicleObservationsTable.priceAmount,
          priceCurrency: vehicleObservationsTable.priceCurrency,
          priceUsd: vehicleObservationsTable.priceUsd,
          priceEur: vehicleObservationsTable.priceEur,
          mileage: vehicleObservationsTable.mileage,
          mileageUnit: vehicleObservationsTable.mileageUnit,
          listingStatus: vehicleObservationsTable.listingStatus,
          location: vehicleObservationsTable.location,
          observedAt: vehicleObservationsTable.observedAt,
          fingerprintHash: vehicleObservationsTable.fingerprintHash,
        })
        .from(vehicleObservationsTable)
        .where(inArray(vehicleObservationsTable.listingId, listingIds)),
      vehicleIds.length
        ? db
            .select({
              vehicleId: vehicleEventsTable.vehicleId,
              eventType: vehicleEventsTable.eventType,
              description: vehicleEventsTable.description,
              metadata: vehicleEventsTable.metadata,
              occurredAt: vehicleEventsTable.occurredAt,
            })
            .from(vehicleEventsTable)
            .where(inArray(vehicleEventsTable.vehicleId, vehicleIds))
        : Promise.resolve([]),
    ]);

    const photosByListing = new Map<number, typeof photos>();
    for (const photo of photos) {
      if (photo.listingId == null) continue;
      const list = photosByListing.get(photo.listingId) ?? [];
      list.push(photo);
      photosByListing.set(photo.listingId, list);
    }
    const obsByListing = new Map<number, typeof observations>();
    for (const obs of observations) {
      if (obs.listingId == null) continue;
      const list = obsByListing.get(obs.listingId) ?? [];
      list.push(obs);
      obsByListing.set(obs.listingId, list);
    }
    const eventsByVehicle = new Map<number, typeof events>();
    for (const event of events) {
      const list = eventsByVehicle.get(event.vehicleId) ?? [];
      list.push(event);
      eventsByVehicle.set(event.vehicleId, list);
    }

    for (const row of rows) {
      if (!row.vin) continue;
      const listingPhotos = photosByListing.get(row.listingId) ?? [];
      const listingObs = obsByListing.get(row.listingId) ?? [];
      let listingEvents: CatalogListing["events"] = [];
      if (row.vehicleId != null && !eventsEmitted.has(row.vehicleId)) {
        eventsEmitted.add(row.vehicleId);
        listingEvents = (eventsByVehicle.get(row.vehicleId) ?? []).map((event) => ({
          eventType: event.eventType,
          description: event.description,
          metadata: event.metadata,
          occurredAt: iso(event.occurredAt),
        }));
      }

      const record: CatalogListing = {
        vin: row.vin,
        provider: row.provider,
        providerName: row.providerName,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        title: row.title,
        priceAmount: row.priceAmount,
        priceCurrency: row.priceCurrency,
        priceUsd: row.priceUsd,
        priceEur: row.priceEur,
        mileage: row.mileage,
        mileageUnit: row.mileageUnit,
        location: row.location,
        country: row.country,
        isActive: row.isActive,
        firstSeenAt: iso(row.firstSeenAt),
        lastSeenAt: iso(row.lastSeenAt),
        vehicle: {
          make: row.make,
          model: row.model,
          year: row.year,
          trim: row.trim,
          bodyType: row.bodyType,
          fuelType: row.fuelType,
          transmission: row.transmission,
          driveType: row.driveType,
          engineDisplacement: row.engineDisplacement,
          color: row.color,
          country: row.vehicleCountry,
          currentKnownMileage: row.currentKnownMileage,
        },
        photos: [...listingPhotos]
          .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((photo) => ({
            sourceUrl: catalogPhotoSourceUrl(photo.sourceUrl, photo.storedPath),
            isPrimary: photo.isPrimary,
            sortOrder: photo.sortOrder,
            width: photo.width,
            height: photo.height,
          })),
        observations: listingObs.map((obs) => ({
          priceAmount: obs.priceAmount,
          priceCurrency: obs.priceCurrency,
          priceUsd: obs.priceUsd,
          priceEur: obs.priceEur,
          mileage: obs.mileage,
          mileageUnit: obs.mileageUnit,
          listingStatus: obs.listingStatus,
          location: obs.location,
          observedAt: iso(obs.observedAt),
          fingerprintHash: obs.fingerprintHash,
        })),
        events: listingEvents,
      };

      res.write((written === 0 ? "" : ",") + JSON.stringify(record));
      written++;
    }

    lastId = rows[rows.length - 1]!.listingId;
    if (rows.length < BATCH) break;
  }

  res.write("]}");
  res.end();
}

export async function streamVinExport(
  res: Response,
  opts: { providerId?: number; providerInternalName?: string; format?: string },
): Promise<void> {
  if (opts.format === "csv") {
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = opts.providerInternalName || (opts.providerId ? `provider-${opts.providerId}` : "all");
    await streamListingCsv(
      res,
      { providerId: opts.providerId, enabledOnly: false },
      `vins-${slug}-${stamp}.csv`,
    );
    return;
  }
  await streamVinCatalogJson(res, opts);
}

async function resolveProvider(
  cache: Map<string, number>,
  created: string[],
  internalName: string,
  displayName?: string,
): Promise<number> {
  const key = internalName.trim().toLowerCase();
  const hit = cache.get(key) ?? (displayName ? cache.get(displayName.trim().toLowerCase()) : undefined);
  if (hit) return hit;

  const [byInternal] = await db
    .select({ id: providersTable.id, internalName: providersTable.internalName, name: providersTable.name })
    .from(providersTable)
    .where(eq(providersTable.internalName, internalName))
    .limit(1);
  if (byInternal) {
    cache.set(byInternal.internalName.toLowerCase(), byInternal.id);
    cache.set(byInternal.name.toLowerCase(), byInternal.id);
    return byInternal.id;
  }

  if (displayName) {
    const [byName] = await db
      .select({ id: providersTable.id, internalName: providersTable.internalName, name: providersTable.name })
      .from(providersTable)
      .where(eq(providersTable.name, displayName))
      .limit(1);
    if (byName) {
      cache.set(byName.internalName.toLowerCase(), byName.id);
      cache.set(byName.name.toLowerCase(), byName.id);
      return byName.id;
    }
  }

  const [row] = await db
    .insert(providersTable)
    .values({
      name: displayName?.trim() || internalName,
      internalName,
      type: "classifieds",
      country: "Unknown",
      enabled: true,
      notes: "Created by VIN catalog import",
    })
    .returning({ id: providersTable.id });
  cache.set(key, row!.id);
  if (displayName) cache.set(displayName.trim().toLowerCase(), row!.id);
  created.push(internalName);
  return row!.id;
}

async function upsertImportedListing(
  providerId: number,
  vin: string,
  vehicleId: number,
  listing: CatalogListing,
): Promise<{ id: number; created: boolean }> {
  const sourceId = listing.sourceId || `import:${vin}`;
  const [existing] = await db
    .select({ id: listingsTable.id })
    .from(listingsTable)
    .where(and(eq(listingsTable.providerId, providerId), eq(listingsTable.sourceId, sourceId)))
    .limit(1);

  const firstSeen = asDate(listing.firstSeenAt) ?? new Date();
  const lastSeen = asDate(listing.lastSeenAt) ?? new Date();
  const priced = await attachListingFx({
    priceAmount: listing.priceAmount ?? undefined,
    priceCurrency: listing.priceCurrency ?? "USD",
    priceUsd: listing.priceUsd ?? undefined,
    priceEur: listing.priceEur ?? undefined,
  });
  const values = {
    providerId,
    vehicleId,
    vin,
    sourceId,
    sourceUrl: listing.sourceUrl ?? null,
    title: listing.title ?? null,
    priceAmount: priced.priceAmount ?? null,
    priceCurrency: priced.priceCurrency ?? "USD",
    priceUsd: priced.priceUsd ?? null,
    priceEur: priced.priceEur ?? null,
    mileage: listing.mileage ?? null,
    mileageUnit: listing.mileageUnit ?? "km",
    location: listing.location ?? null,
    country:
      resolveVehicleOriginCountry({
        country: listing.country ?? listing.vehicle?.country,
        providerInternalName: listing.provider,
      }) ?? null,
    isActive: listing.isActive ?? true,
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
  } satisfies InsertListing;

  if (existing) {
    await db
      .update(listingsTable)
      .set({
        vehicleId,
        vin,
        sourceUrl: values.sourceUrl ?? undefined,
        title: values.title ?? undefined,
        priceAmount: values.priceAmount ?? undefined,
        priceCurrency: values.priceCurrency ?? undefined,
        priceUsd: values.priceUsd ?? undefined,
        priceEur: values.priceEur ?? undefined,
        mileage: values.mileage ?? undefined,
        mileageUnit: values.mileageUnit ?? undefined,
        location: values.location ?? undefined,
        country: values.country ?? undefined,
        isActive: values.isActive,
        lastSeenAt: lastSeen,
      })
      .where(eq(listingsTable.id, existing.id));
    return { id: existing.id, created: false };
  }

  const [row] = await db.insert(listingsTable).values(values).returning({ id: listingsTable.id });
  return { id: row!.id, created: true };
}

function photoIdentityKeysForRow(sourceUrl: string, storedPath?: string | null): string[] {
  const keys: string[] = [];
  if (sourceUrl) keys.push(photoIdentityKey(sourceUrl));
  if (storedPath && /^https?:\/\//i.test(storedPath)) {
    keys.push(photoIdentityKey(storedPath));
  }
  return keys;
}

async function loadVehiclePhotoIdentityKeys(vehicleId: number): Promise<{
  keys: Set<string>;
  hasCdn: boolean;
}> {
  const rows = await db
    .select({ sourceUrl: photosTable.sourceUrl, storedPath: photosTable.storedPath })
    .from(photosTable)
    .where(eq(photosTable.vehicleId, vehicleId));

  const keys = new Set<string>();
  let hasCdn = false;
  for (const row of rows) {
    for (const key of photoIdentityKeysForRow(row.sourceUrl, row.storedPath)) {
      keys.add(key);
    }
    if (isHostedCdnUrl(row.sourceUrl) || isHostedCdnUrl(row.storedPath)) {
      hasCdn = true;
    }
  }
  return { keys, hasCdn };
}

/** Skip photos already on the VIN, ephemeral re-imports after CDN mirror, and within-batch dupes. */
function filterNewCatalogPhotos(
  incoming: CatalogListing["photos"],
  state: { keys: Set<string>; hasCdn: boolean },
): NonNullable<CatalogListing["photos"]> {
  const out: NonNullable<CatalogListing["photos"]> = [];
  for (const photo of incoming ?? []) {
    const sourceUrl = canonicalPhotoUrl(photo.sourceUrl ?? "");
    if (!/^https?:\/\//i.test(sourceUrl)) continue;
    if (state.hasCdn && isEphemeralPhotoHost(sourceUrl)) continue;

    const key = photoIdentityKey(sourceUrl);
    if (state.keys.has(key)) continue;

    state.keys.add(key);
    out.push({ ...photo, sourceUrl });
  }
  return out;
}

export async function importCatalogListings(listings: CatalogListing[]): Promise<VinImportResult> {
  const result: VinImportResult = {
    listingsRead: listings.length,
    vehiclesUpserted: 0,
    listingsUpserted: 0,
    photosAdded: 0,
    observationsAdded: 0,
    eventsAdded: 0,
    skippedNoVin: 0,
    providersCreated: [],
    errors: [],
  };

  const providerCache = new Map<string, number>();
  const existingProviders = await db.select({
    id: providersTable.id,
    internalName: providersTable.internalName,
    name: providersTable.name,
  }).from(providersTable);
  for (const provider of existingProviders) {
    providerCache.set(provider.internalName.toLowerCase(), provider.id);
    providerCache.set(provider.name.toLowerCase(), provider.id);
  }

  for (const listing of listings) {
    try {
      const vin = normalizeCatalogVin(listing.vin);
      if (!vin) {
        result.skippedNoVin++;
        continue;
      }
      const providerKey = listing.provider?.trim() || listing.providerName?.trim();
      if (!providerKey) {
        result.errors.push(`VIN ${vin}: missing provider`);
        continue;
      }
      const providerId = await resolveProvider(
        providerCache,
        result.providersCreated,
        listing.provider?.trim() || providerKey,
        listing.providerName,
      );

      const vehicle = listing.vehicle ?? {};
      const originCountry = resolveVehicleOriginCountry({
        country: vehicle.country ?? listing.country,
        providerInternalName: listing.provider?.trim() || providerKey,
      });
      const { vehicleId } = await upsertVehicle(
        vin,
        {
          vin,
          make: vehicle.make ?? undefined,
          model: vehicle.model ?? undefined,
          year: vehicle.year ?? undefined,
          trim: vehicle.trim ?? undefined,
          bodyType: vehicle.bodyType ?? undefined,
          fuelType: vehicle.fuelType ?? undefined,
          transmission: vehicle.transmission ?? undefined,
          driveType: vehicle.driveType ?? undefined,
          engineDisplacement: vehicle.engineDisplacement ?? undefined,
          color: vehicle.color ?? undefined,
          country: originCountry,
        },
        vehicle.currentKnownMileage ?? listing.mileage ?? undefined,
        asDate(listing.lastSeenAt),
        listing.mileageUnit ?? "km",
      );
      result.vehiclesUpserted++;

      const { id: listingId } = await upsertImportedListing(providerId, vin, vehicleId, listing);
      result.listingsUpserted++;

      const photoState = await loadVehiclePhotoIdentityKeys(vehicleId);
      const photos = filterNewCatalogPhotos(
        (listing.photos ?? []).map((photo) => ({
          ...photo,
          sourceUrl: canonicalPhotoUrl(photo.sourceUrl ?? ""),
        })),
        photoState,
      ).filter((photo) => /^https?:\/\//i.test(photo.sourceUrl));
      if (photos.length) {
        await storePhotos(
          vehicleId,
          listingId,
          photos.map((photo, index) => ({
            sourceUrl: photo.sourceUrl,
            isPrimary: photo.isPrimary ?? index === 0,
            sortOrder: photo.sortOrder ?? index,
            width: photo.width ?? undefined,
            height: photo.height ?? undefined,
          })),
        );
        result.photosAdded += photos.length;
      }

      const observations = listing.observations?.length
        ? listing.observations
        : [
            {
              priceAmount: listing.priceAmount,
              priceCurrency: listing.priceCurrency,
              mileage: listing.mileage,
              mileageUnit: listing.mileageUnit,
              listingStatus: listing.isActive === false ? "inactive" : "active",
              location: listing.location,
              observedAt: listing.lastSeenAt,
            },
          ];

      for (const obs of observations) {
        const status = obs.listingStatus ?? (listing.isActive === false ? "inactive" : "active");
        const obsPriced = await attachListingFx({
          priceAmount: obs.priceAmount ?? listing.priceAmount ?? undefined,
          priceCurrency: obs.priceCurrency ?? listing.priceCurrency ?? "USD",
          priceUsd: obs.priceUsd ?? undefined,
          priceEur: obs.priceEur ?? undefined,
        });
        const fingerprint = computeFingerprintHash(
            vin,
            providerId,
            obsPriced.priceAmount ?? undefined,
            obs.mileage ?? undefined,
            status,
          );
        const inserted = await db
          .insert(vehicleObservationsTable)
          .values({
            vehicleId,
            providerId,
            listingId,
            sourceListingId: listing.sourceId || `import:${vin}`,
            fingerprintHash: fingerprint,
            priceAmount: obsPriced.priceAmount ?? null,
            priceCurrency: obsPriced.priceCurrency ?? listing.priceCurrency ?? "USD",
            priceUsd: obsPriced.priceUsd ?? null,
            priceEur: obsPriced.priceEur ?? null,
            mileage: obs.mileage ?? null,
            mileageUnit: obs.mileageUnit ?? listing.mileageUnit ?? "km",
            listingStatus: status,
            location: obs.location ?? listing.location ?? null,
            observedAt: asDate(obs.observedAt) ?? new Date(),
          } satisfies InsertVehicleObservation)
          .onConflictDoNothing()
          .returning({ id: vehicleObservationsTable.id });
        result.observationsAdded += inserted.length;
      }

      const events = listing.events ?? [];
      if (events.length) {
        const inserted = await db
          .insert(vehicleEventsTable)
          .values(
            events
              .filter((event) => event.eventType)
              .map(
                (event) =>
                  ({
                    vehicleId,
                    eventType: event.eventType,
                    description: event.description ?? null,
                    metadata: event.metadata ?? null,
                    occurredAt: asDate(event.occurredAt) ?? new Date(),
                  }) satisfies InsertVehicleEvent,
              ),
          )
          .onConflictDoNothing()
          .returning({ id: vehicleEventsTable.id });
        result.eventsAdded += inserted.length;
      }
    } catch (err) {
      result.errors.push(`${listing.vin ?? "?"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function csvToCatalogListings(csv: string): CatalogListing[] {
  const text = csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const listings: CatalogListing[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const get = (name: string) => {
      const i = idx(name);
      if (i < 0) return "";
      return (cols[i] ?? "").trim();
    };
    const num = (name: string) => {
      const raw = get(name).replace(/,/g, "");
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    const vin = get("vin");
    const provider = get("provider");
    if (!vin || !provider) continue;
    listings.push({
      vin,
      provider,
      providerName: provider,
      sourceId: get("source_id") || `import:${vin}`,
      sourceUrl: get("listing_url") || null,
      title: [get("year"), get("make"), get("model")].filter(Boolean).join(" ") || null,
      priceAmount: num("price"),
      priceCurrency: get("currency") || "USD",
      priceUsd: num("price_usd"),
      priceEur: num("price_eur"),
      mileage: num("mileage_km"),
      mileageUnit: "km",
      location: get("location") || null,
      country: get("country") || null,
      isActive: get("active").toLowerCase() !== "no",
      firstSeenAt: get("first_seen") || null,
      lastSeenAt: get("last_seen") || null,
      vehicle: {
        make: get("make") || null,
        model: get("model") || null,
        year: num("year"),
        trim: get("trim") || null,
        fuelType: get("fuel") || null,
        transmission: get("transmission") || null,
        driveType: get("drivetrain") || null,
        engineDisplacement: get("engine") || null,
        color: get("color") || null,
        bodyType: get("body_type") || null,
        country: get("country") || null,
        currentKnownMileage: num("mileage_km"),
      },
    });
  }
  return listings;
}

export function parseVinImportPayload(body: unknown): CatalogListing[] {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseVinImportPayload(JSON.parse(trimmed));
    return csvToCatalogListings(trimmed);
  }
  if (!body || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  if (typeof rec.csv === "string") return csvToCatalogListings(rec.csv);
  if (Array.isArray(rec.listings)) return rec.listings as CatalogListing[];
  if (Array.isArray(rec.vehicles)) {
    const out: CatalogListing[] = [];
    for (const vehicle of rec.vehicles as Array<CatalogVehicle & { vin?: string; listings?: CatalogListing[]; events?: CatalogListing["events"] }>) {
      for (const listing of vehicle.listings ?? []) {
        out.push({
          ...listing,
          vin: listing.vin || vehicle.vin || "",
          vehicle: listing.vehicle ?? vehicle,
          events: listing.events ?? vehicle.events,
        });
      }
    }
    return out;
  }
  if (Array.isArray(body)) return body as CatalogListing[];
  return [];
}
