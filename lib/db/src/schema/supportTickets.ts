import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { apiClientsTable } from "./apiClients";

/** Client support tickets — threaded messages in client area + admin inbox. */
export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => apiClientsTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    /** open | awaiting_client | closed */
    status: text("status").notNull().default("open"),
    clientUnread: boolean("client_unread").notNull().default(false),
    adminUnread: boolean("admin_unread").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("support_tickets_client_id_idx").on(t.clientId),
    index("support_tickets_status_idx").on(t.status),
    index("support_tickets_admin_unread_idx").on(t.adminUnread),
  ],
);

export const supportTicketMessagesTable = pgTable(
  "support_ticket_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    /** client | admin */
    authorType: text("author_type").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_ticket_messages_ticket_id_idx").on(t.ticketId)],
);

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type SupportTicketMessage = typeof supportTicketMessagesTable.$inferSelect;
