import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, apiTokensTable } from "@workspace/db";
import type { ApiToken } from "@workspace/db";
import { mintApiToken } from "./mintApiToken";
import { isTestVin } from "./test-vins";

export const DEFAULT_API_TOKEN_NAME = "API key";

/** Legacy test-only keys — restricted to sandbox VIN routes only. */
export function testTokenPathAllowed(path: string): boolean {
  if (path.includes("/v1/live")) return false;
  if (path.endsWith("/v1/test-vins") || path.endsWith("/v1/test-vins/")) return true;
  if (path.includes("/v1/vin/check/")) return true;
  if (/\/v1\/vin\/[^/]+$/.test(path) && !path.includes("/check/")) return true;
  return false;
}

/** Legacy test-only keys cannot query real VINs. */
export function rejectTestTokenNonTestVin(req: Request, res: Response, vin: string): boolean {
  if (!req.isTestOnly) return false;
  if (isTestVin(vin)) return false;

  res.status(403).json({
    success: false,
    error: {
      code: "TEST_TOKEN_LIMIT",
      message:
        "This legacy test API key only works with curated test VINs. Use your main API key for other VINs.",
    },
  });
  return true;
}

export async function findActiveProductionToken(clientId: number): Promise<ApiToken | null> {
  const [row] = await db
    .select()
    .from(apiTokensTable)
    .where(
      and(
        eq(apiTokensTable.clientId, clientId),
        eq(apiTokensTable.isActive, true),
        eq(apiTokensTable.isTestOnly, false),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Ensure the client has an active production API key (issued at registration). */
export async function ensureProductionToken(clientId: number): Promise<{
  created: boolean;
  rawToken?: string;
  token: ApiToken;
}> {
  const existing = await findActiveProductionToken(clientId);
  if (existing) return { created: false, token: existing };

  await revokeLegacyTestTokens(clientId);

  const { rawToken, token } = await mintApiToken({
    clientId,
    name: DEFAULT_API_TOKEN_NAME,
    isTestOnly: false,
  });
  return { created: true, rawToken, token };
}

/** Revoke legacy sandbox-only keys when issuing a production key. */
export async function revokeLegacyTestTokens(clientId: number): Promise<number> {
  const revoked = await db
    .update(apiTokensTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(
      and(
        eq(apiTokensTable.clientId, clientId),
        eq(apiTokensTable.isTestOnly, true),
        eq(apiTokensTable.isActive, true),
      ),
    )
    .returning({ id: apiTokensTable.id });
  return revoked.length;
}
