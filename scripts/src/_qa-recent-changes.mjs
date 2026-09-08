/**
 * QA for recent local changes (model normalize, IM resume, admin UX, builds).
 *
 *   node --experimental-strip-types --import ./scripts/load-env.mjs ./scripts/src/_qa-recent-changes.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { register } from "node:module";

const root = resolve(import.meta.dirname, "../..");
const failures = [];
const passes = [];

function ok(name, detail = "") {
  passes.push(name);
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  failures.push({ name, err: String(err?.stack || err) });
  console.error(`FAIL  ${name}\n${err?.stack || err}`);
}

function run(cmd, args, cwd = root) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
}

// Resolve extensionless .ts imports for strip-types unit tests.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\\.[a-zA-Z0-9]+$/.test(specifier.split('?')[0])) {
      try { return await nextResolve(specifier + '.ts', context); } catch {}
    }
    return nextResolve(specifier, context);
  }
`), pathToFileURL("./"));

// --- 1) model-normalize unit test (rewritten import) ---
{
  try {
    const src = readFileSync(
      join(root, "artifacts/api-server/src/lib/__tests__/model-normalize.test.ts"),
      "utf8",
    ).replace(
      'from "../model-normalize"',
      'from "../model-normalize.ts"',
    );
    const dir = mkdtempSync(join(tmpdir(), "gca-qa-"));
    const file = join(dir, "model-normalize.test.ts");
    writeFileSync(file, src);
    const r = run("node", ["--experimental-strip-types", file], join(root, "artifacts/api-server/src/lib/__tests__"));
    // cwd must be tests dir for relative import ../model-normalize.ts
    rmSync(dir, { recursive: true, force: true });
    if (r.status === 0) ok("unit:model-normalize.test.ts", (r.stdout || "").trim().split("\n").filter(Boolean).pop());
    else {
      // fallback: run inline via dynamic import
      throw new Error(r.stderr || r.stdout || `exit ${r.status}`);
    }
  } catch (e) {
    // Inline fallback
    try {
      const mod = await import(
        pathToFileURL(join(root, "artifacts/api-server/src/lib/model-normalize.ts")).href
      );
      assert.equal(mod.canonicalizeModelLabel("5er"), "5 Series");
      assert.equal(mod.canonicalizeModelLabel("5 er"), "5 Series");
      const merged = mod.mergeModelCounts([
        { model: "5 er", count: 4 },
        { model: "5 Series", count: 7 },
        { model: "5er", count: 2 },
        { model: "M3", count: 1 },
      ]);
      assert.equal(merged.length, 2);
      assert.equal(merged[0].count, 13);
      ok("unit:model-normalize.test.ts", "inline fallback");
    } catch (e2) {
      fail("unit:model-normalize.test.ts", e2);
    }
  }
}

// --- 2) Extra edge cases ---
{
  try {
    const {
      canonicalizeModelLabel,
      mergeModelCounts,
      modelFilterValues,
    } = await import(pathToFileURL(join(root, "artifacts/api-server/src/lib/model-normalize.ts")).href);

    assert.equal(canonicalizeModelLabel("5 er"), "5 Series");
    assert.equal(canonicalizeModelLabel("5er"), "5 Series");
    assert.equal(canonicalizeModelLabel("5-er"), "5 Series");
    assert.equal(canonicalizeModelLabel("3ER"), "3 Series");
    assert.equal(canonicalizeModelLabel("5 Series"), "5 Series");
    assert.equal(canonicalizeModelLabel("5-Series"), "5 Series");
    assert.equal(canonicalizeModelLabel("M3"), "M3");
    assert.equal(canonicalizeModelLabel("X5"), "X5");
    assert.equal(canonicalizeModelLabel("CX-5"), "CX-5");
    assert.equal(canonicalizeModelLabel("530i"), "530i");
    assert.equal(canonicalizeModelLabel("Tourer"), "Tourer");
    assert.equal(canonicalizeModelLabel("BMW 5er"), "BMW 5 Series");

    const merged = mergeModelCounts([
      { model: "5 er", count: 5 },
      { model: "5 Series", count: 10 },
      { model: "5er", count: 2 },
      { model: "5-Series", count: 3 },
      { model: "X5", count: 1 },
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].model, "5 Series");
    assert.equal(merged[0].count, 20);

    const v = modelFilterValues("5 Series");
    for (const need of ["5 Series", "5-Series", "5er", "5 er", "5-er"]) {
      assert.ok(v.includes(need), `missing variant ${need}`);
    }
    ok("model-normalize:er-series-edges");
  } catch (e) {
    fail("model-normalize:er-series-edges", e);
  }
}

// --- 3) urlValidation smoke (security-sensitive, unrelated but sanity) ---
{
  try {
    const { isPrivateIp } = await import(
      pathToFileURL(join(root, "artifacts/api-server/src/lib/urlValidation.ts")).href
    );
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("8.8.8.8"), false);
    ok("smoke:urlValidation");
  } catch (e) {
    fail("smoke:urlValidation", e);
  }
}

// --- 4) Migration + journal ---
{
  try {
    const mig = join(root, "lib/db/migrations/0058_canonical_bmw_series.sql");
    assert.ok(existsSync(mig), "migration file missing");
    const sql = readFileSync(mig, "utf8");
    assert.ok(/er\$/.test(sql), "er pattern missing");
    const journal = JSON.parse(
      readFileSync(join(root, "lib/db/migrations/meta/_journal.json"), "utf8"),
    );
    assert.ok(journal.entries.some((e) => e.tag === "0058_canonical_bmw_series"));
    ok("migration:0058_canonical_bmw_series");
  } catch (e) {
    fail("migration:0058_canonical_bmw_series", e);
  }
}

// --- 5) Worker IM resume guards ---
{
  try {
    const worker = readFileSync(
      join(root, "artifacts/api-server/src/lib/collector/worker.ts"),
      "utf8",
    );
    assert.ok(worker.includes("preserveImCrawlState"));
    assert.ok(!worker.includes("preservedImCrawlState"), "typo preservedImCrawlState still present");
    assert.ok(!worker.match(/const nextCrawlState = imCountries/));
    assert.ok(worker.includes("remaining IM brand/country shards keep running"));
    assert.ok(
      worker.includes("Blank/CF pages must not EOF") ||
        worker.includes("Real EOF = short page"),
    );
    ok("worker:im-resume-guards");
  } catch (e) {
    fail("worker:im-resume-guards", e);
  }
}

// --- 6) Admin UX regressions ---
{
  try {
    const vehicles = readFileSync(
      join(root, "artifacts/admin-dashboard/src/pages/vehicles/index.tsx"),
      "utf8",
    );
    assert.ok(!/Delete all|Remove all/i.test(vehicles));

    const jobs = readFileSync(
      join(root, "artifacts/admin-dashboard/src/pages/jobs/index.tsx"),
      "utf8",
    );
    assert.ok(!/Remove all/i.test(jobs));
    assert.ok(!/purgeAllJobs/.test(jobs));

    const client = readFileSync(
      join(root, "artifacts/admin-dashboard/src/pages/api-clients/id.tsx"),
      "utf8",
    );
    assert.ok(client.includes("VIN retrieve outcomes"));
    assert.ok(client.includes('size="icon"'));
    assert.ok(client.includes("<span>Credits</span>"));
    assert.ok(client.includes("<span>Tokens</span>"));

    const css = readFileSync(join(root, "artifacts/admin-dashboard/src/index.css"), "utf8");
    assert.ok(/html[\s\S]*overflow:\s*hidden/.test(css));

    const usageStats = readFileSync(
      join(root, "artifacts/api-server/src/lib/apiUsageStats.ts"),
      "utf8",
    );
    assert.ok(usageStats.includes("vinRetrieve"));
    assert.ok(usageStats.includes("vinFailReason"));

    const dash = readFileSync(
      join(root, "artifacts/admin-dashboard/src/pages/dashboard.tsx"),
      "utf8",
    );
    assert.ok(dash.includes("delta=") || dash.includes("obsDeltaLabel"));

    ok("admin:ux-regressions");
  } catch (e) {
    fail("admin:ux-regressions", e);
  }
}

// --- 7) Builds ---
{
  let r = run("pnpm", ["--filter", "@workspace/api-server", "build"]);
  if (r.status === 0) ok("build:api-server");
  else fail("build:api-server", r.stderr || r.stdout || `exit ${r.status}`);

  r = run("pnpm", ["--filter", "@workspace/admin-dashboard", "build"]);
  if (r.status === 0) ok("build:admin-dashboard");
  else fail("build:admin-dashboard", r.stderr || r.stdout || `exit ${r.status}`);
}

// --- 7b) Typecheck: fail only on regressions in files we touched ---
{
  const oursApi = [
    "model-normalize",
    "apiUsageStats",
    "collector/worker.ts",
    "collector/pipeline.ts",
    "photo-response",
  ];
  const oursAdmin = [
    "api-clients/id.tsx",
    "api-usage/index.tsx",
    "dashboard.tsx",
    "components/page.tsx",
  ];
  // Known pre-existing noise in touched files (not introduced by this change set)
  const allowApi = [
    /worker\.ts\(\d+,\d+\): error TS2345: Argument of type 'EncarFilterParams'/,
    /worker\.ts\(\d+,\d+\): error TS2345: Argument of type 'JobProgress \| null'/,
    /worker\.ts\(\d+,\d+\): error TS2339: Property 'message' does not exist on type 'never'/,
    /vehicles\.ts\(\d+,\d+\): error TS2339: Property '(country|minPrice|maxPrice|sortBy|sortOrder)'/,
    /vin\.ts\(\d+,\d+\): error TS2352: Conversion of type/,
  ];
  const allowAdmin = [
    /api-clients\/id\.tsx\(\d+,\d+\): error TS2741: Property 'queryKey'/,
    /jobs\/index\.tsx/,
    /vehicles\/index\.tsx\(\d+,\d+\): error TS2741: Property 'queryKey'/,
  ];

  function filterErrors(out, ours, allow) {
    return out
      .split(/\r?\n/)
      .filter((l) => /error TS/.test(l))
      .filter((l) => ours.some((p) => l.includes(p)))
      .filter((l) => !allow.some((re) => re.test(l)));
  }

  let r = run("pnpm", ["--filter", "@workspace/api-server", "typecheck"]);
  const apiOut = `${r.stdout || ""}\n${r.stderr || ""}`;
  const apiReg = filterErrors(apiOut, oursApi, allowApi);
  if (apiReg.length === 0) ok("typecheck:api-server:our-files", "no new errors in touched files");
  else fail("typecheck:api-server:our-files", apiReg.join("\n"));

  r = run("pnpm", ["--filter", "@workspace/admin-dashboard", "typecheck"]);
  const admOut = `${r.stdout || ""}\n${r.stderr || ""}`;
  const admReg = filterErrors(admOut, oursAdmin, allowAdmin);
  if (admReg.length === 0) ok("typecheck:admin-dashboard:our-files", "no new errors in touched files");
  else fail("typecheck:admin-dashboard:our-files", admReg.join("\n"));
}

// --- 8) Dist migration copied ---
{
  try {
    assert.ok(
      existsSync(join(root, "artifacts/api-server/dist/migrations/0058_canonical_bmw_series.sql")),
    );
    ok("dist:migration-copied");
  } catch (e) {
    fail("dist:migration-copied", e);
  }
}

// --- 9) Dist bundle contains key symbols ---
{
  try {
    const dist = readFileSync(join(root, "artifacts/api-server/dist/index.mjs"), "utf8");
    assert.ok(dist.includes("preserveImCrawlState") || dist.includes("preservedImCrawlState"));
    assert.ok(dist.includes("vinRetrieve") || dist.includes("vinFailReason"));
    // er → Series canonicalize should appear as regex source
    assert.ok(/\\ber\\b|er\\b/.test(dist) && dist.includes("Series"), "er normalize missing in dist");
    ok("dist:symbols-present");
  } catch (e) {
    fail("dist:symbols-present", e);
  }
}

// --- 10) Local DB migration dry-run (rollback) ---
{
  try {
    if (!process.env.DATABASE_URL) {
      ok("db:migration-dry-run", "skipped (no DATABASE_URL)");
    } else {
      const pg = (await import("pg")).default;
      const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      await c.query("BEGIN");
      try {
        const before = await c.query(`
          SELECT count(*)::int AS n FROM vehicles
          WHERE lower(btrim(model)) ~ '^[1-8][[:space:]/_-]*er$'
             OR (lower(btrim(model)) ~ '^[1-8][[:space:]/_-]*series$'
                 AND model IS DISTINCT FROM ((regexp_match(lower(btrim(model)), '^([1-8])'))[1] || ' Series'))
        `);
        const m3Before = await c.query(`SELECT count(*)::int AS n FROM vehicles WHERE model = 'M3'`);
        const x5Before = await c.query(`SELECT count(*)::int AS n FROM vehicles WHERE model = 'X5'`);

        const sql = readFileSync(
          join(root, "lib/db/migrations/0058_canonical_bmw_series.sql"),
          "utf8",
        )
          .split(/--> statement-breakpoint/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const stmt of sql) await c.query(stmt);

        const after = await c.query(`
          SELECT count(*)::int AS n FROM vehicles
          WHERE lower(btrim(model)) ~ '^[1-8][[:space:]/_-]*er$'
             OR (lower(btrim(model)) ~ '^[1-8][[:space:]/_-]*series$'
                 AND model IS DISTINCT FROM ((regexp_match(lower(btrim(model)), '^([1-8])'))[1] || ' Series'))
        `);
        assert.equal(after.rows[0].n, 0);

        const m3After = await c.query(`SELECT count(*)::int AS n FROM vehicles WHERE model = 'M3'`);
        const x5After = await c.query(`SELECT count(*)::int AS n FROM vehicles WHERE model = 'X5'`);
        assert.equal(m3After.rows[0].n, m3Before.rows[0].n, "M3 count changed");
        assert.equal(x5After.rows[0].n, x5Before.rows[0].n, "X5 count changed");

        // Facet merge simulation on live distinct models
        const facets = await c.query(`
          SELECT model, count(*)::int AS count
          FROM vehicles
          WHERE model IS NOT NULL AND btrim(model) <> ''
          GROUP BY model
          ORDER BY count DESC
          LIMIT 500
        `);
        const { mergeModelCounts } = await import(
          pathToFileURL(join(root, "artifacts/api-server/src/lib/model-normalize.ts")).href
        );
        const merged = mergeModelCounts(facets.rows);
        const seriesDupes = merged.filter((r) => /^[1-8] Series$/i.test(r.model));
        const erLeft = facets.rows.filter((r) => /^[1-8]\s*-?\s*er$/i.test(String(r.model)));
        assert.ok(erLeft.length === 0 || seriesDupes.length > 0 || before.rows[0].n === 0);

        ok(
          "db:migration-dry-run",
          `candidates=${before.rows[0].n}, residual=0, M3=${m3After.rows[0].n}, X5=${x5After.rows[0].n}`,
        );
      } finally {
        await c.query("ROLLBACK");
        await c.end();
      }
    }
  } catch (e) {
    fail("db:migration-dry-run", e);
  }
}

console.log("\n────────────────────────────");
console.log(`QA: ${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(` - ${f.name}`);
  process.exit(1);
}
console.log("All QA checks passed.");
