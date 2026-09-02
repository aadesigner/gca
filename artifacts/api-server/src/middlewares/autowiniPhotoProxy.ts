/**
 * Same-origin proxy for Autowini listing photos.
 * imagebox.autowini.com blocks browser Referers from our dashboard; this fetches
 * server-side with the correct Referer and serves from /media/autowini*.
 */
import type { Request, Response, NextFunction } from "express";
import { autowiniFetchBinary, isAutowiniPhotoUrl } from "../lib/providers/autowini-http";

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

  try {
    const { status, contentType, body } = await autowiniFetchBinary(target);
    if (status !== 200 || !contentType.toLowerCase().startsWith("image/")) {
      res.status(502).json({ error: "Upstream media unavailable" });
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "HEAD") {
      res.setHeader("Content-Length", String(body.length));
      res.status(200).end();
      return;
    }
    res.send(body);
  } catch {
    res.status(502).json({ error: "Failed to load media" });
  }
}
