import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { apiClientsTable } from "./apiClients";

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => apiClientsTable.id, { onDelete: "cascade" }),
    /** SHA-256 hex of the raw token sent in email. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("password_reset_tokens_token_hash_idx").on(t.tokenHash),
    index("password_reset_tokens_client_id_idx").on(t.clientId),
  ],
);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
