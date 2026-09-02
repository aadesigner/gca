import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, apiClientsTable, apiTokensTable, apiRequestLogsTable } from "@workspace/db";
import { eq, sql, and, inArray, count, desc, gte } from "drizzle-orm";
import {
  ListApiClientsResponseItem,
  CreateApiClientBody,
  CreateApiClientResponse,
  GetApiClientParams,
  GetApiClientResponse,
  UpdateApiClientParams,
  UpdateApiClientBody,
  UpdateApiClientResponse,
  DeleteApiClientParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import { markClientPaidForToken } from "../../lib/clientBilling";
import { liveFeedStatus, parseLiveFeedBody } from "../../lib/clientLiveFeed";
import { setCreditBalance } from "../../lib/credits";
import { ensureTestToken } from "../../lib/testToken";
import { normalizeTelegram } from "../../lib/normalizeTelegram";
import { normalizeWebsite } from "../../lib/normalizeWebsite";
import {
  applyClientBanBlocks,
  previewClientBanTargets,
} from "../../lib/accessBlocks";
import { z } from "zod";

const router: IRouter = Router();

async function portalFields(
  body: unknown,
  opts: { requirePortal?: boolean } = {},
): Promise<{ email?: string | null; passwordHash?: string }> {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out: { email?: string | null; passwordHash?: string } = {};
  if (typeof raw.email === "string") {
    const email = raw.email.trim().toLowerCase();
    out.email = email || null;
  }
  if (typeof raw.password === "string" && raw.password.length > 0) {
    if (raw.password.length < 6) {
      throw new Error("Portal password must be at least 6 characters");
    }
    out.passwordHash = await bcrypt.hash(raw.password, 12);
  }
  if (opts.requirePortal) {
    if (!out.email) {
      throw new Error("Portal email is required so the client can sign in at /account/");
    }
    if (!out.passwordHash) {
      throw new Error("Portal password is required (min 6 characters). This is not the API token.");
    }
  }
  return out;
}

function withPortal<T extends object>(
  row: T,
  extra: {
    email?: string | null;
    hasPortalLogin?: boolean;
    isDemo?: boolean;
    creditBalance?: number;
    requestsPerVin?: number | null;
    monthlyGlobalLimit?: number | null;
    liveFeedEnabled?: boolean;
    liveFeedExpiresAt?: string | null;
    liveFeedActive?: boolean;
    companyName?: string | null;
    websiteUrl?: string | null;
    telegramUsername?: string | null;
  },
) {
  return {
    ...row,
    email: extra.email ?? null,
    hasPortalLogin: extra.hasPortalLogin ?? false,
    isDemo: extra.isDemo ?? true,
    creditBalance: extra.creditBalance ?? 0,
    requestsPerVin: extra.requestsPerVin ?? null,
    monthlyGlobalLimit: extra.monthlyGlobalLimit ?? null,
    liveFeedEnabled: extra.liveFeedEnabled ?? false,
    liveFeedExpiresAt: extra.liveFeedExpiresAt ?? null,
    liveFeedActive: extra.liveFeedActive ?? false,
    companyName: extra.companyName ?? null,
    websiteUrl: extra.websiteUrl ?? null,
    telegramUsername: extra.telegramUsername ?? null,
  };
}

function asInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Nullable ints — node-pg / drivers sometimes hand back numeric strings. */
function asIntOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseCreditBalanceField(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.trunc(n));
}

