/**
 * Remove QA / test portal accounts created by automated scripts.
 * Run: node --import ./scripts/load-env.mjs ./scripts/qa-cleanup-accounts.mjs
 * Dry run: QA_CLEANUP_DRY=1 node --import ./scripts/load-env.mjs ./scripts/qa-cleanup-accounts.mjs
 */
import pg from "pg";

await import("./load-env.mjs");

const dryRun = process.env.QA_CLEANUP_DRY === "1" || process.env.QA_CLEANUP_DRY === "true";
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

/** Emails created by qa-auth, qa-flows, qa-prod-api, qa-security, qa-smoke, etc. */
const QA_EMAIL_SQL = `
  lower(coalesce(email, '')) LIKE 'qa-%@example.com'
  OR lower(coalesce(email, '')) SIMILAR TO 'qa-[a-z0-9-]+@example\\.com'
  OR name LIKE 'QA Client %'
  OR description = 'qa-flows'
`;

const pool = new pg.Pool({ connectionString: url, ssl: pgSsl(rawUrl) });

async function main() {
  const { rows } = await pool.query(
    `SELECT id, email, name, description, created_at
     FROM api_clients
     WHERE ${QA_EMAIL_SQL}
     ORDER BY id`,
  );

  if (!rows.length) {
    console.log("No QA test accounts found.");
    return;
  }

  console.log(`${dryRun ? "DRY RUN — would remove" : "Removing"} ${rows.length} QA account(s):\n`);
  for (const row of rows) {
    console.log(`  #${row.id}  ${row.email || "(no email)"}  ${row.name}  ${row.created_at?.toISOString?.() ?? row.created_at ?? ""}`);
  }

  if (dryRun) return;

  const ids = rows.map((r) => r.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const id of ids) {
      await client.query("DELETE FROM api_request_logs WHERE client_id = $1", [id]);
      await client.query("DELETE FROM api_tokens WHERE client_id = $1", [id]);
      await client.query("DELETE FROM access_blocks WHERE source_client_id = $1", [id]);
      const del = await client.query("DELETE FROM api_clients WHERE id = $1 RETURNING id", [id]);
      if (!del.rowCount) {
        throw new Error(`Failed to delete client #${id}`);
      }
    }
    await client.query("COMMIT");
    console.log(`\nDeleted ${ids.length} QA account(s).`);
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
    process.exitCode = 1;
  })
  .finally(() => pool.end());
