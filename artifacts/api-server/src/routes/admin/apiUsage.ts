import { Router, type IRouter } from "express";
import { db, apiClientsTable, apiRequestLogsTable, apiTokensTable } from "@workspace/db";
import { eq, sql, and, gte, desc, count, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/auth";

const router: IRouter = Router();

function parseDays(raw: unknown): number {
  const n = Number(raw);
  return Math.min(90, Math.max(7, Number.isFinite(n) ? Math.trunc(n) : 30));
}

function windowStarts() {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const monthStart = new Date(dayStart);
  monthStart.setUTCDate(monthStart.getUTCDate() - 29);
  return { dayStart, weekStart, monthStart };
}

/** Cross-client API traffic monitor for admin. */
router.get("/admin/api-usage/overview", requireAdmin, async (req, res): Promise<void> => {
  const days = parseDays(req.query.days);
  const clientIdRaw = Number(req.query.clientId);
  const clientFilter = Number.isFinite(clientIdRaw) && clientIdRaw > 0 ? clientIdRaw : null;

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const { dayStart, weekStart, monthStart } = windowStarts();
  const dayKey = sql<string>`to_char(date_trunc('day', ${apiRequestLogsTable.requestedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

  const scopedLogs = clientFilter
    ? eq(apiRequestLogsTable.clientId, clientFilter)
    : undefined;
  const seriesWhere = scopedLogs
    ? and(scopedLogs, gte(apiRequestLogsTable.requestedAt, since))
    : gte(apiRequestLogsTable.requestedAt, since);

  const [
    clients,
    aggByClient,
    tokenCountRows,
    seriesRows,
    statusRows,
    summaryRows,
    topVins,
    topPaths,
    tokenStatsRows,
    recentLogs,
  ] = await Promise.all([
    db
      .select({
        id: apiClientsTable.id,
        name: apiClientsTable.name,
        email: apiClientsTable.email,
        isActive: apiClientsTable.isActive,
        isDemo: apiClientsTable.isDemo,
        creditBalance: apiClientsTable.creditBalance,
        rateLimitPerMinute: apiClientsTable.rateLimitPerMinute,
        rateLimitPerDay: apiClientsTable.rateLimitPerDay,
      })
      .from(apiClientsTable)
      .where(clientFilter ? eq(apiClientsTable.id, clientFilter) : undefined)
      .orderBy(apiClientsTable.name),
    db
      .select({
        clientId: apiRequestLogsTable.clientId,
        today: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${dayStart})::int`,
        week: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart})::int`,
        month: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${monthStart})::int`,
        allTime: count(),
        errorsWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.statusCode} >= 400)::int`,
        okWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.statusCode} >= 200 and ${apiRequestLogsTable.statusCode} < 300)::int`,
        vinWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.path} like '%/v1/vin/%' and ${apiRequestLogsTable.path} not like '%/check/%')::int`,
        checkWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.path} like '%/vin/check/%')::int`,
        liveWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.path} like '%/v1/live/%')::int`,
        lastRequestAt: sql<Date | null>`max(${apiRequestLogsTable.requestedAt})`,
      })
      .from(apiRequestLogsTable)
      .where(isNotNull(apiRequestLogsTable.clientId))
      .groupBy(apiRequestLogsTable.clientId),
    db
      .select({
        clientId: apiTokensTable.clientId,
        tokenCount: count(),
        activeTokens: sql<number>`count(*) filter (where ${apiTokensTable.isActive})::int`,
      })
      .from(apiTokensTable)
      .groupBy(apiTokensTable.clientId),
    db
      .select({
        day: dayKey,
        total: count(),
        ok: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 200 and ${apiRequestLogsTable.statusCode} < 300)::int`,
        vin: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/vin/%' and ${apiRequestLogsTable.path} not like '%/check/%')::int`,
        check: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/vin/check/%')::int`,
        live: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/live/%')::int`,
        errors: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 400)::int`,
      })
      .from(apiRequestLogsTable)
      .where(seriesWhere)
      .groupBy(dayKey)
      .orderBy(dayKey),
    db
      .select({
        statusCode: apiRequestLogsTable.statusCode,
        c: count(),
      })
      .from(apiRequestLogsTable)
      .where(seriesWhere)
      .groupBy(apiRequestLogsTable.statusCode)
      .orderBy(desc(count())),
    db
      .select({
        today: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${dayStart})::int`,
        week: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart})::int`,
        month: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${monthStart})::int`,
        allTime: count(),
        errorsWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.statusCode} >= 400)::int`,
        okWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.statusCode} >= 200 and ${apiRequestLogsTable.statusCode} < 300)::int`,
        vinWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.path} like '%/v1/vin/%' and ${apiRequestLogsTable.path} not like '%/check/%')::int`,
        checkWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.path} like '%/vin/check/%')::int`,
        liveWeek: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart} and ${apiRequestLogsTable.path} like '%/v1/live/%')::int`,
        uniqueVins: sql<number>`count(distinct ${apiRequestLogsTable.vin}) filter (where ${apiRequestLogsTable.vin} is not null and ${apiRequestLogsTable.requestedAt} >= ${since})::int`,
        uniqueClients: sql<number>`count(distinct ${apiRequestLogsTable.clientId}) filter (where ${apiRequestLogsTable.clientId} is not null and ${apiRequestLogsTable.requestedAt} >= ${since})::int`,
        avgDurationMs: sql<number>`coalesce(avg(${apiRequestLogsTable.durationMs}) filter (where ${apiRequestLogsTable.requestedAt} >= ${since}), 0)::int`,
      })
      .from(apiRequestLogsTable)
      .where(scopedLogs),
    db
      .select({
        vin: apiRequestLogsTable.vin,
        clientId: apiRequestLogsTable.clientId,
        clientName: apiClientsTable.name,
        requests: count(),
        errors: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 400)::int`,
        lastAt: sql<Date>`max(${apiRequestLogsTable.requestedAt})`,
      })
      .from(apiRequestLogsTable)
      .leftJoin(apiClientsTable, eq(apiRequestLogsTable.clientId, apiClientsTable.id))
      .where(
        and(
          isNotNull(apiRequestLogsTable.vin),
          gte(apiRequestLogsTable.requestedAt, since),
          scopedLogs,
        ),
      )
      .groupBy(apiRequestLogsTable.vin, apiRequestLogsTable.clientId, apiClientsTable.name)
      .orderBy(desc(count()))
      .limit(25),
    db
      .select({
        path: apiRequestLogsTable.path,
        requests: count(),
        errors: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 400)::int`,
      })
      .from(apiRequestLogsTable)
      .where(seriesWhere)
      .groupBy(apiRequestLogsTable.path)
      .orderBy(desc(count()))
      .limit(12),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${apiTokensTable.isActive})::int`,
        usedWeek: sql<number>`count(*) filter (where ${apiTokensTable.lastUsedAt} >= ${weekStart})::int`,
      })
      .from(apiTokensTable)
      .where(clientFilter ? eq(apiTokensTable.clientId, clientFilter) : undefined),
    db
      .select({
        id: apiRequestLogsTable.id,
        clientId: apiRequestLogsTable.clientId,
        clientName: apiClientsTable.name,
        tokenId: apiRequestLogsTable.tokenId,
        method: apiRequestLogsTable.method,
        path: apiRequestLogsTable.path,
        statusCode: apiRequestLogsTable.statusCode,
        vin: apiRequestLogsTable.vin,
        durationMs: apiRequestLogsTable.durationMs,
        requestedAt: apiRequestLogsTable.requestedAt,
      })
      .from(apiRequestLogsTable)
      .leftJoin(apiClientsTable, eq(apiRequestLogsTable.clientId, apiClientsTable.id))
      .where(scopedLogs)
      .orderBy(desc(apiRequestLogsTable.requestedAt))
      .limit(60),
  ]);

  const aggMap = new Map(aggByClient.map((r) => [Number(r.clientId), r]));
  const tokenMap = new Map(tokenCountRows.map((r) => [Number(r.clientId), r]));

  const byClient = clients.map((c) => {
    const agg = aggMap.get(c.id);
    const tok = tokenMap.get(c.id);
    return {
      clientId: c.id,
      clientName: c.name,
      email: c.email,
      isActive: c.isActive,
      isDemo: c.isDemo,
      creditBalance: Number(c.creditBalance ?? 0),
      rateLimitPerMinute: c.rateLimitPerMinute,
      rateLimitPerDay: c.rateLimitPerDay,
      tokenCount: Number(tok?.tokenCount ?? 0),
      activeTokens: Number(tok?.activeTokens ?? 0),
      today: Number(agg?.today ?? 0),
      week: Number(agg?.week ?? 0),
      month: Number(agg?.month ?? 0),
      allTime: Number(agg?.allTime ?? 0),
      errorsWeek: Number(agg?.errorsWeek ?? 0),
      okWeek: Number(agg?.okWeek ?? 0),
      vinWeek: Number(agg?.vinWeek ?? 0),
      checkWeek: Number(agg?.checkWeek ?? 0),
      liveWeek: Number(agg?.liveWeek ?? 0),
      lastRequestAt: agg?.lastRequestAt ?? null,
    };
  });

  const sort = String(req.query.sort || "week");
  byClient.sort((a, b) => {
    const key =
      sort === "errors"
        ? "errorsWeek"
        : sort === "month"
          ? "month"
          : sort === "allTime"
            ? "allTime"
            : sort === "today"
              ? "today"
              : "week";
    return (b as Record<string, number>)[key] - (a as Record<string, number>)[key];
  });

  const byDay = new Map(
    seriesRows.map((r) => [
      String(r.day),
      {
        day: String(r.day),
        total: Number(r.total ?? 0),
        ok: Number(r.ok ?? 0),
        vin: Number(r.vin ?? 0),
        check: Number(r.check ?? 0),
        live: Number(r.live ?? 0),
        errors: Number(r.errors ?? 0),
      },
    ]),
  );

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push(byDay.get(key) ?? { day: key, total: 0, ok: 0, vin: 0, check: 0, live: 0, errors: 0 });
  }

  const sum = summaryRows[0];
  const tokens = tokenStatsRows[0];

  res.json({
    days,
    since: since.toISOString(),
    clientId: clientFilter,
    summary: {
      today: Number(sum?.today ?? 0),
      week: Number(sum?.week ?? 0),
      month: Number(sum?.month ?? 0),
      allTime: Number(sum?.allTime ?? 0),
      errorsWeek: Number(sum?.errorsWeek ?? 0),
      okWeek: Number(sum?.okWeek ?? 0),
      vinWeek: Number(sum?.vinWeek ?? 0),
      checkWeek: Number(sum?.checkWeek ?? 0),
      liveWeek: Number(sum?.liveWeek ?? 0),
      uniqueVins: Number(sum?.uniqueVins ?? 0),
      uniqueClients: Number(sum?.uniqueClients ?? 0),
      avgDurationMs: Number(sum?.avgDurationMs ?? 0),
      activeClients: clients.filter((c) => c.isActive).length,
      totalClients: clients.length,
    },
    tokens: {
      total: Number(tokens?.total ?? 0),
      active: Number(tokens?.active ?? 0),
      usedWeek: Number(tokens?.usedWeek ?? 0),
    },
    series,
    status: statusRows.map((r) => ({
      statusCode: r.statusCode,
      count: Number(r.c ?? 0),
    })),
    byClient,
    topVins: topVins.map((r) => ({
      vin: r.vin,
      clientId: r.clientId,
      clientName: r.clientName,
      requests: Number(r.requests ?? 0),
      errors: Number(r.errors ?? 0),
      lastAt: r.lastAt,
    })),
    topPaths: topPaths.map((r) => ({
      path: r.path,
      requests: Number(r.requests ?? 0),
      errors: Number(r.errors ?? 0),
    })),
    recentLogs,
  });
});

export default router;
