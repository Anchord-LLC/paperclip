import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  memoryBindings,
  memoryOperations,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { memoryService } from "../services/memory.ts";

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
      await db.delete(companies).where(eq(companies.id, companyId));
    }

    companyIdsToCleanup = [];
  });

  afterAll(async () => {
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
});