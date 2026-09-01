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
      note: req.isTestOnly
        ? "This test key only works with curated test VINs. No credits are charged."
        : "Retrieve and check these VINs with your API token. No credits are charged for test VINs.",
    },
  });
});

export default router;
