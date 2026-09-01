import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { apiClientsTable } from "./apiClients";

export const creditLedgerTable = pgTable("credit_ledger", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => apiClientsTable.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdByAdminId: integer("created_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreditLedger = typeof creditLedgerTable.$inferSelect;

export const creditPurchasesTable = pgTable("credit_purchases", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id")
    .notNull()
    .references(() => apiClientsTable.id, { onDelete: "cascade" }),
  credits: integer("credits").notNull(),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
  cryptoCurrency: text("crypto_currency").notNull().default("USDT"),
  txHash: text("tx_hash"),
  payerNote: text("payer_note"),
  proofPath: text("proof_path"),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedByAdminId: integer("reviewed_by_admin_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CreditPurchase = typeof creditPurchasesTable.$inferSelect;
