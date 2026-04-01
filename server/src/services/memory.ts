import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryBindings, memoryOperations, plugins } from "@paperclipai/db";
import type {
  CreateMemoryBindingInput,
  ListMemoryOperationsInput,
  LogMemoryOperationInput,
  MemoryBinding,
  MemoryOperation,
  MemoryProviderCapabilities,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryReadRequest,
  MemorySnippet,
  MemoryWriteRequest,
  PaperclipPluginManifestV1,
  ResolveMemoryBindingInput,
  UpdateMemoryBindingStatusInput,
} from "@paperclipai/shared";
import { pluginStateStore } from "./plugin-state-store.js";

const LOCAL_MEMORY_PLUGIN_KEY = "paperclip.memory.local";
const LOCAL_MEMORY_PLUGIN_PACKAGE_NAME = "@paperclipai/builtin-memory-local";
const LOCAL_MEMORY_PLUGIN_MANIFEST: PaperclipPluginManifestV1 = {
  id: LOCAL_MEMORY_PLUGIN_KEY,
  apiVersion: 1,
  version: "0.0.0",
  displayName: "Paperclip Local Memory",
  description: "Built-in local memory backing for Paperclip Memory V1.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: [],
  entrypoints: {
    worker: "builtin://memory-local",
  },
};

type LocalMemoryValue = {
  text: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

type ProviderWriteResult = {
  snippet: MemorySnippet;
  usage?: Record<string, unknown>;
};

type ProviderReadResult = {
  snippet: MemorySnippet | null;
  usage?: Record<string, unknown>;
};

type ProviderQueryResult = MemoryQueryResult & {
  usage?: Record<string, unknown>;
};

interface MemoryProvider {
  key: string;
  capabilities: MemoryProviderCapabilities;
  write(binding: MemoryBinding, input: MemoryWriteRequest): Promise<ProviderWriteResult>;
  read(binding: MemoryBinding, input: MemoryReadRequest): Promise<ProviderReadResult>;
  query(binding: MemoryBinding, input: MemoryQueryRequest): Promise<ProviderQueryResult>;
}

function normalizeScopeId(companyId: string, scopeKind: string, scopeId?: string | null): string | null {
  if (typeof scopeId === "string" && scopeId.trim().length > 0) return scopeId;
  return scopeKind === "company" ? companyId : null;
}

function normalizeNamespace(binding: MemoryBinding, namespace?: string): string {
  return namespace?.trim() || binding.namespace || "memory";
}

function toStorageNamespace(companyId: string, namespace: string): string {
  return `paperclip-memory:${companyId}:${namespace}`;
}

function parseLocalMemoryValue(value: unknown): LocalMemoryValue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string") return null;

  return {
    text: record.text,
    metadata: record.metadata && typeof record.metadata === "object"
      ? record.metadata as Record<string, unknown>
      : {},
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  };
}

function buildSnippet(binding: MemoryBinding, input: {
  stateKey: string;
  text: string;
  scopeKind: string;
  scopeId: string | null;
  namespace: string;
  metadata?: Record<string, unknown>;
  updatedAt: Date;
  score?: number;
}): MemorySnippet {
  return {
    handle: {
      providerKey: binding.providerKey,
      providerRecordId: input.stateKey,
    },
    stateKey: input.stateKey,
    text: input.text,
    scopeKind: input.scopeKind as MemorySnippet["scopeKind"],
    scopeId: input.scopeId,
    namespace: input.namespace,
    metadata: input.metadata ?? {},
    updatedAt: input.updatedAt,
    score: input.score,
  };
}

function scoreSnippet(query: string, stateKey: string, text: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const normalizedStateKey = stateKey.toLowerCase();
  const normalizedText = text.toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  let score = 0;
  if (normalizedStateKey === normalizedQuery) score += 50;
  if (normalizedStateKey.includes(normalizedQuery)) score += 20;
  if (normalizedText.includes(normalizedQuery)) score += 40;

  for (const token of tokens) {
    if (normalizedText.includes(token)) score += 5;
    if (normalizedStateKey.includes(token)) score += 3;
  }

  return score;
}

