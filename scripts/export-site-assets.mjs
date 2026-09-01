/**
 * Export marketing site car photos + JSON from DB into artifacts/site/public/assets/.
 * Skips when DATABASE_URL is unset or unreachable at build time (Railway image build).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function skipReason() {
  if (process.env.SKIP_SITE_ASSET_EXPORT === "1" || process.env.SKIP_SITE_ASSET_EXPORT === "true") {
    return "SKIP_SITE_ASSET_EXPORT set";
  }
  if (process.env.EXPORT_SITE_ASSETS === "1" || process.env.EXPORT_SITE_ASSETS === "true") {
    return null;
  }

  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    return "DATABASE_URL not set";
  }

  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return "DATABASE_URL is not a valid URL";
  }

  // Railway injects DATABASE_URL during image build, but *.railway.internal only
  // resolves at runtime inside the deployed service network — not while building.
  if (host.endsWith(".railway.internal") || host === "postgres.railway.internal") {
    return "Railway internal DB host is not reachable during image build";
  }

  return null;
}

const skip = skipReason();
if (skip) {
  console.log(`export-site-assets: skipping — ${skip} (use committed artifacts/site/public/assets/*)`);
  process.exit(0);
}

const scripts = [
  "../../artifacts/api-server/scripts/export-site-cars.mjs",
  "../../artifacts/api-server/scripts/export-live-sample.mjs",
];

for (const rel of scripts) {
  console.log(`\n→ ${rel}`);
  const r = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "exec", "tsx", "--import", "../../scripts/load-env.mjs", rel],
    { cwd: root, stdio: "inherit", env: process.env, shell: true },
  );
  if (r.status !== 0) {
    console.error(`export-site-assets: ${rel} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

console.log("\nexport-site-assets: done");
