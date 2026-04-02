import type {
  PolymarketCopyWalletComponentScores,
  PolymarketCopyWalletStatus,
  PolymarketCopyWatchedWallet,
} from "@paperclipai/shared";
import {
  latestTradeDate,
  type PolymarketClosedPositionEntry,
  type PolymarketLeaderboardEntry,
  type PolymarketPositionEntry,
  type PolymarketTradeEntry,
} from "./official-client.js";
import { secondsToDate, type PolymarketCopyWeightSet } from "./shared.js";

const RECENT_ACTIVITY_WINDOW_DAYS = 30;
const STALE_ACTIVITY_DROP_DAYS = 14;
const ACTIVE_WIN_RATE_PREFERRED = 70;
const ACTIVE_WIN_RATE_FALLBACK = 65;
const ACTIVE_RESOLVED_TRADES_MIN = 30;
const ACTIVE_RECENT_RESOLVED_TRADES_MIN = 12;
const BENCH_WIN_RATE_MIN = 75;
const BENCH_RESOLVED_TRADES_MIN = 15;
const BENCH_RESOLVED_TRADES_MAX = 29;
const BENCH_RECENT_RESOLVED_TRADES_MIN = 8;
const DROP_WIN_RATE_MIN = 60;
const DROP_RECENT_RESOLVED_TRADES_MIN = 8;
const ACTIVE_SET_MAX_SPORTS_HEAVY = 8;
const ACTIVE_SET_MIN_NON_SPORTS = 6;
const SPORTS_HEAVY_SHARE_PCT = 60;

type WalletSelectorActiveEligibilityTier = "preferred" | "fallback";
type WalletActivityCategory = "sports" | "politics" | "crypto" | "business" | "world" | "culture" | "other";

type WalletActivitySample = {
  title: string | null;
  slug: string | null;
  eventSlug: string | null;
};

type WalletCategoryMixEntry = {
  category: WalletActivityCategory;
  count: number;
  sharePct: number;
};

const CATEGORY_PATTERNS: Array<{ category: WalletActivityCategory; pattern: RegExp }> = [
  {
    category: "sports",
    pattern: /\b(nfl|nba|wnba|mlb|nhl|ncaa|soccer|football|basketball|baseball|hockey|golf|tennis|cricket|boxing|ufc|mma|formula\s?1|f1|nascar|premier\sleague|champions\sleague|la\sliga|serie\sa|bundesliga|world\scup|super\sbowl|march\smadness|stanley\scup|wimbledon|masters|olympics)\b|(?:^|[-\s])vs(?:$|[-\s])/i,
  },
  {
    category: "politics",
    pattern: /\b(election|primary|senate|house|president|presidential|congress|governor|mayor|parliament|minister|approval|trump|biden|democrat|republican|gop|policy|vote|voting|campaign)\b/i,
  },
  {
    category: "crypto",
    pattern: /\b(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|xrp|token|crypto|stablecoin|defi|airdrop|memecoin)\b/i,
  },
  {
    category: "business",
    pattern: /\b(stock|stocks|earnings|revenue|ipo|valuation|tesla|nvidia|apple|microsoft|google|amazon|meta|openai|company|fed|inflation|gdp|oil)\b/i,
  },
  {
    category: "world",
    pattern: /\b(ukraine|russia|china|taiwan|israel|gaza|ceasefire|war|tariff|treaty|nato|united\snations|earthquake|hurricane|storm)\b/i,
  },
  {
    category: "culture",
    pattern: /\b(oscars|grammys|emmys|movie|film|album|song|celebrity|streaming|festival|tv|television|box\soffice)\b/i,
  },
];

export interface WalletSelectorCandidateInput {
  walletAddress: string;
  label: string | null;
  leaderboard: PolymarketLeaderboardEntry;
  positions: PolymarketPositionEntry[];
  closedPositions: PolymarketClosedPositionEntry[];
  trades: PolymarketTradeEntry[];
  now: Date;
  closedPositionsFetchCeiling?: number | null;
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
  lastActivityAt: Date | null;
  winRate: number;
  resolvedTrades: number;
  recentResolvedTrades30d: number;
  hasRecentActivity: boolean;
  activeEligibilityTier: WalletSelectorActiveEligibilityTier | null;
  benchEligible: boolean;
  demotionReasons: string[];
  dominantCategory: WalletActivityCategory;
  recentCategoryMix: WalletCategoryMixEntry[];
  sportsActivitySharePct: number;
  sportsHeavy: boolean;
  diversified: boolean;
  resolvedTradesLikelyTruncated: boolean;
  closedPositionsFetchCeiling: number | null;
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

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function daysSince(date: Date | null, now: Date): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
}

function newestDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

function latestClosedPositionDate(closedPositions: PolymarketClosedPositionEntry[]): Date | null {
  const latest = closedPositions.reduce<number | null>((max, position) => {
    if (!Number.isFinite(position.timestamp)) return max;
    return max == null || position.timestamp > max ? position.timestamp : max;
  }, null);
  return secondsToDate(latest);
}

function countRecentResolvedTrades(
  closedPositions: PolymarketClosedPositionEntry[],
  now: Date,
  windowDays: number,
): number {
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return closedPositions.filter((position) => {
    const resolvedAt = secondsToDate(position.timestamp);
    return resolvedAt != null && resolvedAt.getTime() >= cutoffMs;
  }).length;
}

function compareCopyRank(left: WalletSelectorCandidateScore, right: WalletSelectorCandidateScore): number {
  if (right.winRate !== left.winRate) return right.winRate - left.winRate;
  if (right.resolvedTrades !== left.resolvedTrades) return right.resolvedTrades - left.resolvedTrades;
  if (right.recentResolvedTrades30d !== left.recentResolvedTrades30d) {
    return right.recentResolvedTrades30d - left.recentResolvedTrades30d;
  }
  const rightActivity = right.lastActivityAt?.getTime() ?? 0;
  const leftActivity = left.lastActivityAt?.getTime() ?? 0;
  if (rightActivity !== leftActivity) return rightActivity - leftActivity;
  if (right.compositeScore !== left.compositeScore) return right.compositeScore - left.compositeScore;
  return (left.leaderboardRank ?? Number.MAX_SAFE_INTEGER) - (right.leaderboardRank ?? Number.MAX_SAFE_INTEGER);
}

function compareVoluntaryRemovalPriority(left: WalletSelectorCandidateScore, right: WalletSelectorCandidateScore): number {
  if (left.sportsHeavy !== right.sportsHeavy) return Number(right.sportsHeavy) - Number(left.sportsHeavy);
  return compareCopyRank(right, left);
}

function sortByCopyRank(candidates: WalletSelectorCandidateScore[]): WalletSelectorCandidateScore[] {
  return candidates.slice().sort(compareCopyRank);
}

