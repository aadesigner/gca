/**
 * Cheap 360 check: VIN lookups + PK id-range samples. No photos seq scan.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-360-prod-safe.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-360-prod-safe.mjs --prod
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-360-prod-safe.mjs --prod --apply
 */
import fs from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const WANT_PROD = process.argv.includes("--prod");

function prodUrl() {
  if (process.env.PROD_DATABASE_URL) return process.env.PROD_DATABASE_URL;
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
}

function kindOf(url) {
  const u = String(url || "");
  if (/ThreeSixtyImageRetriever/i.test(u)) return "retriever";
  if (/~SID~STP~|SID%7ESTP/i.test(u)) return "stp";
  if (/~SID~INT~|SID%7EINT/i.test(u)) return "int";
  if (/~S0~|S0~I/i.test(u)) return "s0_still";
  if (/vis\.iaai\.com/i.test(u)) return "iaa_resizer_other";
  return "other";
}

async function run(name, cfg) {
  const c = new pg.Client(cfg);
  await c.connect();
  await c.query("SET statement_timeout = '12s'");

  const seq = await c.query("SELECT last_value::bigint AS n FROM photos_id_seq");
  const hi = Number(seq.rows[0].n);
  const recentSlice = await c.query(
    `
    SELECT photo_group, left(source_url, 130) AS url
    FROM photos
    WHERE id > $1 AND photo_group IN ('exterior_3d', 'interior_3d')
    ORDER BY id DESC
    LIMIT 40
    `,
    [hi - 30000],
  );
  const recentKinds = {};
  for (const r of recentSlice.rows) {
    const k = `${r.photo_group}:${kindOf(r.url)}`;
    recentKinds[k] = (recentKinds[k] || 0) + 1;
  }
  console.log(name, { photosSeq: hi, recent3dKinds: recentKinds, recent3dSamples: recentSlice.rows.slice(0, 8) });

  const oldLo = Math.max(1, Math.floor(hi * 0.35));
  const oldSlice = await c.query(
    `
    SELECT left(source_url, 130) AS url
    FROM photos
    WHERE id BETWEEN $1 AND $2 AND photo_group = 'exterior_3d'
    LIMIT 20
    `,
    [oldLo, oldLo + 8000],
  );
  const oldKinds = {};
  for (const r of oldSlice.rows) oldKinds[kindOf(r.url)] = (oldKinds[kindOf(r.url)] || 0) + 1;
  console.log(name, { oldSliceStart: oldLo, oldKinds, oldSamples: oldSlice.rows.slice(0, 6) });

  const newVeh = await c.query(`
    SELECT v.id, v.vin
    FROM vehicles v
    WHERE v.created_at > now() - interval '48 hours'
  `);
  const vids = newVeh.rows.map((r) => r.id);
  console.log(name, { vehiclesLast48h: vids.length });

  let fake = [];
  if (vids.length) {
    const rows = await c.query(
      `
      SELECT v.vin, count(*)::int AS n,
             count(*) FILTER (WHERE p.source_url ILIKE '%ThreeSixtyImageRetriever%')::int AS retriever,
             count(*) FILTER (WHERE p.source_url ILIKE '%~SID~STP~%' OR p.source_url ILIKE '%SID%7ESTP%')::int AS stp,
             count(*) FILTER (
               WHERE p.source_url NOT ILIKE '%ThreeSixtyImageRetriever%'
                 AND p.source_url NOT ILIKE '%~SID~STP~%'
             )::int AS other
      FROM photos p
      JOIN vehicles v ON v.id = p.vehicle_id
      WHERE p.vehicle_id = ANY($1::int[])
        AND p.photo_group = 'exterior_3d'
      GROUP BY v.vin
      `,
      [vids],
    );
    fake = rows.rows.filter((r) => r.stp > 0 && r.stp < 16 && r.retriever === 0);
    const keep = rows.rows.filter((r) => r.retriever > 0 || r.stp >= 16);
    console.log(name, {
      newVehiclesWith360: rows.rows.length,
      keepReal: keep.length,
      fakeShortStp: fake.length,
      fakeVins: fake.slice(0, 25),
    });
  }

  const known = await c.query(
    `
    SELECT v.vin, p.photo_group,
           count(*)::int AS n,
           count(*) FILTER (WHERE p.source_url ILIKE '%ThreeSixtyImageRetriever%')::int AS retriever,
           count(*) FILTER (WHERE p.source_url ILIKE '%~SID~STP~%')::int AS stp
    FROM vehicles v
    JOIN photos p ON p.vehicle_id = v.id
    WHERE v.vin IN (
      '3VWD17AJ9EM396350','5NMSH73E37H070877','5NPEC4AC3BH125075','5XYZUDLB1EG141788'
    )
    GROUP BY 1, 2
    ORDER BY 1, 2
    `,
  );
  console.log(name, "knownVins", known.rows);

  if (APPLY && fake.length) {
    const vins = fake.map((r) => r.vin);
    const del = await c.query(
      `
      DELETE FROM photos p
      USING vehicles v
      WHERE p.vehicle_id = v.id
        AND v.vin = ANY($1::text[])
        AND p.photo_group = 'exterior_3d'
        AND (p.source_url ILIKE '%~SID~STP~%' OR p.source_url ILIKE '%SID%7ESTP%')
        AND NOT EXISTS (
          SELECT 1 FROM photos r
          WHERE r.vehicle_id = p.vehicle_id
            AND r.photo_group = 'exterior_3d'
            AND r.source_url ILIKE '%ThreeSixtyImageRetriever%'
        )
      `,
      [vins],
    );
    console.log(name, { deletedShortStp: del.rowCount, vins });
  } else if (!APPLY) {
    console.log(name, "dry-run");
  }

  await c.end();
}

await run("local", { connectionString: process.env.DATABASE_URL });
if (WANT_PROD) {
  await run("prod", { connectionString: prodUrl(), ssl: { rejectUnauthorized: false } });
}
