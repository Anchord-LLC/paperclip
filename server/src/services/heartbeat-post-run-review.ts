import type { Db } from "@paperclipai/db";
import type {
  AgentRole,
  MemoryActorType,
  SkillSnippet,
  SkillValidationSourceKind,
} from "@paperclipai/shared";
import { AGENT_ROLES } from "@paperclipai/shared";
import {
  POST_RUN_CANDIDATE_BINDING_KEY,
  POST_RUN_CANDIDATE_ENABLED_ROLES,
  POST_RUN_CANDIDATE_SOURCE_KIND,
} from "./heartbeat-post-run-candidates.js";
import { memoryService } from "./memory.js";

const POST_RUN_CANDIDATE_REVIEW_DEFAULT_LIMIT = 10;
const POST_RUN_CANDIDATE_REVIEW_MAX_LIMIT = 10;
const POST_RUN_CANDIDATE_REVIEW_SCAN_LIMIT = 50;
const POST_RUN_CANDIDATE_REVIEW_LOOKUP_LIMIT = 25;

export interface PostRunSkillCandidateProvenance {
  sourceKind: string;
  runId: string | null;
  issueId: string | null;
  agentId: string | null;
  agentRole: AgentRole | null;
  baseStateKey: string | null;
  title: string | null;
  skillKey: string | null;
}

export interface PostRunSkillCandidateReviewItem {
  snippet: SkillSnippet;
  provenance: PostRunSkillCandidateProvenance;
}

export interface ListPostRunCandidateSkillsForReviewInput {
  companyId: string;
  bindingKey?: string;
  roleFamily: AgentRole;
  query?: string;
  limit?: number;
  actorType: MemoryActorType;
  actorId?: string | null;
}

export interface ListPostRunCandidateSkillsForReviewResult {
  items: PostRunSkillCandidateReviewItem[];
  skippedReason: string | null;
}

export interface ApprovePostRunCandidateSkillInput {
  companyId: string;
  bindingKey?: string;
  roleFamily: AgentRole;
  stateKey: string;
  actorType: MemoryActorType;
  actorId?: string | null;
  validationSourceKind?: SkillValidationSourceKind | null;
  validationSourceRef?: string | null;
  validationNotes?: string | null;
}

export interface DismissPostRunCandidateSkillInput {
  companyId: string;
  bindingKey?: string;
  roleFamily: AgentRole;
  stateKey: string;
  actorType: MemoryActorType;
  actorId?: string | null;
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

function normalizeBindingKey(bindingKey?: string): string {
  return bindingKey?.trim() || POST_RUN_CANDIDATE_BINDING_KEY;
}

function clampReviewLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return POST_RUN_CANDIDATE_REVIEW_DEFAULT_LIMIT;
  return Math.min(
    POST_RUN_CANDIDATE_REVIEW_MAX_LIMIT,
    Math.max(1, Math.trunc(limit ?? POST_RUN_CANDIDATE_REVIEW_DEFAULT_LIMIT)),
  );
}

function buildReviewScanLimit(limit?: number): number {
  return Math.min(
    POST_RUN_CANDIDATE_REVIEW_SCAN_LIMIT,
    Math.max(POST_RUN_CANDIDATE_REVIEW_LOOKUP_LIMIT, clampReviewLimit(limit) * 5),
  );
}

function buildPostRunCandidateReviewItem(snippet: SkillSnippet): PostRunSkillCandidateReviewItem | null {
  const metadata = isPlainRecord(snippet.metadata) ? snippet.metadata : {};
  if (metadata.proposalSourceKind !== POST_RUN_CANDIDATE_SOURCE_KIND) {
    return null;
  }

  return {
    snippet,
    provenance: {
      sourceKind: POST_RUN_CANDIDATE_SOURCE_KIND,
      runId: asString(metadata.proposalRunId),
      issueId: asString(metadata.proposalIssueId),
      agentId: asString(metadata.proposalAgentId),
      agentRole: isAgentRole(metadata.proposalAgentRole) ? metadata.proposalAgentRole : null,
      baseStateKey: asString(metadata.proposalBaseStateKey),
      title: asString(metadata.proposalTitle),
      skillKey: asString(metadata.skillKey),
    },
  };
}