function normalizeActivityText(sample: WalletActivitySample): string {
  return [sample.title, sample.slug, sample.eventSlug]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function classifyWalletActivityCategory(sample: WalletActivitySample): WalletActivityCategory {
  const haystack = normalizeActivityText(sample);
  if (haystack.length === 0) return "other";
  for (const entry of CATEGORY_PATTERNS) {
    if (entry.pattern.test(haystack)) return entry.category;
  }
  return "other";
}

function buildRecentActivitySamples(input: WalletSelectorCandidateInput): WalletActivitySample[] {
  const cutoffMs = input.now.getTime() - RECENT_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentClosedPositions = input.closedPositions
    .filter((position) => {
      const resolvedAt = secondsToDate(position.timestamp);
      return resolvedAt != null && resolvedAt.getTime() >= cutoffMs;
    })
    .map((position) => ({
      title: position.title ?? null,
      slug: position.slug ?? null,
      eventSlug: position.eventSlug ?? null,
    }));
  const recentTrades = input.trades
    .filter((trade) => {
      const tradeAt = secondsToDate(trade.timestamp);
      return tradeAt != null && tradeAt.getTime() >= cutoffMs;
    })
    .map((trade) => ({
      title: trade.title ?? null,
      slug: trade.slug ?? null,
      eventSlug: trade.eventSlug ?? null,
    }));

  const recent = [...recentTrades, ...recentClosedPositions];
  if (recent.length > 0) return recent;

  return [
    ...input.trades.map((trade) => ({
      title: trade.title ?? null,
      slug: trade.slug ?? null,
      eventSlug: trade.eventSlug ?? null,
    })),
    ...input.closedPositions.map((position) => ({
      title: position.title ?? null,
      slug: position.slug ?? null,
      eventSlug: position.eventSlug ?? null,
    })),
    ...input.positions.map((position) => ({
      title: position.title ?? null,
      slug: position.slug ?? null,
      eventSlug: position.eventSlug ?? null,
    })),
  ];
}

function buildCategoryProfile(input: WalletSelectorCandidateInput): {
  dominantCategory: WalletActivityCategory;
  recentCategoryMix: WalletCategoryMixEntry[];
  sportsActivitySharePct: number;
  sportsHeavy: boolean;
  diversified: boolean;
  recentCategoryMixLabel: string;
  activitySampleCount: number;
} {
  const samples = buildRecentActivitySamples(input);
  const counts = new Map<WalletActivityCategory, number>();

  for (const sample of samples) {
    const category = classifyWalletActivityCategory(sample);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const total = samples.length;
  const recentCategoryMix = [...counts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      sharePct: total > 0 ? round2((count / total) * 100) : 0,
    }))
    .sort((left, right) => {
      if (right.sharePct !== left.sharePct) return right.sharePct - left.sharePct;
      return right.count - left.count;
    });

  const dominantCategory = recentCategoryMix[0]?.category ?? "other";
  const sportsActivitySharePct = recentCategoryMix.find((entry) => entry.category === "sports")?.sharePct ?? 0;
  const sportsHeavy = sportsActivitySharePct >= SPORTS_HEAVY_SHARE_PCT;
  const diversified = recentCategoryMix.length >= 2 && !sportsHeavy;
  const recentCategoryMixLabel = recentCategoryMix.length > 0
    ? recentCategoryMix.slice(0, 3).map((entry) => `${entry.category} ${entry.sharePct}%`).join(" · ")
    : "unclassified activity";

  return {
    dominantCategory,
    recentCategoryMix,
    sportsActivitySharePct,
    sportsHeavy,
    diversified,
    recentCategoryMixLabel,
    activitySampleCount: total,
  };
}

function buildDiversifiedTargetPool(
  rankedActiveEligible: WalletSelectorCandidateScore[],
  targetActiveCount: number,
): WalletSelectorCandidateScore[] {
  const selected: WalletSelectorCandidateScore[] = [];
  const selectedSet = new Set<string>();
  let sportsCount = 0;
  let nonSportsCount = 0;
  const maxSportsHeavy = Math.min(ACTIVE_SET_MAX_SPORTS_HEAVY, targetActiveCount);
  const desiredNonSports = Math.min(
    ACTIVE_SET_MIN_NON_SPORTS,
    rankedActiveEligible.filter((candidate) => !candidate.sportsHeavy).length,
    targetActiveCount,
  );

  function tryAdd(candidate: WalletSelectorCandidateScore): boolean {
    if (selected.length >= targetActiveCount) return false;
    if (selectedSet.has(candidate.walletAddress)) return false;
    if (candidate.sportsHeavy && sportsCount >= maxSportsHeavy) return false;
    selected.push(candidate);
    selectedSet.add(candidate.walletAddress);
    if (candidate.sportsHeavy) sportsCount += 1;
    else nonSportsCount += 1;
    return true;
  }

  for (const candidate of rankedActiveEligible) {
    if (nonSportsCount >= desiredNonSports) break;
    if (candidate.sportsHeavy) continue;
    tryAdd(candidate);
  }

  for (const candidate of rankedActiveEligible) {
    if (selected.length >= targetActiveCount) break;
    tryAdd(candidate);
  }

  return selected;
}

