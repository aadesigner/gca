import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { sql, eq } from "drizzle-orm";
import { db, apiClientsTable, creditLedgerTable } from "@workspace/db";
import { loginRateLimit } from "../../middlewares/loginRateLimit";
import { requireClient, loadActiveClient } from "../../middlewares/clientAuth";
import { loadBillingSettings, parseCreditPriceUsd } from "../../lib/credits";
import { publicCaptchaConfig, verifyRecaptchaV3 } from "../../lib/recaptcha";
import { portalClosedMessage } from "../../lib/portalAccess";
import { ensureTestToken, regenerateTestToken } from "../../lib/testToken";
import { TEST_TOKEN_NAME } from "../../lib/mintApiToken";

const router: IRouter = Router();

function clientPublic(client: {
  id: number;
  name: string;
  email: string | null;
  isDemo: boolean;
  creditBalance: number;
  isActive: boolean;
}) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    isDemo: client.isDemo,
    creditBalance: client.creditBalance,
    isActive: client.isActive,
  };
}

router.get("/client/auth/captcha-config", async (_req, res): Promise<void> => {
  const cfg = await publicCaptchaConfig();
  res.json(cfg);
});

router.post("/client/auth/register", loginRateLimit, async (req, res): Promise<void> => {
  const settings = await loadBillingSettings();
  if (settings?.registrationEnabled === false) {
    res.status(403).json({ error: portalClosedMessage("register"), code: "REGISTRATION_DISABLED" });
    return;
  }

  const captcha = await verifyRecaptchaV3({
    token: req.body?.recaptchaToken,
    action: "register",
    remoteIp: req.ip,
  });
  if (!captcha.ok) {
    res.status(400).json({ error: captcha.error });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!name || name.length < 2) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const [existing] = await db
    .select({ id: apiClientsTable.id })
    .from(apiClientsTable)
    .where(sql`lower(${apiClientsTable.email}) = ${email}`)
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const startingCredits = Math.max(0, Number(settings?.demoStartingCredits ?? 0) || 0);
  const passwordHash = await bcrypt.hash(password, 12);

  const [client] = await db
    .insert(apiClientsTable)
    .values({
      name,
      email,
      passwordHash,
      description: "Self-registered account",
      isActive: true,
      isDemo: true,
      creditBalance: startingCredits,
      rateLimitPerMinute: 30,
      rateLimitPerDay: 200,
      monthlyGlobalLimit: null,
      requestsPerVin: 5,
      allowedEndpoints: null,
    })
    .returning();

  if (!client) {
    res.status(500).json({ error: "Could not create account" });
    return;
  }

  if (startingCredits > 0) {
    await db.insert(creditLedgerTable).values({
      clientId: client.id,
      delta: startingCredits,
      balanceAfter: startingCredits,
      reason: "registration_grant",
      refType: "registration",
    });
  }

  const testMint = await ensureTestToken(client.id);

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.clientId = client.id;
  req.session.clientName = client.name;
  delete req.session.adminId;
  delete req.session.adminEmail;

  res.status(201).json({
    ...clientPublic({ ...client, isDemo: true }),
    creditPriceUsd: parseCreditPriceUsd(settings?.creditPriceUsd),
    hasTestToken: true,
    hasProductionToken: false,
    testToken: testMint.created
      ? {
          name: TEST_TOKEN_NAME,
          prefix: testMint.token.tokenPrefix,
          value: testMint.rawToken,
          isTestOnly: true,
        }
      : undefined,
  });
});

router.post("/client/auth/login", loginRateLimit, async (req, res): Promise<void> => {
  const settings = await loadBillingSettings();
  if (settings?.clientLoginEnabled === false) {
    res.status(403).json({ error: portalClosedMessage("login"), code: "LOGIN_DISABLED" });
    return;
  }

  const captcha = await verifyRecaptchaV3({
    token: req.body?.recaptchaToken,
    action: "login",
    remoteIp: req.ip,
  });
  if (!captcha.ok) {
    res.status(400).json({ error: captcha.error });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const [client] = await db
    .select()
    .from(apiClientsTable)
    .where(sql`lower(${apiClientsTable.email}) = ${email}`)
    .limit(1);
  if (!client?.passwordHash || !client.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const valid = await bcrypt.compare(password, client.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.clientId = client.id;
  req.session.clientName = client.name;
  delete req.session.adminId;
  delete req.session.adminEmail;

  res.json(clientPublic(client));
});

router.post("/client/auth/logout", async (req, res): Promise<void> => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/** Lightweight session probe for marketing site header (no DB). */
router.get("/client/auth/session", (req, res): void => {
  const clientId = req.session?.clientId;
  if (!clientId) {
    res.json({ authenticated: false });
    return;
  }
  res.json({
    authenticated: true,
    clientId,
    name: typeof req.session.clientName === "string" ? req.session.clientName : null,
  });
});

router.get("/client/auth/me", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(clientPublic(client));
});

router.put("/client/auth/profile", requireClient, async (req, res): Promise<void> => {
  const client = await loadActiveClient(req.session.clientId!);
  if (!client) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : undefined;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";

  const patch: { name?: string; passwordHash?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (name && name.length >= 2) patch.name = name;

  if (password) {
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    if (!client.passwordHash || !(await bcrypt.compare(currentPassword, client.passwordHash))) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    patch.passwordHash = await bcrypt.hash(password, 12);
  }

  const [updated] = await db
    .update(apiClientsTable)
    .set(patch)
    .where(eq(apiClientsTable.id, client.id))
    .returning();

  if (updated) req.session.clientName = updated.name;
  res.json(clientPublic(updated!));
});

export default router;
