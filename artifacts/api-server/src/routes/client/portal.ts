import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import {
  db,
  apiRequestLogsTable,
  apiTokensTable,
  creditLedgerTable,
  creditPurchasesTable,
} from "@workspace/db";
import { requireClient, loadActiveClient } from "../../middlewares/clientAuth";
import { loadBillingSettings, parseCreditPriceUsd, parseMinCryptoDepositUsd } from "../../lib/credits";
import { getLiveFeedContactEmail, liveFeedStatus, LIVE_FEED_ENABLE_HINT, LIVE_FEED_PRICING_SUMMARY } from "../../lib/clientLiveFeed";
import { getTestVinsPublic } from "../../lib/test-vins";
import {
  CRYPTO_PAYMENT_METHODS,
  CRYPTO_WALLET_ADDRESS,
  CREDIT_PURCHASE_STATUS,
  cryptoPaymentMeta,
  parseCryptoPaymentMethod,
  validateCryptoDepositUsd,
  DEPOSIT_BONUS_TIERS,
  MAX_CRYPTO_DEPOSIT_USD,
} from "../../lib/crypto-payments";
import { clientPurchaseFailureReason } from "../../lib/credit-purchase-flow";
import { savePurchaseProof } from "../../lib/credit-proof";

const router: IRouter = Router();

router.get("/client/test-vins", requireClient, (_req, res): void => {
  res.json({ testVins: getTestVinsPublic() });
});

router.get("/client/dashboard", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const settings = await loadBillingSettings();
  const creditPriceUsd = parseCreditPriceUsd(settings?.creditPriceUsd);
  const minCryptoDepositUsd = parseMinCryptoDepositUsd(settings?.minCryptoDepositUsd);
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
        isTestOnly: apiTokensTable.isTestOnly,
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
      .where(
        and(
          eq(creditPurchasesTable.clientId, client.id),
          eq(creditPurchasesTable.status, CREDIT_PURCHASE_STATUS.PENDING),
        ),
      ),
  ]);

  const productionTokens = tokens.filter((t) => !t.isTestOnly);
  const requestsToday = Number(dayRow?.c ?? 0);
  const requestsThisMonth = Number(monthRow?.c ?? 0);
  const hasProductionToken = productionTokens.length > 0;

  res.json({
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      companyName: client.companyName,
      websiteUrl: client.websiteUrl,
      telegramUsername: client.telegramUsername,
      isActive: client.isActive,
      isDemo: !hasProductionToken,
      hasProductionToken,
      creditBalance: client.creditBalance,
    },
    billing: {
      creditPriceUsd,
      minCryptoDepositUsd,
      maxCryptoDepositUsd: MAX_CRYPTO_DEPOSIT_USD,
      depositBonusTiers: DEPOSIT_BONUS_TIERS,
      credits: client.creditBalance,
      pendingPurchases: Number(pendingRow?.c ?? 0),
      cryptoPaymentInstructions: settings?.cryptoPaymentInstructions ?? null,
      cryptoMethods: CRYPTO_PAYMENT_METHODS.map((m) => ({
        id: m.id,
        label: m.label,
        network: m.network,
        qrPath: m.qrPath,
        walletAddress: CRYPTO_WALLET_ADDRESS,
      })),
      walletAddress: CRYPTO_WALLET_ADDRESS,
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
    tokens: productionTokens.slice(0, 1),
    apiTokenReveal: null,
    liveFeed: {
      ...live,
      contactEmail: liveContactEmail,
      message: live.active
        ? "Live stock is enabled on your account. Calls do not use VIN credits and are unlimited within your monthly quota (300,000 requests/month)."
        : live.expired
          ? `Live stock access expired. ${LIVE_FEED_ENABLE_HINT}`
          : `${LIVE_FEED_PRICING_SUMMARY} ${LIVE_FEED_ENABLE_HINT}`,
    },
    testVins: getTestVinsPublic(),
    docs: {
      checkFree: true,
      checkRequiresAuth: true,
      retrieveCostsCredit: true,
      testVinsFree: true,
      testVinsAnyKey: true,
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
    .where(
      and(
        eq(creditPurchasesTable.clientId, client.id),
        ne(creditPurchasesTable.status, CREDIT_PURCHASE_STATUS.AWAITING_PROOF),
      ),
    )
    .orderBy(desc(creditPurchasesTable.createdAt))
    .limit(50);
  res.json({
    items: items.map((row) => ({
      ...row,
      failureReason: clientPurchaseFailureReason(row.status, row.adminNote),
    })),
  });
});

router.post("/client/credits/purchase", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const settings = await loadBillingSettings();
  const creditPriceUsd = parseCreditPriceUsd(settings?.creditPriceUsd);
  const minDeposit = parseMinCryptoDepositUsd(settings?.minCryptoDepositUsd);

  const method = parseCryptoPaymentMethod(req.body?.cryptoCurrency);
  if (!method) {
    res.status(400).json({ error: "Choose USDT_ETH or USDT_BNB" });
    return;
  }

  const amountUsdRaw = Number(req.body?.amountUsd ?? req.body?.amount);
  const validated = validateCryptoDepositUsd(amountUsdRaw, creditPriceUsd, minDeposit);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }
  const { amountUsd, credits, baseCredits, bonusCredits } = validated;

  const pay = cryptoPaymentMeta(method);

  const [row] = await db
    .insert(creditPurchasesTable)
    .values({
      clientId: client.id,
      credits,
      amountUsd: String(amountUsd),
      cryptoCurrency: method,
      status: CREDIT_PURCHASE_STATUS.AWAITING_PROOF,
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
    payment: {
      method: pay.id,
      label: pay.label,
      network: pay.network,
      walletAddress: CRYPTO_WALLET_ADDRESS,
      qrPath: pay.qrPath,
      amountUsd: String(amountUsd),
      credits,
      baseCredits,
      bonusCredits,
      creditPriceUsd,
      minCryptoDepositUsd: minDeposit,
    },
    creditPriceUsd,
    minCryptoDepositUsd: minDeposit,
  });
});

