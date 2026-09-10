/**
 * One-shot: send a manual “new ticket reply” email (new branded template) to 3 recipients.
 * Uses production SMTP settings. Run once.
 *
 * node --import ./scripts/load-env.mjs ./scripts/src/_ops-send-manual-ticket-reply.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import pg from "pg";

const require = createRequire(path.join(process.cwd(), "artifacts/api-server/package.json"));
const nodemailer = require("nodemailer");

const RECIPIENTS = [
  "f.alghariani@merapp.ly",
  "autoverit@gmail.com",
  "bellanica.mergim@gmail.com",
];

const ACCOUNT_URL = "https://getcarapi.com/account/";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandedHtml({ greeting, bodyLines, ctaLabel, ctaUrl, preheader }) {
  const font =
    "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
  const paras = bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-family:${font};font-size:15px;line-height:1.55;color:#0f172a">${escapeHtml(line)}</p>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GetCarAPI</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
    <tr>
      <td align="center" style="padding:40px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%">
          <tr>
            <td style="padding:0 4px 20px;font-family:${font};font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#1e3a8a">
              GetCarAPI
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 28px 28px">
              <p style="margin:0 0 14px;font-family:${font};font-size:15px;line-height:1.55;color:#0f172a">${escapeHtml(greeting)}</p>
              ${paras}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0">
                <tr>
                  <td align="left" bgcolor="#1d4ed8" style="border-radius:8px;background-color:#1d4ed8">
                    <a href="${escapeHtml(ctaUrl)}"
                       style="display:inline-block;padding:13px 22px;font-family:${font};font-size:14px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px">
                      ${escapeHtml(ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 4px 0;font-family:${font};font-size:12px;line-height:1.45;color:#94a3b8">
              <a href="https://getcarapi.com" style="color:#64748b;text-decoration:none">getcarapi.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const textBody = `Hi,

You have a new reply on your GetCarAPI support ticket.

Our team responded in your client area — open it to read the message and continue the conversation.

Open client area:
${ACCOUNT_URL}

— GetCarAPI
https://getcarapi.com`;

const html = brandedHtml({
  greeting: "Hi,",
  bodyLines: [
    "You have a new reply on your GetCarAPI support ticket.",
    "Our team responded in your client area — open it to read the message and continue the conversation.",
  ],
  ctaLabel: "Open client area",
  ctaUrl: ACCOUNT_URL,
  preheader: "You have a new reply on your GetCarAPI support ticket.",
});

const client = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT || 5432),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
});

if (!process.env.PROD_PG_HOST || !process.env.PROD_PG_PASSWORD) {
  console.error("Need PROD_PG_HOST and PROD_PG_PASSWORD");
  process.exit(1);
}

await client.connect();
const { rows } = await client.query(`
  SELECT smtp_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password,
         smtp_from_email, smtp_from_name
  FROM settings WHERE id = 1
`);
await client.end();

const s = rows[0];
if (!s?.smtp_enabled || !s.smtp_host || !s.smtp_from_email || !s.smtp_password) {
  console.error("Production SMTP is not fully configured");
  process.exit(1);
}

const port = Number(s.smtp_port) || 587;
const secure = Boolean(s.smtp_secure) || port === 465;
const transport = nodemailer.createTransport({
  host: s.smtp_host,
  port,
  secure,
  requireTLS: !secure && (port === 587 || port === 25),
  connectionTimeout: 12_000,
  greetingTimeout: 12_000,
  socketTimeout: 20_000,
  auth: s.smtp_user
    ? { user: s.smtp_user, pass: s.smtp_password }
    : undefined,
});

const fromName = (s.smtp_from_name || "GetCarAPI").replace(/"/g, "");
const from = `"${fromName}" <${s.smtp_from_email}>`;
const subject = "New reply on your GetCarAPI support ticket";

const results = [];
for (const to of RECIPIENTS) {
  try {
    await transport.sendMail({
      from,
      to,
      subject,
      text: textBody,
      html,
    });
    results.push({ to, ok: true });
    console.log("sent:", to);
  } catch (err) {
    results.push({ to, ok: false, error: err instanceof Error ? err.message : String(err) });
    console.error("failed:", to, err instanceof Error ? err.message : err);
  }
}

try {
  transport.close();
} catch {
  /* ignore */
}

console.log(JSON.stringify({ subject, accountUrl: ACCOUNT_URL, results }, null, 2));
