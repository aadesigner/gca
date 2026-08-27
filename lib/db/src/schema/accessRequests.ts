import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

/** Public “Get API key” contact forms — reviewed in admin. */
export const accessRequestsTable = pgTable(
  "access_requests",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    telegramUsername: text("telegram_username"),
    websiteUrl: text("website_url"),
    /** live_feed | vin_api | both */
    serviceInterest: text("service_interest").notNull(),
    message: text("message").notNull(),
    /** new | read | contacted | closed */
    status: text("status").notNull().default("new"),
    adminNote: text("admin_note"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("access_requests_created_at_idx").on(t.createdAt),
    index("access_requests_status_idx").on(t.status),
  ],
);

export type AccessRequest = typeof accessRequestsTable.$inferSelect;
