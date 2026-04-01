import type {
  PolymarketCopyPaperTrade,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignal,
} from "@paperclipai/shared";
import { exposureForSignal, signalMetadata } from "./shared.js";

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
  dailyRealizedLossUsd: number;
  now: Date;
}): RiskGovernorDecision {
  const { config, signal, openTrades, dailyRealizedLossUsd, now } = options;
  const metadata = signalMetadata(signal);
  const totalOpenExposure = openTrades.reduce((sum, trade) => sum + Math.max(0, trade.notionalUsd), 0);
  const marketExposure = openTrades
    .filter((trade) => trade.marketId === signal.marketId)
    .reduce((sum, trade) => sum + Math.max(0, trade.notionalUsd), 0);
  const signalExposure = exposureForSignal(signal);
  const signalAgeMinutes =
    signal.sourceSnapshotTimestamp == null
      ? null
      : (now.getTime() - signal.sourceSnapshotTimestamp.getTime()) / 60_000;
  const spreadBps = typeof metadata.spreadBps === "number" ? metadata.spreadBps : null;

  const snapshot = {
    walletScore: signal.walletScore,
    minWalletScore: config.minWalletScore,
    materialityUsd: signal.materialityUsd,
    minSignalMateriality: config.minSignalMateriality,
    spreadBps,
    maxSpreadBps: config.maxSpreadBps,
    signalAgeMinutes,
    staleSignalThresholdMinutes: config.staleSignalThresholdMinutes,
    marketExposure,
    maxExposurePerMarket: config.maxExposurePerMarket,
    totalOpenExposure,
    maxTotalOpenPaperExposure: config.maxTotalOpenPaperExposure,
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

  if (marketExposure + signalExposure > config.maxExposurePerMarket) {
    return {
      decision: "blocked",
      reasonCode: "market_exposure_limit",
      reasonDetail: "Signal would exceed max exposure for this market.",
      snapshot,
    };
  }

  if (totalOpenExposure + signalExposure > config.maxTotalOpenPaperExposure) {
    return {
      decision: "blocked",
      reasonCode: "total_exposure_limit",
      reasonDetail: "Signal would exceed max total open paper exposure.",
      snapshot,
    };
  }

  if (
    signal.action !== "reduced_position" &&
    signal.action !== "closed_position" &&
    openTrades.length >= config.maxOpenSimulatedPositions
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
