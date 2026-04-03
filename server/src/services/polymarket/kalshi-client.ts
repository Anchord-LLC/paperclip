import { constants, createPrivateKey, sign } from "node:crypto";

export interface KalshiCredentials {
  apiKeyId: string;
  privateKeyPem: string;
}

export interface KalshiMarket {
  ticker: string;
  eventTicker: string;
  title: string | null;
  subtitle: string | null;
  yesSubTitle: string;
  noSubTitle: string;
  status: string;
  liquidityDollars: number | null;
  yesBidDollars: number | null;
  yesAskDollars: number | null;
  noBidDollars: number | null;
  noAskDollars: number | null;
  lastPriceDollars: number | null;
  closeTime: Date | null;
  openTime: Date | null;
}

export interface KalshiEvent {
  eventTicker: string;
  seriesTicker: string | null;
  title: string | null;
  subTitle: string | null;
  category: string | null;
  markets: KalshiMarket[];
}

export interface KalshiPriceLevel {
  priceDollars: number;
  count: number | null;
}

export interface KalshiOrderbook {
  ticker: string;
  yesLevels: KalshiPriceLevel[];
  noLevels: KalshiPriceLevel[];
  bestYesBidDollars: number | null;
  bestYesAskDollars: number | null;
  bestNoBidDollars: number | null;
  bestNoAskDollars: number | null;
}

export interface KalshiBalance {
  balanceUsd: number | null;
  portfolioValueUsd: number | null;
  updatedAt: Date | null;
}

export type KalshiRequestErrorKind = "http_error" | "network_error" | "malformed_response";

export class KalshiRequestError extends Error {
  readonly kind: KalshiRequestErrorKind;
  readonly status: number | null;
  readonly pathname: string;
  readonly responseBodySnippet: string | null;

  constructor(options: {
    message: string;
    kind: KalshiRequestErrorKind;
    status: number | null;
    pathname: string;
    responseBodySnippet?: string | null;
  }) {
    super(options.message);
    this.name = "KalshiRequestError";
    this.kind = options.kind;
    this.status = options.status;
    this.pathname = options.pathname;
    this.responseBodySnippet = options.responseBodySnippet ?? null;
  }
}

export function isKalshiRequestError(error: unknown): error is KalshiRequestError {
  return error instanceof KalshiRequestError;
}

export interface KalshiPosition {
  ticker: string;
  position: number;
  marketExposureUsd: number;
  realizedPnlUsd: number;
  lastUpdatedAt: Date | null;
}

export interface KalshiCreateOrderRequest {
  ticker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  yesPriceDollars?: string;
  noPriceDollars?: string;
  clientOrderId?: string;
  reduceOnly?: boolean;
  timeInForce?: "fill_or_kill" | "good_till_canceled" | "immediate_or_cancel";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDollarNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed == null ? null : parsed;
}

