import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(
  `SELECT id, status, pages_processed, listings_fetched, vins_found, vins_new,
          items_processed, items_failed, left(error_message, 120) AS err,
          updated_at, crawl_state::json->>'currentShardId' AS shard
   FROM collection_jobs WHERE id=$1`,
  [JOB_ID],
);
const st = rows[0]
  ? JSON.parse(
      (
        await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=$1`, [JOB_ID])
      ).rows[0].crawl_state || "{}",
    )
  : null;
const by = {};
for (const s of st?.shards || []) by[s.status] = (by[s.status] || 0) + 1;
console.log(JSON.stringify({ job: rows[0], shardCounts: by }, null, 2));
await c.end();
