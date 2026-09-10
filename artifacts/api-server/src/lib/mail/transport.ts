import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { SettingsEmailRow } from "./defaults";

/** Keep SMTP attempts short so a bad host cannot stall API workers. */
const SMTP_CONNECTION_TIMEOUT_MS = 8_000;
const SMTP_GREETING_TIMEOUT_MS = 8_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;

export function smtpConfigured(settings: SettingsEmailRow): boolean {
  return Boolean(
    settings.smtpEnabled &&
      settings.smtpHost?.trim() &&
      settings.smtpFromEmail?.trim() &&
      Number(settings.smtpPort) > 0,
  );
}

export function createTransport(settings: SettingsEmailRow): Transporter | null {
  if (!smtpConfigured(settings)) return null;
  try {
    const port = Number(settings.smtpPort) || 587;
    // Port 465 = implicit TLS (secure). Port 587 = plain + STARTTLS (not secure).
    const secure = Boolean(settings.smtpSecure) || port === 465;
    return nodemailer.createTransport({
      host: settings.smtpHost!.trim(),
      port,
      secure,
      // One attempt only — never retry on connection / auth failure.
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      requireTLS: !secure && (port === 587 || port === 25),
      tls: {
        // Do not hang forever on TLS negotiation with a misconfigured host.
        servername: settings.smtpHost!.trim(),
      },
      auth:
        settings.smtpUser?.trim() && settings.smtpPassword
          ? {
              user: settings.smtpUser.trim(),
              pass: settings.smtpPassword,
            }
          : undefined,
    });
  } catch (err) {
    console.error(
      "[mail] createTransport failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export function fromAddress(settings: SettingsEmailRow): string {
  const email = (settings.smtpFromEmail || "").trim();
  const name = (settings.smtpFromName || "GetCarAPI").trim();
  if (name) return `"${name.replace(/"/g, "")}" <${email}>`;
  return email;
}
