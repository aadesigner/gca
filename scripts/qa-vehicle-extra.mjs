#!/usr/bin/env node
/**
 * QA: vehicle extra vs events partition.
 * Run: node scripts/qa-vehicle-extra.mjs
 * Optional: DATABASE_URL=... node scripts/qa-vehicle-extra.mjs --db
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const apiServer = path.join(root, "artifacts", "api-server");

let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed++;
}

console.log("\n=== vehicle-extra unit tests ===");
const test = spawnSync(
  "pnpm",
  ["dlx", "tsx", "src/lib/__tests__/vehicle-extra.test.ts"],
  { cwd: apiServer, stdio: "inherit", shell: true },
);
if (test.status !== 0) {
  fail("unit tests failed");
  process.exit(1);
}
ok("unit tests passed");

if (process.argv.includes("--db")) {
  console.log("\n=== DB spot-check (keys not in timeline events) ===");
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
  const isKeysExtra = (event) => {
    const meta =
      typeof event.metadata === "string"
        ? (() => {
            try {
              return JSON.parse(event.metadata);
            } catch {
              return {};
            }
          })()
        : event.metadata ?? {};
    if (meta.field === "keys") return true;
    return /^keys available:/i.test(String(event.description ?? ""));
  };
  try {
    const { rows } = await pool.query(`
      SELECT v.vin, ve.event_type, ve.description, ve.metadata
      FROM vehicle_events ve
      JOIN vehicles v ON v.id = ve.vehicle_id
      WHERE ve.description ILIKE '%keys available%'
         OR ve.metadata::text ILIKE '%"field":"keys"%'
      LIMIT 5
    `);
    if (rows.length === 0) {
      console.log("  (no keys events in DB — skip live check)");
    } else {
      for (const row of rows) {
        const event = {
          eventType: row.event_type,
          description: row.description,
          metadata: row.metadata,
        };
        if (!isKeysExtra(event)) {
          fail(`${row.vin}: keys event not recognized as extra`);
        } else {
          ok(`${row.vin}: keys classified as extra spec`);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

console.log(failed ? `\n${failed} QA failure(s)` : "\nQA passed");
process.exit(failed ? 1 : 0);
