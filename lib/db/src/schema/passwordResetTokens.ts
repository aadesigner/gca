import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { apiClientsTable } from "./apiClients";

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => apiClientsTable.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the raw token sent in email — never store the raw token. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("password_reset_tokens_token_hash_uidx").on(t.tokenHash),
    index("password_reset_tokens_client_id_idx").on(t.clientId),
    index("password_reset_tokens_client_unused_idx")
      .on(t.clientId)
      .where(sql`${t.usedAt} IS NULL`),
  ],
);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
