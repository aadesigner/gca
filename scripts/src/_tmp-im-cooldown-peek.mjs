import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: url.includes("sslmode=") ? url : `${url}?sslmode=disable`,
});
await c.connect();
const { rows } = await c.query(`SELECT crawl_state, status FROM collection_jobs WHERE id=360`);
let state = rows[0]?.crawl_state;
if (typeof state === "string") state = JSON.parse(state);
const cool = (state.shards || []).filter((s) => s.status === "cooldown");
console.log(
  "cooldown_now",
  cool.map((s) => ({ id: s.id, err: String(s.lastError || "").slice(0, 100), until: s.cooldownUntil })),
);
await c.end();
