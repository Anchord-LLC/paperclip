import type { AgentEnvConfig } from "./secrets.js";

export type PolymarketCopyMode = "paper" | "live";
export type PolymarketCopyCadence = "5m" | "15m";
export type PolymarketCopyWorkerKey =
  | "wallet-selector-daily"
  | "polymarket-monitor-5m"
  | "polymarket-monitor-15m";
export type PolymarketCopyWalletStatus = "active" | "bench" | "rejected";
export type PolymarketCopyRunStatus = "running" | "success" | "failed" | "skipped";
export type PolymarketCopySignalAction =
  | "new_position"
  | "increased_position"
  | "reduced_position"
  | "closed_position";
export type PolymarketCopySignalDecision = "accepted" | "skipped" | "blocked";
export type PolymarketCopyPaperTradeStatus = "open" | "closed";
export type PolymarketCopyDynamicSizingBasis = "current_exposure";
export type PolymarketCopyKalshiExecutionMode = "disabled" | "dry_run" | "live";
export type PolymarketAuthEnvKey =
  | "POLYMARKET_PRIVATE_KEY"
  | "POLYMARKET_API_KEY"
  | "POLYMARKET_API_SECRET"
  | "POLYMARKET_API_PASSPHRASE"
  | "POLYMARKET_FUNDER_ADDRESS";
export type PolymarketKalshiEnvKey =
  | "KALSHI_API_KEY_ID"
  | "KALSHI_PRIVATE_KEY";
export type PolymarketCopySecretEnvKey = PolymarketAuthEnvKey | PolymarketKalshiEnvKey;
export type PolymarketAuthReadinessResult = "ready" | "incomplete" | "failed";
export type PolymarketAuthDerivationResult = "succeeded" | "failed";

