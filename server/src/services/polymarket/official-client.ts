import { logger } from "../../middleware/logger.js";
import {
  computeSpreadSnapshot,
  normalizeWalletAddress,
  safeDate,
  secondsToDate,
  type PolymarketSpreadSnapshot,
} from "./shared.js";

export interface PolymarketLeaderboardEntry {
  rank: string;
  proxyWallet: string;
  userName: string;
  xUsername: string;
  verifiedBadge: boolean;
  vol: number;
  pnl: number;
  profileImage: string;
}

export interface PolymarketPositionEntry {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  icon: string;
  eventId: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}

export interface PolymarketClosedPositionEntry
  extends Omit<
    PolymarketPositionEntry,
    "size" | "initialValue" | "currentValue" | "cashPnl" | "percentPnl" | "percentRealizedPnl" | "negativeRisk"
  > {
  timestamp: number;
}

export interface PolymarketTradeEntry {
  proxyWallet: string;
  side: "BUY" | "SELL";
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  icon: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  name: string;
  pseudonym: string;
  bio: string;
  profileImage: string;
  profileImageOptimized: string;
  transactionHash: string;
}

interface PolymarketOrderBookResponse {
  market: string;
  asset_id: string;
  timestamp: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  last_trade_price: string;
}

export interface PolymarketOrderBookSnapshot extends PolymarketSpreadSnapshot {
  assetId: string;
  marketId: string;
  fetchedAt: Date | null;
  lastTradePrice: number | null;
}

export interface PolymarketOfficialClient {
  listLeaderboard(maxCandidates: number): Promise<PolymarketLeaderboardEntry[]>;
  getPositions(walletAddress: string): Promise<PolymarketPositionEntry[]>;
  getClosedPositions(walletAddress: string): Promise<PolymarketClosedPositionEntry[]>;
  getClosedPositionsFetchCeiling(): number;
  getTrades(walletAddress: string): Promise<PolymarketTradeEntry[]>;
  getOrderBook(assetId: string): Promise<PolymarketOrderBookSnapshot | null>;
}

const DEFAULT_CLOSED_POSITIONS_PAGE_SIZE = 50;
const DEFAULT_CLOSED_POSITIONS_MAX_PAGES = 12;
const DEFAULT_TRADES_LIMIT = 100;

class PolymarketRequestError extends Error {
  status: number;
  body: string;
  url: string;