function expiresIso(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function clientPublicRow(row: {
  id: unknown;
  name: unknown;
  description?: unknown;
  isActive: unknown;
  rateLimitPerMinute?: unknown;
  rateLimitPerDay?: unknown;
  requestsPerVin?: unknown;
  monthlyGlobalLimit?: unknown;
  allowedEndpoints?: unknown;
  tokenCount?: unknown;
  totalRequests?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}) {
  return {
    id: asInt(row.id),
    name: String(row.name ?? ""),
    description: row.description == null ? null : String(row.description),
    isActive: Boolean(row.isActive),
    rateLimitPerMinute: asIntOrNull(row.rateLimitPerMinute),
    rateLimitPerDay: asIntOrNull(row.rateLimitPerDay),
    requestsPerVin: asIntOrNull(row.requestsPerVin),
    monthlyGlobalLimit: asIntOrNull(row.monthlyGlobalLimit),
    allowedEndpoints: row.allowedEndpoints == null ? null : String(row.allowedEndpoints),
    tokenCount: asInt(row.tokenCount),
    totalRequests: asInt(row.totalRequests),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function liveExtras(row: {
  liveFeedEnabled?: unknown;
  liveFeedExpiresAt?: unknown;
}) {
  const status = liveFeedStatus({
    liveFeedEnabled: Boolean(row.liveFeedEnabled),
    liveFeedExpiresAt: row.liveFeedExpiresAt as Date | string | null,
  });
  return {
    liveFeedEnabled: status.enabled,
    liveFeedExpiresAt: status.expiresAt,
    liveFeedActive: status.active,
  };
}

const clientSelect = {
  id: apiClientsTable.id,
  name: apiClientsTable.name,
  email: apiClientsTable.email,
  companyName: apiClientsTable.companyName,
  websiteUrl: apiClientsTable.websiteUrl,
  telegramUsername: apiClientsTable.telegramUsername,
  hasPortalLogin: sql<boolean>`(${apiClientsTable.passwordHash} IS NOT NULL)`,
  description: apiClientsTable.description,
  isActive: apiClientsTable.isActive,
  isDemo: apiClientsTable.isDemo,
  creditBalance: apiClientsTable.creditBalance,
  rateLimitPerMinute: apiClientsTable.rateLimitPerMinute,
  rateLimitPerDay: apiClientsTable.rateLimitPerDay,
  requestsPerVin: apiClientsTable.requestsPerVin,
  monthlyGlobalLimit: apiClientsTable.monthlyGlobalLimit,
  allowedEndpoints: apiClientsTable.allowedEndpoints,
  liveFeedEnabled: apiClientsTable.liveFeedEnabled,
  liveFeedExpiresAt: apiClientsTable.liveFeedExpiresAt,
  createdAt: apiClientsTable.createdAt,
  updatedAt: apiClientsTable.updatedAt,
};

router.get("/admin/api-clients", requireAdmin, async (_req, res): Promise<void> => {
  const clients = await db
    .select({
      id: apiClientsTable.id,
      name: apiClientsTable.name,
      email: apiClientsTable.email,
      companyName: apiClientsTable.companyName,
      websiteUrl: apiClientsTable.websiteUrl,
      telegramUsername: apiClientsTable.telegramUsername,
      hasPortalLogin: sql<boolean>`(${apiClientsTable.passwordHash} IS NOT NULL)`,
      description: apiClientsTable.description,
      isActive: apiClientsTable.isActive,
      isDemo: apiClientsTable.isDemo,
      creditBalance: apiClientsTable.creditBalance,
      rateLimitPerMinute: apiClientsTable.rateLimitPerMinute,
      rateLimitPerDay: apiClientsTable.rateLimitPerDay,
      requestsPerVin: apiClientsTable.requestsPerVin,
      monthlyGlobalLimit: apiClientsTable.monthlyGlobalLimit,
      allowedEndpoints: apiClientsTable.allowedEndpoints,
      liveFeedEnabled: apiClientsTable.liveFeedEnabled,
      liveFeedExpiresAt: apiClientsTable.liveFeedExpiresAt,
      createdAt: apiClientsTable.createdAt,
      updatedAt: apiClientsTable.updatedAt,
    })
    .from(apiClientsTable)
    .orderBy(desc(apiClientsTable.createdAt));

  const clientIds = clients.map((c) => c.id);
  const [tokenCountRows, requestCountRows] =
    clientIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              clientId: apiTokensTable.clientId,
              c: sql<number>`count(*)::int`,
              production: sql<number>`count(*) filter (where ${apiTokensTable.isTestOnly} = false)::int`,
            })
            .from(apiTokensTable)
            .where(and(inArray(apiTokensTable.clientId, clientIds), eq(apiTokensTable.isActive, true)))
            .groupBy(apiTokensTable.clientId),
          db
            .select({
              clientId: apiRequestLogsTable.clientId,
              c: sql<number>`count(*)::int`,
            })
            .from(apiRequestLogsTable)
            .where(inArray(apiRequestLogsTable.clientId, clientIds))
            .groupBy(apiRequestLogsTable.clientId),
        ]);

  const tokenByClient = new Map(tokenCountRows.map((r) => [r.clientId, Number(r.c)]));
  const productionTokenByClient = new Map(tokenCountRows.map((r) => [r.clientId, Number(r.production ?? 0)]));
  const reqByClient = new Map(requestCountRows.map((r) => [r.clientId, Number(r.c)]));

  const out = [];
  for (const row of clients) {
    const tokenCount = tokenByClient.get(row.id) ?? 0;
    const productionTokenCount = productionTokenByClient.get(row.id) ?? 0;
    const isDemo = productionTokenCount === 0;
    if (productionTokenCount > 0 && row.isDemo) {
      void markClientPaidForToken(row.id);
    }
    const publicRow = clientPublicRow({
      ...row,
      tokenCount,
      totalRequests: reqByClient.get(row.id) ?? 0,
    });
    const parsed = ListApiClientsResponseItem.safeParse(publicRow);
    if (!parsed.success) {
      res.status(500).json({ error: "API client serialization failed", details: parsed.error.flatten() });
      return;
    }
    out.push(
      withPortal(parsed.data, {
        email: row.email,
        hasPortalLogin: Boolean(row.hasPortalLogin),
        isDemo,
        creditBalance: asInt(row.creditBalance),
        requestsPerVin: publicRow.requestsPerVin,
        monthlyGlobalLimit: publicRow.monthlyGlobalLimit,
        companyName: row.companyName ?? null,
        websiteUrl: row.websiteUrl ?? null,
        telegramUsername: row.telegramUsername ?? null,
        ...liveExtras(row),
      }),
    );
  }
  res.json(out);
});

