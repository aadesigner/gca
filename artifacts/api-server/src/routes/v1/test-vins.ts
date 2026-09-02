import { Router } from "express";
import { requireApiToken } from "../../middlewares/apiTokenAuth";
import { getTestVinsPublic } from "../../lib/test-vins";

const router = Router();

/** List curated test VINs (Bearer required, no credit). */
router.get("/", requireApiToken, (req, res) => {
  res.json({
    success: true,
    data: {
      testVins: getTestVinsPublic(),
      note: req.isTestOnly
        ? "Sandbox only: use your test key on these VINs — no credits charged."
        : "Sandbox VINs require a test API key. Production keys are for real VINs (credits required).",
    },
  });
});

export default router;
