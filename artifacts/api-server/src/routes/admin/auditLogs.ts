import { Router, type IRouter } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { count, eq, and, gte, lte, sql } from "drizzle-orm";
import {
  ListAuditLogsQueryParams,
  ListAuditLogsResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";

const router: IRouter = Router();

// GET /api/admin/audit-logs
router.get("/admin/audit-logs", requireAdmin, async (req, res): Promise<void> => {
  const params = ListAuditLogsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { adminId, action, entityType, dateFrom, dateTo, limit = 50, offset = 0 } = params.data;

  const conditions: any[] = [];
  if (adminId) conditions.push(eq(auditLogsTable.adminId, adminId));
  if (action) conditions.push(eq(auditLogsTable.action, action));
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(auditLogsTable.createdAt, new Date(dateTo)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, [totalRow]] = await Promise.all([
    db
      .select()
      .from(auditLogsTable)
      .where(whereClause)
      .orderBy(sql`${auditLogsTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(auditLogsTable).where(whereClause),
  ]);

  res.json(
    ListAuditLogsResponse.parse({
      items: logs,
      total: Number(totalRow?.c ?? 0),
    }),
  );
});

export default router;
