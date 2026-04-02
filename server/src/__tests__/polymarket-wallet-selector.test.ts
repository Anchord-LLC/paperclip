import { describe, expect, it } from "vitest";
import { scoreWalletCandidate, selectWalletsWithBench } from "../services/polymarket/wallet-selector.ts";

const NOW = new Date("2026-04-01T12:00:00Z");
const DEFAULT_WEIGHTS = {
  efficiency: 0.35,
  consistency: 0.2,
  diversification: 0.2,
  recency: 0.15,
  concentrationPenalty: 0.1,
};

type TestCategory = "sports" | "politics" | "crypto" | "other";

function isoDaysAgo(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function timestampDaysAgo(daysAgo: number): number {
  return Math.floor(new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).getTime() / 1000);
}

function categoryEventSlug(category: TestCategory, index: number): string {
  if (category === "sports") return `nba-finals-${index}`;
  if (category === "politics") return `senate-control-${index}`;
  if (category === "crypto") return `bitcoin-above-${index}`;
  return `general-market-${index}`;
}

function categoryTitle(category: TestCategory, index: number): string {
  if (category === "sports") return `NBA Finals Market ${index}`;
  if (category === "politics") return `Senate Control Market ${index}`;
  if (category === "crypto") return `Bitcoin Price Market ${index}`;
  return `General Market ${index}`;
}

function buildClosedPositions(options: {
  walletAddress: string;
  resolvedTrades: number;
  positiveResolvedTrades: number;
  recentResolvedTrades30d: number;
  category?: TestCategory;
}): Array<Record<string, unknown>> {
  const category = options.category ?? "other";
  return Array.from({ length: options.resolvedTrades }, (_, index) => {
    const recentDaysAgo = index < options.recentResolvedTrades30d ? Math.min(index + 1, 29) : 40 + index;
    return {
      proxyWallet: options.walletAddress,
      asset: `asset-${index}`,
      conditionId: `condition-${index}`,
      avgPrice: 0.45,
      totalBought: 100,
      realizedPnl: index < options.positiveResolvedTrades ? 25 : -10,
      curPrice: 1,
      title: categoryTitle(category, index),
      slug: `market-${index}`,
      icon: "",
      eventSlug: categoryEventSlug(category, index),
      outcome: "Yes",
      outcomeIndex: 0,
      oppositeOutcome: "No",
      oppositeAsset: `opp-${index}`,
      endDate: isoDaysAgo(recentDaysAgo),
      timestamp: timestampDaysAgo(recentDaysAgo),
      eventId: `event-${index}`,
    };
  });
}

function buildTrades(
  walletAddress: string,
  tradeDaysAgo: number | null,
  category: TestCategory = "other",
): Array<Record<string, unknown>> {
  if (tradeDaysAgo == null) return [];
  return [{
    proxyWallet: walletAddress,
    side: "BUY",
    asset: "asset-live",
    conditionId: "condition-live",
    size: 10,
    price: 0.55,
    timestamp: timestampDaysAgo(tradeDaysAgo),
    title: categoryTitle(category, 999),
    slug: "recent-trade",
    icon: "",
    eventSlug: categoryEventSlug(category, 999),
    outcome: "Yes",
    outcomeIndex: 0,
    name: "",
    pseudonym: "",
    bio: "",
    profileImage: "",
    profileImageOptimized: "",
    transactionHash: `0x${walletAddress.slice(2)}-${tradeDaysAgo ?? "na"}`,
  }];
}

function makeCandidate(options: {
  walletAddress: string;
  leaderboardRank: number;
  winRate: number;
  resolvedTrades: number;
  recentResolvedTrades30d: number;
  tradeDaysAgo?: number | null;
  category?: TestCategory;
  closedPositionsFetchCeiling?: number | null;
}) {
  const positiveResolvedTrades = Math.round((options.winRate / 100) * options.resolvedTrades);
  return scoreWalletCandidate({
    walletAddress: options.walletAddress,
    label: options.walletAddress,
    leaderboard: {
      rank: String(options.leaderboardRank),
      proxyWallet: options.walletAddress,
      userName: options.walletAddress,
      xUsername: "",
      verifiedBadge: false,
      vol: 250_000,
      pnl: 75_000,
      profileImage: "",
    },
    positions: [],
    closedPositions: buildClosedPositions({
      walletAddress: options.walletAddress,
      resolvedTrades: options.resolvedTrades,
      positiveResolvedTrades,
      recentResolvedTrades30d: options.recentResolvedTrades30d,
      category: options.category,
    }) as never,
    trades: buildTrades(options.walletAddress, options.tradeDaysAgo ?? 1, options.category ?? "other") as never,
    now: NOW,
    closedPositionsFetchCeiling: options.closedPositionsFetchCeiling ?? null,
  }, DEFAULT_WEIGHTS);
}

