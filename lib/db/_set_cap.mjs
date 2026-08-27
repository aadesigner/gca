import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});

await pool.query(`UPDATE settings SET max_collection_jobs_parallel = 10000, updated_at = NOW() WHERE id = 1`);
await pool.query(`UPDATE providers SET parser_version = 'bat-v1.1.0', updated_at = NOW() WHERE internal_name = 'bringatrailer'`);

const cap = await pool.query(`SELECT max_collection_jobs_parallel FROM settings WHERE id = 1`);
console.log("CAP", cap.rows[0]);

await pool.end();
