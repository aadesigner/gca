/**
 * Portal access blocks — IP, device ID, and email bans.
 */
import type { Request } from "express";
import { and, eq, isNull, or, gt, inArray, asc } from "drizzle-orm";
import {
  db,
  accessBlocksTable,
  apiClientsTable,
  apiRequestLogsTable,
  clientAuthFingerprintsTable,
} from "@workspace/db";

export type BlockType = "ip" | "device" | "email";

export type AccessBlockCheck = {
  blocked: boolean;
  blockType?: BlockType;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function clientIp(req: Request): string | null {
  const forwarded = firstHeader(req.headers["x-forwarded-for"]);
  const raw = forwarded?.split(",")[0]?.trim() || req.ip || "";
  const ip = raw.replace(/^::ffff:/, "").trim();
  if (!ip || ip === "::1") return "127.0.0.1";
  return ip.slice(0, 64) || null;
}

/** Stable device id from client header (localStorage UUID). */
export function deviceIdFromRequest(req: Request): string | null {
  const raw =
    (typeof req.body?.deviceId === "string" ? req.body.deviceId : null) ||
    (typeof req.headers["x-device-id"] === "string" ? req.headers["x-device-id"] : null);
  if (!raw) return null;
  const id = raw.trim().slice(0, 64);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return null;
  return id;
}

export function normalizeBlockedEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e.slice(0, 200);
}

async function isBlocked(type: BlockType, value: string): Promise<boolean> {
  const normalized = normalizeBlockValue(type, value);
  if (!normalized) return false;
  const now = new Date();
  const [row] = await db
    .select({ id: accessBlocksTable.id })
    .from(accessBlocksTable)
    .where(
      and(
        eq(accessBlocksTable.blockType, type),
        eq(accessBlocksTable.blockValue, normalized),
        or(isNull(accessBlocksTable.expiresAt), gt(accessBlocksTable.expiresAt, now)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function normalizeBlockValue(type: BlockType, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (type === "email") return v.toLowerCase().slice(0, 200);
  if (type === "ip") return v.replace(/^::ffff:/, "").slice(0, 64);
  return v.slice(0, 64);
}

export async function checkPortalAccessBlocks(
  req: Request,
  opts: { email?: string | null } = {},
): Promise<AccessBlockCheck> {
  const ip = clientIp(req);
  if (ip && (await isBlocked("ip", ip))) {
    return { blocked: true, blockType: "ip" };
  }

  const deviceId = deviceIdFromRequest(req);
  if (deviceId && (await isBlocked("device", deviceId))) {
    return { blocked: true, blockType: "device" };
  }

  const email = normalizeBlockedEmail(opts.email);
  if (email && (await isBlocked("email", email))) {
    return { blocked: true, blockType: "email" };
  }

  return { blocked: false };
}

export async function recordClientAuthFingerprint(
  clientId: number,
  req: Request,
  eventType: "register" | "login",
): Promise<void> {
  const ip = clientIp(req);
  const deviceId = deviceIdFromRequest(req);
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 400) : null;
  if (!ip && !deviceId && !ua) return;

  await db.insert(clientAuthFingerprintsTable).values({
    clientId,
    ipAddress: ip,
    deviceId,
    userAgent: ua,
    eventType,
  });
}

export type BanOnDeleteOptions = {
  banIp?: boolean;
  banDevice?: boolean;
  banEmail?: boolean;
  reason?: string;
};

export async function collectClientBanTargets(clientId: number): Promise<{
  ips: string[];
  devices: string[];
  email: string | null;
}> {
  const [client] = await db
    .select({ email: apiClientsTable.email })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, clientId))
    .limit(1);

  const [logIps, fpRows] = await Promise.all([
    db
      .selectDistinct({ ip: apiRequestLogsTable.ipAddress })
      .from(apiRequestLogsTable)
      .where(eq(apiRequestLogsTable.clientId, clientId)),
    db
      .select({
        ip: clientAuthFingerprintsTable.ipAddress,
        deviceId: clientAuthFingerprintsTable.deviceId,
      })
      .from(clientAuthFingerprintsTable)
      .where(eq(clientAuthFingerprintsTable.clientId, clientId)),
  ]);

  const ips = new Set<string>();
  for (const row of logIps) {
    const ip = row.ip?.trim();
    if (ip) ips.add(ip.replace(/^::ffff:/, "").slice(0, 64));
  }
  for (const row of fpRows) {
    const ip = row.ip?.trim();
    if (ip) ips.add(ip.replace(/^::ffff:/, "").slice(0, 64));
  }

  const devices = new Set<string>();
  for (const row of fpRows) {
    const id = row.deviceId?.trim();
    if (id) devices.add(id.slice(0, 64));
  }

  return {
    ips: [...ips],
    devices: [...devices],
    email: normalizeBlockedEmail(client?.email ?? null),
  };
}

export async function applyClientBanBlocks(
  clientId: number,
  opts: BanOnDeleteOptions,
  adminId: number | null,
): Promise<{ ips: number; devices: number; emails: number }> {
  const targets = await collectClientBanTargets(clientId);
  const reason =
    typeof opts.reason === "string" && opts.reason.trim()
      ? opts.reason.trim().slice(0, 500)
      : "Banned when account was removed";

  const rows: {
    blockType: BlockType;
    blockValue: string;
    reason: string;
    sourceClientId: number;
    createdByAdminId: number | null;
  }[] = [];

  if (opts.banIp) {
    for (const ip of targets.ips) {
      const blockValue = normalizeBlockValue("ip", ip);
      if (!blockValue) continue;
      rows.push({
        blockType: "ip",
        blockValue,
        reason,
        sourceClientId: clientId,
        createdByAdminId: adminId,
      });
    }
  }
  if (opts.banDevice) {
    for (const deviceId of targets.devices) {
      const blockValue = normalizeBlockValue("device", deviceId);
      if (!blockValue) continue;
      rows.push({
        blockType: "device",
        blockValue,
        reason,
        sourceClientId: clientId,
        createdByAdminId: adminId,
      });
    }
  }
  if (opts.banEmail && targets.email) {
    const blockValue = normalizeBlockValue("email", targets.email);
    if (blockValue) {
      rows.push({
        blockType: "email",
        blockValue,
        reason,
        sourceClientId: clientId,
        createdByAdminId: adminId,
      });
    }
  }

  if (rows.length === 0) {
    return { ips: 0, devices: 0, emails: 0 };
  }

  await db.insert(accessBlocksTable).values(rows).onConflictDoNothing({
    target: [accessBlocksTable.blockType, accessBlocksTable.blockValue],
  });

  return {
    ips: opts.banIp ? targets.ips.length : 0,
    devices: opts.banDevice ? targets.devices.length : 0,
    emails: opts.banEmail && targets.email ? 1 : 0,
  };
}

/** Preview counts for admin delete dialog. */
export async function previewClientBanTargets(clientId: number) {
  const t = await collectClientBanTargets(clientId);
  return {
    ipCount: t.ips.length,
    deviceCount: t.devices.length,
    hasEmail: Boolean(t.email),
    email: t.email,
  };
}

export async function listBlocksForClient(sourceClientId: number) {
  return db
    .select()
    .from(accessBlocksTable)
    .where(eq(accessBlocksTable.sourceClientId, sourceClientId))
    .orderBy(asc(accessBlocksTable.createdAt));
}

export async function revokeBlocks(ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const result = await db.delete(accessBlocksTable).where(inArray(accessBlocksTable.id, ids));
  return result.rowCount ?? 0;
}
