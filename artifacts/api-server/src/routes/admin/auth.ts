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
import { publicCaptchaConfig, verifyRecaptchaV3 } from "../../lib/recaptcha";
import { isDatabaseError, sanitizeDbError, isTransientConnectionError } from "../../lib/db-ready";
import { ADMIN_SESSION_MS } from "../../lib/session";

const router: IRouter = Router();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function regenerateSession(req: Parameters<typeof writeAuditLog>[0]["req"]): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
      return;
    } catch (err) {
      last = err;
      if (!isTransientConnectionError(err) || attempt === 3) throw err;
      await sleep(250 * (attempt + 1));
    }
  }
  throw last;
}

router.get("/admin/auth/captcha-config", async (_req, res): Promise<void> => {
  try {
    const cfg = await publicCaptchaConfig();
    res.json({ enabled: cfg.enabled, siteKey: cfg.siteKey });
  } catch {
    res.json({ enabled: false, siteKey: null });
  }
});

// POST /api/admin/auth/login
router.post("/admin/auth/login", loginRateLimit, async (req, res): Promise<void> => {
  try {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const captcha = await verifyRecaptchaV3({
    token: req.body?.recaptchaToken,
    action: "admin_login",
    remoteIp: req.ip,
  });
  if (!captcha.ok) {
    res.status(400).json({ error: captcha.error });
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
  await regenerateSession(req);

  req.session.adminId = user.id;
  req.session.adminEmail = user.email;
  delete req.session.clientId;
  delete req.session.clientName;
  req.session.cookie.maxAge = ADMIN_SESSION_MS;

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
    const detail = sanitizeDbError(err);
    const transient = isTransientConnectionError(err) || isDatabaseError(err);
    res.status(transient ? 503 : 500).json({
      error: transient
        ? `Database busy — try again in a few seconds (${detail})`
        : `Login failed: ${detail}`,
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
