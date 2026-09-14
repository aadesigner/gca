import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middlewares/auth";
import {
  countPendingMirrorPhotos,
  getPhotoMirrorBackfillStatus,
  isPhotoMirrorEnabled,
  startPhotoMirrorBackfill,
  stopPhotoMirrorBackfill,
} from "../../lib/photo-mirror";

const router: IRouter = Router();

const PROXY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Hosts allowed through the admin image proxy (WebGL panorama / hotlink bypass). */
function isAllowedProxyHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    host === "mediaretriever.iaai.com" ||
    host === "vis.iaai.com" ||
    host.endsWith(".iaai.com")
  );
}

/**
 * Same-origin proxy for IAA auction images so the admin panorama viewer can
 * load InteriorImageRetriever / ThreeSixty frames (upstream has no CORS).
 *
 * GET /api/admin/photos/proxy?url=
 */
router.get("/admin/photos/proxy", requireAdmin, async (req, res): Promise<void> => {
  const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!raw) {
    res.status(400).json({ error: "url required" });
    return;
  }
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    res.status(400).json({ error: "invalid url" });
    return;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    res.status(400).json({ error: "unsupported protocol" });
    return;
  }
  if (!isAllowedProxyHost(target.hostname)) {
    res.status(403).json({ error: "host not allowed" });
    return;
  }

  try {
    const upstream = await fetch(target.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent": PROXY_UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: "https://vis.iaai.com/",
      },
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
      return;
    }
    const ct = upstream.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(ct) && !/octet-stream/i.test(ct)) {
      res.status(502).json({ error: "upstream not an image" });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > 12 * 1024 * 1024) {
      res.status(502).json({ error: "image too large" });
      return;
    }
    res.setHeader("Content-Type", ct.startsWith("image/") ? ct : "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "proxy failed" });
  }
});

router.get("/admin/photos/mirror-status", requireAdmin, async (_req, res): Promise<void> => {
  const pending = await countPendingMirrorPhotos().catch(() => null);
  res.json({
    r2Enabled: isPhotoMirrorEnabled(),
    pending,
    backfill: getPhotoMirrorBackfillStatus(),
  });
});

router.post("/admin/photos/mirror-backfill/start", requireAdmin, async (_req, res): Promise<void> => {
  if (!isPhotoMirrorEnabled()) {
    res.status(503).json({ error: "R2 mirror not configured on this server" });
    return;
  }
  const started = startPhotoMirrorBackfill();
  const pending = await countPendingMirrorPhotos().catch(() => null);
  res.json({
    started,
    pending,
    backfill: getPhotoMirrorBackfillStatus(),
  });
});

router.post("/admin/photos/mirror-backfill/stop", requireAdmin, (_req, res): void => {
  stopPhotoMirrorBackfill();
  res.json({ stopped: true, backfill: getPhotoMirrorBackfillStatus() });
});

export default router;
