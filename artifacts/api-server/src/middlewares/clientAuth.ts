import type { Request, Response, NextFunction } from "express";
import { db, apiClientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { checkPortalAccessBlocks } from "../lib/accessBlocks";

export function clearClientSessionKeys(req: Request): void {
  delete req.session.clientId;
  delete req.session.clientName;
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export async function invalidateClientSession(req: Request): Promise<void> {
  clearClientSessionKeys(req);
  await saveSession(req);
}

export function requireClient(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.clientId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export async function loadActiveClient(clientId: number) {
  const [client] = await db
    .select()
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, clientId))
    .limit(1);
  if (!client || !client.isActive) return null;
  return client;
}

/** Resolve portal session: active client in DB and not access-blocked. Clears stale sessions. */
export async function resolveClientSession(req: Request) {
  const clientId = req.session?.clientId;
  if (!clientId) return null;

  const client = await loadActiveClient(clientId);
  if (!client) {
    await invalidateClientSession(req);
    return null;
  }

  const block = await checkPortalAccessBlocks(req, { email: client.email });
  if (block.blocked) {
    await invalidateClientSession(req);
    return null;
  }

  if (req.session.clientName !== client.name) {
    req.session.clientName = client.name;
  }

  return client;
}
