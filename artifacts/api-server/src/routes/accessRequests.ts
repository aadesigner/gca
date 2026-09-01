/**
 * Public access-request form + admin inbox.
 *
 * POST /api/client/access-request     — public (reCAPTCHA)
 * GET  /api/admin/access-requests     — admin list
 * PATCH /api/admin/access-requests/:id — update status / note
 * DELETE /api/admin/access-requests/:id — remove request
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, accessRequestsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { loginRateLimit } from "../middlewares/loginRateLimit";
import { verifyRecaptchaV3 } from "../lib/recaptcha";
import { writeAuditLog } from "../lib/audit";

const router: IRouter = Router();

const SERVICES = new Set(["live_feed", "vin_api", "both"]);
const STATUSES = new Set(["new", "read", "contacted", "closed"]);

function normalizeTelegram(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.trim().replace(/^@+/, "").slice(0, 64);
  if (!t) return null;
  if (!/^[A-Za-z0-9_]{3,64}$/.test(t)) return null;
  return t;
}

function normalizeWebsite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let u = raw.trim().slice(0, 400);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname || !parsed.hostname.includes(".")) return null;
    return parsed.toString().slice(0, 400);
  } catch {
    return null;
  }
}

router.post("/client/access-request", loginRateLimit, (_req, res): void => {
  res.status(410).json({
    error: "Access requests are no longer used. Create a free account at /account/?register=1",
  });
});

router.get("/admin/access-requests", requireAdmin, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const where = status && STATUSES.has(status) ? eq(accessRequestsTable.status, status) : undefined;

  const rows = await db
    .select()
    .from(accessRequestsTable)
    .where(where)
    .orderBy(desc(accessRequestsTable.createdAt))
    .limit(300);

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(accessRequestsTable)
    .where(eq(accessRequestsTable.status, "new"));

  res.json({ items: rows, newCount: Number(countRow?.c ?? 0) });
});

router.patch("/admin/access-requests/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const patch: {
    status?: string;
    adminNote?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (typeof req.body?.status === "string" && STATUSES.has(req.body.status)) {
    patch.status = req.body.status;
  }
  if (req.body?.adminNote !== undefined) {
    patch.adminNote =
      typeof req.body.adminNote === "string" ? req.body.adminNote.trim().slice(0, 2000) || null : null;
  }
  if (!patch.status && req.body?.adminNote === undefined) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [row] = await db
    .update(accessRequestsTable)
    .set(patch)
    .where(eq(accessRequestsTable.id, id))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "access_request.update",
    entityType: "access_request",
    entityId: String(id),
    details: { status: row.status },
  });

  res.json({ item: row });
});

router.delete("/admin/access-requests/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [row] = await db
    .delete(accessRequestsTable)
    .where(eq(accessRequestsTable.id, id))
    .returning({ id: accessRequestsTable.id, email: accessRequestsTable.email });

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "access_request.delete",
    entityType: "access_request",
    entityId: String(id),
    details: { email: row.email },
  });

  res.json({ success: true, id: row.id });
});

export default router;
