import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { apiClientsTable } from "./apiClients";

/** Login/register fingerprints for abuse tracing and ban-on-delete. */
export const clientAuthFingerprintsTable = pgTable(
  "client_auth_fingerprints",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => apiClientsTable.id, { onDelete: "cascade" }),
    ipAddress: text("ip_address"),
    deviceId: text("device_id"),
    userAgent: text("user_agent"),
    /** register | login */
    eventType: text("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("client_auth_fp_client_id_idx").on(t.clientId),
    index("client_auth_fp_device_id_idx").on(t.deviceId),
  ],
);

export type ClientAuthFingerprint = typeof clientAuthFingerprintsTable.$inferSelect;
