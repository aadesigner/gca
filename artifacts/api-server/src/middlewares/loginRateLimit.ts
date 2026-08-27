import type { Request, Response, NextFunction } from "express";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const hits = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  return firstHeader(req.headers["x-forwarded-for"])?.split(",")[0]?.trim() || req.ip || "unknown";
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = `${req.path}:${clientKey(req)}`;
  const now = Date.now();
  const current = hits.get(key);
  if (!current || current.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }
  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
    return;
  }
  next();
}
