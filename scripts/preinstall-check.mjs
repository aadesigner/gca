import { rmSync } from "node:fs";

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  try {
    rmSync(lockfile);
  } catch {
    // ignore if missing
  }
}

const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.includes("pnpm")) {
  console.error("Use pnpm instead of npm/yarn for this project.");
  process.exit(1);
}
