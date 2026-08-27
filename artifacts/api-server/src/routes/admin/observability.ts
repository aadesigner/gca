import { Router, type IRouter } from "express";
import { db, systemEventsTable, providersTable } from "@workspace/db";
import { eq, count, and, gte, lte, sql } from "drizzle-orm";
import {
  ListSystemEventsQueryParams,
  ListSystemEventsResponse,
  GetObservabilityStatsQueryParams,
  GetObservabilityStatsResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";

const router: IRouter = Router();

// GET /api/admin/system-events
router.get("/admin/system-events", requireAdmin, async (req, res): Promise<void> => {
  const params = ListSystemEventsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { eventType, severity, providerId, jobId, dateFrom, dateTo, limit = 100, offset = 0 } = params.data;

  const conditions = [];
  if (eventType) conditions.push(eq(systemEventsTable.eventType, eventType));
  if (severity) conditions.push(eq(systemEventsTable.severity, severity));
  if (providerId) conditions.push(eq(systemEventsTable.providerId, providerId));
  if (jobId) conditions.push(eq(systemEventsTable.jobId, jobId));
  if (dateFrom) conditions.push(gte(systemEventsTable.occurredAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(systemEventsTable.occurredAt, new Date(dateTo)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [events, [totalRow]] = await Promise.all([
    db
      .select({
        id: systemEventsTable.id,
        eventType: systemEventsTable.eventType,
        severity: systemEventsTable.severity,
        providerId: systemEventsTable.providerId,
        providerName: providersTable.name,
        jobId: systemEventsTable.jobId,
        message: systemEventsTable.message,
        details: systemEventsTable.details,
        sourceUrl: systemEventsTable.sourceUrl,
        occurredAt: systemEventsTable.occurredAt,
      })
      .from(systemEventsTable)
      .leftJoin(providersTable, eq(systemEventsTable.providerId, providersTable.id))
      .where(whereClause)
      .orderBy(sql`${systemEventsTable.occurredAt} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ c: count() }).from(systemEventsTable).where(whereClause),
  ]);

  res.json(
    ListSystemEventsResponse.parse({
      items: events,
      total: Number(totalRow?.c ?? 0),
    }),
  );
});

// GET /api/admin/observability/stats
router.get("/admin/observability/stats", requireAdmin, async (req, res): Promise<void> => {
  const params = GetObservabilityStatsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { hours = 24, providerId } = params.data;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const conditions = [gte(systemEventsTable.occurredAt, since)];
  if (providerId) conditions.push(eq(systemEventsTable.providerId, providerId));
  const whereClause = and(...conditions);

  const [totalRow, byTypeRows, bySeverityRows, byProviderRows] = await Promise.all([
    db.select({ c: count() }).from(systemEventsTable).where(whereClause),
    db
      .select({
        eventType: systemEventsTable.eventType,
        count: count(),
      })
      .from(systemEventsTable)
      .where(whereClause)
      .groupBy(systemEventsTable.eventType)
      .orderBy(sql`count(*) DESC`),
    db
      .select({
        severity: systemEventsTable.severity,
        count: count(),
      })
      .from(systemEventsTable)
      .where(whereClause)
      .groupBy(systemEventsTable.severity),
    db
      .select({
        providerId: systemEventsTable.providerId,
        providerName: providersTable.name,
        count: count(),
      })
      .from(systemEventsTable)
      .leftJoin(providersTable, eq(systemEventsTable.providerId, providersTable.id))
      .where(whereClause)
      .groupBy(systemEventsTable.providerId, providersTable.name)
      .orderBy(sql`count(*) DESC`),
  ]);

  res.json(
    GetObservabilityStatsResponse.parse({
      windowHours: hours,
      totalEvents: Number(totalRow[0]?.c ?? 0),
      byType: byTypeRows.map(r => ({ eventType: r.eventType, count: Number(r.count) })),
      bySeverity: bySeverityRows.map(r => ({ severity: r.severity, count: Number(r.count) })),
      byProvider: byProviderRows
        .filter(r => r.providerId != null)
        .map(r => ({
          providerId: r.providerId!,
          providerName: r.providerName ?? `#${r.providerId}`,
          count: Number(r.count),
        })),
    }),
  );
});

export default router;
