/**
 * Drop foreign Encar listing frames mixed onto an Import Motor VIN.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-vin-photos.mjs
 */
import fs from "node:fs";
import pg from "pg";

const VIN = "WBAKV2108F0N16570";
const KEEP_LOT = "42795767";

function prodUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const sql = `
  DELETE FROM photos p
  USING vehicles v
  WHERE p.vehicle_id = v.id
    AND v.vin = $1
    AND p.source_url ILIKE '%ci.encar.com%'
    AND p.source_url NOT ILIKE '%/' || $2 || '_%'
`;

for (const [name, cfg] of [
  ["local", { connectionString: process.env.DATABASE_URL }],
  ["prod", { connectionString: prodUrl(), ssl: { rejectUnauthorized: false } }],
]) {
  const c = new pg.Client(cfg);
  await c.connect();
  await c.query("SET statement_timeout = '15s'");
  const before = await c.query(
    `SELECT count(*)::int AS n FROM photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE v.vin=$1`,
    [VIN],
  );
  const del = await c.query(sql, [VIN, KEEP_LOT]);
  const after = await c.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE source_url ILIKE '%ci.encar.com%' AND source_url NOT ILIKE '%/${KEEP_LOT}_%')::int AS foreign
     FROM photos p JOIN vehicles v ON v.id=p.vehicle_id WHERE v.vin=$1`,
    [VIN],
  );
  console.log(name, { photosBefore: before.rows[0].n, deleted: del.rowCount, after: after.rows[0] });
  await c.end();
}
