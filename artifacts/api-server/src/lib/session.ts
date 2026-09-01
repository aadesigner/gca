import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { sessionPool } from "@workspace/db";
import { publicSiteOrigin } from "./apiHost";

const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

/** Client portal default. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Admin /adminz/ session — refreshed while the dashboard is used. */
export const ADMIN_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

/** Share gcap.sid across apex + www in production (e.g. getcarapi.com and www.getcarapi.com). */
function sessionCookieDomain(): string | undefined {
  if (process.env.SESSION_COOKIE_DOMAIN?.trim()) {
    return process.env.SESSION_COOKIE_DOMAIN.trim();
  }
  if (process.env.NODE_ENV !== "production") return undefined;
  try {
    const host = new URL(publicSiteOrigin()).hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost")) return undefined;
    const parts = host.split(".").filter(Boolean);
    if (parts.length >= 2) return `.${parts.slice(-2).join(".")}`;
  } catch {
    /* ignore */
  }
  return undefined;
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
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: SESSION_MS,
    sameSite: "lax",
    path: "/",
    domain: sessionCookieDomain(),
  },
});
