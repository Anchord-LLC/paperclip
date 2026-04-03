import { createHash } from "node:crypto";
import type { Db } from "@paperclipai/db";
import type { AgentRole, SkillSnippet } from "@paperclipai/shared";
import { AGENT_ROLES, normalizeAgentUrlKey } from "@paperclipai/shared";
import { memoryService } from "./memory.js";

export const POST_RUN_CANDIDATE_BINDING_KEY = "default";
const POST_RUN_CANDIDATE_MAX_ITEMS = 2;
const POST_RUN_CANDIDATE_LOOKUP_LIMIT = 50;
const POST_RUN_CANDIDATE_PROVENANCE_HISTORY_LIMIT = 12;
export const POST_RUN_CANDIDATE_ENABLED_ROLES = new Set<AgentRole>(["qa", "researcher"]);
export const POST_RUN_CANDIDATE_SOURCE_KIND = "heartbeat_run_result";
const POST_RUN_CANDIDATE_MAX_CONTENT_LENGTH = 1200;

type CandidateSkillDraft = {
  stateKey: string;
  baseKey: string;
  title: string | null;
  fingerprint: string;
  content: string;
  metadata: Record<string, unknown>;
};

type CandidateProvenanceEntry = {
  runId: string;
  issueId: string | null;
  agentId: string;
  agentRole: AgentRole;
  title: string | null;
  seenAt: string;
};

export interface HeartbeatRunCandidateGenerationInput {
  companyId: string;
  agentId: string;
  agentRole: string;
  runId: string;
  issueId?: string | null;
  resultJson: Record<string, unknown> | null | undefined;
}

export interface HeartbeatRunCandidateGenerationResult {
  attempted: number;
  created: SkillSnippet[];
  merged: SkillSnippet[];
  suppressed: SkillSnippet[];
  skippedReason: string | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asString)
    .filter((entry): entry is string => entry !== null);
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && AGENT_ROLES.includes(value as AgentRole);
}

function readRawCandidateSkillEntries(resultJson: Record<string, unknown> | null | undefined): unknown[] {
  if (!isPlainRecord(resultJson)) return [];

  if (Array.isArray(resultJson.paperclipCandidateSkills)) {
    return resultJson.paperclipCandidateSkills;
  }

  const paperclip = resultJson.paperclip;
  if (isPlainRecord(paperclip) && Array.isArray(paperclip.candidateSkills)) {
    return paperclip.candidateSkills;
  }

  return [];
}

function deriveCandidateBaseKey(record: Record<string, unknown>): string {
  const fromStateKey = normalizeAgentUrlKey(asString(record.stateKey) ?? asString(record.slug) ?? null);
  if (fromStateKey) return fromStateKey;

  const fromTitle = normalizeAgentUrlKey(asString(record.title) ?? asString(record.name) ?? null);
  if (fromTitle) return fromTitle;

  const fromContent = normalizeAgentUrlKey((asString(record.content) ?? asString(record.text) ?? "").slice(0, 80));
  return fromContent ?? "candidate-skill";
}

