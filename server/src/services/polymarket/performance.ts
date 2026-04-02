import type {
  PolymarketCopyAutomationState,
  PolymarketCopyKalshiMirrorOrder,
  PolymarketCopyPaperBaseline,
  PolymarketCopyPaperTrade,
  PolymarketCopyPaperTradeEvent,
  PolymarketCopyPerformanceBar,
  PolymarketCopyPerformanceSummary,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignal,
  PolymarketCopySignalDecisionRecord,
  PolymarketCopyWalletSelectionRun,
  PolymarketCopyWorkerRun,
} from "@paperclipai/shared";
import {
  activeTradingCapitalUsd,
  availablePaperCashPct,
  availablePaperCashUsd,
  currentOpenExposureUsd,
  currentWalletEquityUsd,
  exposurePct,
  marketExposureUsd,
  sweepableProfitUsd,
  walletExposureUsd,
} from "./runtime-math.js";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function topBars(entries: Iterable<[string, number]>, limit: number): PolymarketCopyPerformanceBar[] {
  return [...entries]
    .map(([label, valueUsd]) => ({ label, valueUsd: round2(valueUsd) }))
    .sort((left, right) => Math.abs(right.valueUsd) - Math.abs(left.valueUsd))
    .slice(0, limit);
}

function buildAutomationState(options: {
  runtimeConfig: PolymarketCopyRuntimeConfig;
  walletSelectionRuns: PolymarketCopyWalletSelectionRun[];
  workerRuns: PolymarketCopyWorkerRun[];
}): PolymarketCopyAutomationState {
  const { runtimeConfig, walletSelectionRuns, workerRuns } = options;
  const latestWalletSelectionRun = walletSelectionRuns[0] ?? null;
  const latestSuccessfulWalletSelectionRun = walletSelectionRuns.find((run) => run.status === "success") ?? null;
  const latestSuccessful5mRun = workerRuns.find((run) => run.workerKey === "polymarket-monitor-5m" && run.status === "success") ?? null;
  const latestSuccessful15mRun = workerRuns.find((run) => run.workerKey === "polymarket-monitor-15m" && run.status === "success") ?? null;

  return {
    walletSelectorAutoRunActive: runtimeConfig.walletSelectionEnabled,
    walletSelectorSchedule: `${runtimeConfig.walletSelectionTimeZone} ${String(runtimeConfig.walletSelectionHour).padStart(2, "0")}:${String(runtimeConfig.walletSelectionMinute).padStart(2, "0")}`,
    latestWalletSelectionRun: latestWalletSelectionRun?.finishedAt ?? latestWalletSelectionRun?.startedAt ?? null,
    latestSuccessfulWalletSelectionRun: latestSuccessfulWalletSelectionRun?.finishedAt ?? null,
    monitor5mAutoRunActive: runtimeConfig.monitor5mEnabled,
    monitor15mAutoRunActive: runtimeConfig.monitor15mEnabled,
    latestSuccessful5mRun: latestSuccessful5mRun?.finishedAt ?? null,
    latestSuccessful15mRun: latestSuccessful15mRun?.finishedAt ?? null,
  };
}

