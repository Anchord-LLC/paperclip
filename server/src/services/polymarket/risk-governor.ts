import type {
  PolymarketCopyPaperTrade,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignal,
} from "@paperclipai/shared";
import { signalMetadata } from "./shared.js";
import {
  activeTradingCapitalUsd,
  currentOpenExposureUsd,
  currentWalletEquityUsd,
  exposurePct,
  isRiskIncreasingAction,
  marketExposureUsd,
  plannedSignalExposureUsd,
  walletExposureUsd,
} from "./runtime-math.js";

export interface RiskGovernorDecision {
  decision: "accepted" | "skipped" | "blocked";
  reasonCode: string;
  reasonDetail: string | null;
  snapshot: Record<string, unknown>;
}

export function evaluateRiskDecision(options: {
  config: PolymarketCopyRuntimeConfig;
  signal: PolymarketCopySignal;
  openTrades: PolymarketCopyPaperTrade[];
  totalRealizedPnlUsd: number;
  dailyRealizedLossUsd: number;
  now: Date;
}): RiskGovernorDecision {
  const { config, signal, openTrades, totalRealizedPnlUsd, dailyRealizedLossUsd, now } = options;
  const metadata = signalMetadata(signal);
  const totalOpenExposure = currentOpenExposureUsd(openTrades);
  const marketExposure = marketExposureUsd(openTrades, signal.marketId);
  const walletExposure = walletExposureUsd(openTrades, signal.sourceWalletAddress);
  const existingTrade = openTrades.find((trade) => (
    trade.sourceWalletAddress === signal.sourceWalletAddress
    && trade.marketId === signal.marketId
    && trade.side === (signal.side ?? "unknown")
  )) ?? null;
  const signalExposure = plannedSignalExposureUsd({
    config,
    signal,
    openTrades,
    totalRealizedPnlUsd,
    existingTrade,
  });
  const walletEquityUsd = currentWalletEquityUsd(config, totalRealizedPnlUsd, openTrades);
  const activeCapitalUsd = activeTradingCapitalUsd(config, totalRealizedPnlUsd, openTrades);
  const signalAgeMinutes =
    signal.sourceSnapshotTimestamp == null
      ? null
      : (now.getTime() - signal.sourceSnapshotTimestamp.getTime()) / 60_000;
  const spreadBps = typeof metadata.spreadBps === "number" ? metadata.spreadBps : null;
  const marketExposureCapUsd = activeCapitalUsd * (config.maxExposurePerMarketPct / 100);
  const walletExposureCapUsd = activeCapitalUsd * (config.maxExposurePerWalletPct / 100);
  const totalExposureCapUsd = activeCapitalUsd * (config.maxTotalOpenExposurePct / 100);

  const snapshot = {
    walletScore: signal.walletScore,
    minWalletScore: config.minWalletScore,
    materialityUsd: signal.materialityUsd,
    minSignalMateriality: config.minSignalMateriality,
    spreadBps,
    maxSpreadBps: config.maxSpreadBps,
    signalAgeMinutes,
    staleSignalThresholdMinutes: config.staleSignalThresholdMinutes,
    currentPaperBankrollUsd: walletEquityUsd,
    currentWalletEquityUsd: walletEquityUsd,
    activeTradingCapitalUsd: activeCapitalUsd,
    activeTradingCapitalCapUsd: config.activeTradingCapitalCapUsd,
    activeTradingCapitalMode: config.activeTradingCapitalMode,
    currentOpenExposureUsd: totalOpenExposure,
    currentOpenExposurePct: exposurePct(totalOpenExposure, activeCapitalUsd),
    marketExposureUsd: marketExposure,
    marketExposurePct: exposurePct(marketExposure, activeCapitalUsd),
    walletExposureUsd: walletExposure,
    walletExposurePct: exposurePct(walletExposure, activeCapitalUsd),
    projectedSignalExposureUsd: signalExposure,
    marketExposureCapUsd,
    walletExposureCapUsd,
    totalExposureCapUsd,
    maxExposurePerMarketPct: config.maxExposurePerMarketPct,
    maxExposurePerWalletPct: config.maxExposurePerWalletPct,
    maxTotalOpenExposurePct: config.maxTotalOpenExposurePct,
    openPositionCount: openTrades.length,
    maxOpenSimulatedPositions: config.maxOpenSimulatedPositions,
    dailyRealizedLossUsd,
    maxDailySimulatedLoss: config.maxDailySimulatedLoss,
  };

  if (signal.walletScore != null && signal.walletScore < config.minWalletScore) {
    return {
      decision: "skipped",
      reasonCode: "wallet_score_below_min",
      reasonDetail: "Source wallet score is below the configured threshold.",
      snapshot,
    };
  }

  if ((signal.materialityUsd ?? 0) < config.minSignalMateriality) {
    return {
      decision: "skipped",
      reasonCode: "signal_below_materiality",
      reasonDetail: "Signal size delta is too small for paper copying.",
      snapshot,
    };
  }

  if (signalAgeMinutes != null && signalAgeMinutes > config.staleSignalThresholdMinutes) {
    return {
      decision: "skipped",
      reasonCode: "signal_stale",
      reasonDetail: "Signal is older than the configured freshness window.",
      snapshot,
    };
  }

  if (spreadBps != null && spreadBps > config.maxSpreadBps) {
    return {
      decision: "blocked",
      reasonCode: "spread_above_max",
      reasonDetail: "Observed spread exceeds configured guardrail.",
      snapshot,
    };
  }

  if (activeCapitalUsd <= 0) {
    return {
      decision: "blocked",
      reasonCode: "paper_bankroll_depleted",
      reasonDetail: "Active trading capital is depleted, so new copy exposure is blocked.",
      snapshot,
    };
  }

  if (isRiskIncreasingAction(signal.action)) {
    if (marketExposure + signalExposure > marketExposureCapUsd) {
      return {
        decision: "blocked",
        reasonCode: "market_exposure_limit",
        reasonDetail: "Signal would exceed the per-market paper exposure cap.",
        snapshot,
      };
    }

    if (walletExposure + signalExposure > walletExposureCapUsd) {
      return {
        decision: "blocked",
        reasonCode: "wallet_exposure_limit",
        reasonDetail: "Signal would exceed the per-wallet paper exposure cap.",
        snapshot,
      };
    }

    if (totalOpenExposure + signalExposure > totalExposureCapUsd) {
      return {
        decision: "blocked",
        reasonCode: "total_exposure_limit",
        reasonDetail: "Signal would exceed the total open paper exposure cap.",
        snapshot,
      };
    }
  }

  if (
    isRiskIncreasingAction(signal.action)
    && openTrades.length >= config.maxOpenSimulatedPositions
  ) {
    return {
      decision: "blocked",
      reasonCode: "max_open_positions_reached",
      reasonDetail: "Open paper position limit has been reached.",
      snapshot,
    };
  }

  if (Math.abs(Math.min(0, dailyRealizedLossUsd)) >= config.maxDailySimulatedLoss) {
    return {
      decision: "blocked",
      reasonCode: "max_daily_loss_reached",
      reasonDetail: "Daily simulated loss cap has been breached.",
      snapshot,
    };
  }

  return {
    decision: "accepted",
    reasonCode: "accepted",
    reasonDetail: null,
    snapshot,
  };
}
