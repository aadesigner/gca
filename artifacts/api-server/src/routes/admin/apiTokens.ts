import { Router, type IRouter } from "express";
import { db, apiTokensTable, apiClientsTable, apiRequestLogsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  ListApiTokensQueryParams,
  ListApiTokensResponse,
  CreateApiTokenBody,
  CreateApiTokenResponse,
  RevokeApiTokenParams,
  RevokeApiTokenResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import { markClientPaidForToken } from "../../lib/clientBilling";

const router: IRouter = Router();

async function deleteTokenRows(ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  await db
    .update(apiRequestLogsTable)
    .set({ tokenId: null })
    .where(inArray(apiRequestLogsTable.tokenId, ids));
  const deleted = await db
    .delete(apiTokensTable)
    .where(inArray(apiTokensTable.id, ids))
    .returning({ id: apiTokensTable.id });
  return deleted.length;
}

// GET /api/admin/api-tokens
router.get("/admin/api-tokens", requireAdmin, async (req, res): Promise<void> => {
  const params = ListApiTokensQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const whereClause = params.data.clientId
    ? eq(apiTokensTable.clientId, params.data.clientId)
    : undefined;

  const tokens = await db
    .select({
      id: apiTokensTable.id,
      clientId: apiTokensTable.clientId,
      clientName: apiClientsTable.name,
      name: apiTokensTable.name,
      tokenPrefix: apiTokensTable.tokenPrefix,
      isActive: apiTokensTable.isActive,
      expiresAt: apiTokensTable.expiresAt,
      lastUsedAt: apiTokensTable.lastUsedAt,
      revokedAt: apiTokensTable.revokedAt,
      createdAt: apiTokensTable.createdAt,
    })
    .from(apiTokensTable)
    .leftJoin(apiClientsTable, eq(apiTokensTable.clientId, apiClientsTable.id))
    .where(whereClause)
    .orderBy(sql`${apiTokensTable.createdAt} DESC`);

  // tokenPrefix is extra (not in generated Zod schema) — attach after parse.
  const parsed = ListApiTokensResponse.parse(
    tokens.map(({ tokenPrefix: _p, ...row }) => row),
  );
  res.json(
    parsed.map((row, i) => ({
      ...row,
      tokenPrefix: tokens[i]?.tokenPrefix ?? null,
    })),
  );
});

// POST /api/admin/api-tokens
router.post("/admin/api-tokens", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateApiTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [client] = await db
    .select()
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, parsed.data.clientId));

  if (!client) {
    res.status(400).json({ error: "API client not found" });
    return;
  }

  // Generate a secure token
  const rawToken = `vdi_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const tokenPrefix = rawToken.substring(0, 12);

  const [token] = await db
    .insert(apiTokensTable)
    .values({
      clientId: parsed.data.clientId,
      name: parsed.data.name,
      tokenHash,
      tokenPrefix,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      isActive: true,
    })
    .returning();

  await markClientPaidForToken(parsed.data.clientId);

  await writeAuditLog({
    req,
    action: "api_token.create",
    entityType: "api_token",
    entityId: token!.id,
    details: { name: token!.name, clientId: token!.clientId },
  });

  res.status(201).json(
    CreateApiTokenResponse.parse({
      ...token,
      clientName: client.name,
      tokenValue: rawToken, // Only returned once
    }),
  );
});

// POST /api/admin/api-tokens/:id/revoke
router.post("/admin/api-tokens/:id/revoke", requireAdmin, async (req, res): Promise<void> => {
  const params = RevokeApiTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [token] = await db
    .update(apiTokensTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiTokensTable.id, params.data.id))
    .returning();

  if (!token) {
    res.status(404).json({ error: "Token not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "api_token.revoke",
    entityType: "api_token",
    entityId: token.id,
  });

  const [client] = await db
    .select({ name: apiClientsTable.name })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, token.clientId));

  res.json(RevokeApiTokenResponse.parse({ ...token, clientName: client?.name ?? null }));
});

// POST /api/admin/api-tokens/:id/regenerate — revoke + issue new secret once
router.post("/admin/api-tokens/:id/regenerate", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid token id" });
    return;
  }

  const [existing] = await db.select().from(apiTokensTable).where(eq(apiTokensTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Token not found" });
    return;
  }

  await db
    .update(apiTokensTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiTokensTable.id, id));

  const rawToken = `vdi_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const tokenPrefix = rawToken.substring(0, 12);
  const name =
    typeof req.body?.name === "string" && req.body.name.trim()
      ? req.body.name.trim().slice(0, 80)
      : existing.name;

  const [token] = await db
    .insert(apiTokensTable)
    .values({
      clientId: existing.clientId,
      name,
      tokenHash,
      tokenPrefix,
      expiresAt: existing.expiresAt,
      isActive: true,
    })
    .returning();

  await markClientPaidForToken(existing.clientId);

  const [client] = await db
    .select({ name: apiClientsTable.name })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, existing.clientId));

  await writeAuditLog({
    req,
    action: "api_token.regenerate",
    entityType: "api_token",
    entityId: token!.id,
    details: { replacedId: existing.id, clientId: existing.clientId },
  });

  res.status(201).json(
    CreateApiTokenResponse.parse({
      ...token,
      clientName: client?.name ?? null,
      tokenValue: rawToken,
    }),
  );
});

/** Permanently remove a revoked / inactive token row (and detach logs). */
router.delete("/admin/api-tokens/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid token id" });
    return;
  }

  const [existing] = await db.select().from(apiTokensTable).where(eq(apiTokensTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  if (existing.isActive && !existing.revokedAt) {
    res.status(400).json({ error: "Revoke the token before deleting it" });
    return;
  }

  await deleteTokenRows([id]);
  await writeAuditLog({
    req,
    action: "api_token.delete",
    entityType: "api_token",
    entityId: id,
    details: { clientId: existing.clientId, name: existing.name, prefix: existing.tokenPrefix },
  });
  res.json({ success: true, deleted: 1 });
});

/** Delete all revoked / inactive tokens (optionally for one client). */
router.post("/admin/api-tokens/purge-revoked", requireAdmin, async (req, res): Promise<void> => {
  const clientId = Number(req.body?.clientId);
  const conditions = [or(eq(apiTokensTable.isActive, false), isNotNull(apiTokensTable.revokedAt))!];
  if (Number.isFinite(clientId) && clientId > 0) {
    conditions.push(eq(apiTokensTable.clientId, clientId));
  }

  const rows = await db
    .select({ id: apiTokensTable.id })
    .from(apiTokensTable)
    .where(and(...conditions));
  const deleted = await deleteTokenRows(rows.map((r) => r.id));

  await writeAuditLog({
    req,
    action: "api_token.purge_revoked",
    entityType: "api_token",
    details: { deleted, clientId: Number.isFinite(clientId) && clientId > 0 ? clientId : null },
  });

  res.json({ success: true, deleted });
});

export default router;