function makeWatchedWallet(candidate: ReturnType<typeof makeCandidate>, rank: number) {
  return {
    id: `watched-${candidate.walletAddress}`,
    companyId: "company-1",
    walletAddress: candidate.walletAddress,
    label: candidate.label,
    status: "active" as const,
    sourceSelectionRunId: null,
    currentRank: rank,
    score: candidate.compositeScore,
    componentScores: candidate.componentScores,
    concentrationRatio: candidate.concentrationRatio,
    lastRefreshedAt: NOW,
    activatedAt: NOW,
    replacedAt: null,
    metadata: candidate.snapshot,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("polymarket wallet selector", () => {
  it("enforces preferred, fallback, bench, and demotion thresholds around win rate and longevity", () => {
    const preferred = makeCandidate({
      walletAddress: "0xaaa",
      leaderboardRank: 1,
      winRate: 80,
      resolvedTrades: 40,
      recentResolvedTrades30d: 16,
    });
    const fallback = makeCandidate({
      walletAddress: "0xbbb",
      leaderboardRank: 2,
      winRate: 66,
      resolvedTrades: 50,
      recentResolvedTrades30d: 14,
    });
    const bench = makeCandidate({
      walletAddress: "0xccc",
      leaderboardRank: 3,
      winRate: 75,
      resolvedTrades: 20,
      recentResolvedTrades30d: 10,
    });
    const weak = makeCandidate({
      walletAddress: "0xddd",
      leaderboardRank: 4,
      winRate: 55,
      resolvedTrades: 40,
      recentResolvedTrades30d: 6,
    });
    const stale = makeCandidate({
      walletAddress: "0xeee",
      leaderboardRank: 5,
      winRate: 70,
      resolvedTrades: 40,
      recentResolvedTrades30d: 0,
      tradeDaysAgo: null,
    });

    expect(preferred.activeEligibilityTier).toBe("preferred");
    expect(preferred.eligible).toBe(true);
    expect(fallback.activeEligibilityTier).toBe("fallback");
    expect(fallback.eligible).toBe(true);
    expect(bench.activeEligibilityTier).toBeNull();
    expect(bench.benchEligible).toBe(true);
    expect(bench.eligible).toBe(true);
    expect(weak.eligible).toBe(false);
    expect(weak.demotionReasons).toEqual(
      expect.arrayContaining(["win_rate_below_60", "recent_resolved_trades_30d_below_8"]),
    );
    expect(stale.eligible).toBe(false);
    expect(stale.demotionReasons).toContain("no_meaningful_activity_14d");
  });

  it("ranks wallets by win rate, then resolved trades, then recent resolved trades, then recency", () => {
    const candidateA = makeCandidate({
      walletAddress: "0xa1",
      leaderboardRank: 1,
      winRate: 82,
      resolvedTrades: 60,
      recentResolvedTrades30d: 18,
      tradeDaysAgo: 1,
    });
    const candidateB = makeCandidate({
      walletAddress: "0xb1",
      leaderboardRank: 2,
      winRate: 82,
      resolvedTrades: 60,
      recentResolvedTrades30d: 18,
      tradeDaysAgo: 4,
    });
    const candidateC = makeCandidate({
      walletAddress: "0xc1",
      leaderboardRank: 3,
      winRate: 82,
      resolvedTrades: 60,
      recentResolvedTrades30d: 15,
      tradeDaysAgo: 1,
    });
    const candidateD = makeCandidate({
      walletAddress: "0xd1",
      leaderboardRank: 4,
      winRate: 82,
      resolvedTrades: 50,
      recentResolvedTrades30d: 20,
      tradeDaysAgo: 1,
    });
    const candidateE = makeCandidate({
      walletAddress: "0xe1",
      leaderboardRank: 5,
      winRate: 79,
      resolvedTrades: 200,
      recentResolvedTrades30d: 40,
      tradeDaysAgo: 1,
    });

    const result = selectWalletsWithBench({
      candidates: [candidateE, candidateC, candidateB, candidateD, candidateA],
      previousWatchlist: [],
      targetActiveCount: 5,
      targetBenchCount: 0,
      maxDailyReplacements: 2,
      selectorReplacementScoreDelta: 0.05,
    });

    expect(result.active.map((item) => item.walletAddress)).toEqual(["0xa1", "0xb1", "0xc1", "0xd1", "0xe1"]);
  });

  it("limits voluntary replacements to maxDailyReplacements while keeping incumbents when they still qualify", () => {
    const entrant = makeCandidate({
      walletAddress: "0xnew",
      leaderboardRank: 1,
      winRate: 85,
      resolvedTrades: 70,
      recentResolvedTrades30d: 20,
    });
    const incumbentA = makeCandidate({
      walletAddress: "0xkeep-a",
      leaderboardRank: 2,
      winRate: 80,
      resolvedTrades: 60,
      recentResolvedTrades30d: 18,
    });
    const incumbentB = makeCandidate({
      walletAddress: "0xkeep-b",
      leaderboardRank: 3,
      winRate: 78,
      resolvedTrades: 55,
      recentResolvedTrades30d: 16,
    });
    const blockedEntrant = makeCandidate({
      walletAddress: "0xnew-too-many",
      leaderboardRank: 4,
      winRate: 77,
      resolvedTrades: 54,
      recentResolvedTrades30d: 16,
    });

    const result = selectWalletsWithBench({
      candidates: [entrant, incumbentA, incumbentB, blockedEntrant],
      previousWatchlist: [makeWatchedWallet(incumbentA, 1), makeWatchedWallet(incumbentB, 2)],
      targetActiveCount: 2,
      targetBenchCount: 0,
      maxDailyReplacements: 1,
      selectorReplacementScoreDelta: 0.05,
    });

    expect(result.active.map((item) => item.walletAddress)).toEqual(["0xnew", "0xkeep-a"]);
    expect(result.active.filter((item) => item.walletAddress.startsWith("0xnew")).length).toBe(1);
  });

  it("allows hard-failed incumbents to be replaced even when voluntary replacements are zero", () => {
    const healthyIncumbent = makeCandidate({
      walletAddress: "0xhealthy",
      leaderboardRank: 1,
      winRate: 80,
      resolvedTrades: 65,
      recentResolvedTrades30d: 18,
    });
    const failingIncumbent = makeCandidate({
      walletAddress: "0xfailing",
      leaderboardRank: 2,
      winRate: 58,
      resolvedTrades: 45,
      recentResolvedTrades30d: 6,
    });
    const replacement = makeCandidate({
      walletAddress: "0xreplacement",
      leaderboardRank: 3,
      winRate: 79,
      resolvedTrades: 55,
      recentResolvedTrades30d: 15,
    });

    const result = selectWalletsWithBench({
      candidates: [healthyIncumbent, failingIncumbent, replacement],
      previousWatchlist: [makeWatchedWallet(healthyIncumbent, 1), makeWatchedWallet(failingIncumbent, 2)],
      targetActiveCount: 2,
      targetBenchCount: 0,
      maxDailyReplacements: 0,
      selectorReplacementScoreDelta: 0.05,
    });

    expect(result.active.map((item) => item.walletAddress)).toEqual(["0xhealthy", "0xreplacement"]);
  });

  it("flags resolved-trade counts that hit the closed-position fetch ceiling", () => {
    const truncated = makeCandidate({
      walletAddress: "0xtruncated",
      leaderboardRank: 1,
      winRate: 80,
      resolvedTrades: 200,
      recentResolvedTrades30d: 30,
      closedPositionsFetchCeiling: 200,
      category: "sports",
    });

    expect(truncated.resolvedTradesLikelyTruncated).toBe(true);
    expect(truncated.closedPositionsFetchCeiling).toBe(200);
    expect(truncated.snapshot.resolvedTradesLikelyTruncated).toBe(true);
  });

  it("builds a 20-wallet active set with a sports-heavy cap and a non-sports floor", () => {
    const sports = Array.from({ length: 12 }, (_, index) => makeCandidate({
      walletAddress: `0xsports${index}`,
      leaderboardRank: index + 1,
      winRate: 90 - index * 0.2,
      resolvedTrades: 80 - index,
      recentResolvedTrades30d: 20,
      category: "sports",
    }));
    const nonSports = Array.from({ length: 12 }, (_, index) => makeCandidate({
      walletAddress: `0xpolitics${index}`,
      leaderboardRank: index + 20,
      winRate: 78 - index * 0.1,
      resolvedTrades: 60 - index,
      recentResolvedTrades30d: 16,
      category: "politics",
    }));

    const result = selectWalletsWithBench({
      candidates: [...sports, ...nonSports],
      previousWatchlist: sports.slice(0, 10).map((candidate, index) => makeWatchedWallet(candidate, index + 1)),
      targetActiveCount: 20,
      targetBenchCount: 0,
      maxDailyReplacements: 4,
      selectorReplacementScoreDelta: 0.05,
    });

    expect(result.active).toHaveLength(20);
    expect(result.active.filter((candidate) => candidate.sportsHeavy)).toHaveLength(8);
    expect(result.active.filter((candidate) => !candidate.sportsHeavy).length).toBeGreaterThanOrEqual(6);
  });
});
