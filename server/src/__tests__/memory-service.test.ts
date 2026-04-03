import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
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

const LOCAL_MEMORY_PLUGIN_KEY = "paperclip.memory.local";
const sharedConnectionString = process.env.DATABASE_URL?.trim() || null;
const embeddedPostgresSupport = sharedConnectionString
  ? { supported: true }
  : await getEmbeddedPostgresTestSupport();
const describeDatabaseBacked = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!sharedConnectionString && !embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres memory service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDatabaseBacked("memoryService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof memoryService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyIdsToCleanup: string[] = [];

  beforeAll(async () => {
    if (sharedConnectionString) {
      db = createDb(sharedConnectionString);
      svc = memoryService(db);
      return;
    }

    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-memory-service-");
    db = createDb(tempDb.connectionString);
    svc = memoryService(db);
  }, 20_000);

  afterEach(async () => {
    for (const companyId of companyIdsToCleanup) {
      await db.delete(memoryOperations).where(eq(memoryOperations.companyId, companyId));
      await db.delete(memoryBindings).where(eq(memoryBindings.companyId, companyId));
      await db.delete(pluginState).where(eq(pluginState.scopeId, companyId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }

    companyIdsToCleanup = [];
  });

  afterAll(async () => {
    if (!sharedConnectionString) {
      await db.delete(plugins).where(eq(plugins.pluginKey, LOCAL_MEMORY_PLUGIN_KEY));
    }
    await tempDb?.cleanup();
  });

  it("creates, resolves, lists, and disables a binding", async () => {
    const companyId = randomUUID();
    companyIdsToCleanup.push(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const created = await svc.createBinding({
      companyId,
      bindingKey: "default",
      label: "Default Memory",
      providerKey: "local",
      namespace: "memory",
      config: { path: "/mnt/ssd/paperclip/memory" },
      capabilities: { query: true, write: true },
    });

    expect(created).toBeTruthy();
    expect(created?.companyId).toBe(companyId);
    expect(created?.bindingKey).toBe("default");
    expect(created?.status).toBe("active");

    const resolvedActive = await svc.resolveBindingByKey({
      companyId,
      bindingKey: "default",
    });

    expect(resolvedActive?.id).toBe(created?.id);
    expect(resolvedActive?.providerKey).toBe("local");

    const listed = await svc.listBindingsForCompany(companyId);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created?.id);

    const disabled = await svc.updateBindingStatus({
      companyId,
      bindingId: created!.id,
      status: "disabled",
    });

    expect(disabled?.status).toBe("disabled");
    expect(disabled?.disabledAt).toBeTruthy();

    const resolvedAfterDisable = await svc.resolveBindingByKey({
      companyId,
      bindingKey: "default",
    });

    expect(resolvedAfterDisable).toBeNull();

    const resolvedIncludingDisabled = await svc.resolveBindingByKey({
      companyId,
      bindingKey: "default",
      activeOnly: false,
    });

    expect(resolvedIncludingDisabled?.id).toBe(created?.id);
    expect(resolvedIncludingDisabled?.status).toBe("disabled");
  });

  it("logs and lists recent memory operations", async () => {
    const companyId = randomUUID();
    companyIdsToCleanup.push(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const binding = await svc.createBinding({
      companyId,
      bindingKey: "default",
      label: "Default Memory",
      providerKey: "local",
    });

    expect(binding).toBeTruthy();

    const logged = await svc.logOperation({
      companyId,
      bindingId: binding!.id,
      operationType: "query",
      status: "success",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      stateKey: "standards",
      actorType: "agent",
      actorId: "agent-1",
      request: { q: "routing rules" },
      response: { hits: 2 },
      usage: { inputTokens: 12, outputTokens: 8 },
      durationMs: 42,
    });

    expect(logged).toBeTruthy();
    expect(logged?.bindingId).toBe(binding?.id);
    expect(logged?.operationType).toBe("query");
    expect(logged?.status).toBe("success");

    const recentForBinding = await svc.listRecentOperations({
      companyId,
      bindingId: binding!.id,
      limit: 10,
    });

    expect(recentForBinding).toHaveLength(1);
    expect(recentForBinding[0]?.id).toBe(logged?.id);

    const recentForCompany = await svc.listRecentOperations({
      companyId,
      limit: 10,
    });

    expect(recentForCompany).toHaveLength(1);
    expect(recentForCompany[0]?.id).toBe(logged?.id);
  });

  it("writes, reads, queries, and logs memory through the local provider path", async () => {
    const companyId = randomUUID();
    companyIdsToCleanup.push(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const binding = await svc.createBinding({
      companyId,
      bindingKey: "default",
      label: "Default Memory",
      providerKey: "local",
      namespace: "memory",
      capabilities: { read: true, query: true, write: true },
    });

    expect(binding).toBeTruthy();

    const written = await svc.writeMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      stateKey: "routing-standards",
      content: "Use company routing rules for escalations and approvals.",
      metadata: { source: "manual-note" },
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(written.stateKey).toBe("routing-standards");
    expect(written.text).toContain("routing rules");
    expect(written.handle.providerKey).toBe("local");

    const readBack = await svc.readMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      stateKey: "routing-standards",
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(readBack?.stateKey).toBe("routing-standards");
    expect(readBack?.text).toContain("routing rules");
    expect(readBack?.metadata).toEqual({ source: "manual-note" });

    const queried = await svc.queryMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      query: "routing approvals",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(queried.snippets).toHaveLength(1);
    expect(queried.snippets[0]?.stateKey).toBe("routing-standards");
    expect(queried.snippets[0]?.text).toContain("escalations");

    const operations = await svc.listRecentOperations({
      companyId,
      bindingId: binding!.id,
      limit: 10,
    });

    expect(operations).toHaveLength(3);
    expect(operations.map((operation) => operation.operationType)).toEqual([
      "query",
      "read",
      "write",
    ]);
    expect(operations.every((operation) => operation.status === "success")).toBe(true);
  });

  it("proposes, approves, archives, and safely queries operational memory", async () => {
    const companyId = randomUUID();
    companyIdsToCleanup.push(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const binding = await svc.createBinding({
      companyId,
      bindingKey: "default",
      label: "Default Memory",
      providerKey: "local",
      namespace: "memory",
      capabilities: { read: true, query: true, write: true },
    });

    expect(binding).toBeTruthy();

    const proposed = await svc.proposeMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      stateKey: "security-routing",
      kind: "routing_preference",
      content: "Route security incidents to on-call ops before general support triage.",
      metadata: { source: "incident-retro" },
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(proposed.status).toBe("candidate");
    expect(proposed.kind).toBe("routing_preference");

    const defaultQueryBeforeApproval = await svc.queryMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      query: "security ops",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(defaultQueryBeforeApproval.snippets).toHaveLength(0);

    const candidateQuery = await svc.queryMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      query: "security ops",
      limit: 5,
      includeCandidate: true,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(candidateQuery.snippets).toHaveLength(1);
    expect(candidateQuery.snippets[0]?.status).toBe("candidate");
    expect(candidateQuery.snippets[0]?.kind).toBe("routing_preference");

    const approved = await svc.approveMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      stateKey: "security-routing",
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBeTruthy();

    const defaultQueryAfterApproval = await svc.queryMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      query: "security ops",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(defaultQueryAfterApproval.snippets).toHaveLength(1);
    expect(defaultQueryAfterApproval.snippets[0]?.status).toBe("approved");
    expect(defaultQueryAfterApproval.snippets[0]?.stateKey).toBe("security-routing");

    const archived = await svc.archiveMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      stateKey: "security-routing",
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();

    const defaultQueryAfterArchive = await svc.queryMemory({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      namespace: "memory",
      query: "security ops",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(defaultQueryAfterArchive.snippets).toHaveLength(0);

    const operations = await svc.listRecentOperations({
      companyId,
      bindingId: binding!.id,
      limit: 20,
    });

    expect(operations).toHaveLength(7);
    expect(operations.every((operation) => operation.status === "success")).toBe(true);
    expect(operations.filter((operation) => operation.operationType === "propose")).toHaveLength(1);
    expect(operations.filter((operation) => operation.operationType === "approve")).toHaveLength(1);
    expect(operations.filter((operation) => operation.operationType === "archive")).toHaveLength(1);
    expect(operations.filter((operation) => operation.operationType === "query")).toHaveLength(4);
  });

  it("keeps specialist skills approved-only and role-matched by default", async () => {
    const companyId = randomUUID();
    companyIdsToCleanup.push(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const binding = await svc.createBinding({
      companyId,
      bindingKey: "default",
      label: "Default Memory",
      providerKey: "local",
      namespace: "memory",
      capabilities: { read: true, query: true, write: true },
    });

    expect(binding).toBeTruthy();

    const proposed = await svc.proposeSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: "incident-triage-checklist",
      roleFamily: "engineer",
      content: "Use the incident triage checklist before escalating to the on-call rotation.",
      metadata: { source: "runbook" },
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(proposed.status).toBe("candidate");
    expect(proposed.kind).toBe("specialist_skill");
    expect(proposed.roleFamily).toBe("engineer");
    expect(proposed.proposedByActorType).toBe("agent");
    expect(proposed.proposedByActorId).toBe("agent-1");
    expect(proposed.validatedByActorType).toBeNull();
    expect(proposed.validatedByActorId).toBeNull();
    expect(proposed.validationSourceKind).toBeNull();

    const defaultEngineerQueryBeforeApproval = await svc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "engineer",
      query: "triage checklist",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(defaultEngineerQueryBeforeApproval.snippets).toHaveLength(0);

    const engineerCandidateQuery = await svc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "engineer",
      query: "triage checklist",
      limit: 5,
      includeCandidate: true,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(engineerCandidateQuery.snippets).toHaveLength(1);
    expect(engineerCandidateQuery.snippets[0]?.status).toBe("candidate");
    expect(engineerCandidateQuery.snippets[0]?.roleFamily).toBe("engineer");
    expect(engineerCandidateQuery.snippets[0]?.proposedByActorType).toBe("agent");
    expect(engineerCandidateQuery.snippets[0]?.validatedByActorType).toBeNull();

    const approved = await svc.approveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: "incident-triage-checklist",
      roleFamily: "engineer",
      actorType: "user",
      actorId: "reviewer-1",
      validationSourceKind: "human_review",
      validationSourceRef: "issue://PAP-314",
      validationNotes: "Validated against the incident escalation handbook.",
    });

    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.proposedByActorType).toBe("agent");
    expect(approved.proposedByActorId).toBe("agent-1");
    expect(approved.validatedByActorType).toBe("user");
    expect(approved.validatedByActorId).toBe("reviewer-1");
    expect(approved.validationSourceKind).toBe("human_review");
    expect(approved.validationSourceRef).toBe("issue://PAP-314");
    expect(approved.validationNotes).toBe("Validated against the incident escalation handbook.");
    expect(approved.proposedByActorId).not.toBe(approved.validatedByActorId);

    const defaultEngineerQueryAfterApproval = await svc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "engineer",
      query: "triage checklist",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(defaultEngineerQueryAfterApproval.snippets).toHaveLength(1);
    expect(defaultEngineerQueryAfterApproval.snippets[0]?.status).toBe("approved");
    expect(defaultEngineerQueryAfterApproval.snippets[0]?.roleFamily).toBe("engineer");
    expect(defaultEngineerQueryAfterApproval.snippets[0]?.proposedByActorType).toBe("agent");
    expect(defaultEngineerQueryAfterApproval.snippets[0]?.validatedByActorType).toBe("user");
    expect(defaultEngineerQueryAfterApproval.snippets[0]?.validationSourceKind).toBe("human_review");

    const unrelatedRoleQuery = await svc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "designer",
      query: "triage checklist",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(unrelatedRoleQuery.snippets).toHaveLength(0);

    const archived = await svc.archiveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: "incident-triage-checklist",
      roleFamily: "engineer",
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();

    const defaultEngineerQueryAfterArchive = await svc.querySkills({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      roleFamily: "engineer",
      query: "triage checklist",
      limit: 5,
      actorType: "agent",
      actorId: "agent-1",
    });

    expect(defaultEngineerQueryAfterArchive.snippets).toHaveLength(0);

    const operations = await svc.listRecentOperations({
      companyId,
      bindingId: binding!.id,
      limit: 20,
    });

    expect(operations).toHaveLength(8);
    expect(operations.every((operation) => operation.status === "success")).toBe(true);
    expect(operations.filter((operation) => operation.operationType === "propose_skill")).toHaveLength(1);
    expect(operations.filter((operation) => operation.operationType === "approve_skill")).toHaveLength(1);
    expect(operations.filter((operation) => operation.operationType === "archive_skill")).toHaveLength(1);
    expect(operations.filter((operation) => operation.operationType === "query_skills")).toHaveLength(5);
  });

});
