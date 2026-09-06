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

const aaa = (await c.query(`SELECT id FROM providers WHERE internal_name='aaaauto'`)).rows[0].id;

const events = await c.query(
  `
  SELECT e.event_type, e.description, e.occurred_at, e.metadata, v.make, v.model, v.vin
  FROM vehicle_events e
  JOIN vehicles v ON v.id = e.vehicle_id
  JOIN listings l ON l.vehicle_id = v.id
  WHERE l.provider_id = $1
  ORDER BY e.id DESC
  LIMIT 40
  `,
  [aaa],
);
console.log("=== aaaauto recent events ===");
for (const r of events.rows) {
  console.log(r.event_type, "|", r.description, "|", r.occurred_at?.toISOString?.()?.slice(0, 10), "|", r.make, r.model);
}

const vehicles = await c.query(
  `
  SELECT v.make, v.model, v.trim, v.fuel_type, v.transmission, v.body_type, v.color, v.year, l.title
  FROM listings l JOIN vehicles v ON v.id = l.vehicle_id
  WHERE l.provider_id = $1
  ORDER BY l.id DESC LIMIT 15
  `,
  [aaa],
);
console.log("\n=== vehicle detail samples ===");
for (const r of vehicles.rows) console.log(r);

const distinct = await c.query(
  `
  SELECT 'fuel' AS k, v.fuel_type AS v, count(*)::int n FROM listings l JOIN vehicles v ON v.id=l.vehicle_id WHERE l.provider_id=$1 GROUP BY 2
  UNION ALL
  SELECT 'trans', v.transmission, count(*)::int FROM listings l JOIN vehicles v ON v.id=l.vehicle_id WHERE l.provider_id=$1 GROUP BY 2
  UNION ALL
  SELECT 'body', v.body_type, count(*)::int FROM listings l JOIN vehicles v ON v.id=l.vehicle_id WHERE l.provider_id=$1 GROUP BY 2
  UNION ALL
  SELECT 'color', v.color, count(*)::int FROM listings l JOIN vehicles v ON v.id=l.vehicle_id WHERE l.provider_id=$1 GROUP BY 2
  ORDER BY 1, 3 DESC
  `,
  [aaa],
);
console.log("\n=== distinct field values ===");
for (const r of distinct.rows) console.log(r.k, r.n, r.v);

const eventDesc = await c.query(
  `
  SELECT e.description, count(*)::int n
  FROM vehicle_events e
  JOIN listings l ON l.vehicle_id = e.vehicle_id
  WHERE l.provider_id = $1
  GROUP BY 1 ORDER BY n DESC LIMIT 30
  `,
  [aaa],
);
console.log("\n=== top event descriptions ===");
for (const r of eventDesc.rows) console.log(r.n, r.description);

await c.end();
