import type { Request, Response, NextFunction } from "express";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { sessionPool } from "@workspace/db";
import { publicSiteOrigin, requestHostname } from "./apiHost";

const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

/** Client portal — stay signed in on /account/ until logout (rolling refresh). */
export const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
/** Admin /adminz/ session — refreshed while the dashboard is used. */
export const ADMIN_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Cookie domain for apex + www on the public site (e.g. getcarapi.com + www).
 * Returns undefined for localhost, Railway preview URLs, etc. — host-only cookie.
 */
export function sessionCookieDomainForHost(hostHeader: string | undefined): string | undefined {
  if (process.env.SESSION_COOKIE_DOMAIN?.trim()) {
    return process.env.SESSION_COOKIE_DOMAIN.trim();
  }
  if (process.env.NODE_ENV !== "production") return undefined;

  const host = (hostHeader ?? "").toLowerCase().split(":")[0] ?? "";
  if (!host || host === "localhost" || host.endsWith(".localhost")) return undefined;

  let publicHost: string;
  try {
    publicHost = new URL(publicSiteOrigin()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!publicHost || publicHost === "localhost") return undefined;

  const onPublicSite = host === publicHost || host.endsWith(`.${publicHost}`);
  if (!onPublicSite) return undefined;

  const parts = publicHost.split(".").filter(Boolean);
  if (parts.length >= 2) return `.${parts.slice(-2).join(".")}`;
  return undefined;
}

/** Per-request cookie domain — avoids rejecting cookies on non-canonical hosts. */
export function sessionCookieHostMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.session) {
    const domain = sessionCookieDomainForHost(requestHostname(req));
    if (domain) req.session.cookie.domain = domain;
    else delete req.session.cookie.domain;
  }
  next();
}

export const sessionMiddleware = session({
  name: "gcap.sid",
  store: new PgSession({
    pool: sessionPool,
    tableName: "session",
    createTableIfMissing: true,
    ttl: Math.ceil(Math.max(SESSION_MS, ADMIN_SESSION_MS) / 1000),
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: process.env.NODE_ENV === "production",
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: SESSION_MS,
    sameSite: "lax",
    path: "/",
  },
});

export function noStoreAuth(res: Response): void {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
}
