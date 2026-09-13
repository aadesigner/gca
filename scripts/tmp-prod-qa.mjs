/**
 * Post-deploy QA: health, first-reg duplicates, sample VIN collapse, job health.
 */
import pg from "pg";

const password = process.env.PROD_PG_PASSWORD;
if (!password) throw new Error("PROD_PG_PASSWORD required");

const applyHeal = process.argv.includes("--heal");

const API_CANDIDATES = [
  "https://getcarapi.com",
  "https://www.getcarapi.com",
  "https://api.getcarapi.com",
];

async function tryHealth() {
  const out = [];
  for (const base of API_CANDIDATES) {
    for (const path of ["/api/healthz", "/api/healthz/db", "/healthz"]) {
      const url = `${base}${path}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        const text = await res.text();
        out.push({ url, status: res.status, body: text.slice(0, 180) });
      } catch (e) {
        out.push({ url, error: String(e.message || e) });
      }
    }
  }
  return out;
}

function parseMeta(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function score(row) {
  const meta = parseMeta(row.metadata);
  const value =
    String(meta.value ?? "").trim() ||
    (String(row.description ?? "").match(/First registration:\s*(.+)$/i)?.[1]?.trim() ?? "");
  let s = 0;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) s += 100;
  else if (/^\d{4}-\d{2}$/.test(value)) s += 50;
  else if (/^\d{4}$/.test(value)) s += 10;
  else if (value) s += 5;
  const source = String(meta.source ?? "");
  if (source === "productionYear") s -= 40;
  if (/kbchachacha|encar|autowini|inspection|autoplac|mobilede|autoscout/i.test(source)) s += 25;
  return s;
}

const health = await tryHealth();

const prod = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  ssl: false,
  connectionTimeoutMillis: 20_000,
});
await prod.connect();

const multi = (
  await prod.query(`
  SELECT count(*)::int AS vins
  FROM (
    SELECT vehicle_id
    FROM vehicle_events
    WHERE event_type = 'delivery'
      AND (
        description ILIKE '%first registration%'
        OR metadata::text ILIKE '%firstRegistration%'
      )
    GROUP BY vehicle_id
    HAVING count(*) > 1
  ) t
`)
).rows[0];

const sampleBefore = (
  await prod.query(`
  WITH multi AS (
    SELECT vehicle_id, count(*)::int AS n
    FROM vehicle_events
    WHERE event_type = 'delivery'
      AND (description ILIKE '%first registration%' OR metadata::text ILIKE '%firstRegistration%')
    GROUP BY vehicle_id
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 1
  )
  SELECT v.vin, e.id, e.description, e.occurred_at::date AS d, left(e.metadata::text, 100) AS meta
  FROM multi m
  JOIN vehicles v ON v.id = m.vehicle_id
  JOIN vehicle_events e ON e.vehicle_id = m.vehicle_id
  WHERE e.event_type = 'delivery'
    AND (e.description ILIKE '%first registration%' OR e.metadata::text ILIKE '%firstRegistration%')
  ORDER BY e.id
`)
).rows;

let heal = null;
if (applyHeal && Number(multi.vins) > 0) {
  const ids = (
    await prod.query(`
    SELECT vehicle_id
    FROM vehicle_events
    WHERE event_type = 'delivery'
      AND (description ILIKE '%first registration%' OR metadata::text ILIKE '%firstRegistration%')
    GROUP BY vehicle_id
    HAVING count(*) > 1
  `)
  ).rows;
  let deleted = 0;
  for (const { vehicle_id } of ids) {
    const rows = (
      await prod.query(
        `
      SELECT id, description, metadata, occurred_at
      FROM vehicle_events
      WHERE vehicle_id = $1 AND event_type = 'delivery'
        AND (description ILIKE '%first registration%' OR metadata::text ILIKE '%firstRegistration%')
      ORDER BY id
    `,
        [vehicle_id],
      )
    ).rows;
    rows.sort((a, b) => {
      const ds = score(b) - score(a);
      if (ds !== 0) return ds;
      return new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
    });
    const drop = rows.slice(1).map((r) => r.id);
    if (!drop.length) continue;
    await prod.query(`DELETE FROM vehicle_events WHERE id = ANY($1::int[])`, [drop]);
    deleted += drop.length;
  }
  heal = { vins: ids.length, deleted };
}

const multiAfter = (
  await prod.query(`
  SELECT count(*)::int AS vins
  FROM (
    SELECT vehicle_id
    FROM vehicle_events
    WHERE event_type = 'delivery'
      AND (description ILIKE '%first registration%' OR metadata::text ILIKE '%firstRegistration%')
    GROUP BY vehicle_id
    HAVING count(*) > 1
  ) t
`)
).rows[0];

const sampleVin = sampleBefore[0]?.vin ?? "KMHF141CBJA119089";
const sampleAfter = (
  await prod.query(
    `
  SELECT e.description, e.occurred_at::date AS d, left(e.metadata::text, 120) AS meta
  FROM vehicle_events e
  JOIN vehicles v ON v.id = e.vehicle_id
  WHERE v.vin = $1
    AND e.event_type = 'delivery'
    AND (e.description ILIKE '%first registration%' OR e.metadata::text ILIKE '%firstRegistration%')
  ORDER BY e.id
`,
    [sampleVin],
  )
).rows;

const jobs = (
  await prod.query(`
  SELECT cj.id, p.internal_name, cj.status,
         cj.items_processed, cj.vins_new,
         cj.updated_at, cj.error_message,
         EXTRACT(EPOCH FROM (now() - cj.updated_at))/60 AS quiet_min
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status IN ('running','pending','queued','failed')
     OR cj.updated_at > now() - interval '6 hours'
  ORDER BY cj.updated_at DESC
  LIMIT 20
`)
).rows;

const orphanRunning = (
  await prod.query(`
  SELECT count(*)::int AS n
  FROM collection_jobs
  WHERE status = 'running'
    AND updated_at < now() - interval '20 minutes'
`)
).rows[0];

const vehicles = (await prod.query(`SELECT count(*)::int AS n FROM vehicles`)).rows[0];

console.log(
  JSON.stringify(
    {
      health,
      vehicles: vehicles.n,
      first_reg_multi_before: multi.vins,
      heal,
      first_reg_multi_after: multiAfter.vins,
      sample_vin: sampleVin,
      sample_before_count: sampleBefore.length,
      sample_after: sampleAfter,
      orphan_running_quiet_20m: orphanRunning.n,
      recent_jobs: jobs.map((j) => ({
        id: j.id,
        p: j.internal_name,
        status: j.status,
        items: j.items_processed,
        neu: j.vins_new,
        quiet_min: Math.round(Number(j.quiet_min) * 10) / 10,
        err: j.error_message ? String(j.error_message).slice(0, 80) : null,
      })),
    },
    null,
    2,
  ),
);

await prod.end();
