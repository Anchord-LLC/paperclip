import { join } from "node:path";
import type {
  AgentEnvConfig,
  PatchPolymarketCopyRuntimeConfig,
  PolymarketCopyCadence,
  PolymarketCopyMode,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignal,
  PolymarketCopyWorkerKey,
} from "@paperclipai/shared";

export const POLYMARKET_COPY_ACTIVITY_PREFIX = "polymarket";
export const POLYMARKET_COPY_SYSTEM_ACTOR_ID = "polymarket-copy-runtime";
export const POLYMARKET_AUTH_ENV_KEYS = [
  "POLYMARKET_PRIVATE_KEY",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_API_PASSPHRASE",
  "POLYMARKET_FUNDER_ADDRESS",
] as const;
export const POLYMARKET_REQUIRED_LIVE_AUTH_ENV_KEYS = [...POLYMARKET_AUTH_ENV_KEYS];

const LEGACY_POLYMARKET_ARTIFACT_ROOT = "/mnt/ssd/paperclip/projects/polymarket";

function defaultPolymarketArtifactRoot(): string {
  const configuredRoot = process.env.POLYMARKET_PROJECT_ROOT?.trim();
  if (configuredRoot) return configuredRoot;
  const paperclipHome = process.env.PAPERCLIP_HOME?.trim() || "/paperclip";
  return join(paperclipHome, "projects", "polymarket");
}

export function normalizePolymarketArtifactRootPath(artifactRootPath: string | null | undefined): string | null {
  if (artifactRootPath == null) return null;
  const trimmed = artifactRootPath.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === LEGACY_POLYMARKET_ARTIFACT_ROOT) return defaultPolymarketArtifactRoot();
  return trimmed;
}

export interface PolymarketCopyDefaults {
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
}

export interface PolymarketCopyWeightSet {
  efficiency: number;
  consistency: number;
  diversification: number;
  recency: number;
  concentrationPenalty: number;
}

export interface PolymarketSpreadSnapshot {
  bestBid: number | null;
  bestAsk: number | null;
  spreadBps: number | null;
  midpoint: number | null;
}

export interface PolymarketSignalMetadata extends Record<string, unknown> {
  currentPrice?: number | null;
  currentValue?: number | null;
  spreadBps?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  latestTradeTimestamp?: string | null;
  sourceNotionalUsd?: number | null;
}

export function getPolymarketCopyDefaults(): PolymarketCopyDefaults {
  const hostTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    mode: "paper",
    liveEnabled: (process.env.POLYMARKET_LIVE_ENABLED ?? "false") === "true",
    tradingKillSwitch: (process.env.POLYMARKET_TRADING_KILL_SWITCH ?? "true") === "true",
    walletSelectionEnabled: true,
    walletSelectionTimeZone: process.env.POLYMARKET_COPY_TIME_ZONE ?? hostTimeZone,
    walletSelectionHour: Number(process.env.POLYMARKET_WALLET_SELECTION_HOUR ?? 6),
    walletSelectionMinute: Number(process.env.POLYMARKET_WALLET_SELECTION_MINUTE ?? 0),
    selectorMaxCandidates: Number(process.env.POLYMARKET_SELECTOR_MAX_CANDIDATES ?? 25),
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
    maxOpenSimulatedPositions: 30,
    maxDailySimulatedLoss: 2_000,
    monitor5mEnabled: true,
    monitor15mEnabled: true,
    monitor5mIntervalMinutes: 5,
    monitor15mIntervalMinutes: 15,
    paperTradeUsdPerSignal: 250,
    artifactRootPath: defaultPolymarketArtifactRoot(),
    authEnv: null,
  };
}

export function toWeightSet(config: Pick<
  PolymarketCopyRuntimeConfig,
  | "efficiencyWeight"
  | "consistencyWeight"
  | "diversificationWeight"
  | "recencyWeight"
  | "concentrationPenaltyWeight"
>): PolymarketCopyWeightSet {
  return {
    efficiency: config.efficiencyWeight,
    consistency: config.consistencyWeight,
    diversification: config.diversificationWeight,
    recency: config.recencyWeight,
    concentrationPenalty: config.concentrationPenaltyWeight,
  };
}

