import type {
  PolymarketCopyPaperTrade,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignal,
} from "@paperclipai/shared";
import { signalMetadata } from "./shared.js";

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isRiskIncreasingAction(action: PolymarketCopySignal["action"]): boolean {
  return action === "new_position" || action === "increased_position";
}

export function currentOpenExposureUsd(openTrades: PolymarketCopyPaperTrade[]): number {
  return openTrades.reduce((sum, trade) => sum + Math.max(0, trade.notionalUsd), 0);
}

export function currentWalletEquityUsd(
  config: Pick<PolymarketCopyRuntimeConfig, "paperStartingBankrollUsd">,
  totalRealizedPnlUsd: number,
  openTrades: PolymarketCopyPaperTrade[],
): number {
  const unrealizedPnlUsd = openTrades.reduce((sum, trade) => sum + trade.unrealizedPnlUsd, 0);
  return Math.max(0, config.paperStartingBankrollUsd + totalRealizedPnlUsd + unrealizedPnlUsd);
}

export function currentPaperBankrollUsd(
  config: Pick<PolymarketCopyRuntimeConfig, "paperStartingBankrollUsd">,
  totalRealizedPnlUsd: number,
  openTrades: PolymarketCopyPaperTrade[],
): number {
  return currentWalletEquityUsd(config, totalRealizedPnlUsd, openTrades);
}

export function activeTradingCapitalUsd(
  config: Pick<PolymarketCopyRuntimeConfig, "paperStartingBankrollUsd" | "activeTradingCapitalMode" | "activeTradingCapitalCapUsd">,
  totalRealizedPnlUsd: number,
  openTrades: PolymarketCopyPaperTrade[],
): number {
  const walletEquityUsd = currentWalletEquityUsd(config, totalRealizedPnlUsd, openTrades);
  if (config.activeTradingCapitalMode === "capped_equity") {
    return Math.max(0, Math.min(walletEquityUsd, config.activeTradingCapitalCapUsd));
  }
  return Math.max(0, walletEquityUsd);
}

export function sweepableProfitUsd(
  config: Pick<
    PolymarketCopyRuntimeConfig,
    "paperStartingBankrollUsd" | "activeTradingCapitalMode" | "activeTradingCapitalCapUsd" | "profitSweepReserveUsd"
  >,
  totalRealizedPnlUsd: number,
  openTrades: PolymarketCopyPaperTrade[],
): number {
  const walletEquityUsd = currentWalletEquityUsd(config, totalRealizedPnlUsd, openTrades);
  const capitalCapUsd =
    config.activeTradingCapitalMode === "capped_equity"
      ? config.activeTradingCapitalCapUsd
      : walletEquityUsd;
  return Math.max(0, walletEquityUsd - capitalCapUsd - config.profitSweepReserveUsd);
}

export function exposurePct(exposureUsd: number, bankrollUsd: number): number {
  if (!Number.isFinite(bankrollUsd) || bankrollUsd <= 0) return 0;
  return (Math.max(0, exposureUsd) / bankrollUsd) * 100;
}

export function currentExposurePct(
  config: Pick<PolymarketCopyRuntimeConfig, "paperStartingBankrollUsd" | "activeTradingCapitalMode" | "activeTradingCapitalCapUsd">,
  totalRealizedPnlUsd: number,
  openTrades: PolymarketCopyPaperTrade[],
): number {
  return exposurePct(
    currentOpenExposureUsd(openTrades),
    activeTradingCapitalUsd(config, totalRealizedPnlUsd, openTrades),
  );
}

export function availablePaperCashUsd(
  config: Pick<PolymarketCopyRuntimeConfig, "paperStartingBankrollUsd" | "activeTradingCapitalMode" | "activeTradingCapitalCapUsd">,
  totalRealizedPnlUsd: number,
  openTrades: PolymarketCopyPaperTrade[],
): number {
  const capitalUsd = activeTradingCapitalUsd(config, totalRealizedPnlUsd, openTrades);
  return Math.max(0, capitalUsd - currentOpenExposureUsd(openTrades));
}

export function availablePaperCashPct(
  config: Pick<PolymarketCopyRuntimeConfig, "paperStartingBankrollUsd" | "activeTradingCapitalMode" | "activeTradingCapitalCapUsd">,
  totalRealizedPnlUsd: number,
  openTrades: PolymarketCopyPaperTrade[],
): number {
  const capitalUsd = activeTradingCapitalUsd(config, totalRealizedPnlUsd, openTrades);
  return exposurePct(
    availablePaperCashUsd(config, totalRealizedPnlUsd, openTrades),
    capitalUsd,
  );
}

export function walletExposureUsd(openTrades: PolymarketCopyPaperTrade[], walletAddress: string): number {
  return openTrades
    .filter((trade) => trade.sourceWalletAddress === walletAddress)
    .reduce((sum, trade) => sum + Math.max(0, trade.notionalUsd), 0);
}

