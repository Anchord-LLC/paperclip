import type { PolymarketCopyCadence, PolymarketCopySignal, PolymarketCopyWatchedWallet } from "@paperclipai/shared";
import { createPolymarketOfficialClient } from "./official-client.js";
import { enrichPositionsWithTrades, normalizeWalletSignals } from "./signal-normalizer.js";
import { normalizeWalletAddress } from "./shared.js";

export interface WalletMonitorSnapshot {
  walletAddress: string;
  positions: ReturnType<typeof enrichPositionsWithTrades>;
  trades: Awaited<ReturnType<ReturnType<typeof createPolymarketOfficialClient>["getTrades"]>>;
  latestActivityAt: Date | null;
  openExposureUsd: number;
  fetchedAt: Date;
}

export interface WalletMonitorResult {
  wallet: PolymarketCopyWatchedWallet;
  snapshot: WalletMonitorSnapshot;
  signals: Array<Omit<PolymarketCopySignal, "id" | "companyId" | "workerRunId" | "walletSnapshotId" | "watchedWalletId" | "createdAt">>;
}

export function createWalletMonitor() {
  const client = createPolymarketOfficialClient();

  async function loadSnapshot(walletAddress: string): Promise<WalletMonitorSnapshot> {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const [positions, trades] = await Promise.all([
      client.getPositions(normalizedWallet),
      client.getTrades(normalizedWallet),
    ]);
    const uniqueAssetIds = [...new Set(positions.map((position) => position.asset))];
    const spreads = await Promise.all(uniqueAssetIds.map(async (assetId) => [assetId, await client.getOrderBook(assetId)] as const));
    const spreadMap = new Map(spreads);
    const enrichedPositions = enrichPositionsWithTrades(positions, trades, spreadMap);
    const latestActivityAt = enrichedPositions.reduce<Date | null>((latest, position) => {
      if (!position.latestTradeAt) return latest;
      if (!latest || position.latestTradeAt > latest) return position.latestTradeAt;
      return latest;
    }, null);

    return {
      walletAddress: normalizedWallet,
      positions: enrichedPositions,
      trades,
      latestActivityAt,
      openExposureUsd: enrichedPositions.reduce((sum, position) => sum + Math.max(0, position.currentValue ?? 0), 0),
      fetchedAt: new Date(),
    };
  }

  return {
    async monitorWallet(options: {
      wallet: PolymarketCopyWatchedWallet;
      cadence: PolymarketCopyCadence;
      previousSnapshot: WalletMonitorSnapshot | null;
      now: Date;
    }): Promise<WalletMonitorResult> {
      const snapshot = await loadSnapshot(options.wallet.walletAddress);
      const normalized = normalizeWalletSignals({
        previousPositions: options.previousSnapshot?.positions ?? [],
        currentPositions: snapshot.positions,
        cadence: options.cadence,
      });
      return {
        wallet: options.wallet,
        snapshot,
        signals: normalized.map((signal) => ({
          sourceWalletAddress: snapshot.walletAddress,
          walletScore: options.wallet.score,
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
          detectionTimestamp: options.now,
          sourceSnapshotTimestamp: signal.sourceSnapshotTimestamp,
          cadence: options.cadence,
          rawMetadata: signal.rawMetadata,
        })),
      };
    },
  };
}