export interface PolymarketCopyRuntimeConfig {
  companyId: string;
  mode: PolymarketCopyMode;
  liveEnabled: boolean;
  tradingKillSwitch: boolean;
  walletSelectionEnabled: boolean;
  walletSelectionTimeZone: string;
  walletSelectionHour: number;
  walletSelectionMinute: number;
  selectorMaxCandidates: number;
  targetWatchedWalletCount: number;
  targetBenchWalletCount: number;
  maxDailyReplacements: number;
  selectorReplacementScoreDelta: number;
  efficiencyWeight: number;
  consistencyWeight: number;
  diversificationWeight: number;
  recencyWeight: number;
  concentrationPenaltyWeight: number;
  minWalletScore: number;
  minSignalMateriality: number;
  maxSpreadBps: number;
  minTradeSizePct: number;
  maxTradeSizePct: number;
  maxExposurePerMarketPct: number;
  maxExposurePerWalletPct: number;
  maxTotalOpenExposurePct: number;
  dynamicSizing: boolean;
  dynamicSizingBasis: PolymarketCopyDynamicSizingBasis;
  positionCountBasedSizing: boolean;
  paperStartingBankrollUsd: number;
  activeTradingCapitalMode: "capped_equity";
  activeTradingCapitalCapUsd: number;
  kalshiExecutionMode: PolymarketCopyKalshiExecutionMode;
  kalshiApiBaseUrl: string;
  monthlyTargetUsd: number;
  profitSweepReserveUsd: number;
  staleSignalThresholdMinutes: number;
  maxExposurePerMarket: number;
  maxTotalOpenPaperExposure: number;
  maxOpenSimulatedPositions: number;
  maxDailySimulatedLoss: number;
  monitor5mEnabled: boolean;
  monitor15mEnabled: boolean;
  monitor5mIntervalMinutes: number;
  monitor15mIntervalMinutes: number;
  paperTradeUsdPerSignal: number;
  artifactRootPath: string | null;
  authEnv: AgentEnvConfig | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PatchPolymarketCopyRuntimeConfig = Partial<
  Omit<PolymarketCopyRuntimeConfig, "companyId" | "createdAt" | "updatedAt">
>;

export interface PolymarketCopyWalletComponentScores {
  efficiency: number;
  consistency: number;
  diversification: number;
  recency: number;
  concentrationPenalty: number;
}

export interface PolymarketCopyWalletSelectionRun {
  id: string;
  companyId: string;
  status: PolymarketCopyRunStatus;
  candidateCount: number;
  activeCount: number;
  benchCount: number;
  replacementCount: number;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  summary: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PolymarketCopyWalletCandidate {
  id: string;
  companyId: string;
  selectionRunId: string;
  walletAddress: string;
  label: string | null;
  source: string;
  leaderboardRank: number | null;
  rank: number | null;
  status: PolymarketCopyWalletStatus;
  eligible: boolean;
  eligibilityReasons: string[] | null;
  volume: number | null;
  pnl: number | null;
  openMarketCount: number;
  closedMarketCount: number;
  recentTradeCount: number;
  recentTradeAt: Date | null;
  concentrationRatio: number | null;
  compositeScore: number;
  componentScores: PolymarketCopyWalletComponentScores;
  snapshot: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PolymarketCopyWatchedWallet {
  id: string;
  companyId: string;
  walletAddress: string;
  label: string | null;
  status: PolymarketCopyWalletStatus;
  sourceSelectionRunId: string | null;
  currentRank: number | null;
  score: number;
  componentScores: PolymarketCopyWalletComponentScores;
  concentrationRatio: number | null;
  lastRefreshedAt: Date;
  activatedAt: Date | null;
  replacedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolymarketCopyWorkerRun {
  id: string;
  companyId: string;
  workerKey: PolymarketCopyWorkerKey;
  cadence: PolymarketCopyCadence | null;
  status: PolymarketCopyRunStatus;
  walletCount: number;
  signalCount: number;
  acceptedCount: number;
  skippedCount: number;
  blockedCount: number;
  details: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolymarketCopySignal {
  id: string;
  companyId: string;
  workerRunId: string | null;
  walletSnapshotId: string | null;
  sourceWalletAddress: string;
  watchedWalletId: string | null;
  walletScore: number | null;
  marketId: string;
  marketSlug: string | null;
  marketTitle: string | null;
  assetId: string | null;
  action: PolymarketCopySignalAction;
  side: string | null;
  sizeDelta: number | null;
  previousSize: number | null;
  currentSize: number | null;
  materialityUsd: number | null;
  detectionTimestamp: Date;
  sourceSnapshotTimestamp: Date | null;
  cadence: PolymarketCopyCadence;
  rawMetadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PolymarketCopySignalDecisionRecord {
  id: string;
  companyId: string;
  signalId: string;
  decision: PolymarketCopySignalDecision;
  reasonCode: string;
  reasonDetail: string | null;
  governorSnapshot: Record<string, unknown> | null;
  decidedAt: Date;
  createdAt: Date;
}

export interface PolymarketCopyPaperTrade {
  id: string;
  companyId: string;
  sourceWalletAddress: string;
  signalId: string | null;
  marketId: string;
  marketSlug: string | null;
  marketTitle: string | null;
  assetId: string | null;
  side: string;
  status: PolymarketCopyPaperTradeStatus;
  quantity: number;
  notionalUsd: number;
  estimatedEntryPrice: number | null;
  currentMarkPrice: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  sourceToCopyDelayMs: number | null;
  assumptionNote: string | null;
  metadata: Record<string, unknown> | null;
  openedAt: Date;
  closedAt: Date | null;
  lastUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolymarketCopyPaperTradeEvent {
  id: string;
  companyId: string;
  paperTradeId: string;
  signalId: string | null;
  eventType: string;
  quantityDelta: number | null;
  price: number | null;
  realizedPnlUsd: number | null;
  unrealizedPnlUsd: number | null;
  assumptions: Record<string, unknown> | null;
  createdAt: Date;
}

export interface PolymarketCopyKalshiMirrorOrder {
  id: string;
  companyId: string;
  signalId: string;
  sourceWalletAddress: string;
  cadence: PolymarketCopyCadence;
  sourceMarketId: string;
  sourceMarketTitle: string | null;
  sourceAction: PolymarketCopySignalAction;
  sourceSide: string | null;
  executionMode: PolymarketCopyKalshiExecutionMode;
  matchStatus: "matched" | "rejected";
  executionStatus: "disabled" | "match_rejected" | "dry_run_recorded" | "live_blocked" | "live_submitted" | "execution_failed";
  rejectionReason: string | null;
  matchConfidence: number | null;
  matchQuality: "high" | "medium" | "low" | null;
  kalshiEventTicker: string | null;
  kalshiMarketTicker: string | null;
  kalshiMarketTitle: string | null;
  kalshiSide: "yes" | "no" | null;
  orderAction: "buy" | "sell" | null;
  contractCount: number | null;
  limitPriceDollars: number | null;
  notionalUsd: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolymarketCopyDashboardOverview {
  mode: PolymarketCopyMode;
  liveEnabled: boolean;
  tradingKillSwitch: boolean;
  watchedWalletCount: number;
  benchCount: number;
  signalsToday: number;
  acceptedCount: number;
  skippedCount: number;
  blockedCount: number;
  paperTradesOpen: number;
  paperTradesClosed: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  lastSuccessful5mRun: Date | null;
  lastSuccessful15mRun: Date | null;
  workerHealth: Record<string, "healthy" | "stale" | "failed" | "idle">;
}

export interface PolymarketCopyPerformancePoint {
  label: string;
  timestamp: Date;
  equityUsd: number;
}

export interface PolymarketCopyPerformanceBar {
  label: string;
  valueUsd: number;
}

export interface PolymarketCopyPerformanceReasonBreakdown {
  reasonCode: string;
  count: number;
}

export interface PolymarketCopyPerformanceTradeSummary {
  label: string;
  walletAddress: string | null;
  marketTitle: string | null;
  pnlUsd: number;
  holdMinutes: number | null;
}

export interface PolymarketCopyPerformanceInsights {
  bestWallet: PolymarketCopyPerformanceBar | null;
  worstWallet: PolymarketCopyPerformanceBar | null;
  bestTrade: PolymarketCopyPerformanceTradeSummary | null;
  worstTrade: PolymarketCopyPerformanceTradeSummary | null;
  averageHoldMinutes: number | null;
  concentrationWarnings: string[];
  botLeader: "5m" | "15m" | "tie" | "insufficient_data";
}

export interface PolymarketCopyAutomationState {
  walletSelectorAutoRunActive: boolean;
  walletSelectorSchedule: string;
  latestWalletSelectionRun: Date | null;
  latestSuccessfulWalletSelectionRun: Date | null;
  monitor5mAutoRunActive: boolean;
  monitor15mAutoRunActive: boolean;
  latestSuccessful5mRun: Date | null;
  latestSuccessful15mRun: Date | null;
}

export interface PolymarketCopyPaperBaseline {
  startedAt: Date;
  source: "manual_marker" | "derived";
  label: string;
  startingBankrollUsd: number;
}

export interface PolymarketCopyPerformanceSummary {
  baseline: PolymarketCopyPaperBaseline;
  totalPnlUsd: number;
  todayPnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  winRatePct: number;
  currentWalletEquityUsd: number;
  activeTradingCapitalUsd: number;
  capitalCapUsd: number;
  capitalProgressPct: number;
  currentExposurePct: number;
  availablePaperCashPct: number;
  activeOpenPositions: number;
  currentExposureUsd: number;
  availablePaperCashUsd: number;
  currentPaperBankrollUsd: number;
  trailing30dRealizedPnlUsd: number;
  monthlyTargetUsd: number;
  targetGapUsd: number;
  targetAchieved: boolean;
  targetProgressPct: number;
  profitSweepReserveUsd: number;
  sweepableProfitUsd: number;
  activeTradingCapitalMode: "capped_equity";
  sourceSignalCount: number;
  kalshiMatchCount: number;
  kalshiRejectedMatchCount: number;
  dryRunMirroredOrders: number;
  topKalshiMarkets: PolymarketCopyPerformanceBar[];
  equityCurve: PolymarketCopyPerformancePoint[];
  dailyPnl: PolymarketCopyPerformanceBar[];
  pnlByWallet: PolymarketCopyPerformanceBar[];
  pnlByBot: PolymarketCopyPerformanceBar[];
  exposureByWallet: PolymarketCopyPerformanceBar[];
  exposureByMarket: PolymarketCopyPerformanceBar[];
  decisionReasons: PolymarketCopyPerformanceReasonBreakdown[];
  insights: PolymarketCopyPerformanceInsights;
  automation: PolymarketCopyAutomationState;
}

export interface PolymarketCopyRiskSummary {
  blockedSignals: PolymarketCopySignalDecisionRecord[];
  thresholdFailures: Array<{
    reasonCode: string;
    count: number;
  }>;
  currentExposureUsd: number;
  dailyRealizedLossUsd: number;
  killSwitch: boolean;
}

export interface PolymarketCopyAuthKeyStatus {
  present: boolean;
  bindingType: "secret_ref" | "missing" | "invalid";
  valid: boolean;
  reasonCode: string | null;
}

export interface PolymarketCopyAuthValidationStatus {
  checkedAt: Date | null;
  result: PolymarketAuthReadinessResult | null;
  summary: string | null;
  validationMode: "config_only" | null;
  reasonCodes: string[];
}

export interface PolymarketCopyAuthDerivationStatus {
  attemptedAt: Date | null;
  result: PolymarketAuthDerivationResult | null;
  reasonCode: string | null;
}

export interface PolymarketCopyAuthReadiness {
  validationMode: "config_only";
  paperModeActive: boolean;
  liveEnabled: boolean;
  tradingKillSwitch: boolean;
  authenticatedLiveReadiness: "ready" | "incomplete";
  canDeriveApiCredentials: boolean;
  keyStatuses: Record<PolymarketAuthEnvKey, PolymarketCopyAuthKeyStatus>;
  reasonCodes: string[];
  summary: string;
  lastValidation: PolymarketCopyAuthValidationStatus;
  lastDerivation: PolymarketCopyAuthDerivationStatus;
}

export interface PolymarketCopyKalshiReadiness {
  checkedAt: Date | null;
  executionMode: PolymarketCopyKalshiExecutionMode;
  authConfigured: boolean;
  marketDataReachable: boolean;
  balancesReachable: boolean;
  positionsReachable: boolean;
  signalSourceActive: boolean;
  marketMatchQualityAvailable: boolean;
  keyStatuses: Record<PolymarketKalshiEnvKey, PolymarketCopyAuthKeyStatus>;
  reasonCodes: string[];
  summary: string;
}

export interface PolymarketCopyDeriveApiCredentialsResult {
  result: PolymarketAuthDerivationResult;
  reasonCode: string | null;
  summary: string;
  readiness: PolymarketCopyAuthReadiness;
  createdSecretNames: string[];
  rotatedSecretNames: string[];
}

export interface PolymarketCopyUnderlyingOwner {
  userId: string;
  name: string | null;
  email: string | null;
  membershipRole: string | null;
}

export interface PolymarketCopyUnderlyingAgentSummary {
  id: string;
  name: string;
  role: string;
  title: string | null;
  status: string;
  adapterType: string;
  docsPath: string | null;
  docsRoot: string | null;
  instructionsRootPath: string | null;
  instructionsEntryFile: string | null;
}

export interface PolymarketCopyUnderlyingRuntimeService {
  key: "wallet_selector" | "monitor_5m" | "monitor_15m" | "risk_governor" | "execution_engine";
  serviceName: string;
  operatingName: string;
  workerKey: string | null;
  docsPath: string | null;
  docsRoot: string | null;
  id: string | null;
  exists: boolean;
  status: string | null;
  provider: string | null;
  scopeType: string | null;
  ownerAgentId: string | null;
}

export interface PolymarketCopyUnderlyingModel {
  deskObjectKind: "company_runtime";
  hasSeparateDeskObject: boolean;
  companyPrefix: string;
  directOwners: PolymarketCopyUnderlyingOwner[];
  ceoAgent: PolymarketCopyUnderlyingAgentSummary | null;
  tradingAnalyst: PolymarketCopyUnderlyingAgentSummary | null;
  runtimeServices: PolymarketCopyUnderlyingRuntimeService[];
}

export interface PolymarketCopyDashboardData {
  companyId: string;
  runtimeConfig: PolymarketCopyRuntimeConfig;
  underlyingModel: PolymarketCopyUnderlyingModel;
  overview: PolymarketCopyDashboardOverview;
  performance: PolymarketCopyPerformanceSummary;
  walletSelectionRuns: PolymarketCopyWalletSelectionRun[];
  watchedWallets: PolymarketCopyWatchedWallet[];
  signals: Array<PolymarketCopySignal & { decision: PolymarketCopySignalDecisionRecord | null }>;
  paperTrades: PolymarketCopyPaperTrade[];
  risk: PolymarketCopyRiskSummary;
  authReadiness: PolymarketCopyAuthReadiness;
  kalshiReadiness: PolymarketCopyKalshiReadiness;
  kalshiMirrorOrders: PolymarketCopyKalshiMirrorOrder[];
  workerRuns: PolymarketCopyWorkerRun[];
  auditLog: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    actorType: string;
    actorId: string;
    details: Record<string, unknown> | null;
    createdAt: Date;
  }>;
}
