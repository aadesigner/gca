/**
 * Mirror BidExport pending photos on PRODUCTION.
 * Loads .env for R2, then forces DATABASE_URL to Railway (load-env override cannot win).
 *
 *   node ./scripts/src/_ops-prod-mirror-bidexport.mjs
 *   BATCHES=12 LIMIT=400 node ./scripts/src/_ops-prod-mirror-bidexport.mjs
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
process.env.DATABASE_URL = prodUrl;
process.env.PGSSLMODE = "require";
console.log("prod_db", new URL(prodUrl.replace(/^postgresql:/i, "http:")).host);
console.log("r2", Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET));

const limit = process.env.LIMIT || "400";
const concurrency = process.env.CONCURRENCY || "8";
const batches = Number(process.env.BATCHES || "10");
const cli = path.join(root, "artifacts/api-server/dist/cli/mirror-photos.mjs");

async function oneBatch() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--enable-source-maps",
        cli,
        "--provider",
        "bidexport",
        "--limit",
        String(limit),
        "--concurrency",
        String(concurrency),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          DATABASE_URL: prodUrl,
          PGSSLMODE: "require",
          // pgSsl() only relaxes Railway certs when NODE_ENV=production
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("exit", (code) => {
      console.log(out.trim().slice(-2200));
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

const probe =
  "https://vis.iaai.com/resizer?imageKeys=45418890%7ESID%7EB514%7ES0%7EI119%7ERW2576%7EH1932%7ETH0&width=845&height=633";
try {
  const res = await fetch(probe, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://www.iaai.com/",
    },
    signal: AbortSignal.timeout(20000),
  });
  console.log("probe_iaai", res.status, res.headers.get("content-type"));
} catch (e) {
  console.log("probe_iaai_err", e instanceof Error ? e.message : e);
}

for (let i = 0; i < batches; i++) {
  console.log(`\n=== batch ${i + 1}/${batches} ===`);
  const attempted = await oneBatch();
  if (attempted === 0) {
    console.log("done — no pending BidExport photos");
    break;
  }
}
