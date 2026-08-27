/**
 * Public Live Inventory API endpoints (v1)
 *
 * GET /api/v1/live/providers           — enabled live feeds (encar, autowini, kbchachacha, …)
 * GET /api/v1/live/vehicles            — token-authenticated list; pass provider=kbchachacha_live
 * GET /api/v1/live/vehicles/:id        — token-authenticated detail by listing ID
 */
import { Router } from "express";
import { ListLiveVehiclesQueryParams, GetLiveVehicleParams } from "@workspace/api-zod";
import { requireApiToken } from "../../middlewares/apiTokenAuth";
import { requireApiFeature } from "../../lib/apiAccess";
import { requireClientLiveFeed } from "../../lib/clientLiveFeed";
import type { LiveVehicleFilter } from "@workspace/providers";
import {
  browseLiveVehicle,
  browseLiveVehicles,
  listEnabledLiveProviders,
  liveBrowseErrorStatus,
  LiveBrowseError,
  registeredLiveProviderNames,
  resolvePublicLiveProvider,
  isCombinedLiveSlug,
  applyLiveCacheHeaders,
} from "../../lib/liveBrowse";
import { browseCombinedLiveVehicles } from "../../lib/liveCombined";
import { DEMO_LIVE_LIMIT, isPublicDemoRequest, sanitizeDemoVehicles } from "../../lib/public-demo";

const router = Router();

/** Page payload without inventory size — clients paginate via hasMore. */
function livePageData(opts: {
  vehicles: unknown[];
  total: number;
  limit: number;
  offset: number;
  cached?: boolean;
  cachedAt?: string | Date | null;
  provider: unknown;
  sources?: unknown;
}) {
  const count = opts.vehicles.length;
  return {
    vehicles: opts.vehicles,
    hasMore: opts.offset + count < opts.total,
    limit: opts.limit,
    offset: opts.offset,
    ...(opts.cached !== undefined ? { cached: opts.cached } : {}),
    ...(opts.cachedAt != null ? { cachedAt: opts.cachedAt } : {}),
    provider: opts.provider,
    ...(opts.sources !== undefined ? { sources: opts.sources } : {}),
  };
}

function queryProvider(query: unknown): string | undefined {
  if (!query || typeof query !== "object") return undefined;
  const raw = (query as Record<string, unknown>).provider;
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : undefined;
  return typeof raw === "string" ? raw : undefined;
}

async function pickLiveProvider(req: { query: unknown }, res: {
  status: (code: number) => { json: (body: unknown) => void };
}): Promise<{ id: number; name: string; internalName: string } | null> {
  const { provider, requested, unknownAdapter } = await resolvePublicLiveProvider(queryProvider(req.query));
  if (unknownAdapter) {
    res.status(400).json({
      success: false,
      error: {
        code: "INVALID_PROVIDER",
        message: `Unknown live provider '${requested}'. Valid options: ${registeredLiveProviderNames().join(", ")}, all`,
      },
    });
    return null;
  }
  if (!provider) {
    const code = requested ? "PROVIDER_NOT_FOUND" : "NO_LIVE_PROVIDER";
    const message = requested
      ? `Live provider '${requested}' is not enabled`
      : "No live feed provider is currently enabled";
    res.status(requested ? 404 : 503).json({
      success: false,
      error: { code, message },
    });
    return null;
  }
  return provider;
}

router.get(
  "/providers",
  requireApiToken,
  requireApiFeature("live"),
  requireClientLiveFeed,
  async (_req, res): Promise<void> => {
  const providers = await listEnabledLiveProviders();
  const data =
    providers.length > 1
      ? [{ id: 0, name: "All enabled feeds", internalName: "combined_live" }, ...providers]
      : providers;
  res.json({ success: true, data });
});

router.get(
  "/vehicles",
  requireApiToken,
  requireApiFeature("live"),
  requireClientLiveFeed,
  async (req, res): Promise<void> => {
  const combined = isCombinedLiveSlug(queryProvider(req.query));
  const query = combined && req.query && typeof req.query === "object"
    ? Object.fromEntries(Object.entries(req.query as Record<string, unknown>).filter(([key]) => key !== "provider"))
    : req.query;
  const parsed = ListLiveVehiclesQueryParams.safeParse(query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PARAMS", message: parsed.error.message },
    });
    return;
  }

  const liveFilters: LiveVehicleFilter = parsed.data;
  if (isPublicDemoRequest(req)) {
    liveFilters.limit = Math.min(Number(liveFilters.limit ?? DEMO_LIVE_LIMIT) || DEMO_LIVE_LIMIT, DEMO_LIVE_LIMIT);
    liveFilters.offset = 0;
  }

  try {
    if (combined) {
      const result = await browseCombinedLiveVehicles(liveFilters);
      applyLiveCacheHeaders(res, result.cached);
      res.json({
        success: true,
        data: livePageData({
          vehicles: sanitizeDemoVehicles(result.vehicles, isPublicDemoRequest(req)),
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          cached: result.cached,
          cachedAt: result.cachedAt,
          provider: result.provider,
          sources: result.sources,
        }),
      });
      return;
    }

    const provider = await pickLiveProvider(req, res);
    if (!provider) return;

    const result = await browseLiveVehicles(provider.id, liveFilters);
    applyLiveCacheHeaders(res, result.cached);
    res.json({
      success: true,
      data: livePageData({
        vehicles: sanitizeDemoVehicles(result.vehicles, isPublicDemoRequest(req)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        cached: result.cached,
        cachedAt: result.cachedAt,
        provider: result.provider,
      }),
    });
  } catch (err: unknown) {
    if (err instanceof LiveBrowseError) {
      res.status(liveBrowseErrorStatus(err.code)).json({
        success: false,
        error: { code: err.code, message: err.message },
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      success: false,
      error: { code: "UPSTREAM_ERROR", message: `Live provider error: ${msg}` },
    });
  }
});

router.get(
  "/vehicles/:id",
  requireApiToken,
  requireApiFeature("live"),
  requireClientLiveFeed,
  async (req, res): Promise<void> => {
  const params = GetLiveVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PARAMS", message: "Listing ID is required" },
    });
    return;
  }

  const provider = await pickLiveProvider(req, res);
  if (!provider) return;

  try {
    const result = await browseLiveVehicle(provider.id, params.data.id);
    const vehicle = isPublicDemoRequest(req)
      ? sanitizeDemoVehicles([result.vehicle], true)[0]
      : result.vehicle;
    res.json({
      success: true,
      data: vehicle,
      cached: result.cached,
      cachedAt: result.cachedAt,
      provider: result.provider,
    });
  } catch (err: unknown) {
    if (err instanceof LiveBrowseError) {
      res.status(liveBrowseErrorStatus(err.code)).json({
        success: false,
        error: { code: err.code, message: err.message },
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      success: false,
      error: { code: "UPSTREAM_ERROR", message: `Live provider error: ${msg}` },
    });
  }
});

export default router;
