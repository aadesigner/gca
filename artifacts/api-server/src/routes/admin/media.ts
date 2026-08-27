/**
 * GET /api/admin/media/proxy?url= — session-authenticated proxy for Autowini
 * listing photos. imagebox.autowini.com returns 403 Access Denied when the
 * browser sends our dashboard Referer, so <img> tags cannot load them directly.
 */
import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middlewares/auth";
import { autowiniFetchBinary, isAutowiniPhotoUrl } from "../../lib/providers/autowini-http";

const router: IRouter = Router();

router.get("/admin/media/proxy", requireAdmin, async (req, res): Promise<void> => {
  const raw = typeof req.query.url === "string" ? req.query.url : "";
  if (!raw || !isAutowiniPhotoUrl(raw)) {
    res.status(400).json({ error: "Unsupported media URL" });
    return;
  }

  try {
    const { status, contentType, body } = await autowiniFetchBinary(raw);
    if (status !== 200 || !contentType.toLowerCase().startsWith("image/")) {
      res.status(502).json({ error: "Upstream media unavailable" });
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  } catch {
    res.status(502).json({ error: "Failed to load media" });
  }
});

export default router;
