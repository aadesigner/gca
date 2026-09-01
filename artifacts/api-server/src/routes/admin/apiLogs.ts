import { Router, type IRouter } from "express";
import { db, apiRequestLogsTable, apiClientsTable } from "@workspace/db";
import { eq, count, sql, and } from "drizzle-orm";
import {
  ListApiLogsQueryParams,
  ListApiLogsResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";

const router: IRouter = Router();

// GET /api/admin/api-logs
router.get("/admin/api-logs", requireAdmin, async (req, res): Promise<void> => {
  const params = ListApiLogsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { clientId, limit = 50, offset = 0 } = params.data;

  const whereClause = clientId
    ? eq(apiRequestLogsTable.clientId, clientId)
    : undefined;

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
        requestedAt: apiRequestLogsTable.requestedAt,
      })
      .from(apiRequestLogsTable)
      .leftJoin(apiClientsTable, eq(apiRequestLogsTable.clientId, apiClientsTable.id))
      .where(whereClause)
      .orderBy(sql`${apiRequestLogsTable.requestedAt} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(apiRequestLogsTable).where(whereClause),
  ]);

  res.json(
    ListApiLogsResponse.parse({
      items: logs,
      total: Number(totalRow?.c ?? 0),
    }),
  );
});

export default router;
