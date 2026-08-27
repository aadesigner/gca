import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  AdminLoginBody,
  AdminLoginResponse,
  AdminGetMeResponse,
  AdminLogoutResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { loginRateLimit } from "../../middlewares/loginRateLimit";
import { writeAuditLog } from "../../lib/audit";

const router: IRouter = Router();

// POST /api/admin/auth/login
router.post("/admin/auth/login", loginRateLimit, async (req, res): Promise<void> => {
  try {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, email));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Regenerate session ID on login to prevent session fixation attacks.
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });

  req.session.adminId = user.id;
  req.session.adminEmail = user.email;
  delete req.session.clientId;
  delete req.session.clientName;

  await writeAuditLog({ req, action: "auth.login", entityType: "admin_user", entityId: user.id });

  res.json(
    AdminLoginResponse.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    }),
  );
  } catch (err) {
    req.log?.error({ err }, "Admin login failed");
    const message = err instanceof Error ? err.message : "Login failed";
    const missing = /relation .* does not exist/i.test(message);
    res.status(missing ? 503 : 500).json({
      error: missing
        ? "Database is not initialized yet. Check deploy logs for migration errors."
        : "Internal server error",
    });
  }
});

// POST /api/admin/auth/logout
router.post("/admin/auth/logout", async (req, res): Promise<void> => {
  const adminId = req.session.adminId;
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Failed to destroy session");
    }
  });
  if (adminId) {
    await writeAuditLog({ req, action: "auth.logout", entityType: "admin_user", entityId: adminId });
  }
  res.json(AdminLogoutResponse.parse({ success: true }));
});

// GET /api/admin/auth/me
router.get("/admin/auth/me", requireAdmin, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, req.session.adminId!));

  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  res.json(
    AdminGetMeResponse.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    }),
  );
});

export default router;
