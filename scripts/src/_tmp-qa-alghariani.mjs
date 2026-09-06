import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const CLIENT_ID = 21;
const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

const client = (
  await c.query(
    `SELECT id, name, email, credit_balance, is_active, is_demo, live_feed_enabled,
            rate_limit_per_minute, rate_limit_per_day, requests_per_vin, monthly_global_limit,
            allowed_endpoints, last_login_at, created_at
     FROM api_clients WHERE id=$1`,
    [CLIENT_ID],
  )
).rows[0];
console.log("=== CLIENT ===");
console.log(client);

const tokens = await c.query(
  `SELECT id, name, token_prefix, is_test_only, is_active, expires_at, last_used_at, revoked_at, created_at
   FROM api_tokens WHERE client_id=$1 ORDER BY id`,
  [CLIENT_ID],
);
console.log("\n=== TOKENS ===");
for (const t of tokens.rows) console.log(t);

const overview = await c.query(
  `
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE status_code BETWEEN 200 AND 299)::int AS ok,
    count(*) FILTER (WHERE status_code = 402)::int AS no_credits,
    count(*) FILTER (WHERE status_code = 403)::int AS forbidden,
    count(*) FILTER (WHERE status_code = 404)::int AS not_found,
    count(*) FILTER (WHERE status_code = 429)::int AS rate_limited,
    count(*) FILTER (WHERE status_code >= 500)::int AS server_err,
    count(*) FILTER (WHERE status_code BETWEEN 400 AND 499 AND status_code NOT IN (402,403,404,429))::int AS other_4xx,
    min(duration_ms)::int AS min_ms,
    avg(duration_ms)::int AS avg_ms,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
    max(duration_ms)::int AS max_ms,
    min(requested_at) AS first_at,
    max(requested_at) AS last_at
  FROM api_request_logs WHERE client_id=$1
  `,
  [CLIENT_ID],
);
console.log("\n=== USAGE OVERVIEW ===");
console.log(overview.rows[0]);

const byPath = await c.query(
  `
  SELECT
    CASE
      WHEN path LIKE '/v1/vin/check%' THEN 'check'
      WHEN path LIKE '/v1/vin/%' THEN 'retrieve'
      WHEN path LIKE '/v1/live%' THEN 'live'
      WHEN path LIKE '%test-vin%' THEN 'test-vins'
      ELSE path
    END AS kind,
    count(*)::int AS n,
    avg(duration_ms)::int AS avg_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
    max(duration_ms)::int AS max_ms,
    count(*) FILTER (WHERE status_code BETWEEN 200 AND 299)::int AS ok,
    count(*) FILTER (WHERE status_code = 402)::int AS s402,
    count(*) FILTER (WHERE status_code = 404)::int AS s404,
    count(*) FILTER (WHERE status_code >= 400)::int AS err
  FROM api_request_logs WHERE client_id=$1
  GROUP BY 1 ORDER BY n DESC
  `,
  [CLIENT_ID],
);
console.log("\n=== BY PATH KIND ===");
for (const r of byPath.rows) console.log(r);

const byHour = await c.query(
  `
  SELECT date_trunc('hour', requested_at) AS hour,
         count(*)::int AS n,
         avg(duration_ms)::int AS avg_ms,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95,
         max(duration_ms)::int AS max_ms,
         count(*) FILTER (WHERE status_code BETWEEN 200 AND 299)::int AS ok,
         count(*) FILTER (WHERE status_code >= 400)::int AS err
  FROM api_request_logs
  WHERE client_id=$1 AND requested_at > now() - interval '7 days'
  GROUP BY 1 ORDER BY 1
  `,
  [CLIENT_ID],
);
console.log("\n=== HOURLY (7d) ===");
for (const r of byHour.rows) {
  console.log(
    String(r.hour.toISOString()).slice(0, 16),
    `n=${r.n}`,
    `avg=${r.avg_ms}`,
    `p50=${r.p50}`,
    `p95=${r.p95}`,
    `max=${r.max_ms}`,
    `ok=${r.ok}`,
    `err=${r.err}`,
  );
}

