/**
 * Resolve collection job ids by provider + job type (prod ids differ from local seeds).
 */
import { db, pool, collectionJobsTable, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fleetJobConfig, runAtNow } from "./crawl-schedule";
import { logger } from "./logger";
import { effectiveImJobId, importMotorCrawlAllowed } from "./import-motor-env";

function envJobId(name: string, fallback = 0): number {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export const ENV_ENCAR_FULL_JOB_ID = envJobId("ENCAR_JOB_ID");
export const ENV_ENCAR_REFRESH_JOB_ID = envJobId("ENCAR_REFRESH_JOB_ID");

export async function resolveProviderJobId(
  internalName: string,
  jobType: string,
  envOverride = 0,
): Promise<number | null> {
  const [provider] = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.internalName, internalName))
    .limit(1);
  if (!provider) return null;

  if (envOverride > 0) {
    const [job] = await db
      .select({
        id: collectionJobsTable.id,
        providerId: collectionJobsTable.providerId,
        jobType: collectionJobsTable.jobType,
      })
      .from(collectionJobsTable)
      .where(eq(collectionJobsTable.id, envOverride))
      .limit(1);
    if (job?.providerId === provider.id && job.jobType === jobType) {
      return envOverride;
    }
    if (job) {
      logger.warn(
        { envOverride, internalName, jobType, actualType: job.jobType, actualProvider: job.providerId },
        "Ignoring env job id — wrong provider or job type; resolving from database",
      );
    }
  }

  const { rows } = await pool.query<{ id: number }>(
    `
    SELECT id FROM collection_jobs
    WHERE provider_id = $1 AND job_type = $2
    ORDER BY items_processed DESC NULLS LAST, updated_at DESC
    LIMIT 1
    `,
    [provider.id, jobType],
  );
  if (rows[0]?.id) return rows[0].id;

  const cfg = fleetJobConfig(internalName, jobType);
  const [created] = await db
    .insert(collectionJobsTable)
    .values({
      providerId: provider.id,
      jobType,
      status: "pending",
      jobConfig: JSON.stringify({ ...cfg, nextRunAt: runAtNow() }),
    })
    .returning({ id: collectionJobsTable.id });

  if (created) {
    logger.info({ jobId: created.id, internalName, jobType }, "Created fleet collection job");
  }
  return created?.id ?? null;
}

export async function resolveEncarFleetJobIds(): Promise<{ full: number | null; refresh: number | null }> {
  const [full, refresh] = await Promise.all([
    resolveProviderJobId("encar", "full_collection", ENV_ENCAR_FULL_JOB_ID),
    resolveProviderJobId("encar", "listing_refresh", ENV_ENCAR_REFRESH_JOB_ID),
  ]);
  return { full, refresh };
}

export async function resolvePinnedFleetJobIds(): Promise<number[]> {
  const ids: number[] = [];
  const imId = effectiveImJobId();
  if (imId > 0 && importMotorCrawlAllowed()) ids.push(imId);
  const encar = await resolveEncarFleetJobIds();
  if (encar.full) ids.push(encar.full);
  if (encar.refresh) ids.push(encar.refresh);
  return ids.filter((id) => Number.isFinite(id) && id > 0);
}
