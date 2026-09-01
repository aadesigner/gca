/**
 * API token authentication middleware for the public v1 API.
 *
 * Extracts a Bearer token from the Authorization header, finds the matching
 * ApiToken record (via prefix lookup + bcrypt comparison), attaches the resolved
 * ApiClient and ApiToken to the request, and returns structured 401 errors
 * for missing / invalid / expired / disabled tokens.
 */
import type { Request, Response, NextFunction } from "express";
import { db, apiTokensTable, apiClientsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { endpointAllowed, getStoredPublicDemoToken } from "../lib/public-demo";
import { testTokenPathAllowed } from "../lib/testToken";

export async function requireApiToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: {
        code: "MISSING_TOKEN",
        message: "API token required. Provide: Authorization: Bearer <token>",
      },
    });
    return;
  }

  const rawToken = authHeader.slice(7).trim();

  if (!rawToken.startsWith("vdi_")) {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Invalid token format" },
    });
    return;
  }

  // Tokens are `vdi_` + 64 hex chars = 68 chars; prefix is first 12 chars
  const tokenPrefix = rawToken.substring(0, 12);

  // Narrow the search by prefix before the expensive bcrypt comparison
  const candidates = await db
    .select({
      token: apiTokensTable,
      client: apiClientsTable,
    })
    .from(apiTokensTable)
    .innerJoin(apiClientsTable, eq(apiTokensTable.clientId, apiClientsTable.id))
    .where(
      and(
        eq(apiTokensTable.tokenPrefix, tokenPrefix),
        eq(apiTokensTable.isActive, true),
      ),
    );

  let matched: (typeof candidates)[0] | null = null;
  for (const candidate of candidates) {
    const ok = await bcrypt.compare(rawToken, candidate.token.tokenHash);
    if (ok) {
      matched = candidate;
      break;
    }
  }

  if (!matched) {
    res.status(401).json({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Invalid or revoked API token" },
    });
    return;
  }

  // Check token expiry
  if (matched.token.expiresAt && matched.token.expiresAt < new Date()) {
    res.status(401).json({
      success: false,
      error: { code: "TOKEN_EXPIRED", message: "API token has expired" },
    });
    return;
  }

  // Check client is active
  if (!matched.client.isActive) {
    res.status(401).json({
      success: false,
      error: { code: "CLIENT_DISABLED", message: "API client account is disabled" },
    });
    return;
  }

  // Update lastUsedAt asynchronously — don't block the response
  db.update(apiTokensTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokensTable.id, matched.token.id))
    .catch(() => {});

  req.apiClient = matched.client;
  req.apiToken = matched.token;
  req.isTestOnly = matched.token.isTestOnly === true;
  const demoToken = await getStoredPublicDemoToken();
  req.isPublicDemo = !!demoToken && rawToken === demoToken;

  const path = req.originalUrl?.split("?")[0] ?? req.path;
  if (!endpointAllowed(path, matched.client.allowedEndpoints)) {
    res.status(403).json({
      success: false,
      error: {
        code: "ENDPOINT_NOT_ALLOWED",
        message: "This API key cannot call that route",
      },
    });
    return;
  }

  if (req.isPublicDemo && path.includes("/v1/vin")) {
    res.status(403).json({
      success: false,
      error: {
        code: "DEMO_LIMIT",
        message: "The public demo key is limited to live Korean stock",
      },
    });
    return;
  }

  if (req.isTestOnly && !testTokenPathAllowed(path)) {
    res.status(403).json({
      success: false,
      error: {
        code: "TEST_TOKEN_LIMIT",
        message: "This test API key only works with curated test VINs (check, retrieve, and /test-vins).",
      },
    });
    return;
  }

  next();
}
