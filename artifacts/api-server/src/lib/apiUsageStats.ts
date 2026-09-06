/**
 * Shared admin API usage aggregation — hour/day series, filters, latency.
 */
import {
  db,
  apiClientsTable,
  apiRequestLogsTable,
  apiTokensTable,
} from "@workspace/db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

export type PathClass = "all" | "vin" | "check" | "live";
export type StatusClass = "all" | "2xx" | "4xx" | "5xx" | "errors";
export type Granularity = "hour" | "day";

export type UsageRange = {
  days: number;
  since: Date;
  until: Date;
  granularity: Granularity;
};

export type UsageFilters = {
  clientId: number | null;
  tokenId: number | null;
  pathClass: PathClass;
  statusClass: StatusClass;
  vin: string | null;
};

export type SeriesPoint = {
  bucket: string;
  total: number;
  ok: number;
  errors: number;
  vin: number;
  check: number;
  live: number;
  avgDurationMs: number;
  p95DurationMs: number;
};

const PATH_CLASSES = new Set<PathClass>(["all", "vin", "check", "live"]);
const STATUS_CLASSES = new Set<StatusClass>(["all", "2xx", "4xx", "5xx", "errors"]);

export function parseDaysParam(raw: unknown, fallback = 7): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(90, Math.max(1, Math.trunc(n)));
}

export function parsePathClass(raw: unknown): PathClass {
  const v = String(raw || "all").toLowerCase() as PathClass;
  return PATH_CLASSES.has(v) ? v : "all";
}

export function parseStatusClass(raw: unknown): StatusClass {
  const v = String(raw || "all").toLowerCase() as StatusClass;
  return STATUS_CLASSES.has(v) ? v : "all";
}

export function parseUsageRange(query: Record<string, unknown> | undefined): UsageRange {
  const q = query ?? {};
  const until = q.to ? new Date(String(q.to)) : new Date();
  const untilSafe = Number.isNaN(until.getTime()) ? new Date() : until;

  if (q.from) {
    const from = new Date(String(q.from));
    if (!Number.isNaN(from.getTime()) && from < untilSafe) {
      const spanMs = untilSafe.getTime() - from.getTime();
      const spanDays = Math.max(1, Math.ceil(spanMs / 86_400_000));
      const days = Math.min(90, spanDays);
      const since = new Date(untilSafe.getTime() - (days * 86_400_000 - 1));
      const granularity: Granularity = days <= 2 ? "hour" : "day";
      return { days, since, until: untilSafe, granularity };
    }
  }

  const days = parseDaysParam(q.days, 7);
  const since = new Date(untilSafe);
  if (days <= 2) {
    // Rolling window ending now (hourly charts need current hour)
    since.setTime(untilSafe.getTime() - days * 86_400_000);
  } else {
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
  }
  const granularity: Granularity = days <= 2 ? "hour" : "day";
  return { days, since, until: untilSafe, granularity };
}

export function parseUsageFilters(
  query: Record<string, unknown> | undefined,
  defaults: Partial<UsageFilters> = {},
): UsageFilters {
  const q = query ?? {};
  const clientIdRaw = Number(q.clientId ?? defaults.clientId);
  const tokenIdRaw = Number(q.tokenId ?? defaults.tokenId);
  const vinRaw = typeof q.vin === "string" ? q.vin.trim().toUpperCase() : "";
  return {
    clientId: Number.isFinite(clientIdRaw) && clientIdRaw > 0 ? clientIdRaw : defaults.clientId ?? null,
    tokenId: Number.isFinite(tokenIdRaw) && tokenIdRaw > 0 ? tokenIdRaw : defaults.tokenId ?? null,
    pathClass: parsePathClass(q.pathClass ?? defaults.pathClass),
    statusClass: parseStatusClass(q.statusClass ?? defaults.statusClass),
    vin: vinRaw.length >= 5 ? vinRaw.slice(0, 17) : defaults.vin ?? null,
  };
}

