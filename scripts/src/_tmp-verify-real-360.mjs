import fs from "node:fs";
import pg from "pg";
const VIN = "WVWED71K98W309297";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
for (const vin of ["WVWED71K98W309297","WA1EAAGU4S2109497","JF2GTHSC1MH217688"]) {
  const r = await c.query(`
    SELECT photo_group, count(*) n,
      min(left(source_url,100)) sample,
      count(DISTINCT COALESCE(
        (regexp_match(source_url,'partitionKey=(\\d{6,})','i'))[1],
        (regexp_match(source_url,'imageKeys=(\\d{6,})','i'))[1]
      )) stocks
    FROM photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE v.vin=$1
    GROUP BY 1 ORDER BY 1
  `, [vin]);
  console.log(vin, r.rows);
}
const prius = await c.query(`SELECT photo_group, count(*) n FROM photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE v.vin='JTDKDTB34C1517287' GROUP BY 1`);
console.log("priusNow", prius.rows);
await c.end();
