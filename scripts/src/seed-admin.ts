/**
 * Seed or reset the initial admin user.
 *
 * Required env:  DATABASE_URL
 * Optional env:  ADMIN_EMAIL    (default: admin@example.com)
 *                ADMIN_PASSWORD (default: auto-generated, printed once to stderr)
 *
 * If the email already exists and ADMIN_PASSWORD is set, the password is updated.
 * Legacy weak accounts (admin@localhost / admin@example.com) are renamed + reset
 * when ADMIN_EMAIL points at a new address.
 *
 * Run: pnpm --filter @workspace/scripts run seed-admin
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const email = (process.env.ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
const LEGACY_EMAILS = ["admin@localhost", "admin@example.com"];

let rawPassword: string;
let generated = false;
if (process.env.ADMIN_PASSWORD) {
  rawPassword = process.env.ADMIN_PASSWORD;
} else {
  rawPassword = crypto.randomBytes(24).toString("base64url");
  generated = true;
}

const passwordHash = await bcrypt.hash(rawPassword, 12);

const byEmail = await pool.query(`SELECT id, email FROM admin_users WHERE lower(email) = $1 LIMIT 1`, [email]);

let action: "created" | "updated" | "renamed" = "created";

if (byEmail.rows.length > 0) {
  await pool.query(
    `UPDATE admin_users SET password_hash = $1, is_active = true, name = COALESCE(name, 'Admin User') WHERE id = $2`,
    [passwordHash, byEmail.rows[0].id],
  );
  action = "updated";
} else {
  const legacy = await pool.query(
    `SELECT id, email FROM admin_users WHERE lower(email) = ANY($1::text[]) ORDER BY id ASC LIMIT 1`,
    [LEGACY_EMAILS],
  );
  if (legacy.rows.length > 0) {
    await pool.query(
      `UPDATE admin_users SET email = $1, password_hash = $2, is_active = true WHERE id = $3`,
      [email, passwordHash, legacy.rows[0].id],
    );
    action = "renamed";
  } else {
    await pool.query(
      `INSERT INTO admin_users (email, name, password_hash, is_active)
       VALUES ($1, $2, $3, true)`,
      [email, "Admin User", passwordHash],
    );
    action = "created";
  }
}

process.stderr.write(
  `\n=== ADMIN ACCOUNT ${action.toUpperCase()} ===\n` +
    `Email:    ${email}\n` +
    (generated || action !== "created"
      ? `Password: ${rawPassword}\n` +
        `Store this password now — it will not be shown again.\n`
      : `Password: (from ADMIN_PASSWORD)\n`) +
    `===============================\n\n`,
);

console.log(`Admin user ${action}: ${email}`);

await pool.query(
  `INSERT INTO settings (id, max_collection_jobs_parallel, vin_extraction_enabled, photo_storage_enabled, raw_data_retention_days)
   VALUES (1, 3, true, false, 30)
   ON CONFLICT (id) DO NOTHING`,
);
console.log("Settings row ready.");

await pool.end();
