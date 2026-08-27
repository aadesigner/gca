/**
 * Admin routes for Live Feed provider management.
 *
 * GET    /api/admin/live-feeds          — list all live providers with stats
 * POST   /api/admin/live-feeds          — create a new live provider
 * GET    /api/admin/live-feeds/:id      — get single provider with stats
 * PUT    /api/admin/live-feeds/:id      — update config / credentials
 * DELETE /api/admin/live-feeds/:id      — delete
 * POST   /api/admin/live-feeds/:id/test — test upstream connectivity
 */
import { Router, type IRouter } from "express";
import {
  CreateLiveFeedBody,
  UpdateLiveFeedBody,
  GetLiveFeedParams,
  UpdateLiveFeedParams,
  DeleteLiveFeedParams,
  TestLiveFeedConnectivityParams,
} from "@workspace/api-zod";
import { db, liveProvidersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/auth";
import { encrypt, decrypt } from "../../lib/crypto";
import { getProviderStats } from "../../lib/liveCache";
import { validateUpstreamUrl } from "../../lib/urlValidation";
import {
  browseLiveVehicle,
  browseLiveVehicles,
  getLiveProviderById,
  listEnabledLiveProviders,
  LIVE_ADAPTERS,
  liveBrowseErrorStatus,
  LiveBrowseError,
  applyLiveCacheHeaders,
} from "../../lib/liveBrowse";
import {
  browseCombinedLiveVehicles,
  COMBINED_LIVE_PROVIDER,
  getCombinedLiveCapabilities,
  getCombinedLiveFilterOptions,
} from "../../lib/liveCombined";
import { parseExtendedLiveFilters } from "../../lib/parseLiveFilters";
import { getEncarLiveFilterOptions } from "../../lib/providers/encar-live-bridge";
import { getAutowiniLiveFilterOptions } from "../../lib/providers/autowiniLive";
import { getKbchachachaLiveFilterOptions } from "../../lib/providers/kbchachachaLive";
import { getKrwFxSnapshot, withLivePriceFx } from "../../lib/fx";
import { buildOwnerChangeTable } from "../../lib/owner-changes";
import { computeFingerprint, getCached, getStaleCached, setCached, recordCacheHit } from "../../lib/liveCache";

const router: IRouter = Router();

// Registry kept for create/test validation (browse uses LIVE_ADAPTERS from liveBrowse)
const LIVE_ADAPTER_NAMES = LIVE_ADAPTERS;

// ── Helpers ────────────────────────────────────────────────────────────────

function safeDecryptCredentials(
  encrypted: string | null | undefined,
  iv: string | null | undefined
): { apiUrl?: string; apiToken?: string } {
  if (!encrypted || !iv) return {};
  try {
    return JSON.parse(decrypt(encrypted, iv)) as { apiUrl?: string; apiToken?: string };
  } catch {
    return {};
  }
}

function buildProviderResponse(provider: typeof liveProvidersTable.$inferSelect) {
  return {
    id: provider.id,
    name: provider.name,
    internalName: provider.internalName,
    isEnabled: provider.isEnabled,
    cacheTtlSeconds: provider.cacheTtlSeconds,
    hasCredentials: !!provider.credentialsEncrypted,
    lastTestedAt: provider.lastTestedAt ?? null,
    lastTestOk: provider.lastTestOk ?? null,
    lastTestError: provider.lastTestError ?? null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

async function encryptAndValidateCredentials(credentials: {
  apiUrl?: string;
  apiToken?: string;
}): Promise<
  | { ok: true; credentialsEncrypted: string; credentialsIv: string }
  | { ok: false; error: string }
> {
  if (credentials.apiUrl) {
    const check = await validateUpstreamUrl(credentials.apiUrl);
    if (!check.valid) {
      return { ok: false, error: `Invalid upstream URL: ${check.error}` };
    }
  }
  try {
    const { encrypted, iv } = encrypt(JSON.stringify(credentials));
    return { ok: true, credentialsEncrypted: encrypted, credentialsIv: iv };
  } catch (err: unknown) {
    return { ok: false, error: "Failed to encrypt credentials: " + String(err) };
  }
}

async function sendLiveVehicleDetail(
  res: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void },
  id: number,
  listingId: string,
): Promise<void> {
  const result = await loadLiveVehicleDetail(id, listingId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, code: result.code });
    return;
  }
  res.json({ success: true, data: result.data });
}