export function mergeRuntimeConfigPatch(
  current: PolymarketCopyRuntimeConfig,
  patch: PatchPolymarketCopyRuntimeConfig,
): PatchPolymarketCopyRuntimeConfig {
  const next = { ...current, ...patch };
  return {
    mode: next.mode,
    liveEnabled: next.liveEnabled,
    tradingKillSwitch: next.tradingKillSwitch,
    walletSelectionEnabled: next.walletSelectionEnabled,
    walletSelectionTimeZone: next.walletSelectionTimeZone,
    walletSelectionHour: next.walletSelectionHour,
    walletSelectionMinute: next.walletSelectionMinute,
    selectorMaxCandidates: next.selectorMaxCandidates,
    targetWatchedWalletCount: next.targetWatchedWalletCount,
    targetBenchWalletCount: next.targetBenchWalletCount,
    maxDailyReplacements: next.maxDailyReplacements,
    selectorReplacementScoreDelta: next.selectorReplacementScoreDelta,
    efficiencyWeight: next.efficiencyWeight,
    consistencyWeight: next.consistencyWeight,
    diversificationWeight: next.diversificationWeight,
    recencyWeight: next.recencyWeight,
    concentrationPenaltyWeight: next.concentrationPenaltyWeight,
    minWalletScore: next.minWalletScore,
    minSignalMateriality: next.minSignalMateriality,
    maxSpreadBps: next.maxSpreadBps,
    staleSignalThresholdMinutes: next.staleSignalThresholdMinutes,
    maxExposurePerMarket: next.maxExposurePerMarket,
    maxTotalOpenPaperExposure: next.maxTotalOpenPaperExposure,
    maxOpenSimulatedPositions: next.maxOpenSimulatedPositions,
    maxDailySimulatedLoss: next.maxDailySimulatedLoss,
    monitor5mEnabled: next.monitor5mEnabled,
    monitor15mEnabled: next.monitor15mEnabled,
    monitor5mIntervalMinutes: next.monitor5mIntervalMinutes,
    monitor15mIntervalMinutes: next.monitor15mIntervalMinutes,
    paperTradeUsdPerSignal: next.paperTradeUsdPerSignal,
    artifactRootPath: next.artifactRootPath,
    authEnv: next.authEnv,
  };
}

export function configuredPolymarketAuthKeys(authEnv: AgentEnvConfig | null | undefined): string[] {
  if (!authEnv) return [];
  return Object.keys(authEnv).filter((key) => POLYMARKET_AUTH_ENV_KEYS.includes(key as (typeof POLYMARKET_AUTH_ENV_KEYS)[number]));
}

export function missingRequiredPolymarketAuthKeys(env: Record<string, string>): string[] {
  return POLYMARKET_REQUIRED_LIVE_AUTH_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.trim().toLowerCase();
}

export function secondsToDate(value: number | null | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000);
}

export function safeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeZoneParts(date: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter
    .formatToParts(date)
    .reduce<Record<string, number>>((acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = Number(part.value);
      }
      return acc;
    }, {});
}

export function localDayKey(date: Date, timeZone: string): string {
  const parts = timeZoneParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function shouldRunDaily(
  lastSuccessfulAt: Date | null,
  now: Date,
  timeZone: string,
  hour: number,
  minute: number,
): boolean {
  const nowParts = timeZoneParts(now, timeZone);
  const isAfterScheduledTime =
    nowParts.hour > hour || (nowParts.hour === hour && nowParts.minute >= minute);
  if (!isAfterScheduledTime) return false;

  if (!lastSuccessfulAt) return true;
  return localDayKey(lastSuccessfulAt, timeZone) !== localDayKey(now, timeZone);
}

export function shouldRunInterval(
  lastFinishedAt: Date | null,
  now: Date,
  intervalMinutes: number,
): boolean {
  if (!lastFinishedAt) return true;
  return now.getTime() - lastFinishedAt.getTime() >= intervalMinutes * 60_000;
}

export function cadenceToWorkerKey(cadence: PolymarketCopyCadence): PolymarketCopyWorkerKey {
  return cadence === "5m" ? "polymarket-monitor-5m" : "polymarket-monitor-15m";
}

export function computeSpreadSnapshot(
  bids: Array<{ price: number }>,
  asks: Array<{ price: number }>,
): PolymarketSpreadSnapshot {
  const bestBid = bids.length > 0 ? Math.max(...bids.map((bid) => bid.price)) : null;
  const bestAsk = asks.length > 0 ? Math.min(...asks.map((ask) => ask.price)) : null;
  const midpoint = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps =
    bestBid != null && bestAsk != null && midpoint && midpoint > 0
      ? ((bestAsk - bestBid) / midpoint) * 10_000
      : null;
  return { bestBid, bestAsk, spreadBps, midpoint };
}

export function signalMetadata(signal: Pick<PolymarketCopySignal, "rawMetadata">): PolymarketSignalMetadata {
  return (signal.rawMetadata ?? {}) as PolymarketSignalMetadata;
}

export function exposureForSignal(signal: Pick<PolymarketCopySignal, "materialityUsd">): number {
  return Math.max(0, signal.materialityUsd ?? 0);
}
