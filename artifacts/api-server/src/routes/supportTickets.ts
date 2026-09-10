/**
 * Client support tickets + admin inbox.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  apiClientsTable,
  supportTicketsTable,
  supportTicketMessagesTable,
  SUPPORT_TICKET_CATEGORIES,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { requireClient, loadActiveClient } from "../middlewares/clientAuth";
import { writeAuditLog } from "../lib/audit";
import {
  notifyTemplatedMail,
  notifyStaffTemplated,
  publicBaseUrl,
  loadEmailSettings,
} from "../lib/mail";

const router: IRouter = Router();
const STATUSES = new Set(["open", "awaiting_client", "closed"]);
const CATEGORIES = new Set<string>(SUPPORT_TICKET_CATEGORIES);
const MAX_TICKETS_PER_DAY = 1;
const MAX_REPLIES_PER_5_MIN = 2;

function parseCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toLowerCase();
  return CATEGORIES.has(c) ? c : null;
}

function parseStatus(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return STATUSES.has(s) ? s : null;
}

function parseSearchQ(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().slice(0, 80);
  return q.length >= 1 ? q : null;
}

async function clientTicketsCreatedToday(clientId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(supportTicketsTable)
    .where(
      and(
        eq(supportTicketsTable.clientId, clientId),
        sql`${supportTicketsTable.createdAt} >= date_trunc('day', now() at time zone 'UTC')`,
      ),
    );
  return Number(row?.c ?? 0);
}

async function clientRepliesLast5Minutes(clientId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(supportTicketMessagesTable)
    .innerJoin(supportTicketsTable, eq(supportTicketMessagesTable.ticketId, supportTicketsTable.id))
    .where(
      and(
        eq(supportTicketsTable.clientId, clientId),
        eq(supportTicketMessagesTable.authorType, "client"),
        sql`${supportTicketMessagesTable.createdAt} > now() - interval '5 minutes'`,
        sql`${supportTicketMessagesTable.id} > (
          SELECT min(m2.id) FROM support_ticket_messages m2
          WHERE m2.ticket_id = ${supportTicketMessagesTable.ticketId}
        )`,
      ),
    );
  return Number(row?.c ?? 0);
}

async function clientSupportLimits(clientId: number) {
  const ticketsCreatedToday = await clientTicketsCreatedToday(clientId);
  const repliesInLast5Minutes = await clientRepliesLast5Minutes(clientId);
  return {
    ticketsPerDay: MAX_TICKETS_PER_DAY,
    repliesPer5Minutes: MAX_REPLIES_PER_5_MIN,
    ticketsCreatedToday,
    repliesInLast5Minutes,
    canCreateTicket: ticketsCreatedToday < MAX_TICKETS_PER_DAY,
    canReply: repliesInLast5Minutes < MAX_REPLIES_PER_5_MIN,
  };
}

function ticketPublic(row: typeof supportTicketsTable.$inferSelect, extras: Record<string, unknown> = {}) {
  return {
    id: row.id,
    clientId: row.clientId,
    subject: row.subject,
    category: row.category || "other",
    status: row.status,
    clientUnread: row.clientUnread,
    adminUnread: row.adminUnread,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...extras,
  };
}

function messagePublic(row: typeof supportTicketMessagesTable.$inferSelect) {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorType: row.authorType,
    body: row.body,
    createdAt: row.createdAt,
  };
}

async function loadTicketForClient(clientId: number, ticketId: number) {
  const [row] = await db
    .select()
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, ticketId), eq(supportTicketsTable.clientId, clientId)))
    .limit(1);
  return row ?? null;
}

async function loadMessages(ticketId: number) {
  return db
    .select()
    .from(supportTicketMessagesTable)
    .where(eq(supportTicketMessagesTable.ticketId, ticketId))
    .orderBy(supportTicketMessagesTable.createdAt);
}

function searchCondition(q: string) {
  const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
  return or(
    ilike(supportTicketsTable.subject, pattern),
    sql`exists (
      SELECT 1 FROM support_ticket_messages m
      WHERE m.ticket_id = ${supportTicketsTable.id}
        AND m.body ILIKE ${pattern}
    )`,
  );
}

// ── Client ───────────────────────────────────────────────────────────────────

router.get("/client/support/unread-count", requireClient, async (req, res): Promise<void> => {
  const clientId = req.session.clientId!;
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.clientId, clientId), eq(supportTicketsTable.clientUnread, true)));
  res.json({ unreadCount: Number(row?.c ?? 0) });
});

router.get("/client/support/limits", requireClient, async (req, res): Promise<void> => {
  const limits = await clientSupportLimits(req.session.clientId!);
  res.json(limits);
});

router.get("/client/support/categories", requireClient, (_req, res): void => {
  res.json({
    categories: SUPPORT_TICKET_CATEGORIES.map((id) => ({
      id,
      label:
        id === "live_feed"
          ? "Live feed"
          : id === "api"
            ? "API"
            : id.charAt(0).toUpperCase() + id.slice(1),
    })),
  });
});

router.get("/client/support/tickets", requireClient, async (req, res): Promise<void> => {
  const clientId = req.session.clientId!;
  const status = parseStatus(req.query.status);
  const category = parseCategory(req.query.category);
  const q = parseSearchQ(req.query.q);

  const conditions = [eq(supportTicketsTable.clientId, clientId)];
  if (status) conditions.push(eq(supportTicketsTable.status, status));
  if (category) conditions.push(eq(supportTicketsTable.category, category));
  if (q) {
    const sc = searchCondition(q);
    if (sc) conditions.push(sc);
  }

  const rows = await db
    .select()
    .from(supportTicketsTable)
    .where(and(...conditions))
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(100);

  const items = await Promise.all(
    rows.map(async (t) => {
      const [last] = await db
        .select({
          body: supportTicketMessagesTable.body,
          authorType: supportTicketMessagesTable.authorType,
          createdAt: supportTicketMessagesTable.createdAt,
        })
        .from(supportTicketMessagesTable)
        .where(eq(supportTicketMessagesTable.ticketId, t.id))
        .orderBy(desc(supportTicketMessagesTable.createdAt))
        .limit(1);
      return ticketPublic(t, {
        preview: last?.body?.slice(0, 140) ?? "",
        lastAuthorType: last?.authorType ?? null,
        lastMessageAt: last?.createdAt ?? t.createdAt,
      });
    }),
  );

  res.json({ items });
});

router.post("/client/support/tickets", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 160) : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 8000) : "";
  const category = parseCategory(req.body?.category) ?? "other";

  if (subject.length < 3) {
    res.status(400).json({ error: "Subject must be at least 3 characters" });
    return;
  }
  if (message.length < 10) {
    res.status(400).json({ error: "Message must be at least 10 characters" });
    return;
  }

  const limits = await clientSupportLimits(client.id);
  if (!limits.canCreateTicket) {
    res.status(429).json({
      error: `You can open ${MAX_TICKETS_PER_DAY} ticket per day. Try again tomorrow.`,
      ...limits,
    });
    return;
  }

  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({
      clientId: client.id,
      subject,
      category,
      status: "open",
      clientUnread: false,
      adminUnread: true,
    })
    .returning();

  const [msg] = await db
    .insert(supportTicketMessagesTable)
    .values({
      ticketId: ticket!.id,
      authorType: "client",
      body: message,
    })
    .returning();

  void (async () => {
    try {
      const settings = await loadEmailSettings();
      if (!settings) return;
      const base = publicBaseUrl(settings);
      await notifyStaffTemplated({
        type: "support_new_ticket_admin",
        vars: {
          clientName: client.name || "Client",
          clientEmail: client.email || "",
          ticketId: ticket!.id,
          ticketSubject: subject,
          ticketCategory: category,
          ticketUrl: `${base}/adminz/support-tickets?ticket=${ticket!.id}`,
          messagePreview: message.slice(0, 400),
          siteUrl: base,
        },
      });
    } catch (err) {
      req.log?.warn?.({ err }, "support new-ticket email failed");
    }
  })();

  res.status(201).json({
    ticket: ticketPublic(ticket!),
    message: messagePublic(msg!),
    limits: await clientSupportLimits(client.id),
  });
});

router.get("/client/support/tickets/:id", requireClient, async (req, res): Promise<void> => {
  const clientId = req.session.clientId!;
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const ticket = await loadTicketForClient(clientId, ticketId);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  if (ticket.clientUnread) {
    await db
      .update(supportTicketsTable)
      .set({ clientUnread: false, updatedAt: new Date() })
      .where(eq(supportTicketsTable.id, ticketId));
  }

  const messages = await loadMessages(ticketId);
  res.json({
    ticket: ticketPublic({ ...ticket, clientUnread: false }),
    messages: messages.map(messagePublic),
  });
});

router.post("/client/support/tickets/:id/messages", requireClient, async (req, res): Promise<void> => {
  const clientId = req.session.clientId!;
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const ticket = await loadTicketForClient(clientId, ticketId);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }
  if (ticket.status === "closed") {
    res.status(400).json({ error: "This ticket is closed. Open a new ticket if you need more help." });
    return;
  }

  const body = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 8000) : "";
  if (body.length < 2) {
    res.status(400).json({ error: "Reply is too short" });
    return;
  }

  const limits = await clientSupportLimits(clientId);
  if (!limits.canReply) {
    res.status(429).json({
      error: `Slow down — max ${MAX_REPLIES_PER_5_MIN} replies every 5 minutes.`,
      ...limits,
    });
    return;
  }

  const [msg] = await db
    .insert(supportTicketMessagesTable)
    .values({ ticketId, authorType: "client", body })
    .returning();

  await db
    .update(supportTicketsTable)
    .set({
      status: "open",
      adminUnread: true,
      clientUnread: false,
      updatedAt: new Date(),
    })
    .where(eq(supportTicketsTable.id, ticketId));

  void (async () => {
    try {
      const client = await loadActiveClient(clientId);
      const settings = await loadEmailSettings();
      if (!settings) return;
      const base = publicBaseUrl(settings);
      await notifyStaffTemplated({
        type: "support_client_reply_admin",
        vars: {
          clientName: client?.name || "Client",
          clientEmail: client?.email || "",
          ticketId,
          ticketSubject: ticket.subject,
          ticketUrl: `${base}/adminz/support-tickets?ticket=${ticketId}`,
          replyPreview: body.slice(0, 400),
          siteUrl: base,
        },
      });
    } catch (err) {
      req.log?.warn?.({ err }, "support client-reply email failed");
    }
  })();

  res.status(201).json({
    message: messagePublic(msg!),
    limits: await clientSupportLimits(clientId),
  });
});

/** Client closes a ticket (no hard delete). */
router.patch("/client/support/tickets/:id", requireClient, async (req, res): Promise<void> => {
  const clientId = req.session.clientId!;
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const ticket = await loadTicketForClient(clientId, ticketId);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const status = parseStatus(req.body?.status);
  if (status !== "closed") {
    res.status(400).json({ error: "Clients can only close tickets" });
    return;
  }

  const [row] = await db
    .update(supportTicketsTable)
    .set({ status: "closed", clientUnread: false, updatedAt: new Date() })
    .where(and(eq(supportTicketsTable.id, ticketId), eq(supportTicketsTable.clientId, clientId)))
    .returning();

  res.json({ ticket: ticketPublic(row!) });
});

