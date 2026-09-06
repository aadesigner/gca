import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, apiTokensTable } from "@workspace/db";
import type { ApiToken } from "@workspace/db";
import { encryptPendingReveal } from "./tokenReveal";

export const TEST_TOKEN_NAME = "Test key";

export async function mintApiToken(opts: {
  clientId: number;
  name: string;
  isTestOnly?: boolean;
  expiresAt?: Date | null;
  /** When true (default), store encrypted one-time reveal for the client portal. */
  storePendingReveal?: boolean;
}): Promise<{ rawToken: string; token: ApiToken }> {
  const rawToken = `vdi_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const tokenPrefix = rawToken.substring(0, 12);
  const storeReveal = opts.storePendingReveal !== false;
  const reveal = storeReveal ? encryptPendingReveal(rawToken) : null;

  const [token] = await db
    .insert(apiTokensTable)
    .values({
      clientId: opts.clientId,
      name: opts.name,
      tokenHash,
      tokenPrefix,
      isTestOnly: opts.isTestOnly ?? false,
      expiresAt: opts.expiresAt ?? null,
      isActive: true,
      pendingReveal: reveal?.blob ?? null,
      pendingRevealExpiresAt: reveal?.expiresAt ?? null,
    })
    .returning();

  if (!token) throw new Error("Could not mint API token");
  return { rawToken, token };
}
