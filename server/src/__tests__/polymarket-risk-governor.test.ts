import { describe, expect, it } from "vitest";
import { evaluateRiskDecision } from "../services/polymarket/risk-governor.ts";

const baseConfig = {
  companyId: "company-1",
  mode: "paper" as const,
  liveEnabled: false,
  tradingKillSwitch: true,
  walletSelectionEnabled: true,
  walletSelectionTimeZone: "UTC",
  walletSelectionHour: 9,
  walletSelectionMinute: 0,
  selectorMaxCandidates: 25,
  targetWatchedWalletCount: 10,
  targetBenchWalletCount: 10,
  maxDailyReplacements: 2,
  selectorReplacementScoreDelta: 0.08,
  efficiencyWeight: 0.35,
  consistencyWeight: 0.2,
  diversificationWeight: 0.2,
  recencyWeight: 0.15,
  concentrationPenaltyWeight: 0.1,
  minWalletScore: 0.45,
  minSignalMateriality: 250,
  maxSpreadBps: 800,
  staleSignalThresholdMinutes: 30,
  maxExposurePerMarket: 5_000,
  maxTotalOpenPaperExposure: 20_000,
  maxOpenSimulatedPositions: 3,
  maxDailySimulatedLoss: 500,
  monitor5mEnabled: true,
  monitor15mEnabled: true,
  monitor5mIntervalMinutes: 5,
  monitor15mIntervalMinutes: 15,
  paperTradeUsdPerSignal: 250,
  artifactRootPath: null,
  authEnv: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseSignal = {
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
  action: "new_position" as const,
  side: "Yes",
  sizeDelta: 100,
  previousSize: null,
  currentSize: 100,
  materialityUsd: 400,
  detectionTimestamp: new Date("2026-04-01T12:00:00Z"),
  sourceSnapshotTimestamp: new Date("2026-04-01T11:50:00Z"),
  cadence: "5m" as const,
  rawMetadata: {
    spreadBps: 100,
  },
  createdAt: new Date("2026-04-01T12:00:00Z"),
};

describe("polymarket risk governor", () => {
  it("accepts healthy signals in paper mode even when the live kill switch is on", () => {
    const result = evaluateRiskDecision({
      config: baseConfig,
      signal: baseSignal,
      openTrades: [],
      dailyRealizedLossUsd: 0,
      now: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result.decision).toBe("accepted");
  });

  it("skips low-score or stale signals", () => {
    const result = evaluateRiskDecision({
      config: baseConfig,
      signal: {
        ...baseSignal,
        walletScore: 0.1,
        sourceSnapshotTimestamp: new Date("2026-04-01T10:00:00Z"),
      },
      openTrades: [],
      dailyRealizedLossUsd: 0,
      now: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result.decision).toBe("skipped");
    expect(["wallet_score_below_min", "signal_stale"]).toContain(result.reasonCode);
  });

  it("blocks signals that breach exposure limits", () => {
    const result = evaluateRiskDecision({
      config: baseConfig,
      signal: { ...baseSignal, materialityUsd: 1_000 },
      openTrades: [{
        id: "trade-1",
        companyId: "company-1",
        sourceWalletAddress: "0xwallet",
        signalId: null,
        marketId: "market-1",
        marketSlug: "market-1",
        marketTitle: "Market 1",
        assetId: "asset-1",
        side: "Yes",
        status: "open",
        quantity: 1,
        notionalUsd: 4_500,
        estimatedEntryPrice: 0.5,
        currentMarkPrice: 0.6,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 10,
        sourceToCopyDelayMs: 1000,
        assumptionNote: null,
        metadata: null,
        openedAt: new Date(),
        closedAt: null,
        lastUpdatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      dailyRealizedLossUsd: 0,
      now: new Date("2026-04-01T12:00:00Z"),
    });

    expect(result.decision).toBe("blocked");
    expect(result.reasonCode).toBe("market_exposure_limit");
  });
});
