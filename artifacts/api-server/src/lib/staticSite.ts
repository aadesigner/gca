import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Express, Request, Response } from "express";
import express from "express";
import { logger } from "./logger";

const here = path.dirname(fileURLToPath(import.meta.url));

function firstExisting(...dirs: string[]): string | null {
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (fs.existsSync(path.join(resolved, "index.html"))) return resolved;
  }
  return null;
}

function resolveSiteDir(): string | null {
  // Prefer the live marketing build over a stale dist/ copy from the last api-server build.
  return firstExisting(
    path.join(process.cwd(), "artifacts/site/public"),
    path.resolve(process.cwd(), "../site/public"),
    path.resolve(here, "../../../site/public"),
    path.resolve(here, "../site"),
    path.join(here, "site"),
  );
}

function isImmutableAsset(filePath: string): boolean {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  if (!lower.includes("/assets/")) return false;
  // Query-busted CSS/JS + static media — safe to cache long; HTML stays short-cache.
  return (
    lower.endsWith(".css") ||
    lower.endsWith(".js") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".woff2") ||
    lower.endsWith(".ico")
  );
}

export function attachPublicSites(app: Express): void {
  const siteDir = resolveSiteDir();
  const adminDir = firstExisting(
    path.join(process.cwd(), "artifacts/admin-dashboard/dist/public"),
    path.join(here, "admin"),
    path.resolve(here, "../../../admin-dashboard/dist/public"),
  );

  if (adminDir) {
    app.use(
      "/adminz",
      express.static(adminDir, {
        index: "index.html",
        setHeaders(res) {
          res.setHeader("X-Robots-Tag", "noindex, nofollow");
          res.setHeader("Cache-Control", "no-store");
        },
      }),
    );
    app.get(/^\/adminz(?:\/.*)?$/, (_req: Request, res: Response) => {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.sendFile(path.join(adminDir, "index.html"));
    });
  }

  if (siteDir) {
    logger.info({ siteDir }, "Serving marketing site");
    const legacyRedirects: Array<[RegExp, string]> = [
      [/^\/auction-history\/?$/, "/car-history/"],
      [/^\/korea-cars(?:\/(?:encar|autowini))?\/?$/, "/car-history/south-korea/"],
      [/^\/usa-cars\/?$/, "/car-history/usa/"],
      [/^\/canada-cars\/?$/, "/car-history/canada/"],
      [/^\/live-stock\/?$/, "/live-feed-korean-cars/"],
      [/^\/live-stock\/encar\/?$/, "/live-feed-korean-cars/encar"],
      [/^\/live-stock\/autowini\/?$/, "/live-feed-korean-cars/autowini"],
      [/^\/live-stock\/kbchachacha\/?$/, "/live-feed-korean-cars/kbchachacha"],
    ];
    app.use((req: Request, res: Response, next) => {
      for (const [pattern, target] of legacyRedirects) {
        if (pattern.test(req.path)) return res.redirect(301, target);
      }
      next();
    });

    app.use((req: Request, res: Response, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        res.setHeader("X-Site-Root", path.basename(path.dirname(siteDir)));
        const stampPath = path.join(siteDir, "assets", "build-stamp.txt");
        try {
          if (fs.existsSync(stampPath)) {
            res.setHeader("X-Site-Build", fs.readFileSync(stampPath, "utf8").trim());
          }
        } catch {
          /* ignore */
        }
      }
      next();
    });

    app.use(
      express.static(siteDir, {
        index: "index.html",
        extensions: ["html"],
        etag: true,
        lastModified: true,
        maxAge: 0,
        setHeaders(res, filePath) {
          const lower = filePath.toLowerCase().replace(/\\/g, "/");
          if (filePath.includes(`${path.sep}account${path.sep}`)) {
            res.setHeader("X-Robots-Tag", "noindex, nofollow");
            res.setHeader("Cache-Control", "no-store");
            return;
          }
          if (isImmutableAsset(filePath)) {
            // Long cache for static assets (CSS/JS already query-busted).
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            return;
          }
          if (lower.endsWith(".html") || lower.endsWith(".xml") || lower.endsWith("robots.txt")) {
            res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
            return;
          }
          res.setHeader("Cache-Control", "public, max-age=3600");
        },
      }),
    );
  } else {
    logger.warn("Marketing site directory not found");
  }
}