export function marketExposureUsd(openTrades: PolymarketCopyPaperTrade[], marketId: string): number {
  return openTrades
    .filter((trade) => trade.marketId === marketId)
    .reduce((sum, trade) => sum + Math.max(0, trade.notionalUsd), 0);
}

export function resolveSignalPricing(signal: PolymarketCopySignal): {
  markPrice: number | null;
  sourceNotionalUsd: number;
  sourceDelta: number;
} {
  const metadata = signalMetadata(signal);
  const markPrice = toFiniteNumber(metadata.currentPrice) ?? null;
  const sourceDelta = Math.abs(signal.sizeDelta ?? signal.currentSize ?? 0);
  const sourceNotionalUsd = Math.max(
    1,
    toFiniteNumber(metadata.sourceNotionalUsd)
      ?? toFiniteNumber(metadata.currentValue)
      ?? (signal.currentSize != null && markPrice != null ? Math.abs(signal.currentSize) * markPrice : sourceDelta * (markPrice ?? 1)),
  );

  return {
    markPrice,
    sourceNotionalUsd,
    sourceDelta,
  };
}

export interface NewTradeSizingPlan {
  currentPaperBankrollUsd: number;
  currentWalletEquityUsd: number;
  activeTradingCapitalUsd: number;
  currentExposurePct: number;
  effectiveTradeSizePct: number;
  sourceNotionalUsd: number;
  targetNotionalUsd: number;
  markPrice: number;
}

export function planNewTradeSizing(options: {
  config: Pick<
    PolymarketCopyRuntimeConfig,
    | "paperStartingBankrollUsd"
    | "activeTradingCapitalMode"
    | "activeTradingCapitalCapUsd"
    | "minTradeSizePct"
    | "maxTradeSizePct"
    | "maxTotalOpenExposurePct"
    | "dynamicSizing"
    | "dynamicSizingBasis"
  >;
  signal: PolymarketCopySignal;
  openTrades: PolymarketCopyPaperTrade[];
  totalRealizedPnlUsd: number;
}): NewTradeSizingPlan | null {
  const { config, signal, openTrades, totalRealizedPnlUsd } = options;
  const pricing = resolveSignalPricing(signal);
  if (pricing.markPrice == null || pricing.markPrice <= 0) return null;

  const walletEquityUsd = currentWalletEquityUsd(config, totalRealizedPnlUsd, openTrades);
  const activeCapitalUsd = activeTradingCapitalUsd(config, totalRealizedPnlUsd, openTrades);
  const openExposurePct = exposurePct(currentOpenExposureUsd(openTrades), activeCapitalUsd);
  let effectiveTradeSizePct = config.maxTradeSizePct;

  if (config.dynamicSizing && config.dynamicSizingBasis === "current_exposure") {
    const maxExposurePct = Math.max(config.maxTotalOpenExposurePct, 0.01);
    const utilization = clamp(openExposurePct / maxExposurePct, 0, 1);
    effectiveTradeSizePct =
      config.maxTradeSizePct - ((config.maxTradeSizePct - config.minTradeSizePct) * utilization);
  }

  effectiveTradeSizePct = clamp(effectiveTradeSizePct, config.minTradeSizePct, config.maxTradeSizePct);

  return {
    currentPaperBankrollUsd: walletEquityUsd,
    currentWalletEquityUsd: walletEquityUsd,
    activeTradingCapitalUsd: activeCapitalUsd,
    currentExposurePct: openExposurePct,
    effectiveTradeSizePct,
    sourceNotionalUsd: pricing.sourceNotionalUsd,
    targetNotionalUsd: Math.min(
      pricing.sourceNotionalUsd,
      Math.max(0, activeCapitalUsd * (effectiveTradeSizePct / 100)),
    ),
    markPrice: pricing.markPrice,
  };
}

export function plannedSignalExposureUsd(options: {
  config: Pick<
    PolymarketCopyRuntimeConfig,
    | "paperStartingBankrollUsd"
    | "activeTradingCapitalMode"
    | "activeTradingCapitalCapUsd"
    | "minTradeSizePct"
    | "maxTradeSizePct"
    | "maxTotalOpenExposurePct"
    | "dynamicSizing"
    | "dynamicSizingBasis"
  >;
  signal: PolymarketCopySignal;
  openTrades: PolymarketCopyPaperTrade[];
  totalRealizedPnlUsd: number;
  existingTrade: PolymarketCopyPaperTrade | null;
}): number {
  const { signal, existingTrade } = options;
  if (!isRiskIncreasingAction(signal.action)) return 0;

  const pricing = resolveSignalPricing(signal);
  if (pricing.markPrice == null || pricing.markPrice <= 0) return 0;

  if (existingTrade) {
    const mirrorScale = toFiniteNumber(existingTrade.metadata?.mirrorScale) ?? 1;
    return Math.max(0, pricing.sourceDelta * mirrorScale * pricing.markPrice);
  }

  const plan = planNewTradeSizing(options);
  return plan?.targetNotionalUsd ?? 0;
}
