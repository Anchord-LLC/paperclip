import { describe, expect, it } from "vitest";
import { applySignalToPaperTrade } from "../services/polymarket/paper-simulator.ts";

describe("polymarket paper simulator", () => {
  it("opens and then closes a paper trade using mirror scale assumptions", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const openResult = applySignalToPaperTrade({
      signal: {
        id: "signal-1",
        companyId: "company-1",
        workerRunId: null,
        walletSnapshotId: null,
        sourceWalletAddress: "0xwallet",
        watchedWalletId: null,
        walletScore: 0.8,
        marketId: "market-1",
        marketSlug: "market-1",
        marketTitle: "Market 1",
        assetId: "asset-1",
        action: "new_position",
        side: "Yes",
        sizeDelta: 100,
        previousSize: null,
        currentSize: 100,
        materialityUsd: 400,
        detectionTimestamp: now,
        sourceSnapshotTimestamp: new Date(now.getTime() - 5_000),
        cadence: "5m",
        rawMetadata: {
          currentPrice: 0.5,
          currentValue: 400,
          sourceNotionalUsd: 400,
        },
        createdAt: now,
      },
      existingTrade: null,
      sourceWalletAddress: "0xwallet",
      paperTradeUsdPerSignal: 200,
      now,
    });

    expect(openResult?.trade.quantity).toBeGreaterThan(0);
    expect(openResult?.event?.eventType).toBe("opened");

    const closeResult = applySignalToPaperTrade({
      signal: {
        id: "signal-2",
        companyId: "company-1",
        workerRunId: null,
        walletSnapshotId: null,
        sourceWalletAddress: "0xwallet",
        watchedWalletId: null,
        walletScore: 0.8,
        marketId: "market-1",
        marketSlug: "market-1",
        marketTitle: "Market 1",
        assetId: "asset-1",
        action: "closed_position",
        side: "Yes",
        sizeDelta: -100,
        previousSize: 100,
        currentSize: null,
        materialityUsd: 450,
        detectionTimestamp: new Date(now.getTime() + 60_000),
        sourceSnapshotTimestamp: new Date(now.getTime() + 55_000),
        cadence: "5m",
        rawMetadata: {
          currentPrice: 0.7,
          currentValue: 450,
          sourceNotionalUsd: 450,
        },
        createdAt: new Date(now.getTime() + 60_000),
      },
      existingTrade: {
        id: "trade-1",
        companyId: "company-1",
        sourceWalletAddress: "0xwallet",
        signalId: "signal-1",
        marketId: "market-1",
        marketSlug: "market-1",
        marketTitle: "Market 1",
        assetId: "asset-1",
        side: "Yes",
        status: "open",
        quantity: openResult!.trade.quantity,
        notionalUsd: openResult!.trade.notionalUsd,
        estimatedEntryPrice: openResult!.trade.estimatedEntryPrice,
        currentMarkPrice: openResult!.trade.currentMarkPrice,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        sourceToCopyDelayMs: openResult!.trade.sourceToCopyDelayMs,
        assumptionNote: openResult!.trade.assumptionNote,
        metadata: openResult!.trade.metadata,
        openedAt: openResult!.trade.openedAt,
        closedAt: null,
        lastUpdatedAt: openResult!.trade.lastUpdatedAt,
        createdAt: now,
        updatedAt: now,
      },
      sourceWalletAddress: "0xwallet",
      paperTradeUsdPerSignal: 200,
      now: new Date(now.getTime() + 60_000),
    });

    expect(closeResult?.trade.status).toBe("closed");
    expect(closeResult?.trade.quantity).toBe(0);
    expect((closeResult?.trade.realizedPnlUsd ?? 0)).toBeGreaterThan(0);
  });
});
