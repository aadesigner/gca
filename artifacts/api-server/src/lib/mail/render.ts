export type TemplateVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const URL_LINE_RE = /^(https?:\/\/\S+)$/i;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(PLACEHOLDER_RE, (_m, key: string) => {
    const v = vars[key];
    if (v == null) return "";
    return String(v);
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeCtaLabel(prevLine: string): boolean {
  return /^(open|view|reset|continue|confirm|manage|go to|click)\b/i.test(prevLine.trim());
}

function ctaLabelForUrl(url: string, prevLine: string): string {
  if (looksLikeCtaLabel(prevLine)) return prevLine.replace(/[:.\s]+$/, "").trim() || "Continue";
  if (/[?&]reset=/i.test(url) || /\/account\/\?reset=/i.test(url)) return "Reset password";
  if (/ticket=/i.test(url) || /support/i.test(url)) return "Open ticket";
  if (/\/account\/?$/i.test(url) || /\/account\/\?/i.test(url)) return "Open account";
  if (/admin/i.test(url)) return "Open in admin";
  return "Open link";
}

/**
 * Modern transactional HTML shell (GetCarAPI brand).
 * Plain-text bodies stay the source of truth; URLs on their own line become buttons.
 */
export function textToHtml(plain: string, opts?: { preheader?: string }): string {
  const lines = plain.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(`<div style="height:14px;line-height:14px;font-size:14px">&nbsp;</div>`);
      i += 1;
      continue;
    }
    if (URL_LINE_RE.test(trimmed)) {
      const prev = (lines[i - 1] ?? "").trim();
      const label = escapeHtml(ctaLabelForUrl(trimmed, prev));
      // Drop the previous plain CTA hint line if we promoted it into the button.
      if (looksLikeCtaLabel(prev) && blocks.length > 0) {
        blocks.pop();
        if (blocks.length && /height:14px/.test(blocks[blocks.length - 1] ?? "")) blocks.pop();
      }
      blocks.push(`
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px">
          <tr>
            <td style="border-radius:10px;background:#2563eb">
              <a href="${escapeHtml(trimmed)}"
                 style="display:inline-block;padding:12px 22px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px">
                ${label}
              </a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 18px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#64748b;word-break:break-all">
          Or paste this link:<br />
          <a href="${escapeHtml(trimmed)}" style="color:#2563eb;text-decoration:underline">${escapeHtml(trimmed)}</a>
        </p>`);
      i += 1;
      continue;
    }

    const withInlineLinks = escapeHtml(trimmed).replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#2563eb;text-decoration:underline;word-break:break-all">$1</a>',
    );
    const isSignoff = /^[—–-]\s*GetCarAPI/i.test(trimmed) || /^GetCarAPI$/i.test(trimmed);
    blocks.push(
      `<p style="margin:0 0 ${isSignoff ? "4" : "12"}px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:${
        isSignoff ? "13" : "15"
      }px;line-height:1.6;color:${isSignoff ? "#64748b" : "#0f172a"}">${withInlineLinks}</p>`,
    );
    i += 1;
  }

  const preheader = opts?.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(
        opts.preheader,
      )}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>GetCarAPI</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">
          <tr>
            <td style="padding:0 0 16px;text-align:center">
              <span style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1d4ed8">GetCarAPI</span>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06)">
              <div style="height:4px;background:linear-gradient(90deg,#1d4ed8,#3b82f6,#60a5fa)"></div>
              <div style="padding:28px 28px 24px">
                ${blocks.join("\n")}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0;text-align:center;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#94a3b8">
              VIN history API · Live inventory feeds<br />
              You’re receiving this because of activity on your GetCarAPI account.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function sampleVars(type: string, siteUrl = "https://getcarapi.com"): TemplateVars {
  const base = siteUrl.replace(/\/+$/, "");
  const common = {
    clientName: "Alex Client",
    clientEmail: "alex@example.com",
    siteUrl: base,
  };
  switch (type) {
    case "password_reset":
      return {
        ...common,
        resetUrl: `${base}/account/?reset=SAMPLE_TOKEN`,
        expiresMinutes: 60,
      };
    case "support_staff_reply":
      return {
        ...common,
        ticketId: 42,
        ticketSubject: "Live feed enablement",
        ticketUrl: `${base}/account/?ticket=42`,
        replyPreview: "Thanks — we have enabled Live Feed Korea on your account.",
      };
    case "support_new_ticket_admin":
      return {
        ...common,
        ticketId: 42,
        ticketSubject: "Live feed enablement",
        ticketCategory: "live_feed",
        ticketUrl: `${base}/adminz/support-tickets?ticket=42`,
        messagePreview: "Please enable the Korean live feed for our integration.",
      };
    case "support_client_reply_admin":
      return {
        ...common,
        ticketId: 42,
        ticketSubject: "Live feed enablement",
        ticketUrl: `${base}/adminz/support-tickets?ticket=42`,
        replyPreview: "Got it, thank you!",
      };
    case "payment_approved":
      return {
        ...common,
        credits: 50,
        amountUsd: "100.00",
        balanceAfter: 75,
        accountUrl: `${base}/account/`,
      };
    default:
      return common;
  }
}
