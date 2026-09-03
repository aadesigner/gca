import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`
  SELECT v.vin, ve.id AS event_id, ve.event_type, ve.description,
         left(coalesce(ve.metadata::text,''), 250) AS meta,
         p.internal_name
  FROM vehicle_events ve
  JOIN vehicles v ON v.id = ve.vehicle_id
  LEFT JOIN listings l ON l.vehicle_id = v.id
  LEFT JOIN providers p ON p.id = l.provider_id
  WHERE (
    ve.metadata::text ILIKE '%run_and_drive%'
    OR ve.metadata::text ILIKE '%run and drive%'
    OR ve.description ILIKE '%run_and_drive%'
    OR ve.description ILIKE '%Condition: run%'
  )
  AND (
    ve.metadata::text ILIKE '%salvage%'
    OR EXISTS (
      SELECT 1 FROM vehicle_events ve2
      WHERE ve2.vehicle_id = v.id
        AND (ve2.event_type = 'title_status' OR ve2.metadata::text ILIKE '%salvage%')
    )
  )
  AND (p.internal_name IN ('bidscan','copart','iaa','import_motor') OR p.internal_name IS NULL)
  ORDER BY ve.id DESC
  LIMIT 15
`);
console.log('sample', r.rows);
const counts = await c.query(`
  SELECT count(DISTINCT v.id)::int AS vins
  FROM vehicles v
  JOIN vehicle_events ve ON ve.vehicle_id = v.id
  WHERE ve.metadata::text ~* 'run[_ ]?and[_ ]?drive'
    AND EXISTS (
      SELECT 1 FROM vehicle_events ve2
      WHERE ve2.vehicle_id = v.id
        AND (
          ve2.event_type = 'title_status' AND ve2.metadata::text ILIKE '%\"salvage\": ?true%'
          OR ve2.metadata::text ILIKE '%\"salvage\":true%'
          OR ve2.description ILIKE '%salvage%'
        )
    )
`);
console.log('salvage vins with run_and_drive meta', counts.rows[0]);
await c.end();
