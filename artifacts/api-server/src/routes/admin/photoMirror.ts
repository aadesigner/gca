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
