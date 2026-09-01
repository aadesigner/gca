import { pgTable, serial, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { apiClientsTable } from "./apiClients";

/** Blocked IPs, device IDs, or emails (portal register/login). */
export const accessBlocksTable = pgTable(
  "access_blocks",
  {
    id: serial("id").primaryKey(),
    /** ip | device | email */
    blockType: text("block_type").notNull(),
    blockValue: text("block_value").notNull(),
    reason: text("reason"),
    sourceClientId: integer("source_client_id").references(() => apiClientsTable.id, {
      onDelete: "set null",
    }),
    createdByAdminId: integer("created_by_admin_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("access_blocks_type_value_uidx").on(t.blockType, t.blockValue),
    index("access_blocks_type_idx").on(t.blockType),
  ],
);

export type AccessBlock = typeof accessBlocksTable.$inferSelect;
