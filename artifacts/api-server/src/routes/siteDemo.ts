import { Router, type IRouter } from "express";
import { db, apiClientsTable, apiTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { requireAdmin } from "../middlewares/auth";
import { writeAuditLog } from "../lib/audit";
import { listEnabledLiveProviders, browseLiveVehicles, resolvePublicLiveProvider } from "../lib/liveBrowse";
import {
  DEMO_ALLOWED_ENDPOINTS,
  DEMO_CLIENT_EMAIL,
  DEMO_CLIENT_NAME,
  DEMO_LIVE_LIMIT,
  DEMO_LIVE_LIMIT_ALL,
  getStoredPublicDemoToken,
  setStoredPublicDemoToken,
  sanitizeDemoVehicles,
} from "../lib/public-demo";

const router: IRouter = Router();

const demoHits = new Map<string, { n: number; t: number }>();
const imgHits = new Map<string, { n: number; t: number }>();

const PHOTO_HOSTS = new Set([
  "ci.encar.com",
  "imagebox.autowini.com",
  "image.autowini.com",
  "www.autowini.com",
  "img.kbchachacha.com",
  "img.chachacha.co.kr",
]);

function demoRateOk(ip: string): boolean {
  const now = Date.now();
  const row = demoHits.get(ip);
  if (!row || now - row.t > 60_000) {
    demoHits.set(ip, { n: 1, t: now });
    return true;
  }
  if (row.n >= 40) return false;
  row.n += 1;
  return true;
}

router.get("/site/img", async (req, res): Promise<void> => {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  const now = Date.now();
  const hit = imgHits.get(ip);
  if (!hit || now - hit.t > 60_000) imgHits.set(ip, { n: 1, t: now });
  else if (hit.n >= 80) {
    res.status(429).end();
    return;
  } else hit.n += 1;

  const raw = typeof req.query.u === "string" ? req.query.u : "";
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    res.status(400).end();
    return;
  }
  if (!PHOTO_HOSTS.has(host)) {
    res.status(400).end();
    return;
  }
  const referer = /encar/.test(host) ? "https://www.encar.com/" : `https://${host}/`;
  try {
    const upstream = await fetch(raw, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8",
        Referer: referer,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) {
      res.status(502).end();
      return;
    }
    const type = (upstream.headers.get("content-type") || "image/jpeg").split(";")[0]!;
    if (!type.startsWith("image/")) {
      res.status(502).end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength < 80 || buf.byteLength > 4 * 1024 * 1024) {
      res.status(502).end();
      return;
    }
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch {
    res.status(502).end();
  }
});

router.get("/site/demo", async (_req, res): Promise<void> => {
  const token = await getStoredPublicDemoToken();
  const providers = token ? await listEnabledLiveProviders() : [];
  res.json({
    enabled: Boolean(token),
    limit: DEMO_LIVE_LIMIT,
    limitAll: DEMO_LIVE_LIMIT_ALL,
    providers: providers.length
      ? [{ name: "All feeds mixed", internalName: "all" }, ...providers.map((p) => ({ name: p.name, internalName: p.internalName }))]
      : [],
  });
});

router.get("/site/demo/vehicles", async (req, res): Promise<void> => {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  if (!demoRateOk(ip)) {
    res.status(429).json({ error: "Slow down — demo is rate limited." });
    return;
  }
  const token = await getStoredPublicDemoToken();
  if (!token) {
    res.status(503).json({ error: "Live demo is not published yet" });
    return;
  }
  const requested = typeof req.query.provider === "string" ? req.query.provider : "all";
  const combined = requested === "all" || requested === "combined_live" || requested === "combined";
  try {
    if (combined) {
      const enabled = await listEnabledLiveProviders();
      const chunks = await Promise.all(
        enabled.map(async (provider) => {
          try {
            const result = await browseLiveVehicles(provider.id, {
              limit: DEMO_LIVE_LIMIT,
              offset: 0,
            });
            return result.vehicles.slice(0, DEMO_LIVE_LIMIT);
          } catch {
            return [];
          }
        }),
      );
      const vehicles = sanitizeDemoVehicles(chunks.flat(), true).slice(0, DEMO_LIVE_LIMIT_ALL);
      res.json({
        vehicles,
        hasMore: false,
        limit: DEMO_LIVE_LIMIT_ALL,
        provider: "all",
      });
      return;
    }
    const liveFilters = { limit: DEMO_LIVE_LIMIT, offset: 0 };
    const { provider, unknownAdapter } = await resolvePublicLiveProvider(requested);
    if (unknownAdapter || !provider) {
      res.status(400).json({ error: "Unknown or disabled live provider" });
      return;
    }
    const result = await browseLiveVehicles(provider.id, liveFilters);
    const vehicles = sanitizeDemoVehicles(result.vehicles, true);
    res.json({
      vehicles,
      hasMore: false,
      limit: DEMO_LIVE_LIMIT,
      provider: provider.internalName,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Live feed unavailable" });
  }
});

router.get("/admin/marketing-demo", requireAdmin, async (_req, res): Promise<void> => {
  const token = await getStoredPublicDemoToken();
  res.json({
    enabled: Boolean(token),
    token: token || null,
    prefix: token ? token.slice(0, 12) : null,
    limit: DEMO_LIVE_LIMIT,
  });
});

router.post("/admin/marketing-demo", requireAdmin, async (req, res): Promise<void> => {
  let [client] = await db
    .select()
    .from(apiClientsTable)
    .where(eq(apiClientsTable.email, DEMO_CLIENT_EMAIL))
    .limit(1);

  if (!client) {
    const inserted = await db
      .insert(apiClientsTable)
      .values({
        name: DEMO_CLIENT_NAME,
        email: DEMO_CLIENT_EMAIL,
        description: "Public marketing live-feed playground. Live stock only.",
        isActive: true,
        rateLimitPerMinute: 30,
        rateLimitPerDay: 2000,
        allowedEndpoints: DEMO_ALLOWED_ENDPOINTS,
        liveFeedEnabled: true,
        liveFeedExpiresAt: null,
      })
      .returning();
    client = inserted[0]!;
  } else {
    await db
      .update(apiClientsTable)
      .set({
        isActive: true,
        allowedEndpoints: DEMO_ALLOWED_ENDPOINTS,
        liveFeedEnabled: true,
        liveFeedExpiresAt: null,
        rateLimitPerMinute: client.rateLimitPerMinute ?? 30,
        rateLimitPerDay: client.rateLimitPerDay ?? 2000,
      })
      .where(eq(apiClientsTable.id, client.id));
  }

  await db
    .update(apiTokensTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiTokensTable.clientId, client.id));

  const rawToken = `vdi_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const tokenPrefix = rawToken.substring(0, 12);

  const [token] = await db
    .insert(apiTokensTable)
    .values({
      clientId: client.id,
      name: "Public live demo",
      tokenHash,
      tokenPrefix,
      isActive: true,
    })
    .returning();

  await setStoredPublicDemoToken(rawToken);

  await writeAuditLog({
    req,
    action: "api_token.create",
    entityType: "api_token",
    entityId: token!.id,
    details: { name: "Public live demo", marketingDemo: true },
  });

  res.status(201).json({
    enabled: true,
    token: rawToken,
    prefix: tokenPrefix,
    clientId: client.id,
    limit: DEMO_LIVE_LIMIT,
  });
});

router.delete("/admin/marketing-demo", requireAdmin, async (req, res): Promise<void> => {
  await setStoredPublicDemoToken(null);
  const [client] = await db
    .select({ id: apiClientsTable.id })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.email, DEMO_CLIENT_EMAIL))
    .limit(1);
  if (client) {
    await db
      .update(apiTokensTable)
      .set({ isActive: false, revokedAt: new Date() })
      .where(eq(apiTokensTable.clientId, client.id));
  }
  await writeAuditLog({
    req,
    action: "api_token.revoke",
    entityType: "api_token",
    details: { marketingDemo: true },
  });
  res.json({ enabled: false, token: null });
});

export default router;
