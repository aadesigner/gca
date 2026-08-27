/**
 * CLI: mirror photos from source_url → Cloudflare R2.
 *
 *   pnpm --filter @workspace/api-server mirror-photos -- --host import-motor --limit 50
 */
import { mirrorPhotos } from "../lib/photo-mirror";
import { isR2Configured } from "../lib/r2";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  if (!isR2Configured()) {
    console.error("R2 not configured. Set R2_* in .env");
    process.exit(1);
  }

  const host = arg("host");
  const hostLike =
    host === "import-motor" || host === "im"
      ? "%import-motor.com%"
      : host
        ? `%${host}%`
        : arg("like");
  const providerArg = arg("provider");
  const providerInternalNames = providerArg
    ? providerArg.split(/[,+\s]+/).map((s) => s.trim()).filter(Boolean)
    : undefined;

  const result = await mirrorPhotos({
    limit: Number(arg("limit") ?? 100),
    concurrency: Number(arg("concurrency") ?? 6),
    hostLike,
    providerInternalNames,
    primariesFirst: !flag("no-primary-first"),
    dryRun: flag("dry-run"),
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        errors: result.errors.slice(0, 15),
        errorCount: result.errors.length,
      },
      null,
      2,
    ),
  );

  if (result.failed > 0 && result.uploaded === 0 && result.reused === 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
