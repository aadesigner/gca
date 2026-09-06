import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middlewares/auth";
import {
  parseUsageFilters,
  parseUsageRange,
  queryUsageBundle,
} from "../../lib/apiUsageStats";

const router: IRouter = Router();

/** Cross-client API traffic monitor for admin. */
router.get("/admin/api-usage/overview", requireAdmin, async (req, res): Promise<void> => {
  const range = parseUsageRange(req.query as Record<string, unknown>);
  const filters = parseUsageFilters(req.query as Record<string, unknown>);

  const bundle = await queryUsageBundle({
    range,
    filters,
    recentLimit: 80,
    includeByClient: true,
  });

  const byClient = [...((bundle.byClient as any[]) ?? [])];
  const sort = String(req.query.sort || "week");
  byClient.sort((a, b) => {
    const key =
      sort === "errors"
        ? "errorsWeek"
        : sort === "range" || sort === "period"
          ? "rangeTotal"
          : sort === "month"
            ? "month"
            : sort === "allTime"
              ? "allTime"
              : sort === "today"
                ? "today"
                : "week";
    return Number(b[key] ?? 0) - Number(a[key] ?? 0);
  });

  res.json({
    ...bundle,
    clientId: filters.clientId,
    byClient,
    summary: {
      ...bundle.summary,
      activeClients: byClient.filter((c) => c.isActive).length,
      totalClients: byClient.length,
    },
  });
});

export default router;
