import { db, apiClientsTable, creditPurchasesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * Free vs paid for admin UI:
 * - Free: never bought credits, balance 0, live feed not enabled
 * - Paid: has credit balance, or an approved purchase, or live feed enabled
 *
 * A free signup API token alone does NOT make an account "paid".
 */
export function clientIsPaidAccount(opts: {
  creditBalance?: number | null;
  approvedPurchaseCount?: number | null;
  liveFeedEnabled?: boolean | null;
}): boolean {
  if (Number(opts.creditBalance ?? 0) > 0) return true;
  if (Number(opts.approvedPurchaseCount ?? 0) > 0) return true;
  if (opts.liveFeedEnabled) return true;
  return false;
}

export function clientIsDemoAccount(opts: {
  creditBalance?: number | null;
  approvedPurchaseCount?: number | null;
  liveFeedEnabled?: boolean | null;
}): boolean {
  return !clientIsPaidAccount(opts);
}

/** Persist isDemo=false when the client becomes a paying account. */
export async function markClientPaid(clientId: number): Promise<void> {
  if (!Number.isFinite(clientId) || clientId <= 0) return;
  await db
    .update(apiClientsTable)
    .set({ isDemo: false, updatedAt: new Date() })
    .where(eq(apiClientsTable.id, clientId));
}

/** @deprecated Tokens alone are free — use markClientPaid after credits/live. */
export async function markClientPaidForToken(_clientId: number): Promise<void> {
  /* no-op: signup tokens must not flip Free → Paid */
}

export async function approvedPurchaseCountsByClientIds(
  clientIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!clientIds.length) return map;
  const rows = await db
    .select({
      clientId: creditPurchasesTable.clientId,
      c: sql<number>`count(*)::int`,
    })
    .from(creditPurchasesTable)
    .where(
      and(
        inArray(creditPurchasesTable.clientId, clientIds),
        eq(creditPurchasesTable.status, "approved"),
      ),
    )
    .groupBy(creditPurchasesTable.clientId);
  for (const r of rows) map.set(r.clientId, Number(r.c));
  return map;
}
