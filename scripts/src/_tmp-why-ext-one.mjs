import fs from "node:fs";
import pg from "pg";

const VIN = "3N1AB7AP6KY202307";
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
const rows = await c.query(
  `
  SELECT photo_group, sort_order, source_url, stored_url, cdn_url
  FROM photos p
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE v.vin = $1 AND photo_group IN ('exterior_3d','interior_3d')
  ORDER BY photo_group, sort_order
`,
  [VIN],
).catch(async (e) => {
  console.log("col err", e.message);
  return c.query(
    `
    SELECT photo_group, sort_order, source_url
    FROM photos p JOIN vehicles v ON v.id = p.vehicle_id
    WHERE v.vin = $1 AND photo_group IN ('exterior_3d','interior_3d')
    ORDER BY photo_group, sort_order
  `,
    [VIN],
  );
});
console.log("count", rows.rows.length);
for (const r of rows.rows) {
  console.log(r.photo_group, r.sort_order, (r.cdn_url || r.stored_url || r.source_url || "").slice(0, 140));
}

// probe a few exterior frames
const stock = "46585942";
for (const i of [1, 2, 6, 12]) {
  const u = `https://mediaretriever.iaai.com/api/ThreeSixtyImageRetriever?tenant=iaai&partitionKey=${stock}&imageOrder=${i}`;
  const r = await fetch(u, {
    method: "HEAD",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  console.log("ext", i, r.status, r.headers.get("content-type"), r.headers.get("content-length"));
}
const pano = `https://mediaretriever.iaai.com/api/InteriorImageRetriever?tenant=iaai&partitionKey=${stock}`;
const pr = await fetch(pano, {
  method: "HEAD",
  signal: AbortSignal.timeout(8000),
  headers: { "User-Agent": "Mozilla/5.0" },
});
console.log("pano", pr.status, pr.headers.get("content-type"), pr.headers.get("content-length"));
await c.end();
