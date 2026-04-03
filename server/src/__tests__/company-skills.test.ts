import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  companySkills,
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
import {
  companySkillService,
  discoverProjectWorkspaceSkillDirectories,
  findMissingLocalSkillIds,
  normalizeGitHubSkillDirectory,
  parseSkillImportSourceInput,
  readLocalSkillImportFromDirectory,
} from "../services/company-skills.js";
import { memoryService } from "../services/memory.ts";

const cleanupDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs, (dir) => fs.rm(dir, { recursive: true, force: true })));
  cleanupDirs.clear();
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupDirs.add(dir);
  return dir;
}

async function writeSkillDir(skillDir: string, name: string) {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n\n# ${name}\n`, "utf8");
}

const LOCAL_MEMORY_PLUGIN_KEY = "paperclip.memory.local";
const sharedConnectionString = process.env.DATABASE_URL?.trim() || null;
const embeddedPostgresSupport = sharedConnectionString
  ? { supported: true }
  : await getEmbeddedPostgresTestSupport();
const describeDatabaseBacked = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!sharedConnectionString && !embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company skill runtime bridge tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("company skill import source parsing", () => {
  it("parses a skills.sh command without executing shell input", () => {
    const parsed = parseSkillImportSourceInput(
      "npx skills add https://github.com/vercel-labs/skills --skill find-skills",
    );

    expect(parsed.resolvedSource).toBe("https://github.com/vercel-labs/skills");
    expect(parsed.requestedSkillSlug).toBe("find-skills");
    expect(parsed.originalSkillsShUrl).toBeNull();
    expect(parsed.warnings).toEqual([]);
  });

  it("parses owner/repo/skill shorthand as skills.sh-managed", () => {
    const parsed = parseSkillImportSourceInput("vercel-labs/skills/find-skills");

    expect(parsed.resolvedSource).toBe("https://github.com/vercel-labs/skills");
    expect(parsed.requestedSkillSlug).toBe("find-skills");
    expect(parsed.originalSkillsShUrl).toBe("https://skills.sh/vercel-labs/skills/find-skills");
  });

  it("resolves skills.sh URL with org/repo/skill to GitHub repo and preserves original URL", () => {
    const parsed = parseSkillImportSourceInput(
      "https://skills.sh/google-labs-code/stitch-skills/design-md",
    );

    expect(parsed.resolvedSource).toBe("https://github.com/google-labs-code/stitch-skills");
    expect(parsed.requestedSkillSlug).toBe("design-md");
    expect(parsed.originalSkillsShUrl).toBe("https://skills.sh/google-labs-code/stitch-skills/design-md");
  });

  it("resolves skills.sh URL with org/repo (no skill) to GitHub repo and preserves original URL", () => {
    const parsed = parseSkillImportSourceInput(
      "https://skills.sh/vercel-labs/skills",
    );

    expect(parsed.resolvedSource).toBe("https://github.com/vercel-labs/skills");
    expect(parsed.requestedSkillSlug).toBeNull();
    expect(parsed.originalSkillsShUrl).toBe("https://skills.sh/vercel-labs/skills");
  });

  it("parses skills.sh commands whose requested skill differs from the folder name", () => {
    const parsed = parseSkillImportSourceInput(
      "npx skills add https://github.com/remotion-dev/skills --skill remotion-best-practices",
    );

    expect(parsed.resolvedSource).toBe("https://github.com/remotion-dev/skills");
    expect(parsed.requestedSkillSlug).toBe("remotion-best-practices");
    expect(parsed.originalSkillsShUrl).toBeNull();
  });

  it("does not set originalSkillsShUrl for owner/repo shorthand", () => {
    const parsed = parseSkillImportSourceInput("vercel-labs/skills");

    expect(parsed.resolvedSource).toBe("https://github.com/vercel-labs/skills");
    expect(parsed.originalSkillsShUrl).toBeNull();
  });
});