export function scoreWalletCandidate(
  input: WalletSelectorCandidateInput,
  weights: PolymarketCopyWeightSet,
): WalletSelectorCandidateScore {
  const openCount = input.positions.length;
  const resolvedTrades = input.closedPositions.length;
  const recentTradeAt = latestTradeDate(input.trades);
  const latestResolvedAt = latestClosedPositionDate(input.closedPositions);
  const lastActivityAt = newestDate(recentTradeAt, latestResolvedAt);
  const volume = Number(input.leaderboard.vol ?? 0);
  const pnl = Number(input.leaderboard.pnl ?? 0);
  const currentExposure = input.positions.reduce((sum, position) => sum + Math.max(0, position.currentValue ?? 0), 0);
  const biggestPosition = input.positions.reduce((max, position) => Math.max(max, position.currentValue ?? 0), 0);
  const concentrationRatio = currentExposure > 0 ? biggestPosition / currentExposure : 1;
  const positiveResolvedTrades = input.closedPositions.filter((position) => (position.realizedPnl ?? 0) > 0).length;
  const recentResolvedTrades30d = countRecentResolvedTrades(input.closedPositions, input.now, RECENT_ACTIVITY_WINDOW_DAYS);
  const winRateRaw = resolvedTrades > 0 ? positiveResolvedTrades / resolvedTrades : 0;
  const winRate = round2(winRateRaw * 100);
  const daysSinceLastActivity = daysSince(lastActivityAt, input.now);
  const hasRecentActivity = daysSinceLastActivity <= RECENT_ACTIVITY_WINDOW_DAYS;
  const hasMeaningfulActivityIn14d = daysSinceLastActivity <= STALE_ACTIVITY_DROP_DAYS;
  const categoryProfile = buildCategoryProfile(input);
  const closedPositionsFetchCeiling =
    typeof input.closedPositionsFetchCeiling === "number" && Number.isFinite(input.closedPositionsFetchCeiling)
      ? Math.max(0, Math.floor(input.closedPositionsFetchCeiling))
      : null;
  const resolvedTradesLikelyTruncated =
    closedPositionsFetchCeiling != null && closedPositionsFetchCeiling > 0 && resolvedTrades >= closedPositionsFetchCeiling;

  const activeEligibilityTier: WalletSelectorActiveEligibilityTier | null =
    winRate >= ACTIVE_WIN_RATE_PREFERRED &&
      resolvedTrades >= ACTIVE_RESOLVED_TRADES_MIN &&
      recentResolvedTrades30d >= ACTIVE_RECENT_RESOLVED_TRADES_MIN &&
      hasRecentActivity
      ? "preferred"
      : winRate >= ACTIVE_WIN_RATE_FALLBACK &&
          resolvedTrades >= ACTIVE_RESOLVED_TRADES_MIN &&
          recentResolvedTrades30d >= ACTIVE_RECENT_RESOLVED_TRADES_MIN &&
          hasRecentActivity
        ? "fallback"
        : null;

  const benchEligible =
    activeEligibilityTier == null &&
    winRate >= BENCH_WIN_RATE_MIN &&
    resolvedTrades >= BENCH_RESOLVED_TRADES_MIN &&
    resolvedTrades <= BENCH_RESOLVED_TRADES_MAX &&
    recentResolvedTrades30d >= BENCH_RECENT_RESOLVED_TRADES_MIN &&
    hasRecentActivity;

  const demotionReasons: string[] = [];
  if (winRate < DROP_WIN_RATE_MIN) demotionReasons.push("win_rate_below_60");
  if (recentResolvedTrades30d < DROP_RECENT_RESOLVED_TRADES_MIN) demotionReasons.push("recent_resolved_trades_30d_below_8");
  if (!hasMeaningfulActivityIn14d) demotionReasons.push("no_meaningful_activity_14d");

  const winRateScore = clamp01(winRate / 100);
  const longevityScore = clamp01(resolvedTrades / 60);
  const recentResolvedScore = clamp01(recentResolvedTrades30d / 20);
  const activityScore = hasRecentActivity ? clamp01(1 - daysSinceLastActivity / RECENT_ACTIVITY_WINDOW_DAYS) : 0;
  const concentrationPenalty = clamp01(concentrationRatio);
  const composite =
    winRateScore * weights.efficiency +
    longevityScore * weights.consistency +
    recentResolvedScore * weights.diversification +
    activityScore * weights.recency -
    concentrationPenalty * weights.concentrationPenalty;

  const eligibilityReasons: string[] = [];
  if (winRate < ACTIVE_WIN_RATE_FALLBACK) eligibilityReasons.push("win_rate_below_65");
  if (resolvedTrades < ACTIVE_RESOLVED_TRADES_MIN) eligibilityReasons.push("resolved_trades_below_30");
  if (recentResolvedTrades30d < ACTIVE_RECENT_RESOLVED_TRADES_MIN) {
    eligibilityReasons.push("recent_resolved_trades_30d_below_12");
  }
  if (!hasRecentActivity) eligibilityReasons.push("no_recent_activity_30d");
  if (benchEligible) eligibilityReasons.push("bench_only_not_fully_proven");

  return {
    walletAddress: input.walletAddress,
    label: input.label,
    leaderboardRank: Number(input.leaderboard.rank || 0) || null,
    volume,
    pnl,
    openMarketCount: openCount,
    closedMarketCount: resolvedTrades,
    recentTradeCount: input.trades.length,
    recentTradeAt,
    lastActivityAt,
    winRate,
    resolvedTrades,
    recentResolvedTrades30d,
    hasRecentActivity,
    activeEligibilityTier,
    benchEligible,
    demotionReasons,
    dominantCategory: categoryProfile.dominantCategory,
    recentCategoryMix: categoryProfile.recentCategoryMix,
    sportsActivitySharePct: categoryProfile.sportsActivitySharePct,
    sportsHeavy: categoryProfile.sportsHeavy,
    diversified: categoryProfile.diversified,
    resolvedTradesLikelyTruncated,
    closedPositionsFetchCeiling,
    concentrationRatio: round4(concentrationRatio),
    componentScores: {
      efficiency: round4(winRateScore),
      consistency: round4(longevityScore),
      diversification: round4(recentResolvedScore),
      recency: round4(activityScore),
      concentrationPenalty: round4(concentrationPenalty),
    },
    compositeScore: round4(composite),
    eligible: activeEligibilityTier != null || benchEligible,
    eligibilityReasons,
    snapshot: {
      leaderboard: {
        rank: input.leaderboard.rank,
        pnl: input.leaderboard.pnl,
        volume: input.leaderboard.vol,
      },
      winRate,
      resolvedTrades,
      positiveResolvedTrades,
      recentResolvedTrades30d,
      recentTradeCount: input.trades.length,
      latestTradeAt: recentTradeAt?.toISOString() ?? null,
      latestResolvedAt: latestResolvedAt?.toISOString() ?? null,
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
      hasRecentActivity,
      hasMeaningfulActivityIn14d,
      activeEligibilityTier,
      benchEligible,
      demotionReasons,
      dominantCategory: categoryProfile.dominantCategory,
      recentCategoryMix: categoryProfile.recentCategoryMix,
      recentCategoryMixLabel: categoryProfile.recentCategoryMixLabel,
      sportsActivitySharePct: categoryProfile.sportsActivitySharePct,
      sportsHeavy: categoryProfile.sportsHeavy,
      diversified: categoryProfile.diversified,
      activitySampleCount: categoryProfile.activitySampleCount,
      resolvedTradesLikelyTruncated,
      closedPositionsFetchCeiling,
      positionCount: openCount,
      closedPositionCount: resolvedTrades,
      currentExposure,
    },
  };
}

