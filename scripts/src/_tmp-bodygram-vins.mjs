import pg from "pg";

const base = (process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip").replace(
  /[?&]sslmode=[^&]+/i,
  "",
);
const c = new pg.Client({ connectionString: `${base}?sslmode=disable` });
await c.connect();

// Events that feed buildBodyCondition
const samples = await c.query(`
  SELECT v.vin, v.make, v.model, v.year,
         count(*) FILTER (
           WHERE ve.metadata::text ILIKE '%bodyCondition%'
              OR ve.metadata::text ILIKE '%"panels"%'
              OR ve.metadata::text ILIKE '%encar_diagnosis%'
              OR ve.description ILIKE '%outer-panel%'
              OR ve.description ILIKE '%Encar diagnosis%'
         )::int AS body_events,
         count(*) FILTER (WHERE ve.metadata::text ILIKE '%"panels"%')::int AS with_panels_json,
         max(ve.occurred_at) AS latest
  FROM vehicles v
  JOIN vehicle_events ve ON ve.vehicle_id = v.id
  WHERE ve.metadata::text ILIKE '%bodyCondition%'
     OR ve.metadata::text ILIKE '%"panels"%'
     OR ve.metadata::text ILIKE '%encar_diagnosis%'
     OR ve.description ILIKE '%Encar diagnosis:%'
     OR ve.description ILIKE '%outer-panel%'
  GROUP BY v.id
  HAVING count(*) FILTER (
    WHERE ve.metadata::text ILIKE '%"panels"%'
       OR ve.metadata::text ILIKE '%bodyCondition%true%'
  ) > 0
  ORDER BY with_panels_json DESC, body_events DESC, latest DESC NULLS LAST
  LIMIT 15
`);
console.log("rich_body_vins", samples.rows);

// Peek one event with panels
if (samples.rows[0]) {
  const vin = samples.rows[0].vin;
  const ev = await c.query(
    `
    SELECT ve.event_type, left(ve.description, 120) AS description,
           left(ve.metadata::text, 500) AS meta
    FROM vehicle_events ve
    JOIN vehicles v ON v.id = ve.vehicle_id
    WHERE v.vin = $1
      AND (ve.metadata::text ILIKE '%panels%' OR ve.metadata::text ILIKE '%bodyCondition%')
    ORDER BY ve.id DESC
    LIMIT 3
    `,
    [vin],
  );
  console.log("sample_events_for", vin, ev.rows);
}

// Free test VINs that also have body data
const known = [
  "WBS3C910XFP708160",
  "KMHEM41BBBA000000",
];
const testList = (
  await import("../artifacts/api-server/src/lib/test-vins.ts").catch(() => null)
);
// fallback query known free VIN
const free = await c.query(
  `
  SELECT v.vin, v.make, v.model, v.year,
    EXISTS (
      SELECT 1 FROM vehicle_events ve
      WHERE ve.vehicle_id = v.id
        AND (ve.metadata::text ILIKE '%panels%' OR ve.metadata::text ILIKE '%bodyCondition%true%')
    ) AS has_body
  FROM vehicles v
  WHERE v.vin = ANY($1::text[])
  `,
  [["WBS3C910XFP708160"]],
);
console.log("free_vin_body", free.rows);

await c.end();
