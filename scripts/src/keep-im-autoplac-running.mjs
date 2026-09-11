/**
 * Keep local Import Motor (#360) + Autoplac (#387) running:
 *  - park every other collection job
 *  - requeue IM/AP if cancelled/completed/stalled
 *  - verify CDP is up
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/keep-im-autoplac-running.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/keep-im-autoplac-running.mjs --watch
 */
import pg from "pg";

const KEEP = [Number(process.env.IM_JOB_ID || 360), Number(process.env.AUTOPLAC_JOB_ID || 387)];
const CDP = process.env.AUTOPLAC_CDP_URL || process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const WATCH = process.argv.includes("--watch");
const INTERVAL_MS = Math.max(30_000, Number(process.env.KEEP_ALIVE_MS || 60_000) || 60_000);
const STALL_MS = Math.max(5 * 60_000, Number(process.env.KEEP_STALL_MS || 20 * 60_000) || 20 * 60_000);

async function cdpOk() {
  try {
    const r = await fetch(`${CDP.replace(/\/$/, "")}/json/version`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function runOnce() {
  const report = { t: new Date().toISOString(), cdp: false, parked: 0, kicked: [], live: [] };
  report.cdp = await cdpOk();
  if (!report.cdp) {
    console.log(JSON.stringify({ ...report, error: `CDP down at ${CDP}` }, null, 2));
    return report;
  }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const parked = await c.query(
      `
      UPDATE collection_jobs
      SET status = 'cancelled',
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW(),
          error_message = 'parked: keep IM+autoplac running'
      WHERE status IN ('running', 'pending', 'paused')
        AND id <> ALL($1::int[])
      RETURNING id
      `,
      [KEEP],
    );
    report.parked = parked.rowCount ?? 0;

    for (const id of KEEP) {
      const [row] = (
        await c.query(
          `
          SELECT id, status, items_processed, updated_at, job_config, crawl_state
          FROM collection_jobs WHERE id = $1
          `,
          [id],
        )
      ).rows;
      if (!row) continue;

      const quietMs = Date.now() - new Date(row.updated_at).getTime();
      const stalled =
        row.status === "running" && quietMs > STALL_MS && Number(row.items_processed || 0) >= 0;
      const needsKick =
        ["cancelled", "completed", "failed", "paused"].includes(row.status) ||
        (row.status === "pending" && quietMs > 5 * 60_000) ||
        stalled;

      // Import Motor can "complete" every brand shard on catalog-wall 401s, then
      // instantly reschedule +repeatHours. Reopen those shards so keep actually runs.
      let crawlState = null;
      let reopenedShards = 0;
      if (id === KEEP[0] && row.crawl_state) {
        try {
          crawlState =
            typeof row.crawl_state === "string" ? JSON.parse(row.crawl_state) : row.crawl_state;
        } catch {
          crawlState = null;
        }
        const shards = Array.isArray(crawlState?.shards) ? crawlState.shards : [];
        const pending = shards.filter((s) => s?.status === "pending" || s?.status === "running").length;
        // All shards done (often catalog-wall EOFs). Restart from page 1 so we
        // pick up new early-page inventory instead of hammering wall page 6.
        if (shards.length > 0 && pending === 0) {
          for (const s of shards) {
            if (s?.status === "completed") {
              s.status = "pending";
              s.lastError = null;
              s.cooldownUntil = null;
              s.discoverFailures = 0;
              s.nextPage = 1;
              reopenedShards++;
            }
          }
          crawlState.currentShardId = shards.find((s) => s.status === "pending")?.id ?? null;
        }
      }

      if (needsKick || row.status === "pending" || reopenedShards > 0) {
        const delayMs = id === KEEP[0] ? 85 : 400;
        // Always strip nextRunAt / lastCompletedAt so fleet deferral cannot park IM/AP.
        // crawl_state column is text — never COALESCE jsonb with text.
        const params = [id, delayMs];
        const crawlSet =
          reopenedShards > 0
            ? (params.push(JSON.stringify(crawlState)), `, crawl_state = $${params.length}`)
            : "";
        await c.query(
          `
          UPDATE collection_jobs
          SET status = 'pending',
              started_at = NULL,
              completed_at = NULL,
              error_message = NULL,
              created_at = LEAST(created_at, NOW() - interval '5 days'),
              updated_at = NOW() - interval '1 day'${crawlSet},
              job_config = (
                COALESCE(job_config, '{}')::jsonb
                - 'nextRunAt'
                - 'lastCompletedAt'
                || jsonb_build_object(
                     'concurrency', 5,
                     'delayMs', $2::int,
                     'detailLevel', 'full',
                     'skipRecentHours', 0,
                     'fullCrawl', true,
                     'source', 'keep_im_autoplac_running'
                   )
              )::text
          WHERE id = $1
          `,
          params,
        );
        report.kicked.push({
          id,
          from: row.status,
          stalled: !!stalled,
          reopenedShards: reopenedShards || undefined,
        });
      }
    }

    report.live = (
      await c.query(
        `
        SELECT cj.id, p.internal_name, cj.status, cj.items_processed, cj.pages_processed, cj.updated_at
        FROM collection_jobs cj
        JOIN providers p ON p.id = cj.provider_id
        WHERE cj.id = ANY($1::int[])
        ORDER BY p.internal_name
        `,
        [KEEP],
      )
    ).rows;
  } finally {
    await c.end();
  }

  console.log(JSON.stringify(report, null, 2));
  return report;
}

const first = await runOnce();
if (!WATCH) process.exit(first.cdp ? 0 : 2);

console.error(`keep-im-autoplac watch every ${Math.round(INTERVAL_MS / 1000)}s`);
for (;;) {
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
  try {
    await runOnce();
  } catch (err) {
    console.error("keep-watch tick failed:", err?.message || err);
  }
}
