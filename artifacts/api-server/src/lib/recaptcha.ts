import { loadBillingSettings } from "./credits";
import { CLIENT_PORTAL_CONTACT_EMAIL } from "./portalAccess";

export type RecaptchaVerifyResult =
  | { ok: true; score: number | null; skipped: boolean }
  | { ok: false; error: string };

/**
 * Verify Google reCAPTCHA v3 when enabled in admin settings.
 * When disabled, always succeeds (skipped).
 * Autofill-friendly: callers should obtain the token only on submit.
 */
export async function verifyRecaptchaV3(opts: {
  token: unknown;
  action?: string;
  remoteIp?: string | null;
}): Promise<RecaptchaVerifyResult> {
  const settings = await loadBillingSettings();
  if (!settings?.recaptchaEnabled) {
    return { ok: true, score: null, skipped: true };
  }

  const siteKey = settings.recaptchaSiteKey?.trim();
  const secret = settings.recaptchaSecretKey?.trim();
  if (!siteKey || !secret) {
    return { ok: false, error: "reCAPTCHA is enabled but keys are not configured" };
  }

  const token = typeof opts.token === "string" ? opts.token.trim() : "";
  if (!token) {
    return { ok: false, error: "reCAPTCHA verification required" };
  }

  const minScore = Math.min(1, Math.max(0, Number(settings.recaptchaMinScore ?? 0.5) || 0.5));

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);

  let data: { success?: boolean; score?: number; action?: string; "error-codes"?: string[] };
  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, error: "reCAPTCHA verification failed" };
  }

  if (!data.success) {
    const codes = data["error-codes"] ?? [];
    if (codes.includes("timeout-or-duplicate")) {
      return { ok: false, error: "reCAPTCHA expired — submit again" };
    }
    return { ok: false, error: "reCAPTCHA verification failed" };
  }

  if (opts.action && data.action && data.action !== opts.action) {
    return { ok: false, error: "reCAPTCHA action mismatch" };
  }

  const score = typeof data.score === "number" ? data.score : null;
  if (score != null && score < minScore) {
    return { ok: false, error: "reCAPTCHA score too low" };
  }

  return { ok: true, score, skipped: false };
}

/** Public captcha config for the client portal (never includes the secret). */
export async function publicCaptchaConfig() {
  const settings = await loadBillingSettings();
  const enabled = Boolean(settings?.recaptchaEnabled && settings.recaptchaSiteKey?.trim());
  return {
    enabled,
    siteKey: enabled ? settings!.recaptchaSiteKey!.trim() : null,
    registrationEnabled: settings?.registrationEnabled !== false,
    loginEnabled: settings?.clientLoginEnabled !== false,
    contactEmail: CLIENT_PORTAL_CONTACT_EMAIL,
  };
}
