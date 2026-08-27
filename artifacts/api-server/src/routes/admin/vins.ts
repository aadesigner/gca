import { Router, type IRouter } from "express";
import { db, providersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/auth";
import { writeAuditLog } from "../../lib/audit";
import { parseVinImportPayload, importCatalogListings, streamVinExport } from "../../lib/vin-catalog";

const router: IRouter = Router();

function numQuery(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function strQuery(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.trim();
}

// GET /api/admin/vins/export — JSON catalog (default) or CSV, all providers or one
router.get("/admin/vins/export", requireAdmin, async (req, res): Promise<void> => {
  const q = req.query as Record<string, unknown>;
  const format = strQuery(q.format)?.toLowerCase() === "csv" ? "csv" : "json";
  let providerId = numQuery(q.providerId);
  let providerInternalName = strQuery(q.provider);
  if (providerInternalName === "all") providerInternalName = undefined;

  if (!providerId && providerInternalName) {
    const [provider] = await db
      .select({ id: providersTable.id })
      .from(providersTable)
      .where(eq(providersTable.internalName, providerInternalName))
      .limit(1);
    providerId = provider?.id;
    if (!provider) {
      res.status(400).json({ error: `Unknown provider '${providerInternalName}'` });
      return;
    }
  }

  await writeAuditLog({
    req,
    action: "vins.export",
    entityType: "vin_catalog",
    details: { format, providerId, providerInternalName: providerInternalName ?? "all" },
  });

  await streamVinExport(res, { providerId, providerInternalName, format });
});

// POST /api/admin/vins/import — catalog JSON or existing VIN CSV
router.post("/admin/vins/import", requireAdmin, async (req, res): Promise<void> => {
  let listings;
  try {
    listings = parseVinImportPayload(req.body);
  } catch (err) {
    res.status(400).json({ error: `Could not parse import: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  if (!listings.length) {
    res.status(400).json({ error: "No VIN listings found in file. Use a catalog JSON export or the CSV export." });
    return;
  }

  const result = await importCatalogListings(listings);
  await writeAuditLog({
    req,
    action: "vins.import",
    entityType: "vin_catalog",
    details: {
      listingsRead: result.listingsRead,
      listingsUpserted: result.listingsUpserted,
      skippedNoVin: result.skippedNoVin,
      providersCreated: result.providersCreated,
      errorCount: result.errors.length,
    },
  });
  res.json(result);
});

export default router;