router.delete("/client/support/tickets/:id", requireClient, async (req, res): Promise<void> => {
  // Soft: close instead of hard delete (backward compatible with old UI).
  const clientId = req.session.clientId!;
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const ticket = await loadTicketForClient(clientId, ticketId);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const [row] = await db
    .update(supportTicketsTable)
    .set({ status: "closed", clientUnread: false, updatedAt: new Date() })
    .where(eq(supportTicketsTable.id, ticketId))
    .returning();

  res.json({
    success: true,
    id: ticketId,
    closed: true,
    ticket: ticketPublic(row!),
    limits: await clientSupportLimits(clientId),
  });
});

// ── Admin ────────────────────────────────────────────────────────────────────

router.get("/admin/support/unread-count", requireAdmin, async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.adminUnread, true));
  res.json({ unreadCount: Number(row?.c ?? 0) });
});

router.get("/admin/support/categories", requireAdmin, (_req, res): void => {
  res.json({
    categories: SUPPORT_TICKET_CATEGORIES.map((id) => ({
      id,
      label:
        id === "live_feed"
          ? "Live feed"
          : id === "api"
            ? "API"
            : id.charAt(0).toUpperCase() + id.slice(1),
    })),
  });
});

router.get("/admin/support/tickets", requireAdmin, async (req, res): Promise<void> => {
  const status = parseStatus(req.query.status);
  const category = parseCategory(req.query.category);
  const q = parseSearchQ(req.query.q);
  const unreadOnly = req.query.unread === "1" || req.query.unread === "true";
  const clientIdRaw = typeof req.query.clientId === "string" ? Number(req.query.clientId) : NaN;
  const clientId = Number.isFinite(clientIdRaw) && clientIdRaw > 0 ? Math.trunc(clientIdRaw) : null;

  const conditions = [];
  if (status) conditions.push(eq(supportTicketsTable.status, status));
  if (category) conditions.push(eq(supportTicketsTable.category, category));
  if (unreadOnly) conditions.push(eq(supportTicketsTable.adminUnread, true));
  if (clientId != null) conditions.push(eq(supportTicketsTable.clientId, clientId));
  if (q) {
    const sc = searchCondition(q);
    if (sc) conditions.push(sc);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      ticket: supportTicketsTable,
      clientName: apiClientsTable.name,
      clientEmail: apiClientsTable.email,
      companyName: apiClientsTable.companyName,
      websiteUrl: apiClientsTable.websiteUrl,
      preview: sql<string | null>`(
        SELECT left(m.body, 160) FROM support_ticket_messages m
        WHERE m.ticket_id = ${supportTicketsTable.id}
        ORDER BY m.created_at DESC LIMIT 1
      )`,
      lastAuthorType: sql<string | null>`(
        SELECT m.author_type FROM support_ticket_messages m
        WHERE m.ticket_id = ${supportTicketsTable.id}
        ORDER BY m.created_at DESC LIMIT 1
      )`,
      lastMessageAt: sql<Date | null>`(
        SELECT m.created_at FROM support_ticket_messages m
        WHERE m.ticket_id = ${supportTicketsTable.id}
        ORDER BY m.created_at DESC LIMIT 1
      )`,
    })
    .from(supportTicketsTable)
    .innerJoin(apiClientsTable, eq(supportTicketsTable.clientId, apiClientsTable.id))
    .where(where)
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(200);

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.adminUnread, true));

  const items = rows.map(
    ({ ticket, clientName, clientEmail, companyName, websiteUrl, preview, lastAuthorType, lastMessageAt }) => ({
      ...ticketPublic(ticket),
      clientName,
      clientEmail,
      companyName,
      websiteUrl,
      preview: preview ?? "",
      lastAuthorType: lastAuthorType ?? null,
      lastMessageAt: lastMessageAt ?? ticket.createdAt,
    }),
  );

  res.json({ items, unreadCount: Number(countRow?.c ?? 0) });
});

