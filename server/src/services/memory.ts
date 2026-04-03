import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryBindings, memoryOperations, plugins } from "@paperclipai/db";
import { AGENT_ROLES } from "@paperclipai/shared";
import type {
  AgentRole,
  CreateMemoryBindingInput,
  ListMemoryOperationsInput,
  LogMemoryOperationInput,
  MemoryActorType,
  MemoryBinding,
  MemoryOperation,
  MemoryProposeRequest,
  MemoryProviderCapabilities,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryReadRequest,
  MemorySnippet,
  MemoryStatusChangeRequest,
  MemoryWriteRequest,
  OperationalMemoryKind,
  OperationalMemoryStatus,
  PaperclipPluginManifestV1,
  ResolveMemoryBindingInput,
  SkillMemoryKind,
  SkillMemoryStatus,
  SkillApproveRequest,
  SkillProposeRequest,
  SkillQueryRequest,
  SkillQueryResult,
  SkillSnippet,
  SkillStatusChangeRequest,
  SkillValidationSourceKind,
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
  description: "Built-in local memory backing for Paperclip Memory V2.",
  author: "Paperclip",
  categories: ["automation"],
  capabilities: [],
  entrypoints: {
    worker: "builtin://memory-local",
  },
};

const OPERATIONAL_MEMORY_KINDS = new Set<OperationalMemoryKind>([
  "fact",
  "standard",
  "decision",
  "todo",
  "quality_rule",
  "routing_preference",
]);

const OPERATIONAL_MEMORY_STATUSES = new Set<OperationalMemoryStatus>([
  "candidate",
  "approved",
  "archived",
]);

const SKILL_MEMORY_KINDS = new Set<SkillMemoryKind>([
  "specialist_skill",
]);

const SKILL_MEMORY_STATUSES = new Set<SkillMemoryStatus>([
  "candidate",
  "approved",
  "archived",
]);

const SKILL_VALIDATION_SOURCE_KINDS = new Set<SkillValidationSourceKind>([
  "human_review",
  "peer_agent_review",
  "test_evidence",
]);