async function loadLiveVehicleDetail(
  id: number,
  listingId: string,
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; error: string; code?: string }
> {
  const provider = await getLiveProviderById(id);
  if (!provider) {
    return { ok: false, status: 404, error: "Live feed provider not found" };
  }

  const adapter = LIVE_ADAPTERS[provider.internalName];
  if (!adapter?.fetchVehicleDetail && !adapter?.fetchVehicle) {
    return { ok: false, status: 501, error: "Detail view not supported for this provider" };
  }

  const credentials = safeDecryptCredentials(provider.credentialsEncrypted, provider.credentialsIv);
  const fingerprint = computeFingerprint({
    kind: "detail",
    locale: "en-v8",
    providerId: id,
    listingId,
  });
  const ttl = Math.max(provider.cacheTtlSeconds || 60, 600);
  const sourceProvider = { id: provider.id, name: provider.name, internalName: provider.internalName };

  const decorate = async (detail: Record<string, unknown>) => {
    const fx = await getKrwFxSnapshot();
    const vehicle = (detail.vehicle ?? {}) as { price?: number; currency?: string };
    return {
      ...detail,
      vehicle: { ...withLivePriceFx(vehicle, fx), sourceProvider },
    };
  };

  const cached = await getCached<Record<string, unknown>>(id, fingerprint);
  if (cached?.data) {
    if (cached.id) recordCacheHit(cached.id, id);
    return { ok: true, data: await decorate(cached.data) };
  }

  const asPartial = (vehicle: Record<string, unknown>) => ({
    vehicle,
    photos: Array.isArray(vehicle.photos) ? vehicle.photos : [],
    events: [],
    listingUrl: vehicle.listingUrl,
    partial: true,
  });

  try {
    let detail = adapter.fetchVehicleDetail
      ? await adapter.fetchVehicleDetail(listingId, credentials)
      : null;
    if (!detail && adapter.fetchVehicle) {
      const vehicle = await adapter.fetchVehicle(listingId, credentials);
      if (vehicle) detail = asPartial(vehicle as unknown as Record<string, unknown>) as typeof detail;
    }
    if (!detail) {
      return { ok: false, status: 404, error: "Listing not found" };
    }
    const ownerChanges = buildOwnerChangeTable(detail.events ?? [], []);
    const payload = {
      ...detail,
      ownerChanges:
        ownerChanges.length > 0 ? ownerChanges : detail.registry?.ownerChanges ?? [],
    };
    await setCached(id, fingerprint, payload, 1, ttl);
    return { ok: true, data: await decorate(payload as Record<string, unknown>) };
  } catch (err) {
    const stale = await getStaleCached<Record<string, unknown>>(id, fingerprint);
    if (stale?.data) {
      return { ok: true, data: await decorate(stale.data) };
    }
    try {
      const listed = await browseLiveVehicle(id, listingId);
      return { ok: true, data: await decorate(asPartial(listed.vehicle as unknown as Record<string, unknown>)) };
    } catch {
      if (err instanceof LiveBrowseError) {
        return {
          ok: false,
          status: liveBrowseErrorStatus(err.code),
          error: err.message,
          code: err.code,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 502, error: msg };
    }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/admin/live-feeds
router.get("/admin/live-feeds", requireAdmin, async (req, res): Promise<void> => {
  const providers = await db.select().from(liveProvidersTable).orderBy(liveProvidersTable.name);

  const withStats = await Promise.all(
    providers.map(async (p) => {
      const stats = await getProviderStats(p.id);
      return { ...buildProviderResponse(p), stats };
    })
  );

  res.json(withStats);
});

const COMBINED_CATEGORIES = {
  fuels: ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"],
  transmissions: ["Automatic", "Manual", "CVT"],
  drivetrains: ["FWD", "RWD", "AWD", "4WD"],
  statuses: ["AVAILABLE", "RESERVED", "SOLD", "REMOVED"],
};

// GET /api/admin/live-feeds/combined/capabilities — union of enabled adapters
router.get("/admin/live-feeds/combined/capabilities", requireAdmin, async (req, res): Promise<void> => {
  const make = typeof req.query.make === "string" ? req.query.make : undefined;
  const carType = typeof req.query.carType === "string" ? req.query.carType : undefined;
  const filterOptions = await getCombinedLiveFilterOptions(carType, make);
  res.json({
    provider: {
      ...COMBINED_LIVE_PROVIDER,
      isEnabled: true,
      cacheTtlSeconds: 300,
      hasCredentials: false,
      lastTestedAt: null,
      lastTestOk: null,
      lastTestError: null,
      createdAt: null,
      updatedAt: null,
    },
    capabilities: getCombinedLiveCapabilities(),
    filterOptions,
    categories: COMBINED_CATEGORIES,
  });
});

// GET /api/admin/live-feeds/combined/vehicles
router.get("/admin/live-feeds/combined/vehicles", requireAdmin, async (req, res): Promise<void> => {
  const parsed = parseExtendedLiveFilters(req.query as Record<string, unknown>);
  if (!parsed.limit) parsed.limit = 20;
  if (!parsed.carType) parsed.carType = "all";
  const bypassCache = req.query.bypassCache === "true" || req.query.bypassCache === "1";

  try {
    const result = await browseCombinedLiveVehicles(parsed, { bypassCache });
    applyLiveCacheHeaders(res, result.cached);
    res.json({
      success: true,
      data: {
        vehicles: result.vehicles,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        cached: result.cached,
        cachedAt: result.cachedAt,
        provider: result.provider,
        sources: result.sources,
      },
    });
  } catch (err) {
    if (err instanceof LiveBrowseError) {
      res.status(liveBrowseErrorStatus(err.code)).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

// GET /api/admin/live-feeds/combined/vehicles/:listingId/detail?providerId=
router.get(
  "/admin/live-feeds/combined/vehicles/:listingId/detail",
  requireAdmin,
  async (req, res): Promise<void> => {
    const listingIdRaw = req.params.listingId;
    const listingId = Array.isArray(listingIdRaw) ? listingIdRaw[0] ?? "" : listingIdRaw ?? "";
    const providerId = Number(req.query.providerId);
    if (!listingId) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    if (Number.isFinite(providerId) && providerId > 0) {
      await sendLiveVehicleDetail(res, providerId, listingId);
      return;
    }
    const providers = await listEnabledLiveProviders();
    for (const provider of providers) {
      const result = await loadLiveVehicleDetail(provider.id, listingId);
      if (result.ok) {
        res.json({ success: true, data: result.data });
        return;
      }
    }
    res.status(404).json({ error: "Listing not found on any enabled live feed" });
  },
);

// POST /api/admin/live-feeds
router.post("/admin/live-feeds", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateLiveFeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, internalName, isEnabled, cacheTtlSeconds, credentials } = parsed.data;

  // Validate that internalName is a registered adapter
  if (!LIVE_ADAPTER_NAMES[internalName]) {
    const valid = Object.keys(LIVE_ADAPTER_NAMES).join(", ");
    res.status(400).json({
      error: `Unknown adapter internalName '${internalName}'. Valid options: ${valid}`,
    });
    return;
  }

  let credentialsEncrypted: string | null = null;
  let credentialsIv: string | null = null;

  if (credentials && (credentials.apiUrl || credentials.apiToken)) {
    const result = await encryptAndValidateCredentials(credentials);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    credentialsEncrypted = result.credentialsEncrypted;
    credentialsIv = result.credentialsIv;
  }

  const [provider] = await db
    .insert(liveProvidersTable)
    .values({ name, internalName, isEnabled, cacheTtlSeconds, credentialsEncrypted, credentialsIv })
    .returning();

  res.status(201).json(buildProviderResponse(provider!));
});

// GET /api/admin/live-feeds/:id
router.get("/admin/live-feeds/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetLiveFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [provider] = await db
    .select()
    .from(liveProvidersTable)
    .where(eq(liveProvidersTable.id, params.data.id));

  if (!provider) {
    res.status(404).json({ error: "Live feed provider not found" });
    return;
  }

  const stats = await getProviderStats(provider.id);
  res.json({ ...buildProviderResponse(provider), stats });
});

// PUT /api/admin/live-feeds/:id
router.put("/admin/live-feeds/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateLiveFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = UpdateLiveFeedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, isEnabled, cacheTtlSeconds, credentials } = parsed.data;

  const updateValues: Partial<typeof liveProvidersTable.$inferInsert> = {};
  if (name !== undefined) updateValues.name = name;
  if (isEnabled !== undefined) updateValues.isEnabled = isEnabled;
  if (cacheTtlSeconds !== undefined) updateValues.cacheTtlSeconds = cacheTtlSeconds;

  if (credentials && (credentials.apiUrl || credentials.apiToken)) {
    // Merge with existing credentials so a partial update (only apiUrl or only apiToken) works
    const [existing] = await db
      .select()
      .from(liveProvidersTable)
      .where(eq(liveProvidersTable.id, params.data.id));
    const currentCreds = existing
      ? safeDecryptCredentials(existing.credentialsEncrypted, existing.credentialsIv)
      : {};
    const merged = { ...currentCreds, ...credentials };

    const result = await encryptAndValidateCredentials(merged);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    updateValues.credentialsEncrypted = result.credentialsEncrypted;
    updateValues.credentialsIv = result.credentialsIv;
  }

  const [updated] = await db
    .update(liveProvidersTable)
    .set(updateValues)
    .where(eq(liveProvidersTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Live feed provider not found" });
    return;
  }

  res.json(buildProviderResponse(updated));
});

// DELETE /api/admin/live-feeds/:id
router.delete("/admin/live-feeds/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteLiveFeedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await db
    .delete(liveProvidersTable)
    .where(eq(liveProvidersTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Live feed provider not found" });
    return;
  }

  res.sendStatus(204);
});

// POST /api/admin/live-feeds/:id/test
router.post("/admin/live-feeds/:id/test", requireAdmin, async (req, res): Promise<void> => {
  const params = TestLiveFeedConnectivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [provider] = await db
    .select()
    .from(liveProvidersTable)
    .where(eq(liveProvidersTable.id, params.data.id));

  if (!provider) {
    res.status(404).json({ error: "Live feed provider not found" });
    return;
  }

  const adapter = LIVE_ADAPTERS[provider.internalName];
  if (!adapter) {
    res.status(400).json({ error: `No adapter registered for '${provider.internalName}'` });
    return;
  }

  const credentials = safeDecryptCredentials(provider.credentialsEncrypted, provider.credentialsIv);
  const result = await adapter.testConnectivity(credentials);

  // Persist test result
  await db
    .update(liveProvidersTable)
    .set({
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestError: result.error ?? null,
    })
    .where(eq(liveProvidersTable.id, provider.id));

  res.json({ ok: result.ok, error: result.error ?? null, testedAt: new Date() });
});

// GET /api/admin/live-feeds/:id/capabilities
router.get("/admin/live-feeds/:id/capabilities", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const provider = await getLiveProviderById(id);
  if (!provider) {
    res.status(404).json({ error: "Live feed provider not found" });
    return;
  }

  const adapter = LIVE_ADAPTERS[provider.internalName];
  if (!adapter) {
    res.status(503).json({ error: `No adapter for '${provider.internalName}'` });
    return;
  }

  const make = typeof req.query.make === "string" ? req.query.make : undefined;
  const carType = typeof req.query.carType === "string" ? req.query.carType : undefined;

  const filterOptions =
    provider.internalName === "encar_live"
      ? getEncarLiveFilterOptions(carType, make)
      : provider.internalName === "autowini_live"
        ? await getAutowiniLiveFilterOptions(make)
        : provider.internalName === "kbchachacha_live"
          ? getKbchachachaLiveFilterOptions(make)
        : {
            fuels: ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"],
            transmissions: ["Automatic", "Manual", "CVT"],
            drivetrains: ["FWD", "RWD", "AWD", "4WD"],
            makes: [],
            models: [],
            carTypes: [],
            sortOptions: [],
          };

  res.json({
    provider: buildProviderResponse(provider),
    capabilities: adapter.getCapabilities(),
    filterOptions,
    categories: {
      fuels: ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"],
      transmissions: ["Automatic", "Manual", "CVT"],
      drivetrains: ["FWD", "RWD", "AWD", "4WD"],
      statuses: ["AVAILABLE", "RESERVED", "SOLD", "REMOVED"],
    },
  });
});

// GET /api/admin/live-feeds/:id/vehicles — admin sandbox (per-provider, session auth)
router.get("/admin/live-feeds/:id/vehicles", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = parseExtendedLiveFilters(req.query as Record<string, unknown>);
  if (!parsed.limit) parsed.limit = 20;

  const bypassCache = req.query.bypassCache === "true" || req.query.bypassCache === "1";

  try {
    const result = await browseLiveVehicles(id, parsed, { bypassCache });
    applyLiveCacheHeaders(res, result.cached);
    res.json({
      success: true,
      data: {
        vehicles: result.vehicles,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        cached: result.cached,
        cachedAt: result.cachedAt,
        provider: result.provider,
      },
    });
  } catch (err) {
    if (err instanceof LiveBrowseError) {
      res.status(liveBrowseErrorStatus(err.code)).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

// GET /api/admin/live-feeds/:id/vehicles/:listingId/detail — full registry/accident/diagnosis
router.get(
  "/admin/live-feeds/:id/vehicles/:listingId/detail",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const listingIdRaw = req.params.listingId;
    const listingId = Array.isArray(listingIdRaw) ? listingIdRaw[0] ?? "" : listingIdRaw ?? "";
    if (!Number.isFinite(id) || !listingId) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }
    await sendLiveVehicleDetail(res, id, listingId);
  },
);

// GET /api/admin/live-feeds/:id/vehicles/:listingId
router.get("/admin/live-feeds/:id/vehicles/:listingId", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const listingIdRaw = req.params.listingId;
  const listingId = Array.isArray(listingIdRaw) ? listingIdRaw[0] ?? "" : listingIdRaw ?? "";
  if (!Number.isFinite(id) || !listingId) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  const bypassCache = req.query.bypassCache === "true" || req.query.bypassCache === "1";

  try {
    const result = await browseLiveVehicle(id, listingId, { bypassCache });
    res.json({
      success: true,
      data: result.vehicle,
      cached: result.cached,
      cachedAt: result.cachedAt,
    });
  } catch (err) {
    if (err instanceof LiveBrowseError) {
      res.status(liveBrowseErrorStatus(err.code)).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

export default router;
