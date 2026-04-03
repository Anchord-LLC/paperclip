import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
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
import { memoryService } from "../services/memory.ts";
import { generateHeartbeatRunCandidateSkills } from "../services/heartbeat-post-run-candidates.ts";

const LOCAL_MEMORY_PLUGIN_KEY = "paperclip.memory.local";
const sharedConnectionString = process.env.DATABASE_URL?.trim() || null;
const embeddedPostgresSupport = sharedConnectionString
  ? { supported: true }
  : await getEmbeddedPostgresTestSupport();
const describeDatabaseBacked = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!sharedConnectionString && !embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat candidate tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDatabaseBacked("heartbeat post-run candidate generation", () => {
  let db!: ReturnType<typeof createDb>;
  let memorySvc!: ReturnType<typeof memoryService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyIdsToCleanup: string[] = [];

  beforeAll(async () => {
    if (sharedConnectionString) {
      db = createDb(sharedConnectionString);
      memorySvc = memoryService(db);
      return;
    }

    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-candidates-");
    db = createDb(tempDb.connectionString);
    memorySvc = memoryService(db);
  }, 20_000);

  afterEach(async () => {
    for (const companyId of companyIdsToCleanup) {
      await db.delete(memoryOperations).where(eq(memoryOperations.companyId, companyId));
      await db.delete(memoryBindings).where(eq(memoryBindings.companyId, companyId));
      await db.delete(pluginState).where(eq(pluginState.scopeId, companyId));
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

  async function seedRunFixture(agentRole: "qa" | "researcher" | "engineer", resultJson: Record<string, unknown>) {
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

  it("stores QA run-generated skill proposals as candidates with preserved metadata", async () => {
    const { companyId, agentId, runId, bindingId } = await seedRunFixture("qa", {
      paperclipCandidateSkills: [
        {
          title: "Defect Evidence Format",
          content: "Capture expected behavior, observed behavior, reproduction, and impact in that order.",
          metadata: {
            source: "run-retro",
            evidenceRef: "issue-comment-42",
          },
        },
      ],
    });

    const generated = await generateHeartbeatRunCandidateSkills(db, {
      companyId,
      agentId,
      agentRole: "qa",
      runId,
      issueId: "issue-qa-1",
      resultJson: {
        paperclipCandidateSkills: [
          {
            title: "Defect Evidence Format",
            content: "Capture expected behavior, observed behavior, reproduction, and impact in that order.",
            metadata: {
              source: "run-retro",
              evidenceRef: "issue-comment-42",
            },
          },
        ],
      },
    });

    expect(generated.skippedReason).toBeNull();
    expect(generated.attempted).toBe(1);
    expect(generated.created).toHaveLength(1);
    expect(generated.created[0]?.status).toBe("candidate");
    expect(generated.created[0]?.roleFamily).toBe("qa");
    expect(generated.created[0]?.proposedByActorType).toBe("agent");
    expect(generated.created[0]?.proposedByActorId).toBe(agentId);
    expect(generated.created[0]?.validatedByActorType).toBeNull();
    expect(generated.created[0]?.stateKey).toContain("--run-");
    expect(generated.created[0]?.metadata).toMatchObject({
      source: "run-retro",
      evidenceRef: "issue-comment-42",
      proposalSourceKind: "heartbeat_run_result",
      proposalRunId: runId,
      proposalIssueId: "issue-qa-1",
      proposalAgentId: agentId,
      proposalAgentRole: "qa",
      proposalTitle: "Defect Evidence Format",
    });

    const defaultQuery = await memorySvc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "qa",
      query: "",
      limit: 5,
      actorType: "agent",
      actorId: agentId,
    });

    expect(defaultQuery.snippets).toHaveLength(0);

    const candidateQuery = await memorySvc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "qa",
      query: "",
      limit: 5,
      includeCandidate: true,
      actorType: "agent",
      actorId: agentId,
    });

    expect(candidateQuery.snippets).toHaveLength(1);
    expect(candidateQuery.snippets[0]?.stateKey).toBe(generated.created[0]?.stateKey);
    expect(candidateQuery.snippets[0]?.status).toBe("candidate");

    const operations = await memorySvc.listRecentOperations({
      companyId,
      bindingId,
      limit: 10,
    });

    expect(operations.filter((operation) => operation.operationType === "propose_skill")).toHaveLength(1);
    expect(operations.filter((operation) => operation.operationType === "approve_skill")).toHaveLength(0);
  });

  it("limits proposals to enabled roles and keeps researcher generation bounded", async () => {
    const engineerFixture = await seedRunFixture("engineer", {
      paperclipCandidateSkills: [
        {
          title: "Should Not Persist",
          content: "This should not be proposed for unsupported roles.",
        },
      ],
    });

    const skipped = await generateHeartbeatRunCandidateSkills(db, {
      companyId: engineerFixture.companyId,
      agentId: engineerFixture.agentId,
      agentRole: "engineer",
      runId: engineerFixture.runId,
      resultJson: {
        paperclipCandidateSkills: [
          {
            title: "Should Not Persist",
            content: "This should not be proposed for unsupported roles.",
          },
        ],
      },
    });

    expect(skipped.created).toHaveLength(0);
    expect(skipped.skippedReason).toBe("role_not_enabled");

    const { companyId, agentId, runId } = await seedRunFixture("researcher", {
      paperclip: {
        candidateSkills: [
          { title: "Synthesis Frame", content: "Lead with the answer, then evidence, then caveats." },
          { title: "Evidence Gaps", content: "End research summaries with unresolved evidence gaps." },
          { title: "Overflow Candidate", content: "This third proposal should be ignored by the top-k cap." },
        ],
      },
    });

    const generated = await generateHeartbeatRunCandidateSkills(db, {
      companyId,
      agentId,
      agentRole: "researcher",
      runId,
      resultJson: {
        paperclip: {
          candidateSkills: [
            { title: "Synthesis Frame", content: "Lead with the answer, then evidence, then caveats." },
            { title: "Evidence Gaps", content: "End research summaries with unresolved evidence gaps." },
            { title: "Overflow Candidate", content: "This third proposal should be ignored by the top-k cap." },
          ],
        },
      },
    });

    expect(generated.skippedReason).toBeNull();
    expect(generated.attempted).toBe(2);
    expect(generated.created).toHaveLength(2);
    expect(generated.created.every((snippet) => snippet.status === "candidate")).toBe(true);
    expect(generated.created.every((snippet) => snippet.roleFamily === "researcher")).toBe(true);

    const defaultQuery = await memorySvc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "researcher",
      query: "",
      limit: 5,
      actorType: "agent",
      actorId: agentId,
    });

    expect(defaultQuery.snippets).toHaveLength(0);

    const candidateQuery = await memorySvc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "researcher",
      query: "",
      limit: 5,
      includeCandidate: true,
      actorType: "agent",
      actorId: agentId,
    });

    expect(candidateQuery.snippets).toHaveLength(2);
    expect(candidateQuery.snippets.every((snippet) => snippet.status === "candidate")).toBe(true);
    expect(candidateQuery.snippets.some((snippet) => snippet.text.includes("Overflow Candidate"))).toBe(false);
  });
});
