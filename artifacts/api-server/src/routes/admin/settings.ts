import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";

const router: IRouter = Router();

function serializeSettings(row: typeof settingsTable.$inferSelect) {
  return {
    id: row.id,
    defaultRateLimit: row.defaultRateLimit,
    maxCollectionJobsParallel: row.maxCollectionJobsParallel,
    vinExtractionEnabled: row.vinExtractionEnabled,
    photoStorageEnabled: row.photoStorageEnabled,
    rawDataRetentionDays: row.rawDataRetentionDays,
    defaultMaxPages: row.defaultMaxPages,
    defaultMaxListings: row.defaultMaxListings,
    defaultDelayMs: row.defaultDelayMs,
    publicDemoToken: row.publicDemoToken ? "[set]" : null,
    creditPriceUsd: Number(row.creditPriceUsd ?? 2),
    minCryptoDepositUsd: Number(row.minCryptoDepositUsd ?? 40),
    cryptoPaymentInstructions: row.cryptoPaymentInstructions,
    recaptchaEnabled: row.recaptchaEnabled,
    recaptchaSiteKey: row.recaptchaSiteKey,
    /** Never return the raw secret — only whether it is configured. */
    recaptchaSecretConfigured: Boolean(row.recaptchaSecretKey),
    recaptchaMinScore: Number(row.recaptchaMinScore ?? 0.5),
    registrationEnabled: row.registrationEnabled,
    clientLoginEnabled: row.clientLoginEnabled,
    demoStartingCredits: row.demoStartingCredits,
    apiVinRetrieveEnabled: row.apiVinRetrieveEnabled,
    apiVinCheckEnabled: row.apiVinCheckEnabled,
    apiLiveEnabled: row.apiLiveEnabled,
    liveFeedContactEmail: row.liveFeedContactEmail ?? "info@getcarapi.com",
    updatedAt: row.updatedAt,
  };
}

const UpdateBody = z.object({
  defaultRateLimit: z.number().int().nullable().optional(),
  maxCollectionJobsParallel: z.number().int().min(0).optional(),
  vinExtractionEnabled: z.boolean().optional(),
  photoStorageEnabled: z.boolean().optional(),
  rawDataRetentionDays: z.number().int().min(1).optional(),
  defaultMaxPages: z.number().int().min(1).optional(),
  defaultMaxListings: z.number().int().min(1).optional(),
  defaultDelayMs: z.number().int().min(0).optional(),
  creditPriceUsd: z.number().positive().max(10_000).optional(),
  minCryptoDepositUsd: z.number().positive().max(100_000).optional(),
  cryptoPaymentInstructions: z.string().max(4000).nullable().optional(),
  recaptchaEnabled: z.boolean().optional(),
  recaptchaSiteKey: z.string().max(200).nullable().optional(),
  recaptchaSecretKey: z.string().max(200).nullable().optional(),
  recaptchaMinScore: z.number().min(0).max(1).optional(),
  registrationEnabled: z.boolean().optional(),
  clientLoginEnabled: z.boolean().optional(),
  demoStartingCredits: z.number().int().min(0).max(10_000).optional(),
  apiVinRetrieveEnabled: z.boolean().optional(),
  apiVinCheckEnabled: z.boolean().optional(),
  apiLiveEnabled: z.boolean().optional(),
  liveFeedContactEmail: z.string().email().max(200).nullable().optional(),
  /** Pass empty string to clear secret; omit to leave unchanged. */
  clearRecaptchaSecret: z.boolean().optional(),
});

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!settings) {
    res.status(404).json({ error: "Settings not found" });
    return;
  }
  res.json(serializeSettings(settings));
});

router.put("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const patch: Record<string, unknown> = {};

  for (const key of [
    "defaultRateLimit",
    "maxCollectionJobsParallel",
    "vinExtractionEnabled",
    "photoStorageEnabled",
    "rawDataRetentionDays",
    "defaultMaxPages",
    "defaultMaxListings",
    "defaultDelayMs",
    "cryptoPaymentInstructions",
    "recaptchaEnabled",
    "recaptchaSiteKey",
    "registrationEnabled",
    "clientLoginEnabled",
    "demoStartingCredits",
    "apiVinRetrieveEnabled",
    "apiVinCheckEnabled",
    "apiLiveEnabled",
    "liveFeedContactEmail",
  ] as const) {
    if (data[key] !== undefined) patch[key] = data[key];
  }

  if (data.creditPriceUsd !== undefined) patch.creditPriceUsd = data.creditPriceUsd.toFixed(2);
  if (data.minCryptoDepositUsd !== undefined) patch.minCryptoDepositUsd = data.minCryptoDepositUsd.toFixed(2);
  if (data.recaptchaMinScore !== undefined) patch.recaptchaMinScore = data.recaptchaMinScore.toFixed(2);

  if (data.clearRecaptchaSecret) {
    patch.recaptchaSecretKey = null;
  } else if (typeof data.recaptchaSecretKey === "string" && data.recaptchaSecretKey.trim()) {
    patch.recaptchaSecretKey = data.recaptchaSecretKey.trim();
  }

  const [settings] = await db
    .update(settingsTable)
    .set(patch)
    .where(eq(settingsTable.id, 1))
    .returning();

  if (!settings) {
    res.status(404).json({ error: "Settings not found" });
    return;
  }

  await writeAuditLog({
    req,
    action: "settings.update",
    entityType: "settings",
    entityId: "1",
    details: {
      ...data,
      recaptchaSecretKey: data.recaptchaSecretKey ? "[updated]" : undefined,
    },
  });

  res.json(serializeSettings(settings));
});

export default router;
