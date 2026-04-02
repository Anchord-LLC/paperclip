import type { PolymarketCopyCadence, PolymarketCopySignal, PolymarketCopyWatchedWallet } from "@paperclipai/shared";
import { logger } from "../../middleware/logger.js";
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

const ORDER_BOOK_FETCH_CONCURRENCY = 6;

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results: TOutput[] = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

export function createWalletMonitor() {
  const client = createPolymarketOfficialClient();
  const log = logger.child({ service: "polymarket-wallet-monitor" });

  async function loadSnapshot(walletAddress: string): Promise<WalletMonitorSnapshot> {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const [positions, trades] = await Promise.all([
      client.getPositions(normalizedWallet),
      client.getTrades(normalizedWallet),
    ]);
    const uniqueAssetIds = [...new Set(positions
      .map((position) => position.asset)
      .filter((assetId): assetId is string => typeof assetId === "string" && assetId.length > 0))];
    const spreads = await mapWithConcurrency(
      uniqueAssetIds,
      ORDER_BOOK_FETCH_CONCURRENCY,
      async (assetId) => [assetId, await client.getOrderBook(assetId)] as const,
    );
    const missingOrderBookCount = spreads.reduce((count, [, orderBook]) => count + (orderBook ? 0 : 1), 0);
    if (missingOrderBookCount > 0) {
      log.debug({
        walletAddress: normalizedWallet,
        missingOrderBookCount,
        assetCount: uniqueAssetIds.length,
      }, "wallet snapshot skipped missing order books");
    }
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
