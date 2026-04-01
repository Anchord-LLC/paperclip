import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agents,
  authUsers,
  companies,
  companyMemberships,
  polymarketPaperTradeEvents,
  polymarketPaperTrades,
  polymarketRuntimeConfigs,
  polymarketSignalDecisions,
  polymarketSignals,
  polymarketWalletCandidates,
  polymarketWalletSelectionRuns,
  polymarketWalletSnapshots,
  polymarketWatchedWallets,
  polymarketWorkerRuns,
  workspaceRuntimeServices,
} from "@paperclipai/db";
import type {
  AgentEnvConfig,
  EnvSecretRefBinding,
  PatchPolymarketCopyRuntimeConfig,
  SecretProvider,
  PolymarketCopyAuthReadiness,
  PolymarketCopyCadence,
  PolymarketCopyDashboardData,
  PolymarketCopyDeriveApiCredentialsResult,
  PolymarketCopyUnderlyingModel,
  PolymarketCopyUnderlyingRuntimeService,
  PolymarketCopyPaperTrade,
  PolymarketCopyPaperTradeStatus,
  PolymarketCopySignalAction,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignalDecision,
  PolymarketCopySignal,
  PolymarketCopyWalletStatus,
  PolymarketCopyWatchedWallet,
} from "@paperclipai/shared";
import { SECRET_PROVIDERS } from "@paperclipai/shared";
import { notFound } from "../../errors.js";
import { logger } from "../../middleware/logger.js";
import { logActivity, type LogActivityInput } from "../activity-log.js";
import { accessService } from "../access.js";
import { secretService } from "../secrets.js";
import { inspectPolymarketAuthReadiness } from "./auth-readiness.js";
import { writePolymarketArtifact } from "./artifact-writer.js";
import { derivePolymarketApiCredentialsFromPrivateKey } from "./credential-derivation.js";
import { polymarketDashboardReporter } from "./dashboard-reporter.js";
import { evaluatePolymarketLiveDispatch } from "./live-guards.js";
import { createPolymarketOfficialClient } from "./official-client.js";
import { applySignalToPaperTrade } from "./paper-simulator.js";
import { evaluateRiskDecision } from "./risk-governor.js";
import {
  POLYMARKET_COPY_SYSTEM_ACTOR_ID,
  cadenceToWorkerKey,
  getPolymarketCopyDefaults,
  mergeRuntimeConfigPatch,
  normalizeWalletAddress,
  safeDate,
  shouldRunDaily,
  shouldRunInterval,
  toWeightSet,
} from "./shared.js";
import { createWalletMonitor } from "./wallet-monitor.js";
import { scoreWalletCandidate, selectWalletsWithBench, type WalletSelectorCandidateScore } from "./wallet-selector.js";

type ServiceActor = {
  actorType: "user" | "agent" | "system";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
};

type AuditRow = {
  action: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
};

type RuntimeServiceDefinition = {
  key: PolymarketCopyUnderlyingRuntimeService["key"];
  serviceName: string;
  providerRef: string;
};

const POLYMARKET_TRADING_ANALYST_NAME = "Trading Analyst";
const POLYMARKET_RUNTIME_SERVICE_DEFINITIONS: RuntimeServiceDefinition[] = [
  {
    key: "monitor_5m",
    serviceName: "Polymarket 5m Monitor",
    providerRef: "polymarket-monitor-5m",
  },
  {
    key: "monitor_15m",
    serviceName: "Polymarket 15m Monitor",
    providerRef: "polymarket-monitor-15m",
  },
  {
    key: "risk_governor",
    serviceName: "Polymarket Risk Governor",
    providerRef: "polymarket-risk-governor",
  },
  {
    key: "execution_engine",
    serviceName: "Polymarket Execution Engine",
    providerRef: "polymarket-execution-engine",
  },
];

function mapUnderlyingAgentSummary(row: typeof agents.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    title: row.title,
    status: row.status,
    adapterType: row.adapterType,
  };
}

function actorToSecretActor(actor: ServiceActor) {
  return {
    userId: actor.actorType === "user" ? actor.actorId : null,
    agentId: actor.actorType === "agent" ? actor.actorId : actor.agentId ?? null,
  };
}

function defaultSecretProvider(): SecretProvider {
  const configuredDefaultProvider = process.env.PAPERCLIP_SECRETS_PROVIDER;
  return (
    configuredDefaultProvider && SECRET_PROVIDERS.includes(configuredDefaultProvider as SecretProvider)
      ? configuredDefaultProvider
      : "local_encrypted"
  ) as SecretProvider;
}

function asSecretRefBinding(value: unknown): EnvSecretRefBinding | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  if ((value as { type?: unknown }).type !== "secret_ref") return null;
  const secretId = (value as { secretId?: unknown }).secretId;
  if (typeof secretId !== "string" || secretId.trim().length === 0) return null;
  const version = (value as { version?: unknown }).version;
  return {
    type: "secret_ref",
    secretId,
    version: version === undefined || version === "latest" || typeof version === "number"
      ? version
      : "latest",
  };
}

function withValidationStatus(
  readiness: PolymarketCopyAuthReadiness,
  status: PolymarketCopyAuthReadiness["lastValidation"],
): PolymarketCopyAuthReadiness {
  return {
    ...readiness,
    lastValidation: status,
  };
}

