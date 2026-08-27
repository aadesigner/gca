/**
 * Cloudflare R2 (S3-compatible) client for photo mirroring.
 */
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicBaseUrl: string;
};

export function loadR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim()?.replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
  const endpoint =
    process.env.R2_ENDPOINT?.trim()?.replace(/\/+$/, "") ||
    `https://${accountId}.r2.cloudflarestorage.com`;
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint, publicBaseUrl };
}

export function isR2Configured(): boolean {
  return loadR2Config() != null;
}

let cached: S3Client | null = null;

export function getR2Client(): S3Client {
  const cfg = loadR2Config();
  if (!cfg) throw new Error("R2 is not configured (set R2_* env vars)");
  if (cached) return cached;
  cached = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return cached;
}

export function r2PublicUrl(objectKey: string): string {
  const cfg = loadR2Config();
  if (!cfg) throw new Error("R2 is not configured");
  const key = objectKey.replace(/^\/+/, "");
  return `${cfg.publicBaseUrl}/${key}`;
}

export async function r2PutObject(input: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  cacheControl?: string;
}): Promise<{ key: string; publicUrl: string }> {
  const cfg = loadR2Config();
  if (!cfg) throw new Error("R2 is not configured");
  const key = input.key.replace(/^\/+/, "");
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
      // 1y immutable — browsers + CF edge should cache forever (hash keys never change).
      CacheControl: input.cacheControl ?? "public, max-age=31536000, immutable, stale-while-revalidate=86400",
    }),
  );
  return { key, publicUrl: r2PublicUrl(key) };
}

export async function r2DeleteObject(key: string): Promise<void> {
  const cfg = loadR2Config();
  if (!cfg) throw new Error("R2 is not configured");
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: key.replace(/^\/+/, ""),
    }),
  );
}
