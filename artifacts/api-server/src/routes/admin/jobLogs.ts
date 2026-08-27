import { Router, type IRouter } from "express";
import { db, jobLogsTable, collectionJobsTable } from "@workspace/db";
import { eq, count, and, sql } from "drizzle-orm";
import {
  ListJobLogsQueryParams,
  ListJobLogsResponse,
  ListJobLogsParams,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";

const router: IRouter = Router();

// GET /api/admin/jobs/:id/logs
router.get("/admin/jobs/:id/logs", requireAdmin, async (req, res): Promise<void> => {
  const pathParams = ListJobLogsParams.safeParse(req.params);
  if (!pathParams.success) {
    res.status(400).json({ error: pathParams.error.message });
    return;
  }

  const queryParams = ListJobLogsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { id } = pathParams.data;
  const { limit = 100, offset = 0, level } = queryParams.data;

  // Verify job exists
  const [job] = await db
    .select({ id: collectionJobsTable.id })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.id, id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const conditions = [eq(jobLogsTable.jobId, id)];
  if (level) conditions.push(eq(jobLogsTable.level, level));
  const whereClause = and(...conditions);

  const [logs, [totalRow]] = await Promise.all([
    db
      .select()
      .from(jobLogsTable)
      .where(whereClause)
      .orderBy(sql`${jobLogsTable.occurredAt} ASC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(jobLogsTable).where(whereClause),
  ]);

  res.json(
    ListJobLogsResponse.parse({
      items: logs,
      total: Number(totalRow?.c ?? 0),
    }),
  );
});

export default router;
