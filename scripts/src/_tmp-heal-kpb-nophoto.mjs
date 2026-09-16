/**
 * Heal KPBPH3AT1PP024362: replace dead BidDrive CDN seed with live Encar photo.
 *   node ./scripts/src/_tmp-heal-kpb-nophoto.mjs --prod
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const VIN = "KPBPH3AT1PP024362";
const GOOD =
  "https://ci.encar.com/carpicture/carpicture10/pic4230/42305041_001.jpg";
const PROD = process.argv.includes("--prod");

function loadUrl() {
  if (!PROD) return "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip";
  const raw = fs.readFileSync(path.join(process.env.TEMP || "/tmp", "gca-pg-vars-prod.json"), "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || "postgres")}:${encodeURIComponent(get("PGPASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

const c = new pg.Client({
  connectionString: loadUrl(),
  ssl: PROD ? { rejectUnauthorized: false } : false,
});
await c.connect();

const v = (await c.query(`SELECT id FROM vehicles WHERE vin=$1`, [VIN])).rows[0];
if (!v) {
  console.log("missing");
  await c.end();
  process.exit(1);
}

const before = await c.query(
  `SELECT id, source_url, stored_path FROM photos WHERE vehicle_id=$1`,
  [v.id],
);
console.log("before", before.rows);

const dead = before.rows.filter((r) => /cdn\.thebidrive\.com\/encar\/42305041\/0\.webp/i.test(r.source_url));
if (dead.length) {
  const upd = await c.query(
    `UPDATE photos
     SET source_url=$1, stored_path=NULL, is_primary=true, sort_order=0, photo_group='gallery'
     WHERE id=$2
     RETURNING id, source_url, stored_path`,
    [GOOD, dead[0].id],
  );
  console.log("updated", upd.rows);
} else if (before.rows.length === 0) {
  const listing = (
    await c.query(
      `SELECT id FROM listings WHERE vehicle_id=$1 ORDER BY id DESC LIMIT 1`,
      [v.id],
    )
  ).rows[0];
  const ins = await c.query(
    `INSERT INTO photos (vehicle_id, listing_id, source_url, is_primary, sort_order, photo_group)
     VALUES ($1,$2,$3,true,0,'gallery')
     RETURNING id, source_url`,
    [v.id, listing?.id ?? null, GOOD],
  );
  console.log("inserted", ins.rows);
} else {
  console.log("already has other photos; clearing mirror-failed only");
  await c.query(
    `UPDATE photos SET stored_path=NULL WHERE vehicle_id=$1 AND stored_path LIKE 'mirror-failed:%'`,
    [v.id],
  );
}

const after = await c.query(
  `SELECT id, left(source_url,100) AS src, stored_path FROM photos WHERE vehicle_id=$1`,
  [v.id],
);
console.log("after", after.rows);
await c.end();
