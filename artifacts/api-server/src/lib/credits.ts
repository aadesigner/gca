import { db, apiClientsTable, creditLedgerTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { DEFAULT_CREDIT_PRICE_USD, MIN_CRYPTO_DEPOSIT_USD } from "./crypto-payments";

export async function loadBillingSettings() {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).limit(1);
    return row ?? null;
  } catch (err) {
    logger.error({ err }, "Failed to load settings");
    return null;
  }
}

export function parseCreditPriceUsd(raw: unknown): number {
  const n = Number(raw ?? DEFAULT_CREDIT_PRICE_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CREDIT_PRICE_USD;
}

export function parseMinCryptoDepositUsd(raw: unknown): number {
  const n = Number(raw ?? MIN_CRYPTO_DEPOSIT_USD);
  return Number.isFinite(n) && n > 0 ? n : MIN_CRYPTO_DEPOSIT_USD;
}

/**
 * Atomically consume one VIN-retrieve credit. Returns the new balance, or null if insufficient.
 */
export async function consumeOneCredit(opts: {
  clientId: number;
  vin: string;
}): Promise<{ balanceAfter: number } | null> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(apiClientsTable)
      .set({
        creditBalance: sql`${apiClientsTable.creditBalance} - 1`,
        updatedAt: new Date(),
      })
      .where(sql`${apiClientsTable.id} = ${opts.clientId} AND ${apiClientsTable.creditBalance} >= 1`)
      .returning({ creditBalance: apiClientsTable.creditBalance });

    if (!updated) return null;

    await tx.insert(creditLedgerTable).values({
      clientId: opts.clientId,
      delta: -1,
      balanceAfter: updated.creditBalance,
      reason: "vin_retrieve",
      refType: "vin",
      refId: opts.vin,
    });

    return { balanceAfter: updated.creditBalance };
  });
}

export async function adjustCredits(opts: {
  clientId: number;
  delta: number;
  reason: string;
  refType?: string;
  refId?: string;
  adminId?: number | null;
  clearDemo?: boolean;
}): Promise<{ balanceAfter: number }> {
  if (!Number.isInteger(opts.delta) || opts.delta === 0) {
    throw new Error("Credit delta must be a non-zero integer");
  }

  return db.transaction(async (tx) => {
    if (opts.delta < 0) {
      const [updated] = await tx
        .update(apiClientsTable)
        .set({
          creditBalance: sql`${apiClientsTable.creditBalance} + ${opts.delta}`,
          updatedAt: new Date(),
        })
        .where(sql`${apiClientsTable.id} = ${opts.clientId} AND ${apiClientsTable.creditBalance} >= ${-opts.delta}`)
        .returning({ creditBalance: apiClientsTable.creditBalance });
      if (!updated) throw new Error("Insufficient credits");
      await tx.insert(creditLedgerTable).values({
        clientId: opts.clientId,
        delta: opts.delta,
        balanceAfter: updated.creditBalance,
        reason: opts.reason,
        refType: opts.refType ?? null,
        refId: opts.refId ?? null,
        createdByAdminId: opts.adminId ?? null,
      });
      return { balanceAfter: updated.creditBalance };
    }

    const patch: { creditBalance: ReturnType<typeof sql>; updatedAt: Date; isDemo?: boolean } = {
      creditBalance: sql`${apiClientsTable.creditBalance} + ${opts.delta}`,
      updatedAt: new Date(),
    };
    if (opts.clearDemo !== false) patch.isDemo = false;

    const [updated] = await tx
      .update(apiClientsTable)
      .set(patch)
      .where(eq(apiClientsTable.id, opts.clientId))
      .returning({ creditBalance: apiClientsTable.creditBalance });

    if (!updated) throw new Error("Client not found");

    await tx.insert(creditLedgerTable).values({
      clientId: opts.clientId,
      delta: opts.delta,
      balanceAfter: updated.creditBalance,
      reason: opts.reason,
      refType: opts.refType ?? null,
      refId: opts.refId ?? null,
      createdByAdminId: opts.adminId ?? null,
    });

    return { balanceAfter: updated.creditBalance };
  });
}

/** Set absolute credit balance (admin). Writes ledger delta. */
export async function setCreditBalance(opts: {
  clientId: number;
  balance: number;
  reason?: string;
  adminId?: number | null;
}): Promise<{ balanceAfter: number; delta: number }> {
  const target = Math.max(0, Math.trunc(opts.balance));
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select({ creditBalance: apiClientsTable.creditBalance })
      .from(apiClientsTable)
      .where(eq(apiClientsTable.id, opts.clientId))
      .limit(1);
    if (!client) throw new Error("Client not found");

    const current = Number(client.creditBalance ?? 0);
    const delta = target - current;
    if (delta === 0) return { balanceAfter: current, delta: 0 };

    const [updated] = await tx
      .update(apiClientsTable)
      .set({
        creditBalance: target,
        updatedAt: new Date(),
        ...(target > 0 ? { isDemo: false } : {}),
      })
      .where(eq(apiClientsTable.id, opts.clientId))
      .returning({ creditBalance: apiClientsTable.creditBalance });

    await tx.insert(creditLedgerTable).values({
      clientId: opts.clientId,
      delta,
      balanceAfter: updated!.creditBalance,
      reason: opts.reason ?? "admin_set_balance",
      refType: "admin",
      refId: String(target),
      createdByAdminId: opts.adminId ?? null,
    });

    return { balanceAfter: updated!.creditBalance, delta };
  });
}