router.post("/admin/api-clients", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateApiClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let portal;
  try {
    portal = await portalFields(req.body, { requirePortal: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const raw = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const billing: { creditBalance?: number; isDemo?: boolean } = { isDemo: true };
  if (typeof raw.creditBalance === "number" && Number.isFinite(raw.creditBalance)) {
    billing.creditBalance = Math.max(0, Math.trunc(raw.creditBalance));
  }
  const live = parseLiveFeedBody(raw);

  const [client] = await db
    .insert(apiClientsTable)
    .values({ ...parsed.data, ...portal, ...billing, ...live })
    .returning();

  await writeAuditLog({
    req,
    action: "api_client.create",
    entityType: "api_client",
    entityId: client!.id,
    details: {
      name: client!.name,
      email: portal.email ?? null,
      portal: Boolean(portal.passwordHash),
      liveFeedEnabled: client!.liveFeedEnabled,
      liveFeedExpiresAt: expiresIso(client!.liveFeedExpiresAt),
    },
  });

  await ensureTestToken(client!.id);

  res.status(201).json({
    ...CreateApiClientResponse.parse(clientPublicRow({ ...client!, tokenCount: 0, totalRequests: 0 })),
    email: client!.email,
    hasPortalLogin: Boolean(client!.passwordHash),
    isDemo: true,
    creditBalance: asInt(client!.creditBalance),
    ...liveExtras(client!),
  });
});

router.get("/admin/api-clients/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetApiClientParams.safeParse({ id: asInt(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [client] = await db.select(clientSelect).from(apiClientsTable).where(eq(apiClientsTable.id, params.data.id));
  if (!client) {
    res.status(404).json({ error: "API client not found" });
    return;
  }

  const [[tokenRow], [reqRow]] = await Promise.all([
    db
      .select({
        c: sql<number>`count(*)::int`,
        production: sql<number>`count(*) filter (where ${apiTokensTable.isTestOnly} = false)::int`,
      })
      .from(apiTokensTable)
      .where(and(eq(apiTokensTable.clientId, client.id), eq(apiTokensTable.isActive, true))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(apiRequestLogsTable)
      .where(eq(apiRequestLogsTable.clientId, client.id)),
  ]);

  const publicRow = clientPublicRow({
    ...client,
    tokenCount: Number(tokenRow?.c ?? 0),
    totalRequests: Number(reqRow?.c ?? 0),
  });
  res.json({
    ...GetApiClientResponse.parse(publicRow),
    email: client.email,
    hasPortalLogin: Boolean(client.hasPortalLogin),
    isDemo: Number(tokenRow?.production ?? 0) === 0,
    creditBalance: asInt(client.creditBalance),
    requestsPerVin: publicRow.requestsPerVin,
    monthlyGlobalLimit: publicRow.monthlyGlobalLimit,
    companyName: client.companyName ?? null,
    websiteUrl: client.websiteUrl ?? null,
    telegramUsername: client.telegramUsername ?? null,
    ...liveExtras(client),
  });
});

/** Usage charts + recent activity for the client detail page. */
router.get("/admin/api-clients/:id/usage", requireAdmin, async (req, res): Promise<void> => {
  const id = asInt(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [client] = await db
    .select({ id: apiClientsTable.id })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, id));
  if (!client) {
    res.status(404).json({ error: "API client not found" });
    return;
  }

  const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const monthStart = new Date(dayStart);
  monthStart.setUTCDate(monthStart.getUTCDate() - 29);

  const dayKey = sql<string>`to_char(date_trunc('day', ${apiRequestLogsTable.requestedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

  const [seriesRows, statusRows, summaryRows, recentLogs, tokens] = await Promise.all([
    db
      .select({
        day: dayKey,
        total: count(),
        ok: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 200 and ${apiRequestLogsTable.statusCode} < 300)::int`,
        vin: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/vin/%' and ${apiRequestLogsTable.path} not like '%/check/%')::int`,
        check: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/vin/check/%')::int`,
        live: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/live/%')::int`,
        errors: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 400)::int`,
      })
      .from(apiRequestLogsTable)
      .where(and(eq(apiRequestLogsTable.clientId, id), gte(apiRequestLogsTable.requestedAt, since)))
      .groupBy(dayKey)
      .orderBy(dayKey),
    db
      .select({
        statusCode: apiRequestLogsTable.statusCode,
        c: count(),
      })
      .from(apiRequestLogsTable)
      .where(and(eq(apiRequestLogsTable.clientId, id), gte(apiRequestLogsTable.requestedAt, since)))
      .groupBy(apiRequestLogsTable.statusCode)
      .orderBy(desc(count())),
    db
      .select({
        today: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${dayStart})::int`,
        week: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart})::int`,
        month: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${monthStart})::int`,
        allTime: count(),
        errorsWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.statusCode} >= 400)::int`,
      })
      .from(apiRequestLogsTable)
      .where(eq(apiRequestLogsTable.clientId, id)),
    db
      .select({
        id: apiRequestLogsTable.id,
        path: apiRequestLogsTable.path,
        method: apiRequestLogsTable.method,
        statusCode: apiRequestLogsTable.statusCode,
        vin: apiRequestLogsTable.vin,
        durationMs: apiRequestLogsTable.durationMs,
        requestedAt: apiRequestLogsTable.requestedAt,
      })
      .from(apiRequestLogsTable)
      .where(eq(apiRequestLogsTable.clientId, id))
      .orderBy(desc(apiRequestLogsTable.requestedAt))
      .limit(40),
    db
      .select({
        id: apiTokensTable.id,
        name: apiTokensTable.name,
        tokenPrefix: apiTokensTable.tokenPrefix,
        isActive: apiTokensTable.isActive,
        expiresAt: apiTokensTable.expiresAt,
        lastUsedAt: apiTokensTable.lastUsedAt,
        createdAt: apiTokensTable.createdAt,
      })
      .from(apiTokensTable)
      .where(eq(apiTokensTable.clientId, id))
      .orderBy(desc(apiTokensTable.createdAt)),
  ]);

  const byDay = new Map(
    seriesRows.map((r) => [
      String(r.day),
      {
        day: String(r.day),
        total: Number(r.total ?? 0),
        ok: Number(r.ok ?? 0),
        vin: Number(r.vin ?? 0),
        check: Number(r.check ?? 0),
        live: Number(r.live ?? 0),
        errors: Number(r.errors ?? 0),
      },
    ]),
  );

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push(byDay.get(key) ?? { day: key, total: 0, ok: 0, vin: 0, check: 0, live: 0, errors: 0 });
  }

  const sum = summaryRows[0];
  res.json({
    days,
    since: since.toISOString(),
    summary: {
      today: Number(sum?.today ?? 0),
      week: Number(sum?.week ?? 0),
      month: Number(sum?.month ?? 0),
      allTime: Number(sum?.allTime ?? 0),
      errorsWeek: Number(sum?.errorsWeek ?? 0),
    },
    series,
    status: statusRows.map((r) => ({
      statusCode: r.statusCode,
      count: Number(r.c ?? 0),
    })),
    recentLogs,
    tokens,
  });
});

router.put("/admin/api-clients/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
  const params = UpdateApiClientParams.safeParse({ id: asInt(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateApiClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let portal;
  try {
    portal = await portalFields(req.body);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const raw = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const live = parseLiveFeedBody(raw);
  const creditBalance = parseCreditBalanceField(raw.creditBalance);

  const profilePatch: {
    companyName?: string | null;
    telegramUsername?: string | null;
    websiteUrl?: string | null;
  } = {};

  if (raw.companyName !== undefined) {
    profilePatch.companyName =
      typeof raw.companyName === "string" ? raw.companyName.trim().slice(0, 160) || null : null;
  }
  if (raw.telegramUsername !== undefined) {
    const tg = normalizeTelegram(raw.telegramUsername);
    if (typeof raw.telegramUsername === "string" && raw.telegramUsername.trim() && !tg) {
      res.status(400).json({ error: "Telegram username looks invalid" });
      return;
    }
    profilePatch.telegramUsername = tg;
  }
  if (raw.websiteUrl !== undefined) {
    if (typeof raw.websiteUrl === "string" && !raw.websiteUrl.trim()) {
      profilePatch.websiteUrl = null;
    } else {
      const websiteUrl = normalizeWebsite(raw.websiteUrl);
      if (typeof raw.websiteUrl === "string" && raw.websiteUrl.trim() && !websiteUrl) {
        res.status(400).json({ error: "Website URL looks invalid" });
        return;
      }
      profilePatch.websiteUrl = websiteUrl;
    }
  }

  const [client] = await db
    .update(apiClientsTable)
    .set({ ...parsed.data, ...portal, ...live, ...profilePatch })
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) {
    res.status(404).json({ error: "API client not found" });
    return;
  }

  if (creditBalance !== undefined) {
    await setCreditBalance({
      clientId: client.id,
      balance: creditBalance,
      reason: "admin_set_balance",
      adminId: req.session.adminId ?? null,
    });
  }

  const [fresh] = await db
    .select()
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, client.id))
    .limit(1);

  await writeAuditLog({
    req,
    action: "api_client.update",
    entityType: "api_client",
    entityId: client.id,
    details: {
      ...parsed.data,
      email: portal.email,
      portalPasswordSet: Boolean(portal.passwordHash),
      ...(creditBalance !== undefined ? { creditBalance } : {}),
      ...live,
      liveFeedExpiresAt: expiresIso(client.liveFeedExpiresAt),
    },
  });

  const [[tokenRow], [reqRow]] = await Promise.all([
    db
      .select({
        c: sql<number>`count(*)::int`,
        production: sql<number>`count(*) filter (where ${apiTokensTable.isTestOnly} = false)::int`,
      })
      .from(apiTokensTable)
      .where(and(eq(apiTokensTable.clientId, client.id), eq(apiTokensTable.isActive, true))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(apiRequestLogsTable)
      .where(eq(apiRequestLogsTable.clientId, client.id)),
  ]);

  const publicRow = clientPublicRow({
    ...(fresh ?? client),
    tokenCount: Number(tokenRow?.c ?? 0),
    totalRequests: Number(reqRow?.c ?? 0),
  });
  res.json({
    ...UpdateApiClientResponse.parse(publicRow),
    email: (fresh ?? client).email,
    hasPortalLogin: Boolean((fresh ?? client).passwordHash),
    isDemo: Number(tokenRow?.production ?? 0) === 0,
    creditBalance: asInt((fresh ?? client).creditBalance),
    ...liveExtras(fresh ?? client),
  });
  } catch (err) {
    req.log?.error?.({ err }, "api client update failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not update API client",
    });
  }
});

const DeleteApiClientBody = z.object({
  banIp: z.boolean().optional(),
  banDevice: z.boolean().optional(),
  banEmail: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

router.get("/admin/api-clients/:id/ban-preview", requireAdmin, async (req, res): Promise<void> => {
  const clientId = asInt(req.params.id);
  if (!clientId) {
    res.status(400).json({ error: "Invalid client id" });
    return;
  }
  const [existing] = await db
    .select({ id: apiClientsTable.id })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, clientId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "API client not found" });
    return;
  }
  const preview = await previewClientBanTargets(clientId);
  res.json(preview);
});

router.delete("/admin/api-clients/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteApiClientParams.safeParse({ id: asInt(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = DeleteApiClientBody.safeParse(req.body ?? {});
  const banOpts = body.success ? body.data : {};

  const clientId = params.data.id;
  const [existing] = await db
    .select({ id: apiClientsTable.id, name: apiClientsTable.name, email: apiClientsTable.email })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, clientId));

  if (!existing) {
    res.status(404).json({ error: "API client not found" });
    return;
  }

  const bansApplied =
    banOpts.banIp || banOpts.banDevice || banOpts.banEmail
      ? await applyClientBanBlocks(clientId, banOpts, req.session.adminId ?? null)
      : null;

  await db.transaction(async (tx) => {
    await tx.delete(apiRequestLogsTable).where(eq(apiRequestLogsTable.clientId, clientId));
    await tx.delete(apiTokensTable).where(eq(apiTokensTable.clientId, clientId));
    await tx.delete(apiClientsTable).where(eq(apiClientsTable.id, clientId));
  });

  await writeAuditLog({
    req,
    action: "api_client.delete",
    entityType: "api_client",
    entityId: existing.id,
    details: {
      name: existing.name,
      email: existing.email,
      bans: banOpts,
      bansApplied,
    },
  });

  res.sendStatus(204);
});

export default router;
