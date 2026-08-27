import { Router, type IRouter } from "express";
import { db, providersTable, listingsTable, vehiclesTable, collectionJobsTable } from "@workspace/db";
import { eq, count, sql, and } from "drizzle-orm";
import {
  ListProvidersResponse,
  CreateProviderBody,
  CreateProviderResponse,
  GetProviderParams,
  GetProviderResponse,
  UpdateProviderParams,
  UpdateProviderBody,
  UpdateProviderResponse,
  DeleteProviderParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";

const router: IRouter = Router();

// GET /api/admin/providers
router.get("/admin/providers", requireAdmin, async (req, res): Promise<void> => {
  const includeDisabled = String(req.query.includeDisabled ?? "") === "1";
  const providers = includeDisabled
    ? await db.select().from(providersTable).orderBy(providersTable.name)
    : await db
        .select()
        .from(providersTable)
        .where(eq(providersTable.enabled, true))
        .orderBy(providersTable.name);
  res.json(ListProvidersResponse.parse(providers));
});

// POST /api/admin/providers
router.post("/admin/providers", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [provider] = await db.insert(providersTable).values(parsed.data).returning();

  await writeAuditLog({
    req,
    action: "provider.create",
    entityType: "provider",
    entityId: provider!.id,
    details: { name: provider!.name },
  });

  res.status(201).json(CreateProviderResponse.parse(provider));
});

// GET /api/admin/providers/:id
router.get("/admin/providers/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = GetProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, params.data.id));

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  // Gather stats
  const [[listingRow], [activeJobRow], [failedJobRow], lastSuccessRows] = await Promise.all([
    db.select({ c: count() }).from(listingsTable).where(eq(listingsTable.providerId, provider.id)),
    db.select({ c: count() }).from(collectionJobsTable).where(
      and(eq(collectionJobsTable.providerId, provider.id), eq(collectionJobsTable.status, "running"))
    ),
    db.select({ c: count() }).from(collectionJobsTable).where(
      and(eq(collectionJobsTable.providerId, provider.id), eq(collectionJobsTable.status, "failed"))
    ),
    db.select({ completedAt: collectionJobsTable.completedAt })
      .from(collectionJobsTable)
      .where(and(eq(collectionJobsTable.providerId, provider.id), eq(collectionJobsTable.status, "completed")))
      .orderBy(sql`${collectionJobsTable.completedAt} DESC NULLS LAST`)
      .limit(1),
  ]);

  // Count distinct VINs from listings
  const [vinRow] = await db
    .select({ c: sql<number>`COUNT(DISTINCT ${listingsTable.vin})` })
    .from(listingsTable)
    .where(eq(listingsTable.providerId, provider.id));

  res.json(
    GetProviderResponse.parse({
      ...provider,
      stats: {
        totalListings: Number(listingRow?.c ?? 0),
        totalVins: Number(vinRow?.c ?? 0),
        activeJobs: Number(activeJobRow?.c ?? 0),
        failedJobs: Number(failedJobRow?.c ?? 0),
        lastSuccessfulCollection: lastSuccessRows[0]?.completedAt ?? null,
      },
    }),
  );
});

// PUT /api/admin/providers/:id
router.put("/admin/providers/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [provider] = await db
    .update(providersTable)
    .set(parsed.data)
    .where(eq(providersTable.id, params.data.id))
    .returning();

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "provider.update",
    entityType: "provider",
    entityId: provider.id,
    details: parsed.data,
  });

  res.json(UpdateProviderResponse.parse(provider));
});

// DELETE /api/admin/providers/:id
router.delete("/admin/providers/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [provider] = await db
    .delete(providersTable)
    .where(eq(providersTable.id, params.data.id))
    .returning();

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "provider.delete",
    entityType: "provider",
    entityId: provider.id,
    details: { name: provider.name },
  });

  res.sendStatus(204);
});

/** Rebuild Import Motor Chrome CDP tab pool to IMPORT_MOTOR_CDP_TABS (default 10). */
router.post("/admin/import-motor/cdp-heal", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { healImportMotorCdpPool } = await import("../../lib/providers/import-motor-cdp");
    const result = await healImportMotorCdpPool();
    await writeAuditLog({
      req,
      action: "import_motor.cdp_heal",
      entityType: "provider",
      entityId: null,
      details: result,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
