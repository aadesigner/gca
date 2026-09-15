import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const cols = await c.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'listings'
  ORDER BY ordinal_position
`);
console.log(
  "listingCols",
  cols.rows.map((r) => r.column_name).filter((n) => /raw|html|payload|meta|json/i.test(n)),
);

for (const id of [1593536, 1593537, 1593538]) {
  const r = await c.query(
    `SELECT id, vin, source_id, first_seen_at, last_seen_at, created_at, updated_at
     FROM listings WHERE id = $1`,
    [id],
  );
  console.log(r.rows[0]);
}

// Check raw_listing_snapshots or similar
const tables = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (
    table_name ILIKE '%raw%' OR table_name ILIKE '%snapshot%' OR table_name ILIKE '%fetch%'
  )
`);
console.log("rawTables", tables.rows);

await c.end();
