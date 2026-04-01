import type {
  PolymarketCopyPaperTrade,
  PolymarketCopySignal,
} from "@paperclipai/shared";
import { signalMetadata } from "./shared.js";

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
  signal: PolymarketCopySignal;
  existingTrade: PolymarketCopyPaperTrade | null;
  sourceWalletAddress: string;
  paperTradeUsdPerSignal: number;
  now: Date;
}): PaperSimulatorResult | null {
  const { signal, existingTrade, sourceWalletAddress, paperTradeUsdPerSignal, now } = options;
  const metadata = signalMetadata(signal);
  const markPrice = toNumber(metadata.currentPrice) ?? null;
  if (markPrice == null || markPrice <= 0) return null;

  const sourceNotionalUsd = Math.max(
    1,
    toNumber(metadata.sourceNotionalUsd) ??
      toNumber(metadata.currentValue) ??
      (signal.currentSize != null ? signal.currentSize * markPrice : paperTradeUsdPerSignal),
  );
  const sourceDelta = Math.abs(signal.sizeDelta ?? signal.currentSize ?? 0);

  if (!existingTrade) {
    if (signal.action === "reduced_position" || signal.action === "closed_position") {
      return null;
    }

    const mirrorScale = Math.min(1, paperTradeUsdPerSignal / sourceNotionalUsd);
    const quantity = Math.max(0, (signal.currentSize ?? sourceDelta) * mirrorScale);
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
        assumptionNote: "V0 paper trade mirrors the source position using a capped notional scale derived from source size.",
        metadata: {
          mirrorScale,
          copiedFromSignalAction: signal.action,
          sourceNotionalUsd,
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
          sourceNotionalUsd,
          paperTradeUsdPerSignal,
        },
      },
    };
  }

  const mirrorScale = toNumber(existingTrade.metadata?.mirrorScale) ?? 1;
  const quantityDelta = sourceDelta * mirrorScale;
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
        sourceDelta,
        sourceNotionalUsd,
      },
    },
  };
}
