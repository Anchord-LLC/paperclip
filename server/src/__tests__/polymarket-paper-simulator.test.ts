import { describe, expect, it } from "vitest";
import { applySignalToPaperTrade } from "../services/polymarket/paper-simulator.ts";

const sizingConfig = {
  paperStartingBankrollUsd: 100,
  activeTradingCapitalMode: "capped_equity" as const,
  activeTradingCapitalCapUsd: 500,
  minTradeSizePct: 7.5,
  maxTradeSizePct: 12.5,
  maxTotalOpenExposurePct: 90,
  dynamicSizing: true,
  dynamicSizingBasis: "current_exposure" as const,
};

describe("polymarket paper simulator", () => {
  it("opens and then closes a paper trade using bankroll-based copy sizing", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const openResult = applySignalToPaperTrade({
      config: sizingConfig,
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
      openTrades: [],
      totalRealizedPnlUsd: 0,
      sourceWalletAddress: "0xwallet",
      now,
    });

    expect(openResult?.trade.quantity).toBeGreaterThan(0);
    expect(openResult?.event?.eventType).toBe("opened");

    const existingTrade = {
      id: "trade-1",
      companyId: "company-1",
      sourceWalletAddress: "0xwallet",
      signalId: "signal-1",
      marketId: "market-1",
      marketSlug: "market-1",
      marketTitle: "Market 1",
      assetId: "asset-1",
      side: "Yes",
      status: "open" as const,
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
    };

    const closeResult = applySignalToPaperTrade({
      config: sizingConfig,
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
      existingTrade,
      openTrades: [existingTrade],
      totalRealizedPnlUsd: 0,
      sourceWalletAddress: "0xwallet",
      now: new Date(now.getTime() + 60_000),
    });

    expect(closeResult?.trade.status).toBe("closed");
    expect(closeResult?.trade.quantity).toBe(0);
    expect((closeResult?.trade.realizedPnlUsd ?? 0)).toBeGreaterThan(0);
  });
});
