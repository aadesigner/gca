/**
 * Force production onto fresh full_collection; cancel refresh + skipped providers.
 * node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-force-full-campaign.mjs
 */
import pg from "pg";

const SKIP = [
  "import_motor",
  "iaa",
  "che168",
  "autohome",
  "mango",
  "ssancar",
  "heydealer",
  "bobaedream",
  "bobaedreamcyber",
  "kcar",
  "autobell",
  "ams",
  "auctionwini",
  "automobileit",
  "autoscout24_es",
  "autoscout24_be",
  "autotradernl",
  "subito",
  "standvirtual",
  "mobilebg",
  "getcarapi",
  "kmcheck",
  "kmcheck_manual",
  "carstat",
  "bidcars",
  "carsandbids",
];

const client = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT || 5432),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
});

await client.connect();

const cancelledSkip = await client.query(
  `
  UPDATE collection_jobs cj
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      error_message = COALESCE(error_message, 'provider skipped — no auto-crawl')
  FROM providers p
  WHERE p.id = cj.provider_id
    AND p.internal_name = ANY($1::text[])
    AND cj.status IN ('pending', 'running', 'paused')
  RETURNING cj.id, p.internal_name
  `,
  [SKIP],
);

const cancelledRefresh = await client.query(`
  UPDATE collection_jobs cj
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      error_message = COALESCE(error_message, 'superseded by full_collection campaign')
  FROM providers p
  WHERE p.id = cj.provider_id
    AND cj.job_type = 'listing_refresh'
    AND cj.status IN ('pending', 'running', 'paused')
    AND NOT (p.internal_name = ANY($1::text[]))
  RETURNING cj.id, p.internal_name
`, [SKIP]);

// Prefer one full job per enabled non-skip provider: pick best existing, force full+fresh, cancel extras.
const providers = await client.query(
  `
  SELECT p.id, p.internal_name
  FROM providers p
  WHERE p.enabled = true
    AND NOT (p.internal_name = ANY($1::text[]))
    AND (
      p.internal_name = ANY($2::text[])
      OR EXISTS (
        SELECT 1 FROM collection_jobs cj
        WHERE cj.provider_id = p.id AND cj.items_processed > 0
      )
      OR EXISTS (
        SELECT 1 FROM collection_jobs cj
        WHERE cj.provider_id = p.id AND cj.status IN ('pending', 'running', 'paused')
      )
    )
  ORDER BY p.internal_name
  `,
  [
    SKIP,
    [
      "encar",
      "autowini",
      "kbchachacha",
      "carpoolkr",
      "charancha",
      "autohub",
      "lotteautoauction",
      "autoinside",
      "autobellglobal",
      "rbautotrade",
      "senaauto",
      "aaaauto",
      "autoscout24",
      "autotraderca",
      "sauto",
      "mobilede",
      "willhaben",
      "otomoto",
      "dubicars",
      "cars24ae",
      "carpages",
      "ontariocars",
      "bidexport",
      "thebidrive",
      "japanesecartrade",
      "salvagebid",
      "bringatrailer",
      "copart",
      "lotte_autoglobal",
      "kolon_auto",
      "auctionauto",
      "seobuk",
      "koreaauto_auction",
      "koreausedcars",
    ],
  ],
);

const actions = [];
for (const p of providers.rows) {
  const { rows: jobs } = await client.query(
    `
    SELECT id, job_type, status, job_config, items_processed
    FROM collection_jobs
    WHERE provider_id = $1
    ORDER BY
      CASE WHEN job_type = 'full_collection' THEN 0 ELSE 1 END,
      CASE WHEN status IN ('running', 'pending') THEN 0 ELSE 1 END,
      items_processed DESC NULLS LAST,
      updated_at DESC
    LIMIT 8
    `,
    [p.id],
  );

  let keep = jobs.find((j) => j.job_type === "full_collection") ?? jobs[0];
  if (!keep) {
    const cfg = JSON.stringify({
      concurrency: 4,
      delayMs: 400,
      skipRecentHours: 0,
      detailLevel: "full",
      maxPages: 0,
      maxListings: 0,
      repeatHours: 5,
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const created = await client.query(
      `
      INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
      VALUES ($1, 'full_collection', 'pending', $2)
      RETURNING id
      `,
      [p.id, cfg],
    );
    keep = { id: created.rows[0].id };
    actions.push({ provider: p.internal_name, action: "created", id: keep.id });
  } else {
    await client.query(
      `
      UPDATE collection_jobs
      SET status = 'pending',
          job_type = 'full_collection',
          crawl_state = NULL,
          pages_processed = 0,
          items_discovered = 0,
          items_processed = 0,
          completed_at = NULL,
          error_message = NULL,
          job_config = (
            COALESCE(job_config::jsonb, '{}'::jsonb)
            || jsonb_build_object(
              'skipRecentHours', 0,
              'detailLevel', 'full',
              'maxPages', 0,
              'maxListings', 0,
              'nextRunAt', to_jsonb(($2::timestamptz))
            )
          )::text,
          updated_at = NOW()
      WHERE id = $1
      `,
      [keep.id, new Date(Date.now() - 60_000).toISOString()],
    );
    actions.push({ provider: p.internal_name, action: "forced_full", id: keep.id });
  }

  await client.query(
    `
    UPDATE collection_jobs
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'superseded by full_collection campaign')
    WHERE provider_id = $1
      AND id <> $2
      AND status IN ('pending', 'running', 'paused')
    `,
    [p.id, keep.id],
  );
}

const summary = await client.query(`
  SELECT job_type, status, count(*)::int AS n
  FROM collection_jobs
  WHERE status IN ('pending', 'running', 'paused')
  GROUP BY 1, 2
  ORDER BY 1, 2
`);

const running = await client.query(`
  SELECT p.internal_name, cj.id, cj.job_type, cj.status, (cj.crawl_state IS NULL) AS fresh
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status IN ('pending', 'running')
  ORDER BY cj.status, p.internal_name
`);

await client.end();

console.log(
  JSON.stringify(
    {
      cancelledSkip: cancelledSkip.rows,
      cancelledRefresh: cancelledRefresh.rows.length,
      cancelledRefreshSample: cancelledRefresh.rows.slice(0, 15),
      forced: actions.length,
      summary: summary.rows,
      queued: running.rows,
    },
    null,
    2,
  ),
);