function pathClassSql(pathClass: PathClass): SQL | undefined {
  if (pathClass === "vin") {
    return and(
      sql`${apiRequestLogsTable.path} like '%/v1/vin/%'`,
      sql`${apiRequestLogsTable.path} not like '%/check/%'`,
    );
  }
  if (pathClass === "check") {
    return sql`${apiRequestLogsTable.path} like '%/vin/check/%'`;
  }
  if (pathClass === "live") {
    return sql`${apiRequestLogsTable.path} like '%/v1/live/%'`;
  }
  return undefined;
}

function statusClassSql(statusClass: StatusClass): SQL | undefined {
  if (statusClass === "2xx") {
    return and(
      sql`${apiRequestLogsTable.statusCode} >= 200`,
      sql`${apiRequestLogsTable.statusCode} < 300`,
    );
  }
  if (statusClass === "4xx") {
    return and(
      sql`${apiRequestLogsTable.statusCode} >= 400`,
      sql`${apiRequestLogsTable.statusCode} < 500`,
    );
  }
  if (statusClass === "5xx") {
    return sql`${apiRequestLogsTable.statusCode} >= 500`;
  }
  if (statusClass === "errors") {
    return sql`${apiRequestLogsTable.statusCode} >= 400`;
  }
  return undefined;
}

export function buildLogFilterSql(filters: UsageFilters, range?: { since: Date; until?: Date }): SQL | undefined {
  const parts: SQL[] = [];
  if (range?.since) parts.push(gte(apiRequestLogsTable.requestedAt, range.since));
  if (range?.until) parts.push(lte(apiRequestLogsTable.requestedAt, range.until));
  if (filters.clientId) parts.push(eq(apiRequestLogsTable.clientId, filters.clientId));
  if (filters.tokenId) parts.push(eq(apiRequestLogsTable.tokenId, filters.tokenId));
  if (filters.vin) parts.push(ilike(apiRequestLogsTable.vin, `${filters.vin}%`));
  const pathSql = pathClassSql(filters.pathClass);
  if (pathSql) parts.push(pathSql);
  const statusSql = statusClassSql(filters.statusClass);
  if (statusSql) parts.push(statusSql);
  if (!parts.length) return undefined;
  return and(...parts);
}

function bucketKeySql(granularity: Granularity) {
  if (granularity === "hour") {
    return sql<string>`to_char(date_trunc('hour', ${apiRequestLogsTable.requestedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`;
  }
  return sql<string>`to_char(date_trunc('day', ${apiRequestLogsTable.requestedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
}

function fillBuckets(
  range: UsageRange,
  byBucket: Map<string, SeriesPoint>,
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const empty = (bucket: string): SeriesPoint => ({
    bucket,
    total: 0,
    ok: 0,
    errors: 0,
    vin: 0,
    check: 0,
    live: 0,
    avgDurationMs: 0,
    p95DurationMs: 0,
  });

  if (range.granularity === "hour") {
    const start = new Date(range.since);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(range.until);
    end.setUTCMinutes(0, 0, 0);
    for (let t = start.getTime(); t <= end.getTime(); t += 3_600_000) {
      const key = new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:\d{2}Z$/, ":00Z");
      // Normalize to YYYY-MM-DDTHH:00:00Z
      const d = new Date(t);
      const norm = `${d.toISOString().slice(0, 13)}:00:00Z`;
      out.push(byBucket.get(norm) ?? empty(norm));
    }
    return out;
  }

  const cursor = new Date(range.since);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < range.days; i++) {
    const d = new Date(cursor);
    d.setUTCDate(cursor.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push(byBucket.get(key) ?? empty(key));
  }
  return out;
}

function windowStarts(now = new Date()) {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const monthStart = new Date(dayStart);
  monthStart.setUTCDate(monthStart.getUTCDate() - 29);
  return { dayStart, weekStart, monthStart };
}

export async function queryUsageSeries(range: UsageRange, filters: UsageFilters): Promise<SeriesPoint[]> {
  const where = buildLogFilterSql(filters, { since: range.since, until: range.until });
  const bucket = bucketKeySql(range.granularity);

  const rows = await db
    .select({
      bucket,
      total: count(),
      ok: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 200 and ${apiRequestLogsTable.statusCode} < 300)::int`,
      errors: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 400)::int`,
      vin: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/vin/%' and ${apiRequestLogsTable.path} not like '%/check/%')::int`,
      check: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/vin/check/%')::int`,
      live: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/live/%')::int`,
      avgDurationMs: sql<number>`coalesce(avg(${apiRequestLogsTable.durationMs}), 0)::int`,
      p95DurationMs: sql<number>`coalesce((percentile_cont(0.95) within group (order by ${apiRequestLogsTable.durationMs}))::int, 0)`,
    })
    .from(apiRequestLogsTable)
    .where(where)
    .groupBy(bucket)
    .orderBy(bucket);

  const map = new Map<string, SeriesPoint>();
  for (const r of rows) {
    const key = String(r.bucket);
    map.set(key, {
      bucket: key,
      total: Number(r.total ?? 0),
      ok: Number(r.ok ?? 0),
      errors: Number(r.errors ?? 0),
      vin: Number(r.vin ?? 0),
      check: Number(r.check ?? 0),
      live: Number(r.live ?? 0),
      avgDurationMs: Number(r.avgDurationMs ?? 0),
      p95DurationMs: Number(r.p95DurationMs ?? 0),
    });
  }
  return fillBuckets(range, map);
}