router.get("/admin/support/tickets/:id", requireAdmin, async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const [row] = await db
    .select({
      ticket: supportTicketsTable,
      clientName: apiClientsTable.name,
      clientEmail: apiClientsTable.email,
      companyName: apiClientsTable.companyName,
      websiteUrl: apiClientsTable.websiteUrl,
    })
    .from(supportTicketsTable)
    .innerJoin(apiClientsTable, eq(supportTicketsTable.clientId, apiClientsTable.id))
    .where(eq(supportTicketsTable.id, ticketId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  if (row.ticket.adminUnread) {
    await db
      .update(supportTicketsTable)
      .set({ adminUnread: false, updatedAt: new Date() })
      .where(eq(supportTicketsTable.id, ticketId));
  }

  const messages = await loadMessages(ticketId);
  res.json({
    ticket: {
      ...ticketPublic({ ...row.ticket, adminUnread: false }),
      clientName: row.clientName,
      clientEmail: row.clientEmail,
      companyName: row.companyName,
      websiteUrl: row.websiteUrl,
    },
    messages: messages.map(messagePublic),
  });
});

router.patch("/admin/support/tickets/:id", requireAdmin, async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const patch: { status?: string; category?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof req.body?.status === "string" && STATUSES.has(req.body.status)) {
    patch.status = req.body.status;
  }
  const category = parseCategory(req.body?.category);
  if (category) patch.category = category;
  if (!patch.status && !patch.category) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [row] = await db
    .update(supportTicketsTable)
    .set(patch)
    .where(eq(supportTicketsTable.id, ticketId))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "support_ticket.update",
    entityType: "support_ticket",
    entityId: String(ticketId),
    details: { status: row.status, category: row.category },
  });

  res.json({ ticket: ticketPublic(row) });
});

