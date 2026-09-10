/**
 * Admin SMTP + email notification templates.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import {
  EMAIL_TEMPLATE_META,
  EMAIL_TEMPLATE_TYPES,
  type EmailTemplateType,
  DEFAULT_EMAIL_TEMPLATES,
  resolveTemplate,
  publicBaseUrl,
  type SettingsEmailRow,
} from "../../lib/mail/defaults";
import { renderTemplate, textToHtml, sampleVars } from "../../lib/mail/render";
import { sendRawMail, sendTemplatedMail, smtpConfigured } from "../../lib/mail";

const router: IRouter = Router();

function serializeEmailSettings(row: typeof settingsTable.$inferSelect) {
  const s = row as typeof row & SettingsEmailRow;
  return {
    smtpEnabled: Boolean(s.smtpEnabled),
    smtpHost: s.smtpHost ?? "",
    smtpPort: Number(s.smtpPort ?? 587),
    smtpSecure: Boolean(s.smtpSecure),
    smtpUser: s.smtpUser ?? "",
    smtpPasswordConfigured: Boolean(s.smtpPassword),
    smtpFromName: s.smtpFromName ?? "GetCarAPI",
    smtpFromEmail: s.smtpFromEmail ?? "",
    emailStaffInbox: s.emailStaffInbox ?? "",
    emailPublicBaseUrl: s.emailPublicBaseUrl ?? "https://getcarapi.com",
    smtpReady: smtpConfigured(s),
    emailPasswordResetEnabled: Boolean(s.emailPasswordResetEnabled),
    emailSupportStaffReplyEnabled: Boolean(s.emailSupportStaffReplyEnabled),
    emailSupportNewTicketAdminEnabled: Boolean(s.emailSupportNewTicketAdminEnabled),
    emailSupportClientReplyAdminEnabled: Boolean(s.emailSupportClientReplyAdminEnabled),
    emailPaymentApprovedEnabled: Boolean(s.emailPaymentApprovedEnabled),
    templates: Object.fromEntries(
      EMAIL_TEMPLATE_TYPES.map((type) => {
        const resolved = resolveTemplate(s, type);
        const meta = EMAIL_TEMPLATE_META[type];
        return [type, { ...meta, subject: resolved.subject, body: resolved.body }];
      }),
    ),
    emailTplPasswordResetSubject: resolveTemplate(s, "password_reset").subject,
    emailTplPasswordResetBody: resolveTemplate(s, "password_reset").body,
    emailTplSupportStaffReplySubject: resolveTemplate(s, "support_staff_reply").subject,
    emailTplSupportStaffReplyBody: resolveTemplate(s, "support_staff_reply").body,
    emailTplSupportNewTicketAdminSubject: resolveTemplate(s, "support_new_ticket_admin").subject,
    emailTplSupportNewTicketAdminBody: resolveTemplate(s, "support_new_ticket_admin").body,
    emailTplSupportClientReplyAdminSubject: resolveTemplate(s, "support_client_reply_admin").subject,
    emailTplSupportClientReplyAdminBody: resolveTemplate(s, "support_client_reply_admin").body,
    emailTplPaymentApprovedSubject: resolveTemplate(s, "payment_approved").subject,
    emailTplPaymentApprovedBody: resolveTemplate(s, "payment_approved").body,
    templateMeta: EMAIL_TEMPLATE_META,
    defaults: DEFAULT_EMAIL_TEMPLATES,
    updatedAt: row.updatedAt,
  };
}

const UpdateBody = z.object({
  smtpEnabled: z.boolean().optional(),
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(255).nullable().optional(),
  smtpPassword: z.string().max(500).nullable().optional(),
  clearSmtpPassword: z.boolean().optional(),
  smtpFromName: z.string().max(120).nullable().optional(),
  smtpFromEmail: z.string().max(200).nullable().optional(),
  emailStaffInbox: z.string().max(200).nullable().optional(),
  emailPublicBaseUrl: z.string().max(300).nullable().optional(),
  emailPasswordResetEnabled: z.boolean().optional(),
  emailSupportStaffReplyEnabled: z.boolean().optional(),
  emailSupportNewTicketAdminEnabled: z.boolean().optional(),
  emailSupportClientReplyAdminEnabled: z.boolean().optional(),
  emailPaymentApprovedEnabled: z.boolean().optional(),
  emailTplPasswordResetSubject: z.string().max(300).nullable().optional(),
  emailTplPasswordResetBody: z.string().max(20_000).nullable().optional(),
  emailTplSupportStaffReplySubject: z.string().max(300).nullable().optional(),
  emailTplSupportStaffReplyBody: z.string().max(20_000).nullable().optional(),
  emailTplSupportNewTicketAdminSubject: z.string().max(300).nullable().optional(),
  emailTplSupportNewTicketAdminBody: z.string().max(20_000).nullable().optional(),
  emailTplSupportClientReplyAdminSubject: z.string().max(300).nullable().optional(),
  emailTplSupportClientReplyAdminBody: z.string().max(20_000).nullable().optional(),
  emailTplPaymentApprovedSubject: z.string().max(300).nullable().optional(),
  emailTplPaymentApprovedBody: z.string().max(20_000).nullable().optional(),
});

function optionalEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
    throw new Error(`Invalid email: ${t}`);
  }
  return t;
}

function optionalUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    return u.origin;
  } catch {
    throw new Error("Public base URL must be a valid http(s) origin");
  }
}

router.get("/admin/email-settings", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
    if (!settings) {
      res.status(404).json({ error: "Settings not found" });
      return;
    }
    res.json(serializeEmailSettings(settings));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email-settings] GET failed:", message);
    if (/smtp_|email_tpl_|password_reset_tokens|does not exist/i.test(message)) {
      res.status(503).json({
        error:
          "Email settings DB columns are missing. Restart the API so migrations apply (0062_email_notifications), then try again.",
      });
      return;
    }
    res.status(500).json({ error: "Failed to load email settings" });
  }
});

router.put("/admin/email-settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  try {
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.smtpEnabled !== undefined) patch.smtpEnabled = body.smtpEnabled;
    if (body.smtpHost !== undefined) patch.smtpHost = body.smtpHost?.trim() || null;
    if (body.smtpPort !== undefined) patch.smtpPort = body.smtpPort;
    if (body.smtpSecure !== undefined) patch.smtpSecure = body.smtpSecure;
    if (body.smtpUser !== undefined) patch.smtpUser = body.smtpUser?.trim() || null;
    if (body.smtpFromName !== undefined) patch.smtpFromName = body.smtpFromName?.trim() || "GetCarAPI";
    if (body.smtpFromEmail !== undefined) patch.smtpFromEmail = optionalEmail(body.smtpFromEmail);
    if (body.emailStaffInbox !== undefined) patch.emailStaffInbox = optionalEmail(body.emailStaffInbox);
    if (body.emailPublicBaseUrl !== undefined) {
      patch.emailPublicBaseUrl = optionalUrl(body.emailPublicBaseUrl) ?? "https://getcarapi.com";
    }

    if (body.clearSmtpPassword) patch.smtpPassword = null;
    else if (body.smtpPassword !== undefined && body.smtpPassword !== null && body.smtpPassword !== "") {
      patch.smtpPassword = body.smtpPassword;
    }

    // Auto-align TLS flag with common provider ports when the client leaves a mismatch.
    const port = Number(patch.smtpPort ?? body.smtpPort);
    if (Number.isFinite(port) && patch.smtpSecure === undefined && body.smtpSecure === undefined) {
      /* leave as-is */
    } else if (Number.isFinite(port) && port === 465 && patch.smtpSecure === false) {
      patch.smtpSecure = true;
    } else if (Number.isFinite(port) && port === 587 && patch.smtpSecure === true) {
      // 587 expects STARTTLS, not implicit TLS — flipping avoids common 502 test failures.
      patch.smtpSecure = false;
    }

    if (body.emailPasswordResetEnabled !== undefined) {
      patch.emailPasswordResetEnabled = body.emailPasswordResetEnabled;
    }
    if (body.emailSupportStaffReplyEnabled !== undefined) {
      patch.emailSupportStaffReplyEnabled = body.emailSupportStaffReplyEnabled;
    }
    if (body.emailSupportNewTicketAdminEnabled !== undefined) {
      patch.emailSupportNewTicketAdminEnabled = body.emailSupportNewTicketAdminEnabled;
    }
    if (body.emailSupportClientReplyAdminEnabled !== undefined) {
      patch.emailSupportClientReplyAdminEnabled = body.emailSupportClientReplyAdminEnabled;
    }
    if (body.emailPaymentApprovedEnabled !== undefined) {
      patch.emailPaymentApprovedEnabled = body.emailPaymentApprovedEnabled;
    }

    const tplFields = [
      "emailTplPasswordResetSubject",
      "emailTplPasswordResetBody",
      "emailTplSupportStaffReplySubject",
      "emailTplSupportStaffReplyBody",
      "emailTplSupportNewTicketAdminSubject",
      "emailTplSupportNewTicketAdminBody",
      "emailTplSupportClientReplyAdminSubject",
      "emailTplSupportClientReplyAdminBody",
      "emailTplPaymentApprovedSubject",
      "emailTplPaymentApprovedBody",
    ] as const;
    for (const key of tplFields) {
      if (body[key] !== undefined) {
        const v = body[key];
        patch[key] = typeof v === "string" ? v : null;
      }
    }

    const [row] = await db
      .update(settingsTable)
      .set(patch)
      .where(eq(settingsTable.id, 1))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Settings not found" });
      return;
    }

    await writeAuditLog({
      req,
      action: "email_settings.update",
      entityType: "settings",
      entityId: "1",
      details: {
        smtpEnabled: row.smtpEnabled,
        smtpHost: row.smtpHost,
        flags: {
          passwordReset: row.emailPasswordResetEnabled,
          staffReply: row.emailSupportStaffReplyEnabled,
          newTicketAdmin: row.emailSupportNewTicketAdminEnabled,
          clientReplyAdmin: row.emailSupportClientReplyAdminEnabled,
          paymentApproved: row.emailPaymentApprovedEnabled,
        },
      },
    });

    res.json(serializeEmailSettings(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email-settings] PUT failed:", message);
    if (/smtp_|email_tpl_|password_reset_tokens|does not exist/i.test(message)) {
      res.status(503).json({
        error:
          "Email settings DB columns are missing. Restart the API so migrations apply (0062_email_notifications), then try again.",
      });
      return;
    }
    if (/Invalid email|Public base URL/i.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(400).json({ error: message || "Update failed" });
  }
});

