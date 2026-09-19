/**
 * Same-origin proxy for Autowini listing photos — currently disabled (410).
 * Kept so /media/autowini* paths resolve instead of falling through.
 */
import type { Request, Response, NextFunction } from "express";
import { isAutowiniPhotoUrl } from "../lib/providers/autowini-http";

const PREFIX = "/media/autowini";
const PREFIX_IMG = "/media/autowini-img";

function targetFromPath(pathname: string, search: string): string | null {
  if (!pathname.startsWith(`${PREFIX}/`) && !pathname.startsWith(`${PREFIX_IMG}/`)) return null;

  if (pathname.startsWith(`${PREFIX_IMG}/`)) {
    const rest = pathname.slice(PREFIX_IMG.length);
    if (!rest.startsWith("/") || rest.includes("..") || rest.includes("//")) return null;
    try {
      const parsed = new URL(`https://image.autowini.com${rest}${search}`);
      if (!isAutowiniPhotoUrl(parsed.toString())) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  const rest = pathname.slice(PREFIX.length);
  if (!rest.startsWith("/upload/") || rest.includes("..") || rest.includes("//")) return null;
  try {
    const parsed = new URL(`https://imagebox.autowini.com${rest}${search}`);
    if (!isAutowiniPhotoUrl(parsed.toString())) return null;
    if (!parsed.pathname.startsWith("/upload/")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function autowiniPhotoProxy(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    next();
    return;
  }

  const target = targetFromPath(req.path, req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  if (!target) {
    next();
    return;
  }

  // Autowini is disabled from public API / media — do not proxy upstream.
  res.status(410).json({ error: "Autowini media disabled" });
}