type LocalMemoryValue = {
  text: string;
  metadata: Record<string, unknown>;
  kind: OperationalMemoryKind;
  status: OperationalMemoryStatus;
  proposedAt: string;
  approvedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

type LocalSkillValue = {
  text: string;
  metadata: Record<string, unknown>;
  kind: SkillMemoryKind;
  status: SkillMemoryStatus;
  roleFamily: AgentRole;
  proposedByActorType: MemoryActorType | null;
  proposedByActorId: string | null;
  validatedByActorType: MemoryActorType | null;
  validatedByActorId: string | null;
  validationSourceKind: SkillValidationSourceKind | null;
  validationSourceRef: string | null;
  validationNotes: string | null;
  proposedAt: string;
  approvedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
};

type ProviderWriteInput = MemoryWriteRequest & {
  status?: OperationalMemoryStatus;
  proposedAt?: Date | null;
  approvedAt?: Date | null;
  archivedAt?: Date | null;
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

type SkillWriteInput = SkillProposeRequest & {
  status?: SkillMemoryStatus;
  proposedByActorType?: MemoryActorType | null;
  proposedByActorId?: string | null;
  validatedByActorType?: MemoryActorType | null;
  validatedByActorId?: string | null;
  validationSourceKind?: SkillValidationSourceKind | null;
  validationSourceRef?: string | null;
  validationNotes?: string | null;
  proposedAt?: Date | null;
  approvedAt?: Date | null;
  archivedAt?: Date | null;
};

interface MemoryProvider {
  key: string;
  capabilities: MemoryProviderCapabilities;
  write(binding: MemoryBinding, input: ProviderWriteInput): Promise<ProviderWriteResult>;
  read(binding: MemoryBinding, input: MemoryReadRequest): Promise<ProviderReadResult>;
  query(binding: MemoryBinding, input: MemoryQueryRequest): Promise<ProviderQueryResult>;
}

function isOperationalMemoryKind(value: unknown): value is OperationalMemoryKind {
  return typeof value === "string" && OPERATIONAL_MEMORY_KINDS.has(value as OperationalMemoryKind);
}

function isOperationalMemoryStatus(value: unknown): value is OperationalMemoryStatus {
  return typeof value === "string" && OPERATIONAL_MEMORY_STATUSES.has(value as OperationalMemoryStatus);
}

function isMemoryActorType(value: unknown): value is MemoryActorType {
  return value === "agent" || value === "user" || value === "system";
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && AGENT_ROLES.includes(value as AgentRole);
}

function isSkillMemoryKind(value: unknown): value is SkillMemoryKind {
  return typeof value === "string" && SKILL_MEMORY_KINDS.has(value as SkillMemoryKind);
}

function isSkillMemoryStatus(value: unknown): value is SkillMemoryStatus {
  return typeof value === "string" && SKILL_MEMORY_STATUSES.has(value as SkillMemoryStatus);
}

function isSkillValidationSourceKind(value: unknown): value is SkillValidationSourceKind {
  return typeof value === "string" && SKILL_VALIDATION_SOURCE_KINDS.has(value as SkillValidationSourceKind);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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

function normalizeSkillNamespace(binding: MemoryBinding, namespace?: string): string {
  return namespace?.trim() || `${normalizeNamespace(binding)}.skills`;
}

function toSkillStorageNamespace(companyId: string, namespace: string, roleFamily: AgentRole): string {
  return `${toStorageNamespace(companyId, namespace)}:role:${roleFamily}`;
}

function coerceDate(value: Date | string | null | undefined, fallback: Date | null): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildLocalMemoryValue(input: ProviderWriteInput, updatedAt: Date): LocalMemoryValue {
  const kind = input.kind ?? "fact";
  const status = input.status ?? "approved";
  const proposedAt = coerceDate(input.proposedAt, updatedAt) ?? updatedAt;

  const approvedAt = status === "candidate"
    ? null
    : status === "approved"
      ? coerceDate(input.approvedAt, updatedAt) ?? updatedAt
      : coerceDate(input.approvedAt, null);

  const archivedAt = status === "archived"
    ? coerceDate(input.archivedAt, updatedAt) ?? updatedAt
    : null;

  return {
    text: input.content,
    metadata: normalizeMetadata(input.metadata),
    kind,
    status,
    proposedAt: toIsoString(proposedAt) ?? updatedAt.toISOString(),
    approvedAt: toIsoString(approvedAt),
    archivedAt: toIsoString(archivedAt),
    updatedAt: updatedAt.toISOString(),
  };
}

function buildLocalSkillValue(input: SkillWriteInput, updatedAt: Date): LocalSkillValue {
  const kind = input.kind ?? "specialist_skill";
  const status = input.status ?? "approved";
  const proposedAt = coerceDate(input.proposedAt, updatedAt) ?? updatedAt;

  const approvedAt = status === "candidate"
    ? null
    : status === "approved"
      ? coerceDate(input.approvedAt, updatedAt) ?? updatedAt
      : coerceDate(input.approvedAt, null);

  const archivedAt = status === "archived"
    ? coerceDate(input.archivedAt, updatedAt) ?? updatedAt
    : null;

  const proposedByActorType = input.proposedByActorType ?? input.actorType;
  const proposedByActorId = input.proposedByActorId ?? input.actorId ?? null;
  const validatedByActorType = input.validatedByActorType ?? null;
  const validatedByActorId = input.validatedByActorId ?? null;

  return {
    text: input.content,
    metadata: normalizeMetadata(input.metadata),
    kind,
    status,
    roleFamily: input.roleFamily,
    proposedByActorType,
    proposedByActorId,
    validatedByActorType,
    validatedByActorId,
    validationSourceKind: input.validationSourceKind ?? null,
    validationSourceRef: input.validationSourceRef ?? null,
    validationNotes: input.validationNotes ?? null,
    proposedAt: toIsoString(proposedAt) ?? updatedAt.toISOString(),
    approvedAt: toIsoString(approvedAt),
    archivedAt: toIsoString(archivedAt),
    updatedAt: updatedAt.toISOString(),
  };
}

function parseLocalMemoryValue(value: unknown): LocalMemoryValue | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string") return null;

  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString();
  const kind = isOperationalMemoryKind(record.kind) ? record.kind : "fact";
  const status = isOperationalMemoryStatus(record.status) ? record.status : "approved";
  const proposedAt = typeof record.proposedAt === "string" ? record.proposedAt : updatedAt;
  const approvedAt = typeof record.approvedAt === "string"
    ? record.approvedAt
    : status === "approved"
      ? updatedAt
      : null;
  const archivedAt = typeof record.archivedAt === "string"
    ? record.archivedAt
    : status === "archived"
      ? updatedAt
      : null;

  return {
    text: record.text,
    metadata: normalizeMetadata(record.metadata),
    kind,
    status,
    proposedAt,
    approvedAt,
    archivedAt,
    updatedAt,
  };
}

function parseLocalSkillValue(value: unknown): LocalSkillValue | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string") return null;
  if (!isAgentRole(record.roleFamily)) return null;

  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString();
  const kind = isSkillMemoryKind(record.kind) ? record.kind : "specialist_skill";
  const status = isSkillMemoryStatus(record.status) ? record.status : "approved";
  const proposedByActorType = isMemoryActorType(record.proposedByActorType) ? record.proposedByActorType : null;
  const proposedByActorId = typeof record.proposedByActorId === "string" ? record.proposedByActorId : null;
  const validatedByActorType = isMemoryActorType(record.validatedByActorType) ? record.validatedByActorType : null;
  const validatedByActorId = typeof record.validatedByActorId === "string" ? record.validatedByActorId : null;
  const validationSourceKind = isSkillValidationSourceKind(record.validationSourceKind)
    ? record.validationSourceKind
    : null;
  const validationSourceRef = typeof record.validationSourceRef === "string" ? record.validationSourceRef : null;
  const validationNotes = typeof record.validationNotes === "string" ? record.validationNotes : null;
  const proposedAt = typeof record.proposedAt === "string" ? record.proposedAt : updatedAt;
  const approvedAt = typeof record.approvedAt === "string"
    ? record.approvedAt
    : status === "approved"
      ? updatedAt
      : null;
  const archivedAt = typeof record.archivedAt === "string"
    ? record.archivedAt
    : status === "archived"
      ? updatedAt
      : null;

  return {
    text: record.text,
    metadata: normalizeMetadata(record.metadata),
    kind,
    status,
    roleFamily: record.roleFamily,
    proposedByActorType,
    proposedByActorId,
    validatedByActorType,
    validatedByActorId,
    validationSourceKind,
    validationSourceRef,
    validationNotes,
    proposedAt,
    approvedAt,
    archivedAt,
    updatedAt,
  };
}

function buildSnippet(binding: MemoryBinding, input: {
  stateKey: string;
  text: string;
  kind: OperationalMemoryKind;
  status: OperationalMemoryStatus;
  scopeKind: string;
  scopeId: string | null;
  namespace: string;
  metadata?: Record<string, unknown>;
  proposedAt: Date;
  approvedAt: Date | null;
  archivedAt: Date | null;
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
    kind: input.kind,
    status: input.status,
    scopeKind: input.scopeKind as MemorySnippet["scopeKind"],
    scopeId: input.scopeId,
    namespace: input.namespace,
    metadata: input.metadata ?? {},
    proposedAt: input.proposedAt,
    approvedAt: input.approvedAt,
    archivedAt: input.archivedAt,
    updatedAt: input.updatedAt,
    score: input.score,
  };
}

function buildSkillSnippet(binding: MemoryBinding, input: {
  stateKey: string;
  text: string;
  kind: SkillMemoryKind;
  status: SkillMemoryStatus;
  roleFamily: AgentRole;
  scopeKind: string;
  scopeId: string | null;
  namespace: string;
  metadata?: Record<string, unknown>;
  proposedByActorType: MemoryActorType | null;
  proposedByActorId: string | null;
  validatedByActorType: MemoryActorType | null;
  validatedByActorId: string | null;
  validationSourceKind: SkillValidationSourceKind | null;
  validationSourceRef: string | null;
  validationNotes: string | null;
  proposedAt: Date;
  approvedAt: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
  score?: number;
}): SkillSnippet {
  return {
    handle: {
      providerKey: binding.providerKey,
      providerRecordId: input.stateKey,
    },
    stateKey: input.stateKey,
    text: input.text,
    kind: input.kind,
    status: input.status,
    roleFamily: input.roleFamily,
    scopeKind: input.scopeKind as SkillSnippet["scopeKind"],
    scopeId: input.scopeId,
    namespace: input.namespace,
    metadata: input.metadata ?? {},
    proposedByActorType: input.proposedByActorType,
    proposedByActorId: input.proposedByActorId,
    validatedByActorType: input.validatedByActorType,
    validatedByActorId: input.validatedByActorId,
    validationSourceKind: input.validationSourceKind,
    validationSourceRef: input.validationSourceRef,
    validationNotes: input.validationNotes,
    proposedAt: input.proposedAt,
    approvedAt: input.approvedAt,
    archivedAt: input.archivedAt,
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

function isSnippetVisibleInQuery(snippet: MemorySnippet, input: MemoryQueryRequest): boolean {
  if (snippet.status === "approved") return true;
  if (snippet.status === "candidate") return Boolean(input.includeCandidate);
  if (snippet.status === "archived") return Boolean(input.includeArchived);
  return false;
}

function isSkillSnippetVisibleInQuery(snippet: SkillSnippet, input: SkillQueryRequest): boolean {
  if (snippet.status === "approved") return true;
  if (snippet.status === "candidate") return Boolean(input.includeCandidate);
  if (snippet.status === "archived") return Boolean(input.includeArchived);
  return false;
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

  function assertLocalSkillBinding(binding: MemoryBinding): void {
    if (binding.providerKey !== "local") {
      throw new Error(`Skill memory is only supported for local bindings: ${binding.providerKey}`);
    }
  }

  async function writeSkillRecord(binding: MemoryBinding, input: SkillWriteInput): Promise<SkillSnippet> {
    assertLocalSkillBinding(binding);
    const pluginId = binding.pluginId ?? await ensureLocalMemoryPluginId();
    const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
    const namespace = normalizeSkillNamespace(binding, input.namespace);
    const updatedAt = new Date();
    const value = buildLocalSkillValue(input, updatedAt);

    await stateStore.set(pluginId, {
      scopeKind: input.scopeKind,
      scopeId: scopeId ?? undefined,
      namespace: toSkillStorageNamespace(binding.companyId, namespace, input.roleFamily),
      stateKey: input.stateKey,
      value,
    });

    return buildSkillSnippet(binding, {
      stateKey: input.stateKey,
      text: value.text,
      kind: value.kind,
      status: value.status,
      roleFamily: value.roleFamily,
      scopeKind: input.scopeKind,
      scopeId,
      namespace,
      metadata: value.metadata,
      proposedByActorType: value.proposedByActorType,
      proposedByActorId: value.proposedByActorId,
      validatedByActorType: value.validatedByActorType,
      validatedByActorId: value.validatedByActorId,
      validationSourceKind: value.validationSourceKind,
      validationSourceRef: value.validationSourceRef,
      validationNotes: value.validationNotes,
      proposedAt: new Date(value.proposedAt),
      approvedAt: value.approvedAt ? new Date(value.approvedAt) : null,
      archivedAt: value.archivedAt ? new Date(value.archivedAt) : null,
      updatedAt,
    });
  }

  async function readSkillRecord(
    binding: MemoryBinding,
    input: SkillStatusChangeRequest,
  ): Promise<SkillSnippet | null> {
    assertLocalSkillBinding(binding);
    const pluginId = binding.pluginId ?? await ensureLocalMemoryPluginId();
    const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
    const namespace = normalizeSkillNamespace(binding, input.namespace);
    const raw = await stateStore.get(pluginId, input.scopeKind, input.stateKey, {
      scopeId: scopeId ?? undefined,
      namespace: toSkillStorageNamespace(binding.companyId, namespace, input.roleFamily),
    });
    const parsed = parseLocalSkillValue(raw);

    if (!parsed) {
      return null;
    }

    return buildSkillSnippet(binding, {
      stateKey: input.stateKey,
      text: parsed.text,
      kind: parsed.kind,
      status: parsed.status,
      roleFamily: parsed.roleFamily,
      scopeKind: input.scopeKind,
      scopeId,
      namespace,
      metadata: parsed.metadata,
      proposedByActorType: parsed.proposedByActorType,
      proposedByActorId: parsed.proposedByActorId,
      validatedByActorType: parsed.validatedByActorType,
      validatedByActorId: parsed.validatedByActorId,
      validationSourceKind: parsed.validationSourceKind,
      validationSourceRef: parsed.validationSourceRef,
      validationNotes: parsed.validationNotes,
      proposedAt: new Date(parsed.proposedAt),
      approvedAt: parsed.approvedAt ? new Date(parsed.approvedAt) : null,
      archivedAt: parsed.archivedAt ? new Date(parsed.archivedAt) : null,
      updatedAt: new Date(parsed.updatedAt),
    });
  }

  async function querySkillRecords(binding: MemoryBinding, input: SkillQueryRequest): Promise<SkillQueryResult> {
    assertLocalSkillBinding(binding);
    const pluginId = binding.pluginId ?? await ensureLocalMemoryPluginId();
    const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
    const namespace = normalizeSkillNamespace(binding, input.namespace);
    const rows = await stateStore.list(pluginId, {
      scopeKind: input.scopeKind,
      scopeId: scopeId ?? undefined,
      namespace: toSkillStorageNamespace(binding.companyId, namespace, input.roleFamily),
    });

    const snippets = rows
      .map((row) => {
        const parsed = parseLocalSkillValue(row.valueJson);
        if (!parsed) return null;

        const score = scoreSnippet(input.query, row.stateKey, parsed.text);
        if (input.query.trim().length > 0 && score <= 0) return null;

        return buildSkillSnippet(binding, {
          stateKey: row.stateKey,
          text: parsed.text,
          kind: parsed.kind,
          status: parsed.status,
          roleFamily: parsed.roleFamily,
          scopeKind: row.scopeKind,
          scopeId: row.scopeId,
          namespace,
          metadata: parsed.metadata,
          proposedByActorType: parsed.proposedByActorType,
          proposedByActorId: parsed.proposedByActorId,
          validatedByActorType: parsed.validatedByActorType,
          validatedByActorId: parsed.validatedByActorId,
          validationSourceKind: parsed.validationSourceKind,
          validationSourceRef: parsed.validationSourceRef,
          validationNotes: parsed.validationNotes,
          proposedAt: new Date(parsed.proposedAt),
          approvedAt: parsed.approvedAt ? new Date(parsed.approvedAt) : null,
          archivedAt: parsed.archivedAt ? new Date(parsed.archivedAt) : null,
          updatedAt: new Date(parsed.updatedAt),
          score,
        });
      })
      .filter((row): row is SkillSnippet => row !== null)
      .sort((left, right) => {
        const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
        if (scoreDelta != 0) return scoreDelta;
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      });

    return { snippets };
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
      const value = buildLocalMemoryValue(input, updatedAt);

      await stateStore.set(pluginId, {
        scopeKind: input.scopeKind,
        scopeId: scopeId ?? undefined,
        namespace: toStorageNamespace(binding.companyId, namespace),
        stateKey: input.stateKey,
        value,
      });

      return {
        snippet: buildSnippet(binding, {
          stateKey: input.stateKey,
          text: value.text,
          kind: value.kind,
          status: value.status,
          scopeKind: input.scopeKind,
          scopeId,
          namespace,
          metadata: value.metadata,
          proposedAt: new Date(value.proposedAt),
          approvedAt: value.approvedAt ? new Date(value.approvedAt) : null,
          archivedAt: value.archivedAt ? new Date(value.archivedAt) : null,
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
          kind: parsed.kind,
          status: parsed.status,
          scopeKind: input.scopeKind,
          scopeId,
          namespace,
          metadata: parsed.metadata,
          proposedAt: new Date(parsed.proposedAt),
          approvedAt: parsed.approvedAt ? new Date(parsed.approvedAt) : null,
          archivedAt: parsed.archivedAt ? new Date(parsed.archivedAt) : null,
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
            kind: parsed.kind,
            status: parsed.status,
            scopeKind: row.scopeKind,
            scopeId: row.scopeId,
            namespace,
            metadata: parsed.metadata,
            proposedAt: new Date(parsed.proposedAt),
            approvedAt: parsed.approvedAt ? new Date(parsed.approvedAt) : null,
            archivedAt: parsed.archivedAt ? new Date(parsed.archivedAt) : null,
            updatedAt: new Date(parsed.updatedAt),
            score,
          });
        })
        .filter((row): row is MemorySnippet => row !== null)
        .sort((left, right) => {
          const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
          if (scoreDelta !== 0) return scoreDelta;
          return right.updatedAt.getTime() - left.updatedAt.getTime();
        });

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

  async function readExistingMemory(
    binding: MemoryBinding,
    provider: MemoryProvider,
    input: MemoryStatusChangeRequest,
  ): Promise<MemorySnippet> {
    const result = await provider.read(binding, input);
    if (!result.snippet) {
      throw new Error(`Memory not found: ${input.stateKey}`);
    }
    return result.snippet;
  }

  async function readExistingSkill(
    binding: MemoryBinding,
    input: SkillStatusChangeRequest,
  ): Promise<SkillSnippet> {
    const snippet = await readSkillRecord(binding, input);
    if (!snippet) {
      throw new Error(`Skill memory not found: ${input.stateKey}`);
    }
    return snippet;
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
          kind: input.kind ?? "fact",
          content: input.content,
          metadata: input.metadata ?? {},
        },
        action: async () => {
          const result = await provider.write(binding, {
            ...input,
            status: "approved",
          });
          return {
            result: result.snippet,
            response: {
              stateKey: result.snippet.stateKey,
              kind: result.snippet.kind,
              status: result.snippet.status,
              providerRecordId: result.snippet.handle.providerRecordId,
            },
            usage: result.usage,
          };
        },
      });
    },

    async proposeMemory(input: MemoryProposeRequest): Promise<MemorySnippet> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const provider = await getProvider(binding);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "propose",
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
          kind: input.kind,
          content: input.content,
          metadata: input.metadata ?? {},
        },
        action: async () => {
          const result = await provider.write(binding, {
            ...input,
            status: "candidate",
          });
          return {
            result: result.snippet,
            response: {
              stateKey: result.snippet.stateKey,
              kind: result.snippet.kind,
              status: result.snippet.status,
              providerRecordId: result.snippet.handle.providerRecordId,
            },
            usage: result.usage,
          };
        },
      });
    },

    async approveMemory(input: MemoryStatusChangeRequest): Promise<MemorySnippet> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const provider = await getProvider(binding);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "approve",
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
          const existing = await readExistingMemory(binding, provider, input);
          if (existing.status === "archived") {
            throw new Error(`Archived memory cannot be approved: ${input.stateKey}`);
          }

          const result = await provider.write(binding, {
            ...input,
            content: existing.text,
            kind: existing.kind,
            metadata: existing.metadata ?? {},
            status: "approved",
            proposedAt: existing.proposedAt,
            approvedAt: existing.approvedAt ?? new Date(),
          });

          return {
            result: result.snippet,
            response: {
              stateKey: result.snippet.stateKey,
              kind: result.snippet.kind,
              status: result.snippet.status,
            },
            usage: result.usage,
          };
        },
      });
    },

    async archiveMemory(input: MemoryStatusChangeRequest): Promise<MemorySnippet> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const provider = await getProvider(binding);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "archive",
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
          const existing = await readExistingMemory(binding, provider, input);

          if (existing.status === "archived") {
            return {
              result: existing,
              response: {
                stateKey: existing.stateKey,
                kind: existing.kind,
                status: existing.status,
              },
            };
          }

          const result = await provider.write(binding, {
            ...input,
            content: existing.text,
            kind: existing.kind,
            metadata: existing.metadata ?? {},
            status: "archived",
            proposedAt: existing.proposedAt,
            approvedAt: existing.approvedAt,
            archivedAt: existing.archivedAt ?? new Date(),
          });

          return {
            result: result.snippet,
            response: {
              stateKey: result.snippet.stateKey,
              kind: result.snippet.kind,
              status: result.snippet.status,
            },
            usage: result.usage,
          };
        },
      });
    },

    async proposeSkill(input: SkillProposeRequest): Promise<SkillSnippet> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeSkillNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "propose_skill",
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
          roleFamily: input.roleFamily,
          kind: input.kind ?? "specialist_skill",
          content: input.content,
          metadata: input.metadata ?? {},
        },
        action: async () => {
          const existing = await readSkillRecord(binding, {
            companyId: input.companyId,
            bindingKey: input.bindingKey,
            scopeKind: input.scopeKind,
            scopeId,
            namespace,
            stateKey: input.stateKey,
            roleFamily: input.roleFamily,
            actorType: input.actorType,
            actorId: input.actorId,
          });
          const preservedCandidate = existing?.status === "candidate" ? existing : null;

          const snippet = await writeSkillRecord(binding, {
            ...input,
            status: "candidate",
            proposedByActorType: preservedCandidate?.proposedByActorType ?? input.actorType,
            proposedByActorId: preservedCandidate?.proposedByActorId ?? input.actorId ?? null,
            proposedAt: preservedCandidate?.proposedAt ?? undefined,
          });
          return {
            result: snippet,
            response: {
              stateKey: snippet.stateKey,
              roleFamily: snippet.roleFamily,
              kind: snippet.kind,
              status: snippet.status,
              providerRecordId: snippet.handle.providerRecordId,
            },
          };
        },
      });
    },

    async approveSkill(input: SkillApproveRequest): Promise<SkillSnippet> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeSkillNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "approve_skill",
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
          roleFamily: input.roleFamily,
          validationSourceKind: input.validationSourceKind ?? null,
          validationSourceRef: input.validationSourceRef ?? null,
          validationNotes: input.validationNotes ?? null,
        },
        action: async () => {
          const existing = await readExistingSkill(binding, input);
          if (existing.status === "archived") {
            throw new Error(`Archived skill memory cannot be approved: ${input.stateKey}`);
          }

          const snippet = await writeSkillRecord(binding, {
            ...input,
            content: existing.text,
            kind: existing.kind,
            roleFamily: existing.roleFamily,
            metadata: existing.metadata ?? {},
            status: "approved",
            proposedByActorType: existing.proposedByActorType,
            proposedByActorId: existing.proposedByActorId,
            validatedByActorType: input.actorType,
            validatedByActorId: input.actorId ?? null,
            validationSourceKind: input.validationSourceKind ?? null,
            validationSourceRef: input.validationSourceRef ?? null,
            validationNotes: input.validationNotes ?? null,
            proposedAt: existing.proposedAt,
            approvedAt: existing.approvedAt ?? new Date(),
          });

          return {
            result: snippet,
            response: {
              stateKey: snippet.stateKey,
              roleFamily: snippet.roleFamily,
              kind: snippet.kind,
              status: snippet.status,
              proposedByActorType: snippet.proposedByActorType,
              validatedByActorType: snippet.validatedByActorType,
              validationSourceKind: snippet.validationSourceKind,
            },
          };
        },
      });
    },

    async archiveSkill(input: SkillStatusChangeRequest): Promise<SkillSnippet> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeSkillNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "archive_skill",
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
          roleFamily: input.roleFamily,
        },
        action: async () => {
          const existing = await readExistingSkill(binding, input);

          if (existing.status === "archived") {
            return {
              result: existing,
              response: {
                stateKey: existing.stateKey,
                roleFamily: existing.roleFamily,
                kind: existing.kind,
                status: existing.status,
              },
            };
          }

          const snippet = await writeSkillRecord(binding, {
            ...input,
            content: existing.text,
            kind: existing.kind,
            roleFamily: existing.roleFamily,
            metadata: existing.metadata ?? {},
            status: "archived",
            proposedByActorType: existing.proposedByActorType,
            proposedByActorId: existing.proposedByActorId,
            validatedByActorType: existing.validatedByActorType,
            validatedByActorId: existing.validatedByActorId,
            validationSourceKind: existing.validationSourceKind,
            validationSourceRef: existing.validationSourceRef,
            validationNotes: existing.validationNotes,
            proposedAt: existing.proposedAt,
            approvedAt: existing.approvedAt,
            archivedAt: existing.archivedAt ?? new Date(),
          });

          return {
            result: snippet,
            response: {
              stateKey: snippet.stateKey,
              roleFamily: snippet.roleFamily,
              kind: snippet.kind,
              status: snippet.status,
            },
          };
        },
      });
    },

    async querySkills(input: SkillQueryRequest): Promise<SkillQueryResult> {
      const binding = await resolveActiveBinding(input.companyId, input.bindingKey);
      const scopeId = normalizeScopeId(binding.companyId, input.scopeKind, input.scopeId);
      const namespace = normalizeSkillNamespace(binding, input.namespace);

      return logExecution({
        binding,
        operationType: "query_skills",
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
          roleFamily: input.roleFamily,
          query: input.query,
          limit: input.limit ?? 10,
          includeCandidate: input.includeCandidate ?? false,
          includeArchived: input.includeArchived ?? false,
        },
        action: async () => {
          const providerResult = await querySkillRecords(binding, input);
          const result = {
            ...providerResult,
            snippets: providerResult.snippets
              .filter((snippet) => isSkillSnippetVisibleInQuery(snippet, input))
              .slice(0, input.limit ?? 10),
          };

          return {
            result,
            response: {
              hits: result.snippets.length,
              stateKeys: result.snippets.map((snippet) => snippet.stateKey),
              statuses: result.snippets.map((snippet) => snippet.status),
              roleFamily: input.roleFamily,
            },
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
              status: result.snippet?.status ?? null,
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
          includeCandidate: input.includeCandidate ?? false,
          includeArchived: input.includeArchived ?? false,
        },
        action: async () => {
          const providerResult = await provider.query(binding, input);
          const result = {
            ...providerResult,
            snippets: providerResult.snippets
              .filter((snippet) => isSnippetVisibleInQuery(snippet, input))
              .slice(0, input.limit ?? 10),
          };

          return {
            result,
            response: {
              hits: result.snippets.length,
              stateKeys: result.snippets.map((snippet) => snippet.stateKey),
              statuses: result.snippets.map((snippet) => snippet.status),
            },
            usage: providerResult.usage,
          };
        },
      });
    },
  };

  return api;
}
