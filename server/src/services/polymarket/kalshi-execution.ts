import type { Db } from "@paperclipai/db";
import type {
  PolymarketCopyKalshiMirrorOrder,
  PolymarketCopyPaperTrade,
  PolymarketCopyRuntimeConfig,
  PolymarketCopySignal,
} from "@paperclipai/shared";
import { createKalshiClient } from "./kalshi-client.js";
import { matchPolymarketSignalToKalshi } from "./kalshi-matcher.js";
import { resolveKalshiCredentials } from "./kalshi-readiness.js";
import { resolveSignalPricing } from "./runtime-math.js";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function contractCountFromNotional(priceDollars: number | null, notionalUsd: number | null): number | null {
  if (priceDollars == null || priceDollars <= 0 || notionalUsd == null || notionalUsd <= 0) return null;
  return Math.max(1, Math.floor(notionalUsd / priceDollars));
}

export async function mirrorSignalToKalshi(options: {
  db: Db;
  companyId: string;
  runtimeConfig: Pick<
    PolymarketCopyRuntimeConfig,
    | "authEnv"
    | "mode"
    | "liveEnabled"
    | "tradingKillSwitch"
    | "kalshiExecutionMode"
    | "kalshiApiBaseUrl"
    | "maxSpreadBps"
  >;
  signal: PolymarketCopySignal;
  paperTrade: PolymarketCopyPaperTrade | null;
}): Promise<Omit<PolymarketCopyKalshiMirrorOrder, "id" | "companyId" | "createdAt" | "updatedAt">> {
  const { runtimeConfig, signal, paperTrade } = options;
  const pricing = resolveSignalPricing(signal);
  const expectedNotionalUsd = paperTrade?.notionalUsd ?? pricing.sourceNotionalUsd ?? null;
  const match = await matchPolymarketSignalToKalshi({
    signal,
    runtimeConfig,
    expectedNotionalUsd,
  });

  if (match.status === "rejected") {
    return {
      signalId: signal.id,
      sourceWalletAddress: signal.sourceWalletAddress,
      cadence: signal.cadence,
      sourceMarketId: signal.marketId,
      sourceMarketTitle: signal.marketTitle,
      sourceAction: signal.action,
      sourceSide: signal.side,
      executionMode: runtimeConfig.kalshiExecutionMode,
      matchStatus: "rejected",
      executionStatus: "match_rejected",
      rejectionReason: match.reasonCode,
      matchConfidence: round2(match.confidence),
      matchQuality: match.quality,
      kalshiEventTicker: match.eventTicker,
      kalshiMarketTicker: match.marketTicker,
      kalshiMarketTitle: match.marketTitle,
      kalshiSide: match.side,
      orderAction: null,
      contractCount: null,
      limitPriceDollars: match.priceDollars,
      notionalUsd: expectedNotionalUsd,
      metadata: {
        match: match.metadata,
        rejectionDetail: match.reasonDetail,
      },
    };
  }

  const orderAction: "buy" | "sell" = signal.action === "reduced_position" || signal.action === "closed_position" ? "sell" : "buy";
  const priceDollars = match.priceDollars ?? pricing.markPrice ?? null;
  const baseNotionalUsd = orderAction === "sell" ? (paperTrade?.notionalUsd ?? expectedNotionalUsd) : expectedNotionalUsd;
  const contractCount = orderAction === "sell"
    ? Math.max(1, Math.floor(Math.abs(paperTrade?.quantity ?? pricing.sourceDelta ?? 1)))
    : contractCountFromNotional(priceDollars, baseNotionalUsd);

  const basePayload = {
    signalId: signal.id,
    sourceWalletAddress: signal.sourceWalletAddress,
    cadence: signal.cadence,
    sourceMarketId: signal.marketId,
    sourceMarketTitle: signal.marketTitle,
    sourceAction: signal.action,
    sourceSide: signal.side,
    executionMode: runtimeConfig.kalshiExecutionMode,
    matchStatus: "matched" as const,
    matchConfidence: round2(match.confidence),
    matchQuality: match.quality,
    kalshiEventTicker: match.eventTicker,
    kalshiMarketTicker: match.marketTicker,
    kalshiMarketTitle: match.marketTitle,
    kalshiSide: match.side,
    orderAction,
    contractCount,
    limitPriceDollars: priceDollars,
    notionalUsd: baseNotionalUsd,
  };

  if (runtimeConfig.kalshiExecutionMode === "disabled") {
    return {
      ...basePayload,
      executionStatus: "disabled",
      rejectionReason: "kalshi_execution_disabled",
      metadata: { match: match.metadata },
    };
  }

  if (runtimeConfig.kalshiExecutionMode === "dry_run") {
    return {
      ...basePayload,
      executionStatus: "dry_run_recorded",
      rejectionReason: null,
      metadata: {
        match: match.metadata,
        simulatedOrder: {
          ticker: match.marketTicker,
          side: match.side,
          action: orderAction,
          count: contractCount,
          limitPriceDollars: priceDollars,
        },
      },
    };
  }

  if (runtimeConfig.mode !== "live") {
    return {
      ...basePayload,
      executionStatus: "live_blocked",
      rejectionReason: "system_not_in_live_mode",
      metadata: { match: match.metadata },
    };
  }

  if (!runtimeConfig.liveEnabled) {
    return {
      ...basePayload,
      executionStatus: "live_blocked",
      rejectionReason: "live_disabled",
      metadata: { match: match.metadata },
    };
  }

  if (runtimeConfig.tradingKillSwitch) {
    return {
      ...basePayload,
      executionStatus: "live_blocked",
      rejectionReason: "trading_kill_switch_active",
      metadata: { match: match.metadata },
    };
  }

  const { credentials } = await resolveKalshiCredentials(options.db, options.companyId, runtimeConfig);
  if (!credentials || !match.marketTicker || !match.side || !priceDollars || !contractCount) {
    return {
      ...basePayload,
      executionStatus: "live_blocked",
      rejectionReason: "kalshi_live_auth_or_order_fields_missing",
      metadata: { match: match.metadata },
    };
  }

  const client = createKalshiClient(runtimeConfig.kalshiApiBaseUrl);
  try {
    const response = await client.createOrder(credentials, {
      ticker: match.marketTicker,
      side: match.side,
      action: orderAction,
      count: contractCount,
      yesPriceDollars: match.side === "yes" ? priceDollars.toFixed(4) : undefined,
      noPriceDollars: match.side === "no" ? priceDollars.toFixed(4) : undefined,
      reduceOnly: orderAction === "sell",
      timeInForce: "fill_or_kill",
    });
    return {
      ...basePayload,
      executionStatus: "live_submitted",
      rejectionReason: null,
      metadata: { match: match.metadata, liveResponse: response },
    };
  } catch (error) {
    return {
      ...basePayload,
      executionStatus: "execution_failed",
      rejectionReason: "kalshi_order_submission_failed",
      metadata: { match: match.metadata, error: error instanceof Error ? error.message : String(error) },
    };
  }
}
