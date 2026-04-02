import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryBindings, memoryOperations } from "@paperclipai/db";
import type {
  CreateMemoryBindingInput,
  ListMemoryOperationsInput,
  LogMemoryOperationInput,
  MemoryBinding,
  MemoryOperation,
  ResolveMemoryBindingInput,
  UpdateMemoryBindingStatusInput,
} from "@paperclipai/shared";

export function memoryService(db: Db) {
  return {
    async resolveBindingByKey(input: ResolveMemoryBindingInput): Promise<MemoryBinding | null> {
      const whereClause = input.activeOnly === false
        ? and(
            eq(memoryBindings.companyId, input.companyId),
            eq(memoryBindings.bindingKey, input.bindingKey),
          )
        : and(
            eq(memoryBindings.companyId, input.companyId),
            eq(memoryBindings.bindingKey, input.bindingKey),
            eq(memoryBindings.status, "active"),
          );

      const rows = await db
        .select()
        .from(memoryBindings)
        .where(whereClause)
        .limit(1);

      return rows[0] ?? null;
    },

    async listBindingsForCompany(companyId: string): Promise<MemoryBinding[]> {
      return db
        .select()
        .from(memoryBindings)
        .where(eq(memoryBindings.companyId, companyId))
        .orderBy(desc(memoryBindings.createdAt));
    },

    async createBinding(input: CreateMemoryBindingInput): Promise<MemoryBinding | null> {
      const rows = await db
        .insert(memoryBindings)
        .values({
          companyId: input.companyId,
          bindingKey: input.bindingKey,
          label: input.label,
          providerKey: input.providerKey,
          pluginId: input.pluginId ?? null,
          namespace: input.namespace ?? "memory",
          status: input.status ?? "active",
          config: input.config ?? {},
          capabilities: input.capabilities ?? {},
        })
        .returning();

      return rows[0] ?? null;
    },

    async updateBindingStatus(input: UpdateMemoryBindingStatusInput): Promise<MemoryBinding | null> {
      const now = new Date();

      const rows = await db
        .update(memoryBindings)
        .set({
          status: input.status,
          updatedAt: now,
          disabledAt: input.status === "disabled" ? now : null,
        })
        .where(
          and(
            eq(memoryBindings.id, input.bindingId),
            eq(memoryBindings.companyId, input.companyId),
          ),
        )
        .returning();

      return rows[0] ?? null;
    },

    async logOperation(input: LogMemoryOperationInput): Promise<MemoryOperation | null> {
      const rows = await db
        .insert(memoryOperations)
        .values({
          companyId: input.companyId,
          bindingId: input.bindingId,
          operationType: input.operationType,
          status: input.status,
          scopeKind: input.scopeKind,
          scopeId: input.scopeId ?? null,
          namespace: input.namespace ?? "memory",
          stateKey: input.stateKey ?? null,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          request: input.request ?? {},
          response: input.response ?? {},
          usage: input.usage ?? {},
          error: input.error ?? null,
          durationMs: input.durationMs ?? null,
        })
        .returning();

      return rows[0] ?? null;
    },

    async listRecentOperations(input: ListMemoryOperationsInput): Promise<MemoryOperation[]> {
      const rows = input.bindingId
        ? await db
            .select()
            .from(memoryOperations)
            .where(
              and(
                eq(memoryOperations.companyId, input.companyId),
                eq(memoryOperations.bindingId, input.bindingId),
              ),
            )
            .orderBy(desc(memoryOperations.createdAt))
            .limit(input.limit ?? 20)
        : await db
            .select()
            .from(memoryOperations)
            .where(eq(memoryOperations.companyId, input.companyId))
            .orderBy(desc(memoryOperations.createdAt))
            .limit(input.limit ?? 20);

      return rows;
    },
  };
}
