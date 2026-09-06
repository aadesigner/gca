import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

const providers = ["sauto", "mobilebg", "standvirtual", "automobileit", "subito", "autoscout24_be", "autotradernl"];
for (const name of providers) {
  const p = (await c.query(`SELECT id FROM providers WHERE internal_name=$1`, [name])).rows[0];
  if (!p) continue;
  const colors = await c.query(
    `SELECT v.color, count(*)::int n FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.provider_id=$1 AND v.color IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 12`,
    [p.id],
  );
  const bodies = await c.query(
    `SELECT v.body_type, count(*)::int n FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.provider_id=$1 AND v.body_type IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 12`,
    [p.id],
  );
  const fuels = await c.query(
    `SELECT v.fuel_type, count(*)::int n FROM listings l JOIN vehicles v ON v.id=l.vehicle_id
     WHERE l.provider_id=$1 AND v.fuel_type IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    [p.id],
  );
  const events = await c.query(
    `SELECT e.description, count(*)::int n FROM vehicle_events e
     JOIN listings l ON l.vehicle_id=e.vehicle_id
     WHERE l.provider_id=$1 GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    [p.id],
  );
  console.log("\n====", name, "====");
  console.log("colors", colors.rows);
  console.log("bodies", bodies.rows);
  console.log("fuels", fuels.rows);
  console.log("events", events.rows);
}
await c.end();