export function selectWalletsWithBench(options: {
  candidates: WalletSelectorCandidateScore[];
  previousWatchlist: PolymarketCopyWatchedWallet[];
  targetActiveCount: number;
  targetBenchCount: number;
  maxDailyReplacements: number;
  selectorReplacementScoreDelta: number;
}): WalletSelectionResult {
  const rankedActiveEligible = sortByCopyRank(
    options.candidates.filter((candidate) => candidate.activeEligibilityTier != null),
  );
  const rankedBenchEligible = sortByCopyRank(
    options.candidates.filter((candidate) => candidate.activeEligibilityTier == null && candidate.benchEligible),
  );
  const idealActive = buildDiversifiedTargetPool(rankedActiveEligible, options.targetActiveCount);
  const idealActiveSet = new Set(idealActive.map((candidate) => candidate.walletAddress));
  const previousActive = options.previousWatchlist.filter((wallet) => wallet.status === "active");
  const candidateByWallet = new Map(options.candidates.map((candidate) => [candidate.walletAddress, candidate]));
  const forcedRemovalSet = new Set<string>();

  for (const wallet of previousActive) {
    const candidate = candidateByWallet.get(wallet.walletAddress);
    if (!candidate || candidate.activeEligibilityTier == null || candidate.demotionReasons.length > 0) {
      forcedRemovalSet.add(wallet.walletAddress);
    }
  }

  const voluntaryRemovalCandidates = previousActive
    .map((wallet) => candidateByWallet.get(wallet.walletAddress) ?? null)
    .filter((candidate): candidate is WalletSelectorCandidateScore =>
      candidate != null
      && !forcedRemovalSet.has(candidate.walletAddress)
      && candidate.activeEligibilityTier != null
      && !idealActiveSet.has(candidate.walletAddress),
    )
    .sort(compareVoluntaryRemovalPriority);
  const plannedVoluntaryRemovalSet = new Set(
    voluntaryRemovalCandidates.slice(0, options.maxDailyReplacements).map((candidate) => candidate.walletAddress),
  );
  const blockedIncumbentSet = new Set([...forcedRemovalSet, ...plannedVoluntaryRemovalSet]);
  const carryoverIncumbents = sortByCopyRank(
    previousActive
      .map((wallet) => candidateByWallet.get(wallet.walletAddress) ?? null)
      .filter((candidate): candidate is WalletSelectorCandidateScore =>
        candidate != null
        && candidate.activeEligibilityTier != null
        && !blockedIncumbentSet.has(candidate.walletAddress),
      ),
  );

  const openSlots = Math.max(0, options.targetActiveCount - previousActive.length);
  const allowedNewEntrants =
    previousActive.length === 0
      ? options.targetActiveCount
      : plannedVoluntaryRemovalSet.size + forcedRemovalSet.size + openSlots;
  const desiredNonSports = Math.min(
    ACTIVE_SET_MIN_NON_SPORTS,
    rankedActiveEligible.filter((candidate) => !candidate.sportsHeavy).length,
    options.targetActiveCount,
  );
  const maxSportsHeavy = Math.min(ACTIVE_SET_MAX_SPORTS_HEAVY, options.targetActiveCount);

  const active: WalletSelectorCandidateScore[] = [];
  const activeSet = new Set<string>();
  const replacementReasons = new Map<string, string>();
  let sportsCount = 0;
  let nonSportsCount = 0;
  let newEntrantsUsed = 0;

  function addIncumbent(candidate: WalletSelectorCandidateScore): boolean {
    if (active.length >= options.targetActiveCount) return false;
    if (activeSet.has(candidate.walletAddress)) return false;
    active.push(candidate);
    activeSet.add(candidate.walletAddress);
    if (candidate.sportsHeavy) sportsCount += 1;
    else nonSportsCount += 1;
    return true;
  }

  function addEntrant(candidate: WalletSelectorCandidateScore, reason: string): boolean {
    if (active.length >= options.targetActiveCount) return false;
    if (activeSet.has(candidate.walletAddress)) return false;
    if (blockedIncumbentSet.has(candidate.walletAddress)) return false;
    if (candidate.sportsHeavy && sportsCount >= maxSportsHeavy) return false;
    if (newEntrantsUsed >= allowedNewEntrants) return false;
    active.push(candidate);
    activeSet.add(candidate.walletAddress);
    if (candidate.sportsHeavy) sportsCount += 1;
    else nonSportsCount += 1;
    newEntrantsUsed += 1;
    replacementReasons.set(candidate.walletAddress, reason);
    return true;
  }

  for (const candidate of carryoverIncumbents) {
    if (active.length >= options.targetActiveCount) break;
    addIncumbent(candidate);
  }

  for (const candidate of idealActive) {
    if (nonSportsCount >= desiredNonSports) break;
    if (candidate.sportsHeavy) continue;
    addEntrant(candidate, "diversified_copy_rank_upgrade");
  }

  for (const candidate of idealActive) {
    if (active.length >= options.targetActiveCount) break;
    const reason = candidate.sportsHeavy ? "sports_cap_limited_copy_rank_upgrade" : "higher_copy_rank";
    addEntrant(candidate, reason);
  }

  for (const candidate of rankedActiveEligible) {
    if (active.length >= options.targetActiveCount) break;
    const reason = candidate.sportsHeavy ? "sports_cap_limited_copy_rank_upgrade" : "higher_copy_rank";
    addEntrant(candidate, reason);
  }

  const bench = rankedBenchEligible
    .filter((candidate) => !activeSet.has(candidate.walletAddress))
    .slice(0, options.targetBenchCount);
  const benchSet = new Set(bench.map((candidate) => candidate.walletAddress));

  const rejected = sortByCopyRank(
    options.candidates.filter((candidate) => !activeSet.has(candidate.walletAddress) && !benchSet.has(candidate.walletAddress)),
  );

  return {
    active,
    bench,
    rejected,
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
