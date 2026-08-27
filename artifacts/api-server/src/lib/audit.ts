import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

interface AuditParams {
  req: Request;
  action: string;
  entityType?: string;
  entityId?: string | number;
  details?: unknown;
}

export async function writeAuditLog({
  req,
  action,
  entityType,
  entityId,
  details,
}: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      adminId: req.session.adminId ?? null,
      adminEmail: req.session.adminEmail ?? null,
      action,
      entityType: entityType ?? null,
      entityId: entityId != null ? String(entityId) : null,
      details: details != null ? JSON.stringify(details) : null,
      ipAddress: req.ip ?? null,
    });
  } catch (err) {
    logger.error({ err, action }, "Failed to write audit log");
  }
}
