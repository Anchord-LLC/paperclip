import type { AgentRole, PluginStateScopeKind } from "../constants.js";

export type MemoryBindingStatus = "active" | "disabled";
export type MemoryScopeKind = PluginStateScopeKind;
export type MemoryActorType = "agent" | "user" | "system";
export type OperationalMemoryKind =
  | "fact"
  | "standard"
  | "decision"
  | "todo"
  | "quality_rule"
  | "routing_preference";
export type OperationalMemoryStatus = "candidate" | "approved" | "archived";
export type SkillMemoryKind = "specialist_skill";
export type SkillMemoryStatus = "candidate" | "approved" | "archived";

export interface MemoryProviderCapabilities {
  write?: boolean;
  read?: boolean;
  query?: boolean;
}

export interface MemoryBinding {
  id: string;
  companyId: string;
  bindingKey: string;
  label: string;
  providerKey: string;
  pluginId: string | null;
  namespace: string;
  status: string;
  config: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

export interface MemoryOperation {
  id: string;
  companyId: string;
  bindingId: string;
  operationType: string;
  status: string;
  scopeKind: string;
  scopeId: string | null;
  namespace: string;
  stateKey: string | null;
  actorType: string;
  actorId: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  usage: Record<string, unknown>;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface ResolveMemoryBindingInput {
  companyId: string;
  bindingKey: string;
  activeOnly?: boolean;
}

export interface CreateMemoryBindingInput {
  companyId: string;
  bindingKey: string;
  label: string;
  providerKey: string;
  pluginId?: string | null;
  namespace?: string;
  status?: MemoryBindingStatus;
  config?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

export interface UpdateMemoryBindingStatusInput {
  companyId: string;
  bindingId: string;
  status: MemoryBindingStatus;
}

export interface LogMemoryOperationInput {
  companyId: string;
  bindingId: string;
  operationType: string;
  status: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  stateKey?: string | null;
  actorType: MemoryActorType;
  actorId?: string | null;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  durationMs?: number | null;
}

export interface ListMemoryOperationsInput {
  companyId: string;
  bindingId?: string;
  limit?: number;
}

export interface MemoryRecordHandle {
  providerKey: string;
  providerRecordId: string;
}

export interface MemorySnippet {
  handle: MemoryRecordHandle;
  stateKey: string;
  text: string;
  kind: OperationalMemoryKind;
  status: OperationalMemoryStatus;
  scopeKind: MemoryScopeKind;
  scopeId: string | null;
  namespace: string;
  score?: number;
  metadata?: Record<string, unknown>;
  proposedAt: Date;
  approvedAt: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface SkillSnippet {
  handle: MemoryRecordHandle;
  stateKey: string;
  text: string;
  kind: SkillMemoryKind;
  status: SkillMemoryStatus;
  roleFamily: AgentRole;
  scopeKind: MemoryScopeKind;
  scopeId: string | null;
  namespace: string;
  score?: number;
  metadata?: Record<string, unknown>;
  proposedAt: Date;
  approvedAt: Date | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface MemoryWriteRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  stateKey: string;
  content: string;
  kind?: OperationalMemoryKind;
  metadata?: Record<string, unknown>;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface MemoryProposeRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  stateKey: string;
  kind: OperationalMemoryKind;
  content: string;
  metadata?: Record<string, unknown>;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface SkillProposeRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  stateKey: string;
  roleFamily: AgentRole;
  kind?: SkillMemoryKind;
  content: string;
  metadata?: Record<string, unknown>;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface MemoryStatusChangeRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  stateKey: string;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface SkillStatusChangeRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  stateKey: string;
  roleFamily: AgentRole;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface MemoryReadRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  stateKey: string;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface MemoryQueryRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  query: string;
  limit?: number;
  includeCandidate?: boolean;
  includeArchived?: boolean;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface SkillQueryRequest {
  companyId: string;
  bindingKey: string;
  scopeKind: MemoryScopeKind;
  scopeId?: string | null;
  namespace?: string;
  roleFamily: AgentRole;
  query: string;
  limit?: number;
  includeCandidate?: boolean;
  includeArchived?: boolean;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface MemoryQueryResult {
  snippets: MemorySnippet[];
}

export interface SkillQueryResult {
  snippets: SkillSnippet[];
}
