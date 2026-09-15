import fs from "node:fs";
import pg from "pg";

async function countLocal() {
  const c = new pg.Client({
    connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
  });
  await c.connect();
  const r = await c.query(
    "SELECT count(*)::int AS n FROM photos WHERE photo_group = 'interior_3d'",
  );
  console.log("local_interior_3d", r.rows[0].n);
  await c.end();
  return r.rows[0].n;
}

async function purgeLocal() {
  const c = new pg.Client({
    connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
  });
  await c.connect();
  await c.query("SET deadlock_timeout = '1s'");
  let total = 0;
  for (;;) {
    try {
      const del = await c.query(`
        DELETE FROM photos
        WHERE ctid IN (
          SELECT ctid FROM photos WHERE photo_group = 'interior_3d' LIMIT 2000
        )
        RETURNING id
      `);
      total += del.rowCount;
      console.log("local batch", del.rowCount, "total", total);
      if (!del.rowCount) break;
    } catch (e) {
      console.log("retry after", e.code || e.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.log("local purged", total);
  await c.end();
}

async function countProdSuspect() {
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
  const int = await c.query(
    "SELECT count(*)::int AS n FROM photos WHERE photo_group = 'interior_3d'",
  );
  console.log("prod_interior_3d", int.rows[0].n);
  await c.end();
}

const left = await countLocal();
if (left > 0) await purgeLocal();
await countLocal();
await countProdSuspect();