router.post("/client/credits/purchase/:id/proof", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid purchase id" });
    return;
  }

  const [purchase] = await db
    .select()
    .from(creditPurchasesTable)
    .where(and(eq(creditPurchasesTable.id, id), eq(creditPurchasesTable.clientId, client.id)))
    .limit(1);

  if (!purchase) {
    res.status(404).json({ error: "Purchase not found" });
    return;
  }
  if (purchase.status !== CREDIT_PURCHASE_STATUS.AWAITING_PROOF) {
    res.status(400).json({
      error:
        purchase.status === CREDIT_PURCHASE_STATUS.PENDING
          ? "Proof already submitted"
          : `Purchase is already ${purchase.status}`,
    });
    return;
  }

  const txHash =
    typeof req.body?.txHash === "string" ? req.body.txHash.trim().slice(0, 200) || null : null;
  const proofImageBase64 =
    typeof req.body?.proofImageBase64 === "string" ? req.body.proofImageBase64.trim() : null;
  const payerNote =
    typeof req.body?.payerNote === "string" ? req.body.payerNote.trim().slice(0, 500) || null : null;

  if (!txHash && !proofImageBase64) {
    res.status(400).json({ error: "Provide a transaction hash and/or payment screenshot (JPEG/PNG)" });
    return;
  }

  let proofPath = purchase.proofPath;
  if (proofImageBase64) {
    try {
      proofPath = savePurchaseProof(purchase.id, proofImageBase64);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid proof image" });
      return;
    }
  }

  const [updated] = await db
    .update(creditPurchasesTable)
    .set({
      txHash: txHash ?? purchase.txHash,
      payerNote: payerNote ?? purchase.payerNote,
      proofPath,
      status: CREDIT_PURCHASE_STATUS.PENDING,
    })
    .where(eq(creditPurchasesTable.id, purchase.id))
    .returning({
      id: creditPurchasesTable.id,
      status: creditPurchasesTable.status,
      txHash: creditPurchasesTable.txHash,
      hasProof: sql<boolean>`${creditPurchasesTable.proofPath} IS NOT NULL`,
    });

  res.json({ purchase: updated, message: "Submitted for verification — credits added after admin approval." });
});

const TOKEN_ADMIN_ONLY = {
  error: "API key changes are handled by support. Open a ticket in the client area.",
  code: "TOKEN_ADMIN_ONLY",
} as const;

router.post("/client/tokens/regenerate", requireClient, (_req, res): void => {
  res.status(403).json(TOKEN_ADMIN_ONLY);
});

/** @deprecated — clients cannot rotate keys */
router.post("/client/tokens/test/regenerate", requireClient, (_req, res): void => {
  res.status(403).json(TOKEN_ADMIN_ONLY);
});

export default router;
