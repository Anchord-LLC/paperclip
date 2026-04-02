import type {
  PolymarketCopyPaperTrade,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignal,
} from "@paperclipai/shared";
import { planNewTradeSizing, resolveSignalPricing } from "./runtime-math.js";

export interface PaperSimulatorResult {
  trade: Omit<PolymarketCopyPaperTrade, "id" | "companyId" | "createdAt" | "updatedAt">;
  event: {
    eventType: string;
    quantityDelta: number | null;
    price: number | null;
    realizedPnlUsd: number | null;
    unrealizedPnlUsd: number | null;
    assumptions: Record<string, unknown>;
  } | null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function computeUnrealized(quantity: number, entryPrice: number | null, markPrice: number | null): number {
  if (entryPrice == null || markPrice == null) return 0;
  return quantity * (markPrice - entryPrice);
}

export function applySignalToPaperTrade(options: {
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
  existingTrade: PolymarketCopyPaperTrade | null;
  openTrades: PolymarketCopyPaperTrade[];
  totalRealizedPnlUsd: number;
  sourceWalletAddress: string;
  now: Date;
}): PaperSimulatorResult | null {
  const { config, signal, existingTrade, openTrades, totalRealizedPnlUsd, sourceWalletAddress, now } = options;
  const pricing = resolveSignalPricing(signal);
  const markPrice = pricing.markPrice;
  if (markPrice == null || markPrice <= 0) return null;

  if (!existingTrade) {
    if (signal.action === "reduced_position" || signal.action === "closed_position") {
      return null;
    }

    const sizingPlan = planNewTradeSizing({
      config,
      signal,
      openTrades,
      totalRealizedPnlUsd,
    });
    if (!sizingPlan) return null;

    const mirrorScale = Math.min(1, sizingPlan.targetNotionalUsd / pricing.sourceNotionalUsd);
    const quantity = Math.max(0, (signal.currentSize ?? pricing.sourceDelta) * mirrorScale);
    const notionalUsd = quantity * markPrice;
    return {
      trade: {
        sourceWalletAddress,
        signalId: signal.id,
        marketId: signal.marketId,
        marketSlug: signal.marketSlug,
        marketTitle: signal.marketTitle,
        assetId: signal.assetId,
        side: signal.side ?? "unknown",
        status: "open",
        quantity,
        notionalUsd,
        estimatedEntryPrice: markPrice,
        currentMarkPrice: markPrice,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        sourceToCopyDelayMs:
          signal.sourceSnapshotTimestamp == null
            ? null
            : Math.max(0, now.getTime() - signal.sourceSnapshotTimestamp.getTime()),
        assumptionNote: "Paper trade mirrors the source position using capped active trading capital and the shared deterministic execution engine.",
        metadata: {
          mirrorScale,
          copiedFromSignalAction: signal.action,
          sourceNotionalUsd: pricing.sourceNotionalUsd,
          targetNotionalUsd: sizingPlan.targetNotionalUsd,
          effectiveTradeSizePct: sizingPlan.effectiveTradeSizePct,
          currentPaperBankrollUsd: sizingPlan.currentPaperBankrollUsd,
          currentWalletEquityUsd: sizingPlan.currentWalletEquityUsd,
          activeTradingCapitalUsd: sizingPlan.activeTradingCapitalUsd,
          currentExposurePct: sizingPlan.currentExposurePct,
        },
        openedAt: now,
        closedAt: null,
        lastUpdatedAt: now,
      },
      event: {
        eventType: "opened",
        quantityDelta: quantity,
        price: markPrice,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        assumptions: {
          mirrorScale,
          sourceNotionalUsd: pricing.sourceNotionalUsd,
          targetNotionalUsd: sizingPlan.targetNotionalUsd,
          effectiveTradeSizePct: sizingPlan.effectiveTradeSizePct,
          currentPaperBankrollUsd: sizingPlan.currentPaperBankrollUsd,
          currentWalletEquityUsd: sizingPlan.currentWalletEquityUsd,
          activeTradingCapitalUsd: sizingPlan.activeTradingCapitalUsd,
          currentExposurePct: sizingPlan.currentExposurePct,
        },
      },
    };
  }

  const mirrorScale = toNumber(existingTrade.metadata?.mirrorScale) ?? 1;
  const quantityDelta = pricing.sourceDelta * mirrorScale;
  const remainingQuantity =
    signal.action === "reduced_position" || signal.action === "closed_position"
      ? Math.max(0, existingTrade.quantity - (signal.action === "closed_position" ? existingTrade.quantity : quantityDelta))
      : existingTrade.quantity + quantityDelta;

  const realizedDelta =
    signal.action === "reduced_position" || signal.action === "closed_position"
      ? Math.min(existingTrade.quantity, signal.action === "closed_position" ? existingTrade.quantity : quantityDelta) *
        (markPrice - (existingTrade.estimatedEntryPrice ?? markPrice))
      : 0;

  const estimatedEntryPrice =
    signal.action === "reduced_position" || signal.action === "closed_position"
      ? existingTrade.estimatedEntryPrice
      : existingTrade.quantity + quantityDelta > 0
        ? (
          ((existingTrade.quantity * (existingTrade.estimatedEntryPrice ?? markPrice)) + (quantityDelta * markPrice)) /
          (existingTrade.quantity + quantityDelta)
        )
        : existingTrade.estimatedEntryPrice;

  const unrealizedPnlUsd = computeUnrealized(remainingQuantity, estimatedEntryPrice ?? null, markPrice);
  const eventType =
    signal.action === "reduced_position"
      ? "reduced"
      : signal.action === "closed_position"
        ? "closed"
        : "increased";

  return {
    trade: {
      ...existingTrade,
      signalId: signal.id,
      quantity: remainingQuantity,
      notionalUsd: remainingQuantity * markPrice,
      estimatedEntryPrice: estimatedEntryPrice ?? existingTrade.estimatedEntryPrice,
      currentMarkPrice: markPrice,
      realizedPnlUsd: existingTrade.realizedPnlUsd + realizedDelta,
      unrealizedPnlUsd,
      sourceToCopyDelayMs:
        signal.sourceSnapshotTimestamp == null
          ? existingTrade.sourceToCopyDelayMs
          : Math.max(0, now.getTime() - signal.sourceSnapshotTimestamp.getTime()),
      assumptionNote: existingTrade.assumptionNote,
      metadata: {
        ...(existingTrade.metadata ?? {}),
        mirrorScale,
        lastSourceSignalAction: signal.action,
      },
      openedAt: existingTrade.openedAt,
      closedAt: eventType === "closed" ? now : null,
      lastUpdatedAt: now,
      status: eventType === "closed" ? "closed" : "open",
    },
    event: {
      eventType,
      quantityDelta: eventType === "closed" ? -existingTrade.quantity : signal.action === "reduced_position" ? -quantityDelta : quantityDelta,
      price: markPrice,
      realizedPnlUsd: realizedDelta,
      unrealizedPnlUsd,
      assumptions: {
        mirrorScale,
        sourceDelta: pricing.sourceDelta,
        sourceNotionalUsd: pricing.sourceNotionalUsd,
      },
    },
  };
}
