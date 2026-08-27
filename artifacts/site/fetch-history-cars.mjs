/** DISABLED — never download Unsplash / stock imagery for the marketing site.
 *  Car photos must come from DB listings via:
 *    pnpm --filter @workspace/db exec tsx --import ../../scripts/load-env.mjs ../../artifacts/api-server/scripts/export-site-cars.mjs
 */
console.error("fetch-history-cars.mjs is disabled. Use export-site-cars.mjs (DB-only, no stock).");
process.exit(1);
