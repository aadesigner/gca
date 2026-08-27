/**
 * PostgreSQL-backed rate limiter for the public VIN API.
 *
 * Checks three limits independently (daily global, monthly global, per-VIN monthly)
 * by counting successful (2xx) api_request_logs rows within the relevant time window.
 * All counts happen in one round-trip via Promise.all.
 *
 * "Atomicity" note: we read-then-write (check then log), which means there is a
 * small race window under very high concurrency. This is acceptable for Phase 3;
 * a true atomic solution (SELECT … FOR UPDATE or a counter table) can be added later.
 */
import { db, apiRequestLogsTable } from "@workspace/db";
import { eq, and, gte, count, sql } from "drizzle-orm";
import type { ApiClient } from "@workspace/db";

export interface RateLimitRemaining {
  daily?: number;
  monthly?: number;
  perVin?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  errorCode?: string;
  remaining: RateLimitRemaining;
  limits: {
    dailyGlobalLimit: number | null;
    monthlyGlobalLimit: number | null;
    requestsPerVin: number | null;
  };
}

/** Start of the current UTC day */
function startOfDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Start of the current UTC month */
function startOfMonth(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
}

/**
 * Check all applicable rate limits for `client` making a request for `vin`.
 * Returns a RateLimitResult; call the endpoint only when `allowed === true`.
 */
export async function checkRateLimits(
  client: ApiClient,
  vin: string,
): Promise<RateLimitResult> {
  const today = startOfDay();
  const thisMonth = startOfMonth();

  // Only count successful (2xx) requests as "credit consumed"
  const successFilter = sql`${apiRequestLogsTable.statusCode} >= 200 AND ${apiRequestLogsTable.statusCode} < 300`;

  const [dailyResult, monthlyResult, vinResult] = await Promise.all([
    // Daily global count
    client.rateLimitPerDay != null
      ? db
          .select({ c: count() })
          .from(apiRequestLogsTable)
          .where(
            and(
              eq(apiRequestLogsTable.clientId, client.id),
              gte(apiRequestLogsTable.requestedAt, today),
              successFilter,
            ),
          )
      : null,

    // Monthly global count
    client.monthlyGlobalLimit != null
      ? db
          .select({ c: count() })
          .from(apiRequestLogsTable)
          .where(
            and(
              eq(apiRequestLogsTable.clientId, client.id),
              gte(apiRequestLogsTable.requestedAt, thisMonth),
              successFilter,
            ),
          )
      : null,

    // Per-VIN monthly count
    client.requestsPerVin != null
      ? db
          .select({ c: count() })
          .from(apiRequestLogsTable)
          .where(
            and(
              eq(apiRequestLogsTable.clientId, client.id),
              eq(apiRequestLogsTable.vin, vin),
              gte(apiRequestLogsTable.requestedAt, thisMonth),
              successFilter,
            ),
          )
      : null,
  ]);

  const dailyCount = dailyResult ? Number(dailyResult[0]?.c ?? 0) : 0;
  const monthlyCount = monthlyResult ? Number(monthlyResult[0]?.c ?? 0) : 0;
  const vinCount = vinResult ? Number(vinResult[0]?.c ?? 0) : 0;

  const limits = {
    dailyGlobalLimit: client.rateLimitPerDay ?? null,
    monthlyGlobalLimit: client.monthlyGlobalLimit ?? null,
    requestsPerVin: client.requestsPerVin ?? null,
  };

  const remaining: RateLimitRemaining = {
    daily: limits.dailyGlobalLimit != null ? Math.max(0, limits.dailyGlobalLimit - dailyCount) : undefined,
    monthly: limits.monthlyGlobalLimit != null ? Math.max(0, limits.monthlyGlobalLimit - monthlyCount) : undefined,
    perVin: limits.requestsPerVin != null ? Math.max(0, limits.requestsPerVin - vinCount) : undefined,
  };

  // Check daily limit
  if (limits.dailyGlobalLimit != null && dailyCount >= limits.dailyGlobalLimit) {
    return {
      allowed: false,
      reason: "Daily request limit exceeded",
      errorCode: "DAILY_LIMIT_EXCEEDED",
      remaining: { ...remaining, daily: 0 },
      limits,
    };
  }

  // Check monthly limit
  if (limits.monthlyGlobalLimit != null && monthlyCount >= limits.monthlyGlobalLimit) {
    return {
      allowed: false,
      reason: "Monthly request limit exceeded",
      errorCode: "MONTHLY_LIMIT_EXCEEDED",
      remaining: { ...remaining, monthly: 0 },
      limits,
    };
  }

  // Check per-VIN limit
  if (limits.requestsPerVin != null && vinCount >= limits.requestsPerVin) {
    return {
      allowed: false,
      reason: "Per-VIN request limit exceeded for this billing period",
      errorCode: "VIN_LIMIT_EXCEEDED",
      remaining: { ...remaining, perVin: 0 },
      limits,
    };
  }

  return { allowed: true, remaining, limits };
}
