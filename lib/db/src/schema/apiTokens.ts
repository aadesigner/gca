import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { apiClientsTable } from "./apiClients";

export const apiTokensTable = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => apiClientsTable.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(), // hashed token value
  tokenPrefix: text("token_prefix").notNull(), // first 8 chars for display
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("api_tokens_client_id_idx").on(table.clientId),
  index("api_tokens_client_active_idx").on(table.clientId, table.isActive),
  index("api_tokens_token_hash_idx").on(table.tokenHash),
]);

export const insertApiTokenSchema = createInsertSchema(apiTokensTable).omit({
  id: true,
  createdAt: true,
});
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;
export type ApiToken = typeof apiTokensTable.$inferSelect;
