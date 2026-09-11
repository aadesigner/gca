/**
 * Preferentially remirror Import Motor / Autoplac listings that already have
 * 1 CDN photo but more pending rows (common after local→prod sync).
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-mirror-partial-cdn.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: path.join(root, ".env"), override: true });

function loadProdUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const prodUrl = loadProdUrl();
process.env.DATABASE_URL = prodUrl;
process.env.NODE_ENV = "production";

const c = new pg.Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

const partial = await c.query(`
  SELECT l.vehicle_id, count(*) FILTER (WHERE ph.stored_path IS NULL)::int AS pending
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN photos ph ON ph.listing_id = l.id
  WHERE p.internal_name IN ('import_motor', 'autoplac')
    AND l.vehicle_id IS NOT NULL
  GROUP BY l.id, l.vehicle_id
  HAVING count(*) FILTER (WHERE ph.stored_path ~* 'imgsv|r2\\.dev') BETWEEN 1 AND 3
     AND count(*) FILTER (WHERE ph.stored_path IS NULL AND ph.source_url ILIKE 'http%') > 0
  ORDER BY pending DESC
  LIMIT 200
`);
console.log("partial_listings", partial.rows.length);
await c.end();

// Rebuild so EXISTS-based provider filter is available, then mirror by host in chunks.
const { spawnSync } = await import("node:child_process");
spawnSync("pnpm", ["--filter", "@workspace/api-server", "build"], { cwd: root, shell: true, stdio: "inherit" });

const cli = path.join(root, "artifacts/api-server/dist/cli/mirror-photos.mjs");
for (let i = 0; i < 8; i++) {
  console.log(`\n=== partial-priority IM host batch ${i + 1} ===`);
  const out = spawnSync(
    process.execPath,
    ["--enable-source-maps", cli, "--host", "import-motor", "--limit", "250", "--concurrency", "8"],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: prodUrl, NODE_ENV: "production", PGSSLMODE: "require" },
      encoding: "utf8",
    },
  );
  console.log((out.stdout || out.stderr || "").trim().slice(-1200));
  if (out.status && out.status !== 2) break;
  try {
    const j = JSON.parse((out.stdout || "").slice((out.stdout || "").indexOf("{")));
    if (!j.attempted) break;
  } catch {
    /* continue */
  }
}
