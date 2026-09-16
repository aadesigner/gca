import pg from "pg";
const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();
for (const id of [360, 387, 390]) {
  await c.query(
    `UPDATE collection_jobs
     SET status='pending', error_message=NULL, started_at=NULL, completed_at=NULL, updated_at=now()
     WHERE id=$1 AND status IN ('running','paused','pending')`,
    [id],
  );
}
const rows = await c.query(
  `SELECT id, status, updated_at FROM collection_jobs WHERE id IN (360,387,390) ORDER BY id`,
);
console.log(rows.rows);
await c.end();
