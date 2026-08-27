import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  apiRequestLogsTable,
  apiTokensTable,
  creditLedgerTable,
  creditPurchasesTable,
} from "@workspace/db";
import { requireClient, loadActiveClient } from "../../middlewares/clientAuth";
import { loadBillingSettings, parseCreditPriceUsd } from "../../lib/credits";
import { getLiveFeedContactEmail, liveFeedStatus } from "../../lib/clientLiveFeed";

const router: IRouter = Router();

router.get("/client/dashboard", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const settings = await loadBillingSettings();
  const creditPriceUsd = parseCreditPriceUsd(settings?.creditPriceUsd);
  const liveContactEmail = await getLiveFeedContactEmail();
  const live = liveFeedStatus(client);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const success = sql`${apiRequestLogsTable.statusCode} >= 200 AND ${apiRequestLogsTable.statusCode} < 300`;
  const [[dayRow], [monthRow], [allRow], tokens, [pendingRow]] = await Promise.all([
    db
      .select({ c: count() })
      .from(apiRequestLogsTable)
      .where(and(eq(apiRequestLogsTable.clientId, client.id), gte(apiRequestLogsTable.requestedAt, dayStart), success)),
    db
      .select({ c: count() })
      .from(apiRequestLogsTable)
      .where(and(eq(apiRequestLogsTable.clientId, client.id), gte(apiRequestLogsTable.requestedAt, monthStart), success)),
    db
      .select({ c: count() })
      .from(apiRequestLogsTable)
      .where(eq(apiRequestLogsTable.clientId, client.id)),
    db
      .select({
        id: apiTokensTable.id,
        name: apiTokensTable.name,
        tokenPrefix: apiTokensTable.tokenPrefix,
        isActive: apiTokensTable.isActive,
        lastUsedAt: apiTokensTable.lastUsedAt,
        expiresAt: apiTokensTable.expiresAt,
        createdAt: apiTokensTable.createdAt,
      })
      .from(apiTokensTable)
      .where(and(eq(apiTokensTable.clientId, client.id), eq(apiTokensTable.isActive, true)))
      .orderBy(desc(apiTokensTable.createdAt)),
    db
      .select({ c: count() })
      .from(creditPurchasesTable)
      .where(and(eq(creditPurchasesTable.clientId, client.id), eq(creditPurchasesTable.status, "pending"))),
  ]);

  const requestsToday = Number(dayRow?.c ?? 0);
  const requestsThisMonth = Number(monthRow?.c ?? 0);
  const hasActiveToken = tokens.length > 0;

  res.json({
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      isActive: client.isActive,
      isDemo: !hasActiveToken,
      creditBalance: client.creditBalance,
    },
    billing: {
      creditPriceUsd,
      credits: client.creditBalance,
      pendingPurchases: Number(pendingRow?.c ?? 0),
      cryptoPaymentInstructions: settings?.cryptoPaymentInstructions ?? null,
    },
    usage: {
      requestsToday,
      requestsThisMonth,
      requestsAllTime: Number(allRow?.c ?? 0),
      retrievesThisMonth: requestsThisMonth,
    },
    limits: {
      rateLimitPerMinute: client.rateLimitPerMinute,
      rateLimitPerDay: client.rateLimitPerDay,
      monthlyGlobalLimit: client.monthlyGlobalLimit,
      requestsPerVin: client.requestsPerVin,
      remaining: {
        daily:
          client.rateLimitPerDay != null ? Math.max(0, client.rateLimitPerDay - requestsToday) : null,
        monthly:
          client.monthlyGlobalLimit != null
            ? Math.max(0, client.monthlyGlobalLimit - requestsThisMonth)
            : null,
      },
    },
    tokens,
    liveFeed: {
      ...live,
      contactEmail: liveContactEmail,
      message: live.active
        ? "Live stock is enabled on your account. Calls do not use VIN credits and are unlimited (within rate limits)."
        : live.expired
          ? `Live stock access expired. Contact ${liveContactEmail} for pricing, providers, and renewal.`
          : `Live stock is not enabled. Contact ${liveContactEmail} for pricing, details, and available providers.`,
    },
    docs: {
      checkFree: true,
      checkRequiresAuth: true,
      retrieveCostsCredit: true,
      creditPriceUsd,
      liveIncluded: live.active,
      liveUsesCredits: false,
      checkPath: "GET /api/v1/vin/check/{vin}",
      historyPath: "GET /api/v1/vin/{vin}",
      livePath: "GET /api/v1/live/vehicles",
    },
    auth: {
      header: "Authorization",
      scheme: "Bearer",
      example: "Authorization: Bearer vdi_your_token_here",
      historyPath: "GET /api/v1/vin/{vin}",
      checkPath: "GET /api/v1/vin/check/{vin}",
    },
  });
});

router.get("/client/logs", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const items = await db
    .select({
      id: apiRequestLogsTable.id,
      method: apiRequestLogsTable.method,
      path: apiRequestLogsTable.path,
      statusCode: apiRequestLogsTable.statusCode,
      durationMs: apiRequestLogsTable.durationMs,
      vin: apiRequestLogsTable.vin,
      requestedAt: apiRequestLogsTable.requestedAt,
    })
    .from(apiRequestLogsTable)
    .where(eq(apiRequestLogsTable.clientId, client.id))
    .orderBy(desc(apiRequestLogsTable.requestedAt))
    .limit(limit);

  res.json({ items });
});