function toUsdFromCents(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed == null ? null : parsed / 100;
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizePrivateKeyPem(value: string): string {
  return value.trim().replace(/\\n/g, "\n");
}

function createSignature(options: { privateKeyPem: string; timestampMs: string; method: string; pathname: string }) {
  const key = createPrivateKey(normalizePrivateKeyPem(options.privateKeyPem));
  const message = `${options.timestampMs}${options.method.toUpperCase()}${options.pathname}`;
  return sign("sha256", Buffer.from(message), {
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

function mapMarket(raw: Record<string, unknown>): KalshiMarket {
  return {
    ticker: String(raw.ticker ?? ""),
    eventTicker: String(raw.event_ticker ?? ""),
    title: typeof raw.title === "string" ? raw.title : null,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : null,
    yesSubTitle: typeof raw.yes_sub_title === "string" ? raw.yes_sub_title : "Yes",
    noSubTitle: typeof raw.no_sub_title === "string" ? raw.no_sub_title : "No",
    status: typeof raw.status === "string" ? raw.status : "unknown",
    liquidityDollars: toDollarNumber(raw.liquidity_dollars),
    yesBidDollars: toDollarNumber(raw.yes_bid_dollars),
    yesAskDollars: toDollarNumber(raw.yes_ask_dollars),
    noBidDollars: toDollarNumber(raw.no_bid_dollars),
    noAskDollars: toDollarNumber(raw.no_ask_dollars),
    lastPriceDollars: toDollarNumber(raw.last_price_dollars),
    closeTime: toDate(raw.close_time),
    openTime: toDate(raw.open_time),
  };
}

function mapPriceLevels(levels: unknown): KalshiPriceLevel[] {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((level) => {
      const record = asRecord(level);
      const price = toDollarNumber(record.price_dollars ?? record.price);
      if (price == null) return null;
      return {
        priceDollars: price,
        count: toNumber(record.count_fp ?? record.count),
      } satisfies KalshiPriceLevel;
    })
    .filter((level): level is KalshiPriceLevel => level != null)
    .sort((left, right) => right.priceDollars - left.priceDollars);
}

export function createKalshiClient(baseUrl: string = process.env.KALSHI_API_BASE_URL?.trim() || "https://api.elections.kalshi.com/trade-api/v2") {
  async function request<T>(path: string, options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean | null | undefined>;
    body?: Record<string, unknown> | null;
    credentials?: KalshiCredentials | null;
  }): Promise<T> {
    const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const method = options?.method ?? "GET";
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "paperclip-kalshi-adapter/0.1",
    };

    if (options?.body) {
      headers["Content-Type"] = "application/json";
    }

    if (options?.credentials) {
      const timestampMs = String(Date.now());
      headers["KALSHI-ACCESS-KEY"] = options.credentials.apiKeyId;
      headers["KALSHI-ACCESS-TIMESTAMP"] = timestampMs;
      headers["KALSHI-ACCESS-SIGNATURE"] = createSignature({
        privateKeyPem: options.credentials.privateKeyPem,
        timestampMs,
        method,
        pathname: url.pathname,
      });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new KalshiRequestError({
        message: `Kalshi network request failed for ${url.pathname}: ${detail}`,
        kind: "network_error",
        status: null,
        pathname: url.pathname,
        responseBodySnippet: detail.slice(0, 240),
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new KalshiRequestError({
        message: `Kalshi request failed (${response.status}) for ${url.pathname}: ${body.slice(0, 240)}`,
        kind: "http_error",
        status: response.status,
        pathname: url.pathname,
        responseBodySnippet: body.slice(0, 240),
      });
    }

    try {
      return await response.json() as T;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new KalshiRequestError({
        message: `Kalshi response parse failed for ${url.pathname}: ${detail}`,
        kind: "malformed_response",
        status: response.status,
        pathname: url.pathname,
        responseBodySnippet: detail.slice(0, 240),
      });
    }
  }

  async function getMarkets(options?: {
    status?: string;
    limit?: number;
    cursor?: string | null;
    eventTicker?: string;
    seriesTicker?: string;
    tickers?: string[];
  }) {
    const response = await request<{ markets?: Record<string, unknown>[]; cursor?: string | null }>("markets", {
      query: {
        status: options?.status,
        limit: options?.limit ?? 200,
        cursor: options?.cursor ?? undefined,
        event_ticker: options?.eventTicker,
        series_ticker: options?.seriesTicker,
        tickers: options?.tickers?.join(","),
      },
    });
    return {
      markets: Array.isArray(response.markets) ? response.markets.map(mapMarket) : [],
      cursor: typeof response.cursor === "string" ? response.cursor : null,
    };
  }

  async function getEvents(options?: {
    status?: string;
    limit?: number;
    cursor?: string | null;
    withNestedMarkets?: boolean;
  }) {
    const response = await request<{ events?: Record<string, unknown>[]; cursor?: string | null }>("events", {
      query: {
        status: options?.status,
        limit: options?.limit ?? 200,
        cursor: options?.cursor ?? undefined,
        with_nested_markets: options?.withNestedMarkets ?? true,
      },
    });
    return {
      events: Array.isArray(response.events)
        ? response.events.map((raw) => {
          const record = asRecord(raw);
          const markets = Array.isArray(record.markets)
            ? record.markets.map((market) => mapMarket(asRecord(market)))
            : [];
          return {
            eventTicker: String(record.event_ticker ?? ""),
            seriesTicker: typeof record.series_ticker === "string" ? record.series_ticker : null,
            title: typeof record.title === "string" ? record.title : null,
            subTitle: typeof record.sub_title === "string" ? record.sub_title : null,
            category: typeof record.category === "string" ? record.category : null,
            markets,
          } satisfies KalshiEvent;
        })
        : [],
      cursor: typeof response.cursor === "string" ? response.cursor : null,
    };
  }

  async function getMarketOrderbook(ticker: string, credentials?: KalshiCredentials | null): Promise<KalshiOrderbook> {
    const response = await request<{ orderbook_fp?: Record<string, unknown> }>(`markets/${encodeURIComponent(ticker)}/orderbook`, {
      credentials: credentials ?? null,
    });
    const orderbook = asRecord(response.orderbook_fp);
    const yesLevels = mapPriceLevels(orderbook.yes_dollars);
    const noLevels = mapPriceLevels(orderbook.no_dollars);
    const bestYesBid = yesLevels[0]?.priceDollars ?? null;
    const bestNoBid = noLevels[0]?.priceDollars ?? null;
    return {
      ticker,
      yesLevels,
      noLevels,
      bestYesBidDollars: bestYesBid,
      bestYesAskDollars: bestNoBid != null ? Math.max(0, 1 - bestNoBid) : null,
      bestNoBidDollars: bestNoBid,
      bestNoAskDollars: bestYesBid != null ? Math.max(0, 1 - bestYesBid) : null,
    };
  }

  async function getBalance(credentials: KalshiCredentials): Promise<KalshiBalance> {
    const response = await request<{ balance?: unknown; portfolio_value?: unknown; updated_ts?: unknown }>("portfolio/balance", {
      credentials,
    });
    const balanceUsd = toUsdFromCents(response.balance);
    const portfolioValueUsd = toUsdFromCents(response.portfolio_value);
    if (balanceUsd == null && portfolioValueUsd == null) {
      throw new KalshiRequestError({
        message: "Kalshi balance response is missing both balance and portfolio_value",
        kind: "malformed_response",
        status: 200,
        pathname: "/trade-api/v2/portfolio/balance",
        responseBodySnippet: "missing balance and portfolio_value",
      });
    }
    return {
      balanceUsd,
      portfolioValueUsd,
      updatedAt: toDate(response.updated_ts),
    };
  }

  async function getPositions(credentials: KalshiCredentials, options?: { limit?: number; cursor?: string | null }) {
    const response = await request<{ cursor?: string | null; market_positions?: Record<string, unknown>[] }>("portfolio/positions", {
      credentials,
      query: {
        limit: options?.limit ?? 50,
        cursor: options?.cursor ?? undefined,
      },
    });

    return {
      positions: Array.isArray(response.market_positions)
        ? response.market_positions.map((raw) => {
          const record = asRecord(raw);
          return {
            ticker: String(record.ticker ?? ""),
            position: toNumber(record.position_fp) ?? 0,
            marketExposureUsd: toDollarNumber(record.market_exposure_dollars) ?? 0,
            realizedPnlUsd: toDollarNumber(record.realized_pnl_dollars) ?? 0,
            lastUpdatedAt: toDate(record.last_updated_ts),
          } satisfies KalshiPosition;
        })
        : [],
      cursor: typeof response.cursor === "string" ? response.cursor : null,
    };
  }

  async function createOrder(credentials: KalshiCredentials, order: KalshiCreateOrderRequest) {
    const body: Record<string, unknown> = {
      ticker: order.ticker,
      side: order.side,
      action: order.action,
      count: order.count,
      client_order_id: order.clientOrderId,
      reduce_only: order.reduceOnly,
      time_in_force: order.timeInForce ?? "fill_or_kill",
    };
    if (order.yesPriceDollars) body.yes_price_dollars = order.yesPriceDollars;
    if (order.noPriceDollars) body.no_price_dollars = order.noPriceDollars;
    return request<Record<string, unknown>>("portfolio/orders", {
      method: "POST",
      credentials,
      body,
    });
  }

  async function listOpenEventsWithMarkets(options?: { maxPages?: number; limit?: number }) {
    const events: KalshiEvent[] = [];
    let cursor: string | null = null;
    const maxPages = Math.max(1, options?.maxPages ?? 3);
    for (let page = 0; page < maxPages; page += 1) {
      const batch = await getEvents({
        status: "open",
        limit: options?.limit ?? 200,
        cursor,
        withNestedMarkets: true,
      });
      events.push(...batch.events);
      if (!batch.cursor) break;
      cursor = batch.cursor;
    }
    return events;
  }

  return {
    baseUrl,
    normalizePrivateKeyPem,
    getMarkets,
    getEvents,
    listOpenEventsWithMarkets,
    getMarketOrderbook,
    getBalance,
    getPositions,
    createOrder,
  };
}
