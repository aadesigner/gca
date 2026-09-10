import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import {
  type EmailTemplateType,
  type SettingsEmailRow,
  isTemplateEnabled,
  publicBaseUrl,
  resolveTemplate,
  staffInbox,
} from "./defaults";
import { createTransport, fromAddress, smtpConfigured } from "./transport";
import { renderTemplate, textToHtml, type TemplateVars } from "./render";

async function loadEmailSettings(): Promise<SettingsEmailRow | null> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1)).limit(1);
    return (row as SettingsEmailRow | undefined) ?? null;
  } catch (err) {
    console.error(
      "[mail] load settings failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export type SendResult = { ok: boolean; skipped?: string; error?: string };

export async function sendRawMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  settings?: SettingsEmailRow | null;
}): Promise<SendResult> {
  let transport: ReturnType<typeof createTransport> = null;
  try {
    const settings = opts.settings ?? (await loadEmailSettings());
    if (!settings) return { ok: false, skipped: "no_settings" };
    // SMTP off / incomplete → no-op (safe for all product flows).
    if (!smtpConfigured(settings)) return { ok: false, skipped: "smtp_disabled_or_incomplete" };
    transport = createTransport(settings);
    if (!transport) return { ok: false, skipped: "no_transport" };
    const to = opts.to.trim();
    if (!to || !to.includes("@")) return { ok: false, skipped: "invalid_to" };

    await transport.sendMail({
      from: fromAddress(settings),
      to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html ?? textToHtml(opts.text),
    });
    return { ok: true };
  } catch (err) {
    // Connection refused, auth failure, timeout, etc. — never throw to callers.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mail] send failed:", message);
    return { ok: false, error: message };
  } finally {
    // Close idle sockets so failed hosts do not leak connections.
    try {
      transport?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function sendTemplatedMail(opts: {
  type: EmailTemplateType;
  to: string;
  vars: TemplateVars;
  /** When true, ignore per-event enable flag (admin test / preview send). */
  force?: boolean;
  settings?: SettingsEmailRow | null;
}): Promise<SendResult> {
  try {
    const settings = opts.settings ?? (await loadEmailSettings());
    if (!settings) return { ok: false, skipped: "no_settings" };
    if (!opts.force && !isTemplateEnabled(settings, opts.type)) {
      return { ok: false, skipped: "event_disabled" };
    }
    if (!smtpConfigured(settings)) return { ok: false, skipped: "smtp_disabled_or_incomplete" };

    const vars: TemplateVars = {
      siteUrl: publicBaseUrl(settings),
      ...opts.vars,
    };
    const tpl = resolveTemplate(settings, opts.type);
    const subject = renderTemplate(tpl.subject, vars);
    const text = renderTemplate(tpl.body, vars);
    return await sendRawMail({ to: opts.to, subject, text, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mail] templated send failed:", message);
    return { ok: false, error: message };
  }
}

/**
 * Fire-and-forget notification for product flows.
 * Never throws; never blocks the HTTP response if callers use void / do not await.
 */
export function notifyTemplatedMail(opts: {
  type: EmailTemplateType;
  to: string | null | undefined;
  vars: TemplateVars;
}): void {
  const to = opts.to?.trim();
  if (!to) return;
  void sendTemplatedMail({ type: opts.type, to, vars: opts.vars }).catch((err) => {
    console.error("[mail] notify failed:", err);
  });
}

/** Staff inbox notify — never throws. Safe when SMTP unset or down. */
export async function notifyStaffTemplated(opts: {
  type: "support_new_ticket_admin" | "support_client_reply_admin";
  vars: TemplateVars;
}): Promise<void> {
  try {
    const settings = await loadEmailSettings();
    if (!settings) return;
    const to = staffInbox(settings);
    if (!to) return;
    await sendTemplatedMail({ type: opts.type, to, vars: opts.vars, settings });
  } catch (err) {
    console.error("[mail] staff notify failed:", err);
  }
}

export { loadEmailSettings, smtpConfigured, publicBaseUrl, staffInbox };
