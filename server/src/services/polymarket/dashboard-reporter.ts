import { and, desc, eq, gte, ilike, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  polymarketKalshiMirrorOrders,
  polymarketPaperTradeEvents,
  polymarketPaperTrades,
  polymarketRuntimeConfigs,
  polymarketSignalDecisions,
  polymarketSignals,
  polymarketWalletSelectionRuns,
  polymarketWatchedWallets,
  polymarketWorkerRuns,
} from "@paperclipai/db";
import type {
  AgentEnvConfig,
  PolymarketCopyDashboardData,
  PolymarketCopyKalshiMirrorOrder,
  PolymarketCopyPaperBaseline,
  PolymarketCopyPaperTrade,
  PolymarketCopyPaperTradeEvent,
  PolymarketCopyPaperTradeStatus,
  PolymarketCopyRunStatus,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignalAction,
  PolymarketCopySignalDecision,
  PolymarketCopyWalletStatus,
  PolymarketCopyWorkerKey,
} from "@paperclipai/shared";
import { inspectPolymarketAuthReadiness } from "./auth-readiness.js";
import { inspectKalshiReadiness } from "./kalshi-readiness.js";
import { buildPerformanceSummary } from "./performance.js";

function safeDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function workerHealth(lastSuccessAt: Date | null, lastStatus: string | null, maxAgeMinutes: number, now: Date): "healthy" | "stale" | "failed" | "idle" {
  if (lastStatus === "failed") return "failed";
  if (!lastSuccessAt) return "idle";
  const ageMinutes = (now.getTime() - lastSuccessAt.getTime()) / 60_000;
  return ageMinutes <= maxAgeMinutes ? "healthy" : "stale";
}

function mapSelectionRun(row: typeof polymarketWalletSelectionRuns.$inferSelect) {
  return {
    ...row,
    status: row.status as PolymarketCopyRunStatus,
    summary: row.summaryJson,
  };
}

