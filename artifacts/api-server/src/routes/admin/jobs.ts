import { Router, type IRouter } from "express";
import { db, collectionJobsTable, providersTable, systemEventsTable } from "@workspace/db";
import { eq, count, and, sql, inArray } from "drizzle-orm";
import {
  ListJobsQueryParams,
  ListJobsResponse,
  CreateJobBody,
  CreateJobResponse,
  GetJobParams,
  GetJobResponse,
  CancelJobParams,
  CancelJobResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import { parseJobConfigFilters, streamListingCsv } from "../../lib/listing-export";
import { HISTORICAL_ADAPTER_NAMES, mergeCrawlDefaults } from "../../lib/crawl-profiles";

const router: IRouter = Router();

// GET /api/admin/jobs
router.get("/admin/jobs", requireAdmin, async (req, res): Promise<void> => {
  const params = ListJobsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { status, providerId, limit: rawLimit = 50, offset = 0 } = params.data;
  const limit = Math.min(100, Math.max(1, Number(rawLimit) || 50));

  const conditions = [];
  if (status) conditions.push(eq(collectionJobsTable.status, status));
  if (providerId) conditions.push(eq(collectionJobsTable.providerId, providerId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [jobs, [totalRow]] = await Promise.all([
    db
      .select({
        id: collectionJobsTable.id,
        providerId: collectionJobsTable.providerId,
        providerName: providersTable.name,
        status: collectionJobsTable.status,
        jobType: collectionJobsTable.jobType,
        jobConfig: collectionJobsTable.jobConfig,
        itemsDiscovered: collectionJobsTable.itemsDiscovered,
        itemsProcessed: collectionJobsTable.itemsProcessed,
        itemsFailed: collectionJobsTable.itemsFailed,
        pagesProcessed: collectionJobsTable.pagesProcessed,
        listingsFetched: collectionJobsTable.listingsFetched,
        vinsFound: collectionJobsTable.vinsFound,
        vinsNew: collectionJobsTable.vinsNew,
        newObservations: collectionJobsTable.newObservations,
        duplicatesSkipped: collectionJobsTable.duplicatesSkipped,
        // Truncate huge crawl JSON on list; full state still on GET /jobs/:id
        crawlState: sql<string | null>`CASE
          WHEN ${collectionJobsTable.crawlState} IS NULL THEN NULL
          WHEN length(${collectionJobsTable.crawlState}) <= 8000 THEN ${collectionJobsTable.crawlState}
          ELSE left(${collectionJobsTable.crawlState}, 8000)
        END`,
        errorMessage: collectionJobsTable.errorMessage,
        startedAt: collectionJobsTable.startedAt,
        completedAt: collectionJobsTable.completedAt,
        createdAt: collectionJobsTable.createdAt,
        updatedAt: collectionJobsTable.updatedAt,
      })
      .from(collectionJobsTable)
      .leftJoin(providersTable, eq(collectionJobsTable.providerId, providersTable.id))
      .where(whereClause)
      .orderBy(sql`${collectionJobsTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(collectionJobsTable).where(whereClause),
  ]);

  res.json(
    ListJobsResponse.parse({
      items: jobs,
      total: Number(totalRow?.c ?? 0),
    }),
  );
});

// POST /api/admin/jobs
router.post("/admin/jobs", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, parsed.data.providerId));

  if (!provider) {
    res.status(400).json({ error: "Provider not found" });
    return;
  }

  if (!HISTORICAL_ADAPTER_NAMES.has(provider.internalName)) {
    res.status(400).json({
      error: `No historical adapter for '${provider.internalName}'. Known adapters: ${[...HISTORICAL_ADAPTER_NAMES].join(", ")}`,
    });
    return;
  }

  // Keep extra crawl fields (carType, detailLevel, skipRecentHours, ...) that
  // the generated CreateJobBody schema does not list.
  const rawFilters = (req.body as { filterParams?: unknown } | undefined)?.filterParams;
  const merged = mergeCrawlDefaults(
    provider.internalName,
    rawFilters && typeof rawFilters === "object" ? (rawFilters as Record<string, unknown>) : parsed.data.filterParams,
    parsed.data.jobType,
  );
  const jobConfig = Object.keys(merged).length > 0 ? JSON.stringify(merged) : undefined;

  const [job] = await db
    .insert(collectionJobsTable)
    .values({
      providerId: parsed.data.providerId,
      jobType: parsed.data.jobType,
      targetUrl: parsed.data.targetUrl ?? null,
      jobConfig: jobConfig ?? null,
      status: "pending",
    })
    .returning();

  await writeAuditLog({
    req,
    action: "job.create",
    entityType: "collection_job",
    entityId: job!.id,
    details: { providerId: parsed.data.providerId, jobType: parsed.data.jobType },
  });

  res.status(201).json(
    CreateJobResponse.parse({ ...job, providerName: provider.name }),
  );
});

// DELETE /api/admin/jobs/purge — remove all jobs (optional ?status= filter)
router.delete("/admin/jobs/purge", requireAdmin, async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const jobRows = status
    ? await db
        .select({ id: collectionJobsTable.id })
        .from(collectionJobsTable)
        .where(eq(collectionJobsTable.status, status))
    : await db.select({ id: collectionJobsTable.id }).from(collectionJobsTable);

  const jobIds = jobRows.map((r) => r.id);
  if (jobIds.length === 0) {
    res.json({ deleted: 0 });
    return;
  }

  await db
    .update(systemEventsTable)
    .set({ jobId: null })
    .where(inArray(systemEventsTable.jobId, jobIds));

  const deleted = await db
    .delete(collectionJobsTable)
    .where(inArray(collectionJobsTable.id, jobIds))
    .returning({ id: collectionJobsTable.id });

  await writeAuditLog({
    req,
    action: "job.purge_all",
    entityType: "collection_job",
    details: { deleted: deleted.length, status: status ?? "all" },
  });

  res.json({ deleted: deleted.length });
});

// DELETE /api/admin/jobs/:id/purge — permanently remove a job record
router.delete("/admin/jobs/:id/purge", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const [existing] = await db
    .select({ id: collectionJobsTable.id, status: collectionJobsTable.status })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (existing.status === "running") {
    res.status(409).json({ error: "Cancel a running job before deleting it" });
    return;
  }

  await db.update(systemEventsTable).set({ jobId: null }).where(eq(systemEventsTable.jobId, id));

  await db.delete(collectionJobsTable).where(eq(collectionJobsTable.id, id));

  await writeAuditLog({
    req,
    action: "job.purge",
    entityType: "collection_job",
    entityId: id,
  });

  res.status(204).send();
});

// POST /api/admin/jobs/:id/pause
router.post("/admin/jobs/:id/pause", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const [job] = await db
    .update(collectionJobsTable)
    .set({ status: "paused" })
    .where(
      and(
        eq(collectionJobsTable.id, id),
        inArray(collectionJobsTable.status, ["running", "pending"]),
      ),
    )
    .returning();

  if (!job) {
    const [existing] = await db
      .select({ id: collectionJobsTable.id, status: collectionJobsTable.status })
      .from(collectionJobsTable)
      .where(eq(collectionJobsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.status(409).json({ error: `Cannot pause a ${existing.status} job` });
    return;
  }

  await writeAuditLog({
    req,
    action: "job.pause",
    entityType: "collection_job",
    entityId: job.id,
  });

  res.json({ ...job, providerName: null });
});

const RESUMABLE = ["failed", "cancelled", "paused", "completed"] as const;

// POST /api/admin/jobs/:id/resume — continue from last page (optional config edit)
router.post("/admin/jobs/:id/resume", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const [existing] = await db
    .select()
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.id, id));

  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!RESUMABLE.includes(existing.status as (typeof RESUMABLE)[number])) {
    res.status(409).json({ error: `Cannot continue a ${existing.status} job` });
    return;
  }

  const body = (req.body ?? {}) as {
    filterParams?: unknown;
    jobType?: string;
    targetUrl?: string | null;
    resetProgress?: boolean;
  };

  const [resumeProvider] = await db
    .select({ internalName: providersTable.internalName })
    .from(providersTable)
    .where(eq(providersTable.id, existing.providerId));

  const updates: Partial<typeof collectionJobsTable.$inferInsert> = {
    status: "pending",
    completedAt: null,
    errorMessage: null,
  };

  if (existing.jobConfig) {
    try {
      const parsed = JSON.parse(existing.jobConfig) as { nextRunAt?: string };
      if (parsed.nextRunAt) {
        delete parsed.nextRunAt;
        updates.jobConfig = JSON.stringify(parsed);
      }
    } catch {
      // keep existing jobConfig
    }
  }

  if (body.filterParams && typeof body.filterParams === "object") {
    const jobType = body.jobType ?? existing.jobType;
    updates.jobConfig = JSON.stringify(
      mergeCrawlDefaults(
        resumeProvider?.internalName ?? "",
        body.filterParams as Record<string, unknown>,
        jobType,
      ),
    );
    if (body.resetProgress) {
      updates.crawlState = null;
    } else if (existing.crawlState) {
      try {
        const state = JSON.parse(existing.crawlState) as {
          shards?: Array<{ filters?: Record<string, unknown> }>;
        };
        if (Array.isArray(state.shards)) {
          const nextFilters = body.filterParams as Record<string, unknown>;
          for (const shard of state.shards) {
            shard.filters = { ...(shard.filters ?? {}), ...nextFilters };
          }
          updates.crawlState = JSON.stringify(state);
        }
      } catch {
        // keep existing crawlState
      }
    }
  }
  if (body.jobType === "full_collection" || body.jobType === "incremental" || body.jobType === "single_listing" || body.jobType === "listing_refresh") {
    updates.jobType = body.jobType;
  }
  if (body.targetUrl !== undefined) {
    updates.targetUrl = body.targetUrl;
  }
  if (body.resetProgress) {
    updates.pagesProcessed = 0;
    updates.listingsFetched = 0;
    updates.itemsDiscovered = 0;
    updates.itemsProcessed = 0;
    updates.itemsFailed = 0;
    updates.vinsFound = 0;
    updates.vinsNew = 0;
    updates.newObservations = 0;
    updates.duplicatesSkipped = 0;
    updates.startedAt = null;
    updates.crawlState = null;
  }

  const [job] = await db
    .update(collectionJobsTable)
    .set(updates)
    .where(eq(collectionJobsTable.id, id))
    .returning();

  await writeAuditLog({
    req,
    action: "job.resume",
    entityType: "collection_job",
    entityId: id,
    details: {
      resetProgress: Boolean(body.resetProgress),
      fromPage: body.resetProgress ? 1 : (existing.pagesProcessed ?? 0) + 1,
    },
  });

  const [provider] = await db
    .select({ name: providersTable.name })
    .from(providersTable)
    .where(eq(providersTable.id, job!.providerId));

  res.json({ ...job, providerName: provider?.name ?? null });
});

// GET /api/admin/jobs/:id/export — CSV of VINs/listings for this job's site
router.get("/admin/jobs/:id/export", requireAdmin, async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [job] = await db
    .select({
      id: collectionJobsTable.id,
      providerId: collectionJobsTable.providerId,
      jobConfig: collectionJobsTable.jobConfig,
      providerName: providersTable.internalName,
    })
    .from(collectionJobsTable)
    .leftJoin(providersTable, eq(collectionJobsTable.providerId, providersTable.id))
    .where(eq(collectionJobsTable.id, params.data.id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const unfiltered = req.query.unfiltered === "1" || req.query.unfiltered === "true";
  const filters = unfiltered ? {} : parseJobConfigFilters(job.jobConfig);
  const slug = (job.providerName ?? `provider-${job.providerId}`).replace(/[^\w.-]+/g, "-");
  await streamListingCsv(
    res,
    { ...filters, providerId: job.providerId },
    `job-${job.id}-${slug}-vins.csv`,
  );
});

router.get("/admin/jobs/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [job] = await db
    .select({
      id: collectionJobsTable.id,
      providerId: collectionJobsTable.providerId,
      providerName: providersTable.name,
      status: collectionJobsTable.status,
      jobType: collectionJobsTable.jobType,
      jobConfig: collectionJobsTable.jobConfig,
      itemsDiscovered: collectionJobsTable.itemsDiscovered,
      itemsProcessed: collectionJobsTable.itemsProcessed,
      itemsFailed: collectionJobsTable.itemsFailed,
      pagesProcessed: collectionJobsTable.pagesProcessed,
      listingsFetched: collectionJobsTable.listingsFetched,
      vinsFound: collectionJobsTable.vinsFound,
      vinsNew: collectionJobsTable.vinsNew,
      newObservations: collectionJobsTable.newObservations,
      duplicatesSkipped: collectionJobsTable.duplicatesSkipped,
      crawlState: collectionJobsTable.crawlState,
      errorMessage: collectionJobsTable.errorMessage,
      startedAt: collectionJobsTable.startedAt,
      completedAt: collectionJobsTable.completedAt,
      createdAt: collectionJobsTable.createdAt,
      updatedAt: collectionJobsTable.updatedAt,
    })
    .from(collectionJobsTable)
    .leftJoin(providersTable, eq(collectionJobsTable.providerId, providersTable.id))
    .where(eq(collectionJobsTable.id, params.data.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(GetJobResponse.parse(job));
});

// DELETE /api/admin/jobs/:id  (cancel)
router.delete("/admin/jobs/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = CancelJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: collectionJobsTable.id, status: collectionJobsTable.status })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!["pending", "running", "paused"].includes(existing.status)) {
    res.status(409).json({ error: `Cannot cancel a ${existing.status} job` });
    return;
  }

  const [job] = await db
    .update(collectionJobsTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(collectionJobsTable.id, params.data.id))
    .returning();

  await writeAuditLog({
    req,
    action: "job.cancel",
    entityType: "collection_job",
    entityId: job!.id,
  });

  const [provider] = await db
    .select({ name: providersTable.name })
    .from(providersTable)
    .where(eq(providersTable.id, job!.providerId));

  res.json(CancelJobResponse.parse({ ...job!, providerName: provider?.name ?? null }));
});

export default router;
