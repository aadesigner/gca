import { and, eq, sql } from "drizzle-orm";
import { db, apiClientsTable, creditLedgerTable, creditPurchasesTable } from "@workspace/db";
import type { CreditPurchase } from "@workspace/db";
import { CREDIT_PURCHASE_STATUS } from "./crypto-payments";

export const CREDIT_PURCHASE_REJECT_DEFAULT =
  "Payment could not be verified. No credits were added.";

export function clientPurchaseFailureReason(
  status: string,
  adminNote: string | null | undefined,
): string | null {
  if (status !== CREDIT_PURCHASE_STATUS.REJECTED) return null;
  const note = adminNote?.trim();
  return note || CREDIT_PURCHASE_REJECT_DEFAULT;
}

export async function approveCreditPurchase(opts: {
  purchaseId: number;
  adminId?: number | null;
  adminNote?: string | null;
}): Promise<{ purchase: CreditPurchase; balanceAfter: number; alreadyApproved: boolean }> {
  return db.transaction(async (tx) => {
    const [purchase] = await tx
      .select({
        id: creditPurchasesTable.id,
        clientId: creditPurchasesTable.clientId,
        credits: creditPurchasesTable.credits,
        status: creditPurchasesTable.status,
        txHash: creditPurchasesTable.txHash,
        proofPath: creditPurchasesTable.proofPath,
        adminNote: creditPurchasesTable.adminNote,
      })
      .from(creditPurchasesTable)
      .where(eq(creditPurchasesTable.id, opts.purchaseId))
      .limit(1);

    if (!purchase) throw new Error("Purchase not found");

    if (purchase.status === CREDIT_PURCHASE_STATUS.APPROVED) {
      const [client] = await tx
        .select({ creditBalance: apiClientsTable.creditBalance })
        .from(apiClientsTable)
        .where(eq(apiClientsTable.id, purchase.clientId))
        .limit(1);
      const [approvedPurchase] = await tx
        .select()
        .from(creditPurchasesTable)
        .where(eq(creditPurchasesTable.id, opts.purchaseId))
        .limit(1);
      return {
        purchase: approvedPurchase!,
        balanceAfter: Number(client?.creditBalance ?? 0),
        alreadyApproved: true,
      };
    }

    if (purchase.status !== CREDIT_PURCHASE_STATUS.PENDING) {
      throw new Error(`Purchase is already ${purchase.status}`);
    }

    if (!purchase.txHash?.trim() && !purchase.proofPath) {
      throw new Error("No payment proof submitted yet");
    }

    const [existingLedger] = await tx
      .select({ id: creditLedgerTable.id, balanceAfter: creditLedgerTable.balanceAfter })
      .from(creditLedgerTable)
      .where(
        and(
          eq(creditLedgerTable.clientId, purchase.clientId),
          eq(creditLedgerTable.refType, "purchase"),
          eq(creditLedgerTable.refId, String(purchase.id)),
          eq(creditLedgerTable.reason, "purchase_approved"),
        ),
      )
      .limit(1);

    let balanceAfter: number;

    if (existingLedger) {
      balanceAfter = existingLedger.balanceAfter;
    } else {
      const [updatedClient] = await tx
        .update(apiClientsTable)
        .set({
          creditBalance: sql`${apiClientsTable.creditBalance} + ${purchase.credits}`,
          isDemo: false,
          updatedAt: new Date(),
        })
        .where(eq(apiClientsTable.id, purchase.clientId))
        .returning({ creditBalance: apiClientsTable.creditBalance });

      if (!updatedClient) throw new Error("Client not found");

      balanceAfter = updatedClient.creditBalance;

      await tx.insert(creditLedgerTable).values({
        clientId: purchase.clientId,
        delta: purchase.credits,
        balanceAfter,
        reason: "purchase_approved",
        refType: "purchase",
        refId: String(purchase.id),
        createdByAdminId: opts.adminId ?? null,
      });
    }

    const [updatedPurchase] = await tx
      .update(creditPurchasesTable)
      .set({
        status: CREDIT_PURCHASE_STATUS.APPROVED,
        adminNote: opts.adminNote ?? purchase.adminNote,
        reviewedByAdminId: opts.adminId ?? null,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(creditPurchasesTable.id, opts.purchaseId),
          eq(creditPurchasesTable.status, CREDIT_PURCHASE_STATUS.PENDING),
        ),
      )
      .returning();

    if (!updatedPurchase) {
      throw new Error("Purchase is no longer pending");
    }

    return { purchase: updatedPurchase, balanceAfter, alreadyApproved: false };
  });
}

export async function rejectCreditPurchase(opts: {
  purchaseId: number;
  adminId?: number | null;
  adminNote?: string | null;
}): Promise<{ purchase: CreditPurchase }> {
  const adminNote = opts.adminNote?.trim() || null;
  if (!adminNote) {
    throw new Error("A rejection reason is required for the client");
  }

  const [updated] = await db
    .update(creditPurchasesTable)
    .set({
      status: CREDIT_PURCHASE_STATUS.REJECTED,
      adminNote,
      reviewedByAdminId: opts.adminId ?? null,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(creditPurchasesTable.id, opts.purchaseId),
        eq(creditPurchasesTable.status, CREDIT_PURCHASE_STATUS.PENDING),
      ),
    )
    .returning();

  if (!updated) {
    const [purchase] = await db
      .select()
      .from(creditPurchasesTable)
      .where(eq(creditPurchasesTable.id, opts.purchaseId))
      .limit(1);

    if (!purchase) throw new Error("Purchase not found");
    if (purchase.status === CREDIT_PURCHASE_STATUS.REJECTED) {
      return { purchase };
    }
    throw new Error(`Cannot reject purchase in status ${purchase.status}`);
  }

  return { purchase: updated };
}
