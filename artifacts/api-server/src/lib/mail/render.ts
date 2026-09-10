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

function isSignoffLine(line: string): boolean {
  const t = line.trim();
  return (
    /^[—–-]\s*GetCarAPI\s*$/i.test(t) ||
    /^GetCarAPI\s*$/i.test(t) ||
    /^https?:\/\/(www\.)?getcarapi\.com\/?$/i.test(t)
  );
}

function ctaLabelForUrl(url: string, prevLine: string): string {
  if (looksLikeCtaLabel(prevLine)) {
    return prevLine.replace(/[:.\s]+$/g, "").trim() || "Continue";
  }
  if (/[?&]reset=/i.test(url) || /\/account\/\?reset=/i.test(url)) return "Reset password";
  if (/ticket=/i.test(url)) return "View ticket";
  if (/support-tickets/i.test(url) || /\/admin/i.test(url)) return "Open in admin";
  if (/\/account\/?/i.test(url)) return "Open client area";
  return "Continue";
}

type ParsedEmail = {
  paragraphs: string[];
  cta: { url: string; label: string } | null;
  afterNote: string | null;
};

/**
 * Split plain-text template into body copy + a single CTA.
 * Standalone URL lines become one button (never a second “open link” control).
 */
function parseEmailBody(plain: string): ParsedEmail {
  const lines = plain.replace(/\r\n/g, "\n").split("\n");
  const paragraphs: string[] = [];
  let cta: ParsedEmail["cta"] = null;
  let afterNote: string | null = null;
  let buf: string[] = [];

  const flushBuf = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (text) paragraphs.push(text);
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed) {
      flushBuf();
      continue;
    }
    if (isSignoffLine(trimmed)) {
      flushBuf();
      continue;
    }
    if (URL_LINE_RE.test(trimmed)) {
      flushBuf();
      if (!cta) {
        const prev = (lines[i - 1] ?? "").trim();
        // Drop a CTA-hint line we already flushed into paragraphs.
        if (looksLikeCtaLabel(prev) && paragraphs.length > 0) {
          const last = paragraphs[paragraphs.length - 1] ?? "";
          if (looksLikeCtaLabel(last) || last === prev.replace(/[:.\s]+$/g, "").trim()) {
            paragraphs.pop();
          }
        }
        cta = { url: trimmed, label: ctaLabelForUrl(trimmed, prev) };
      }
      // Extra URL lines after the primary CTA are ignored in HTML (still in plain text).
      continue;
    }
    if (cta) {
      // Keep a short post-CTA note (e.g. “ignore if you didn’t ask”).
      afterNote = afterNote ? `${afterNote} ${trimmed}` : trimmed;
      continue;
    }
    if (looksLikeCtaLabel(trimmed) && URL_LINE_RE.test((lines[i + 1] ?? "").trim())) {
      // Label line before URL — used only for button text, not shown as a paragraph.
      continue;
    }
    buf.push(trimmed);
  }
  flushBuf();

  return { paragraphs, cta, afterNote };
}

function fontStack(): string {
  return "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
}

/**
 * Branded transactional HTML — one CTA button only, no duplicate “open link”.
 */
export function textToHtml(plain: string, opts?: { preheader?: string }): string {
  const { paragraphs, cta, afterNote } = parseEmailBody(plain);
  const font = fontStack();

  const bodyHtml = paragraphs
    .map((p, idx) => {
      // First line often greeting; reply/message previews get a quiet callout.
      const isCallout =
        idx > 0 &&
        p.length > 40 &&
        !/^hi\b/i.test(p) &&
        !/^we\b/i.test(p) &&
        !/^your\b/i.test(p) &&
        !/^support\b/i.test(p) &&
        !/^new\b/i.test(p) &&
        !/^category:/i.test(p) &&
        !/^from:/i.test(p) &&
        !/^subject:/i.test(p) &&
        !/^this link\b/i.test(p) &&
        !/^\+\d/.test(p) &&
        !/^new balance:/i.test(p);
      if (isCallout && paragraphs.length >= 3) {
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
          <tr>
            <td style="padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;border-left:3px solid #2563eb;font-family:${font};font-size:14px;line-height:1.55;color:#334155">
              ${escapeHtml(p)}
            </td>
          </tr>
        </table>`;
      }
      return `<p style="margin:0 0 14px;font-family:${font};font-size:15px;line-height:1.55;color:#0f172a">${escapeHtml(p)}</p>`;
    })
    .join("\n");

  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
        <tr>
          <td align="left" bgcolor="#1d4ed8" style="border-radius:8px;background-color:#1d4ed8">
            <a href="${escapeHtml(cta.url)}"
               style="display:inline-block;padding:13px 22px;font-family:${font};font-size:14px;font-weight:600;letter-spacing:0.01em;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px">
              ${escapeHtml(cta.label)}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const afterHtml = afterNote
    ? `<p style="margin:20px 0 0;font-family:${font};font-size:13px;line-height:1.5;color:#64748b">${escapeHtml(afterNote)}</p>`
    : "";

  const preheader = opts?.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent">${escapeHtml(opts.preheader)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>GetCarAPI</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9">
  ${preheader}
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
              ${bodyHtml}
              ${ctaHtml}
              ${afterHtml}
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
