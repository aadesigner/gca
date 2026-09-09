import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
for (const id of [360, 361, 362]) {
  const { rows } = await c.query(
    `SELECT id, status, job_type, pages_processed, listings_fetched, vins_found, vins_new,
            items_processed, updated_at, left(error_message, 140) AS err
     FROM collection_jobs WHERE id=$1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    console.log(id, "missing");
    continue;
  }
  if (id === 360) {
    const st = JSON.parse(
      (await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=360`)).rows[0].crawl_state || "{}",
    );
    const by = {};
    for (const s of st.shards || []) by[s.status] = (by[s.status] || 0) + 1;
    console.log("360 shards", by, "current", st.currentShardId, "keys", Object.keys(st).slice(0, 12));
  }
  console.log(row);
}
await c.end();
