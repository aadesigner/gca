/**
 * Bidscan condition must come from the main lot — never Similar Lots cards.
 * Run: node --import ./scripts/load-env.mjs --experimental-strip-types …
 * Or compile via pnpm. This file is a quick node check with dynamic import after build.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// Inline minimal check by re-implementing via fetching live HTML + importing TS via tsx if available.
const vin = "5XYPH4A57GG162866";
const html = await (
  await fetch(`https://bidscan.vin/cars/${vin}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(25_000),
  })
).text();
writeFileSync(new URL("./_tmp-bidscan-sample.html", import.meta.url), html);

// Dynamic import of compiled? Use cheerio + copy of strip logic for smoke test, then call parse via tsx path.
const { pathToFileURL } = await import("node:url");
const { spawnSync } = await import("node:child_process");
const script = `
import { parseBidscanDetail, stripBidscanRelatedCarsHtml, extractBidscanCondition } from "./artifacts/api-server/src/lib/providers/bidscan-parse.ts";
import { load } from "cheerio";
import { readFileSync } from "fs";
const html = readFileSync(new URL("./scripts/src/_tmp-bidscan-sample.html", import.meta.url), "utf8");
const stripped = stripBidscanRelatedCarsHtml(html);
if (stripped.includes("Similar Lots")) throw new Error("strip failed");
const listing = parseBidscanDetail(html, "https://bidscan.vin/cars/${vin}");
const accident = (listing.events||[]).find(e => e.eventType === "accident" || e.eventType === "flood_damage");
const cond = accident?.metadata && typeof accident.metadata === "object" ? accident.metadata.condition : undefined;
console.log(JSON.stringify({ condition: cond, primary: accident?.description, title: listing.title }, null, 2));
if (String(cond||"").toUpperCase().includes("RUN")) {
  console.error("FAIL: still got RUN AND DRIVE from similar lots");
  process.exit(1);
}
if (String(cond||"").toUpperCase() !== "ENHANCED VEHICLES") {
  console.error("FAIL: expected ENHANCED VEHICLES, got", cond);
  process.exit(1);
}
console.log("PASS");
`;
writeFileSync(new URL("./_tmp-bidscan-assert.mts", import.meta.url), script);
const r = spawnSync(
  process.execPath,
  ["--import", "tsx", new URL("./_tmp-bidscan-assert.mts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  { cwd: new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), encoding: "utf8", env: process.env },
);
console.log(r.stdout);
console.error(r.stderr);
process.exit(r.status ?? 1);