router.post("/admin/support/tickets/:id/messages", requireAdmin, async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, ticketId)).limit(1);
  if (!ticket) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const body = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 8000) : "";
  if (body.length < 2) {
    res.status(400).json({ error: "Reply is too short" });
    return;
  }

  const [msg] = await db
    .insert(supportTicketMessagesTable)
    .values({ ticketId, authorType: "admin", body })
    .returning();

  await db
    .update(supportTicketsTable)
    .set({
      status: ticket.status === "closed" ? "closed" : "awaiting_client",
      clientUnread: true,
      adminUnread: false,
      updatedAt: new Date(),
    })
    .where(eq(supportTicketsTable.id, ticketId));

  await writeAuditLog({
    req,
    action: "support_ticket.reply",
    entityType: "support_ticket",
    entityId: String(ticketId),
  });

  void (async () => {
    try {
      const [client] = await db
        .select({
          name: apiClientsTable.name,
          email: apiClientsTable.email,
        })
        .from(apiClientsTable)
        .where(eq(apiClientsTable.id, ticket.clientId))
        .limit(1);
      if (!client?.email) return;
      const settings = await loadEmailSettings();
      if (!settings) return;
      const base = publicBaseUrl(settings);
      notifyTemplatedMail({
        type: "support_staff_reply",
        to: client.email,
        vars: {
          clientName: client.name || "there",
          clientEmail: client.email,
          ticketId,
          ticketSubject: ticket.subject,
          ticketUrl: `${base}/account/?ticket=${ticketId}`,
          replyPreview: body.slice(0, 400),
          siteUrl: base,
        },
      });
    } catch (err) {
      req.log?.warn?.({ err }, "support staff-reply email failed");
    }
  })();

  res.status(201).json({ message: messagePublic(msg!) });
});

router.delete("/admin/support/tickets/:id", requireAdmin, async (req, res): Promise<void> => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) {
    res.status(400).json({ error: "Invalid ticket id" });
    return;
  }

  const [row] = await db
    .delete(supportTicketsTable)
    .where(eq(supportTicketsTable.id, ticketId))
    .returning({ id: supportTicketsTable.id, subject: supportTicketsTable.subject });

  if (!row) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "support_ticket.delete",
    entityType: "support_ticket",
    entityId: String(ticketId),
    details: { subject: row.subject },
  });

  res.json({ success: true, id: row.id });
});

export default router;
