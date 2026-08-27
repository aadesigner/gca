import { db, apiClientsTable, creditLedgerTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

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
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
