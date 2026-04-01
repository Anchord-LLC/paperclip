import { z } from "zod";
import { envBindingSecretRefSchema } from "./secret.js";

export const polymarketCopyModeSchema = z.enum(["paper", "live"]);
export const polymarketCopyCadenceSchema = z.enum(["5m", "15m"]);
export const polymarketCopySignalActionSchema = z.enum([
  "new_position",
  "increased_position",
  "reduced_position",
  "closed_position",
]);
export const polymarketCopySignalDecisionSchema = z.enum(["accepted", "skipped", "blocked"]);

const SUPPORTED_POLYMARKET_AUTH_ENV_KEYS = new Set([
  "POLYMARKET_PRIVATE_KEY",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_API_PASSPHRASE",
  "POLYMARKET_FUNDER_ADDRESS",
]);

export const patchPolymarketCopyRuntimeConfigSchema = z.object({
  mode: polymarketCopyModeSchema.optional(),
  liveEnabled: z.boolean().optional(),
  tradingKillSwitch: z.boolean().optional(),
  walletSelectionEnabled: z.boolean().optional(),
  walletSelectionTimeZone: z.string().min(1).optional(),
  walletSelectionHour: z.number().int().min(0).max(23).optional(),
  walletSelectionMinute: z.number().int().min(0).max(59).optional(),
  selectorMaxCandidates: z.number().int().min(1).max(250).optional(),
  targetWatchedWalletCount: z.number().int().min(1).max(100).optional(),
  targetBenchWalletCount: z.number().int().min(0).max(100).optional(),
  maxDailyReplacements: z.number().int().min(0).max(50).optional(),
  selectorReplacementScoreDelta: z.number().min(0).max(1).optional(),
  efficiencyWeight: z.number().min(0).max(1).optional(),
  consistencyWeight: z.number().min(0).max(1).optional(),
  diversificationWeight: z.number().min(0).max(1).optional(),
  recencyWeight: z.number().min(0).max(1).optional(),
  concentrationPenaltyWeight: z.number().min(0).max(1).optional(),
  minWalletScore: z.number().min(0).max(1).optional(),
  minSignalMateriality: z.number().min(0).optional(),
  maxSpreadBps: z.number().int().min(0).max(100_000).optional(),
  staleSignalThresholdMinutes: z.number().int().min(1).max(10_080).optional(),
  maxExposurePerMarket: z.number().min(0).optional(),
  maxTotalOpenPaperExposure: z.number().min(0).optional(),
  maxOpenSimulatedPositions: z.number().int().min(1).max(10_000).optional(),
  maxDailySimulatedLoss: z.number().min(0).optional(),
  monitor5mEnabled: z.boolean().optional(),
  monitor15mEnabled: z.boolean().optional(),
  monitor5mIntervalMinutes: z.number().int().min(1).max(1_440).optional(),
  monitor15mIntervalMinutes: z.number().int().min(1).max(1_440).optional(),
  paperTradeUsdPerSignal: z.number().min(0).optional(),
  artifactRootPath: z.string().min(1).nullable().optional(),
  authEnv: z.record(envBindingSecretRefSchema).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.authEnv) {
    for (const key of Object.keys(value.authEnv)) {
      if (!SUPPORTED_POLYMARKET_AUTH_ENV_KEYS.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported Polymarket auth env key: ${key}`,
          path: ["authEnv", key],
        });
      }
    }
  }

  const weights = [
    value.efficiencyWeight,
    value.consistencyWeight,
    value.diversificationWeight,
    value.recencyWeight,
    value.concentrationPenaltyWeight,
  ].filter((item): item is number => typeof item === "number");

  if (weights.length > 0) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selection weights must remain in a sane range",
        path: ["efficiencyWeight"],
      });
    }
  }
});

export const polymarketCopyDashboardActionSchema = z.object({
  reason: z.string().trim().min(1).max(240).optional(),
});

export type PatchPolymarketCopyRuntimeConfig = z.infer<typeof patchPolymarketCopyRuntimeConfigSchema>;
export type PolymarketCopyDashboardAction = z.infer<typeof polymarketCopyDashboardActionSchema>;