function withDerivationStatus(
  readiness: PolymarketCopyAuthReadiness,
  status: PolymarketCopyAuthReadiness["lastDerivation"],
): PolymarketCopyAuthReadiness {
  return {
    ...readiness,
    lastDerivation: status,
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results: TOutput[] = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

function runtimeConfigFromRow(
  row: typeof polymarketRuntimeConfigs.$inferSelect,
): PolymarketCopyRuntimeConfig {
  const { authEnvJson, ...rest } = row;
  return {
    ...rest,
    mode: row.mode as PolymarketCopyRuntimeConfig["mode"],
    authEnv: (authEnvJson ?? null) as AgentEnvConfig | null,
  };
}

function runtimeConfigToStorage<T extends { authEnv?: AgentEnvConfig | null }>(
  config: T,
): Omit<T, "authEnv"> & { authEnvJson: AgentEnvConfig | null } {
  const { authEnv, ...rest } = config;
  return {
    ...rest,
    authEnvJson: authEnv ?? null,
  };
}

function watchedWalletFromRow(row: typeof polymarketWatchedWallets.$inferSelect): PolymarketCopyWatchedWallet {
  return {
    ...row,
    status: row.status as PolymarketCopyWalletStatus,
    componentScores: {
      efficiency: row.efficiencyScore,
      consistency: row.consistencyScore,
      diversification: row.diversificationScore,
      recency: row.recencyScore,
      concentrationPenalty: row.concentrationPenaltyScore,
    },
    metadata: row.metadataJson,
  };
}

function paperTradeFromRow(row: typeof polymarketPaperTrades.$inferSelect): PolymarketCopyPaperTrade {
  return {
    ...row,
    status: row.status as PolymarketCopyPaperTradeStatus,
    metadata: row.metadataJson,
  };
}

function signalFromRow(row: typeof polymarketSignals.$inferSelect): PolymarketCopySignal {
  return {
    ...row,
    action: row.action as PolymarketCopySignalAction,
    cadence: row.cadence as PolymarketCopyCadence,
    rawMetadata: row.rawMetadataJson,
  };
}

function deserializeSnapshotPositions(
  positionsJson: Record<string, unknown>[] | null | undefined,
): Awaited<ReturnType<ReturnType<typeof createWalletMonitor>["monitorWallet"]>>["snapshot"]["positions"] {
  return (positionsJson ?? []).map((position) => ({
    ...(position as Record<string, unknown>),
    latestTradeAt: safeDate(position.latestTradeAt as string | null | undefined),
    spread:
      position.spread && typeof position.spread === "object"
        ? {
          bestBid: typeof (position.spread as Record<string, unknown>).bestBid === "number"
            ? ((position.spread as Record<string, unknown>).bestBid as number)
            : null,
          bestAsk: typeof (position.spread as Record<string, unknown>).bestAsk === "number"
            ? ((position.spread as Record<string, unknown>).bestAsk as number)
            : null,
          spreadBps: typeof (position.spread as Record<string, unknown>).spreadBps === "number"
            ? ((position.spread as Record<string, unknown>).spreadBps as number)
            : null,
          midpoint: typeof (position.spread as Record<string, unknown>).midpoint === "number"
            ? ((position.spread as Record<string, unknown>).midpoint as number)
            : null,
        }
        : null,
  })) as Awaited<ReturnType<ReturnType<typeof createWalletMonitor>["monitorWallet"]>>["snapshot"]["positions"];
}

export function polymarketCopyService(db: Db) {
  const log = logger.child({ service: "polymarket-copy" });
  const defaults = getPolymarketCopyDefaults();
  const client = createPolymarketOfficialClient();
  const monitor = createWalletMonitor();
  const reporter = polymarketDashboardReporter(db);
  const secretsSvc = secretService(db);
  const access = accessService(db);

  async function appendAuditEntries(entries: LogActivityInput[]) {
    await Promise.allSettled(entries.map((entry) => logActivity(db, entry)));
  }

  async function ensureUnderlyingModel(companyId: string): Promise<PolymarketCopyUnderlyingModel> {
    const company = await db
      .select({ id: companies.id, issuePrefix: companies.issuePrefix })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");

    const directOwnerRows = await db
      .select({
        userId: companyMemberships.principalId,
        name: authUsers.name,
        email: authUsers.email,
        membershipRole: companyMemberships.membershipRole,
      })
      .from(companyMemberships)
      .leftJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
      .where(and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.status, "active"),
        eq(companyMemberships.membershipRole, "owner"),
      ));

    const companyAgents = await db
      .select()
      .from(agents)
      .where(eq(agents.companyId, companyId));

    const ceoAgent = companyAgents.find((agent) => agent.role === "ceo") ?? null;
    let tradingAnalyst = companyAgents.find((agent) => {
      const metadataRole =
        agent.metadata && typeof agent.metadata === "object"
          ? (agent.metadata as Record<string, unknown>).polymarketRole
          : null;
      return metadataRole === "trading_analyst" || agent.name === POLYMARKET_TRADING_ANALYST_NAME;
    }) ?? null;

    const auditEntries: LogActivityInput[] = [];
    if (!tradingAnalyst) {
      const [created] = await db
        .insert(agents)
        .values({
          companyId,
          name: POLYMARKET_TRADING_ANALYST_NAME,
          role: "researcher",
          title: "Trading Analyst",
          status: "idle",
          reportsTo: ceoAgent?.id ?? null,
          capabilities: "Polymarket desk analysis and operator support",
          adapterType: "codex_local",
          metadata: {
            polymarketDesk: true,
            polymarketRole: "trading_analyst",
            surface: "polymarket_copy",
          },
        })
        .returning();
      tradingAnalyst = created;
      await access.ensureMembership(companyId, "agent", created.id, "member", "active");
      auditEntries.push({
        companyId,
        actorType: "system",
        actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
        action: "polymarket.model.trading_analyst_seeded",
        entityType: "agent",
        entityId: created.id,
        details: {
          name: created.name,
          role: created.role,
          adapterType: created.adapterType,
          reportsTo: created.reportsTo,
        },
      });
    } else {
      await access.ensureMembership(companyId, "agent", tradingAnalyst.id, "member", "active");
    }

    const runtimeServiceRows = tradingAnalyst
      ? await db
        .select()
        .from(workspaceRuntimeServices)
        .where(and(
          eq(workspaceRuntimeServices.companyId, companyId),
          inArray(
            workspaceRuntimeServices.serviceName,
            POLYMARKET_RUNTIME_SERVICE_DEFINITIONS.map((definition) => definition.serviceName),
          ),
        ))
      : [];
    const runtimeServiceByName = new Map(runtimeServiceRows.map((row) => [row.serviceName, row]));

    if (tradingAnalyst) {
      const now = new Date();
      for (const definition of POLYMARKET_RUNTIME_SERVICE_DEFINITIONS) {
        const existing = runtimeServiceByName.get(definition.serviceName) ?? null;

        if (!existing) {
          const [created] = await db
            .insert(workspaceRuntimeServices)
            .values({
              id: randomUUID(),
              companyId,
              scopeType: "agent",
              scopeId: tradingAnalyst.id,
              serviceName: definition.serviceName,
              status: "stopped",
              lifecycle: "shared",
              reuseKey: `polymarket:${companyId}:${definition.key}`,
              provider: "adapter_managed",
              providerRef: definition.providerRef,
              ownerAgentId: tradingAnalyst.id,
              lastUsedAt: now,
              startedAt: now,
              stoppedAt: now,
              healthStatus: "unknown",
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          runtimeServiceByName.set(definition.serviceName, created);
          auditEntries.push({
            companyId,
            actorType: "system",
            actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
            action: "polymarket.model.runtime_service_seeded",
            entityType: "workspace_runtime_service",
            entityId: created.id,
            details: {
              key: definition.key,
              serviceName: created.serviceName,
              status: created.status,
              provider: created.provider,
              scopeType: created.scopeType,
              scopeId: created.scopeId,
            },
          });
          continue;
        }

        const patch: Partial<typeof workspaceRuntimeServices.$inferInsert> = {};
        if (existing.scopeType !== "agent") patch.scopeType = "agent";
        if (existing.scopeId !== tradingAnalyst.id) patch.scopeId = tradingAnalyst.id;
        if (existing.lifecycle !== "shared") patch.lifecycle = "shared";
        if (existing.provider !== "adapter_managed") patch.provider = "adapter_managed";
        if (existing.providerRef !== definition.providerRef) patch.providerRef = definition.providerRef;
        if (existing.ownerAgentId !== tradingAnalyst.id) patch.ownerAgentId = tradingAnalyst.id;
        if (Object.keys(patch).length === 0) continue;

        const [updated] = await db
          .update(workspaceRuntimeServices)
          .set({
            ...patch,
            updatedAt: now,
          })
          .where(eq(workspaceRuntimeServices.id, existing.id))
          .returning();
        runtimeServiceByName.set(definition.serviceName, updated);
        auditEntries.push({
          companyId,
          actorType: "system",
          actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
          action: "polymarket.model.runtime_service_reconciled",
          entityType: "workspace_runtime_service",
          entityId: updated.id,
          details: {
            key: definition.key,
            serviceName: updated.serviceName,
            scopeType: updated.scopeType,
            scopeId: updated.scopeId,
            provider: updated.provider,
            providerRef: updated.providerRef,
            ownerAgentId: updated.ownerAgentId,
          },
        });
      }
    }

    if (auditEntries.length > 0) {
      await appendAuditEntries(auditEntries);
    }

    return {
      deskObjectKind: "company_runtime",
      hasSeparateDeskObject: false,
      companyPrefix: company.issuePrefix,
      directOwners: directOwnerRows.map((row) => ({
        userId: row.userId,
        name: row.name ?? null,
        email: row.email ?? null,
        membershipRole: row.membershipRole ?? null,
      })),
      ceoAgent: ceoAgent ? mapUnderlyingAgentSummary(ceoAgent) : null,
      tradingAnalyst: tradingAnalyst ? mapUnderlyingAgentSummary(tradingAnalyst) : null,
      runtimeServices: POLYMARKET_RUNTIME_SERVICE_DEFINITIONS.map((definition) => {
        const serviceRow = runtimeServiceByName.get(definition.serviceName) ?? null;
        return {
          key: definition.key,
          serviceName: definition.serviceName,
          id: serviceRow?.id ?? null,
          exists: serviceRow != null,
          status: serviceRow?.status ?? null,
          provider: serviceRow?.provider ?? null,
          scopeType: serviceRow?.scopeType ?? null,
          ownerAgentId: serviceRow?.ownerAgentId ?? null,
        };
      }),
    };
  }

  async function requireCompany(companyId: string) {
    const company = await db
      .select({ id: companies.id, status: companies.status })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");
    return company;
  }

  async function getLatestWorkerRun(companyId: string, workerKey: string) {
    return db
      .select()
      .from(polymarketWorkerRuns)
      .where(and(eq(polymarketWorkerRuns.companyId, companyId), eq(polymarketWorkerRuns.workerKey, workerKey)))
      .orderBy(desc(polymarketWorkerRuns.startedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function getLatestSuccessfulWorkerRun(companyId: string, workerKey: string) {
    return db
      .select()
      .from(polymarketWorkerRuns)
      .where(and(
        eq(polymarketWorkerRuns.companyId, companyId),
        eq(polymarketWorkerRuns.workerKey, workerKey),
        eq(polymarketWorkerRuns.status, "success"),
      ))
      .orderBy(desc(polymarketWorkerRuns.finishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function isWorkerRunning(companyId: string, workerKey: string): Promise<boolean> {
    const run = await db
      .select({ id: polymarketWorkerRuns.id })
      .from(polymarketWorkerRuns)
      .where(and(
        eq(polymarketWorkerRuns.companyId, companyId),
        eq(polymarketWorkerRuns.workerKey, workerKey),
        eq(polymarketWorkerRuns.status, "running"),
      ))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return run != null;
  }

  async function getRuntimeConfig(companyId: string): Promise<PolymarketCopyRuntimeConfig> {
    await requireCompany(companyId);
    const existing = await db
      .select()
      .from(polymarketRuntimeConfigs)
      .where(eq(polymarketRuntimeConfigs.companyId, companyId))
      .then((rows) => rows[0] ?? null);

    if (existing) return runtimeConfigFromRow(existing);

    const seedConfig = {
      ...defaults,
      mode: "paper" as const,
      liveEnabled: false,
      tradingKillSwitch: true,
    };
    const now = new Date();
    const [created] = await db
      .insert(polymarketRuntimeConfigs)
      .values({
        companyId,
        ...runtimeConfigToStorage(seedConfig),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await appendAuditEntries([{
      companyId,
      actorType: "system",
      actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
      action: "polymarket.config.seeded",
      entityType: "polymarket_runtime_config",
      entityId: companyId,
      details: {
        mode: created.mode,
        liveEnabled: created.liveEnabled,
        tradingKillSwitch: created.tradingKillSwitch,
      },
    }]);

    return runtimeConfigFromRow(created);
  }

  async function normalizeRuntimeConfigPatch(
    companyId: string,
    patch: PatchPolymarketCopyRuntimeConfig,
  ): Promise<PatchPolymarketCopyRuntimeConfig> {
    if (!Object.prototype.hasOwnProperty.call(patch, "authEnv")) {
      return patch;
    }
    if (patch.authEnv == null) {
      return { ...patch, authEnv: null };
    }
    const normalized = await secretsSvc.normalizeAdapterConfigForPersistence(
      companyId,
      { env: patch.authEnv },
      { strictMode: true },
    );
    return {
      ...patch,
      authEnv: (normalized.env ?? null) as AgentEnvConfig | null,
    };
  }

  async function listRecentAuditRows(companyId: string, limit: number = 30): Promise<AuditRow[]> {
    return db
      .select({
        action: activityLog.action,
        details: activityLog.details,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(and(
        eq(activityLog.companyId, companyId),
        sql`${activityLog.action} like 'polymarket.%'`,
      ))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);
  }

  async function upsertDerivedSecret(options: {
    companyId: string;
    actor: ServiceActor;
    secretName: string;
    value: string;
    preferredBinding?: unknown;
    description: string;
  }): Promise<{ binding: EnvSecretRefBinding; created: boolean; rotated: boolean; secretName: string }> {
    const preferredBinding = asSecretRefBinding(options.preferredBinding);
    const secretActor = actorToSecretActor(options.actor);

    if (preferredBinding) {
      const existing = await secretsSvc.getById(preferredBinding.secretId);
      if (existing && existing.companyId === options.companyId) {
        const rotated = await secretsSvc.rotate(
          existing.id,
          { value: options.value },
          secretActor,
        );
        return {
          binding: { type: "secret_ref", secretId: rotated.id, version: "latest" },
          created: false,
          rotated: true,
          secretName: rotated.name,
        };
      }
    }

    const byName = await secretsSvc.getByName(options.companyId, options.secretName);
    if (byName) {
      const rotated = await secretsSvc.rotate(
        byName.id,
        { value: options.value },
        secretActor,
      );
      return {
        binding: { type: "secret_ref", secretId: rotated.id, version: "latest" },
        created: false,
        rotated: true,
        secretName: rotated.name,
      };
    }

    const created = await secretsSvc.create(
      options.companyId,
      {
        name: options.secretName,
        provider: defaultSecretProvider(),
        value: options.value,
        description: options.description,
      },
      secretActor,
    );

    return {
      binding: { type: "secret_ref", secretId: created.id, version: "latest" },
      created: true,
      rotated: false,
      secretName: created.name,
    };
  }

  async function updateRuntimeConfig(
    companyId: string,
    patch: PatchPolymarketCopyRuntimeConfig,
    actor: ServiceActor,
  ): Promise<PolymarketCopyRuntimeConfig> {
    const current = await getRuntimeConfig(companyId);
    const normalizedPatch = await normalizeRuntimeConfigPatch(companyId, patch);
    const merged = mergeRuntimeConfigPatch(current, normalizedPatch);
    const [updated] = await db
      .update(polymarketRuntimeConfigs)
      .set({
        ...runtimeConfigToStorage(merged),
        updatedAt: new Date(),
      })
      .where(eq(polymarketRuntimeConfigs.companyId, companyId))
      .returning();

    await appendAuditEntries([{
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      action: "polymarket.config.updated",
      entityType: "polymarket_runtime_config",
      entityId: companyId,
      details: normalizedPatch as Record<string, unknown>,
    }]);

    return runtimeConfigFromRow(updated);
  }

  async function checkAuthReadiness(
    companyId: string,
    actor: ServiceActor,
    reason: string | null = null,
  ): Promise<PolymarketCopyAuthReadiness> {
    const runtimeConfig = await getRuntimeConfig(companyId);

    try {
      const auditRows = await listRecentAuditRows(companyId);
      const readiness = await inspectPolymarketAuthReadiness(db, companyId, runtimeConfig, auditRows);
      const validationStatus: PolymarketCopyAuthReadiness["lastValidation"] = {
        checkedAt: new Date(),
        result: readiness.authenticatedLiveReadiness,
        summary: readiness.summary,
        validationMode: readiness.validationMode,
        reasonCodes: readiness.reasonCodes,
      };

      await appendAuditEntries([{
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "polymarket.auth_readiness.checked",
        entityType: "polymarket_runtime_config",
        entityId: companyId,
        details: {
          result: readiness.authenticatedLiveReadiness,
          summary: readiness.summary,
          validationMode: readiness.validationMode,
          reasonCodes: readiness.reasonCodes,
          paperModeActive: readiness.paperModeActive,
          liveEnabled: readiness.liveEnabled,
          tradingKillSwitch: readiness.tradingKillSwitch,
          canDeriveApiCredentials: readiness.canDeriveApiCredentials,
          reason,
        },
      }]);

      return withValidationStatus(readiness, validationStatus);
    } catch {
      const summary = "Auth readiness check failed before any trade or live call was attempted.";
      const reasonCode = "auth_readiness_check_failed";
      const fallback = await inspectPolymarketAuthReadiness(db, companyId, runtimeConfig);
      const failedStatus: PolymarketCopyAuthReadiness["lastValidation"] = {
        checkedAt: new Date(),
        result: "failed",
        summary,
        validationMode: "config_only",
        reasonCodes: [reasonCode],
      };

      await appendAuditEntries([{
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "polymarket.auth_readiness.check_failed",
        entityType: "polymarket_runtime_config",
        entityId: companyId,
        details: {
          reasonCode,
          summary,
          validationMode: "config_only",
          reason,
        },
      }]);

      return withValidationStatus(fallback, failedStatus);
    }
  }

  async function deriveApiCredentials(
    companyId: string,
    actor: ServiceActor,
    reason: string | null = null,
  ): Promise<PolymarketCopyDeriveApiCredentialsResult> {
    const runtimeConfig = await getRuntimeConfig(companyId);
    const baseReadiness = await inspectPolymarketAuthReadiness(
      db,
      companyId,
      runtimeConfig,
      await listRecentAuditRows(companyId),
    );

    const privateKeyBinding = asSecretRefBinding(runtimeConfig.authEnv?.POLYMARKET_PRIVATE_KEY);
    if (!privateKeyBinding || !baseReadiness.keyStatuses.POLYMARKET_PRIVATE_KEY.valid) {
      const reasonCode = baseReadiness.keyStatuses.POLYMARKET_PRIVATE_KEY.reasonCode ?? "private_key_ref_missing";
      const summary = "API credential derivation requires a valid POLYMARKET_PRIVATE_KEY secret reference.";
      const derivationStatus: PolymarketCopyAuthReadiness["lastDerivation"] = {
        attemptedAt: new Date(),
        result: "failed",
        reasonCode,
      };

      await appendAuditEntries([{
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "polymarket.auth_derivation.failed",
        entityType: "polymarket_runtime_config",
        entityId: companyId,
        details: {
          reasonCode,
          summary,
          reason,
        },
      }]);

      return {
        result: "failed",
        reasonCode,
        summary,
        readiness: withDerivationStatus(baseReadiness, derivationStatus),
        createdSecretNames: [],
        rotatedSecretNames: [],
      };
    }

    try {
      const privateKey = await secretsSvc.resolveSecretValue(
        companyId,
        privateKeyBinding.secretId,
        privateKeyBinding.version ?? "latest",
      );
      const derivedCredentials = await derivePolymarketApiCredentialsFromPrivateKey({
        privateKey,
      });

      const existingAuthEnv = runtimeConfig.authEnv ?? {};
      const upserts = await Promise.all([
        upsertDerivedSecret({
          companyId,
          actor,
          secretName: "POLYMARKET_API_KEY",
          value: derivedCredentials.apiKey,
          preferredBinding: existingAuthEnv.POLYMARKET_API_KEY,
          description: "Derived Polymarket API key for future authenticated desk readiness.",
        }),
        upsertDerivedSecret({
          companyId,
          actor,
          secretName: "POLYMARKET_API_SECRET",
          value: derivedCredentials.apiSecret,
          preferredBinding: existingAuthEnv.POLYMARKET_API_SECRET,
          description: "Derived Polymarket API secret for future authenticated desk readiness.",
        }),
        upsertDerivedSecret({
          companyId,
          actor,
          secretName: "POLYMARKET_API_PASSPHRASE",
          value: derivedCredentials.apiPassphrase,
          preferredBinding: existingAuthEnv.POLYMARKET_API_PASSPHRASE,
          description: "Derived Polymarket API passphrase for future authenticated desk readiness.",
        }),
        upsertDerivedSecret({
          companyId,
          actor,
          secretName: "POLYMARKET_FUNDER_ADDRESS",
          value: derivedCredentials.funderAddress,
          preferredBinding: existingAuthEnv.POLYMARKET_FUNDER_ADDRESS,
          description: "Derived Polymarket funder address for authenticated desk readiness.",
        }),
      ]);

      const nextAuthEnv: AgentEnvConfig = {
        ...existingAuthEnv,
        POLYMARKET_API_KEY: upserts[0].binding,
        POLYMARKET_API_SECRET: upserts[1].binding,
        POLYMARKET_API_PASSPHRASE: upserts[2].binding,
        POLYMARKET_FUNDER_ADDRESS: upserts[3].binding,
      };

      await updateRuntimeConfig(companyId, { authEnv: nextAuthEnv }, actor);
      const readiness = await checkAuthReadiness(companyId, actor, "post_derivation_validation");
      const summary = "Polymarket API credentials were derived into the Paperclip secret store. Live trading remains disabled.";
      const derivationStatus: PolymarketCopyAuthReadiness["lastDerivation"] = {
        attemptedAt: new Date(),
        result: "succeeded",
        reasonCode: null,
      };

      await appendAuditEntries([{
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "polymarket.auth_derivation.succeeded",
        entityType: "polymarket_runtime_config",
        entityId: companyId,
        details: {
          summary,
          reason,
          createdSecretNames: upserts.filter((item) => item.created).map((item) => item.secretName),
          rotatedSecretNames: upserts.filter((item) => item.rotated).map((item) => item.secretName),
        },
      }]);

      return {
        result: "succeeded",
        reasonCode: null,
        summary,
        readiness: withDerivationStatus(readiness, derivationStatus),
        createdSecretNames: upserts.filter((item) => item.created).map((item) => item.secretName),
        rotatedSecretNames: upserts.filter((item) => item.rotated).map((item) => item.secretName),
      };
    } catch {
      const reasonCode = "api_credential_derivation_failed";
      const summary = "Polymarket API credential derivation failed without enabling live trading.";
      const derivationStatus: PolymarketCopyAuthReadiness["lastDerivation"] = {
        attemptedAt: new Date(),
        result: "failed",
        reasonCode,
      };

      await appendAuditEntries([{
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "polymarket.auth_derivation.failed",
        entityType: "polymarket_runtime_config",
        entityId: companyId,
        details: {
          reasonCode,
          summary,
          reason,
        },
      }]);

      return {
        result: "failed",
        reasonCode,
        summary,
        readiness: withDerivationStatus(baseReadiness, derivationStatus),
        createdSecretNames: [],
        rotatedSecretNames: [],
      };
    }
  }

  async function loadWatchlist(companyId: string) {
    return db
      .select()
      .from(polymarketWatchedWallets)
      .where(eq(polymarketWatchedWallets.companyId, companyId))
      .orderBy(polymarketWatchedWallets.status, polymarketWatchedWallets.currentRank);
  }

  async function runWalletSelection(companyId: string, reason: string = "scheduled") {
    const runtimeConfig = await getRuntimeConfig(companyId);
    const now = new Date();
    const [run] = await db
      .insert(polymarketWalletSelectionRuns)
      .values({
        companyId,
        status: "running",
        startedAt: now,
        createdAt: now,
      })
      .returning();

    try {
      const previousWatchlist = (await loadWatchlist(companyId)).map(watchedWalletFromRow);
      const leaderboard = await client.listLeaderboard(runtimeConfig.selectorMaxCandidates);
      const candidates = await mapWithConcurrency(leaderboard, 5, async (entry): Promise<WalletSelectorCandidateScore> => {
        try {
          const walletAddress = normalizeWalletAddress(entry.proxyWallet);
          const [positions, closedPositions, trades] = await Promise.all([
            client.getPositions(walletAddress),
            client.getClosedPositions(walletAddress),
            client.getTrades(walletAddress),
          ]);
          return scoreWalletCandidate({
            walletAddress,
            label: entry.userName || null,
            leaderboard: entry,
            positions,
            closedPositions,
            trades,
            now,
          }, toWeightSet(runtimeConfig));
        } catch (error) {
          log.warn({ err: error, walletAddress: entry.proxyWallet }, "wallet candidate fetch failed");
          const candidate = scoreWalletCandidate({
            walletAddress: normalizeWalletAddress(entry.proxyWallet),
            label: entry.userName || null,
            leaderboard: entry,
            positions: [],
            closedPositions: [],
            trades: [],
            now,
          }, toWeightSet(runtimeConfig));
          candidate.eligible = false;
          candidate.eligibilityReasons = [...candidate.eligibilityReasons, "source_fetch_failed"];
          return candidate;
        }
      });

      const selection = selectWalletsWithBench({
        candidates,
        previousWatchlist,
        targetActiveCount: runtimeConfig.targetWatchedWalletCount,
        targetBenchCount: runtimeConfig.targetBenchWalletCount,
        maxDailyReplacements: runtimeConfig.maxDailyReplacements,
        selectorReplacementScoreDelta: runtimeConfig.selectorReplacementScoreDelta,
      });

      const candidateByWallet = new Map(candidates.map((candidate) => [candidate.walletAddress, candidate]));
      const existingByWallet = new Map(previousWatchlist.map((wallet) => [wallet.walletAddress, wallet]));
      const activeSet = new Set(selection.active.map((wallet) => wallet.walletAddress));
      const benchSet = new Set(selection.bench.map((wallet) => wallet.walletAddress));
      const auditEntries: LogActivityInput[] = [];

      await db.transaction(async (tx) => {
        if (candidates.length > 0) {
          await tx.insert(polymarketWalletCandidates).values(
            selection.decisions.map((decision) => {
              const candidate = candidateByWallet.get(decision.walletAddress)!;
              return {
                companyId,
                selectionRunId: run.id,
                walletAddress: candidate.walletAddress,
                label: candidate.label,
                source: "data_api_leaderboard",
                leaderboardRank: candidate.leaderboardRank,
                rank: decision.rank,
                status: decision.status,
                eligible: candidate.eligible,
                eligibilityReasons: candidate.eligibilityReasons,
                volume: candidate.volume,
                pnl: candidate.pnl,
                openMarketCount: candidate.openMarketCount,
                closedMarketCount: candidate.closedMarketCount,
                recentTradeCount: candidate.recentTradeCount,
                recentTradeAt: candidate.recentTradeAt,
                concentrationRatio: candidate.concentrationRatio,
                compositeScore: candidate.compositeScore,
                efficiencyScore: candidate.componentScores.efficiency,
                consistencyScore: candidate.componentScores.consistency,
                diversificationScore: candidate.componentScores.diversification,
                recencyScore: candidate.componentScores.recency,
                concentrationPenaltyScore: candidate.componentScores.concentrationPenalty,
                snapshotJson: {
                  ...candidate.snapshot,
                  replacementReason: decision.replacementReason,
                },
                createdAt: now,
              };
            }),
          );
        }

        for (const decision of selection.decisions) {
          const candidate = candidateByWallet.get(decision.walletAddress)!;
          const existing = existingByWallet.get(decision.walletAddress) ?? null;
          await tx
            .insert(polymarketWatchedWallets)
            .values({
              companyId,
              walletAddress: candidate.walletAddress,
              label: candidate.label,
              status: decision.status,
              sourceSelectionRunId: run.id,
              currentRank: decision.rank,
              score: candidate.compositeScore,
              efficiencyScore: candidate.componentScores.efficiency,
              consistencyScore: candidate.componentScores.consistency,
              diversificationScore: candidate.componentScores.diversification,
              recencyScore: candidate.componentScores.recency,
              concentrationPenaltyScore: candidate.componentScores.concentrationPenalty,
              concentrationRatio: candidate.concentrationRatio,
              lastRefreshedAt: now,
              activatedAt: decision.status === "active" ? existing?.activatedAt ?? now : existing?.activatedAt ?? null,
              replacedAt: decision.status === "rejected" ? now : null,
              metadataJson: {
                eligibilityReasons: candidate.eligibilityReasons,
                snapshot: candidate.snapshot,
              },
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [polymarketWatchedWallets.companyId, polymarketWatchedWallets.walletAddress],
              set: {
                label: candidate.label,
                status: decision.status,
                sourceSelectionRunId: run.id,
                currentRank: decision.rank,
                score: candidate.compositeScore,
                efficiencyScore: candidate.componentScores.efficiency,
                consistencyScore: candidate.componentScores.consistency,
                diversificationScore: candidate.componentScores.diversification,
                recencyScore: candidate.componentScores.recency,
                concentrationPenaltyScore: candidate.componentScores.concentrationPenalty,
                concentrationRatio: candidate.concentrationRatio,
                lastRefreshedAt: now,
                activatedAt: decision.status === "active" ? existing?.activatedAt ?? now : existing?.activatedAt ?? null,
                replacedAt: decision.status === "rejected" ? now : null,
                metadataJson: {
                  eligibilityReasons: candidate.eligibilityReasons,
                  snapshot: candidate.snapshot,
                },
                updatedAt: now,
              },
            });
        }

        const untouchedPreviousWallets = previousWatchlist
          .filter((wallet) => !candidateByWallet.has(wallet.walletAddress))
          .map((wallet) => wallet.walletAddress);
        if (untouchedPreviousWallets.length > 0) {
          await tx
            .update(polymarketWatchedWallets)
            .set({
              status: "rejected",
              currentRank: null,
              replacedAt: now,
              lastRefreshedAt: now,
              updatedAt: now,
            })
            .where(and(
              eq(polymarketWatchedWallets.companyId, companyId),
              inArray(polymarketWatchedWallets.walletAddress, untouchedPreviousWallets),
            ));
        }

        await tx
          .update(polymarketWalletSelectionRuns)
          .set({
            status: "success",
            candidateCount: candidates.length,
            activeCount: selection.active.length,
            benchCount: selection.bench.length,
            replacementCount: selection.replacements.length,
            summaryJson: {
              reason,
              activeWallets: selection.active.map((wallet) => wallet.walletAddress),
              benchWallets: selection.bench.map((wallet) => wallet.walletAddress),
              replacements: selection.replacements,
            },
            finishedAt: new Date(),
          })
          .where(eq(polymarketWalletSelectionRuns.id, run.id));
      });

      auditEntries.push({
        companyId,
        actorType: "system",
        actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
        action: "polymarket.wallet_selector.completed",
        entityType: "polymarket_wallet_selection_run",
        entityId: run.id,
        details: {
          reason,
          activeWallets: selection.active.map((wallet) => wallet.walletAddress),
          benchWallets: selection.bench.map((wallet) => wallet.walletAddress),
          replacementCount: selection.replacements.length,
        },
      });

      for (const activeWallet of selection.active) {
        auditEntries.push({
          companyId,
          actorType: "system",
          actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
          action: "polymarket.wallet_selector.watched_wallet_selected",
          entityType: "polymarket_wallet",
          entityId: activeWallet.walletAddress,
          details: {
            score: activeWallet.compositeScore,
            status: "active",
          },
        });
      }

      const artifactPath = await writePolymarketArtifact(runtimeConfig.artifactRootPath, [
        "wallet-selector",
        `${run.id}.json`,
      ], {
        runId: run.id,
        reason,
        generatedAt: now.toISOString(),
        activeWallets: selection.active,
        benchWallets: selection.bench,
        rejectedWallets: selection.rejected.slice(0, 25),
      });
      if (artifactPath) {
        auditEntries.push({
          companyId,
          actorType: "system",
          actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
          action: "polymarket.wallet_selector.snapshot_written",
          entityType: "polymarket_artifact",
          entityId: artifactPath,
          details: { runId: run.id },
        });
      }

      await appendAuditEntries(auditEntries);
      return {
        runId: run.id,
        reason,
        activeWallets: selection.active.length,
        benchWallets: selection.bench.length,
      };
    } catch (error) {
      await db
        .update(polymarketWalletSelectionRuns)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        })
        .where(eq(polymarketWalletSelectionRuns.id, run.id));
      throw error;
    }
  }

  async function getPreviousSnapshot(companyId: string, walletAddress: string, cadence: PolymarketCopyCadence) {
    const snapshot = await db
      .select()
      .from(polymarketWalletSnapshots)
      .where(and(
        eq(polymarketWalletSnapshots.companyId, companyId),
        eq(polymarketWalletSnapshots.walletAddress, walletAddress),
        eq(polymarketWalletSnapshots.cadence, cadence),
      ))
      .orderBy(desc(polymarketWalletSnapshots.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!snapshot) return null;
    return {
      walletAddress: snapshot.walletAddress,
      positions: deserializeSnapshotPositions(snapshot.positionsJson ?? []),
      trades: (snapshot.tradesJson ?? []) as unknown as Awaited<ReturnType<ReturnType<typeof createWalletMonitor>["monitorWallet"]>>["snapshot"]["trades"],
      latestActivityAt: safeDate(snapshot.latestActivityAt),
      openExposureUsd: snapshot.openExposureUsd,
      fetchedAt: snapshot.sourceFetchedAt ?? snapshot.createdAt,
    };
  }

  async function runMonitor(companyId: string, cadence: PolymarketCopyCadence, reason: string = "scheduled") {
    const runtimeConfig = await getRuntimeConfig(companyId);
    const workerKey = cadenceToWorkerKey(cadence);
    if (await isWorkerRunning(companyId, workerKey)) {
      log.info({ companyId, workerKey }, "skipping polymarket worker because a run is already active");
      return { workerKey, skipped: true, reason: "already_running" };
    }
    const liveDispatchReadiness =
      runtimeConfig.mode === "live" && runtimeConfig.liveEnabled && !runtimeConfig.tradingKillSwitch
        ? await inspectPolymarketAuthReadiness(db, companyId, runtimeConfig)
        : null;

    const now = new Date();
    const [workerRun] = await db
      .insert(polymarketWorkerRuns)
      .values({
        companyId,
        workerKey,
        cadence,
        status: "running",
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    try {
      const watchedWalletRows = await db
        .select()
        .from(polymarketWatchedWallets)
        .where(and(
          eq(polymarketWatchedWallets.companyId, companyId),
          eq(polymarketWatchedWallets.status, "active"),
        ))
        .orderBy(polymarketWatchedWallets.currentRank);
      const watchedWallets = watchedWalletRows.map(watchedWalletFromRow);

      const walletResults = await mapWithConcurrency(watchedWallets, 4, async (wallet) => {
        const previousSnapshot = await getPreviousSnapshot(companyId, wallet.walletAddress, cadence);
        return monitor.monitorWallet({
          wallet,
          cadence,
          previousSnapshot,
          now,
        });
      });

      const auditEntries: LogActivityInput[] = [];
      const openTradeRows = await db
        .select()
        .from(polymarketPaperTrades)
        .where(and(
          eq(polymarketPaperTrades.companyId, companyId),
          eq(polymarketPaperTrades.status, "open"),
        ));
      const openTradeMap = new Map(openTradeRows.map((trade) => [`${trade.sourceWalletAddress}:${trade.marketId}:${trade.side}`, trade]));
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const [{ dailyRealizedLossUsd: lossValue }] = await db
        .select({
          dailyRealizedLossUsd: sql<number>`coalesce(sum(case when ${polymarketPaperTrades.realizedPnlUsd} < 0 then ${polymarketPaperTrades.realizedPnlUsd} else 0 end), 0)`,
        })
        .from(polymarketPaperTrades)
        .where(and(
          eq(polymarketPaperTrades.companyId, companyId),
          gte(polymarketPaperTrades.lastUpdatedAt, startOfDay),
        ));
      let runningDailyRealizedLossUsd = Number(lossValue ?? 0);

      const insertedSignals: PolymarketCopySignal[] = [];
      await db.transaction(async (tx) => {
        for (const result of walletResults) {
          const [snapshotRow] = await tx
            .insert(polymarketWalletSnapshots)
            .values({
              companyId,
              workerRunId: workerRun.id,
              walletAddress: result.wallet.walletAddress,
              cadence,
              sourceFetchedAt: result.snapshot.fetchedAt,
              latestActivityAt: result.snapshot.latestActivityAt,
              positionsCount: result.snapshot.positions.length,
              openExposureUsd: result.snapshot.openExposureUsd,
              positionsJson: result.snapshot.positions as unknown as Record<string, unknown>[],
              tradesJson: result.snapshot.trades as unknown as Record<string, unknown>[],
              createdAt: now,
            })
            .returning();

          auditEntries.push({
            companyId,
            actorType: "system",
            actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
            action: "polymarket.monitor.snapshot_recorded",
            entityType: "polymarket_wallet_snapshot",
            entityId: snapshotRow.id,
            details: {
              workerKey,
              walletAddress: result.wallet.walletAddress,
              positionsCount: result.snapshot.positions.length,
            },
          });

          for (const signal of result.signals) {
            const [inserted] = await tx
              .insert(polymarketSignals)
              .values({
                companyId,
                workerRunId: workerRun.id,
                walletSnapshotId: snapshotRow.id,
                sourceWalletAddress: signal.sourceWalletAddress,
                watchedWalletId: result.wallet.id,
                walletScore: signal.walletScore,
                marketId: signal.marketId,
                marketSlug: signal.marketSlug,
                marketTitle: signal.marketTitle,
                assetId: signal.assetId,
                action: signal.action,
                side: signal.side,
                sizeDelta: signal.sizeDelta,
                previousSize: signal.previousSize,
                currentSize: signal.currentSize,
                materialityUsd: signal.materialityUsd,
                detectionTimestamp: signal.detectionTimestamp,
                sourceSnapshotTimestamp: signal.sourceSnapshotTimestamp,
                cadence: signal.cadence,
                rawMetadataJson: signal.rawMetadata,
                createdAt: now,
              })
              .returning();
            insertedSignals.push(signalFromRow(inserted));
          }
        }

        insertedSignals.sort((left, right) => left.detectionTimestamp.getTime() - right.detectionTimestamp.getTime());

        let acceptedCount = 0;
        let skippedCount = 0;
        let blockedCount = 0;

        for (const signal of insertedSignals) {
          const openTradeList = [...openTradeMap.values()].map((trade) => paperTradeFromRow(trade));
          const decision = evaluateRiskDecision({
            config: runtimeConfig,
            signal,
            openTrades: openTradeList,
            dailyRealizedLossUsd: runningDailyRealizedLossUsd,
            now,
          });

          await tx.insert(polymarketSignalDecisions).values({
            companyId,
            signalId: signal.id,
            decision: decision.decision,
            reasonCode: decision.reasonCode,
            reasonDetail: decision.reasonDetail,
            governorSnapshotJson: decision.snapshot,
            decidedAt: now,
            createdAt: now,
          });

          auditEntries.push({
            companyId,
            actorType: "system",
            actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
            action: "polymarket.signal.created",
            entityType: "polymarket_signal",
            entityId: signal.id,
            details: {
              walletAddress: signal.sourceWalletAddress,
              marketId: signal.marketId,
              action: signal.action,
              cadence: signal.cadence,
            },
          });
          auditEntries.push({
            companyId,
            actorType: "system",
            actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
            action: `polymarket.signal.${decision.decision}`,
            entityType: "polymarket_signal_decision",
            entityId: signal.id,
            details: {
              decision: decision.decision,
              reasonCode: decision.reasonCode,
            },
          });

          if (decision.decision === "accepted") {
            acceptedCount += 1;
            const tradeKey = `${signal.sourceWalletAddress}:${signal.marketId}:${signal.side ?? "unknown"}`;
            const existingTrade = openTradeMap.get(tradeKey)
              ? paperTradeFromRow(openTradeMap.get(tradeKey)!)
              : null;
            const simulation = applySignalToPaperTrade({
              signal,
              existingTrade,
              sourceWalletAddress: signal.sourceWalletAddress,
              paperTradeUsdPerSignal: runtimeConfig.paperTradeUsdPerSignal,
              now,
            });

            if (simulation) {
              if (existingTrade) {
                const [updatedTrade] = await tx
                  .update(polymarketPaperTrades)
                  .set({
                    signalId: signal.id,
                    marketSlug: simulation.trade.marketSlug,
                    marketTitle: simulation.trade.marketTitle,
                    assetId: simulation.trade.assetId,
                    status: simulation.trade.status,
                    quantity: simulation.trade.quantity,
                    notionalUsd: simulation.trade.notionalUsd,
                    estimatedEntryPrice: simulation.trade.estimatedEntryPrice,
                    currentMarkPrice: simulation.trade.currentMarkPrice,
                    realizedPnlUsd: simulation.trade.realizedPnlUsd,
                    unrealizedPnlUsd: simulation.trade.unrealizedPnlUsd,
                    sourceToCopyDelayMs: simulation.trade.sourceToCopyDelayMs,
                    assumptionNote: simulation.trade.assumptionNote,
                    metadataJson: simulation.trade.metadata,
                    openedAt: simulation.trade.openedAt,
                    closedAt: simulation.trade.closedAt,
                    lastUpdatedAt: simulation.trade.lastUpdatedAt,
                    updatedAt: now,
                  })
                  .where(eq(polymarketPaperTrades.id, existingTrade.id))
                  .returning();
                if (updatedTrade.status === "closed") {
                  openTradeMap.delete(tradeKey);
                } else {
                  openTradeMap.set(tradeKey, updatedTrade);
                }
                if ((simulation.event?.realizedPnlUsd ?? 0) < 0) {
                  runningDailyRealizedLossUsd += simulation.event?.realizedPnlUsd ?? 0;
                }
                if (simulation.event) {
                  await tx.insert(polymarketPaperTradeEvents).values({
                    companyId,
                    paperTradeId: existingTrade.id,
                    signalId: signal.id,
                    eventType: simulation.event.eventType,
                    quantityDelta: simulation.event.quantityDelta,
                    price: simulation.event.price,
                    realizedPnlUsd: simulation.event.realizedPnlUsd,
                    unrealizedPnlUsd: simulation.event.unrealizedPnlUsd,
                    assumptionsJson: simulation.event.assumptions,
                    createdAt: now,
                  });
                  auditEntries.push({
                    companyId,
                    actorType: "system",
                    actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
                    action: "polymarket.paper_trade.updated",
                    entityType: "polymarket_paper_trade",
                    entityId: existingTrade.id,
                    details: {
                      eventType: simulation.event.eventType,
                      marketId: signal.marketId,
                    },
                  });
                }
              } else {
                const [createdTrade] = await tx
                  .insert(polymarketPaperTrades)
                  .values({
                    companyId,
                    ...simulation.trade,
                    metadataJson: simulation.trade.metadata,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .returning();
                if (createdTrade.status === "open") {
                  openTradeMap.set(tradeKey, createdTrade);
                }
                if (simulation.event) {
                  await tx.insert(polymarketPaperTradeEvents).values({
                    companyId,
                    paperTradeId: createdTrade.id,
                    signalId: signal.id,
                    eventType: simulation.event.eventType,
                    quantityDelta: simulation.event.quantityDelta,
                    price: simulation.event.price,
                    realizedPnlUsd: simulation.event.realizedPnlUsd,
                    unrealizedPnlUsd: simulation.event.unrealizedPnlUsd,
                    assumptionsJson: simulation.event.assumptions,
                    createdAt: now,
                  });
                  auditEntries.push({
                    companyId,
                    actorType: "system",
                    actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
                    action: "polymarket.paper_trade.opened",
                    entityType: "polymarket_paper_trade",
                    entityId: createdTrade.id,
                    details: {
                      marketId: signal.marketId,
                      side: signal.side,
                    },
                  });
                }
              }

              const dispatch = evaluatePolymarketLiveDispatch({
                config: runtimeConfig,
                authReadiness: liveDispatchReadiness,
              });
              if (dispatch) {
                auditEntries.push({
                  companyId,
                  actorType: "system",
                  actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
                  action: dispatch.status === "blocked"
                    ? "polymarket.live_dispatch.blocked"
                    : "polymarket.live_dispatch.not_implemented",
                  entityType: "polymarket_signal",
                  entityId: signal.id,
                  details: {
                    reasonCode: dispatch.reasonCode,
                    mode: runtimeConfig.mode,
                    ...dispatch.details,
                  },
                });
              }
            }
          } else if (decision.decision === "skipped") {
            skippedCount += 1;
          } else {
            blockedCount += 1;
          }

          await tx
            .update(polymarketWorkerRuns)
            .set({
              walletCount: watchedWallets.length,
              signalCount: insertedSignals.length,
              acceptedCount,
              skippedCount,
              blockedCount,
              updatedAt: new Date(),
            })
            .where(eq(polymarketWorkerRuns.id, workerRun.id));
        }

        await tx
          .update(polymarketWorkerRuns)
          .set({
            status: "success",
            walletCount: watchedWallets.length,
            signalCount: insertedSignals.length,
            acceptedCount,
            skippedCount,
            blockedCount,
            detailsJson: {
              reason,
              activeWallets: watchedWallets.length,
            },
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(polymarketWorkerRuns.id, workerRun.id));
      });

      const artifactPath = await writePolymarketArtifact(runtimeConfig.artifactRootPath, [
        workerKey,
        `${workerRun.id}.json`,
      ], {
        workerRunId: workerRun.id,
        cadence,
        reason,
        generatedAt: now.toISOString(),
        walletCount: walletResults.length,
        signalCount: walletResults.reduce((sum, result) => sum + result.signals.length, 0),
      });
      if (artifactPath) {
        auditEntries.push({
          companyId,
          actorType: "system",
          actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
          action: "polymarket.monitor.artifact_written",
          entityType: "polymarket_artifact",
          entityId: artifactPath,
          details: {
            workerRunId: workerRun.id,
            workerKey,
          },
        });
      }
      auditEntries.push({
        companyId,
        actorType: "system",
        actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
        action: "polymarket.monitor.completed",
        entityType: "polymarket_worker_run",
        entityId: workerRun.id,
        details: {
          workerKey,
          cadence,
          reason,
        },
      });
      await appendAuditEntries(auditEntries);

      const updatedRun = await getLatestWorkerRun(companyId, workerKey);
      return {
        workerRunId: workerRun.id,
        workerKey,
        status: updatedRun?.status ?? "success",
      };
    } catch (error) {
      await db
        .update(polymarketWorkerRuns)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(polymarketWorkerRuns.id, workerRun.id));
      await appendAuditEntries([{
        companyId,
        actorType: "system",
        actorId: POLYMARKET_COPY_SYSTEM_ACTOR_ID,
        action: "polymarket.monitor.failed",
        entityType: "polymarket_worker_run",
        entityId: workerRun.id,
        details: {
          workerKey,
          cadence,
          error: error instanceof Error ? error.message : String(error),
        },
      }]);
      throw error;
    }
  }

  async function getDashboard(companyId: string): Promise<PolymarketCopyDashboardData> {
    await getRuntimeConfig(companyId);
    const underlyingModel = await ensureUnderlyingModel(companyId);
    const dashboard = await reporter.get(companyId);
    return {
      ...dashboard,
      underlyingModel,
    };
  }

  async function tickAllCompanies(now: Date = new Date()) {
    const activeCompanies = await db
      .select({ id: companies.id })
      .from(companies)
      .where(ne(companies.status, "archived"));

    for (const company of activeCompanies) {
      try {
        const runtimeConfig = await getRuntimeConfig(company.id);

        if (runtimeConfig.walletSelectionEnabled) {
          const lastSelection = await db
            .select()
            .from(polymarketWalletSelectionRuns)
            .where(and(
              eq(polymarketWalletSelectionRuns.companyId, company.id),
              eq(polymarketWalletSelectionRuns.status, "success"),
            ))
            .orderBy(desc(polymarketWalletSelectionRuns.finishedAt))
            .limit(1)
            .then((rows) => rows[0] ?? null);
          const due = shouldRunDaily(
            lastSelection?.finishedAt ?? null,
            now,
            runtimeConfig.walletSelectionTimeZone,
            runtimeConfig.walletSelectionHour,
            runtimeConfig.walletSelectionMinute,
          );
          if (due) {
            await runWalletSelection(company.id);
          }
        }

        if (runtimeConfig.monitor5mEnabled) {
          const last5mSuccess = await getLatestSuccessfulWorkerRun(company.id, "polymarket-monitor-5m");
          if (shouldRunInterval(last5mSuccess?.finishedAt ?? null, now, runtimeConfig.monitor5mIntervalMinutes)) {
            await runMonitor(company.id, "5m");
          }
        }

        if (runtimeConfig.monitor15mEnabled) {
          const last15mSuccess = await getLatestSuccessfulWorkerRun(company.id, "polymarket-monitor-15m");
          if (shouldRunInterval(last15mSuccess?.finishedAt ?? null, now, runtimeConfig.monitor15mIntervalMinutes)) {
            await runMonitor(company.id, "15m");
          }
        }
      } catch (error) {
        log.error({ err: error, companyId: company.id }, "polymarket scheduler tick failed for company");
      }
    }
  }

  return {
    getRuntimeConfig,
    updateRuntimeConfig,
    getDashboard,
    checkAuthReadiness,
    deriveApiCredentials,
    runWalletSelection,
    runMonitor,
    tickAllCompanies,
  };
}
