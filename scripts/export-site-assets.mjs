/**
 * Export marketing site car photos + JSON from DB into artifacts/site/public/assets/.
 * Skips when DATABASE_URL is unset (Railway build without DB — relies on committed assets).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.DATABASE_URL?.trim()) {
  console.log("export-site-assets: DATABASE_URL not set — skipping (use committed /assets/cars/*)");
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