const slow = await c.query(
  `
  SELECT id, requested_at, status_code, duration_ms, path, vin, method, ip_address,
         left(user_agent, 80) AS ua
  FROM api_request_logs
  WHERE client_id=$1
  ORDER BY duration_ms DESC
  LIMIT 15
  `,
  [CLIENT_ID],
);
console.log("\n=== SLOWEST 15 ===");
for (const r of slow.rows) {
  console.log(r.duration_ms + "ms", r.status_code, r.path, r.vin, r.requested_at?.toISOString?.() ?? r.requested_at);
}

const recent = await c.query(
  `
  SELECT requested_at, status_code, duration_ms, path, vin
  FROM api_request_logs
  WHERE client_id=$1
  ORDER BY requested_at DESC
  LIMIT 25
  `,
  [CLIENT_ID],
);
console.log("\n=== MOST RECENT 25 ===");
for (const r of recent.rows) {
  console.log(
    (r.requested_at?.toISOString?.() ?? r.requested_at).toString().slice(0, 19),
    r.status_code,
    (r.duration_ms + "ms").padStart(8),
    r.path,
    r.vin || "",
  );
}

const vins = await c.query(
  `
  SELECT vin, count(*)::int AS n,
         count(*) FILTER (WHERE status_code BETWEEN 200 AND 299)::int AS ok,
         count(*) FILTER (WHERE status_code = 402)::int AS s402,
         count(*) FILTER (WHERE status_code = 404)::int AS s404,
         avg(duration_ms)::int AS avg_ms,
         max(duration_ms)::int AS max_ms
  FROM api_request_logs
  WHERE client_id=$1 AND vin IS NOT NULL
  GROUP BY 1 ORDER BY n DESC LIMIT 20
  `,
  [CLIENT_ID],
);
console.log("\n=== TOP VINS ===");
for (const r of vins.rows) console.log(r);

const ledger = await c.query(
  `
  SELECT id, delta, balance_after, reason, created_at
  FROM credit_ledger WHERE client_id=$1 ORDER BY id DESC LIMIT 20
  `,
  [CLIENT_ID],
).catch((e) => ({ rows: [], error: e.message }));
console.log("\n=== CREDIT LEDGER ===");
console.log(ledger.error || ledger.rows);

const statusDist = await c.query(
  `
  SELECT status_code, count(*)::int AS n, avg(duration_ms)::int AS avg_ms, max(duration_ms)::int AS max_ms
  FROM api_request_logs WHERE client_id=$1
  GROUP BY 1 ORDER BY n DESC
  `,
  [CLIENT_ID],
);
console.log("\n=== STATUS DIST ===");
for (const r of statusDist.rows) console.log(r);

// Compare duration buckets: fast vs slow
const buckets = await c.query(
  `
  SELECT
    count(*) FILTER (WHERE duration_ms < 50)::int AS under_50,
    count(*) FILTER (WHERE duration_ms BETWEEN 50 AND 200)::int AS ms_50_200,
    count(*) FILTER (WHERE duration_ms BETWEEN 201 AND 1000)::int AS ms_200_1k,
    count(*) FILTER (WHERE duration_ms BETWEEN 1001 AND 3000)::int AS ms_1k_3k,
    count(*) FILTER (WHERE duration_ms > 3000)::int AS over_3k
  FROM api_request_logs WHERE client_id=$1
  `,
  [CLIENT_ID],
);
console.log("\n=== DURATION BUCKETS ===");
console.log(buckets.rows[0]);

// Same-time server load: other clients' avg ms in hours where this client was slow
const slowHours = byHour.rows.filter((r) => r.p95 > 1000).map((r) => r.hour);
if (slowHours.length) {
  console.log("\n=== SERVER-WIDE LATENCY IN HIS SLOW HOURS ===");
  for (const h of slowHours.slice(-5)) {
    const g = await c.query(
      `
      SELECT
        count(*)::int AS n,
        avg(duration_ms)::int AS avg_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95,
        count(DISTINCT client_id)::int AS clients
      FROM api_request_logs
      WHERE requested_at >= $1 AND requested_at < $1 + interval '1 hour'
      `,
      [h],
    );
    console.log(h.toISOString().slice(0, 16), g.rows[0]);
  }
}

await c.end();