function assertReviewRoleEnabled(roleFamily: AgentRole): void {
  if (!POST_RUN_CANDIDATE_ENABLED_ROLES.has(roleFamily)) {
    throw new Error(`Post-run candidate review is not enabled for role family: ${roleFamily}`);
  }
}

export function postRunSkillReviewService(db: Db) {
  const memory = memoryService(db);

  async function findCandidateForReview(input: {
    companyId: string;
    bindingKey?: string;
    roleFamily: AgentRole;
    stateKey: string;
    actorType: MemoryActorType;
    actorId?: string | null;
  }): Promise<PostRunSkillCandidateReviewItem> {
    assertReviewRoleEnabled(input.roleFamily);

    const result = await memory.querySkills({
      companyId: input.companyId,
      bindingKey: normalizeBindingKey(input.bindingKey),
      scopeKind: "company",
      scopeId: input.companyId,
      roleFamily: input.roleFamily,
      query: input.stateKey,
      limit: POST_RUN_CANDIDATE_REVIEW_LOOKUP_LIMIT,
      includeCandidate: true,
      actorType: input.actorType,
      actorId: input.actorId,
    });

    const match = result.snippets.find((snippet) => snippet.stateKey === input.stateKey) ?? null;
    if (!match) {
      throw new Error(`Post-run candidate skill not found: ${input.stateKey}`);
    }

    const item = buildPostRunCandidateReviewItem(match);
    if (!item) {
      throw new Error(`Skill is not a post-run candidate: ${input.stateKey}`);
    }
    if (item.snippet.status !== "candidate") {
      throw new Error(`Only candidate post-run skills can be reviewed: ${input.stateKey}`);
    }

    return item;
  }

  return {
    async listCandidateSkillsForReview(
      input: ListPostRunCandidateSkillsForReviewInput,
    ): Promise<ListPostRunCandidateSkillsForReviewResult> {
      if (!POST_RUN_CANDIDATE_ENABLED_ROLES.has(input.roleFamily)) {
        return {
          items: [],
          skippedReason: "role_not_enabled",
        };
      }

      const result = await memory.querySkills({
        companyId: input.companyId,
        bindingKey: normalizeBindingKey(input.bindingKey),
        scopeKind: "company",
        scopeId: input.companyId,
        roleFamily: input.roleFamily,
        query: input.query ?? "",
        limit: buildReviewScanLimit(input.limit),
        includeCandidate: true,
        actorType: input.actorType,
        actorId: input.actorId,
      });

      return {
        items: result.snippets
          .filter((snippet) => snippet.status === "candidate")
          .map(buildPostRunCandidateReviewItem)
          .filter((item): item is PostRunSkillCandidateReviewItem => item !== null)
          .slice(0, clampReviewLimit(input.limit)),
        skippedReason: null,
      };
    },

    async approveCandidateSkill(input: ApprovePostRunCandidateSkillInput): Promise<PostRunSkillCandidateReviewItem> {
      const candidate = await findCandidateForReview(input);
      const snippet = await memory.approveSkill({
        companyId: input.companyId,
        bindingKey: normalizeBindingKey(input.bindingKey),
        scopeKind: "company",
        scopeId: input.companyId,
        stateKey: input.stateKey,
        roleFamily: input.roleFamily,
        actorType: input.actorType,
        actorId: input.actorId,
        validationSourceKind: input.validationSourceKind ?? null,
        validationSourceRef: input.validationSourceRef ?? null,
        validationNotes: input.validationNotes ?? null,
      });

      return buildPostRunCandidateReviewItem(snippet) ?? {
        snippet,
        provenance: candidate.provenance,
      };
    },

    async dismissCandidateSkill(input: DismissPostRunCandidateSkillInput): Promise<PostRunSkillCandidateReviewItem> {
      const candidate = await findCandidateForReview(input);
      const snippet = await memory.archiveSkill({
        companyId: input.companyId,
        bindingKey: normalizeBindingKey(input.bindingKey),
        scopeKind: "company",
        scopeId: input.companyId,
        stateKey: input.stateKey,
        roleFamily: input.roleFamily,
        actorType: input.actorType,
        actorId: input.actorId,
      });

      return buildPostRunCandidateReviewItem(snippet) ?? {
        snippet,
        provenance: candidate.provenance,
      };
    },
  };
}
