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

router.post("/client/access-request", loginRateLimit, async (req, res): Promise<void> => {
  const captcha = await verifyRecaptchaV3({
    token: req.body?.recaptchaToken,
    action: "access_request",
    remoteIp: req.ip,
  });
  if (!captcha.ok) {
    res.status(400).json({ error: captcha.error });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 4000) : "";
  const serviceInterest =
    typeof req.body?.serviceInterest === "string" ? req.body.serviceInterest.trim() : "";
  const telegramUsername = normalizeTelegram(req.body?.telegramUsername);
  const websiteUrl = normalizeWebsite(req.body?.websiteUrl);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  if (!SERVICES.has(serviceInterest)) {
    res.status(400).json({
      error: "Select a service: live feed, VIN / auction reports, or both",
    });
    return;
  }
  if (message.length < 10) {
    res.status(400).json({ error: "Please add a short message (at least 10 characters)" });
    return;
  }
  if (typeof req.body?.telegramUsername === "string" && req.body.telegramUsername.trim() && !telegramUsername) {
    res.status(400).json({ error: "Telegram username looks invalid (use letters, numbers, underscore)" });
    return;
  }
  if (typeof req.body?.websiteUrl === "string" && req.body.websiteUrl.trim() && !websiteUrl) {
    res.status(400).json({ error: "Website URL looks invalid" });
    return;
  }

  // Soft anti-spam: same email within 10 minutes
  const [recent] = await db
    .select({ id: accessRequestsTable.id })
    .from(accessRequestsTable)
    .where(
      and(
        eq(accessRequestsTable.email, email),
        sql`${accessRequestsTable.createdAt} > now() - interval '10 minutes'`,
      ),
    )
    .limit(1);
  if (recent) {
    res.status(429).json({
      error: "You already sent a request recently. We’ll get back to you soon.",
    });
    return;
  }

  const [row] = await db
    .insert(accessRequestsTable)
    .values({
      email,
      telegramUsername,
      websiteUrl,
      serviceInterest,
      message,
      status: "new",
      ipAddress: req.ip ?? null,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 400) : null,
    })
    .returning({ id: accessRequestsTable.id });

  res.status(201).json({
    success: true,
    id: row.id,
    message: "Thanks — we received your details and will contact you shortly.",
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
