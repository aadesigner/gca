import pg from "pg";
import { pathToFileURL } from "node:url";
import path from "node:path";

const base = (process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip").replace(
  /[?&]sslmode=[^&]+/i,
  "",
);
const { buildBodyCondition } = await import(
  pathToFileURL(path.resolve("artifacts/api-server/src/lib/body-condition.ts")).href
);

const c = new pg.Client({ connectionString: `${base}?sslmode=disable` });
await c.connect();

async function checkVin(vin) {
  const v = (await c.query(`SELECT id, make, model, year FROM vehicles WHERE vin=$1`, [vin])).rows[0];
  if (!v) return { vin, missing: true };
  const events = (
    await c.query(
      `
      SELECT event_type AS "eventType", description, occurred_at AS "occurredAt", metadata
      FROM vehicle_events WHERE vehicle_id=$1
      `,
      [v.id],
    )
  ).rows.map((e) => ({
    ...e,
    metadata: (() => {
      try {
        return e.metadata ? JSON.parse(e.metadata) : null;
      } catch {
        return e.metadata;
      }
    })(),
  }));
  const bc = buildBodyCondition(events);
  return {
    vin,
    make: v.make,
    model: v.model,
    year: v.year,
    panels: bc?.panels?.length ?? 0,
    date: bc?.date ?? null,
    source: bc?.source ?? null,
    sample: (bc?.panels ?? []).slice(0, 5).map((p) => `${p.legend}:${p.label}`),
  };
}

const free = [
  "WBS3C910XFP708160",
  "WDDUX8GB8JA397509",
  "ZAM57XSA4E1123233",
  "1FA6P8CF5K5120103",
  "ZAM57XSA5H1238315",
];

console.log("=== free test vins ===");
for (const vin of free) console.log(await checkVin(vin));

const rich = await c.query(`
  SELECT v.vin
  FROM vehicles v
  JOIN vehicle_events ve ON ve.vehicle_id = v.id
  WHERE ve.metadata::text ILIKE '%"panels":[{%'
     OR ve.metadata::text ILIKE '%bodyCondition%:true%'
  GROUP BY v.vin
  ORDER BY count(*) DESC
  LIMIT 20
`);

console.log("\n=== rich body panel vins ===");
for (const row of rich.rows.slice(0, 12)) {
  console.log(await checkVin(row.vin));
}

await c.end();
