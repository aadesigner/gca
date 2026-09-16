import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();

for (const id of [387, 390]) {
  const row = (await c.query(`SELECT crawl_state::jsonb AS cs FROM collection_jobs WHERE id=$1`, [id])).rows[0];
  const cs = row?.cs || {};
  const shards = Array.isArray(cs.shards)
    ? cs.shards.map((s) => {
        if (s.status === "active" || s.status === "cooldown" || s.status === "failed") {
          return { ...s, status: "pending", cooldownUntil: null, lastError: null, discoverFailures: 0 };
        }
        return s;
      })
    : cs.shards;
  const next = {
    ...cs,
    shards,
    currentShardId: (shards || []).find((s) => s.status === "pending")?.id || null,
  };
  await c.query(
    `UPDATE collection_jobs
     SET crawl_state = $1::jsonb,
         status = 'pending',
         error_message = NULL,
         started_at = NULL,
         completed_at = NULL,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(next), id],
  );
  const pending = (shards || []).filter((s) => s.status === "pending").length;
  console.log("requeued", id, { pending, current: next.currentShardId });
}

const check = await c.query(`
  SELECT id, status, updated_at,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='pending') AS pending,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='active') AS active
  FROM collection_jobs WHERE id IN (360,387,390) ORDER BY id
`);
console.log(check.rows);
await c.end();
