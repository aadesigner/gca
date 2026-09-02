import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const { rows } = await pool.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE state = 'active')::int AS active,
           (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS max_conn
    FROM pg_stat_activity
  `);
  console.log(rows[0]);
} finally {
  await pool.end();
}
