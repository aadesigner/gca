import { Router } from "express";
import { requireApiToken } from "../../middlewares/apiTokenAuth";
import { getTestVinsPublic } from "../../lib/test-vins";

const router = Router();

/** List curated test VINs (Bearer required, no credit). */
router.get("/", requireApiToken, (_req, res) => {
  res.json({
    success: true,
    data: {
      testVins: getTestVinsPublic(),
      note: "Retrieve and check these VINs with your normal API token. No credits are charged.",
    },
  });
});

export default router;
