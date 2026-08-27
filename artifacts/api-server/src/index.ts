import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db/migrate";
import { db, pool, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startWorker } from "./lib/collector/worker";
import { startPhotoMirrorBackgroundWorker } from "./lib/photo-mirror";
import { backfillEncarPricesFromRaw } from "./lib/collector/backfill-encar-prices";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function bootstrap() {
  // 1. Apply any pending database migrations (idempotent, safe on every restart).
  logger.info("Running database migrations…");
  await runMigrations();
  logger.info("Migrations complete.");

  // 2. Ensure the settings singleton row exists.
  //    This is safe to run on every boot — it only inserts if the row is missing.
  const existing = await db
    .select({ id: settingsTable.id })
    .from(settingsTable)
    .where(eq(settingsTable.id, 1));

  if (existing.length === 0) {
    await db.insert(settingsTable).values({
      id: 1,
      maxCollectionJobsParallel: 10_000,
      vinExtractionEnabled: true,
      photoStorageEnabled: false,
      rawDataRetentionDays: 30,
      defaultMaxPages: 200,
      defaultMaxListings: 5000,
      defaultDelayMs: 800,
    });
    logger.info("Created default settings row.");
  }

  // 3. Start the background collection job worker.
  await startWorker();
  logger.info("Collection job worker initialized.");

  // 4. Auto-mirror new photos to Cloudflare R2 (same as offline mirror-photos loop).
  startPhotoMirrorBackgroundWorker();

  // 5. Start listening on all interfaces (Railway healthchecks use IPv4).
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "Server listening");
      resolve();
    });
    server.on("error", (err) => {
      logger.error({ err }, "Error listening on port");
      reject(err);
    });
  });

  // 5. Restore Encar asks that the old dummy-price filter dropped.
  void backfillEncarPricesFromRaw(pool)
    .then((stats) => {
      logger.info(stats, "Encar price backfill complete");
    })
    .catch((err) => {
      logger.error({ err }, "Encar price backfill failed");
    });
}

bootstrap().catch((err) => {
  logger.error({ err }, "Bootstrap failed — shutting down");
  process.exit(1);
});
