import { db, apiClientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Clients with at least one API token are paid/API accounts.
 * Demo = shell account with no tokens yet (or marketing playground).
 */
export async function markClientPaidForToken(clientId: number): Promise<void> {
  if (!Number.isFinite(clientId) || clientId <= 0) return;
  await db
    .update(apiClientsTable)
    .set({ isDemo: false, updatedAt: new Date() })
    .where(eq(apiClientsTable.id, clientId));
}
