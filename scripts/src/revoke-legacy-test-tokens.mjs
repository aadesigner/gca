/**
 * Revoke and delete all legacy sandbox-only API keys (is_test_only = true).
 * Run: node --import ./scripts/load-env.mjs ./scripts/src/revoke-legacy-test-tokens.mjs
 * Dry run: REVOKE_TEST_TOKENS_DRY=1 node --import ./scripts/load-env.mjs ./scripts/src/revoke-legacy-test-tokens.mjs
 */
import pg from "pg";

await import("../load-env.mjs");

const dryRun = process.env.REVOKE_TEST_TOKENS_DRY === "1" || process.env.REVOKE_TEST_TOKENS_DRY === "true";
const rawUrl = process.env.DATABASE_URL;

if (!rawUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

function pgConnectionString(connectionString) {
  if (!/railway\.internal|localhost|127\.0\.0\.1/i.test(connectionString)) return connectionString;
  const [base, query] = connectionString.split("?");
  const params = (query ?? "")
    .split("&")
    .map((part) => part.trim())
    .filter((part) => part && !part.toLowerCase().startsWith("sslmode="));
  params.push("sslmode=disable");
  return `${base}?${params.join("&")}`;
}

function pgSsl(connectionString) {
  if (/railway\.internal|localhost|127\.0\.0\.1/i.test(connectionString) || /sslmode=disable/i.test(connectionString)) {
    return false;
  }
  if (process.env.NODE_ENV === "production") return { rejectUnauthorized: false };
  return undefined;
}

const url = pgConnectionString(rawUrl);
const pool = new pg.Pool({ connectionString: url, ssl: pgSsl(rawUrl) });

async function main() {
  const { rows: legacy } = await pool.query(
    `SELECT t.id, t.client_id, t.name, t.token_prefix, t.is_active, c.name AS client_name, c.email
     FROM api_tokens t
     JOIN api_clients c ON c.id = t.client_id
     WHERE t.is_test_only = true
     ORDER BY t.client_id, t.id`,
  );

  if (!legacy.length) {
    console.log("No legacy test-only API keys found.");
    return;
  }

  const active = legacy.filter((r) => r.is_active);
  console.log(`${dryRun ? "DRY RUN — would remove" : "Removing"} ${legacy.length} legacy test key(s) (${active.length} still active):\n`);
  for (const row of legacy) {
    console.log(
      `  token #${row.id}  client #${row.client_id} ${row.client_name}  ${row.token_prefix}…  ${row.is_active ? "ACTIVE" : "inactive"}`,
    );
  }

  if (dryRun) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = legacy.map((r) => r.id);
    if (active.length) {
      await client.query(
        `UPDATE api_tokens SET is_active = false, revoked_at = now() WHERE is_test_only = true AND is_active = true`,
      );
    }
    await client.query(`UPDATE api_request_logs SET token_id = NULL WHERE token_id = ANY($1::int[])`, [ids]);
    const del = await client.query(`DELETE FROM api_tokens WHERE is_test_only = true RETURNING id`);
    await client.query("COMMIT");
    console.log(`\nDeleted ${del.rowCount} test-only token row(s).`);

    const { rows: needing } = await pool.query(
      `SELECT c.id, c.name, c.email
       FROM api_clients c
       WHERE NOT EXISTS (
         SELECT 1 FROM api_tokens t
         WHERE t.client_id = c.id AND t.is_test_only = false AND t.is_active = true
       )
       AND c.id = ANY($1::int[])`,
      [[...new Set(legacy.map((r) => r.client_id))]],
    );
    if (needing.length) {
      console.log("\nClients with no active production key — issue one from admin:");
      for (const c of needing) {
        console.log(`  #${c.id}  ${c.name}  ${c.email ?? "(no email)"}`);
      }
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
