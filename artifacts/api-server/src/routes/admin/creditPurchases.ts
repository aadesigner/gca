import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, creditPurchasesTable, apiClientsTable } from "@workspace/db";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import { adjustCredits } from "../../lib/credits";
import { resolveProofPath } from "../../lib/credit-proof";

const router: IRouter = Router();

router.get("/admin/credit-purchases", requireAdmin, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = status ? eq(creditPurchasesTable.status, status) : undefined;
  const rows = await db
    .select({
      id: creditPurchasesTable.id,
      clientId: creditPurchasesTable.clientId,
      clientName: apiClientsTable.name,
      clientEmail: apiClientsTable.email,
      credits: creditPurchasesTable.credits,
      amountUsd: creditPurchasesTable.amountUsd,
      cryptoCurrency: creditPurchasesTable.cryptoCurrency,
      txHash: creditPurchasesTable.txHash,
      payerNote: creditPurchasesTable.payerNote,
      proofPath: creditPurchasesTable.proofPath,
      hasProof: sql<boolean>`${creditPurchasesTable.proofPath} IS NOT NULL`,
      status: creditPurchasesTable.status,
      adminNote: creditPurchasesTable.adminNote,
      reviewedAt: creditPurchasesTable.reviewedAt,
      createdAt: creditPurchasesTable.createdAt,
    })
    .from(creditPurchasesTable)
    .leftJoin(apiClientsTable, eq(creditPurchasesTable.clientId, apiClientsTable.id))
    .where(where)
    .orderBy(desc(creditPurchasesTable.createdAt))
    .limit(200);

  res.json({ items: rows });
});

router.post("/admin/credit-purchases/:id/approve", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const adminNote =
    typeof req.body?.adminNote === "string" ? req.body.adminNote.trim().slice(0, 500) || null : null;

  const [purchase] = await db
    .select()
    .from(creditPurchasesTable)
    .where(eq(creditPurchasesTable.id, id))
    .limit(1);

  if (!purchase) {
    res.status(404).json({ error: "Purchase not found" });
    return;
  }
  if (purchase.status !== "pending") {
    res.status(400).json({ error: `Purchase is already ${purchase.status}` });
    return;
  }

  const result = await adjustCredits({
    clientId: purchase.clientId,
    delta: purchase.credits,
    reason: "purchase_approved",
    refType: "purchase",
    refId: String(purchase.id),
    adminId: req.session.adminId ?? null,
  });

  const [updated] = await db
    .update(creditPurchasesTable)
    .set({
      status: "approved",
      adminNote,
      reviewedByAdminId: req.session.adminId ?? null,
      reviewedAt: new Date(),
    })
    .where(and(eq(creditPurchasesTable.id, id), eq(creditPurchasesTable.status, "pending")))
    .returning();

  await writeAuditLog({
    req,
    action: "credit_purchase.approve",
    entityType: "credit_purchase",
    entityId: id,
    details: { credits: purchase.credits, balanceAfter: result.balanceAfter },
  });

  res.json({ purchase: updated, balanceAfter: result.balanceAfter });
});

router.post("/admin/credit-purchases/:id/reject", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const adminNote =
    typeof req.body?.adminNote === "string" ? req.body.adminNote.trim().slice(0, 500) || null : null;

  const [updated] = await db
    .update(creditPurchasesTable)
    .set({
      status: "rejected",
      adminNote,
      reviewedByAdminId: req.session.adminId ?? null,
      reviewedAt: new Date(),
    })
    .where(and(eq(creditPurchasesTable.id, id), eq(creditPurchasesTable.status, "pending")))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Pending purchase not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "credit_purchase.reject",
    entityType: "credit_purchase",
    entityId: id,
  });

  res.json({ purchase: updated });
});

router.get("/admin/credit-purchases/:id/proof", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [purchase] = await db
    .select({ proofPath: creditPurchasesTable.proofPath })
    .from(creditPurchasesTable)
    .where(eq(creditPurchasesTable.id, id))
    .limit(1);
  if (!purchase?.proofPath) {
    res.status(404).json({ error: "No proof on file" });
    return;
  }
  const abs = resolveProofPath(purchase.proofPath);
  if (!abs) {
    res.status(404).json({ error: "Proof file missing" });
    return;
  }
  res.sendFile(abs);
});

router.post("/admin/api-clients/:id/credits", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const delta = Math.trunc(Number(req.body?.delta));
  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim().slice(0, 120)
      : "admin_adjust";

  if (!Number.isFinite(id) || !Number.isFinite(delta) || delta === 0) {
    res.status(400).json({ error: "client id and non-zero delta are required" });
    return;
  }

  try {
    const result = await adjustCredits({
      clientId: id,
      delta,
      reason,
      refType: "admin",
      adminId: req.session.adminId ?? null,
      clearDemo: delta > 0 ? true : false,
    });

    if (typeof req.body?.isDemo === "boolean") {
      await db
        .update(apiClientsTable)
        .set({ isDemo: req.body.isDemo, updatedAt: new Date() })
        .where(eq(apiClientsTable.id, id));
    }

    await writeAuditLog({
      req,
      action: "api_client.credits",
      entityType: "api_client",
      entityId: id,
      details: { delta, reason, balanceAfter: result.balanceAfter },
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Credit adjust failed" });
  }
});

export default router;
