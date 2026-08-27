/**
 * Per-client live stock access (default off; never charges VIN credits).
 */
import type { Request, Response, NextFunction } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isPublicDemoRequest } from "./public-demo";

export const DEFAULT_LIVE_FEED_CONTACT = "info@getcarapi.com";

export async function getLiveFeedContactEmail(): Promise<string> {
  const [row] = await db
    .select({ liveFeedContactEmail: settingsTable.liveFeedContactEmail })
    .from(settingsTable)
    .where(eq(settingsTable.id, 1))
    .limit(1);
  const email = row?.liveFeedContactEmail?.trim();
  return email || DEFAULT_LIVE_FEED_CONTACT;
}

export type LiveFeedClientFields = {
  liveFeedEnabled?: boolean | null;
  liveFeedExpiresAt?: Date | string | null;
};

export function liveFeedIsActive(client: LiveFeedClientFields): boolean {
  if (!client.liveFeedEnabled) return false;
  if (!client.liveFeedExpiresAt) return true;
  const expires =
    client.liveFeedExpiresAt instanceof Date
      ? client.liveFeedExpiresAt
      : new Date(client.liveFeedExpiresAt);
  if (Number.isNaN(expires.getTime())) return true;
  return expires.getTime() > Date.now();
}

export function liveFeedStatus(client: LiveFeedClientFields): {
  enabled: boolean;
  active: boolean;
  expired: boolean;
  expiresAt: string | null;
  unlimitedDuration: boolean;
  usesCredits: false;
  unlimitedCalls: true;
} {
  const enabled = Boolean(client.liveFeedEnabled);
  const expiresAt =
    client.liveFeedExpiresAt == null
      ? null
      : client.liveFeedExpiresAt instanceof Date
        ? client.liveFeedExpiresAt.toISOString()
        : new Date(client.liveFeedExpiresAt).toISOString();
  const expired =
    enabled &&
    expiresAt != null &&
    !Number.isNaN(Date.parse(expiresAt)) &&
    Date.parse(expiresAt) <= Date.now();
  const active = liveFeedIsActive(client);
  return {
    enabled,
    active,
    expired,
    expiresAt,
    unlimitedDuration: enabled && expiresAt == null,
    usesCredits: false,
    unlimitedCalls: true,
  };
}

/** Parse admin create/update body extras for live feed. */
export function parseLiveFeedBody(raw: Record<string, unknown>): {
  liveFeedEnabled?: boolean;
  liveFeedExpiresAt?: Date | null;
} {
  const out: { liveFeedEnabled?: boolean; liveFeedExpiresAt?: Date | null } = {};

  if (typeof raw.liveFeedEnabled === "boolean") {
    out.liveFeedEnabled = raw.liveFeedEnabled;
  }

  if (raw.liveFeedExpiresAt === null || raw.liveFeedExpiresAt === "") {
    out.liveFeedExpiresAt = null;
  } else if (typeof raw.liveFeedExpiresAt === "string" || raw.liveFeedExpiresAt instanceof Date) {
    const d = raw.liveFeedExpiresAt instanceof Date ? raw.liveFeedExpiresAt : new Date(raw.liveFeedExpiresAt);
    if (!Number.isNaN(d.getTime())) out.liveFeedExpiresAt = d;
  }

  // Convenience: liveFeedDays from now (null/0 = clear expiry / unlimited duration while enabled)
  if (typeof raw.liveFeedDays === "number" && Number.isFinite(raw.liveFeedDays)) {
    const days = Math.trunc(raw.liveFeedDays);
    if (days <= 0) {
      out.liveFeedExpiresAt = null;
    } else {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      out.liveFeedExpiresAt = d;
    }
  }

  return out;
}

/** After requireApiToken + requireApiFeature("live"). Public demo bypasses per-client flag. */
export async function requireClientLiveFeed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isPublicDemoRequest(req)) {
    next();
    return;
  }

  const client = req.apiClient;
  if (!client) {
    res.status(401).json({
      success: false,
      error: { code: "MISSING_TOKEN", message: "API token required" },
    });
    return;
  }

  if (liveFeedIsActive(client)) {
    next();
    return;
  }

  const contact = await getLiveFeedContactEmail();
  const expired =
    Boolean(client.liveFeedEnabled) &&
    client.liveFeedExpiresAt != null &&
    new Date(client.liveFeedExpiresAt).getTime() <= Date.now();

  res.status(403).json({
    success: false,
    error: {
      code: expired ? "LIVE_FEED_EXPIRED" : "LIVE_FEED_DISABLED",
      message: expired
        ? `Live feed access has expired. Contact ${contact} for pricing, providers, and renewal.`
        : `Live feed is not enabled on this account. Contact ${contact} for pricing, details, and providers.`,
      contactEmail: contact,
    },
  });
}
