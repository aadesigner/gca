import crypto from "crypto";

const REVEAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const PLAIN_PREFIX = "u8:";

function revealKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET || process.env.APP_SECRET;
  if (!secret) return null;
  return crypto.createHash("sha256").update(`gca-token-reveal:${secret}`).digest();
}

/** Encrypt / encode a raw API token for temporary one-time portal delivery. */
export function encryptPendingReveal(rawToken: string): { blob: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + REVEAL_TTL_MS);
  const key = revealKey();
  if (key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(rawToken, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = `v1:${Buffer.concat([iv, tag, enc]).toString("base64url")}`;
    return { blob, expiresAt };
  }
  // Fallback when no session secret (scripts / misconfig) — still cleared after ack/use.
  return { blob: `${PLAIN_PREFIX}${Buffer.from(rawToken, "utf8").toString("base64url")}`, expiresAt };
}

/** Decrypt a pending reveal blob, or null if corrupt/invalid. */
export function decryptPendingReveal(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    if (blob.startsWith(PLAIN_PREFIX)) {
      return Buffer.from(blob.slice(PLAIN_PREFIX.length), "base64url").toString("utf8");
    }
    if (blob.startsWith("v1:")) {
      const key = revealKey();
      if (!key) return null;
      const buf = Buffer.from(blob.slice(3), "base64url");
      if (buf.length < 12 + 16 + 1) return null;
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    }
    // Legacy: raw base64url AES blob without version prefix
    const key = revealKey();
    if (!key) return null;
    const buf = Buffer.from(blob, "base64url");
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function pendingRevealStillValid(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() > Date.now();
}
