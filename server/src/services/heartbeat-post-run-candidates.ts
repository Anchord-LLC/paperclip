import type { Db } from "@paperclipai/db";
import type { AgentRole, SkillSnippet } from "@paperclipai/shared";
import { AGENT_ROLES, normalizeAgentUrlKey } from "@paperclipai/shared";
import { memoryService } from "./memory.js";

const POST_RUN_CANDIDATE_BINDING_KEY = "default";
const POST_RUN_CANDIDATE_MAX_ITEMS = 2;
const POST_RUN_CANDIDATE_ENABLED_ROLES = new Set<AgentRole>(["qa", "researcher"]);
const POST_RUN_CANDIDATE_SOURCE_KIND = "heartbeat_run_result";
const POST_RUN_CANDIDATE_MAX_CONTENT_LENGTH = 1200;

type CandidateSkillDraft = {
  stateKey: string;
  content: string;
  metadata: Record<string, unknown>;
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
  skippedReason: string | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function buildCandidateStateKey(baseKey: string, runId: string, position: number): string {
  return `${baseKey}--run-${runId.slice(0, 8)}-${position}`;
}

function readCandidateSkillDrafts(input: HeartbeatRunCandidateGenerationInput, roleFamily: AgentRole): CandidateSkillDraft[] {
  const rawEntries = readRawCandidateSkillEntries(input.resultJson);
  const drafts: CandidateSkillDraft[] = [];
  const seenStateKeys = new Set<string>();

  for (const rawEntry of rawEntries) {
    if (drafts.length >= POST_RUN_CANDIDATE_MAX_ITEMS) break;
    if (!isPlainRecord(rawEntry)) continue;

    const content = asString(rawEntry.content) ?? asString(rawEntry.text) ?? asString(rawEntry.summary);
    if (!content) continue;

    const title = asString(rawEntry.title) ?? asString(rawEntry.name);
    const baseKey = deriveCandidateBaseKey(rawEntry);
    const stateKey = buildCandidateStateKey(baseKey, input.runId, drafts.length + 1);
    if (seenStateKeys.has(stateKey)) continue;
    seenStateKeys.add(stateKey);

    const sourceMetadata = isPlainRecord(rawEntry.metadata) ? rawEntry.metadata : {};
    drafts.push({
      stateKey,
      content: content.slice(0, POST_RUN_CANDIDATE_MAX_CONTENT_LENGTH),
      metadata: {
        ...sourceMetadata,
        proposalSourceKind: POST_RUN_CANDIDATE_SOURCE_KIND,
        proposalRunId: input.runId,
        proposalIssueId: input.issueId ?? null,
        proposalAgentId: input.agentId,
        proposalAgentRole: roleFamily,
        proposalBaseStateKey: baseKey,
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
      skippedReason: "role_not_enabled",
    };
  }

  const drafts = readCandidateSkillDrafts(input, input.agentRole);
  if (drafts.length === 0) {
    return {
      attempted: 0,
      created: [],
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
      skippedReason: "memory_binding_not_found",
    };
  }

  const created: SkillSnippet[] = [];
  for (const draft of drafts) {
    created.push(await memory.proposeSkill({
      companyId: input.companyId,
      bindingKey: POST_RUN_CANDIDATE_BINDING_KEY,
      scopeKind: "company",
      scopeId: input.companyId,
      stateKey: draft.stateKey,
      roleFamily: input.agentRole,
      content: draft.content,
      metadata: draft.metadata,
      actorType: "agent",
      actorId: input.agentId,
    }));
  }

  return {
    attempted: drafts.length,
    created,
    skippedReason: null,
  };
}
