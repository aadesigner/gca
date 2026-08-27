import type { Request, Response, NextFunction } from "express";

/** Extra headers for token-authenticated JSON API responses. */
export function apiResponseHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}
