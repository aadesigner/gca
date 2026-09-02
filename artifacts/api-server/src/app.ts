import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import docsRouter from "./routes/docs";
import { logger } from "./lib/logger";
import { sessionMiddleware, sessionCookieHostMiddleware } from "./lib/session";
import { csrfOriginCheck, isAllowedAdminOrigin } from "./middlewares/csrfOrigin";
import { securityHeaders } from "./middlewares/securityHeaders";
import { attachPublicSites } from "./lib/staticSite";
import { autowiniPhotoProxy } from "./middlewares/autowiniPhotoProxy";
import { redirectApiHostToSite } from "./lib/apiHost";
import { dbReady, sanitizeDbError } from "./lib/db-ready";
import { pool } from "@workspace/db";

const app: Express = express();

app.disable("x-powered-by");
app.use(securityHeaders);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// The admin dashboard and API server are served from the same Replit proxy
// domain — no cross-origin requests are needed in production. CORS headers
// are intentionally omitted; the browser's same-origin policy applies.
//
// For local development (running api-server on a different port than the
// frontend) you can set CORS_ORIGIN to the frontend URL. We avoid the
// permissive `origin: true` approach that was here before, as it reflects
// any Origin with credentials — a recognised CORS misconfiguration for
// privileged admin APIs.
if (process.env.CORS_ORIGIN) {
  const cors = (await import("cors")).default;
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN,
      credentials: true,
    }),
  );
} else if (process.env.NODE_ENV !== "production") {
  const cors = (await import("cors")).default;
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || isAllowedAdminOrigin(origin)) callback(null, true);
        else callback(null, false);
      },
      credentials: true,
    }),
  );
}

app.set("trust proxy", 1);

// api.getcarapi.com is a legacy alias — canonical host is getcarapi.com (/api/v1/…).
app.use(redirectApiHostToSite);

// Railway healthcheck must not depend on Postgres/session.
app.get("/api/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Operator diagnostic — no secrets, used to see why admin login 500s.
app.get("/api/healthz/db", async (_req, res) => {
  let ping: "ok" | "error" = "error";
  let pingError: string | null = null;
  try {
    await pool.query("SELECT 1");
    ping = "ok";
  } catch (err) {
    pingError = sanitizeDbError(err);
  }
  res.status(ping === "ok" && dbReady.migrations === "ok" ? 200 : 503).json({
    status: ping === "ok" && dbReady.migrations === "ok" ? "ok" : "error",
    ping,
    pingError,
    migrations: dbReady.migrations,
    attempt: dbReady.attempt,
    target: dbReady.target,
    adminSeeded: dbReady.adminSeeded,
    lastError: dbReady.lastError,
  });
});

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(sessionMiddleware);
app.use(sessionCookieHostMiddleware);

// Reject cross-origin state-changing requests that aren't from an allowed origin.
app.use(csrfOriginCheck);

// OpenAPI /docs — client or admin session required (see routes/docs.ts)
app.use(docsRouter);

app.use("/api", router);

// Autowini photos for admin live-feed sandbox (Vite dev has an equivalent plugin).
app.use(autowiniPhotoProxy);

attachPublicSites(app);

export default app;