function normalizeCandidateText(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCandidateFingerprint(
  roleFamily: AgentRole,
  baseKey: string,
  content: string,
  sourceMetadata: Record<string, unknown>,
): string {
  const skillKey = asString(sourceMetadata.skillKey) ?? "";
  const normalizedContent = normalizeCandidateText(content);

  return createHash("sha256")
    .update(JSON.stringify({
      roleFamily,
      baseKey,
      skillKey,
      normalizedContent,
    }))
    .digest("hex");
}

function buildCandidateStateKey(baseKey: string, fingerprint: string): string {
  return `${baseKey}--run-candidate-${fingerprint.slice(0, 12)}`;
}

function buildCandidateProvenanceEntry(
  input: HeartbeatRunCandidateGenerationInput,
  roleFamily: AgentRole,
  title: string | null,
  seenAt: string,
): CandidateProvenanceEntry {
  return {
    runId: input.runId,
    issueId: input.issueId ?? null,
    agentId: input.agentId,
    agentRole: roleFamily,
    title,
    seenAt,
  };
}

function readCandidateProvenanceHistory(metadata: Record<string, unknown>): CandidateProvenanceEntry[] {
  if (!Array.isArray(metadata.proposalProvenanceHistory)) return [];

  return metadata.proposalProvenanceHistory
    .map((entry) => {
      if (!isPlainRecord(entry)) return null;
      const runId = asString(entry.runId);
      const agentId = asString(entry.agentId);
      const agentRole = isAgentRole(entry.agentRole) ? entry.agentRole : null;
      const seenAt = asString(entry.seenAt);
      if (!runId || !agentId || !agentRole || !seenAt) return null;
      return {
        runId,
        issueId: asString(entry.issueId),
        agentId,
        agentRole,
        title: asString(entry.title),
        seenAt,
      };
    })
    .filter((entry): entry is CandidateProvenanceEntry => entry !== null);
}

function readCandidateFingerprint(snippet: SkillSnippet): string | null {
  const metadata = isPlainRecord(snippet.metadata) ? snippet.metadata : {};
  const storedFingerprint = asString(metadata.proposalFingerprint);
  if (storedFingerprint) return storedFingerprint;

  const baseKey = asString(metadata.proposalBaseStateKey)
    ?? normalizeAgentUrlKey(snippet.stateKey.replace(/--run(?:-candidate)?-.+$/u, ""));
  if (!baseKey) return null;

  return buildCandidateFingerprint(snippet.roleFamily, baseKey, snippet.text, metadata);
}

function chooseCandidateContent(existing: SkillSnippet, draft: CandidateSkillDraft): string {
  return draft.content.length > existing.text.length ? draft.content : existing.text;
}

function mergeCandidateMetadata(
  existing: SkillSnippet,
  draft: CandidateSkillDraft,
  input: HeartbeatRunCandidateGenerationInput,
  roleFamily: AgentRole,
  seenAt: string,
): Record<string, unknown> {
  const existingMetadata = isPlainRecord(existing.metadata) ? existing.metadata : {};
  const history = readCandidateProvenanceHistory(existingMetadata);
  const existingRunIds = new Set([
    ...asStringArray(existingMetadata.proposalRunIds),
    ...history.map((entry) => entry.runId),
  ]);
  const alreadySeen = existingRunIds.has(input.runId);
  const nextEntry = buildCandidateProvenanceEntry(input, roleFamily, draft.title, seenAt);
  const mergedHistory = alreadySeen
    ? history.map((entry) => entry.runId === input.runId ? nextEntry : entry)
    : [...history, nextEntry];
  const trimmedHistory = mergedHistory.slice(-POST_RUN_CANDIDATE_PROVENANCE_HISTORY_LIMIT);
  const occurrenceBaseline = Math.max(
    asPositiveInteger(existingMetadata.proposalOccurrenceCount) ?? 1,
    history.length,
    existingRunIds.size,
  );
  const occurrenceCount = alreadySeen ? occurrenceBaseline : occurrenceBaseline + 1;
  const runIds = alreadySeen
    ? Array.from(existingRunIds)
    : [...Array.from(existingRunIds), input.runId];

  return {
    ...existingMetadata,
    ...draft.metadata,
    proposalSourceKind: POST_RUN_CANDIDATE_SOURCE_KIND,
    proposalRunId: input.runId,
    proposalIssueId: input.issueId ?? null,
    proposalAgentId: input.agentId,
    proposalAgentRole: roleFamily,
    proposalBaseStateKey: draft.baseKey,
    ...(draft.title ? { proposalTitle: draft.title } : {}),
    proposalFingerprint: draft.fingerprint,
    proposalOccurrenceCount: occurrenceCount,
    proposalFirstSeenAt: asString(existingMetadata.proposalFirstSeenAt) ?? existing.proposedAt.toISOString(),
    proposalLastSeenAt: seenAt,
    proposalProvenanceCount: occurrenceCount,
    proposalRunIds: runIds.slice(-POST_RUN_CANDIDATE_PROVENANCE_HISTORY_LIMIT),
    proposalProvenanceHistory: trimmedHistory,
  };
}

async function findMatchingPostRunCandidate(
  memory: ReturnType<typeof memoryService>,
  input: HeartbeatRunCandidateGenerationInput,
  roleFamily: AgentRole,
  fingerprint: string,
): Promise<SkillSnippet | null> {
  const result = await memory.querySkills({
    companyId: input.companyId,
    bindingKey: POST_RUN_CANDIDATE_BINDING_KEY,
    scopeKind: "company",
    scopeId: input.companyId,
    roleFamily,
    query: "",
    limit: POST_RUN_CANDIDATE_LOOKUP_LIMIT,
    includeCandidate: true,
    includeArchived: true,
    actorType: "agent",
    actorId: input.agentId,
  });

  return result.snippets.find((snippet) => {
    if (snippet.kind !== "specialist_skill") return false;
    const metadata = isPlainRecord(snippet.metadata) ? snippet.metadata : {};
    if (metadata.proposalSourceKind !== POST_RUN_CANDIDATE_SOURCE_KIND) return false;
    return readCandidateFingerprint(snippet) === fingerprint;
  }) ?? null;
}

function readCandidateSkillDrafts(
  input: HeartbeatRunCandidateGenerationInput,
  roleFamily: AgentRole,
  seenAt: string,
): CandidateSkillDraft[] {
  const rawEntries = readRawCandidateSkillEntries(input.resultJson);
  const drafts: CandidateSkillDraft[] = [];
  const seenFingerprints = new Set<string>();

  for (const rawEntry of rawEntries) {
    if (drafts.length >= POST_RUN_CANDIDATE_MAX_ITEMS) break;
    if (!isPlainRecord(rawEntry)) continue;

    const content = asString(rawEntry.content) ?? asString(rawEntry.text) ?? asString(rawEntry.summary);
    if (!content) continue;

    const title = asString(rawEntry.title) ?? asString(rawEntry.name);
    const baseKey = deriveCandidateBaseKey(rawEntry);
    const sourceMetadata = isPlainRecord(rawEntry.metadata) ? rawEntry.metadata : {};
    const fingerprint = buildCandidateFingerprint(roleFamily, baseKey, content, sourceMetadata);
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    drafts.push({
      stateKey: buildCandidateStateKey(baseKey, fingerprint),
      baseKey,
      title,
      fingerprint,
      content: content.slice(0, POST_RUN_CANDIDATE_MAX_CONTENT_LENGTH),
      metadata: {
        ...sourceMetadata,
        proposalSourceKind: POST_RUN_CANDIDATE_SOURCE_KIND,
        proposalRunId: input.runId,
        proposalIssueId: input.issueId ?? null,
        proposalAgentId: input.agentId,
        proposalAgentRole: roleFamily,
        proposalBaseStateKey: baseKey,
        proposalFingerprint: fingerprint,
        proposalOccurrenceCount: 1,
        proposalFirstSeenAt: seenAt,
        proposalLastSeenAt: seenAt,
        proposalProvenanceCount: 1,
        proposalRunIds: [input.runId],
        proposalProvenanceHistory: [
          buildCandidateProvenanceEntry(input, roleFamily, title, seenAt),
        ],
        ...(title ? { proposalTitle: title } : {}),
      },
    });
  }

  return drafts;
}

export async function generateHeartbeatRunCandidateSkills(
  db: Db,
  input: HeartbeatRunCandidateGenerationInput,
): Promise<HeartbeatRunCandidateGenerationResult> {
  if (!isAgentRole(input.agentRole) || !POST_RUN_CANDIDATE_ENABLED_ROLES.has(input.agentRole)) {
    return {
      attempted: 0,
      created: [],
      merged: [],
      suppressed: [],
      skippedReason: "role_not_enabled",
    };
  }
  const roleFamily = input.agentRole;

  const seenAt = new Date().toISOString();
  const drafts = readCandidateSkillDrafts(input, roleFamily, seenAt);
  if (drafts.length === 0) {
    return {
      attempted: 0,
      created: [],
      merged: [],
      suppressed: [],
      skippedReason: "no_candidate_skill_inputs",
    };
  }

  const memory = memoryService(db);
  const binding = await memory.resolveBindingByKey({
    companyId: input.companyId,
    bindingKey: POST_RUN_CANDIDATE_BINDING_KEY,
  });
  if (!binding) {
    return {
      attempted: drafts.length,
      created: [],
      merged: [],
      suppressed: [],
      skippedReason: "memory_binding_not_found",
    };
  }

  const created: SkillSnippet[] = [];
  const merged: SkillSnippet[] = [];
  const suppressed: SkillSnippet[] = [];
  for (const draft of drafts) {
    const existing = await findMatchingPostRunCandidate(memory, input, roleFamily, draft.fingerprint);
    if (existing?.status === "candidate") {
      merged.push(await memory.proposeSkill({
        companyId: input.companyId,
        bindingKey: POST_RUN_CANDIDATE_BINDING_KEY,
        scopeKind: "company",
        scopeId: input.companyId,
        stateKey: existing.stateKey,
        roleFamily,
        content: chooseCandidateContent(existing, draft),
        metadata: mergeCandidateMetadata(existing, draft, input, roleFamily, seenAt),
        actorType: "agent",
        actorId: input.agentId,
      }));
      continue;
    }

    if (existing?.status === "approved" || existing?.status === "archived") {
      suppressed.push(existing);
      continue;
    }

    created.push(await memory.proposeSkill({
      companyId: input.companyId,
      bindingKey: POST_RUN_CANDIDATE_BINDING_KEY,
      scopeKind: "company",
      scopeId: input.companyId,
      stateKey: draft.stateKey,
      roleFamily,
      content: draft.content,
      metadata: draft.metadata,
      actorType: "agent",
      actorId: input.agentId,
    }));
  }

  return {
    attempted: drafts.length,
    created,
    merged,
    suppressed,
    skippedReason: null,
  };
}
