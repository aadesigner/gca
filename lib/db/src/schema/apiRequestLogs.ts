import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { apiClientsTable } from "./apiClients";
import { apiTokensTable } from "./apiTokens";

export const apiRequestLogsTable = pgTable("api_request_logs", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => apiClientsTable.id),
  tokenId: integer("token_id").references(() => apiTokensTable.id),
  vin: text("vin"),                  // VIN requested (public API only)
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code").notNull(),
  durationMs: integer("duration_ms").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("api_request_logs_client_id_idx").on(table.clientId),
  index("api_request_logs_requested_at_idx").on(table.requestedAt),
  index("api_request_logs_vin_idx").on(table.clientId, table.vin, table.requestedAt),
]);

export const insertApiRequestLogSchema = createInsertSchema(apiRequestLogsTable).omit({
  id: true,
});
export type InsertApiRequestLog = z.infer<typeof insertApiRequestLogSchema>;
export type ApiRequestLog = typeof apiRequestLogsTable.$inferSelect;