export function buildPerformanceSummary(options: {
  runtimeConfig: PolymarketCopyRuntimeConfig;
  baseline: PolymarketCopyPaperBaseline;
  paperTrades: PolymarketCopyPaperTrade[];
  paperTradeEvents: PolymarketCopyPaperTradeEvent[];
  mirrorOrders: PolymarketCopyKalshiMirrorOrder[];
  signalsById: Map<string, PolymarketCopySignal>;
  decisions: PolymarketCopySignalDecisionRecord[];
  walletSelectionRuns: PolymarketCopyWalletSelectionRun[];
  workerRuns: PolymarketCopyWorkerRun[];
  now: Date;
}): PolymarketCopyPerformanceSummary {
  const { runtimeConfig, baseline, paperTrades, paperTradeEvents, mirrorOrders, signalsById, decisions, walletSelectionRuns, workerRuns, now } = options;
  const allOpenTrades = paperTrades.filter((trade) => trade.status === "open");
  const automation = buildAutomationState({ runtimeConfig, walletSelectionRuns, workerRuns });

  const startedAt = baseline.startedAt;
  const baselineRuntimeConfig = {
    ...runtimeConfig,
    paperStartingBankrollUsd: baseline.startingBankrollUsd,
  };
  const eligibleTradeIds = new Set(
    paperTrades
      .filter((trade) => trade.openedAt >= startedAt)
      .map((trade) => trade.id),
  );
  const eventsSinceBaseline = paperTradeEvents
    .filter((event) => event.createdAt >= startedAt && eligibleTradeIds.has(event.paperTradeId))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const decisionsSinceBaseline = decisions.filter((decision) => decision.createdAt >= startedAt);
  const mirrorOrdersSinceBaseline = mirrorOrders.filter((order) => order.createdAt >= startedAt);
  const tradesSinceBaseline = paperTrades.filter((trade) => trade.openedAt >= startedAt || (trade.closedAt != null && trade.closedAt >= startedAt));
  const openTradesSinceBaseline = allOpenTrades.filter((trade) => trade.openedAt >= startedAt);
  const baselineRealizedPnlUsd = tradesSinceBaseline.reduce((sum, trade) => sum + trade.realizedPnlUsd, 0);
  const currentExposureUsd = currentOpenExposureUsd(openTradesSinceBaseline);
  const walletEquityUsd = currentWalletEquityUsd(
    baselineRuntimeConfig,
    baselineRealizedPnlUsd,
    openTradesSinceBaseline,
  );
  const activeCapitalUsd = activeTradingCapitalUsd(
    baselineRuntimeConfig,
    baselineRealizedPnlUsd,
    openTradesSinceBaseline,
  );
  const availableCashUsd = availablePaperCashUsd(
    baselineRuntimeConfig,
    baselineRealizedPnlUsd,
    openTradesSinceBaseline,
  );
  const currentAvailableCashPct = availablePaperCashPct(
    baselineRuntimeConfig,
    baselineRealizedPnlUsd,
    openTradesSinceBaseline,
  );
  const capitalProgressPct = baselineRuntimeConfig.activeTradingCapitalCapUsd > 0
    ? Math.max(0, Math.min(100, (walletEquityUsd / baselineRuntimeConfig.activeTradingCapitalCapUsd) * 100))
    : 0;
  const trailing30dWindowStart = new Date(Math.max(startedAt.getTime(), now.getTime() - (30 * 24 * 60 * 60 * 1000)));
  const trailing30dRealizedPnlUsd = eventsSinceBaseline
    .filter((event) => event.createdAt >= trailing30dWindowStart)
    .reduce((sum, event) => sum + (event.realizedPnlUsd ?? 0), 0);
  const targetGapUsd = Math.max(0, runtimeConfig.monthlyTargetUsd - trailing30dRealizedPnlUsd);
  const targetAchieved = trailing30dRealizedPnlUsd >= runtimeConfig.monthlyTargetUsd;
  const targetProgressPct = runtimeConfig.monthlyTargetUsd > 0
    ? Math.max(0, Math.min(100, (trailing30dRealizedPnlUsd / runtimeConfig.monthlyTargetUsd) * 100))
    : 0;
  const sweepableProfit = sweepableProfitUsd(
    baselineRuntimeConfig,
    baselineRealizedPnlUsd,
    openTradesSinceBaseline,
  );
  const sourceSignalCount = signalsById.size;
  const kalshiMatchCount = mirrorOrdersSinceBaseline.filter((order) => order.matchStatus === "matched").length;
  const kalshiRejectedMatchCount = mirrorOrdersSinceBaseline.filter((order) => order.matchStatus === "rejected").length;
  const dryRunMirroredOrders = mirrorOrdersSinceBaseline.filter((order) => order.executionStatus === "dry_run_recorded").length;
  const mirroredNotionalByKalshiMarket = mirrorOrdersSinceBaseline.reduce<Map<string, number>>((acc, order) => {
    if (order.matchStatus !== "matched") return acc;
    const label = order.kalshiMarketTitle ?? order.kalshiMarketTicker ?? "Unmatched Kalshi market";
    const value = order.notionalUsd ?? 0;
    acc.set(label, (acc.get(label) ?? 0) + value);
    return acc;
  }, new Map());

  const unrealizedByTrade = new Map<string, number>();
  const equityCurve = [{
    label: baseline.label,
    timestamp: baseline.startedAt,
    equityUsd: round2(baseline.startingBankrollUsd),
  }];
  const dailyPnl = new Map<string, number>();
  const realizedByWallet = new Map<string, number>();
  const realizedByBot = new Map<string, number>();

  let cumulativeRealized = 0;
  let cumulativeUnrealized = 0;

  for (const event of eventsSinceBaseline) {
    const previousUnrealized = unrealizedByTrade.get(event.paperTradeId) ?? 0;
    const nextUnrealized = event.unrealizedPnlUsd ?? previousUnrealized;
    unrealizedByTrade.set(event.paperTradeId, nextUnrealized);
    cumulativeUnrealized += nextUnrealized - previousUnrealized;
    cumulativeRealized += event.realizedPnlUsd ?? 0;

    const trade = paperTrades.find((item) => item.id === event.paperTradeId) ?? null;
    const signal = event.signalId ? signalsById.get(event.signalId) ?? null : null;
    const day = dayKey(event.createdAt);
    const deltaPnl = (event.realizedPnlUsd ?? 0) + (nextUnrealized - previousUnrealized);
    dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + deltaPnl);

    if (trade) {
      realizedByWallet.set(trade.sourceWalletAddress, (realizedByWallet.get(trade.sourceWalletAddress) ?? 0) + (event.realizedPnlUsd ?? 0));
    }
    if (signal) {
      realizedByBot.set(signal.cadence, (realizedByBot.get(signal.cadence) ?? 0) + (event.realizedPnlUsd ?? 0));
    }

    equityCurve.push({
      label: day,
      timestamp: event.createdAt,
      equityUsd: round2(baseline.startingBankrollUsd + cumulativeRealized + cumulativeUnrealized),
    });
  }

  const unrealizedByWallet = new Map<string, number>();
  const unrealizedByBot = new Map<string, number>();
  for (const trade of openTradesSinceBaseline) {
    unrealizedByWallet.set(trade.sourceWalletAddress, (unrealizedByWallet.get(trade.sourceWalletAddress) ?? 0) + trade.unrealizedPnlUsd);
    const signal = trade.signalId ? signalsById.get(trade.signalId) ?? null : null;
    if (signal) {
      unrealizedByBot.set(signal.cadence, (unrealizedByBot.get(signal.cadence) ?? 0) + trade.unrealizedPnlUsd);
    }
  }

  const pnlByWallet = new Map<string, number>();
  for (const [label, value] of realizedByWallet.entries()) pnlByWallet.set(label, (pnlByWallet.get(label) ?? 0) + value);
  for (const [label, value] of unrealizedByWallet.entries()) pnlByWallet.set(label, (pnlByWallet.get(label) ?? 0) + value);

  const pnlByBot = new Map<string, number>();
  for (const [label, value] of realizedByBot.entries()) pnlByBot.set(label, (pnlByBot.get(label) ?? 0) + value);
  for (const [label, value] of unrealizedByBot.entries()) pnlByBot.set(label, (pnlByBot.get(label) ?? 0) + value);

  const exposureByWalletMap = new Map<string, number>();
  for (const trade of openTradesSinceBaseline) {
    exposureByWalletMap.set(trade.sourceWalletAddress, walletExposureUsd(openTradesSinceBaseline, trade.sourceWalletAddress));
  }
  const exposureByWallet = topBars(exposureByWalletMap.entries(), 6);

  const exposureByMarketMap = new Map<string, number>();
  for (const trade of openTradesSinceBaseline) {
    exposureByMarketMap.set(trade.marketTitle || trade.marketId, marketExposureUsd(openTradesSinceBaseline, trade.marketId));
  }
  const exposureByMarket = topBars(exposureByMarketMap.entries(), 6);

  const reasonCounts = decisionsSinceBaseline.reduce<Map<string, number>>((acc, decision) => {
    if (decision.reasonCode === "accepted") return acc;
    acc.set(decision.reasonCode, (acc.get(decision.reasonCode) ?? 0) + 1);
    return acc;
  }, new Map());

  const completedTrades = tradesSinceBaseline.filter((trade) => trade.closedAt != null);
  const holdMinutes = completedTrades
    .map((trade) => trade.closedAt == null ? null : (trade.closedAt.getTime() - trade.openedAt.getTime()) / 60_000)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const tradePerformance = tradesSinceBaseline
    .map((trade) => ({
      label: trade.marketTitle || trade.marketId,
      walletAddress: trade.sourceWalletAddress,
      marketTitle: trade.marketTitle || trade.marketId,
      pnlUsd: round2(trade.realizedPnlUsd + (trade.status === "open" ? trade.unrealizedPnlUsd : 0)),
      holdMinutes: trade.closedAt == null ? null : round2((trade.closedAt.getTime() - trade.openedAt.getTime()) / 60_000),
    }))
    .sort((left, right) => right.pnlUsd - left.pnlUsd);

  const closedWinningTrades = completedTrades.filter((trade) => trade.realizedPnlUsd > 0).length;
  const currentDayStart = startOfUtcDay(now);
  const todayPnlUsd = eventsSinceBaseline
    .filter((event) => event.createdAt >= currentDayStart)
    .reduce((sum, event) => sum + (event.realizedPnlUsd ?? 0), 0);

  const bestWallet = topBars(pnlByWallet.entries(), 1)[0] ?? null;
  const worstWallet = [...topBars(pnlByWallet.entries(), 12)]
    .sort((left, right) => left.valueUsd - right.valueUsd)[0] ?? null;
  const bot5m = pnlByBot.get("5m") ?? 0;
  const bot15m = pnlByBot.get("15m") ?? 0;

  const concentrationWarnings: string[] = [];
  for (const item of exposureByWallet) {
    const pct = exposurePct(item.valueUsd, activeCapitalUsd);
    if (pct >= runtimeConfig.maxExposurePerWalletPct * 0.8) {
      concentrationWarnings.push(`${item.label} is carrying ${round2(pct)}% of active trading capital exposure.`);
    }
  }
  for (const item of exposureByMarket) {
    const pct = exposurePct(item.valueUsd, activeCapitalUsd);
    if (pct >= runtimeConfig.maxExposurePerMarketPct * 0.8) {
      concentrationWarnings.push(`${item.label} is carrying ${round2(pct)}% of active trading capital exposure.`);
    }
  }

  return {
    baseline,
    totalPnlUsd: round2(cumulativeRealized + openTradesSinceBaseline.reduce((sum, trade) => sum + trade.unrealizedPnlUsd, 0)),
    todayPnlUsd: round2(todayPnlUsd),
    realizedPnlUsd: round2(cumulativeRealized),
    unrealizedPnlUsd: round2(openTradesSinceBaseline.reduce((sum, trade) => sum + trade.unrealizedPnlUsd, 0)),
    winRatePct: completedTrades.length > 0 ? round2((closedWinningTrades / completedTrades.length) * 100) : 0,
    currentWalletEquityUsd: round2(walletEquityUsd),
    activeTradingCapitalUsd: round2(activeCapitalUsd),
    capitalCapUsd: round2(runtimeConfig.activeTradingCapitalCapUsd),
    capitalProgressPct: round2(capitalProgressPct),
    currentExposurePct: round2(exposurePct(currentExposureUsd, activeCapitalUsd)),
    availablePaperCashPct: round2(currentAvailableCashPct),
    activeOpenPositions: openTradesSinceBaseline.length,
    currentExposureUsd: round2(currentExposureUsd),
    availablePaperCashUsd: round2(availableCashUsd),
    currentPaperBankrollUsd: round2(walletEquityUsd),
    trailing30dRealizedPnlUsd: round2(trailing30dRealizedPnlUsd),
    monthlyTargetUsd: round2(runtimeConfig.monthlyTargetUsd),
    targetGapUsd: round2(targetGapUsd),
    targetAchieved,
    targetProgressPct: round2(targetProgressPct),
    profitSweepReserveUsd: round2(runtimeConfig.profitSweepReserveUsd),
    sweepableProfitUsd: round2(sweepableProfit),
    activeTradingCapitalMode: runtimeConfig.activeTradingCapitalMode,
    sourceSignalCount,
    kalshiMatchCount,
    kalshiRejectedMatchCount,
    dryRunMirroredOrders,
    topKalshiMarkets: topBars(mirroredNotionalByKalshiMarket.entries(), 6),
    equityCurve,
    dailyPnl: [...dailyPnl.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-14)
      .map(([label, valueUsd]) => ({ label, valueUsd: round2(valueUsd) })),
    pnlByWallet: topBars(pnlByWallet.entries(), 8),
    pnlByBot: topBars(pnlByBot.entries(), 4),
    exposureByWallet,
    exposureByMarket,
    decisionReasons: [...reasonCounts.entries()].map(([reasonCode, count]) => ({ reasonCode, count })).sort((left, right) => right.count - left.count),
    insights: {
      bestWallet,
      worstWallet,
      bestTrade: tradePerformance[0] ?? null,
      worstTrade: tradePerformance.length > 0 ? tradePerformance[tradePerformance.length - 1] : null,
      averageHoldMinutes: holdMinutes.length > 0 ? round2(holdMinutes.reduce((sum, value) => sum + value, 0) / holdMinutes.length) : null,
      concentrationWarnings,
      botLeader: bot5m === 0 && bot15m === 0 ? "insufficient_data" : bot5m === bot15m ? "tie" : bot5m > bot15m ? "5m" : "15m",
    },
    automation,
  };
}
