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
      note: "Curated test VINs are free on your API key (no credits). Real VINs cost 1 credit per retrieve. Live feed requires account enablement.",
    },
  });
});

export default router;
