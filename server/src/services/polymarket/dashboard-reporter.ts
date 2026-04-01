import { and, desc, eq, gte, ilike, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
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
  PolymarketCopyPaperTradeStatus,
  PolymarketCopyPaperTrade,
  PolymarketCopyRunStatus,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignalAction,
  PolymarketCopySignalDecision,
  PolymarketCopyWalletStatus,
  PolymarketCopyWorkerKey,
} from "@paperclipai/shared";
import { inspectPolymarketAuthReadiness } from "./auth-readiness.js";

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
    authEnv: (authEnvJson ?? null) as AgentEnvConfig | null,
  };
}

export function polymarketDashboardReporter(db: Db) {
  return {
    async get(companyId: string): Promise<Omit<PolymarketCopyDashboardData, "underlyingModel">> {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const [runtimeConfig] = await db
        .select()
        .from(polymarketRuntimeConfigs)
        .where(eq(polymarketRuntimeConfigs.companyId, companyId));

      const watchedWallets = await db
        .select()
        .from(polymarketWatchedWallets)
        .where(eq(polymarketWatchedWallets.companyId, companyId))
        .orderBy(polymarketWatchedWallets.status, polymarketWatchedWallets.currentRank);

      const walletSelectionRuns = await db
        .select()
        .from(polymarketWalletSelectionRuns)
        .where(eq(polymarketWalletSelectionRuns.companyId, companyId))
        .orderBy(desc(polymarketWalletSelectionRuns.startedAt))
        .limit(10);

      const workerRuns = await db
        .select()
        .from(polymarketWorkerRuns)
        .where(eq(polymarketWorkerRuns.companyId, companyId))
        .orderBy(desc(polymarketWorkerRuns.startedAt))
        .limit(20);

      const signalRows = await db
        .select()
        .from(polymarketSignals)
        .where(eq(polymarketSignals.companyId, companyId))
        .orderBy(desc(polymarketSignals.createdAt))
        .limit(50);

      const signalIds = signalRows.map((signal) => signal.id);
      const decisions = signalIds.length > 0
        ? await db
          .select()
          .from(polymarketSignalDecisions)
          .where(and(
            eq(polymarketSignalDecisions.companyId, companyId),
            inArray(polymarketSignalDecisions.signalId, signalIds),
          ))
        : [];
      const decisionBySignalId = new Map(decisions.map((decision) => [decision.signalId, decision]));

      const paperTradeRows = await db
        .select()
        .from(polymarketPaperTrades)
        .where(eq(polymarketPaperTrades.companyId, companyId))
        .orderBy(desc(polymarketPaperTrades.lastUpdatedAt))
        .limit(50);
      const paperTrades = paperTradeRows.map(mapPaperTrade);

      const todaySignals = signalRows.filter((signal) => signal.createdAt >= todayStart);
      const todayDecisions = decisions.filter((decision) => decision.createdAt >= todayStart);
      const lastSuccessful5m = workerRuns.find((run) => run.workerKey === "polymarket-monitor-5m" && run.status === "success") ?? null;
      const lastSuccessful15m = workerRuns.find((run) => run.workerKey === "polymarket-monitor-15m" && run.status === "success") ?? null;
      const last5mRun = workerRuns.find((run) => run.workerKey === "polymarket-monitor-5m") ?? null;
      const last15mRun = workerRuns.find((run) => run.workerKey === "polymarket-monitor-15m") ?? null;
      const openTrades = paperTrades.filter((trade) => trade.status === "open");
      const closedTrades = paperTrades.filter((trade) => trade.status === "closed");
      const thresholdFailures = todayDecisions.reduce<Map<string, number>>((acc, decision) => {
        acc.set(decision.reasonCode, (acc.get(decision.reasonCode) ?? 0) + 1);
        return acc;
      }, new Map());

      const auditLog = await db
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
        mapRuntimeConfig(runtimeConfig),
        auditLog,
      );

      const [{ dailyRealizedLossUsd }] = await db
        .select({
          dailyRealizedLossUsd: sql<number>`coalesce(sum(case when ${polymarketPaperTrades.realizedPnlUsd} < 0 then ${polymarketPaperTrades.realizedPnlUsd} else 0 end), 0)`,
        })
        .from(polymarketPaperTrades)
        .where(and(
          eq(polymarketPaperTrades.companyId, companyId),
          gte(polymarketPaperTrades.lastUpdatedAt, todayStart),
        ));

      return {
        companyId,
        runtimeConfig: mapRuntimeConfig(runtimeConfig),
        overview: {
          mode: runtimeConfig.mode as PolymarketCopyRuntimeConfig["mode"],
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
          realizedPnlUsd: paperTrades.reduce((sum, trade) => sum + trade.realizedPnlUsd, 0),
          unrealizedPnlUsd: openTrades.reduce((sum, trade) => sum + trade.unrealizedPnlUsd, 0),
          lastSuccessful5mRun: lastSuccessful5m?.finishedAt ?? null,
          lastSuccessful15mRun: lastSuccessful15m?.finishedAt ?? null,
          workerHealth: {
            "wallet-selector-daily": workerHealth(
              workerRuns.find((run) => run.workerKey === "wallet-selector-daily" && run.status === "success")?.finishedAt ?? null,
              workerRuns.find((run) => run.workerKey === "wallet-selector-daily")?.status ?? null,
              26 * 60,
              now,
            ),
            "polymarket-monitor-5m": workerHealth(lastSuccessful5m?.finishedAt ?? null, last5mRun?.status ?? null, 12, now),
            "polymarket-monitor-15m": workerHealth(lastSuccessful15m?.finishedAt ?? null, last15mRun?.status ?? null, 35, now),
          },
        },
        walletSelectionRuns: walletSelectionRuns.map(mapSelectionRun),
        watchedWallets: watchedWallets.map(mapWatchedWallet),
        signals: signalRows.map((signal) => ({
          ...mapSignal(signal),
          decision: decisionBySignalId.get(signal.id) ? mapSignalDecision(decisionBySignalId.get(signal.id)!) : null,
        })),
        paperTrades,
        risk: {
          blockedSignals: todaySignals
            .map((signal) => decisionBySignalId.get(signal.id))
            .filter((decision): decision is NonNullable<typeof decision> => decision?.decision === "blocked")
            .map(mapSignalDecision)
            .slice(0, 20),
          thresholdFailures: [...thresholdFailures.entries()].map(([reasonCode, count]) => ({ reasonCode, count })),
          currentExposureUsd: openTrades.reduce((sum, trade) => sum + trade.notionalUsd, 0),
          dailyRealizedLossUsd: Number(dailyRealizedLossUsd ?? 0),
          killSwitch: runtimeConfig.tradingKillSwitch,
        },
        authReadiness,
        workerRuns: workerRuns.map(mapWorkerRun),
        auditLog,
      };
    },
  };
}
