/**
 * Mirror pending Autoplac (+ optional Import Motor) photos on PRODUCTION CDN.
 *
 *   node ./scripts/src/_ops-prod-mirror-synced-photos.mjs
 *   PROVIDERS=autoplac,import_motor BATCHES=20 LIMIT=400 node ./scripts/src/_ops-prod-mirror-synced-photos.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { config } from "dotenv";

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
const providers = (process.env.PROVIDERS || "autoplac,import_motor")
  .split(/[,+\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);
const limit = process.env.LIMIT || "400";
const concurrency = process.env.CONCURRENCY || "8";
const batches = Number(process.env.BATCHES || "15");
const cli = path.join(root, "artifacts/api-server/dist/cli/mirror-photos.mjs");

console.log("prod_db", new URL(prodUrl.replace(/^postgresql:/i, "http:")).host);
console.log("providers", providers);

async function oneBatch(provider) {
  const args = [
    "--provider",
    provider,
    "--limit",
    String(limit),
    "--concurrency",
    String(concurrency),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--enable-source-maps", cli, ...args], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: prodUrl,
        PGSSLMODE: "require",
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("exit", (code) => {
      console.log(out.trim().slice(-1800));
      let attempted = -1;
      try {
        const j = JSON.parse(out.slice(out.indexOf("{")));
        attempted = j.attempted ?? -1;
      } catch {
        /* ignore */
      }
      if (code && code !== 2) reject(new Error(`exit ${code}`));
      else resolve(attempted);
    });
  });
}

for (const provider of providers) {
  for (let i = 0; i < batches; i++) {
    console.log(`\n=== ${provider} batch ${i + 1}/${batches} ===`);
    const attempted = await oneBatch(provider);
    if (attempted === 0) {
      console.log(`${provider}: no more pending`);
      break;
    }
  }
}
