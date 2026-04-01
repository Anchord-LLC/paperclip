import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { plugins } from "./plugins.js";

export const memoryBindings = pgTable(
  "memory_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bindingKey: text("binding_key").notNull(),
    label: text("label").notNull(),
    providerKey: text("provider_key").notNull(),
    pluginId: uuid("plugin_id").references(() => plugins.id, { onDelete: "set null" }),
    namespace: text("namespace").notNull().default("memory"),
    status: text("status").notNull().default("active"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => ({
    memoryBindingsCompanyIdx: index("memory_bindings_company_idx").on(table.companyId),
    memoryBindingsProviderIdx: index("memory_bindings_provider_idx").on(table.companyId, table.providerKey),
    memoryBindingsPluginIdx: index("memory_bindings_plugin_idx").on(table.pluginId),
    memoryBindingsCompanyBindingKeyUq: uniqueIndex("memory_bindings_company_binding_key_uq").on(
      table.companyId,
      table.bindingKey,
    ),
  }),
);
