import type { PolymarketCopyCadence, PolymarketCopySignalAction } from "@paperclipai/shared";
import { safeDate, type PolymarketSignalMetadata, type PolymarketSpreadSnapshot } from "./shared.js";
import type { PolymarketPositionEntry, PolymarketTradeEntry } from "./official-client.js";

export interface MonitoredWalletPosition extends PolymarketPositionEntry {
  latestTradeAt: Date | null;
  spread: PolymarketSpreadSnapshot | null;
}

export interface NormalizedSignalCandidate {
  marketId: string;
  marketSlug: string | null;
  marketTitle: string | null;
  assetId: string;
  action: PolymarketCopySignalAction;
  side: string | null;
  sizeDelta: number | null;
  previousSize: number | null;
  currentSize: number | null;
  materialityUsd: number | null;
  sourceSnapshotTimestamp: Date | null;
  cadence: PolymarketCopyCadence;
  rawMetadata: PolymarketSignalMetadata;
}

function positionKey(position: Pick<PolymarketPositionEntry, "conditionId" | "asset">): string {
  return `${position.conditionId}:${position.asset}`;
}

function latestTradeByPosition(
  trades: PolymarketTradeEntry[],
): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const trade of trades) {
    const key = positionKey({ conditionId: trade.conditionId, asset: trade.asset });
    const current = map.get(key);
    const next = new Date(trade.timestamp * 1000);
    if (!current || next > current) {
      map.set(key, next);
    }
  }
  return map;
}

export function enrichPositionsWithTrades(
  positions: PolymarketPositionEntry[],
  trades: PolymarketTradeEntry[],
  spreadsByAsset: Map<string, PolymarketSpreadSnapshot | null>,
): MonitoredWalletPosition[] {
  const latestByPosition = latestTradeByPosition(trades);
  return positions.map((position) => ({
    ...position,
    latestTradeAt: latestByPosition.get(positionKey(position)) ?? null,
    spread: spreadsByAsset.get(position.asset) ?? null,
  }));
}

function toSignalCandidate(
  previousPosition: MonitoredWalletPosition | null,
  currentPosition: MonitoredWalletPosition | null,
  cadence: PolymarketCopyCadence,
): NormalizedSignalCandidate | null {
  const previousSize = previousPosition?.size ?? null;
  const currentSize = currentPosition?.size ?? null;
  const delta = (currentSize ?? 0) - (previousSize ?? 0);

  let action: PolymarketCopySignalAction | null = null;
  if (previousPosition == null && currentPosition != null) {
    action = "new_position";
  } else if (previousPosition != null && currentPosition == null) {
    action = "closed_position";
  } else if ((delta ?? 0) > 0) {
    action = "increased_position";
  } else if ((delta ?? 0) < 0) {
    action = "reduced_position";
  }

  if (!action) return null;

  const reference = currentPosition ?? previousPosition;
  if (!reference) return null;

  const price = currentPosition?.curPrice ?? previousPosition?.curPrice ?? null;
  const sourceTimestamp =
    currentPosition?.latestTradeAt ??
    previousPosition?.latestTradeAt ??
    safeDate(currentPosition?.endDate) ??
    safeDate(previousPosition?.endDate);
  const materialityUsd =
    action === "closed_position"
      ? (previousPosition?.currentValue ?? previousPosition?.initialValue ?? 0)
      : Math.abs(delta) * Math.max(0, price ?? 0);

  return {
    marketId: reference.conditionId,
    marketSlug: reference.slug ?? reference.eventSlug ?? null,
    marketTitle: reference.title ?? null,
    assetId: reference.asset,
    action,
    side: reference.outcome ?? null,
    sizeDelta: action === "closed_position" ? -(previousPosition?.size ?? 0) : delta,
    previousSize,
    currentSize,
    materialityUsd,
    sourceSnapshotTimestamp: sourceTimestamp,
    cadence,
    rawMetadata: {
      currentPrice: price,
      currentValue: currentPosition?.currentValue ?? previousPosition?.currentValue ?? null,
      sourceNotionalUsd: currentPosition?.currentValue ?? previousPosition?.currentValue ?? null,
      spreadBps: currentPosition?.spread?.spreadBps ?? null,
      bestBid: currentPosition?.spread?.bestBid ?? null,
      bestAsk: currentPosition?.spread?.bestAsk ?? null,
      latestTradeTimestamp: sourceTimestamp?.toISOString() ?? null,
      previousPosition: previousPosition ? {
        size: previousPosition.size,
        price: previousPosition.curPrice,
        currentValue: previousPosition.currentValue,
      } : null,
      currentPosition: currentPosition ? {
        size: currentPosition.size,
        price: currentPosition.curPrice,
        currentValue: currentPosition.currentValue,
      } : null,
    },
  };
}

export function normalizeWalletSignals(options: {
  previousPositions: MonitoredWalletPosition[];
  currentPositions: MonitoredWalletPosition[];
  cadence: PolymarketCopyCadence;
}): NormalizedSignalCandidate[] {
  const previousMap = new Map(options.previousPositions.map((position) => [positionKey(position), position]));
  const currentMap = new Map(options.currentPositions.map((position) => [positionKey(position), position]));
  const keys = new Set([...previousMap.keys(), ...currentMap.keys()]);
  const signals: NormalizedSignalCandidate[] = [];

  for (const key of keys) {
    const signal = toSignalCandidate(previousMap.get(key) ?? null, currentMap.get(key) ?? null, options.cadence);
    if (signal) signals.push(signal);
  }

  return signals;
}
