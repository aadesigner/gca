/**
 * Strip accident.metadata.condition leaked from Bidscan "Similar Lots" cards.
 * Old parser matched bare "Condition" only in similar-lot cards (main lot uses "Condition:").
 */
import pg from "pg";

const isProd = process.argv.includes("--prod");
const dryRun = process.argv.includes("--dry-run");

const client = isProd
  ? new pg.Client({
      host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT || "15622"),
      user: process.env.PROD_PG_USER || "postgres",
      password: process.env.PGPASSWORD || process.env.PROD_PG_PASSWORD,
      database: process.env.PROD_PG_DATABASE || "railway",
      ssl: false,
      connectionTimeoutMillis: 20_000,
    })
  : new pg.Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 15_000,
    });

await client.connect();
console.log(isProd ? "PROD" : "LOCAL", dryRun ? "(dry-run)" : "(apply)");

const countSql = `
  SELECT count(*)::int AS n
  FROM vehicle_events ve
  WHERE ve.event_type IN ('accident', 'flood_damage')
    AND ve.metadata IS NOT NULL
    AND ve.metadata::text ~* '"condition"\\s*:'
    AND (
      ve.metadata::text ~* '"source"\\s*:\\s*"(bidscan|copart|iaa|iaai)"'
      OR ve.metadata::text ~* '"condition"\\s*:\\s*"[^"]*run[^"]*drive'
    )
`;
const before = await client.query(countSql);
console.log("events with leaked condition", before.rows[0].n);

if (dryRun) {
  const sample = await client.query(`
    SELECT v.vin, ve.id, ve.description,
           (ve.metadata::jsonb)->>'condition' AS condition,
           (ve.metadata::jsonb)->>'source' AS source
    FROM vehicle_events ve
    JOIN vehicles v ON v.id = ve.vehicle_id
    WHERE ve.event_type IN ('accident', 'flood_damage')
      AND ve.metadata::text ~* '"condition"\\s*:'
      AND ve.metadata::text ~* '"source"\\s*:\\s*"(bidscan|copart|iaa|iaai)"'
    ORDER BY ve.id DESC
    LIMIT 8
  `);
  console.log(sample.rows);
  await client.end();
  process.exit(0);
}

const upd = await client.query(`
  WITH doomed AS (
    SELECT ve.id
    FROM vehicle_events ve
    WHERE ve.event_type IN ('accident', 'flood_damage')
      AND ve.metadata IS NOT NULL
      AND ve.metadata::text ~* '"condition"\\s*:'
      AND (
        ve.metadata::text ~* '"source"\\s*:\\s*"(bidscan|copart|iaa|iaai)"'
        OR ve.metadata::text ~* '"condition"\\s*:\\s*"[^"]*run[^"]*drive'
      )
  )
  UPDATE vehicle_events ve
  SET metadata = ((ve.metadata::jsonb - 'condition')::text)
  FROM doomed
  WHERE ve.id = doomed.id
  RETURNING ve.id
`);
console.log("stripped condition", upd.rowCount);

const leftover = await client.query(countSql);
console.log("remaining", leftover.rows[0].n);

await client.end();
console.log("done");
