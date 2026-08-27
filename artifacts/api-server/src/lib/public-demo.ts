import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import type { LiveVehicle } from "@workspace/providers";

export const DEMO_LIVE_LIMIT = 6;
/** Max cars when the public demo mixes all feeds (6 × 3 providers). */
export const DEMO_LIVE_LIMIT_ALL = 18;
export const DEMO_CLIENT_NAME = "Marketing Demo";
export const DEMO_CLIENT_EMAIL = "demo@getcarapi.com";
export const DEMO_ALLOWED_ENDPOINTS = "/api/v1/live";

export async function getStoredPublicDemoToken(): Promise<string | null> {
  const env = process.env.PUBLIC_DEMO_API_TOKEN?.trim();
  if (env) return env;
  const [row] = await db
    .select({ publicDemoToken: settingsTable.publicDemoToken })
    .from(settingsTable)
    .where(eq(settingsTable.id, 1))
    .limit(1);
  const token = row?.publicDemoToken?.trim();
  return token || null;
}

export async function setStoredPublicDemoToken(token: string | null): Promise<void> {
  await db
    .update(settingsTable)
    .set({ publicDemoToken: token })
    .where(eq(settingsTable.id, 1));
}

export function isPublicDemoRequest(req: Request): boolean {
  return req.isPublicDemo === true;
}

export function endpointAllowed(originalUrl: string, allowedEndpoints?: string | null): boolean {
  if (!allowedEndpoints?.trim()) return true;
  const path = originalUrl.split("?")[0] ?? originalUrl;
  const patterns = allowedEndpoints
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern.endsWith("*")) return path.startsWith(pattern.slice(0, -1));
    return path === pattern || path.startsWith(`${pattern}/`) || path.startsWith(pattern);
  });
}

export function sanitizeDemoVehicles<T extends LiveVehicle>(vehicles: T[], demo: boolean): T[] {
  if (!demo) return vehicles;
  return vehicles.map((vehicle) => ({
    ...vehicle,
    vin: undefined,
    listingId: "",
    listingUrl: undefined,
    photos: vehicle.photos?.slice(0, 1),
    sourceProvider: vehicle.sourceProvider
      ? {
          id: 0,
          name: vehicle.sourceProvider.name,
          internalName: vehicle.sourceProvider.internalName,
        }
      : undefined,
  }));
}
