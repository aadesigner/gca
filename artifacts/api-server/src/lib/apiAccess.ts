import { loadBillingSettings } from "./credits";
import type { RequestHandler } from "express";

export type ApiPublicFeature = "vin_retrieve" | "vin_check" | "live";

export type ApiFeatureGate =
  | { ok: true }
  | { ok: false; code: "API_FEATURE_DISABLED"; message: string; feature: ApiPublicFeature };

/**
 * Global kill-switches for public API products.
 * When disabled: return an error — never consume credits.
 */
export async function checkApiFeature(feature: ApiPublicFeature): Promise<ApiFeatureGate> {
  const settings = await loadBillingSettings();
  const enabled =
    feature === "vin_retrieve"
      ? settings?.apiVinRetrieveEnabled !== false
      : feature === "vin_check"
        ? settings?.apiVinCheckEnabled !== false
        : settings?.apiLiveEnabled !== false;

  if (enabled) return { ok: true };

  const label =
    feature === "vin_retrieve"
      ? "VIN retrieve"
      : feature === "vin_check"
        ? "VIN check"
        : "Live feed";

  return {
    ok: false,
    code: "API_FEATURE_DISABLED",
    feature,
    message: `${label} is temporarily disabled by the operator. No credits were used.`,
  };
}

/** Express middleware — 503 + API_FEATURE_DISABLED, no credits burned. */
export function requireApiFeature(feature: ApiPublicFeature): RequestHandler {
  return async (_req, res, next) => {
    try {
      const gate = await checkApiFeature(feature);
      if (!gate.ok) {
        res.status(503).json({
          success: false,
          error: { code: gate.code, message: gate.message, feature: gate.feature },
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
