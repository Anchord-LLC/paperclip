import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { memoryBindings } from "./memory_bindings.js";

export const memoryOperations = pgTable(
  "memory_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bindingId: uuid("binding_id")
      .notNull()
      .references(() => memoryBindings.id, { onDelete: "cascade" }),
    operationType: text("operation_type").notNull(),
    status: text("status").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id"),
    namespace: text("namespace").notNull().default("memory"),
    stateKey: text("state_key"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    response: jsonb("response").$type<Record<string, unknown>>().notNull().default({}),
    usage: jsonb("usage").$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb("error").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memoryOperationsCompanyIdx: index("memory_operations_company_idx").on(table.companyId, table.createdAt),
    memoryOperationsBindingIdx: index("memory_operations_binding_idx").on(table.bindingId, table.createdAt),
    memoryOperationsScopeIdx: index("memory_operations_scope_idx").on(
      table.companyId,
      table.scopeKind,
      table.scopeId,
      table.createdAt,
    ),
    memoryOperationsStatusIdx: index("memory_operations_status_idx").on(table.status, table.createdAt),
  }),
);
