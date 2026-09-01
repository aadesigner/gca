import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { sql, eq } from "drizzle-orm";
import { db, apiClientsTable, creditLedgerTable } from "@workspace/db";
import { loginRateLimit } from "../../middlewares/loginRateLimit";
import { requireClient, loadActiveClient, resolveClientSession } from "../../middlewares/clientAuth";
import { loadBillingSettings, parseCreditPriceUsd } from "../../lib/credits";
import { publicCaptchaConfig, verifyRecaptchaV3 } from "../../lib/recaptcha";
import { portalClosedMessage } from "../../lib/portalAccess";
import { ensureTestToken, regenerateTestToken } from "../../lib/testToken";
import { TEST_TOKEN_NAME } from "../../lib/mintApiToken";
import { normalizeWebsite } from "../../lib/normalizeWebsite";
import { normalizeTelegram } from "../../lib/normalizeTelegram";
import {
  checkPortalAccessBlocks,
  recordClientAuthFingerprint,
} from "../../lib/accessBlocks";

const MIN_PASSWORD_LEN = 8;

const router: IRouter = Router();

function clientPublic(client: {
  id: number;
  name: string;
  email: string | null;
  companyName?: string | null;
  websiteUrl?: string | null;
  telegramUsername?: string | null;
  isDemo: boolean;
  creditBalance: number;
  isActive: boolean;
}) {
  return {
    id: client.id,
    name: client.name,
    email: client.email,
    companyName: client.companyName ?? null,
    websiteUrl: client.websiteUrl ?? null,
    telegramUsername: client.telegramUsername ?? null,
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

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 200) : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";
  const telegramUsername = normalizeTelegram(req.body?.telegramUsername);
  const websiteUrl = normalizeWebsite(req.body?.websiteUrl);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  if (!telegramUsername) {
    res.status(400).json({
      error: "Valid Telegram username is required (letters, numbers, underscore — 3–64 chars)",
    });
    return;
  }
  if (typeof req.body?.websiteUrl === "string" && req.body.websiteUrl.trim() && !websiteUrl) {
    res.status(400).json({ error: "Website URL looks invalid" });
    return;
  }
  if (!websiteUrl) {
    res.status(400).json({ error: "Website URL is required" });
    return;
  }
  if (password.length < MIN_PASSWORD_LEN) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters` });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ error: "Passwords do not match" });
    return;
  }

  const blockCheck = await checkPortalAccessBlocks(req, { email });
  if (blockCheck.blocked) {
    res.status(403).json({
      error: "Registration is not available from this device or network.",
      code: "ACCESS_BLOCKED",
    });
    return;
  }

  const emailLocal = email.split("@")[0]?.replace(/[._+-]+/g, " ").trim();
  const name = (emailLocal || telegramUsername).slice(0, 120);

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
      telegramUsername,
      websiteUrl,
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

  await recordClientAuthFingerprint(client.id, req, "register");

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

  const blockCheck = await checkPortalAccessBlocks(req, { email });
  if (blockCheck.blocked) {
    res.status(403).json({
      error: "Sign-in is not available from this device or network.",
      code: "ACCESS_BLOCKED",
    });
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

  await recordClientAuthFingerprint(client.id, req, "login");

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

/** Session probe for marketing header — same rules as /me (active client, not blocked). */
router.get("/client/auth/session", async (req, res): Promise<void> => {
  try {
    const client = await resolveClientSession(req);
    if (!client) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      clientId: client.id,
      name: client.name,
    });
  } catch {
    res.status(503).json({ authenticated: false, error: "Could not verify session" });
  }
});

router.get("/client/auth/me", requireClient, async (req, res): Promise<void> => {
  const client = await resolveClientSession(req);
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
  const companyNameRaw = req.body?.companyName;
  const websiteUrlRaw = req.body?.websiteUrl;
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";

  const patch: {
    name?: string;
    companyName?: string | null;
    websiteUrl?: string | null;
    telegramUsername?: string | null;
    passwordHash?: string;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (name && name.length >= 2) patch.name = name;

  if (companyNameRaw !== undefined) {
    const companyName =
      typeof companyNameRaw === "string" ? companyNameRaw.trim().slice(0, 160) : "";
    patch.companyName = companyName || null;
  }
  if (websiteUrlRaw !== undefined) {
    if (typeof websiteUrlRaw === "string" && !websiteUrlRaw.trim()) {
      patch.websiteUrl = null;
    } else {
      const websiteUrl = normalizeWebsite(websiteUrlRaw);
      if (typeof websiteUrlRaw === "string" && websiteUrlRaw.trim() && !websiteUrl) {
        res.status(400).json({ error: "Website URL looks invalid" });
        return;
      }
      patch.websiteUrl = websiteUrl;
    }
  }
  if (req.body?.telegramUsername !== undefined) {
    const tg = normalizeTelegram(req.body.telegramUsername);
    if (typeof req.body.telegramUsername === "string" && req.body.telegramUsername.trim() && !tg) {
      res.status(400).json({ error: "Telegram username looks invalid" });
      return;
    }
    patch.telegramUsername = tg;
  }

  if (password) {
  if (password.length < MIN_PASSWORD_LEN) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters` });
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
