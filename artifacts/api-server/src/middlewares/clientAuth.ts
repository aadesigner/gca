import type { Request, Response, NextFunction } from "express";
import { db, apiClientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
