import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountPage, pages, renderPage, LIVE_FEED } from "./pages.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "public");
const adminFavicon = path.join(root, "../admin-dashboard/public/favicon.svg");

function write(rel, content) {
  const full = path.join(out, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

for (const page of pages) {
  write(page.file, renderPage(page));
}

write(
  "robots.txt",
  `User-agent: *
Allow: /
Disallow: /account/
Disallow: /adminz/
Disallow: /api/admin
Disallow: /api/client

Sitemap: https://getcarapi.com/sitemap.xml
`,
);

const urls = pages.map((p) => p.path);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
    .map(
      (loc) => `  <url><loc>https://getcarapi.com${loc}</loc><lastmod>2026-08-22</lastmod><changefreq>weekly</changefreq><priority>${loc === "/" ? "1.0" : loc.includes("live") || loc.includes("car-history") ? "0.9" : "0.8"}</priority></url>`,
    )
    .join("\n")}
</urlset>
`,
);

fs.copyFileSync(adminFavicon, path.join(out, "favicon.svg"));
write("account/index.html", accountPage());

for (const dir of ["auction-history", "korea-cars", "usa-cars", "canada-cars", "live-stock"]) {
  const stale = path.join(out, dir);
  if (fs.existsSync(stale)) fs.rmSync(stale, { recursive: true, force: true });
}

const liveRedirects = [
  ["/live-stock/", LIVE_FEED],
  ["/live-stock/encar", `${LIVE_FEED}encar`],
  ["/live-stock/autowini", `${LIVE_FEED}autowini`],
  ["/live-stock/kbchachacha", `${LIVE_FEED}kbchachacha`],
];
for (const [from, to] of liveRedirects) {
  const rel = from.replace(/^\//, "").replace(/\/$/, "");
  const file = rel.endsWith(".html") ? rel : `${rel}/index.html`;
  write(
    file,
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><link rel="canonical" href="https://getcarapi.com${to}"><title>Redirecting…</title></head><body><p>Moved to <a href="${to}">${to}</a>.</p></body></html>`,
  );
}

console.log(`Wrote ${pages.length} marketing pages + account`);
