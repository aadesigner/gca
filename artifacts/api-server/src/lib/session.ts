import type { Request, Response, NextFunction } from "express";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { sessionPool } from "@workspace/db";

const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

/** Client portal — stay signed in on /account/ until logout (rolling refresh). */
export const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
/** Admin /adminz/ session — refreshed while the dashboard is used. */
export const ADMIN_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

/** Host-only session cookies unless SESSION_COOKIE_DOMAIN is explicitly set in env. */
export function sessionCookieHostMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.session) {
    const explicit = process.env.SESSION_COOKIE_DOMAIN?.trim();
    if (explicit) req.session.cookie.domain = explicit;
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

/** Drop legacy Domain=.getcarapi.com cookies that block host-only session cookies in some browsers. */
export function clearLegacySessionCookies(res: Response): void {
  const base = {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };
  res.clearCookie("gcap.sid", { ...base, domain: ".getcarapi.com" });
  res.clearCookie("gcap.sid", base);
}
