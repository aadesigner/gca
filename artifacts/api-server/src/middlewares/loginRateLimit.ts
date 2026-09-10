import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

const hits = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  return first?.split(",")[0]?.trim() || req.ip || "unknown";
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function pruneIfStale(key: string, now: number): Bucket | undefined {
  const current = hits.get(key);
  if (!current) return undefined;
  if (current.resetAt < now) {
    hits.delete(key);
    return undefined;
  }
  return current;
}

export function createAuthRateLimit(opts: {
  maxAttempts: number;
  windowMs: number;
  /** Extra key material (e.g. normalized email) to limit per-target abuse. */
  extraKey?: (req: Request) => string | null | undefined;
  errorMessage: string;
}) {
  return function authRateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const extras = [opts.extraKey?.(req)].filter(Boolean) as string[];
    const keys = [`${req.path}:ip:${clientIp(req)}`, ...extras.map((e) => `${req.path}:x:${e}`)];

    for (const key of keys) {
      let current = pruneIfStale(key, now);
      if (!current) {
        hits.set(key, { count: 1, resetAt: now + opts.windowMs });
        continue;
      }
      current.count += 1;
      if (current.count > opts.maxAttempts) {
        res.status(429).json({ error: opts.errorMessage });
        return;
      }
    }
    next();
  };
}

/** Login / register / reset — 8 attempts / 15 minutes per IP. */
export const loginRateLimit = createAuthRateLimit({
  maxAttempts: 8,
  windowMs: 15 * 60 * 1000,
  errorMessage: "Too many attempts. Try again in 15 minutes.",
});

/**
 * Forgot-password — stricter, and also keyed by email so one inbox cannot be flooded
 * from rotating IPs as easily (still generic API response).
 */
export const forgotPasswordRateLimit = createAuthRateLimit({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  extraKey: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email.includes("@") ? email : null;
  },
  errorMessage: "Too many password reset requests. Try again in 15 minutes.",
});

// Keep helper available for tests / future paths.
export function _rateLimitClientKeyForTests(req: Request): string {
  return firstHeader(req.headers["x-forwarded-for"])?.split(",")[0]?.trim() || req.ip || "unknown";
}
