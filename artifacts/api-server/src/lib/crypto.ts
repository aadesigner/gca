/**
 * AES-256-GCM encryption/decryption for provider credentials.
 *
 * The encryption key is derived from SESSION_SECRET via SHA-256 so that
 * no additional environment variable is required. Changing SESSION_SECRET
 * will invalidate all stored credentials.
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard IV length
const TAG_LENGTH = 16; // GCM auth tag length

function getDerivedKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set — cannot encrypt credentials");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a UTF-8 plaintext string.
 * Returns base64-encoded ciphertext (auth-tag prepended) and a base64 IV.
 */
export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store tag first so decrypt can slice it off deterministically
  const combined = Buffer.concat([tag, ciphertext]);
  return {
    encrypted: combined.toString("base64"),
    iv: iv.toString("base64"),
  };
}

/**
 * Decrypt a value produced by `encrypt()`.
 * Throws if the auth tag does not match (tampered or wrong key).
 */
export function decrypt(encryptedB64: string, ivB64: string): string {
  const key = getDerivedKey();
  const iv = Buffer.from(ivB64, "base64");
  const combined = Buffer.from(encryptedB64, "base64");
  const tag = combined.subarray(0, TAG_LENGTH);
  const ciphertext = combined.subarray(TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