const PreviewBody = z.object({
  type: z.enum([
    "password_reset",
    "support_staff_reply",
    "support_new_ticket_admin",
    "support_client_reply_admin",
    "payment_approved",
  ]),
  subject: z.string().max(300).optional(),
  body: z.string().max(20_000).optional(),
});

router.post("/admin/email/preview", requireAdmin, async (req, res): Promise<void> => {
  const parsed = PreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!settings) {
    res.status(404).json({ error: "Settings not found" });
    return;
  }
  const type = parsed.data.type as EmailTemplateType;
  const base = publicBaseUrl(settings as SettingsEmailRow);
  const vars = sampleVars(type, base);
  const resolved = resolveTemplate(settings as SettingsEmailRow, type);
  const subjectTpl = parsed.data.subject?.trim() || resolved.subject;
  const bodyTpl = parsed.data.body?.trim() || resolved.body;
  const subject = renderTemplate(subjectTpl, vars);
  const text = renderTemplate(bodyTpl, vars);
  res.json({
    type,
    subject,
    text,
    html: textToHtml(text),
    vars,
    placeholders: EMAIL_TEMPLATE_META[type].placeholders,
  });
});

const TestBody = z.object({
  to: z.string().email().max(200),
  type: z
    .enum([
      "password_reset",
      "support_staff_reply",
      "support_new_ticket_admin",
      "support_client_reply_admin",
      "payment_approved",
      "smtp_ping",
    ])
    .optional()
    .default("smtp_ping"),
});

