---
name: DB-backed sessions setup
description: How express-session + connect-pg-simple is wired in this project. Required env vars and proxy trust setting.
---

# DB-Backed Session Setup

## The configuration
- `express-session` + `connect-pg-simple` store sessions in the `session` table (Drizzle schema: `lib/db/src/schema/sessions.ts`).
- The store uses the shared `pool` exported from `@workspace/db`.
- `SESSION_SECRET` environment variable must be set — the server throws on startup if missing.
- `app.set("trust proxy", 1)` is set in `artifacts/api-server/src/app.ts` so secure cookies work behind Replit's proxy layer.
- Session cookie: `httpOnly: true`, `sameSite: "lax"`, 7-day max age, `secure` only in production.

**Why:** Without `trust proxy: 1`, Express sees the request as non-HTTPS even behind TLS termination, so `secure: true` cookies are never sent back by the browser. Replit's preview proxy terminates TLS, so this setting is always required.

**How to apply:** Any new Express service that uses sessions must include `app.set("trust proxy", 1)` before the session middleware, and must have `SESSION_SECRET` in the environment secrets.