function mapWatchedWallet(row: typeof polymarketWatchedWallets.$inferSelect) {
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

function mapSignalDecision(row: typeof polymarketSignalDecisions.$inferSelect) {
  return {
    ...row,
    decision: row.decision as PolymarketCopySignalDecision,
    governorSnapshot: row.governorSnapshotJson,
  };
}

function mapSignal(row: typeof polymarketSignals.$inferSelect) {
  return {
    ...row,
    action: row.action as PolymarketCopySignalAction,
    cadence: row.cadence as "5m" | "15m",
    rawMetadata: row.rawMetadataJson,
  };
}

function mapPaperTrade(row: typeof polymarketPaperTrades.$inferSelect): PolymarketCopyPaperTrade {
  return {
    ...row,
    status: row.status as PolymarketCopyPaperTradeStatus,
    metadata: row.metadataJson,
  };
}

function mapPaperTradeEvent(row: typeof polymarketPaperTradeEvents.$inferSelect): PolymarketCopyPaperTradeEvent {
  return {
    ...row,
    assumptions: row.assumptionsJson,
  };
}

function mapKalshiMirrorOrder(row: typeof polymarketKalshiMirrorOrders.$inferSelect): PolymarketCopyKalshiMirrorOrder {
  return {
    ...row,
    cadence: row.cadence as PolymarketCopyKalshiMirrorOrder["cadence"],
    sourceAction: row.sourceAction as PolymarketCopyKalshiMirrorOrder["sourceAction"],
    executionMode: row.executionMode as PolymarketCopyKalshiMirrorOrder["executionMode"],
    matchStatus: row.matchStatus as PolymarketCopyKalshiMirrorOrder["matchStatus"],
    executionStatus: row.executionStatus as PolymarketCopyKalshiMirrorOrder["executionStatus"],
    matchQuality: row.matchQuality as PolymarketCopyKalshiMirrorOrder["matchQuality"],
    kalshiSide: row.kalshiSide as PolymarketCopyKalshiMirrorOrder["kalshiSide"],
    orderAction: row.orderAction as PolymarketCopyKalshiMirrorOrder["orderAction"],
    metadata: row.metadataJson,
  };
}

function mapWorkerRun(row: typeof polymarketWorkerRuns.$inferSelect) {
  return {
    ...row,
    workerKey: row.workerKey as PolymarketCopyWorkerKey,
    cadence: row.cadence as "5m" | "15m" | null,
    status: row.status as PolymarketCopyRunStatus,
    details: row.detailsJson,
  };
}

function mapRuntimeConfig(row: typeof polymarketRuntimeConfigs.$inferSelect): PolymarketCopyRuntimeConfig {
  const { authEnvJson, ...rest } = row;
  return {
    ...rest,
    mode: row.mode as PolymarketCopyRuntimeConfig["mode"],
    dynamicSizingBasis: row.dynamicSizingBasis as PolymarketCopyRuntimeConfig["dynamicSizingBasis"],
    activeTradingCapitalMode: row.activeTradingCapitalMode as PolymarketCopyRuntimeConfig["activeTradingCapitalMode"],
    kalshiExecutionMode: row.kalshiExecutionMode as PolymarketCopyRuntimeConfig["kalshiExecutionMode"],
    authEnv: (authEnvJson ?? null) as AgentEnvConfig | null,
  };
}

function resolvePaperBaseline(options: {
  row: {
    createdAt: Date;
    details: Record<string, unknown> | null;
  } | null;
  runtimeConfig: PolymarketCopyRuntimeConfig;
}): PolymarketCopyPaperBaseline {
  const { row, runtimeConfig } = options;
  const details = row?.details ?? null;
  const startedAt = safeDate(details?.startedAt) ?? row?.createdAt ?? runtimeConfig.updatedAt;
  const label = typeof details?.label === "string" && details.label.trim().length > 0
    ? details.label
    : row
      ? "Paper test baseline"
      : "Runtime config baseline";
  const source = row ? "manual_marker" : "derived";
  const startingBankrollUsd = typeof details?.startingBankrollUsd === "number"
    ? details.startingBankrollUsd
    : runtimeConfig.paperStartingBankrollUsd;

  return {
    startedAt: startedAt ?? runtimeConfig.updatedAt,
    source,
    label,
    startingBankrollUsd,
  };
}

export function polymarketDashboardReporter(db: Db) {
  return {
    async get(companyId: string): Promise<Omit<PolymarketCopyDashboardData, "underlyingModel">> {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const [runtimeConfigRow] = await db
        .select()
        .from(polymarketRuntimeConfigs)
        .where(eq(polymarketRuntimeConfigs.companyId, companyId));

      const runtimeConfig = mapRuntimeConfig(runtimeConfigRow);

      const watchedWalletRows = await db
        .select()
        .from(polymarketWatchedWallets)
        .where(eq(polymarketWatchedWallets.companyId, companyId))
        .orderBy(polymarketWatchedWallets.status, polymarketWatchedWallets.currentRank);
      const watchedWallets = watchedWalletRows.map(mapWatchedWallet);

      const walletSelectionRunRows = await db
        .select()
        .from(polymarketWalletSelectionRuns)
        .where(eq(polymarketWalletSelectionRuns.companyId, companyId))
        .orderBy(desc(polymarketWalletSelectionRuns.startedAt))
        .limit(10);
      const walletSelectionRuns = walletSelectionRunRows.map(mapSelectionRun);

      const workerRunRows = await db
        .select()
        .from(polymarketWorkerRuns)
        .where(eq(polymarketWorkerRuns.companyId, companyId))
        .orderBy(desc(polymarketWorkerRuns.startedAt))
        .limit(30);
      const workerRuns = workerRunRows.map(mapWorkerRun);

      const signalRows = await db
        .select()
        .from(polymarketSignals)
        .where(eq(polymarketSignals.companyId, companyId))
        .orderBy(desc(polymarketSignals.createdAt))
        .limit(50);
      const signalIds = signalRows.map((signal) => signal.id);
      const decisionRows = signalIds.length > 0
        ? await db
          .select()
          .from(polymarketSignalDecisions)
          .where(and(
            eq(polymarketSignalDecisions.companyId, companyId),
            inArray(polymarketSignalDecisions.signalId, signalIds),
          ))
        : [];
      const decisionBySignalId = new Map(decisionRows.map((decision) => [decision.signalId, decision]));

      const allPaperTradeRows = await db
        .select()
        .from(polymarketPaperTrades)
        .where(eq(polymarketPaperTrades.companyId, companyId))
        .orderBy(desc(polymarketPaperTrades.lastUpdatedAt));
      const allPaperTrades = allPaperTradeRows.map(mapPaperTrade);

      const baselineRow = await db
        .select({
          createdAt: activityLog.createdAt,
          details: activityLog.details,
        })
        .from(activityLog)
        .where(and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.action, "polymarket.paper_baseline.set"),
        ))
        .orderBy(desc(activityLog.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      const baseline = resolvePaperBaseline({ row: baselineRow, runtimeConfig });
      const scopedPaperTrades = allPaperTrades.filter((trade) =>
        trade.openedAt >= baseline.startedAt || (trade.closedAt != null && trade.closedAt >= baseline.startedAt)
      );
      const paperTrades = scopedPaperTrades.slice(0, 50);
      const openTrades = scopedPaperTrades.filter((trade) => trade.status === "open");
      const closedTrades = scopedPaperTrades.filter((trade) => trade.status === "closed");

      const performanceSignalRows = await db
        .select()
        .from(polymarketSignals)
        .where(and(
          eq(polymarketSignals.companyId, companyId),
          gte(polymarketSignals.createdAt, baseline.startedAt),
        ))
        .orderBy(polymarketSignals.createdAt);
      const performanceSignals = performanceSignalRows.map(mapSignal);
      const signalsById = new Map(performanceSignals.map((signal) => [signal.id, signal] as const));

      const performanceDecisionRows = await db
        .select()
        .from(polymarketSignalDecisions)
        .where(and(
          eq(polymarketSignalDecisions.companyId, companyId),
          gte(polymarketSignalDecisions.createdAt, baseline.startedAt),
        ))
        .orderBy(polymarketSignalDecisions.createdAt);
      const performanceDecisions = performanceDecisionRows.map(mapSignalDecision);

      const paperTradeEventRows = await db
        .select()
        .from(polymarketPaperTradeEvents)
        .where(and(
          eq(polymarketPaperTradeEvents.companyId, companyId),
          gte(polymarketPaperTradeEvents.createdAt, baseline.startedAt),
        ))
        .orderBy(polymarketPaperTradeEvents.createdAt);
      const paperTradeEvents = paperTradeEventRows.map(mapPaperTradeEvent);

      const kalshiMirrorOrderRows = await db
        .select()
        .from(polymarketKalshiMirrorOrders)
        .where(and(
          eq(polymarketKalshiMirrorOrders.companyId, companyId),
          gte(polymarketKalshiMirrorOrders.createdAt, baseline.startedAt),
        ))
        .orderBy(desc(polymarketKalshiMirrorOrders.createdAt));
      const kalshiMirrorOrders = kalshiMirrorOrderRows.map(mapKalshiMirrorOrder);

      const activeTodayStart = todayStart.getTime() > baseline.startedAt.getTime() ? todayStart : baseline.startedAt;
      const todaySignals = performanceSignals.filter((signal) => signal.createdAt >= activeTodayStart);
      const todayDecisions = performanceDecisions.filter((decision) => decision.createdAt >= activeTodayStart);
      const lastSuccessful5m = workerRunRows.find((run) => run.workerKey === "polymarket-monitor-5m" && run.status === "success") ?? null;
      const lastSuccessful15m = workerRunRows.find((run) => run.workerKey === "polymarket-monitor-15m" && run.status === "success") ?? null;
      const last5mRun = workerRunRows.find((run) => run.workerKey === "polymarket-monitor-5m") ?? null;
      const last15mRun = workerRunRows.find((run) => run.workerKey === "polymarket-monitor-15m") ?? null;
      const thresholdFailures = todayDecisions.reduce<Map<string, number>>((acc, decision) => {
        acc.set(decision.reasonCode, (acc.get(decision.reasonCode) ?? 0) + 1);
        return acc;
      }, new Map());

      const auditLogRows = await db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          entityType: activityLog.entityType,
          entityId: activityLog.entityId,
          actorType: activityLog.actorType,
          actorId: activityLog.actorId,
          details: activityLog.details,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(and(
          eq(activityLog.companyId, companyId),
          ilike(activityLog.action, "polymarket.%"),
        ))
        .orderBy(desc(activityLog.createdAt))
        .limit(30);

      const authReadiness = await inspectPolymarketAuthReadiness(
        db,
        companyId,
        runtimeConfig,
        auditLogRows,
      );
      const kalshiReadiness = await inspectKalshiReadiness({
        db,
        companyId,
        runtimeConfig,
        signalSourceActive: runtimeConfig.monitor5mEnabled || runtimeConfig.monitor15mEnabled,
      });

      const [{ dailyRealizedLossUsd }] = await db
        .select({
          dailyRealizedLossUsd: sql<number>`coalesce(sum(case when ${polymarketPaperTrades.realizedPnlUsd} < 0 then ${polymarketPaperTrades.realizedPnlUsd} else 0 end), 0)`,
        })
        .from(polymarketPaperTrades)
        .where(and(
          eq(polymarketPaperTrades.companyId, companyId),
          gte(polymarketPaperTrades.lastUpdatedAt, activeTodayStart),
          gte(polymarketPaperTrades.openedAt, baseline.startedAt),
        ));

      const performanceSummary = buildPerformanceSummary({
        runtimeConfig,
        baseline,
        paperTrades: allPaperTrades,
        paperTradeEvents,
        mirrorOrders: kalshiMirrorOrders,
        signalsById,
        decisions: performanceDecisions,
        walletSelectionRuns,
        workerRuns,
        now,
      });

      return {
        companyId,
        runtimeConfig,
        overview: {
          mode: runtimeConfig.mode,
          liveEnabled: runtimeConfig.liveEnabled,
          tradingKillSwitch: runtimeConfig.tradingKillSwitch,
          watchedWalletCount: watchedWallets.filter((wallet) => wallet.status === "active").length,
          benchCount: watchedWallets.filter((wallet) => wallet.status === "bench").length,
          signalsToday: todaySignals.length,
          acceptedCount: todayDecisions.filter((decision) => decision.decision === "accepted").length,
          skippedCount: todayDecisions.filter((decision) => decision.decision === "skipped").length,
          blockedCount: todayDecisions.filter((decision) => decision.decision === "blocked").length,
          paperTradesOpen: openTrades.length,
          paperTradesClosed: closedTrades.length,
          realizedPnlUsd: performanceSummary.realizedPnlUsd,
          unrealizedPnlUsd: performanceSummary.unrealizedPnlUsd,
          lastSuccessful5mRun: lastSuccessful5m?.finishedAt ?? null,
          lastSuccessful15mRun: lastSuccessful15m?.finishedAt ?? null,
          workerHealth: {
            "wallet-selector-daily": workerHealth(
              workerRunRows.find((run) => run.workerKey === "wallet-selector-daily" && run.status === "success")?.finishedAt ?? null,
              workerRunRows.find((run) => run.workerKey === "wallet-selector-daily")?.status ?? null,
              26 * 60,
              now,
            ),
            "polymarket-monitor-5m": workerHealth(lastSuccessful5m?.finishedAt ?? null, last5mRun?.status ?? null, 12, now),
            "polymarket-monitor-15m": workerHealth(lastSuccessful15m?.finishedAt ?? null, last15mRun?.status ?? null, 35, now),
          },
        },
        performance: performanceSummary,
        walletSelectionRuns,
        watchedWallets,
        signals: signalRows.map((signal) => ({
          ...mapSignal(signal),
          decision: decisionBySignalId.get(signal.id) ? mapSignalDecision(decisionBySignalId.get(signal.id)!) : null,
        })),
        paperTrades,
        risk: {
          blockedSignals: todayDecisions
            .filter((decision) => decision.decision === "blocked")
            .slice(0, 20),
          thresholdFailures: [...thresholdFailures.entries()].map(([reasonCode, count]) => ({ reasonCode, count })),
          currentExposureUsd: performanceSummary.currentExposureUsd,
          dailyRealizedLossUsd: Number(dailyRealizedLossUsd ?? 0),
          killSwitch: runtimeConfig.tradingKillSwitch,
        },
        authReadiness,
        kalshiReadiness,
        kalshiMirrorOrders,
        workerRuns,
        auditLog: auditLogRows,
      };
    },
  };
}