/** Daily usage series for portal charts (UTC days). */
router.get("/client/usage/series", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const days = Math.min(60, Math.max(7, Number(req.query.days) || 14));
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const dayKey = sql<string>`to_char(date_trunc('day', ${apiRequestLogsTable.requestedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      day: dayKey,
      total: count(),
      ok: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 200 and ${apiRequestLogsTable.statusCode} < 300)::int`,
      vin: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/vin/%' and ${apiRequestLogsTable.path} not like '%/check/%')::int`,
      live: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/live/%')::int`,
      errors: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 400)::int`,
    })
    .from(apiRequestLogsTable)
    .where(
      and(eq(apiRequestLogsTable.clientId, client.id), gte(apiRequestLogsTable.requestedAt, since)),
    )
    .groupBy(dayKey)
    .orderBy(dayKey);

  const byDay = new Map(
    rows.map((r) => [
      String(r.day),
      {
        day: String(r.day),
        total: Number(r.total ?? 0),
        ok: Number(r.ok ?? 0),
        vin: Number(r.vin ?? 0),
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
    series.push(
      byDay.get(key) ?? { day: key, total: 0, ok: 0, vin: 0, live: 0, errors: 0 },
    );
  }

  const statusRows = await db
    .select({
      statusCode: apiRequestLogsTable.statusCode,
      c: count(),
    })
    .from(apiRequestLogsTable)
    .where(
      and(eq(apiRequestLogsTable.clientId, client.id), gte(apiRequestLogsTable.requestedAt, since)),
    )
    .groupBy(apiRequestLogsTable.statusCode)
    .orderBy(desc(count()));

  res.json({
    days,
    since: since.toISOString(),
    series,
    status: statusRows.map((r) => ({
      statusCode: r.statusCode,
      count: Number(r.c ?? 0),
    })),
  });
});

router.get("/client/credits/ledger", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
  const items = await db
    .select({
      id: creditLedgerTable.id,
      delta: creditLedgerTable.delta,
      balanceAfter: creditLedgerTable.balanceAfter,
      reason: creditLedgerTable.reason,
      refType: creditLedgerTable.refType,
      refId: creditLedgerTable.refId,
      createdAt: creditLedgerTable.createdAt,
    })
    .from(creditLedgerTable)
    .where(eq(creditLedgerTable.clientId, client.id))
    .orderBy(desc(creditLedgerTable.createdAt))
    .limit(limit);
  res.json({ items, creditBalance: client.creditBalance });
});

router.get("/client/credits/purchases", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const items = await db
    .select({
      id: creditPurchasesTable.id,
      credits: creditPurchasesTable.credits,
      amountUsd: creditPurchasesTable.amountUsd,
      cryptoCurrency: creditPurchasesTable.cryptoCurrency,
      txHash: creditPurchasesTable.txHash,
      status: creditPurchasesTable.status,
      adminNote: creditPurchasesTable.adminNote,
      createdAt: creditPurchasesTable.createdAt,
      reviewedAt: creditPurchasesTable.reviewedAt,
    })
    .from(creditPurchasesTable)
    .where(eq(creditPurchasesTable.clientId, client.id))
    .orderBy(desc(creditPurchasesTable.createdAt))
    .limit(50);
  res.json({ items });
});

router.post("/client/credits/purchase", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const credits = Math.floor(Number(req.body?.credits));
  if (!Number.isFinite(credits) || credits < 1 || credits > 100_000) {
    res.status(400).json({ error: "Credits must be between 1 and 100000" });
    return;
  }

  const settings = await loadBillingSettings();
  const price = parseCreditPriceUsd(settings?.creditPriceUsd);
  const amountUsd = (credits * price).toFixed(2);
  const cryptoCurrency =
    typeof req.body?.cryptoCurrency === "string" && req.body.cryptoCurrency.trim()
      ? req.body.cryptoCurrency.trim().slice(0, 32).toUpperCase()
      : "USDT";
  const txHash =
    typeof req.body?.txHash === "string" ? req.body.txHash.trim().slice(0, 200) || null : null;
  const payerNote =
    typeof req.body?.payerNote === "string" ? req.body.payerNote.trim().slice(0, 500) || null : null;

  const [row] = await db
    .insert(creditPurchasesTable)
    .values({
      clientId: client.id,
      credits,
      amountUsd,
      cryptoCurrency,
      txHash,
      payerNote,
      status: "pending",
    })
    .returning({
      id: creditPurchasesTable.id,
      credits: creditPurchasesTable.credits,
      amountUsd: creditPurchasesTable.amountUsd,
      cryptoCurrency: creditPurchasesTable.cryptoCurrency,
      status: creditPurchasesTable.status,
      createdAt: creditPurchasesTable.createdAt,
    });

  res.status(201).json({
    purchase: row,
    paymentInstructions: settings?.cryptoPaymentInstructions ?? null,
    creditPriceUsd: price,
  });
});

export default router;
