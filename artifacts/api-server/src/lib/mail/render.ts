export type TemplateVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

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

/** Wrap plain-text email body as simple HTML (escaped, preserve newlines, autolink URLs). */
export function textToHtml(plain: string): string {
  const escaped = escapeHtml(plain);
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb;word-break:break-all">$1</a>',
  );
  return `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.55;color:#111;max-width:560px;margin:0 auto;padding:24px">
<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${withLinks}</pre>
</body></html>`;
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
