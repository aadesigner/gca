import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_BYTES = 4 * 1024 * 1024;

function proofRoot(): string {
  const dir = process.env.CREDIT_PROOF_DIR?.trim() || path.join(process.cwd(), "data", "credit-proofs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sniffImage(buf: Buffer): "jpg" | "png" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  return null;
}

/** Decode a client proof upload (data URL or raw base64). JPEG/PNG only. */
export function decodeProofImage(raw: string): { buf: Buffer; ext: "jpg" | "png" } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 6_000_000) throw new Error("Invalid proof image");

  let b64 = trimmed;
  const dataUrl = trimmed.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/i);
  if (dataUrl) b64 = dataUrl[2]!;

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) throw new Error("Invalid proof encoding");

  const buf = Buffer.from(b64.replace(/\s/g, ""), "base64");
  if (buf.byteLength < 200 || buf.byteLength > MAX_BYTES) {
    throw new Error("Proof image must be between 200 bytes and 4 MB");
  }

  const ext = sniffImage(buf);
  if (!ext) throw new Error("Only JPEG or PNG payment screenshots are accepted");

  return { buf, ext };
}

export function savePurchaseProof(purchaseId: number, raw: string): string {
  const { buf, ext } = decodeProofImage(raw);
  const name = `purchase-${purchaseId}-${randomBytes(8).toString("hex")}.${ext}`;
  const abs = path.join(proofRoot(), name);
  fs.writeFileSync(abs, buf, { mode: 0o600 });
  return name;
}

export function resolveProofPath(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const base = path.basename(stored.replace(/\\/g, "/"));
  if (base !== stored || base.includes("..")) return null;
  const abs = path.join(proofRoot(), base);
  if (!fs.existsSync(abs)) return null;
  return abs;
}
