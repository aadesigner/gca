/**
 * Pause local Encar full crawl. Does not wipe crawl_state.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-pause-encar-offline.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host) || /rlwy\.net|railway\.(app|internal)/i.test(url)) {
  throw new Error(`Refusing pause — host ${host}`);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
const extras = await c.query(`
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = 'paused — drain Encar photos to Cloudflare',
      updated_at = now()
  WHERE status IN ('running', 'pending') AND id <> 362
  RETURNING id
`);
const row = (await c.query(`SELECT id, status, job_config FROM collection_jobs WHERE id = 362`)).rows[0];
const cfg = JSON.parse(row?.job_config || "{}");
cfg.pausedForMirrorDrain = true;
await c.query(
  `
  UPDATE collection_jobs
  SET status = 'paused',
      job_config = $1,
      error_message = 'paused — drain Encar photos to Cloudflare',
      updated_at = now()
  WHERE id = 362
  `,
  [JSON.stringify(cfg)],
);
const job = (
  await c.query(`
    SELECT id, status, pages_processed, listings_fetched, vins_new, items_failed,
           job_config::jsonb->>'pausedForMirrorDrain' AS drain
    FROM collection_jobs WHERE id = 362
  `)
).rows[0];
console.log(JSON.stringify({ host, extras: extras.rows.map((r) => r.id), job }, null, 2));
await c.end();
