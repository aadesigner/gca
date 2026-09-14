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
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const names = [
  "koreaauto_auction",
  "carpoolkr",
  "seobuk",
  "koreausedcars",
  "mobilede",
  "finn",
  "willhaben",
  "japanesecartrade",
  "autoscout24",
  "otomoto",
  "aaaauto",
  "sauto",
  "nettiauto",
  "autovit",
  "encar",
  "autowini",
  "kolon_auto",
];

const r = await c.query(
  `
  SELECT p.internal_name,
         p.enabled,
         count(DISTINCT l.id)::int AS listings,
         count(DISTINCT l.vehicle_id)::int AS vehicles,
         count(DISTINCT l.id) FILTER (WHERE v.vin IS NOT NULL AND length(v.vin)=17)::int AS with_vin,
         round(
           100.0 * count(DISTINCT l.id) FILTER (WHERE v.vin IS NOT NULL AND length(v.vin)=17)
           / NULLIF(count(DISTINCT l.id),0),
           1
         ) AS vin_pct,
         max(l.created_at) AS newest
  FROM providers p
  LEFT JOIN listings l ON l.provider_id = p.id
  LEFT JOIN vehicles v ON v.id = l.vehicle_id
  WHERE p.internal_name = ANY($1::text[])
  GROUP BY p.internal_name, p.enabled
  ORDER BY with_vin DESC NULLS LAST, listings DESC
`,
  [names],
);

console.log(JSON.stringify(r.rows, null, 2));
await c.end();
