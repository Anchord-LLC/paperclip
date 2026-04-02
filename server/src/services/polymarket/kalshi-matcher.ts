import type { PolymarketCopyRuntimeConfig, PolymarketCopySignal } from "@paperclipai/shared";
import { createKalshiClient, type KalshiEvent, type KalshiMarket } from "./kalshi-client.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "will",
  "be",
  "is",
  "are",
  "with",
  "from",
]);

let cachedOpenEvents: { baseUrl: string; fetchedAt: number; events: KalshiEvent[] } | null = null;

function asTokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function diceCoefficient(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftCounts = new Map<string, number>();
  for (const token of left) {
    leftCounts.set(token, (leftCounts.get(token) ?? 0) + 1);
  }
  let intersection = 0;
  for (const token of right) {
    const count = leftCounts.get(token) ?? 0;
    if (count > 0) {
      intersection += 1;
      leftCounts.set(token, count - 1);
    }
  }
  return (2 * intersection) / (left.length + right.length);
}

function chosenSide(signal: PolymarketCopySignal, market: KalshiMarket) {
  const rawSide = (signal.side ?? "").trim().toLowerCase();
  if (rawSide === "yes" || rawSide === market.yesSubTitle.trim().toLowerCase()) {
    return { side: "yes" as const, score: 1 };
  }
  if (rawSide === "no" || rawSide === market.noSubTitle.trim().toLowerCase()) {
    return { side: "no" as const, score: 1 };
  }

  const sourceTokens = asTokens(signal.side);
  const yesScore = diceCoefficient(sourceTokens, asTokens(market.yesSubTitle));
  const noScore = diceCoefficient(sourceTokens, asTokens(market.noSubTitle));
  if (yesScore === 0 && noScore === 0) {
    return { side: "yes" as const, score: 0.5 };
  }
  return yesScore >= noScore
    ? { side: "yes" as const, score: yesScore }
    : { side: "no" as const, score: noScore };
}

function quoteForSide(market: KalshiMarket, side: "yes" | "no") {
  return side === "yes"
    ? { bid: market.yesBidDollars, ask: market.yesAskDollars }
    : { bid: market.noBidDollars, ask: market.noAskDollars };
}

function spreadBps(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null || bid <= 0 || ask <= 0) return null;
  const midpoint = (bid + ask) / 2;
  if (midpoint <= 0) return null;
  return ((ask - bid) / midpoint) * 10_000;
}

async function loadOpenEvents(baseUrl: string) {
  const now = Date.now();
  if (cachedOpenEvents && cachedOpenEvents.baseUrl === baseUrl && now - cachedOpenEvents.fetchedAt < 60_000) {
    return cachedOpenEvents.events;
  }
  const client = createKalshiClient(baseUrl);
  const events = await client.listOpenEventsWithMarkets({ maxPages: 3, limit: 200 });
  cachedOpenEvents = { baseUrl, fetchedAt: now, events };
  return events;
}

export interface KalshiMarketMatchResult {
  status: "matched" | "rejected";
  confidence: number;
  quality: "high" | "medium" | "low" | null;
  reasonCode: string | null;
  reasonDetail: string | null;
  eventTicker: string | null;
  marketTicker: string | null;
  marketTitle: string | null;
  side: "yes" | "no" | null;
  priceDollars: number | null;
  notionalLiquidityUsd: number | null;
  spreadBps: number | null;
  metadata: Record<string, unknown>;
}

