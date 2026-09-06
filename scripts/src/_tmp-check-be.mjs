import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query("select id,name,internal_name,enabled from providers where internal_name=$1",["bidexport"]);
console.log(r.rows);
await c.end();