router.post("/admin/email/test", requireAdmin, async (req, res): Promise<void> => {
  const parsed = TestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a valid recipient email" });
    return;
  }
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!settings) {
    res.status(404).json({ error: "Settings not found" });
    return;
  }
  const s = settings as SettingsEmailRow;
  if (!smtpConfigured(s)) {
    res.status(400).json({
      error: "SMTP is not enabled or incomplete. Save host, from address, and enable SMTP first.",
    });
    return;
  }

  const type = parsed.data.type;
  let result;
  if (type === "smtp_ping") {
    result = await sendRawMail({
      to: parsed.data.to,
      subject: "GetCarAPI SMTP test",
      text: `This is a test message from GetCarAPI admin.\n\nTime: ${new Date().toISOString()}\n`,
      settings: s,
    });
  } else {
    const vars = sampleVars(type, publicBaseUrl(s));
    result = await sendTemplatedMail({
      type,
      to: parsed.data.to,
      vars,
      force: true,
      settings: s,
    });
  }

  if (!result.ok) {
    // 422 (not 502) — SMTP rejection is a client/config problem, not an upstream crash.
    res.status(422).json({
      error: result.error || result.skipped || "Send failed",
      hint:
        "Check host/port (587 = STARTTLS, leave secure off; 465 = secure on), username/password, and that From is allowed by your provider.",
      result,
    });
    return;
  }

  await writeAuditLog({
    req,
    action: "email.test",
    entityType: "settings",
    entityId: "1",
    details: { to: parsed.data.to, type },
  });

  res.json({ ok: true, to: parsed.data.to, type });
});

export default router;
