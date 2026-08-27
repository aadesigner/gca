import bcrypt from "bcryptjs";
import { db, adminUsersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

const LEGACY_EMAILS = ["admin@localhost", "admin@example.com"];

/** Create or update the operator account from ADMIN_EMAIL / ADMIN_PASSWORD. */
export async function ensureAdminUser(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    logger.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set — skip admin seed");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(adminUsersTable)
      .set({ passwordHash, isActive: true })
      .where(eq(adminUsersTable.id, existing.id));
    logger.info({ email }, "Admin user password updated from env");
    return;
  }

  const [legacy] = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(inArray(adminUsersTable.email, LEGACY_EMAILS))
    .limit(1);

  if (legacy) {
    await db
      .update(adminUsersTable)
      .set({ email, passwordHash, isActive: true })
      .where(eq(adminUsersTable.id, legacy.id));
    logger.info({ email }, "Legacy admin user renamed from env");
    return;
  }

  await db.insert(adminUsersTable).values({
    email,
    name: "Admin User",
    passwordHash,
    isActive: true,
  });
  logger.info({ email }, "Admin user created from env");
}
