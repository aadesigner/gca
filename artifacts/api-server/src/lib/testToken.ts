import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, apiTokensTable } from "@workspace/db";
import type { ApiToken } from "@workspace/db";
import { mintApiToken, TEST_TOKEN_NAME } from "./mintApiToken";
import { isTestVin } from "./test-vins";

export function testTokenPathAllowed(path: string): boolean {
  if (path.includes("/v1/live")) return false;
  if (path.endsWith("/v1/test-vins") || path.endsWith("/v1/test-vins/")) return true;
  if (path.includes("/v1/vin/check/")) return true;
  if (/\/v1\/vin\/[^/]+$/.test(path) && !path.includes("/check/")) return true;
  return false;
}

export function rejectTestTokenNonTestVin(req: Request, res: Response, vin: string): boolean {
  if (!req.isTestOnly) return false;
  if (isTestVin(vin)) return false;

  res.status(403).json({
    success: false,
    error: {
      code: "TEST_TOKEN_LIMIT",
      message:
        "This test API key only works with curated test VINs. Request a production key for other VINs.",
    },
  });
  return true;
}

/** Curated test VINs are sandbox-only — production keys must use paid credits on real VINs. */
export function rejectProductionTokenTestVin(req: Request, res: Response, vin: string): boolean {
  if (req.isTestOnly) return false;
  if (!isTestVin(vin)) return false;

  res.status(403).json({
    success: false,
    error: {
      code: "TEST_VIN_SANDBOX",
      message:
        "Curated test VINs work only with a test API key. Use your production key on real VINs (credits required).",
    },
  });
  return true;
}

export async function findActiveTestToken(clientId: number): Promise<ApiToken | null> {
  const [row] = await db
    .select()
    .from(apiTokensTable)
    .where(
      and(
        eq(apiTokensTable.clientId, clientId),
        eq(apiTokensTable.isActive, true),
        eq(apiTokensTable.isTestOnly, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function ensureTestToken(clientId: number): Promise<{
  created: boolean;
  rawToken?: string;
  token: ApiToken;
}> {
  const existing = await findActiveTestToken(clientId);
  if (existing) return { created: false, token: existing };

  const { rawToken, token } = await mintApiToken({
    clientId,
    name: TEST_TOKEN_NAME,
    isTestOnly: true,
  });
  return { created: true, rawToken, token };
}

export async function regenerateTestToken(clientId: number): Promise<{ rawToken: string; token: ApiToken }> {
  await db
    .update(apiTokensTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(
      and(
        eq(apiTokensTable.clientId, clientId),
        eq(apiTokensTable.isTestOnly, true),
        eq(apiTokensTable.isActive, true),
      ),
    );

  return mintApiToken({
    clientId,
    name: TEST_TOKEN_NAME,
    isTestOnly: true,
  });
}
