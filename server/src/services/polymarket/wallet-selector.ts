import type {
  PolymarketCopyWalletComponentScores,
  PolymarketCopyWalletStatus,
  PolymarketCopyWatchedWallet,
} from "@paperclipai/shared";
import { latestTradeDate, type PolymarketClosedPositionEntry, type PolymarketLeaderboardEntry, type PolymarketPositionEntry, type PolymarketTradeEntry } from "./official-client.js";
import { safeDate, type PolymarketCopyWeightSet } from "./shared.js";

export interface WalletSelectorCandidateInput {
  walletAddress: string;
  label: string | null;
  leaderboard: PolymarketLeaderboardEntry;
  positions: PolymarketPositionEntry[];
  closedPositions: PolymarketClosedPositionEntry[];
  trades: PolymarketTradeEntry[];
  now: Date;
}

export interface WalletSelectorCandidateScore {
  walletAddress: string;
  label: string | null;
  leaderboardRank: number | null;
  volume: number;
  pnl: number;
  openMarketCount: number;
  closedMarketCount: number;
  recentTradeCount: number;
  recentTradeAt: Date | null;
  concentrationRatio: number;
  componentScores: PolymarketCopyWalletComponentScores;
  compositeScore: number;
  eligible: boolean;
  eligibilityReasons: string[];
  snapshot: Record<string, unknown>;
}

export interface WalletSelectorDecision {
  walletAddress: string;
  status: PolymarketCopyWalletStatus;
  rank: number | null;
  replacementReason: string | null;
}

export interface WalletSelectionResult {
  active: WalletSelectorCandidateScore[];
  bench: WalletSelectorCandidateScore[];
  rejected: WalletSelectorCandidateScore[];
  decisions: WalletSelectorDecision[];
  replacements: Array<{ walletAddress: string; reason: string }>;
}

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

export function scoreWalletCandidate(
  input: WalletSelectorCandidateInput,
  weights: PolymarketCopyWeightSet,
): WalletSelectorCandidateScore {
  const openCount = input.positions.length;
  const closedCount = input.closedPositions.length;
  const recentTradeAt = latestTradeDate(input.trades);
  const volume = Number(input.leaderboard.vol ?? 0);
  const pnl = Number(input.leaderboard.pnl ?? 0);
  const currentExposure = input.positions.reduce((sum, position) => sum + Math.max(0, position.currentValue ?? 0), 0);
  const biggestPosition = input.positions.reduce((max, position) => Math.max(max, position.currentValue ?? 0), 0);
  const concentrationRatio = currentExposure > 0 ? biggestPosition / currentExposure : 1;
  const positiveClosedCount = input.closedPositions.filter((position) => (position.realizedPnl ?? 0) > 0).length;
  const avgClosedPnl =
    closedCount > 0
      ? input.closedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0) / closedCount
      : 0;
  const daysSinceRecentTrade =
    recentTradeAt == null
      ? Number.POSITIVE_INFINITY
      : (input.now.getTime() - recentTradeAt.getTime()) / (24 * 60 * 60 * 1000);
  const recency = recentTradeAt == null ? 0 : clamp01(1 - daysSinceRecentTrade / 7);
  const efficiency = clamp01((ratio(Math.max(0, pnl), Math.max(volume, 1)) * 4) + ratio(Math.max(0, avgClosedPnl), 1_000));
  const consistency = clamp01(
    closedCount > 0
      ? positiveClosedCount / closedCount
      : input.positions.length > 0
        ? clamp01(ratio(input.positions.filter((position) => (position.cashPnl ?? 0) >= 0).length, openCount))
        : 0,
  );
  const diversification = clamp01(
    (new Set([
      ...input.positions.map((position) => position.eventSlug || position.slug || position.conditionId),
      ...input.closedPositions.map((position) => position.eventSlug || position.slug || position.conditionId),
    ]).size) / 12,
  );
  const concentrationPenalty = clamp01(concentrationRatio);

  const composite =
    efficiency * weights.efficiency +
    consistency * weights.consistency +
    diversification * weights.diversification +
    recency * weights.recency -
    concentrationPenalty * weights.concentrationPenalty;

  const eligibilityReasons: string[] = [];
  if (volume <= 0) eligibilityReasons.push("no_volume");
  if (recentTradeAt == null) eligibilityReasons.push("no_recent_activity");
  if (daysSinceRecentTrade > 14) eligibilityReasons.push("stale_activity");
  if (openCount + closedCount < 3) eligibilityReasons.push("insufficient_history");
  if (concentrationRatio > 0.9 && openCount <= 1) eligibilityReasons.push("overconcentrated");

  return {
    walletAddress: input.walletAddress,
    label: input.label,
    leaderboardRank: Number(input.leaderboard.rank || 0) || null,
    volume,
    pnl,
    openMarketCount: openCount,
    closedMarketCount: closedCount,
    recentTradeCount: input.trades.length,
    recentTradeAt,
    concentrationRatio: round4(concentrationRatio),
    componentScores: {
      efficiency: round4(efficiency),
      consistency: round4(consistency),
      diversification: round4(diversification),
      recency: round4(recency),
      concentrationPenalty: round4(concentrationPenalty),
    },
    compositeScore: round4(composite),
    eligible: eligibilityReasons.length === 0,
    eligibilityReasons,
    snapshot: {
      leaderboard: {
        rank: input.leaderboard.rank,
        pnl: input.leaderboard.pnl,
        volume: input.leaderboard.vol,
      },
      positionCount: openCount,
      closedPositionCount: closedCount,
      latestTradeAt: recentTradeAt?.toISOString() ?? null,
      currentExposure,
    },
  };
}

