import fs from "node:fs";
import pg from "pg";

function loadProdUrl() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({
  connectionString: loadProdUrl(),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120000,
});
await c.connect();

let t = Date.now();
const light = await c.query(`
  SELECT p.id, p.name, count(distinct l.vehicle_id)::int AS count
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  GROUP BY p.id, p.name
  ORDER BY count DESC
`);
console.log("light byProvider", Date.now() - t + "ms", light.rows.length, light.rows.slice(0, 3));

t = Date.now();
const heavy = await c.query(`
  SELECT p.id, p.name, count(distinct l.vehicle_id)::int AS count
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  GROUP BY p.id, p.name
  ORDER BY count DESC
`);
console.log("heavy byProvider", Date.now() - t + "ms", heavy.rows.length);

// Parallel stress like Promise.all for import_motor
const providerId = 165;
t = Date.now();
try {
  await Promise.all([
    c.query(
      `SELECT count(*)::int AS c FROM vehicles v WHERE EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id=v.id AND l.provider_id=$1)`,
      [providerId],
    ),
    c.query(
      `SELECT make, count(*)::int AS c FROM vehicles v WHERE EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id=v.id AND l.provider_id=$1) GROUP BY make ORDER BY c DESC LIMIT 200`,
      [providerId],
    ),
    c.query(
      `SELECT country, count(*)::int AS c FROM vehicles v WHERE EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id=v.id AND l.provider_id=$1) GROUP BY country ORDER BY c DESC LIMIT 80`,
      [providerId],
    ),
    c.query(
      `SELECT year, count(*)::int AS c FROM vehicles v WHERE EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id=v.id AND l.provider_id=$1) GROUP BY year ORDER BY year DESC NULLS LAST LIMIT 80`,
      [providerId],
    ),
    c.query(
      `SELECT fuel_type, count(*)::int AS c FROM vehicles v WHERE EXISTS (SELECT 1 FROM listings l WHERE l.vehicle_id=v.id AND l.provider_id=$1) GROUP BY fuel_type ORDER BY c DESC LIMIT 40`,
      [providerId],
    ),
    c.query(`
      SELECT p.id, p.name, count(distinct l.vehicle_id)::int AS count
      FROM listings l
      JOIN providers p ON p.id = l.provider_id
      JOIN vehicles v ON v.id = l.vehicle_id
      GROUP BY p.id, p.name
      ORDER BY count DESC
    `),
  ]);
  console.log("parallel OK", Date.now() - t + "ms");
} catch (e) {
  console.error("parallel FAIL", Date.now() - t + "ms", e.message);
}

await c.end();
