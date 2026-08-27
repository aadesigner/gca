/**
 * Loads the workspace root `.env` before any app/script starts.
 * Use: node --import ./scripts/load-env.mjs …
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env"), override: true });