describe("project workspace skill discovery", () => {
  it("normalizes GitHub skill directories for blob imports and legacy metadata", () => {
    expect(normalizeGitHubSkillDirectory("retro/.", "retro")).toBe("retro");
    expect(normalizeGitHubSkillDirectory("retro/SKILL.md", "retro")).toBe("retro");
    expect(normalizeGitHubSkillDirectory("SKILL.md", "root-skill")).toBe("");
    expect(normalizeGitHubSkillDirectory("", "fallback-skill")).toBe("fallback-skill");
  });

  it("finds bounded skill roots under supported workspace paths", async () => {
    const workspace = await makeTempDir("paperclip-skill-workspace-");
    await writeSkillDir(workspace, "Workspace Root");
    await writeSkillDir(path.join(workspace, "skills", "find-skills"), "Find Skills");
    await writeSkillDir(path.join(workspace, ".agents", "skills", "release"), "Release");
    await writeSkillDir(path.join(workspace, "skills", ".system", "paperclip"), "Paperclip");
    await fs.writeFile(path.join(workspace, "README.md"), "# ignore\n", "utf8");

    const discovered = await discoverProjectWorkspaceSkillDirectories({
      projectId: "11111111-1111-1111-1111-111111111111",
      projectName: "Repo",
      workspaceId: "22222222-2222-2222-2222-222222222222",
      workspaceName: "Main",
      workspaceCwd: workspace,
    });

    expect(discovered).toEqual([
      { skillDir: path.resolve(workspace), inventoryMode: "project_root" },
      { skillDir: path.resolve(workspace, ".agents", "skills", "release"), inventoryMode: "full" },
      { skillDir: path.resolve(workspace, "skills", ".system", "paperclip"), inventoryMode: "full" },
      { skillDir: path.resolve(workspace, "skills", "find-skills"), inventoryMode: "full" },
    ]);
  });

  it("limits root SKILL.md imports to skill-related support folders", async () => {
    const workspace = await makeTempDir("paperclip-root-skill-");
    await writeSkillDir(workspace, "Workspace Skill");
    await fs.mkdir(path.join(workspace, "references"), { recursive: true });
    await fs.mkdir(path.join(workspace, "scripts"), { recursive: true });
    await fs.mkdir(path.join(workspace, "assets"), { recursive: true });
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "references", "checklist.md"), "# Checklist\n", "utf8");
    await fs.writeFile(path.join(workspace, "scripts", "run.sh"), "echo ok\n", "utf8");
    await fs.writeFile(path.join(workspace, "assets", "logo.svg"), "<svg />\n", "utf8");
    await fs.writeFile(path.join(workspace, "README.md"), "# Repo\n", "utf8");
    await fs.writeFile(path.join(workspace, "src", "index.ts"), "export {};\n", "utf8");

    const imported = await readLocalSkillImportFromDirectory(
      "33333333-3333-4333-8333-333333333333",
      workspace,
      { inventoryMode: "project_root", metadata: { sourceKind: "project_scan" } },
    );

    expect(new Set(imported.fileInventory.map((entry) => entry.path))).toEqual(new Set([
      "assets/logo.svg",
      "references/checklist.md",
      "scripts/run.sh",
      "SKILL.md",
    ]));
    expect(imported.fileInventory.map((entry) => entry.kind)).toContain("script");
    expect(imported.metadata?.sourceKind).toBe("project_scan");
  });

  it("parses inline object array items in skill frontmatter metadata", async () => {
    const workspace = await makeTempDir("paperclip-inline-skill-yaml-");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(
      path.join(workspace, "SKILL.md"),
      [
        "---",
        "name: Inline Metadata Skill",
        "metadata:",
        "  sources:",
        "    - kind: github-dir",
        "      repo: paperclipai/paperclip",
        "      path: skills/paperclip",
        "---",
        "",
        "# Inline Metadata Skill",
        "",
      ].join("\n"),
      "utf8",
    );

    const imported = await readLocalSkillImportFromDirectory(
      "33333333-3333-4333-8333-333333333333",
      workspace,
      { inventoryMode: "full" },
    );

    expect(imported.metadata).toMatchObject({
      sourceKind: "local_path",
      sources: [
        {
          kind: "github-dir",
          repo: "paperclipai/paperclip",
          path: "skills/paperclip",
        },
      ],
    });
  });
});

describe("missing local skill reconciliation", () => {
  it("flags local-path skills whose directory was removed", async () => {
    const workspace = await makeTempDir("paperclip-missing-skill-dir-");
    const skillDir = path.join(workspace, "skills", "ghost");
    await writeSkillDir(skillDir, "Ghost");
    await fs.rm(skillDir, { recursive: true, force: true });

    const missingIds = await findMissingLocalSkillIds([
      {
        id: "skill-1",
        sourceType: "local_path",
        sourceLocator: skillDir,
      },
      {
        id: "skill-2",
        sourceType: "github",
        sourceLocator: "https://github.com/vercel-labs/agent-browser",
      },
    ]);

    expect(missingIds).toEqual(["skill-1"]);
  });

  it("flags local-path skills whose SKILL.md file was removed", async () => {
    const workspace = await makeTempDir("paperclip-missing-skill-file-");
    const skillDir = path.join(workspace, "skills", "ghost");
    await writeSkillDir(skillDir, "Ghost");
    await fs.rm(path.join(skillDir, "SKILL.md"), { force: true });

    const missingIds = await findMissingLocalSkillIds([
      {
        id: "skill-1",
        sourceType: "local_path",
        sourceLocator: skillDir,
      },
    ]);

    expect(missingIds).toEqual(["skill-1"]);
  });
});