export async function queryUsageBundle(opts: {
  range: UsageRange;
  filters: UsageFilters;
  recentLimit?: number;
  includeByClient?: boolean;
}) {
  const { range, filters, recentLimit = 60, includeByClient = false } = opts;
  const { dayStart, weekStart, monthStart } = windowStarts();
  const seriesWhere = buildLogFilterSql(filters, { since: range.since, until: range.until });
  const clientScope = filters.clientId
    ? eq(apiRequestLogsTable.clientId, filters.clientId)
    : undefined;

  const [
    series,
    statusRows,
    summaryRows,
    topVins,
    topPaths,
    recentLogs,
    tokenStatsRows,
    rangeSummaryRows,
  ] = await Promise.all([
    queryUsageSeries(range, filters),
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
      })
      .from(apiRequestLogsTable)
      .where(clientScope),
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
      .where(and(isNotNull(apiRequestLogsTable.vin), seriesWhere))
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
        id: apiRequestLogsTable.id,
        clientId: apiRequestLogsTable.clientId,
        clientName: apiClientsTable.name,
        tokenId: apiRequestLogsTable.tokenId,
        method: apiRequestLogsTable.method,
        path: apiRequestLogsTable.path,
        statusCode: apiRequestLogsTable.statusCode,
        vin: apiRequestLogsTable.vin,
        durationMs: apiRequestLogsTable.durationMs,
        ipAddress: apiRequestLogsTable.ipAddress,
        requestedAt: apiRequestLogsTable.requestedAt,
      })
      .from(apiRequestLogsTable)
      .leftJoin(apiClientsTable, eq(apiRequestLogsTable.clientId, apiClientsTable.id))
      .where(seriesWhere)
      .orderBy(desc(apiRequestLogsTable.requestedAt))
      .limit(recentLimit),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${apiTokensTable.isActive})::int`,
        usedWeek: sql<number>`count(*) filter (where ${apiTokensTable.lastUsedAt} >= ${weekStart})::int`,
      })
      .from(apiTokensTable)
      .where(filters.clientId ? eq(apiTokensTable.clientId, filters.clientId) : undefined),
    db
      .select({
        total: count(),
        ok: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 200 and ${apiRequestLogsTable.statusCode} < 300)::int`,
        errors: sql<number>`count(*) filter (where ${apiRequestLogsTable.statusCode} >= 400)::int`,
        vin: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/vin/%' and ${apiRequestLogsTable.path} not like '%/check/%')::int`,
        check: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/vin/check/%')::int`,
        live: sql<number>`count(*) filter (where ${apiRequestLogsTable.path} like '%/v1/live/%')::int`,
        uniqueVins: sql<number>`count(distinct ${apiRequestLogsTable.vin}) filter (where ${apiRequestLogsTable.vin} is not null)::int`,
        uniqueClients: sql<number>`count(distinct ${apiRequestLogsTable.clientId}) filter (where ${apiRequestLogsTable.clientId} is not null)::int`,
        avgDurationMs: sql<number>`coalesce(avg(${apiRequestLogsTable.durationMs}), 0)::int`,
        p95DurationMs: sql<number>`coalesce((percentile_cont(0.95) within group (order by ${apiRequestLogsTable.durationMs}))::int, 0)`,
      })
      .from(apiRequestLogsTable)
      .where(seriesWhere),
  ]);

  const sum = summaryRows[0];
  const rangeSum = rangeSummaryRows[0];
  const tokens = tokenStatsRows[0];
  const rangeTotal = Number(rangeSum?.total ?? 0);
  const rangeOk = Number(rangeSum?.ok ?? 0);

  let byClient: unknown[] | undefined;
  if (includeByClient) {
    const [clients, aggByClient, tokenCountRows] = await Promise.all([
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
        .where(filters.clientId ? eq(apiClientsTable.id, filters.clientId) : undefined)
        .orderBy(apiClientsTable.name),
      db
        .select({
          clientId: apiRequestLogsTable.clientId,
          today: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${dayStart})::int`,
          week: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${weekStart})::int`,
          month: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${monthStart})::int`,
          allTime: count(),
          rangeTotal: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${range.since} and ${apiRequestLogsTable.requestedAt} <= ${range.until})::int`,
          rangeErrors: sql<number>`count(*) filter (where ${apiRequestLogsTable.requestedAt} >= ${range.since} and ${apiRequestLogsTable.requestedAt} <= ${range.until} and ${apiRequestLogsTable.statusCode} >= 400)::int`,
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
    ]);

    const aggMap = new Map(aggByClient.map((r) => [Number(r.clientId), r]));
    const tokenMap = new Map(tokenCountRows.map((r) => [Number(r.clientId), r]));
    byClient = clients.map((c) => {
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
        rangeTotal: Number(agg?.rangeTotal ?? 0),
        rangeErrors: Number(agg?.rangeErrors ?? 0),
        errorsWeek: Number(agg?.errorsWeek ?? 0),
        okWeek: Number(agg?.okWeek ?? 0),
        vinWeek: Number(agg?.vinWeek ?? 0),
        checkWeek: Number(agg?.checkWeek ?? 0),
        liveWeek: Number(agg?.liveWeek ?? 0),
        lastRequestAt: agg?.lastRequestAt ?? null,
      };
    });
  }

  return {
    days: range.days,
    since: range.since.toISOString(),
    until: range.until.toISOString(),
    granularity: range.granularity,
    filters,
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
      rangeTotal,
      rangeOk,
      rangeErrors: Number(rangeSum?.errors ?? 0),
      rangeVin: Number(rangeSum?.vin ?? 0),
      rangeCheck: Number(rangeSum?.check ?? 0),
      rangeLive: Number(rangeSum?.live ?? 0),
      uniqueVins: Number(rangeSum?.uniqueVins ?? 0),
      uniqueClients: Number(rangeSum?.uniqueClients ?? 0),
      avgDurationMs: Number(rangeSum?.avgDurationMs ?? 0),
      p95DurationMs: Number(rangeSum?.p95DurationMs ?? 0),
      successRate: rangeTotal > 0 ? Math.round((rangeOk / rangeTotal) * 100) : null,
    },
    tokens: {
      total: Number(tokens?.total ?? 0),
      active: Number(tokens?.active ?? 0),
      usedWeek: Number(tokens?.usedWeek ?? 0),
    },
    // Keep `day` alias for older UI; primary key is `bucket`
    series: series.map((p) => ({ ...p, day: p.bucket })),
    status: statusRows.map((r) => ({
      statusCode: r.statusCode,
      count: Number(r.c ?? 0),
    })),
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
    byClient,
  };
}
