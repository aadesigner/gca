import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./admin/auth";
import dashboardRouter from "./admin/dashboard";
import providersRouter from "./admin/providers";
import jobsRouter from "./admin/jobs";
import jobLogsRouter from "./admin/jobLogs";
import vehiclesRouter from "./admin/vehicles";
import vehicleRawSourcesRouter from "./admin/vehicleRawSources";
import listingsRouter from "./admin/listings";
import vinsRouter from "./admin/vins";
import apiClientsRouter from "./admin/apiClients";
import apiTokensRouter from "./admin/apiTokens";
import apiLogsRouter from "./admin/apiLogs";
import auditLogsRouter from "./admin/auditLogs";
import settingsRouter from "./admin/settings";
import creditPurchasesRouter from "./admin/creditPurchases";
import accessRequestsRouter from "./accessRequests";
import liveFeedsRouter from "./admin/liveFeeds";
import mediaRouter from "./admin/media";
import observabilityRouter from "./admin/observability";
import crawlHealthRouter from "./admin/crawlHealth";
import normalizationRouter from "./admin/normalization";
import clientAuthRouter from "./client/auth";
import clientPortalRouter from "./client/portal";
import siteDemoRouter from "./siteDemo";
import v1Router from "./v1";
import docsRouter from "./docs";

const router: IRouter = Router();

// Health
router.use(healthRouter);

// OpenAPI (session-gated; also mounted at app root for /docs)
router.use(docsRouter);

// Admin routes (session-authenticated)
router.use(authRouter);
router.use(dashboardRouter);
router.use(providersRouter);
router.use(jobsRouter);
router.use(jobLogsRouter);
router.use(vehiclesRouter);
router.use(vehicleRawSourcesRouter);
router.use(listingsRouter);
router.use(vinsRouter);
router.use(apiClientsRouter);
router.use(apiTokensRouter);
router.use(apiLogsRouter);
router.use(auditLogsRouter);
router.use(settingsRouter);
router.use(creditPurchasesRouter);
router.use(accessRequestsRouter);
router.use(liveFeedsRouter);
router.use(mediaRouter);
router.use(observabilityRouter);
router.use(crawlHealthRouter);
router.use(normalizationRouter);
router.use(clientAuthRouter);
router.use(clientPortalRouter);
router.use(siteDemoRouter);

// Public v1 API (token-authenticated)
router.use("/v1", v1Router);

export default router;
