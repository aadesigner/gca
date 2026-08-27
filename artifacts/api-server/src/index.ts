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
  // Bind the port before migrations so Railway healthchecks are not "unavailable".
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

  // Apply any pending database migrations (idempotent, safe on every restart).
  logger.info("Running database migrations…");
  try {
    await runMigrations();
    logger.info("Migrations complete.");

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

    await startWorker();
    logger.info("Collection job worker initialized.");

    startPhotoMirrorBackgroundWorker();

    void backfillEncarPricesFromRaw(pool)
      .then((stats) => {
        logger.info(stats, "Encar price backfill complete");
      })
      .catch((err) => {
        logger.error({ err }, "Encar price backfill failed");
      });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Bootstrap database step failed (site still serving): ${message}`);
    logger.error({ err, message }, "Bootstrap database step failed — keeping HTTP server up");
  }
}

bootstrap().catch((err) => {
  logger.error(
    { err, message: err instanceof Error ? err.message : String(err) },
    "Bootstrap failed — shutting down",
  );
  process.exit(1);
});
