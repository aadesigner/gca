/**
 * CLI entry point: pnpm --filter @workspace/db run migrate
 */
import { runMigrations } from "./migrate.js";

console.log("Running database migrations…");
await runMigrations();
console.log("Migrations complete.");
