import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middlewares/auth";
import { getLastCrawlHealthReport, runCrawlHealthCheck } from "../../lib/crawl-health";
import {
  getLastRunnerWatchdogReport,
  runRunnerWatchdog,
} from "../../lib/runner-watchdog";

const router: IRouter = Router();

router.get("/admin/crawl-health", requireAdmin, (_req, res): void => {
  const last = getLastCrawlHealthReport();
  const watchdog = getLastRunnerWatchdogReport();
  if (!last && !watchdog) {
    res.json({ t: null, ok: true, message: "No check has run yet" });
    return;
  }
  res.json({ ...(last ?? { t: null, ok: true }), watchdog });
});

router.post("/admin/crawl-health/run", requireAdmin, async (_req, res): Promise<void> => {
  const report = await runCrawlHealthCheck();
  res.status(report.ok ? 200 : 503).json(report);
});

router.get("/admin/runner-watchdog", requireAdmin, (_req, res): void => {
  const last = getLastRunnerWatchdogReport();
  if (!last) {
    res.json({ t: null, ok: true, message: "No watchdog pass has run yet" });
    return;
  }
  res.json(last);
});

router.post("/admin/runner-watchdog/run", requireAdmin, async (_req, res): Promise<void> => {
  const report = await runRunnerWatchdog();
  res.status(report.ok ? 200 : 503).json(report);
});

export default router;