describeDatabaseBacked("company skill runtime retrieval bridge", () => {
  let db!: ReturnType<typeof createDb>;
  let skillsSvc!: ReturnType<typeof companySkillService>;
  let memorySvc!: ReturnType<typeof memoryService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyIdsToCleanup: string[] = [];

  beforeAll(async () => {
    if (sharedConnectionString) {
      db = createDb(sharedConnectionString);
      skillsSvc = companySkillService(db);
      memorySvc = memoryService(db);
      return;
    }

    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-skills-runtime-");
    db = createDb(tempDb.connectionString);
    skillsSvc = companySkillService(db);
    memorySvc = memoryService(db);
  }, 20_000);

  afterEach(async () => {
    for (const companyId of companyIdsToCleanup) {
      await db.delete(memoryOperations).where(eq(memoryOperations.companyId, companyId));
      await db.delete(memoryBindings).where(eq(memoryBindings.companyId, companyId));
      await db.delete(pluginState).where(eq(pluginState.scopeId, companyId));
      await db.delete(companySkills).where(eq(companySkills.companyId, companyId));
      await db.delete(companies).where(eq(companies.id, companyId));
    }

    companyIdsToCleanup = [];
  });

  afterAll(async () => {
    await db.delete(plugins).where(eq(plugins.pluginKey, LOCAL_MEMORY_PLUGIN_KEY));
    await tempDb?.cleanup();
  });

  async function createCompany() {
    const companyId = randomUUID();
    companyIdsToCleanup.push(companyId);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const binding = await memorySvc.createBinding({
      companyId,
      bindingKey: "default",
      label: "Default Memory",
      providerKey: "local",
      namespace: "memory",
      capabilities: { read: true, query: true, write: true },
    });

    return { companyId, binding: binding! };
  }

  async function requireBundledSkill(companyId: string, slug: string) {
    const skill = (await skillsSvc.listFull(companyId)).find((entry) => entry.slug === slug) ?? null;
    expect(skill, `Expected bundled skill ${slug} to exist`).toBeTruthy();
    return skill!;
  }

  it("promotes only approved role-matched skills into execution-time runtime entries", async () => {
    const { companyId, binding } = await createCompany();

    const qaReview = await requireBundledSkill(companyId, "paperclip-qa-acceptance-criteria-review");
    const qaDefect = await requireBundledSkill(companyId, "paperclip-qa-defect-summary");
    const researchEvidence = await requireBundledSkill(companyId, "paperclip-research-evidence-synthesis");
    const researchAnswer = await requireBundledSkill(companyId, "paperclip-research-answer-structure");

    await memorySvc.proposeSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: qaDefect.slug,
      roleFamily: "qa",
      content: qaDefect.description ?? qaDefect.name,
      metadata: { skillKey: qaDefect.key },
      actorType: "agent",
      actorId: "qa-agent-1",
    });

    await memorySvc.proposeSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: qaReview.slug,
      roleFamily: "qa",
      content: qaReview.description ?? qaReview.name,
      metadata: { skillKey: qaReview.key },
      actorType: "agent",
      actorId: "qa-agent-1",
    });
    await memorySvc.approveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: qaReview.slug,
      roleFamily: "qa",
      actorType: "user",
      actorId: "reviewer-1",
      validationSourceKind: "human_review",
      validationSourceRef: "issue://QA-1",
      validationNotes: "Approved for qa runtime retrieval",
    });

    await memorySvc.proposeSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: researchEvidence.slug,
      roleFamily: "researcher",
      content: researchEvidence.description ?? researchEvidence.name,
      metadata: { skillKey: researchEvidence.key },
      actorType: "agent",
      actorId: "research-agent-1",
    });
    await memorySvc.approveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: researchEvidence.slug,
      roleFamily: "researcher",
      actorType: "user",
      actorId: "reviewer-2",
      validationSourceKind: "human_review",
      validationSourceRef: "issue://RES-1",
      validationNotes: "Approved for researcher runtime retrieval",
    });

    await memorySvc.proposeSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: researchAnswer.slug,
      roleFamily: "researcher",
      content: researchAnswer.description ?? researchAnswer.name,
      metadata: { skillKey: researchAnswer.key },
      actorType: "agent",
      actorId: "research-agent-1",
    });
    await memorySvc.approveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: researchAnswer.slug,
      roleFamily: "researcher",
      actorType: "user",
      actorId: "reviewer-2",
      validationSourceKind: "human_review",
      validationSourceRef: "issue://RES-2",
      validationNotes: "Temporarily approved before archival",
    });
    await memorySvc.archiveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: researchAnswer.slug,
      roleFamily: "researcher",
      actorType: "user",
      actorId: "reviewer-2",
    });

    const qaEntries = await skillsSvc.listRuntimeSkillEntriesForExecution(companyId, {
      agentRole: "qa",
      actorType: "agent",
      actorId: "qa-runtime-1",
    });
    const researcherEntries = await skillsSvc.listRuntimeSkillEntriesForExecution(companyId, {
      agentRole: "researcher",
      actorType: "agent",
      actorId: "research-runtime-1",
    });

    const qaPromoted = qaEntries.filter((entry) => entry.requiredReason?.includes("Approved qa skill retrieved"));
    const researcherPromoted = researcherEntries.filter((entry) =>
      entry.requiredReason?.includes("Approved researcher skill retrieved"));

    expect(qaEntries.find((entry) => entry.key === "paperclipai/paperclip/paperclip")?.required).toBe(true);
    expect(qaPromoted.map((entry) => entry.key)).toEqual([qaReview.key]);
    expect(qaEntries.find((entry) => entry.key === qaDefect.key)?.required).toBe(false);
    expect(qaEntries.find((entry) => entry.key === researchEvidence.key)?.required).toBe(false);

    expect(researcherPromoted.map((entry) => entry.key)).toEqual([researchEvidence.key]);
    expect(researcherEntries.find((entry) => entry.key === researchAnswer.key)?.required).toBe(false);
    expect(researcherEntries.find((entry) => entry.key === qaReview.key)?.required).toBe(false);

    const operations = await memorySvc.listRecentOperations({
      companyId,
      bindingId: binding.id,
      limit: 20,
    });

    expect(operations.filter((entry) => entry.operationType === "query_skills")).toHaveLength(2);
    expect(operations.every((entry) => entry.status === "success")).toBe(true);
  });

  it("keeps runtime-approved retrieval bounded to a small top-k", async () => {
    const { companyId } = await createCompany();

    const qaReview = await requireBundledSkill(companyId, "paperclip-qa-acceptance-criteria-review");
    const qaDefect = await requireBundledSkill(companyId, "paperclip-qa-defect-summary");

    await memorySvc.proposeSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: qaReview.slug,
      roleFamily: "qa",
      content: qaReview.description ?? qaReview.name,
      metadata: { skillKey: qaReview.key },
      actorType: "agent",
      actorId: "qa-agent-1",
    });
    await memorySvc.approveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: qaReview.slug,
      roleFamily: "qa",
      actorType: "user",
      actorId: "reviewer-1",
      validationSourceKind: "human_review",
      validationSourceRef: "issue://QA-2",
      validationNotes: "Approved for qa runtime retrieval",
    });

    await memorySvc.proposeSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: qaDefect.slug,
      roleFamily: "qa",
      content: qaDefect.description ?? qaDefect.name,
      metadata: { skillKey: qaDefect.key },
      actorType: "agent",
      actorId: "qa-agent-1",
    });
    await memorySvc.approveSkill({
      companyId,
      bindingKey: "default",
      scopeKind: "company",
      scopeId: companyId,
      stateKey: qaDefect.slug,
      roleFamily: "qa",
      actorType: "user",
      actorId: "reviewer-1",
      validationSourceKind: "human_review",
      validationSourceRef: "issue://QA-3",
      validationNotes: "Approved second so it ranks newest for bounded retrieval",
    });

    const qaEntries = await skillsSvc.listRuntimeSkillEntriesForExecution(companyId, {
      agentRole: "qa",
      actorType: "agent",
      actorId: "qa-runtime-1",
      limit: 1,
    });

    const promoted = qaEntries.filter((entry) => entry.requiredReason?.includes("Approved qa skill retrieved"));
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.key).toBe(qaDefect.key);
    expect(qaEntries.find((entry) => entry.key === qaReview.key)?.required).toBe(false);
  });
});
