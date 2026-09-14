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
  SELECT photo_group, sort_order, source_url
  FROM photos p
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE v.vin = $1
  ORDER BY CASE photo_group
    WHEN 'gallery' THEN 0
    WHEN 'exterior_3d' THEN 1
    WHEN 'interior_3d' THEN 2
    ELSE 3 END, sort_order
`,
  [VIN],
);
const by = {};
for (const r of rows.rows) {
  by[r.photo_group] = by[r.photo_group] || [];
  by[r.photo_group].push(r);
}
for (const [g, list] of Object.entries(by)) {
  console.log("\n==", g, list.length);
  for (const p of list.slice(0, 6)) console.log(p.sort_order, p.source_url);
  if (list.length > 6) console.log("...");
  const kinds = {
    STP: list.filter((x) => /~STP~|SID~STP/i.test(x.source_url)).length,
    INT: list.filter((x) => /~INT~|SID~INT|InteriorImageRetriever/i.test(x.source_url)).length,
    ThreeSixty: list.filter((x) => /ThreeSixtyImageRetriever/i.test(x.source_url)).length,
    InteriorRet: list.filter((x) => /InteriorImageRetriever/i.test(x.source_url)).length,
    other: list.filter(
      (x) =>
        !/~STP~|SID~STP|~INT~|SID~INT|ThreeSixtyImageRetriever|InteriorImageRetriever/i.test(
          x.source_url,
        ),
    ).length,
  };
  console.log("kinds", kinds);
}
await c.end();
