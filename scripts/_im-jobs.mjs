import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip" });
const jobs = await pool.query(`
  SELECT id, status, provider_id, job_type, job_config, crawl_state, listings_fetched, pages_processed, error_message
  FROM collection_jobs WHERE id IN (351,354) OR (job_config::text ILIKE '%import%' OR job_config::text ILIKE '%motor%')
  ORDER BY id DESC LIMIT 8
`);
for (const j of jobs.rows) {
  console.log({ id: j.id, status: j.status, fetched: j.listings_fetched, pages: j.pages_processed, err: j.error_message });
  console.log("config", typeof j.job_config === "string" ? j.job_config.slice(0,400) : JSON.stringify(j.job_config).slice(0,400));
  const cs = typeof j.crawl_state === "string" ? JSON.parse(j.crawl_state) : j.crawl_state;
  if (cs?.shards) console.log("shards", cs.shards.slice(0,3).map(s=>({country:s.country||s.code||s.id, status:s.status, page:s.page})));
  console.log("---");
}
const p = await pool.query(`SELECT id, name, internal_name FROM providers WHERE internal_name ILIKE '%import%' OR name ILIKE '%import%'`);
console.log("providers", p.rows);
await pool.end();