function sortByScore(candidates: WalletSelectorCandidateScore[]): WalletSelectorCandidateScore[] {
  return candidates.slice().sort((left, right) => {
    if (right.compositeScore !== left.compositeScore) {
      return right.compositeScore - left.compositeScore;
    }
    return (left.leaderboardRank ?? Number.MAX_SAFE_INTEGER) - (right.leaderboardRank ?? Number.MAX_SAFE_INTEGER);
  });
}

export function selectWalletsWithBench(options: {
  candidates: WalletSelectorCandidateScore[];
  previousWatchlist: PolymarketCopyWatchedWallet[];
  targetActiveCount: number;
  targetBenchCount: number;
  maxDailyReplacements: number;
  selectorReplacementScoreDelta: number;
}): WalletSelectionResult {
  const eligible = sortByScore(options.candidates.filter((candidate) => candidate.eligible));
  const rejected = sortByScore(options.candidates.filter((candidate) => !candidate.eligible));
  const previousActive = options.previousWatchlist.filter((wallet) => wallet.status === "active");
  const previousActiveSet = new Set(previousActive.map((wallet) => wallet.walletAddress));
  const eligibleMap = new Map(eligible.map((candidate) => [candidate.walletAddress, candidate]));
  const activeCutoff = eligible[options.targetActiveCount - 1]?.compositeScore ?? -1;

  let allowedNewEntrants =
    previousActive.length === 0
      ? options.targetActiveCount
      : options.maxDailyReplacements +
        previousActive.filter((wallet) => !eligibleMap.has(wallet.walletAddress)).length;

  const active: WalletSelectorCandidateScore[] = [];
  const replacementReasons = new Map<string, string>();

  for (const wallet of previousActive) {
    const candidate = eligibleMap.get(wallet.walletAddress);
    if (!candidate) {
      replacementReasons.set(wallet.walletAddress, "failed_eligibility");
      continue;
    }
    if (candidate.compositeScore >= activeCutoff - options.selectorReplacementScoreDelta) {
      active.push(candidate);
    }
  }

  for (const candidate of eligible) {
    if (active.length >= options.targetActiveCount) break;
    if (active.some((item) => item.walletAddress === candidate.walletAddress)) continue;
    const isNewEntrant = !previousActiveSet.has(candidate.walletAddress);
    if (isNewEntrant && allowedNewEntrants <= 0) continue;
    active.push(candidate);
    if (isNewEntrant) {
      allowedNewEntrants -= 1;
      replacementReasons.set(candidate.walletAddress, "higher_score");
    }
  }

  if (active.length < options.targetActiveCount) {
    for (const candidate of eligible) {
      if (active.length >= options.targetActiveCount) break;
      if (active.some((item) => item.walletAddress === candidate.walletAddress)) continue;
      active.push(candidate);
    }
  }

  const activeSet = new Set(active.map((candidate) => candidate.walletAddress));
  const bench = eligible
    .filter((candidate) => !activeSet.has(candidate.walletAddress))
    .slice(0, options.targetBenchCount);
  const benchSet = new Set(bench.map((candidate) => candidate.walletAddress));

  return {
    active,
    bench,
    rejected: [...rejected, ...eligible.filter((candidate) => !activeSet.has(candidate.walletAddress) && !benchSet.has(candidate.walletAddress))],
    decisions: options.candidates.map((candidate) => ({
      walletAddress: candidate.walletAddress,
      status: activeSet.has(candidate.walletAddress)
        ? "active"
        : benchSet.has(candidate.walletAddress)
          ? "bench"
          : "rejected",
      rank: activeSet.has(candidate.walletAddress)
        ? active.findIndex((item) => item.walletAddress === candidate.walletAddress) + 1
        : benchSet.has(candidate.walletAddress)
          ? bench.findIndex((item) => item.walletAddress === candidate.walletAddress) + 1 + active.length
          : null,
      replacementReason: replacementReasons.get(candidate.walletAddress) ?? null,
    })),
    replacements: [...replacementReasons.entries()].map(([walletAddress, reason]) => ({ walletAddress, reason })),
  };
}
