import { pgTable, text, timestamp, json } from "drizzle-orm/pg-core";

// connect-pg-simple requires this table structure for session storage
export const sessionsTable = pgTable("session", {
  sid: text("sid").notNull().primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});
