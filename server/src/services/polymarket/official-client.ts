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

export interface PolymarketClosedPositionEntry extends Omit<PolymarketPositionEntry, "size" | "initialValue" | "currentValue" | "cashPnl" | "percentPnl" | "percentRealizedPnl" | "negativeRisk"> {
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
  getTrades(walletAddress: string): Promise<PolymarketTradeEntry[]>;
  getOrderBook(assetId: string): Promise<PolymarketOrderBookSnapshot | null>;
}

export function createPolymarketOfficialClient(): PolymarketOfficialClient {
  const dataApiBase = process.env.POLYMARKET_DATA_API_BASE_URL ?? "https://data-api.polymarket.com";
  const clobBase = process.env.POLYMARKET_CLOB_BASE_URL ?? "https://clob.polymarket.com";
  const log = logger.child({ service: "polymarket-official-client" });

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
      throw new Error(`Polymarket request failed (${response.status}) for ${url}: ${body.slice(0, 240)}`);
    }
    return response.json() as Promise<T>;
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
      return fetchJson<PolymarketPositionEntry[]>(`${dataApiBase}/positions?user=${normalized}`);
    },

    async getClosedPositions(walletAddress) {
      const normalized = normalizeWalletAddress(walletAddress);
      return fetchJson<PolymarketClosedPositionEntry[]>(`${dataApiBase}/closed-positions?user=${normalized}`);
    },

    async getTrades(walletAddress) {
      const normalized = normalizeWalletAddress(walletAddress);
      return fetchJson<PolymarketTradeEntry[]>(`${dataApiBase}/trades?user=${normalized}`);
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