export async function matchPolymarketSignalToKalshi(options: {
  signal: PolymarketCopySignal;
  runtimeConfig: Pick<PolymarketCopyRuntimeConfig, "kalshiApiBaseUrl" | "maxSpreadBps">;
  expectedNotionalUsd: number | null;
}): Promise<KalshiMarketMatchResult> {
  const { signal, runtimeConfig, expectedNotionalUsd } = options;
  const sourceTitle = `${signal.marketTitle ?? ""} ${signal.marketSlug ?? ""}`.trim();
  const sourceTokens = asTokens(sourceTitle);
  if (sourceTokens.length === 0) {
    return {
      status: "rejected",
      confidence: 0,
      quality: null,
      reasonCode: "source_market_title_missing",
      reasonDetail: "Signal had no usable title or slug for Kalshi translation.",
      eventTicker: null,
      marketTicker: null,
      marketTitle: null,
      side: null,
      priceDollars: null,
      notionalLiquidityUsd: null,
      spreadBps: null,
      metadata: {},
    };
  }

  const openEvents = await loadOpenEvents(runtimeConfig.kalshiApiBaseUrl);
  let best: (KalshiMarketMatchResult & { questionScore: number; sideScore: number }) | null = null;

  for (const event of openEvents) {
    for (const market of event.markets) {
      if (market.status !== "open") continue;
      const combinedTitle = `${event.title ?? ""} ${event.subTitle ?? ""} ${market.title ?? ""} ${market.subtitle ?? ""} ${market.yesSubTitle} ${market.noSubTitle}`;
      const questionScore = Math.max(
        diceCoefficient(sourceTokens, asTokens(combinedTitle)),
        diceCoefficient(sourceTokens, asTokens(event.title)),
      );
      const sideResolution = chosenSide(signal, market);
      const quote = quoteForSide(market, sideResolution.side);
      const price = signal.action === "reduced_position" || signal.action === "closed_position"
        ? quote.bid
        : quote.ask;
      const spread = spreadBps(quote.bid, quote.ask);
      const liquidity = market.liquidityDollars;
      const liquidityScore = liquidity == null
        ? 0
        : Math.min(1, liquidity / Math.max(expectedNotionalUsd ?? 250, 250));
      const confidence = Math.max(
        0,
        Math.min(1, (questionScore * 0.62) + (sideResolution.score * 0.23) + (liquidityScore * 0.15)),
      );
      const quality = confidence >= 0.82 ? "high" : confidence >= 0.66 ? "medium" : confidence >= 0.5 ? "low" : null;
      const candidate: KalshiMarketMatchResult & { questionScore: number; sideScore: number } = {
        status: "matched",
        confidence,
        quality,
        reasonCode: null,
        reasonDetail: null,
        eventTicker: event.eventTicker,
        marketTicker: market.ticker,
        marketTitle: `${event.title ?? market.title ?? market.ticker} • ${sideResolution.side === "yes" ? market.yesSubTitle : market.noSubTitle}`,
        side: sideResolution.side,
        priceDollars: price ?? market.lastPriceDollars,
        notionalLiquidityUsd: liquidity,
        spreadBps: spread,
        metadata: {
          sourceTitle,
          eventTitle: event.title,
          eventSubTitle: event.subTitle,
          marketTitle: market.title,
          marketSubtitle: market.subtitle,
          chosenSideLabel: sideResolution.side === "yes" ? market.yesSubTitle : market.noSubTitle,
          questionScore,
          sideScore: sideResolution.score,
          liquidityScore,
          category: event.category,
        },
        questionScore,
        sideScore: sideResolution.score,
      };
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
    }
  }

  if (!best) {
    return {
      status: "rejected",
      confidence: 0,
      quality: null,
      reasonCode: "kalshi_open_market_not_found",
      reasonDetail: "No open Kalshi markets were available for translation.",
      eventTicker: null,
      marketTicker: null,
      marketTitle: null,
      side: null,
      priceDollars: null,
      notionalLiquidityUsd: null,
      spreadBps: null,
      metadata: { sourceTitle },
    };
  }

  if (best.questionScore < 0.42 || best.confidence < 0.56) {
    return {
      ...best,
      status: "rejected",
      reasonCode: "kalshi_match_confidence_too_low",
      reasonDetail: "No sufficiently equivalent Kalshi contract meaning was found for the Polymarket source signal.",
    };
  }
  if (best.priceDollars == null || best.priceDollars <= 0) {
    return {
      ...best,
      status: "rejected",
      reasonCode: "kalshi_price_unavailable",
      reasonDetail: "Matched Kalshi market did not expose a tradable price for the mirrored side.",
    };
  }
  if (best.spreadBps != null && best.spreadBps > runtimeConfig.maxSpreadBps) {
    return {
      ...best,
      status: "rejected",
      reasonCode: "kalshi_spread_too_wide",
      reasonDetail: `Matched Kalshi market spread (${best.spreadBps.toFixed(0)} bps) exceeded the configured ceiling.`,
    };
  }
  if (best.notionalLiquidityUsd != null && expectedNotionalUsd != null && expectedNotionalUsd > 0 && best.notionalLiquidityUsd < expectedNotionalUsd) {
    return {
      ...best,
      status: "rejected",
      reasonCode: "kalshi_liquidity_too_thin",
      reasonDetail: "Matched Kalshi market liquidity was thinner than the mirrored order notional.",
    };
  }

  return best;
}
