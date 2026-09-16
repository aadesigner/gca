/**
 * Diagnose why Encar body diagrams are missing despite diagnosis comments.
 */
import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: url.includes("sslmode=")
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
});
await c.connect();

const samples = await c.query(`
  SELECT v.id AS vehicle_id, v.vin,
         e.id AS event_id, e.event_type, e.description,
         e.occurred_at,
         e.metadata
  FROM vehicle_events e
  JOIN vehicles v ON v.id = e.vehicle_id
  WHERE e.description ILIKE '%Encar diagnosis%'
    AND e.created_at > now() - interval '7 days'
  ORDER BY e.created_at DESC
  LIMIT 25
`);

console.log("=== recent diagnosis text events ===");
for (const r of samples.rows) {
  const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {};
  console.log({
    vin: r.vin,
    vehicle_id: r.vehicle_id,
    event_type: r.event_type,
    desc: String(r.description).slice(0, 140),
    bodyCondition: meta.bodyCondition ?? false,
    panels: Array.isArray(meta.panels) ? meta.panels.length : 0,
    source: meta.source,
    keys: Object.keys(meta),
  });
}

const withPanels = await c.query(`
  SELECT count(*)::int AS n
  FROM vehicle_events
  WHERE created_at > now() - interval '7 days'
    AND metadata::text ILIKE '%"bodyCondition":true%'
`);
const diagComments = await c.query(`
  SELECT count(*)::int AS n
  FROM vehicle_events
  WHERE created_at > now() - interval '7 days'
    AND description ILIKE '%Encar diagnosis%'
`);
const panelEvents = await c.query(`
  SELECT count(*)::int AS n
  FROM vehicle_events
  WHERE created_at > now() - interval '7 days'
    AND description ILIKE 'Encar diagnosis —%'
`);

console.log("\n=== 7d counts ===", {
  diagnosis_comment_events: diagComments.rows[0].n,
  bodyCondition_true_events: withPanels.rows[0].n,
  panel_summary_events: panelEvents.rows[0].n,
});

// Peek raw JSON for a recent encar listing with diagnosis comment vehicle
const raw = await c.query(`
  SELECT l.id, l.source_id, v.vin,
         left(r.raw_json::text, 200) AS head,
         (r.raw_json::jsonb -> 'diagnosis') IS NOT NULL AS has_diag,
         jsonb_typeof(r.raw_json::jsonb -> 'diagnosis') AS diag_type,
         jsonb_array_length(COALESCE(r.raw_json::jsonb -> 'diagnosis' -> 'items', '[]'::jsonb)) AS diag_items,
         (r.raw_json::jsonb -> 'inspection') IS NOT NULL AS has_insp
  FROM listings l
  JOIN vehicles v ON v.id = l.vehicle_id
  JOIN raw_source_records r ON r.listing_id = l.id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'encar'
    AND l.created_at > now() - interval '3 days'
    AND r.raw_json::text ILIKE '%CHECKER_COMMENT%'
  ORDER BY l.created_at DESC
  LIMIT 5
`);
console.log("\n=== raw samples with CHECKER_COMMENT ===");
console.log(raw.rows);

if (raw.rows[0]) {
  const full = await c.query(
    `
    SELECT r.raw_json::jsonb -> 'diagnosis' AS diagnosis
    FROM raw_source_records r
    WHERE r.listing_id = $1
    ORDER BY r.id DESC
    LIMIT 1
    `,
    [raw.rows[0].id],
  );
  const diag = full.rows[0]?.diagnosis;
  const items = Array.isArray(diag?.items) ? diag.items : [];
  console.log("\n=== diagnosis item names/results (sample) ===");
  console.log({
    vin: raw.rows[0].vin,
    diagnosisNo: diag?.diagnosisNo,
    itemCount: items.length,
    items: items.slice(0, 40).map((it) => ({
      name: it?.name,
      resultCode: it?.resultCode,
      result: String(it?.result ?? "").slice(0, 80),
      type: it?.type,
      statusType: it?.statusType,
    })),
  });
}

await c.end();
