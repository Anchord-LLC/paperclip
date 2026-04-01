import { describe, expect, it } from "vitest";
import { scoreWalletCandidate, selectWalletsWithBench } from "../services/polymarket/wallet-selector.ts";

describe("polymarket wallet selector", () => {
  it("scores diversified active wallets above stale concentrated wallets", () => {
    const now = new Date("2026-04-01T12:00:00Z");
    const strong = scoreWalletCandidate({
      walletAddress: "0xaaa",
      label: "Strong",
      leaderboard: {
        rank: "1",
        proxyWallet: "0xaaa",
        userName: "Strong",
        xUsername: "",
        verifiedBadge: false,
        vol: 250_000,
        pnl: 75_000,
        profileImage: "",
      },
      positions: [
        { conditionId: "m1", asset: "a1", size: 100, currentValue: 400, cashPnl: 30, curPrice: 0.4, title: "One", slug: "one", eventSlug: "one", avgPrice: 0.3, initialValue: 300, percentPnl: 10, totalBought: 300, realizedPnl: 0, percentRealizedPnl: 0, icon: "", eventId: "1", outcome: "Yes", outcomeIndex: 0, oppositeOutcome: "No", oppositeAsset: "b1", endDate: now.toISOString(), negativeRisk: false, proxyWallet: "0xaaa" },
        { conditionId: "m2", asset: "a2", size: 100, currentValue: 350, cashPnl: 20, curPrice: 0.35, title: "Two", slug: "two", eventSlug: "two", avgPrice: 0.28, initialValue: 280, percentPnl: 10, totalBought: 280, realizedPnl: 0, percentRealizedPnl: 0, icon: "", eventId: "2", outcome: "Yes", outcomeIndex: 0, oppositeOutcome: "No", oppositeAsset: "b2", endDate: now.toISOString(), negativeRisk: false, proxyWallet: "0xaaa" },
      ],
      closedPositions: [
        { conditionId: "m3", asset: "a3", avgPrice: 0.4, totalBought: 400, realizedPnl: 100, curPrice: 1, title: "Three", slug: "three", icon: "", eventSlug: "three", outcome: "Yes", outcomeIndex: 0, oppositeOutcome: "No", oppositeAsset: "b3", endDate: now.toISOString(), timestamp: 1775000000, proxyWallet: "0xaaa", eventId: "3" },
      ],
      trades: [{ proxyWallet: "0xaaa", side: "BUY", asset: "a1", conditionId: "m1", size: 10, price: 0.4, timestamp: 1775060000, title: "One", slug: "one", icon: "", eventSlug: "one", outcome: "Yes", outcomeIndex: 0, name: "", pseudonym: "", bio: "", profileImage: "", profileImageOptimized: "", transactionHash: "0x1" }],
      now,
    }, {
      efficiency: 0.35,
      consistency: 0.2,
      diversification: 0.2,
      recency: 0.15,
      concentrationPenalty: 0.1,
    });

    const weak = scoreWalletCandidate({
      walletAddress: "0xbbb",
      label: "Weak",
      leaderboard: {
        rank: "2",
        proxyWallet: "0xbbb",
        userName: "Weak",
        xUsername: "",
        verifiedBadge: false,
        vol: 80_000,
        pnl: 500,
        profileImage: "",
      },
      positions: [
        { conditionId: "m9", asset: "a9", size: 1000, currentValue: 10_000, cashPnl: -50, curPrice: 0.1, title: "Nine", slug: "nine", eventSlug: "nine", avgPrice: 0.11, initialValue: 11_000, percentPnl: -9, totalBought: 11_000, realizedPnl: 0, percentRealizedPnl: 0, icon: "", eventId: "9", outcome: "Yes", outcomeIndex: 0, oppositeOutcome: "No", oppositeAsset: "b9", endDate: now.toISOString(), negativeRisk: false, proxyWallet: "0xbbb" },
      ],
      closedPositions: [],
      trades: [{ proxyWallet: "0xbbb", side: "BUY", asset: "a9", conditionId: "m9", size: 10, price: 0.1, timestamp: 1773000000, title: "Nine", slug: "nine", icon: "", eventSlug: "nine", outcome: "Yes", outcomeIndex: 0, name: "", pseudonym: "", bio: "", profileImage: "", profileImageOptimized: "", transactionHash: "0x2" }],
      now,
    }, {
      efficiency: 0.35,
      consistency: 0.2,
      diversification: 0.2,
      recency: 0.15,
      concentrationPenalty: 0.1,
    });

    expect(strong.compositeScore).toBeGreaterThan(weak.compositeScore);
    expect(strong.eligible).toBe(true);
    expect(weak.eligible).toBe(false);
  });

  it("limits daily replacements when incumbents are still close to the cutoff", () => {
    const candidates = [
      { walletAddress: "0x1", compositeScore: 0.91, eligible: true, componentScores: { efficiency: 0, consistency: 0, diversification: 0, recency: 0, concentrationPenalty: 0 }, label: null, leaderboardRank: 1, volume: 1, pnl: 1, openMarketCount: 1, closedMarketCount: 1, recentTradeCount: 1, recentTradeAt: new Date(), concentrationRatio: 0.2, eligibilityReasons: [], snapshot: {} },
      { walletAddress: "0x2", compositeScore: 0.89, eligible: true, componentScores: { efficiency: 0, consistency: 0, diversification: 0, recency: 0, concentrationPenalty: 0 }, label: null, leaderboardRank: 2, volume: 1, pnl: 1, openMarketCount: 1, closedMarketCount: 1, recentTradeCount: 1, recentTradeAt: new Date(), concentrationRatio: 0.2, eligibilityReasons: [], snapshot: {} },
      { walletAddress: "0x3", compositeScore: 0.88, eligible: true, componentScores: { efficiency: 0, consistency: 0, diversification: 0, recency: 0, concentrationPenalty: 0 }, label: null, leaderboardRank: 3, volume: 1, pnl: 1, openMarketCount: 1, closedMarketCount: 1, recentTradeCount: 1, recentTradeAt: new Date(), concentrationRatio: 0.2, eligibilityReasons: [], snapshot: {} },
      { walletAddress: "0x4", compositeScore: 0.87, eligible: true, componentScores: { efficiency: 0, consistency: 0, diversification: 0, recency: 0, concentrationPenalty: 0 }, label: null, leaderboardRank: 4, volume: 1, pnl: 1, openMarketCount: 1, closedMarketCount: 1, recentTradeCount: 1, recentTradeAt: new Date(), concentrationRatio: 0.2, eligibilityReasons: [], snapshot: {} },
    ];

    const result = selectWalletsWithBench({
      candidates,
      previousWatchlist: [
        { id: "a", companyId: "c", walletAddress: "0x2", label: null, status: "active", sourceSelectionRunId: null, currentRank: 1, score: 0.84, componentScores: { efficiency: 0, consistency: 0, diversification: 0, recency: 0, concentrationPenalty: 0 }, concentrationRatio: 0.2, lastRefreshedAt: new Date(), activatedAt: new Date(), replacedAt: null, metadata: null, createdAt: new Date(), updatedAt: new Date() },
        { id: "b", companyId: "c", walletAddress: "0x3", label: null, status: "active", sourceSelectionRunId: null, currentRank: 2, score: 0.83, componentScores: { efficiency: 0, consistency: 0, diversification: 0, recency: 0, concentrationPenalty: 0 }, concentrationRatio: 0.2, lastRefreshedAt: new Date(), activatedAt: new Date(), replacedAt: null, metadata: null, createdAt: new Date(), updatedAt: new Date() },
      ],
      targetActiveCount: 2,
      targetBenchCount: 1,
      maxDailyReplacements: 1,
      selectorReplacementScoreDelta: 0.05,
    });

    expect(result.active.map((item) => item.walletAddress)).toContain("0x2");
    expect(result.active.length).toBe(2);
  });
});
