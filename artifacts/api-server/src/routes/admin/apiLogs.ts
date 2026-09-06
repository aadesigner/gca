import { Router, type IRouter } from "express";
import { db, apiRequestLogsTable, apiClientsTable } from "@workspace/db";
import { count, desc, eq } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/auth";
import {
  buildLogFilterSql,
  parseUsageFilters,
  parseUsageRange,
} from "../../lib/apiUsageStats";

const router: IRouter = Router();

// GET /api/admin/api-logs — advanced filters (client, path, status, vin, range, token)
router.get("/admin/api-logs", requireAdmin, async (req, res): Promise<void> => {
  const q = req.query as Record<string, unknown>;
  const limitRaw = Number(q.limit);
  const offsetRaw = Number(q.offset);
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50));
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0);

  const hasRange = q.from != null || q.to != null || q.days != null;
  const range = parseUsageRange({
    days: q.days ?? 7,
    from: q.from,
    to: q.to,
  });
  const filters = parseUsageFilters(q);
  const whereClause = buildLogFilterSql(filters, {
    since: hasRange ? range.since : new Date(Date.now() - 7 * 86_400_000),
    until: range.until,
  });

  const [logs, [totalRow]] = await Promise.all([
    db
      .select({
        id: apiRequestLogsTable.id,
        clientId: apiRequestLogsTable.clientId,
        clientName: apiClientsTable.name,
        tokenId: apiRequestLogsTable.tokenId,
        vin: apiRequestLogsTable.vin,
        method: apiRequestLogsTable.method,
        path: apiRequestLogsTable.path,
        statusCode: apiRequestLogsTable.statusCode,
        durationMs: apiRequestLogsTable.durationMs,
        ipAddress: apiRequestLogsTable.ipAddress,
        requestedAt: apiRequestLogsTable.requestedAt,
      })
      .from(apiRequestLogsTable)
      .leftJoin(apiClientsTable, eq(apiRequestLogsTable.clientId, apiClientsTable.id))
      .where(whereClause)
      .orderBy(desc(apiRequestLogsTable.requestedAt))
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(apiRequestLogsTable).where(whereClause),
  ]);

  res.json({
    items: logs,
    total: Number(totalRow?.c ?? 0),
    limit,
    offset,
    filters,
    since: (hasRange ? range.since : new Date(Date.now() - 7 * 86_400_000)).toISOString(),
    until: range.until.toISOString(),
  });
});

export default router;
