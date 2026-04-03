import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companySkills,
  createDb,
  heartbeatRuns,
  memoryBindings,
  memoryOperations,
  pluginState,
  plugins,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companySkillService } from "../services/company-skills.ts";
import { generateHeartbeatRunCandidateSkills } from "../services/heartbeat-post-run-candidates.ts";
import { postRunSkillReviewService } from "../services/heartbeat-post-run-review.ts";
import { memoryService } from "../services/memory.ts";

const LOCAL_MEMORY_PLUGIN_KEY = "paperclip.memory.local";
const sharedConnectionString = process.env.DATABASE_URL?.trim() || null;
const embeddedPostgresSupport = sharedConnectionString
  ? { supported: true }
  : await getEmbeddedPostgresTestSupport();
const describeDatabaseBacked = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!sharedConnectionString && !embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat review tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDatabaseBacked("heartbeat post-run candidate review handoff", () => {
  let db!: ReturnType<typeof createDb>;
  let memorySvc!: ReturnType<typeof memoryService>;
  let skillsSvc!: ReturnType<typeof companySkillService>;
  let reviewSvc!: ReturnType<typeof postRunSkillReviewService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyIdsToCleanup: string[] = [];

  beforeAll(async () => {
    if (sharedConnectionString) {
      db = createDb(sharedConnectionString);
      memorySvc = memoryService(db);
      skillsSvc = companySkillService(db);
      reviewSvc = postRunSkillReviewService(db);
      return;
    }

    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-review-");
    db = createDb(tempDb.connectionString);
    memorySvc = memoryService(db);
    skillsSvc = companySkillService(db);
    reviewSvc = postRunSkillReviewService(db);
  }, 20_000);

  afterEach(async () => {
    for (const companyId of companyIdsToCleanup) {
      await db.delete(memoryOperations).where(eq(memoryOperations.companyId, companyId));
      await db.delete(memoryBindings).where(eq(memoryBindings.companyId, companyId));
      await db.delete(pluginState).where(eq(pluginState.scopeId, companyId));
      await db.delete(companySkills).where(eq(companySkills.companyId, companyId));
      await db.delete(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId));
      await db.delete(agents).where(eq(agents.companyId, companyId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }

    companyIdsToCleanup = [];
  });

  afterAll(async () => {
    await db.delete(plugins).where(eq(plugins.pluginKey, LOCAL_MEMORY_PLUGIN_KEY));
    await tempDb?.cleanup();
  });

  async function seedRunFixture(
    agentRole: "qa" | "researcher",
    resultJson: Record<string, unknown>,
  ) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();

    companyIdsToCleanup.push(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `${agentRole} agent`,
      role: agentRole,
      status: "idle",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "on_demand",
      status: "succeeded",
      resultJson,
      startedAt: new Date("2026-04-03T00:00:00.000Z"),
      finishedAt: new Date("2026-04-03T00:01:00.000Z"),
      updatedAt: new Date("2026-04-03T00:01:00.000Z"),
    });

    const binding = await memorySvc.createBinding({
      companyId,
      bindingKey: "default",
      label: "Default Memory",
      providerKey: "local",
      namespace: "memory",
      capabilities: { read: true, query: true, write: true },
    });

    return { companyId, agentId, runId, bindingId: binding!.id };
  }

  async function requireBundledSkill(companyId: string, slug: string) {
    const skill = (await skillsSvc.listFull(companyId)).find((entry) => entry.slug === slug) ?? null;
    expect(skill, `Expected bundled skill ${slug} to exist`).toBeTruthy();
    return skill!;
  }

  it("lists QA post-run candidates with provenance and promotes them into runtime retrieval", async () => {
    const qaSkill = await (async () => {
      const seeded = await seedRunFixture("qa", {});
      const skill = await requireBundledSkill(seeded.companyId, "paperclip-qa-acceptance-criteria-review");
      return { seeded, skill };
    })();

    const { companyId, agentId, runId, bindingId } = qaSkill.seeded;
    const reviewSkill = qaSkill.skill;

    const generated = await generateHeartbeatRunCandidateSkills(db, {
      companyId,
      agentId,
      agentRole: "qa",
      runId,
      issueId: "issue-qa-42",
      resultJson: {
        paperclipCandidateSkills: [
          {
            title: "QA Acceptance Review",
            content: reviewSkill.description ?? reviewSkill.name,
            metadata: {
              skillKey: reviewSkill.key,
              evidenceRef: "run-note-1",
            },
          },
        ],
      },
    });

    expect(generated.created).toHaveLength(1);
    const candidateStateKey = generated.created[0]!.stateKey;

    const beforeEntries = await skillsSvc.listRuntimeSkillEntriesForExecution(companyId, {
      agentRole: "qa",
      actorType: "agent",
      actorId: "qa-runtime-before",
    });
    expect(beforeEntries.find((entry) => entry.key === reviewSkill.key)?.required).toBe(false);

    const listed = await reviewSvc.listCandidateSkillsForReview({
      companyId,
      roleFamily: "qa",
      actorType: "user",
      actorId: "reviewer-qa",
      limit: 5,
    });

    expect(listed.skippedReason).toBeNull();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.snippet.stateKey).toBe(candidateStateKey);
    expect(listed.items[0]?.snippet.status).toBe("candidate");
    expect(listed.items[0]?.provenance).toMatchObject({
      sourceKind: "heartbeat_run_result",
      runId,
      issueId: "issue-qa-42",
      agentId,
      agentRole: "qa",
      title: "QA Acceptance Review",
      skillKey: reviewSkill.key,
    });

    const approved = await reviewSvc.approveCandidateSkill({
      companyId,
      roleFamily: "qa",
      stateKey: candidateStateKey,
      actorType: "user",
      actorId: "reviewer-qa",
      validationSourceKind: "human_review",
      validationSourceRef: "issue://QA-42",
      validationNotes: "Approved from post-run candidate review",
    });

    expect(approved.snippet.status).toBe("approved");
    expect(approved.snippet.proposedByActorType).toBe("agent");
    expect(approved.snippet.proposedByActorId).toBe(agentId);
    expect(approved.snippet.validatedByActorType).toBe("user");
    expect(approved.snippet.validatedByActorId).toBe("reviewer-qa");
    expect(approved.snippet.validationSourceKind).toBe("human_review");
    expect(approved.snippet.validationSourceRef).toBe("issue://QA-42");
    expect(approved.snippet.validationNotes).toBe("Approved from post-run candidate review");
    expect(approved.provenance.runId).toBe(runId);
    expect(approved.provenance.skillKey).toBe(reviewSkill.key);

    const listedAfterApproval = await reviewSvc.listCandidateSkillsForReview({
      companyId,
      roleFamily: "qa",
      actorType: "user",
      actorId: "reviewer-qa",
      limit: 5,
    });
    expect(listedAfterApproval.items).toHaveLength(0);

    const afterEntries = await skillsSvc.listRuntimeSkillEntriesForExecution(companyId, {
      agentRole: "qa",
      actorType: "agent",
      actorId: "qa-runtime-after",
    });
    const promoted = afterEntries.filter((entry) => entry.requiredReason?.includes("Approved qa skill retrieved"));
    expect(promoted.map((entry) => entry.key)).toEqual([reviewSkill.key]);

    const operations = await memorySvc.listRecentOperations({
      companyId,
      bindingId,
      limit: 25,
    });
    expect(operations.filter((entry) => entry.operationType === "propose_skill")).toHaveLength(1);
    expect(operations.filter((entry) => entry.operationType === "approve_skill")).toHaveLength(1);
    expect(operations.some((entry) => entry.operationType === "query_skills")).toBe(true);
    expect(operations.every((entry) => entry.status === "success")).toBe(true);
  });

  it("dismisses researcher post-run candidates and keeps them out of runtime retrieval", async () => {
    const researchSkill = await (async () => {
      const seeded = await seedRunFixture("researcher", {});
      const skill = await requireBundledSkill(seeded.companyId, "paperclip-research-evidence-synthesis");
      return { seeded, skill };
    })();

    const { companyId, agentId, runId, bindingId } = researchSkill.seeded;
    const evidenceSkill = researchSkill.skill;

    const generated = await generateHeartbeatRunCandidateSkills(db, {
      companyId,
      agentId,
      agentRole: "researcher",
      runId,
      issueId: "issue-res-7",
      resultJson: {
        paperclip: {
          candidateSkills: [
            {
              title: "Research Evidence Synthesis",
              content: evidenceSkill.description ?? evidenceSkill.name,
              metadata: {
                skillKey: evidenceSkill.key,
                sourceMemo: "retro-7",
              },
            },
          ],
        },
      },
    });

    expect(generated.created).toHaveLength(1);
    const candidateStateKey = generated.created[0]!.stateKey;

    const listed = await reviewSvc.listCandidateSkillsForReview({
      companyId,
      roleFamily: "researcher",
      actorType: "user",
      actorId: "reviewer-res",
      limit: 5,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.provenance).toMatchObject({
      runId,
      issueId: "issue-res-7",
      agentId,
      agentRole: "researcher",
      skillKey: evidenceSkill.key,
    });

    const dismissed = await reviewSvc.dismissCandidateSkill({
      companyId,
      roleFamily: "researcher",
      stateKey: candidateStateKey,
      actorType: "user",
      actorId: "reviewer-res",
    });

    expect(dismissed.snippet.status).toBe("archived");
    expect(dismissed.provenance.runId).toBe(runId);
    expect(dismissed.provenance.skillKey).toBe(evidenceSkill.key);

    const listedAfterDismissal = await reviewSvc.listCandidateSkillsForReview({
      companyId,
      roleFamily: "researcher",
      actorType: "user",
      actorId: "reviewer-res",
      limit: 5,
    });
    expect(listedAfterDismissal.items).toHaveLength(0);

    const archivedQuery = await memorySvc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "researcher",
      query: candidateStateKey,
      limit: 5,
      includeArchived: true,
      actorType: "user",
      actorId: "reviewer-res",
    });
    expect(archivedQuery.snippets[0]?.status).toBe("archived");
    expect(archivedQuery.snippets[0]?.metadata).toMatchObject({
      proposalSourceKind: "heartbeat_run_result",
      proposalRunId: runId,
      skillKey: evidenceSkill.key,
    });

    const runtimeEntries = await skillsSvc.listRuntimeSkillEntriesForExecution(companyId, {
      agentRole: "researcher",
      actorType: "agent",
      actorId: "research-runtime-after",
    });
    expect(runtimeEntries.find((entry) => entry.key === evidenceSkill.key)?.required).toBe(false);

    const operations = await memorySvc.listRecentOperations({
      companyId,
      bindingId,
      limit: 25,
    });
    expect(operations.filter((entry) => entry.operationType === "archive_skill")).toHaveLength(1);
    expect(operations.some((entry) => entry.operationType === "query_skills")).toBe(true);
    expect(operations.every((entry) => entry.status === "success")).toBe(true);
  });
});
