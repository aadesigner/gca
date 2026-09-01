/**
 * Client OpenAPI / Swagger (login required)
 *
 * GET /docs                  — Swagger UI (client or admin session)
 * GET /api/v1/openapi.json   — OpenAPI 3.1 spec (same session gate)
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";
import { applyBillingToPublicSpec, toPublicOpenApiSpec } from "../lib/publicOpenApi";
import { loadBillingSettings, parseCreditPriceUsd, parseMinCryptoDepositUsd } from "../lib/credits";

const router: IRouter = Router();

let cachedBaseSpec: object | null = null;

async function loadPublicSpecBase(): Promise<object> {
  if (cachedBaseSpec) return cachedBaseSpec;

  const specPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "openapi.yaml");
  const raw = await readFile(specPath, "utf-8");
  cachedBaseSpec = toPublicOpenApiSpec(yamlLoad(raw) as Record<string, unknown>);
  return cachedBaseSpec;
}

async function loadPublicSpecWithBilling(): Promise<object> {
  const base = await loadPublicSpecBase();
  const settings = await loadBillingSettings();
  return applyBillingToPublicSpec(base as Record<string, unknown>, {
    creditPriceUsd: parseCreditPriceUsd(settings?.creditPriceUsd),
    minCryptoDepositUsd: parseMinCryptoDepositUsd(settings?.minCryptoDepositUsd),
  });
}

function hasDocsSession(req: Request): boolean {
  return Boolean(req.session?.clientId || req.session?.adminId);
}

function requireDocsSession(req: Request, res: Response, next: NextFunction): void {
  if (hasDocsSession(req)) {
    next();
    return;
  }

  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");

  const accept = String(req.headers.accept ?? "");
  const wantsHtml = req.path === "/docs" || accept.includes("text/html");
  if (wantsHtml) {
    res.redirect(302, `/account/?next=${encodeURIComponent("/docs")}`);
    return;
  }

  res.status(401).json({
    error: "Login required",
    login: "/account/?next=/docs",
  });
}

router.get("/v1/openapi.json", requireDocsSession, async (_req, res): Promise<void> => {
  try {
    const spec = await loadPublicSpecWithBilling();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    res.json(spec);
  } catch {
    res.status(500).json({ error: "Failed to load API spec" });
  }
});

router.get("/docs", requireDocsSession, async (_req, res): Promise<void> => {
  const settings = await loadBillingSettings();
  const creditPriceUsd = parseCreditPriceUsd(settings?.creditPriceUsd);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>GetCarAPI — API reference</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #f4f6f9; }
    .swagger-ui .topbar { display: none; }
    .docs-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
      padding: .75rem 1.25rem; background: #0b1220; color: #e8eef8; font: 14px/1.4 system-ui, sans-serif;
    }
    .docs-bar a { color: #93c5fd; text-decoration: none; }
    .docs-bar a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="docs-bar">
    <span>GetCarAPI OpenAPI — $${creditPriceUsd} per VIN retrieve (1 credit on HTTP 200)</span>
    <span><a href="/api/">Overview</a> · <a href="/account/">Client area</a></span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: window.location.origin + "/api/v1/openapi.json",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: "BaseLayout",
        deepLinking: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        docExpansion: "list",
        defaultModelsExpandDepth: 1,
      });
    };
  </script>
</body>
</html>`);
  return Promise.resolve();
});

export default router;
