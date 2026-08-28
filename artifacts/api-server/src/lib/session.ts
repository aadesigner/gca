import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { pool } from "@workspace/db";

const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

/** Client portal default. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Admin /adminz/ session — refreshed while the dashboard is used. */
export const ADMIN_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

export const sessionMiddleware = session({
  name: "gcap.sid",
  store: new PgSession({
    pool,
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
  },
});
