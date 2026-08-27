import { Router, type IRouter } from "express";
import vinRouter from "./vin";
import liveRouter from "./live";
import { apiResponseHeaders } from "../../middlewares/apiResponseHeaders";

const router: IRouter = Router();

router.use(apiResponseHeaders);
router.use("/vin", vinRouter);
router.use("/live", liveRouter);

export default router;
