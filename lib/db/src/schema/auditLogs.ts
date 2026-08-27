import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { adminUsersTable } from "./adminUsers";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").references(() => adminUsersTable.id),
  adminEmail: text("admin_email"),
  action: text("action").notNull(), // e.g. "provider.create", "token.revoke"
  entityType: text("entity_type"), // e.g. "provider", "api_token"
  entityId: text("entity_id"),
  details: text("details"), // JSON string with before/after
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_admin_id_idx").on(table.adminId),
  index("audit_logs_created_at_idx").on(table.createdAt),
  index("audit_logs_entity_idx").on(table.entityType, table.entityId),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
