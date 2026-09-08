/**
 * QA for Korean live-feed filter fixes (5er ↔ 5 Series, Encar mapping, KRW price).
 *   node --experimental-strip-types --import ./scripts/load-env.mjs ./scripts/src/_qa-live-feed-kr.mjs
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";

const root = resolve(import.meta.dirname, "../..");
register(
  "data:text/javascript," +
    encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\\.[a-zA-Z0-9]+$/.test(specifier.split('?')[0])) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    }
    return nextResolve(specifier, context);
  }
`),
  pathToFileURL("./"),
);

const fails = [];
const pass = (n, d = "") => console.log(`PASS  ${n}${d ? ` — ${d}` : ""}`);
const fail = (n, e) => {
  fails.push(n);
  console.error(`FAIL  ${n}\n${e?.stack || e}`);
};

const catalog = await import(
  pathToFileURL(join(root, "artifacts/api-server/src/lib/providers/encar-catalog.ts")).href
);

try {
  assert.equal(catalog.encarSearchModelGroup("5er"), "5시리즈");
  assert.equal(catalog.encarSearchModelGroup("5 er"), "5시리즈");
  assert.equal(catalog.encarSearchModelGroup("5-Series"), "5시리즈");
  assert.equal(catalog.encarSearchModelGroup("5 Series"), "5시리즈");
  assert.equal(catalog.encarSearchModelGroup("C-Class"), "C-클래스");
  assert.equal(catalog.encarSearchModelGroup("C Class"), "C-클래스");
  assert.equal(catalog.encarSearchModelGroup("X5"), "X5");
  assert.equal(catalog.encarSearchModelGroup("M3"), "M3");
  pass("encarSearchModelGroup:er-series");
} catch (e) {
  fail("encarSearchModelGroup:er-series", e);
}

try {
  const p1 = catalog.parseEncarLiveSearch("BMW 5er Seoul");
  assert.equal(p1.make, "BMW");
  assert.equal(p1.modelGroup, "5 Series");
  const p2 = catalog.parseEncarLiveSearch("5-Series");
  assert.equal(p2.modelGroup, "5 Series");
  const p3 = catalog.parseEncarLiveSearch("3 er");
  assert.equal(p3.modelGroup, "3 Series");
  pass("parseEncarLiveSearch:er-series");
} catch (e) {
  fail("parseEncarLiveSearch:er-series", e);
}

try {
  // mapLiveFiltersToEncar wires canonicalize → encarSearchModelGroup
  const bridgeSrc = readFileSync(
    join(root, "artifacts/api-server/src/lib/providers/encar-live-bridge.ts"),
    "utf8",
  );
  assert.ok(bridgeSrc.includes("canonicalizeModelLabel"));
  assert.ok(bridgeSrc.includes("looksLikeModelGroup"));
  assert.ok(bridgeSrc.includes("fieldMatchesModel") || bridgeSrc.includes("modelFilterValues"));
  assert.equal(catalog.encarSearchModelGroup("5er"), "5시리즈");
  pass("mapLiveFiltersToEncar:wired");
} catch (e) {
  fail("mapLiveFiltersToEncar:wired", e);
}

try {
  const combined = readFileSync(join(root, "artifacts/api-server/src/lib/liveCombined.ts"), "utf8");
  assert.ok(combined.includes("modelMatchesVehicle"));
  assert.ok(combined.includes("modelFilterValues"));
  assert.ok(combined.includes("Honest total") || combined.includes("filtered.length"));
  pass("combined:model-match+total");
} catch (e) {
  fail("combined:model-match+total", e);
}

try {
  const price = readFileSync(
    join(root, "artifacts/admin-dashboard/src/components/price-display.tsx"),
    "utf8",
  );
  assert.ok(price.includes("never promote EUR as primary") || /isKrw\s*\n\s*\? formatKrw/.test(price) || price.includes("const nativeText = isKrw"));
  assert.ok(price.includes("formatKrw(amount)"));
  // Primary line for KRW must not be EUR-first inside PriceDisplay body
  const body = price.slice(price.indexOf("export function PriceDisplay"));
  assert.ok(!body.includes("${eurText} (${formatKrw"));
  pass("price-display:krw-primary");
} catch (e) {
  fail("price-display:krw-primary", e);
}

try {
  const caps = readFileSync(
    join(root, "artifacts/api-server/src/lib/providers/encarLive.ts"),
    "utf8",
  );
  const m = caps.match(/supportedFilters:\s*\[([\s\S]*?)\]/);
  assert.ok(m);
  assert.ok(!m[1].includes("drivetrain"));
  assert.ok(!m[1].includes("bodyType"));
  assert.ok(!/"color"/.test(m[1]));
  pass("encar:capabilities-no-noop-filters");
} catch (e) {
  fail("encar:capabilities-no-noop-filters", e);
}

try {
  const browse = readFileSync(join(root, "artifacts/api-server/src/lib/liveBrowse.ts"), "utf8");
  assert.ok(browse.includes("_omit"));
  const bridgeSrc = readFileSync(
    join(root, "artifacts/api-server/src/lib/providers/encar-live-bridge.ts"),
    "utf8",
  );
  assert.ok(bridgeSrc.includes(".slice(0, 2)"));
  const ui = readFileSync(
    join(root, "artifacts/admin-dashboard/src/pages/live-feeds/test.tsx"),
    "utf8",
  );
  assert.ok(ui.includes("canonicalizeLiveModelLabel"));
  assert.ok(ui.includes('show("engineMin")'));
  pass("perf+ui:payload-and-canonicalize");
} catch (e) {
  fail("perf+ui:payload-and-canonicalize", e);
}

const build = spawnSync("pnpm", ["--filter", "@workspace/api-server", "build"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  maxBuffer: 20 * 1024 * 1024,
});
if (build.status === 0) pass("build:api-server");
else fail("build:api-server", build.stderr || build.stdout);

const buildAdm = spawnSync("pnpm", ["--filter", "@workspace/admin-dashboard", "build"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  maxBuffer: 20 * 1024 * 1024,
});
if (buildAdm.status === 0) pass("build:admin-dashboard");
else fail("build:admin-dashboard", buildAdm.stderr || buildAdm.stdout);

console.log("\n────────────────────────────");
console.log(`QA live-feed KR: ${fails.length ? "FAILED" : "OK"} (${fails.length} failed)`);
if (fails.length) process.exit(1);