export function memoryService(db: Db) {
  const stateStore = pluginStateStore(db);

  async function ensureLocalMemoryPluginId(): Promise<string> {
    const existing = await db
      .select({ id: plugins.id })
      .from(plugins)
      .where(eq(plugins.pluginKey, LOCAL_MEMORY_PLUGIN_KEY))
      .limit(1);

    if (existing[0]?.id) return existing[0].id;

    await db
      .insert(plugins)
      .values({
        pluginKey: LOCAL_MEMORY_PLUGIN_KEY,
        packageName: LOCAL_MEMORY_PLUGIN_PACKAGE_NAME,
        version: LOCAL_MEMORY_PLUGIN_MANIFEST.version,
        apiVersion: LOCAL_MEMORY_PLUGIN_MANIFEST.apiVersion,
        categories: LOCAL_MEMORY_PLUGIN_MANIFEST.categories,
        manifestJson: LOCAL_MEMORY_PLUGIN_MANIFEST,
        status: "uninstalled",
        installOrder: null,
        packagePath: null,
        lastError: null,
      })
      .onConflictDoNothing({
        target: plugins.pluginKey,
      });

    const created = await db
      .select({ id: plugins.id })
      .from(plugins)
      .where(eq(plugins.pluginKey, LOCAL_MEMORY_PLUGIN_KEY))
      .limit(1);

    if (!created[0]?.id) {
      throw new Error("Failed to initialize local memory plugin record");
    }

    return created[0].id;
  }

  const localProvider: MemoryProvider = {
    key: "local",
    capabilities: {
      write: true,
      read: true,
      query: true,
    },

    async write(binding, input) {
      const pluginId = binding.pluginId ?? await ensureLocalMemoryPluginId();
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);
      const updatedAt = new Date();

      await stateStore.set(pluginId, {
        scopeKind: input.scopeKind,
        scopeId: scopeId ?? undefined,
        namespace: toStorageNamespace(binding.companyId, namespace),
        stateKey: input.stateKey,
        value: {
          text: input.content,
          metadata: input.metadata ?? {},
          updatedAt: updatedAt.toISOString(),
        } satisfies LocalMemoryValue,
      });

      return {
        snippet: buildSnippet(binding, {
          stateKey: input.stateKey,
          text: input.content,
          scopeKind: input.scopeKind,
          scopeId,
          namespace,
          metadata: input.metadata ?? {},
          updatedAt,
        }),
      };
    },

    async read(binding, input) {
      const pluginId = binding.pluginId ?? await ensureLocalMemoryPluginId();
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);
      const raw = await stateStore.get(pluginId, input.scopeKind, input.stateKey, {
        scopeId: scopeId ?? undefined,
        namespace: toStorageNamespace(binding.companyId, namespace),
      });
      const parsed = parseLocalMemoryValue(raw);

      if (!parsed) {
        return { snippet: null };
      }

      return {
        snippet: buildSnippet(binding, {
          stateKey: input.stateKey,
          text: parsed.text,
          scopeKind: input.scopeKind,
          scopeId,
          namespace,
          metadata: parsed.metadata,
          updatedAt: new Date(parsed.updatedAt),
        }),
      };
    },

    async query(binding, input) {
      const pluginId = binding.pluginId ?? await ensureLocalMemoryPluginId();
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);
      const rows = await stateStore.list(pluginId, {
        scopeKind: input.scopeKind,
        scopeId: scopeId ?? undefined,
        namespace: toStorageNamespace(binding.companyId, namespace),
      });

      const snippets = rows
        .map((row) => {
          const parsed = parseLocalMemoryValue(row.valueJson);
          if (!parsed) return null;
          const score = scoreSnippet(input.query, row.stateKey, parsed.text);
          if (input.query.trim().length > 0 && score <= 0) return null;

          return buildSnippet(binding, {
            stateKey: row.stateKey,
            text: parsed.text,
            scopeKind: row.scopeKind,
            scopeId: row.scopeId,
            namespace,
            metadata: parsed.metadata,
            updatedAt: new Date(parsed.updatedAt),
            score,
          });
        })
        .filter((row): row is MemorySnippet => row !== null)
        .sort((left, right) => {
          const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
          if (scoreDelta !== 0) return scoreDelta;
          return right.updatedAt.getTime() - left.updatedAt.getTime();
        })
        .slice(0, input.limit ?? 10);

      return { snippets };
    },
  };

  const providers = new Map<string, MemoryProvider>([
    [localProvider.key, localProvider],
  ]);

  async function getProvider(binding: MemoryBinding): Promise<MemoryProvider> {
    const provider = providers.get(binding.providerKey);
    if (!provider) {
      throw new Error(`Unsupported memory provider: ${binding.providerKey}`);
    }
    return provider;
  }

  async function resolveActiveBinding(companyId: string, bindingKey: string): Promise<MemoryBinding> {
    const binding = await api.resolveBindingByKey({ companyId, bindingKey });
    if (!binding) {
      throw new Error(`Memory binding not found: ${bindingKey}`);
    }
    return binding;
  }

  async function logExecution<T>(params: {
    binding: MemoryBinding;
    operationType: string;
    scopeKind: string;
    scopeId: string | null;
    namespace: string;
    stateKey?: string | null;
    actorType: string;
    actorId?: string | null;
    request: Record<string, unknown>;
    action: () => Promise<{
      result: T;
      response: Record<string, unknown>;
      usage?: Record<string, unknown>;
    }>;
  }): Promise<T> {
    const startedAt = Date.now();

    try {
      const outcome = await params.action();
      await api.logOperation({
        companyId: params.binding.companyId,
        bindingId: params.binding.id,
        operationType: params.operationType,
        status: "success",
        scopeKind: params.scopeKind as LogMemoryOperationInput["scopeKind"],
        scopeId: params.scopeId,
        namespace: params.namespace,
        stateKey: params.stateKey ?? null,
        actorType: params.actorType as LogMemoryOperationInput["actorType"],
        actorId: params.actorId ?? null,
        request: params.request,
        response: outcome.response,
        usage: outcome.usage ?? {},
        durationMs: Date.now() - startedAt,
      });
      return outcome.result;
    } catch (error) {
      await api.logOperation({
        companyId: params.binding.companyId,
        bindingId: params.binding.id,
        operationType: params.operationType,
        status: "error",
        scopeKind: params.scopeKind as LogMemoryOperationInput["scopeKind"],
        scopeId: params.scopeId,
        namespace: params.namespace,
        stateKey: params.stateKey ?? null,
        actorType: params.actorType as LogMemoryOperationInput["actorType"],
        actorId: params.actorId ?? null,
        request: params.request,
        response: {},
        usage: {},
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  const api = {
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

    async writeMemory(input: MemoryWriteRequest): Promise<MemorySnippet> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const provider = await getProvider(binding);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "write",
        scopeKind: input.scopeKind,
        scopeId,
        namespace,
        stateKey: input.stateKey,
        actorType: input.actorType,
        actorId: input.actorId,
        request: {
          bindingKey: input.bindingKey,
          scopeKind: input.scopeKind,
          scopeId,
          namespace,
          stateKey: input.stateKey,
          content: input.content,
          metadata: input.metadata ?? {},
        },
        action: async () => {
          const result = await provider.write(binding, input);
          return {
            result: result.snippet,
            response: {
              stateKey: result.snippet.stateKey,
              providerRecordId: result.snippet.handle.providerRecordId,
            },
            usage: result.usage,
          };
        },
      });
    },

    async readMemory(input: MemoryReadRequest): Promise<MemorySnippet | null> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const provider = await getProvider(binding);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "read",
        scopeKind: input.scopeKind,
        scopeId,
        namespace,
        stateKey: input.stateKey,
        actorType: input.actorType,
        actorId: input.actorId,
        request: {
          bindingKey: input.bindingKey,
          scopeKind: input.scopeKind,
          scopeId,
          namespace,
          stateKey: input.stateKey,
        },
        action: async () => {
          const result = await provider.read(binding, input);
          return {
            result: result.snippet,
            response: {
              found: Boolean(result.snippet),
              stateKey: result.snippet?.stateKey ?? input.stateKey,
            },
            usage: result.usage,
          };
        },
      });
    },

    async queryMemory(input: MemoryQueryRequest): Promise<MemoryQueryResult> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const provider = await getProvider(binding);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "query",
        scopeKind: input.scopeKind,
        scopeId,
        namespace,
        actorType: input.actorType,
        actorId: input.actorId,
        request: {
          bindingKey: input.bindingKey,
          scopeKind: input.scopeKind,
          scopeId,
          namespace,
          query: input.query,
          limit: input.limit ?? 10,
        },
        action: async () => {
          const result = await provider.query(binding, input);
          return {
            result,
            response: {
              hits: result.snippets.length,
              stateKeys: result.snippets.map((snippet) => snippet.stateKey),
            },
            usage: result.usage,
          };
        },
      });
    },
  };

  return api;
}