  constructor(status: number, url: string, body: string) {
    super(`Polymarket request failed (${status}) for ${url}: ${body.slice(0, 240)}`);
    this.name = "PolymarketRequestError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

function isMissingOrderBookError(error: unknown): boolean {
  return error instanceof PolymarketRequestError
    && error.status === 404
    && /no orderbook exists for the requested token id/i.test(error.body);
}

function positiveIntegerFromEnv(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function sortByTimestampDesc<T extends { timestamp: number }>(items: T[]): T[] {
  return items.slice().sort((left, right) => {
    const leftTimestamp = Number.isFinite(left.timestamp) ? left.timestamp : 0;
    const rightTimestamp = Number.isFinite(right.timestamp) ? right.timestamp : 0;
    return rightTimestamp - leftTimestamp;
  });
}

export function createPolymarketOfficialClient(): PolymarketOfficialClient {
  const dataApiBase = process.env.POLYMARKET_DATA_API_BASE_URL ?? "https://data-api.polymarket.com";
  const clobBase = process.env.POLYMARKET_CLOB_BASE_URL ?? "https://clob.polymarket.com";
  const log = logger.child({ service: "polymarket-official-client" });
  const closedPositionsPageSize = positiveIntegerFromEnv(
    process.env.POLYMARKET_CLOSED_POSITIONS_PAGE_SIZE,
    DEFAULT_CLOSED_POSITIONS_PAGE_SIZE,
    DEFAULT_CLOSED_POSITIONS_PAGE_SIZE,
  );
  const closedPositionsMaxPages = positiveIntegerFromEnv(
    process.env.POLYMARKET_CLOSED_POSITIONS_MAX_PAGES,
    DEFAULT_CLOSED_POSITIONS_MAX_PAGES,
    12,
  );
  const tradesLimit = positiveIntegerFromEnv(process.env.POLYMARKET_TRADES_LIMIT, DEFAULT_TRADES_LIMIT, 250);

  async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "paperclip-polymarket-v0",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PolymarketRequestError(response.status, url, body);
    }
    return response.json() as Promise<T>;
  }

  function withDataApiParams(path: string, params: Record<string, string | number | null | undefined>): string {
    const url = new URL(path, dataApiBase);
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async function fetchOffsetPages<T>(options: {
    path: string;
    params: Record<string, string | number | null | undefined>;
    pageSize: number;
    maxPages: number;
    dedupeKey?: (item: T) => string | null;
  }): Promise<T[]> {
    const items: T[] = [];
    const seen = options.dedupeKey ? new Set<string>() : null;

    for (let pageIndex = 0; pageIndex < options.maxPages; pageIndex += 1) {
      const offset = pageIndex * options.pageSize;
      const batch = await fetchJson<T[]>(
        withDataApiParams(options.path, {
          ...options.params,
          limit: options.pageSize,
          offset,
        }),
      );

      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const item of batch) {
        const dedupeKey = options.dedupeKey?.(item) ?? null;
        if (!seen || !dedupeKey) {
          items.push(item);
          continue;
        }
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push(item);
      }

      if (batch.length < options.pageSize) break;
    }

    return items;
  }

  function closedPositionKey(entry: PolymarketClosedPositionEntry): string {
    return [
      normalizeWalletAddress(entry.proxyWallet),
      entry.conditionId,
      entry.asset,
      Number(entry.timestamp || 0),
    ].join(":");
  }

  function tradeKey(entry: PolymarketTradeEntry): string {
    return [
      normalizeWalletAddress(entry.proxyWallet),
      entry.transactionHash,
      entry.asset,
      entry.conditionId,
      Number(entry.timestamp || 0),
      entry.side,
    ].join(":");
  }

  return {
    async listLeaderboard(maxCandidates) {
      const rows = await fetchJson<PolymarketLeaderboardEntry[]>(`${dataApiBase}/v1/leaderboard`);
      return rows
        .filter((row) => row.proxyWallet)
        .slice(0, Math.max(1, maxCandidates))
        .map((row) => ({ ...row, proxyWallet: normalizeWalletAddress(row.proxyWallet) }));
    },

    async getPositions(walletAddress) {
      const normalized = normalizeWalletAddress(walletAddress);
      return fetchJson<PolymarketPositionEntry[]>(withDataApiParams("/positions", { user: normalized }));
    },

    async getClosedPositions(walletAddress) {
      const normalized = normalizeWalletAddress(walletAddress);
      const rows = await fetchOffsetPages<PolymarketClosedPositionEntry>({
        path: "/v1/closed-positions",
        params: { user: normalized },
        pageSize: closedPositionsPageSize,
        maxPages: closedPositionsMaxPages,
        dedupeKey: closedPositionKey,
      });
      if (rows.length > closedPositionsPageSize) {
        log.debug({ walletAddress: normalized, closedPositions: rows.length }, "expanded closed position history");
      }
      return sortByTimestampDesc(rows);
    },

    getClosedPositionsFetchCeiling() {
      return closedPositionsPageSize * closedPositionsMaxPages;
    },

    async getTrades(walletAddress) {
      const normalized = normalizeWalletAddress(walletAddress);
      const rows = await fetchOffsetPages<PolymarketTradeEntry>({
        path: "/trades",
        params: { user: normalized },
        pageSize: tradesLimit,
        maxPages: 1,
        dedupeKey: tradeKey,
      });
      return sortByTimestampDesc(rows);
    },

    async getOrderBook(assetId) {
      try {
        const response = await fetchJson<PolymarketOrderBookResponse>(
          `${clobBase}/book?token_id=${encodeURIComponent(assetId)}`,
        );
        const spread = computeSpreadSnapshot(
          response.bids.map((bid) => ({ price: Number(bid.price) })),
          response.asks.map((ask) => ({ price: Number(ask.price) })),
        );
        return {
          assetId: response.asset_id,
          marketId: response.market,
          fetchedAt: safeDate(response.timestamp),
          lastTradePrice: response.last_trade_price ? Number(response.last_trade_price) : null,
          ...spread,
        };
      } catch (error) {
        if (isMissingOrderBookError(error)) {
          return null;
        }
        log.warn({ err: error, assetId }, "order book fetch failed");
        return null;
      }
    },
  };
}

export function latestTradeDate(trades: Array<{ timestamp: number }>): Date | null {
  const latest = trades.reduce<number | null>((max, trade) => {
    if (!Number.isFinite(trade.timestamp)) return max;
    return max == null || trade.timestamp > max ? trade.timestamp : max;
  }, null);
  return secondsToDate(latest);
}
