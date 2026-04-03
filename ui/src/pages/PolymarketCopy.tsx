import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentEnvConfig,
  CompanySecret,
  PolymarketAuthEnvKey,
  PolymarketCopyDashboardData,
  PolymarketCopyPaperTrade,
  PolymarketCopySecretEnvKey,
  PolymarketCopySignalDecisionRecord,
  PolymarketKalshiEnvKey,
} from "@paperclipai/shared";
import type { LucideIcon } from "lucide-react";
import {
  ActivitySquare,
  ArrowUpRight,
  BriefcaseBusiness,
  KeyRound,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  RefreshCcw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { Link, useParams } from "@/lib/router";
import { NavLink } from "react-router-dom";
import { polymarketCopyApi } from "../api/polymarketCopy";
import { secretsApi } from "../api/secrets";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { useCompany } from "../context/CompanyContext";
import { useRouteCompanySync } from "../hooks/useRouteCompanySync";
import { queryKeys } from "../lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NotFoundPage } from "./NotFound";

const POLYMARKET_AUTH_KEY_ORDER: PolymarketAuthEnvKey[] = [
  "POLYMARKET_PRIVATE_KEY",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_API_PASSPHRASE",
  "POLYMARKET_FUNDER_ADDRESS",
];

const KALSHI_SECRET_KEY_ORDER: PolymarketKalshiEnvKey[] = [
  "KALSHI_API_KEY_ID",
  "KALSHI_PRIVATE_KEY",
];

const SECRET_KEY_LABELS: Record<PolymarketCopySecretEnvKey, string> = {
  POLYMARKET_PRIVATE_KEY: "Private key ref",
  POLYMARKET_API_KEY: "API key ref",
  POLYMARKET_API_SECRET: "API secret ref",
  POLYMARKET_API_PASSPHRASE: "API passphrase ref",
  POLYMARKET_FUNDER_ADDRESS: "Funder address ref",
  KALSHI_API_KEY_ID: "Kalshi API key ref",
  KALSHI_PRIVATE_KEY: "Kalshi private key ref",
};

const DESK_SECTIONS = [
  { id: "overview", page: "overview", label: "Overview", icon: ActivitySquare },
  { id: "performance", page: "performance", label: "Performance", icon: TrendingUp },
  { id: "desk-status", page: "status", label: "Desk Status", icon: BriefcaseBusiness },
  { id: "workers", page: "workers", label: "Workers", icon: TimerReset },
  { id: "wallets", page: "wallets", label: "Wallets", icon: Wallet },
  { id: "signals", page: "signals", label: "Signals", icon: TrendingUp },
  { id: "paper-trades", page: "paper-trades", label: "Paper Trades", icon: ActivitySquare },
  { id: "risk-blocks", page: "risk-blocks", label: "Risk / Blocks", icon: ShieldAlert },
  { id: "auth-readiness", page: "auth-readiness", label: "Auth Readiness", icon: KeyRound },
  { id: "live-readiness", page: "live-readiness", label: "Live Readiness", icon: Radar },
  { id: "mirror-attempts", page: "mirror-attempts", label: "Mirror Attempts", icon: ArrowUpRight },
  { id: "audit", page: "audit", label: "Audit", icon: ScrollText },
] as const;

const EMPTY_SECRET_REF = "__none__";
const LIGHT_DESK_THEME = {
  colorScheme: "light",
  "--background": "oklch(0.985 0.004 236)",
  "--foreground": "oklch(0.205 0.01 258)",
  "--card": "oklch(1 0 0)",
  "--card-foreground": "oklch(0.205 0.01 258)",
  "--popover": "oklch(1 0 0)",
  "--popover-foreground": "oklch(0.205 0.01 258)",
  "--primary": "oklch(0.255 0.014 259)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--secondary": "oklch(0.952 0.02 160)",
  "--secondary-foreground": "oklch(0.325 0.05 160)",
  "--muted": "oklch(0.972 0.004 247)",
  "--muted-foreground": "oklch(0.52 0.012 255)",
  "--accent": "oklch(0.965 0.006 247)",
  "--accent-foreground": "oklch(0.205 0.01 258)",
  "--destructive": "oklch(0.62 0.22 27)",
  "--destructive-foreground": "oklch(0.985 0 0)",
  "--border": "oklch(0.915 0.006 255)",
  "--input": "oklch(0.915 0.006 255)",
  "--ring": "oklch(0.56 0.02 255)",
} as CSSProperties;
const DESK_SURFACE_CLASS = "rounded-[24px] border border-border/80 bg-white py-0 shadow-[0_18px_40px_rgba(15,23,42,0.05)]";
const TABLE_SURFACE_CLASS = "overflow-hidden rounded-[22px] border border-border/80 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]";
const INSET_SURFACE_CLASS = "rounded-[20px] border border-border/70 bg-muted/35";

type DeskSectionId = (typeof DESK_SECTIONS)[number]["id"];
type DeskSectionPage = (typeof DESK_SECTIONS)[number]["page"];

function buildDeskSectionPath(page: DeskSectionPage, companyPrefix?: string): string {
  return companyPrefix ? `/${companyPrefix}/desk/polymarket/${page}` : `/desk/polymarket/${page}`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "Never";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${value.toFixed(1)}%`;
}

function formatUsdOrUnavailable(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatUsd(value) : "n/a";
}

function formatKalshiBalanceSource(value: PolymarketCopyDashboardData["kalshiReadiness"]["balanceSource"]): string {
  if (value === "subaccount") return "Subaccount";
  if (value === "primary_account") return "Primary account";
  return "n/a";
}

function formatKalshiBalanceState(data: PolymarketCopyDashboardData["kalshiReadiness"]): string {
  if (data.balancesReachable) return "ready";
  return data.balanceErrorClass ?? "not_ready";
}

function formatKalshiBalanceStateVariant(data: PolymarketCopyDashboardData["kalshiReadiness"]): "secondary" | "outline" | "destructive" {
  if (data.balancesReachable) return "secondary";
  if (data.balanceErrorClass) return "destructive";
  return "outline";
}

function formatDurationMinutes(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  if (value < 60) return `${Math.round(value)}m`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

type MirrorAttemptMatchClass = "matched" | "near_match" | "rejected";

interface MirrorAttemptDiagnostic {
  id: string;
  timestamp: Date | string;
  sourceWallet: string;
  sourceWalletShort: string;
  sourceMarket: string;
  sourceMarketDetail: string | null;
  sourceSide: string | null;
  sourceAction: string;
  cadence: string;
  bestCandidate: string | null;
  closestCandidate: string | null;
  candidateTicker: string | null;
  matchConfidence: number | null;
  matchClass: MirrorAttemptMatchClass;
  rejectReasonCode: string | null;
  rejectReasonLabel: string;
  rejectBucket: string | null;
  rejectDetail: string | null;
  tradabilityState: string | null;
  spreadBps: number | null;
  liquidityUsd: number | null;
  simulatedOrderSizeUsd: number | null;
  simulatedFillPrice: number | null;
}

const MIRROR_REJECT_REASON_LABELS: Record<string, string> = {
  source_market_title_missing: "Source market title missing",
  kalshi_open_market_not_found: "No open Kalshi markets found",
  kalshi_no_equivalent_market: "No equivalent Kalshi market",
  kalshi_weak_semantic_match: "Weak semantic match",
  kalshi_contract_settlement_mismatch: "Contract or settlement mismatch",
  kalshi_market_not_tradable: "Market not tradable",
  kalshi_spread_too_wide: "Spread too wide",
  kalshi_liquidity_too_thin: "Liquidity too thin",
  kalshi_execution_disabled: "Kalshi execution disabled",
  system_not_in_live_mode: "System not in live mode",
  live_disabled: "Live disabled",
  trading_kill_switch_active: "Trading kill switch active",
  kalshi_live_auth_or_order_fields_missing: "Kalshi auth or order fields missing",
  kalshi_order_submission_failed: "Kalshi order submission failed",
  mirror_attempt_not_recorded: "Mirror attempt not recorded yet",
};

const MIRROR_REJECT_BUCKETS: Record<string, string> = {
  source_market_title_missing: "No equivalent market",
  kalshi_open_market_not_found: "No equivalent market",
  kalshi_no_equivalent_market: "No equivalent market",
  kalshi_weak_semantic_match: "Weak semantic match",
  kalshi_contract_settlement_mismatch: "Contract / settlement mismatch",
  kalshi_market_not_tradable: "Market closed / not tradable",
  kalshi_spread_too_wide: "Poor spread / weak liquidity",
  kalshi_liquidity_too_thin: "Poor spread / weak liquidity",
  kalshi_execution_disabled: "Auth / readiness issue",
  system_not_in_live_mode: "Auth / readiness issue",
  live_disabled: "Auth / readiness issue",
  trading_kill_switch_active: "Risk rule rejection",
  kalshi_live_auth_or_order_fields_missing: "Auth / readiness issue",
  kalshi_order_submission_failed: "Auth / readiness issue",
  mirror_attempt_not_recorded: "Auth / readiness issue",
};

const MIRROR_NEAR_MATCH_CODES = new Set([
  "kalshi_weak_semantic_match",
  "kalshi_contract_settlement_mismatch",
  "kalshi_market_not_tradable",
  "kalshi_spread_too_wide",
  "kalshi_liquidity_too_thin",
]);

function humanizeCode(value: string | null | undefined): string {
  if (!value) return "n/a";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatBasisPoints(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${Math.round(value)} bps`;
}

function formatConfidenceScore(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function shortenWalletAddress(value: string | null | undefined): string {
  if (!value) return "n/a";
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function toneForMatchClass(matchClass: MirrorAttemptMatchClass): "secondary" | "outline" | "destructive" {
  if (matchClass === "matched") return "secondary";
  if (matchClass === "near_match") return "outline";
  return "destructive";
}

function labelForMatchClass(matchClass: MirrorAttemptMatchClass): string {
  return matchClass === "near_match" ? "near match" : matchClass;
}

function formatTradabilityState(value: string | null | undefined): string {
  if (value === "tradable") return "Tradable";
  if (value === "open_unquoted") return "Open, but unquoted";
  if (value === "closed") return "Closed";
  return value ? humanizeCode(value) : "n/a";
}

function mirrorRejectReasonLabel(reasonCode: string | null | undefined): string {
  if (!reasonCode) return "Matched";
  return MIRROR_REJECT_REASON_LABELS[reasonCode] ?? humanizeCode(reasonCode);
}

function mirrorRejectBucket(reasonCode: string | null | undefined): string | null {
  if (!reasonCode) return null;
  return MIRROR_REJECT_BUCKETS[reasonCode] ?? null;
}

function determineMirrorMatchClass(options: {
  reasonCode: string | null;
  confidence: number | null;
  candidateTitle: string | null;
  order: PolymarketCopyDashboardData["kalshiMirrorOrders"][number] | null;
  decision: PolymarketCopyDashboardData["signals"][number]["decision"] | null;
}): MirrorAttemptMatchClass {
  const { reasonCode, confidence, candidateTitle, order, decision } = options;
  if (order?.matchStatus === "matched" && order.executionStatus !== "match_rejected") {
    return "matched";
  }
  if (decision?.decision === "blocked" || decision?.decision === "skipped") {
    return "rejected";
  }
  if (reasonCode && MIRROR_NEAR_MATCH_CODES.has(reasonCode) && candidateTitle) {
    return "near_match";
  }
  if (candidateTitle && typeof confidence === "number" && confidence >= 0.56) {
    return "near_match";
  }
  return "rejected";
}

function averageNumber(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function buildCountBars(labels: Array<string | null | undefined>, limit = 6): Array<{ label: string; valueUsd: number }> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, valueUsd: count }));
}

function buildMirrorOutcomeTimeline(rows: MirrorAttemptDiagnostic[]): Array<{ label: string; matched: number; near: number; rejected: number }> {
  const buckets = new Map<number, { label: string; matched: number; near: number; rejected: number }>();
  for (const row of rows) {
    const date = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const bucketStart = new Date(date);
    bucketStart.setMinutes(0, 0, 0);
    const key = bucketStart.getTime();
    const entry = buckets.get(key) ?? {
      label: bucketStart.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" }),
      matched: 0,
      near: 0,
      rejected: 0,
    };
    if (row.matchClass === "matched") entry.matched += 1;
    else if (row.matchClass === "near_match") entry.near += 1;
    else entry.rejected += 1;
    buckets.set(key, entry);
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(-8)
    .map(([, value]) => value);
}

function buildMirrorAttemptDiagnostics(data: PolymarketCopyDashboardData): MirrorAttemptDiagnostic[] {
  const mirrorOrdersBySignalId = new Map(data.kalshiMirrorOrders.map((order) => [order.signalId, order] as const));

  return [...data.signals]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((signal) => {
      const order = mirrorOrdersBySignalId.get(signal.id) ?? null;
      const orderMetadata = asRecord(order?.metadata);
      const matchMetadata = asRecord(orderMetadata.match);
      const simulatedOrder = asRecord(orderMetadata.simulatedOrder);
      const derivedCandidateParts = [
        asString(matchMetadata.eventTitle),
        asString(matchMetadata.chosenSideLabel),
      ].filter((value): value is string => Boolean(value));
      const derivedCandidateTitle = derivedCandidateParts.length > 0
        ? derivedCandidateParts.join(" • ")
        : null;
      const candidateTitle = order?.kalshiMarketTitle
        ?? derivedCandidateTitle
        ?? asString(matchMetadata.marketTitle)
        ?? null;
      const reasonCode = order?.rejectionReason
        ?? (signal.decision && signal.decision.decision !== "accepted" ? signal.decision.reasonCode : null)
        ?? (signal.decision?.decision === "accepted" && !order ? "mirror_attempt_not_recorded" : null);
      const rejectDetail = asString(orderMetadata.rejectionDetail)
        ?? asString(orderMetadata.error)
        ?? signal.decision?.reasonDetail
        ?? (reasonCode === "mirror_attempt_not_recorded"
          ? "The signal reached the accepted path, but a mirror-attempt record has not been persisted yet."
          : null);
      const confidence = typeof order?.matchConfidence === "number" ? order.matchConfidence : null;
      const matchClass = determineMirrorMatchClass({
        reasonCode,
        confidence,
        candidateTitle,
        order,
        decision: signal.decision ?? null,
      });

      return {
        id: signal.id,
        timestamp: signal.createdAt,
        sourceWallet: signal.sourceWalletAddress,
        sourceWalletShort: shortenWalletAddress(signal.sourceWalletAddress),
        sourceMarket: signal.marketTitle || signal.marketId,
        sourceMarketDetail: signal.marketSlug || signal.marketId,
        sourceSide: signal.side,
        sourceAction: signal.action,
        cadence: signal.cadence,
        bestCandidate: candidateTitle,
        closestCandidate: candidateTitle,
        candidateTicker: order?.kalshiMarketTicker ?? asString(matchMetadata.candidateMarketTicker),
        matchConfidence: confidence,
        matchClass,
        rejectReasonCode: reasonCode,
        rejectReasonLabel: mirrorRejectReasonLabel(reasonCode),
        rejectBucket: signal.decision && signal.decision.decision !== "accepted"
          ? "Risk rule rejection"
          : mirrorRejectBucket(reasonCode),
        rejectDetail,
        tradabilityState: asString(matchMetadata.tradabilityState) ?? (reasonCode === "kalshi_market_not_tradable" ? "closed" : null),
        spreadBps: asNumber(matchMetadata.spreadBps),
        liquidityUsd: asNumber(matchMetadata.notionalLiquidityUsd),
        simulatedOrderSizeUsd: order?.notionalUsd ?? asNumber(simulatedOrder.notionalUsd),
        simulatedFillPrice: order?.limitPriceDollars ?? asNumber(simulatedOrder.limitPriceDollars),
      };
    });
}


function walletSelectionSnapshot(metadata: Record<string, unknown> | null | undefined) {
  const snapshot = asRecord(asRecord(metadata).snapshot);
  const demotionReasons = Array.isArray(snapshot.demotionReasons)
    ? snapshot.demotionReasons.filter((reason): reason is string => typeof reason === "string")
    : [];

  return {
    winRate: asNumber(snapshot.winRate),
    resolvedTrades: asNumber(snapshot.resolvedTrades),
    recentResolvedTrades30d: asNumber(snapshot.recentResolvedTrades30d),
    lastActivityAt: asString(snapshot.lastActivityAt),
    activeEligibilityTier: asString(snapshot.activeEligibilityTier),
    dominantCategory: asString(snapshot.dominantCategory),
    recentCategoryMixLabel: asString(snapshot.recentCategoryMixLabel),
    benchEligible: snapshot.benchEligible === true,
    hasRecentActivity: snapshot.hasRecentActivity === true,
    sportsHeavy: snapshot.sportsHeavy === true,
    diversified: snapshot.diversified === true,
    resolvedTradesLikelyTruncated: snapshot.resolvedTradesLikelyTruncated === true,
    closedPositionsFetchCeiling: asNumber(snapshot.closedPositionsFetchCeiling),
    demotionReasons,
  };
}

function formatWalletCategory(category: string | null): string {
  if (!category) return "Unclassified";
  return category
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function walletStatusLabel(wallet: PolymarketCopyDashboardData["watchedWallets"][number]): string {
  if (wallet.status === "active") return "Active";
  if (wallet.status === "bench") return "Bench";
  return wallet.activatedAt ? "Dropped" : "Rejected";
}

function walletStatusVariant(wallet: PolymarketCopyDashboardData["watchedWallets"][number]): "secondary" | "outline" | "destructive" {
  if (wallet.status === "active") return "secondary";
  if (wallet.status === "bench") return "outline";
  return wallet.activatedAt ? "destructive" : "outline";
}

function walletSelectionNote(wallet: PolymarketCopyDashboardData["watchedWallets"][number]): string {
  const snapshot = walletSelectionSnapshot(wallet.metadata);
  const truncationNote = snapshot.resolvedTradesLikelyTruncated && snapshot.closedPositionsFetchCeiling != null
    ? ` Closed history hit the current fetch ceiling (${snapshot.closedPositionsFetchCeiling}+), so lifetime resolved trades may be understated.`
    : "";
  if (wallet.status === "active" && snapshot.activeEligibilityTier === "preferred") {
    return `Preferred active: 70%+ win rate with full longevity and recent resolved-trade proof.${truncationNote}`;
  }
  if (wallet.status === "active" && snapshot.activeEligibilityTier === "fallback") {
    return `Fallback active: 65%+ win rate with full longevity proof when the stronger pool is thin.${truncationNote}`;
  }
  if (wallet.status === "bench") {
    return `Bench: promising copy source, but not yet fully proven for primary copying.${truncationNote}`;
  }
  if (snapshot.demotionReasons.length > 0) {
    return `Dropped for ${snapshot.demotionReasons.join(", ")}.${truncationNote}`;
  }
  return `Below the current copy-watch thresholds.${truncationNote}`;
}

function toneForDecision(decision: string | null | undefined): "outline" | "secondary" | "destructive" {
  if (decision === "accepted") return "secondary";
  if (decision === "blocked") return "destructive";
  return "outline";
}

function toneForBoolean(
  value: boolean,
  positiveVariant: "secondary" | "outline" | "destructive" = "secondary",
): "secondary" | "outline" | "destructive" {
  return value ? positiveVariant : "outline";
}

function toneForHealth(health: string): "secondary" | "outline" | "destructive" {
  if (health === "healthy" || health === "success") return "secondary";
  if (health === "failed") return "destructive";
  return "outline";
}

function boundSecretId(authEnv: AgentEnvConfig | null | undefined, key: PolymarketCopySecretEnvKey): string | null {
  const binding = authEnv?.[key];
  if (typeof binding !== "object" || binding == null || Array.isArray(binding)) return null;
  if ((binding as { type?: unknown }).type !== "secret_ref") return null;
  const secretId = (binding as { secretId?: unknown }).secretId;
  return typeof secretId === "string" ? secretId : null;
}

function buildNextAuthEnv(
  authEnv: AgentEnvConfig | null | undefined,
  key: PolymarketCopySecretEnvKey,
  secretId: string | null,
): AgentEnvConfig | null {
  const next: AgentEnvConfig = { ...(authEnv ?? {}) };
  if (secretId) {
    next[key] = { type: "secret_ref", secretId, version: "latest" };
  } else {
    delete next[key];
  }
  return Object.keys(next).length > 0 ? next : null;
}

function secretOptionLabel(secret: CompanySecret): string {
  return secret.name;
}

function SectionMenu({
  activeSection,
  companyPrefix,
  compact = false,
  collapsed = false,
  onSelect,
}: {
  activeSection: DeskSectionId;
  companyPrefix?: string;
  compact?: boolean;
  collapsed?: boolean;
  onSelect?: (sectionId: DeskSectionId) => void;
}) {
  return (
    <nav className={compact ? "flex gap-2 overflow-x-auto pb-1" : "flex flex-col gap-1.5"}>
      {DESK_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = section.id === activeSection;
        return (
          <NavLink
            key={section.id}
            to={buildDeskSectionPath(section.page, companyPrefix)}
            end
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect?.(section.id)}
            className={
              compact
                ? `flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-white text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                }`
                : `flex items-center ${collapsed ? "justify-center" : "gap-3"} rounded-[14px] border px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "border-[#9ec6e3] bg-[#dff1ff] text-[#103f5c]"
                    : "border-transparent text-muted-foreground hover:border-[#d0e3f2] hover:bg-[#f0f6fb] hover:text-foreground"
                }`
            }
            title={collapsed ? section.label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{section.label}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

function DeskSection({
  active = true,
  id,
  title,
  description,
  children,
  actions,
}: {
  active?: boolean;
  id: DeskSectionId;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  if (!active) return null;

  return (
    <section id={id} className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function HeaderStatusCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[18px] border border-border/80 bg-white/95 px-3.5 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 min-w-0 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function OverviewCards({ data }: { data: PolymarketCopyDashboardData }) {
  const items: Array<{
    icon: LucideIcon;
    label: string;
    value: string | number;
    description: string;
  }> = [
    {
      icon: Wallet,
      label: "Watched wallets",
      value: data.overview.watchedWalletCount,
      description: "Active source wallets feeding the desk.",
    },
    {
      icon: TrendingUp,
      label: "Signals today",
      value: data.overview.signalsToday,
      description: `${data.overview.acceptedCount} accepted • ${data.overview.blockedCount} blocked`,
    },
    {
      icon: ActivitySquare,
      label: "Open paper trades",
      value: data.overview.paperTradesOpen,
      description: `${data.overview.paperTradesClosed} closed positions so far`,
    },
    {
      icon: ShieldAlert,
      label: "Realized PnL",
      value: formatUsd(data.overview.realizedPnlUsd),
      description: `Unrealized ${formatUsd(data.overview.unrealizedPnlUsd)}`,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="rounded-[20px] border border-border/80 bg-white px-4 py-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-2xl font-semibold tracking-tight text-foreground">{item.value}</div>
                <div className="mt-1 text-sm font-medium text-foreground/80">{item.label}</div>
                <div className="mt-1.5 text-xs leading-5 text-muted-foreground">{item.description}</div>
              </div>
              <div className="rounded-full border border-border/80 bg-muted/50 p-2 text-muted-foreground">
                <Icon className="h-4 w-4" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}


function clampProgress(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function PerformanceMetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: ReactNode;
  description: string;
}) {
  return (
    <div className="rounded-[20px] border border-border/80 bg-white px-4 py-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</div>
    </div>
  );
}

function PerformanceTrendChart({
  points,
}: {
  points: Array<{ label: string; value: number }>;
}) {
  if (points.length === 0) {
    return <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/20 p-6 text-sm text-muted-foreground">No performance points yet for this baseline window.</div>;
  }

  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(maxValue - minValue, 1);
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = 36 - (((point.value - minValue) / span) * 28);
    return `${x},${y}`;
  });
  const polyline = coordinates.join(" ");
  const polygon = `0,36 ${polyline} 100,36`;

  return (
    <div className="space-y-3">
      <div className="rounded-[18px] border border-border/80 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <svg viewBox="0 0 100 40" className="h-44 w-full">
          <defs>
            <linearGradient id="polymarket-equity-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(56, 117, 215, 0.24)" />
              <stop offset="100%" stopColor="rgba(56, 117, 215, 0.03)" />
            </linearGradient>
          </defs>
          <line x1="0" y1="36" x2="100" y2="36" stroke="rgba(148, 163, 184, 0.45)" strokeWidth="0.6" />
          <polygon points={polygon} fill="url(#polymarket-equity-fill)" />
          <polyline points={polyline} fill="none" stroke="#2f6fb2" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{points[0]?.label ?? "Start"}</span>
        <span>{points[points.length - 1]?.label ?? "Latest"}</span>
      </div>
    </div>
  );
}

function PerformanceBarList({
  items,
  empty,
  valueFormatter = formatUsd,
}: {
  items: Array<{ label: string; valueUsd: number }>;
  empty: string;
  valueFormatter?: (value: number) => string;
}) {
  if (items.length === 0) {
    return <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">{empty}</div>;
  }

  const maxValue = Math.max(...items.map((item) => Math.abs(item.valueUsd)), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const width = `${Math.max(8, (Math.abs(item.valueUsd) / maxValue) * 100)}%`;
        const negative = item.valueUsd < 0;
        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{item.label}</span>
              <span className={`font-medium ${negative ? "text-destructive" : "text-foreground"}`}>{valueFormatter(item.valueUsd)}</span>
            </div>
            <div className="h-2 rounded-full bg-muted/55">
              <div
                className={`h-2 rounded-full ${negative ? "bg-[#d86b5f]" : "bg-[#3f7cc4]"}`}
                style={{ width }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProgressBar({
  value,
  tone = "blue",
}: {
  value: number;
  tone?: "blue" | "green" | "slate";
}) {
  const width = clampProgress(value);
  const toneClass = tone === "green"
    ? "bg-[#3d9463]"
    : tone === "slate"
      ? "bg-[#64748b]"
      : "bg-[#2f6fb2]";

  return (
    <div className="h-2.5 rounded-full bg-muted/55">
      <div
        className={`h-2.5 rounded-full ${toneClass}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function GoalProgressGraphic({ performance }: { performance: PolymarketCopyDashboardData["performance"] }) {
  const progress = clampProgress(performance.targetProgressPct);
  const ringStyle: CSSProperties = {
    background: `conic-gradient(${performance.targetAchieved ? "#3d9463" : "#2f6fb2"} ${progress}%, rgba(148,163,184,0.18) ${progress}% 100%)`,
  };

  return (
    <Card className={DESK_SURFACE_CLASS}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Goal Progress</CardTitle>
        <CardDescription>Trailing 30d realized PnL against the monthly subscription target.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
        <div className="flex justify-center">
          <div className="relative h-40 w-40 rounded-full p-3" style={ringStyle}>
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(148,163,184,0.14)]">
              <div className="text-3xl font-semibold tracking-tight text-foreground">{Math.round(progress)}%</div>
              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">to goal</div>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={performance.targetAchieved ? "secondary" : "outline"}>
              {performance.targetAchieved ? "Goal met" : "In progress"}
            </Badge>
            <Badge variant="outline">Trailing 30d: {formatUsd(performance.trailing30dRealizedPnlUsd)}</Badge>
            <Badge variant="outline">Remaining: {formatUsd(performance.targetGapUsd)}</Badge>
          </div>
          <div className="space-y-3 text-sm text-foreground/85">
            <div>
              <div className="flex items-center justify-between gap-3 pb-1.5">
                <span>Monthly target</span>
                <span className="font-medium">{formatUsd(performance.monthlyTargetUsd)}</span>
              </div>
              <ProgressBar value={progress} tone={performance.targetAchieved ? "green" : "blue"} />
            </div>
            <div className={`${INSET_SURFACE_CLASS} grid gap-3 p-4 sm:grid-cols-3`}>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Realized</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(performance.trailing30dRealizedPnlUsd)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Gap</div>
                <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(performance.targetGapUsd)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Use case</div>
                <div className="mt-1 text-sm font-medium text-foreground">Subscription coverage</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CapitalFrameworkGraphic({ performance }: { performance: PolymarketCopyDashboardData["performance"] }) {
  const walletProgress = clampProgress(performance.capitalProgressPct);
  const activeCapitalProgress = performance.capitalCapUsd > 0
    ? clampProgress((performance.activeTradingCapitalUsd / performance.capitalCapUsd) * 100)
    : 0;
  const isCapped = performance.currentWalletEquityUsd >= performance.capitalCapUsd;

  return (
    <Card className={DESK_SURFACE_CLASS}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Capital Growth / Cap</CardTitle>
        <CardDescription>Shows whether the copy desk is still compounding or already capped at active trading capital.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isCapped ? "secondary" : "outline"}>{isCapped ? "Capped" : "Growth mode"}</Badge>
          <Badge variant="outline">Mode: {performance.activeTradingCapitalMode}</Badge>
          <Badge variant="outline">Sweep reserve: {formatUsd(performance.profitSweepReserveUsd)}</Badge>
        </div>
        <div className={`${INSET_SURFACE_CLASS} space-y-4 p-4`}>
          <div>
            <div className="flex items-center justify-between gap-3 pb-1.5 text-sm">
              <span>Wallet equity</span>
              <span className="font-medium">{formatUsd(performance.currentWalletEquityUsd)} / {formatUsd(performance.capitalCapUsd)}</span>
            </div>
            <ProgressBar value={walletProgress} tone={isCapped ? "green" : "blue"} />
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 pb-1.5 text-sm">
              <span>Active trading capital</span>
              <span className="font-medium">{formatUsd(performance.activeTradingCapitalUsd)} / {formatUsd(performance.capitalCapUsd)}</span>
            </div>
            <ProgressBar value={activeCapitalProgress} tone="slate" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <div className="rounded-[18px] border border-border/80 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Capital cap</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(performance.capitalCapUsd)}</div>
          </div>
          <div className="rounded-[18px] border border-border/80 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sweepable profit</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{formatUsd(performance.sweepableProfitUsd)}</div>
          </div>
          <div className="rounded-[18px] border border-border/80 bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">State</div>
            <div className="mt-1 text-sm font-medium text-foreground">{isCapped ? "Profit above cap can be swept" : "Still compounding toward cap"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PerformanceView({ data }: { data: PolymarketCopyDashboardData }) {
  const performance = data.performance;
  const equityPoints = performance.equityCurve.map((point) => ({
    label: point.label,
    value: point.equityUsd,
  }));
  const dailyPnlPoints = performance.dailyPnl;

  return (
    <div className="space-y-4">
      <Card className={DESK_SURFACE_CLASS}>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Performance Window</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{performance.baseline.label}</div>
              <div className="mt-1 text-sm text-muted-foreground">Started {formatDate(performance.baseline.startedAt)} with {formatUsd(performance.baseline.startingBankrollUsd)} launch bankroll. Active trading capital is capped at {formatUsd(performance.capitalCapUsd)}.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={performance.automation.walletSelectorAutoRunActive ? "secondary" : "outline"}>Wallet Selector Auto: {performance.automation.walletSelectorAutoRunActive ? "active" : "off"}</Badge>
              <Badge variant={performance.automation.monitor5mAutoRunActive ? "secondary" : "outline"}>5m Auto: {performance.automation.monitor5mAutoRunActive ? "active" : "off"}</Badge>
              <Badge variant={performance.automation.monitor15mAutoRunActive ? "secondary" : "outline"}>15m Auto: {performance.automation.monitor15mAutoRunActive ? "active" : "off"}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PerformanceMetricCard label="Current Wallet Equity" value={formatUsd(performance.currentWalletEquityUsd)} description="Launch bankroll plus realized and unrealized paper PnL." />
        <PerformanceMetricCard label="Active Trading Capital" value={formatUsd(performance.activeTradingCapitalUsd)} description="Live sizing base after the capped-equity framework is applied." />
        <PerformanceMetricCard label="Capital Cap" value={formatUsd(performance.capitalCapUsd)} description="Maximum active capital allowed to compound inside the paper test." />
        <PerformanceMetricCard label="Trailing 30d Realized PnL" value={formatUsd(performance.trailing30dRealizedPnlUsd)} description="Closed paper profit in the trailing 30-day window." />
        <PerformanceMetricCard label="Monthly Goal ($200)" value={formatUsd(performance.monthlyTargetUsd)} description="Subscription-funding target for the copy desk." />
        <PerformanceMetricCard label="Sweepable Profit" value={formatUsd(performance.sweepableProfitUsd)} description={`Profit above ${formatUsd(performance.capitalCapUsd)} plus the ${formatUsd(performance.profitSweepReserveUsd)} reserve.`} />
        <PerformanceMetricCard label="Remaining Gap to Goal" value={formatUsd(performance.targetGapUsd)} description="Additional realized profit needed in the trailing 30-day window." />
        <PerformanceMetricCard label="Goal Status" value={<Badge variant={performance.targetAchieved ? "secondary" : "outline"}>{performance.targetAchieved ? "Target achieved" : "Below target"}</Badge>} description="Whether current realized performance covers the monthly subscription goal." />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <GoalProgressGraphic performance={performance} />
        <CapitalFrameworkGraphic performance={performance} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PerformanceMetricCard label="Kalshi Wallet Balance" value={formatUsdOrUnavailable(data.kalshiReadiness.walletBalanceUsd)} description={data.kalshiReadiness.balancesReachable ? "Authenticated Kalshi primary-account balance fetched successfully." : `Balance access: ${formatKalshiBalanceState(data.kalshiReadiness)}`} />
        <PerformanceMetricCard label="Kalshi Portfolio Value" value={formatUsdOrUnavailable(data.kalshiReadiness.portfolioValueUsd)} description={data.kalshiReadiness.balanceErrorDetail ?? "Venue-reported portfolio value when available from the authenticated balance endpoint."} />
        <PerformanceMetricCard label="Last Balance Sync" value={formatDate(data.kalshiReadiness.lastSuccessfulBalanceSyncAt)} description="Latest successful authenticated Kalshi balance read inside the current desk session." />
        <PerformanceMetricCard label="Kalshi Balance Source" value={formatKalshiBalanceSource(data.kalshiReadiness.balanceSource)} description="Which authenticated Kalshi balance scope the desk is reading right now." />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PerformanceMetricCard label="Source Signals" value={performance.sourceSignalCount} description="Polymarket source-wallet signals observed inside the current paper baseline window." />
        <PerformanceMetricCard label="Kalshi Matches" value={performance.kalshiMatchCount} description="Signals that found a sufficiently equivalent Kalshi market for mirroring." />
        <PerformanceMetricCard label="Rejected Matches" value={performance.kalshiRejectedMatchCount} description="Signals rejected because the Kalshi translation, spread, or liquidity quality was not good enough." />
        <PerformanceMetricCard label="Dry-Run Mirror Orders" value={performance.dryRunMirroredOrders} description="Simulated Kalshi mirror orders recorded without sending a live venue order." />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <PerformanceMetricCard label="Total PnL" value={formatUsd(performance.totalPnlUsd)} description="Primary paper performance since the baseline window began." />
        <PerformanceMetricCard label="Today PnL" value={formatUsd(performance.todayPnlUsd)} description="Realized paper PnL booked today in the live runtime." />
        <PerformanceMetricCard label="Realized PnL" value={formatUsd(performance.realizedPnlUsd)} description="Closed paper gains and losses since baseline." />
        <PerformanceMetricCard label="Unrealized PnL" value={formatUsd(performance.unrealizedPnlUsd)} description="Open paper-position mark-to-market since baseline." />
        <PerformanceMetricCard label="Win Rate" value={formatPercent(performance.winRatePct)} description="Closed-trade paper win rate in the active baseline window." />
        <PerformanceMetricCard label="Current Exposure %" value={formatPercent(performance.currentExposurePct)} description={`${formatUsd(performance.currentExposureUsd)} currently deployed across open paper copy positions.`} />
        <PerformanceMetricCard label="Available Paper Cash %" value={formatPercent(performance.availablePaperCashPct)} description={`${formatUsd(performance.availablePaperCashUsd)} available inside ${formatUsd(performance.activeTradingCapitalUsd)} active trading capital.`} />
        <PerformanceMetricCard label="Active Open Positions" value={performance.activeOpenPositions} description="Current open paper copy positions across both monitor cadences." />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr),minmax(0,0.95fr)]">
        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Equity Curve</CardTitle>
            <CardDescription>Paper equity since the current baseline window started.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceTrendChart points={equityPoints} />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily PnL</CardTitle>
            <CardDescription>Realized plus mark-to-market change by day inside the baseline window.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList items={dailyPnlPoints} empty="No daily PnL bars yet for this baseline." />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">PnL by Copied Wallet</CardTitle>
            <CardDescription>Which watched wallets are actually delivering copy performance.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList items={performance.pnlByWallet} empty="No copied-wallet attribution yet for this baseline." />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">PnL by Bot</CardTitle>
            <CardDescription>Compare the 5m copy bot against the 15m confirmation bot.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList items={performance.pnlByBot} empty="No bot attribution yet for this baseline." />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Mirrored Kalshi Markets</CardTitle>
            <CardDescription>Dry-run mirror activity by matched Kalshi market notional.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList items={performance.topKalshiMarkets} empty="No matched Kalshi markets yet for this baseline." />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Exposure by Wallet</CardTitle>
            <CardDescription>Current concentration across watched-wallet copy sources.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList items={performance.exposureByWallet} empty="No open exposure yet." />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Blocked / Skipped Reasons</CardTitle>
            <CardDescription>Why the deterministic risk path is rejecting or pausing copy candidates.</CardDescription>
          </CardHeader>
          <CardContent>
            {performance.decisionReasons.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">No blocked or skipped reasons yet in this baseline window.</div>
            ) : (
              <div className="space-y-3">
                {performance.decisionReasons.map((item) => (
                  <div key={item.reasonCode} className="flex items-center justify-between rounded-[18px] border border-border/80 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                    <span className="text-sm text-foreground">{item.reasonCode}</span>
                    <span className="text-sm font-semibold text-foreground">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={DESK_SURFACE_CLASS}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Kalshi Mirror Output</CardTitle>
          <CardDescription>Latest source-led mirror attempts from Polymarket signals into Kalshi dry-run execution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.kalshiMirrorOrders.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
              No Kalshi mirror attempts have been recorded yet for this baseline window.
            </div>
          ) : (
            data.kalshiMirrorOrders.slice(0, 6).map((order) => (
              <div key={order.id} className="rounded-[18px] border border-border/80 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{order.kalshiMarketTitle ?? order.sourceMarketTitle ?? order.sourceMarketId}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{order.executionMode} • {order.executionStatus} • {formatDate(order.createdAt)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={order.matchStatus === "matched" ? "secondary" : "outline"}>{order.matchStatus}</Badge>
                    <Badge variant={order.executionStatus === "dry_run_recorded" ? "secondary" : order.executionStatus === "execution_failed" ? "destructive" : "outline"}>{order.executionStatus}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>Signal source: {order.cadence}</span>
                  <span>Contracts: {order.contractCount ?? "n/a"}</span>
                  <span>Notional: {order.notionalUsd == null ? "n/a" : formatUsd(order.notionalUsd)}</span>
                  <span>Confidence: {order.matchConfidence == null ? "n/a" : `${Math.round(order.matchConfidence * 100)}%`}</span>
                </div>
                {order.rejectionReason && (
                  <div className="mt-2 text-xs leading-5 text-[#8d3c34]">{order.rejectionReason}</div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className={DESK_SURFACE_CLASS}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">High-Level Insights</CardTitle>
          <CardDescription>The fastest read on what is working, where risk is concentrated, and whether automation is alive.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 xl:grid-cols-2">
          <div className={`${INSET_SURFACE_CLASS} p-4 text-sm`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4"><span>Best wallet</span><span className="font-medium">{performance.insights.bestWallet ? `${performance.insights.bestWallet.label} (${formatUsd(performance.insights.bestWallet.valueUsd)})` : "n/a"}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Worst wallet</span><span className="font-medium">{performance.insights.worstWallet ? `${performance.insights.worstWallet.label} (${formatUsd(performance.insights.worstWallet.valueUsd)})` : "n/a"}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Best trade</span><span className="font-medium">{performance.insights.bestTrade ? `${performance.insights.bestTrade.label} (${formatUsd(performance.insights.bestTrade.pnlUsd)})` : "n/a"}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Worst trade</span><span className="font-medium">{performance.insights.worstTrade ? `${performance.insights.worstTrade.label} (${formatUsd(performance.insights.worstTrade.pnlUsd)})` : "n/a"}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Average hold time</span><span className="font-medium">{formatDurationMinutes(performance.insights.averageHoldMinutes)}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Bot leader</span><span className="font-medium">{performance.insights.botLeader}</span></div>
            </div>
          </div>

          <div className={`${INSET_SURFACE_CLASS} p-4 text-sm`}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4"><span>Wallet selector schedule</span><span className="font-medium">{performance.automation.walletSelectorSchedule}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Latest wallet selection</span><span className="font-medium">{formatDate(performance.automation.latestSuccessfulWalletSelectionRun)}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Latest 5m success</span><span className="font-medium">{formatDate(performance.automation.latestSuccessful5mRun)}</span></div>
              <div className="flex items-center justify-between gap-4"><span>Latest 15m success</span><span className="font-medium">{formatDate(performance.automation.latestSuccessful15mRun)}</span></div>
            </div>

            <div className="mt-4 space-y-2">
              {performance.insights.concentrationWarnings.length === 0 ? (
                <div className="rounded-[16px] border border-border/80 bg-white px-4 py-3 text-muted-foreground">No concentration warnings are active right now.</div>
              ) : (
                performance.insights.concentrationWarnings.map((warning) => (
                  <div key={warning} className="rounded-[16px] border border-[#f2d2cd] bg-[#fff6f5] px-4 py-3 text-[#8d3c34]">
                    {warning}
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AttemptOutcomeTimeline({
  items,
  empty,
}: {
  items: Array<{ label: string; matched: number; near: number; rejected: number }>;
  empty: string;
}) {
  if (items.length === 0) {
    return <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">{empty}</div>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const total = item.matched + item.near + item.rejected;
        const matchedWidth = total > 0 ? (item.matched / total) * 100 : 0;
        const nearWidth = total > 0 ? (item.near / total) * 100 : 0;
        const rejectedWidth = total > 0 ? (item.rejected / total) * 100 : 0;

        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{item.label}</span>
              <span className="text-muted-foreground">{total} attempts</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted/55">
              {matchedWidth > 0 && <div className="bg-[#3d9463]" style={{ width: `${matchedWidth}%` }} />}
              {nearWidth > 0 && <div className="bg-[#d6a93a]" style={{ width: `${nearWidth}%` }} />}
              {rejectedWidth > 0 && <div className="bg-[#d86b5f]" style={{ width: `${rejectedWidth}%` }} />}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Matched {item.matched}</span>
              <span>Near {item.near}</span>
              <span>Rejected {item.rejected}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MirrorAttemptsView({ data }: { data: PolymarketCopyDashboardData }) {
  const diagnostics = useMemo(() => buildMirrorAttemptDiagnostics(data), [data]);
  const matchedRows = diagnostics.filter((row) => row.matchClass === "matched");
  const nearRows = diagnostics.filter((row) => row.matchClass === "near_match");
  const rejectedRows = diagnostics.filter((row) => row.matchClass === "rejected");
  const matchRatePct = diagnostics.length > 0 ? (matchedRows.length / diagnostics.length) * 100 : 0;
  const avgMatchScore = averageNumber(diagnostics.map((row) => row.matchConfidence));
  const avgMatchedSpreadBps = averageNumber(matchedRows.map((row) => row.spreadBps));
  const rejectionReasonBars = buildCountBars(rejectedRows.map((row) => row.rejectBucket ?? row.rejectReasonLabel));
  const walletMatchBars = buildCountBars(matchedRows.map((row) => row.sourceWalletShort));
  const botMatchBars = buildCountBars(matchedRows.map((row) => `${row.cadence} Copy Bot`));
  const candidateAttemptBars = buildCountBars(diagnostics.map((row) => row.bestCandidate ?? row.closestCandidate));
  const outcomeTimeline = buildMirrorOutcomeTimeline(diagnostics);
  const topRejectReason = rejectionReasonBars[0]
    ? `${rejectionReasonBars[0].label} (${Math.round(rejectionReasonBars[0].valueUsd)})`
    : "n/a";
  const topSourceWallet = walletMatchBars[0]
    ? `${walletMatchBars[0].label} (${Math.round(walletMatchBars[0].valueUsd)})`
    : "n/a";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <PerformanceMetricCard label="Source Signals" value={diagnostics.length} description="Recent Polymarket source signals reviewed for high-confidence Kalshi mirror translation." />
        <PerformanceMetricCard label="Kalshi Matches" value={matchedRows.length} description="Signals with a sufficiently equivalent Kalshi market and simulated dry-run order path." />
        <PerformanceMetricCard label="Near Matches" value={nearRows.length} description="Signals that found a close Kalshi candidate, but not one strong enough to mirror safely yet." />
        <PerformanceMetricCard label="Rejected Matches" value={rejectedRows.length} description="Signals rejected because equivalence, tradability, readiness, or risk conditions were not good enough." />
        <PerformanceMetricCard label="Match Rate %" value={formatPercent(matchRatePct)} description="Share of recent source signals that produced a high-confidence Kalshi match." />
        <PerformanceMetricCard label="Avg Match Score" value={formatConfidenceScore(avgMatchScore)} description="Average translation confidence across recent source-signal diagnostics." />
        <PerformanceMetricCard label="Avg Spread on Matched Signals" value={formatBasisPoints(avgMatchedSpreadBps)} description="Average Kalshi side spread on signals that actually matched." />
        <PerformanceMetricCard label="Top Reject Reason" value={topRejectReason} description="Most common reason recent mirror attempts did not clear the match gate." />
        <PerformanceMetricCard label="Top Source Wallets by Match Count" value={topSourceWallet} description="Most frequently matched recent source wallet in the mirror diagnostics window." />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rejection Reasons Breakdown</CardTitle>
            <CardDescription>Why recent source-led mirror attempts were rejected or held back.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList
              items={rejectionReasonBars}
              empty="No rejected or risk-held mirror attempts yet in the current diagnostics window."
              valueFormatter={(value) => `${Math.round(value)} attempts`}
            />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Matched vs Near vs Rejected Over Time</CardTitle>
            <CardDescription>Recent mirror-attempt outcomes bucketed by hour for operator scanning.</CardDescription>
          </CardHeader>
          <CardContent>
            <AttemptOutcomeTimeline items={outcomeTimeline} empty="No mirror-attempt outcome timeline is available yet." />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Match Count by Source Wallet</CardTitle>
            <CardDescription>Which watched wallets are producing the most usable Kalshi mirror opportunities.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList
              items={walletMatchBars}
              empty="No matched source wallets yet in the current diagnostics window."
              valueFormatter={(value) => `${Math.round(value)} matches`}
            />
          </CardContent>
        </Card>

        <Card className={DESK_SURFACE_CLASS}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Match Count by Bot</CardTitle>
            <CardDescription>Compare usable mirror opportunities coming from the 5m and 15m copy bots.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList
              items={botMatchBars}
              empty="No matched mirror opportunities by bot yet."
              valueFormatter={(value) => `${Math.round(value)} matches`}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2 rounded-[24px] border border-border/80 bg-white py-0 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Kalshi Candidate Markets by Attempt Count</CardTitle>
            <CardDescription>Which Kalshi markets are being considered most often by the source-led mirror pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <PerformanceBarList
              items={candidateAttemptBars}
              empty="No Kalshi candidate markets have been considered yet."
              valueFormatter={(value) => `${Math.round(value)} attempts`}
            />
          </CardContent>
        </Card>
      </div>

      <SectionTable
        empty="No source signals are available yet for mirror diagnostics."
        headers={["Time", "Source Wallet", "Source Market / Side", "Bot", "Best Kalshi Candidate", "Match", "Reject Reason / Why", "Tradability / Liquidity", "Simulated Order"]}
        rows={diagnostics.map((attempt) => [
          formatDate(attempt.timestamp),
          <div key="wallet" className="space-y-1">
            <div className="font-mono text-xs">{attempt.sourceWallet}</div>
            <div className="text-xs text-muted-foreground">{attempt.sourceWalletShort}</div>
          </div>,
          <div key="source-market" className="space-y-1">
            <div>{attempt.sourceMarket}</div>
            <div className="text-xs text-muted-foreground">{attempt.sourceMarketDetail ?? "No extra market slug"}</div>
            <div className="text-xs text-muted-foreground">Side: {attempt.sourceSide ?? "n/a"} • {humanizeCode(attempt.sourceAction)}</div>
          </div>,
          <div key="cadence" className="space-y-1">
            <div className="font-medium">{attempt.cadence} Copy Bot</div>
            <div className="text-xs text-muted-foreground">Originating bot</div>
          </div>,
          <div key="candidate" className="space-y-1">
            <div>{attempt.bestCandidate ?? "No acceptable Kalshi candidate"}</div>
            <div className="text-xs text-muted-foreground">Closest candidate: {attempt.closestCandidate ?? "none"}</div>
            <div className="text-xs text-muted-foreground">Ticker: {attempt.candidateTicker ?? "n/a"}</div>
          </div>,
          <div key="match" className="space-y-1">
            <Badge variant={toneForMatchClass(attempt.matchClass)}>{labelForMatchClass(attempt.matchClass)}</Badge>
            <div className="text-xs text-muted-foreground">Score {formatConfidenceScore(attempt.matchConfidence)}</div>
          </div>,
          <div key="reject" className="space-y-1">
            <div className="font-medium text-foreground">{attempt.rejectReasonLabel}</div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{attempt.rejectBucket ?? "Matched"}</div>
            <div className="text-xs leading-5 text-muted-foreground">{attempt.rejectDetail ?? "High-confidence equivalent Kalshi market found."}</div>
          </div>,
          <div key="venue" className="space-y-1 text-xs text-muted-foreground">
            <div>Tradability: {formatTradabilityState(attempt.tradabilityState)}</div>
            <div>Spread: {formatBasisPoints(attempt.spreadBps)}</div>
            <div>Liquidity: {attempt.liquidityUsd == null ? "n/a" : formatUsd(attempt.liquidityUsd)}</div>
          </div>,
          <div key="sim-order" className="space-y-1 text-xs text-muted-foreground">
            <div>Size: {attempt.simulatedOrderSizeUsd == null ? "n/a" : formatUsd(attempt.simulatedOrderSizeUsd)}</div>
            <div>Fill / price: {attempt.simulatedFillPrice == null ? "n/a" : `$${attempt.simulatedFillPrice.toFixed(3)}`}</div>
            <div>Timestamp: {formatDate(attempt.timestamp)}</div>
          </div>,
        ])}
      />
    </div>
  );
}


function SectionTable({
  empty,
  headers,
  rows,
}: {
  empty: string;
  headers: string[];
  rows: Array<Array<ReactNode>>;
}) {
  if (rows.length === 0) {
    return (
      <div className={`${TABLE_SURFACE_CLASS} p-6 text-sm text-muted-foreground`}>
        {empty}
      </div>
    );
  }

  return (
    <div className={TABLE_SURFACE_CLASS}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/70 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.map((row, index) => (
              <tr key={index} className={index % 2 === 0 ? "bg-white" : "bg-muted/15"}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-3 align-top text-foreground/90">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: PolymarketCopySignalDecisionRecord | null }) {
  return (
    <Badge variant={toneForDecision(decision?.decision)}>
      {decision?.decision ?? "pending"}
    </Badge>
  );
}

function TradeStatusBadge({ trade }: { trade: PolymarketCopyPaperTrade }) {
  return (
    <Badge variant={trade.status === "open" ? "secondary" : "outline"}>
      {trade.status}
    </Badge>
  );
}

function AuthReadinessPanel(props: {
  data: PolymarketCopyDashboardData;
  availableSecrets: CompanySecret[];
  isSecretsLoading: boolean;
  secretsErrorMessage: string | null;
  statusMessage: string | null;
  privateKeyDraft: string;
  onPrivateKeyDraftChange: (value: string) => void;
  onStorePrivateKey: () => void;
  onCheckReadiness: () => void;
  onDeriveCredentials: () => void;
  onRefreshStatus: () => void;
  onBindSecret: (key: PolymarketCopySecretEnvKey, secretId: string | null) => void;
  isStoringPrivateKey: boolean;
  isCheckingReadiness: boolean;
  isDerivingCredentials: boolean;
  isUpdatingSecretRef: boolean;
}) {
  const readiness = props.data.authReadiness;

  return (
    <Card className={DESK_SURFACE_CLASS}>
      <CardHeader className="flex flex-col gap-4 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Auth Readiness
          </CardTitle>
          <CardDescription>
            Config-only validation through the existing Paperclip secrets system. No trade or live order call is made here.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border/80 bg-white"
            onClick={props.onCheckReadiness}
            disabled={props.isCheckingReadiness}
          >
            Check Auth Readiness
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-border/80 bg-white"
            onClick={props.onDeriveCredentials}
            disabled={props.isDerivingCredentials || !readiness.canDeriveApiCredentials}
          >
            Derive API Credentials
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-border/80 bg-white"
            onClick={props.onRefreshStatus}
          >
            Refresh Readiness Status
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap gap-2">
          <Badge variant={readiness.paperModeActive ? "secondary" : "outline"}>
            Paper Mode Active: {String(readiness.paperModeActive)}
          </Badge>
          <Badge variant={toneForBoolean(readiness.liveEnabled, "destructive")}>
            Live Enabled: {String(readiness.liveEnabled)}
          </Badge>
          <Badge variant={readiness.tradingKillSwitch ? "destructive" : "secondary"}>
            Trading Kill Switch: {readiness.tradingKillSwitch ? "on" : "off"}
          </Badge>
          <Badge variant={readiness.authenticatedLiveReadiness === "ready" ? "secondary" : "outline"}>
            Authenticated Live Readiness: {readiness.authenticatedLiveReadiness}
          </Badge>
          <Badge variant="outline">
            Validation Mode: {readiness.validationMode}
          </Badge>
        </div>

        <div className={`${INSET_SURFACE_CLASS} p-4`}>
          <div className="space-y-1">
            <div className="font-medium text-foreground">Store / Rotate Private Key</div>
            <p className="text-sm leading-6 text-muted-foreground">
              Enter <code>POLYMARKET_PRIVATE_KEY</code> here to store it through the existing Paperclip company secrets system. The next action is <code>Derive API Credentials</code>.
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="polymarket-private-key-input">POLYMARKET_PRIVATE_KEY</Label>
              <Input
                id="polymarket-private-key-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={props.privateKeyDraft}
                onChange={(event) => props.onPrivateKeyDraftChange(event.target.value)}
                placeholder="0x..."
                className="border-border/80 bg-white"
              />
            </div>
            <Button
              variant="outline"
              className="border-border/80 bg-white"
              onClick={props.onStorePrivateKey}
              disabled={props.isStoringPrivateKey || props.privateKeyDraft.trim().length === 0}
            >
              Store Private Key
            </Button>
          </div>
          <div className="mt-2 text-xs leading-5 text-muted-foreground">
            Stored only as a company secret ref. Raw key values are never written into repo files or persisted in page state beyond this input.
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <Card className={`${DESK_SURFACE_CLASS} shadow-none`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Readiness Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span>Last auth validation check</span>
                <span className="text-right font-medium">{formatDate(readiness.lastValidation.checkedAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Last validation result</span>
                <Badge variant={readiness.lastValidation.result === "ready" ? "secondary" : readiness.lastValidation.result === "failed" ? "destructive" : "outline"}>
                  {readiness.lastValidation.result ?? "not_checked"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Last credential derivation</span>
                <Badge variant={readiness.lastDerivation.result === "succeeded" ? "secondary" : readiness.lastDerivation.result === "failed" ? "destructive" : "outline"}>
                  {readiness.lastDerivation.result ?? "not_attempted"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Can derive from stored private key</span>
                <Badge variant={readiness.canDeriveApiCredentials ? "secondary" : "outline"}>
                  {String(readiness.canDeriveApiCredentials)}
                </Badge>
              </div>
              <div className={`${INSET_SURFACE_CLASS} p-3 text-sm leading-6 text-muted-foreground`}>
                {readiness.summary}
              </div>
              <div className={`${INSET_SURFACE_CLASS} p-3 text-sm`}>
                <div className="font-medium text-foreground">Kalshi balance check</div>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span>Balance access</span>
                    <Badge variant={formatKalshiBalanceStateVariant(props.data.kalshiReadiness)}>
                      {formatKalshiBalanceState(props.data.kalshiReadiness)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Kalshi wallet balance</span>
                    <span className="text-right font-medium">{formatUsdOrUnavailable(props.data.kalshiReadiness.walletBalanceUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Kalshi portfolio value</span>
                    <span className="text-right font-medium">{formatUsdOrUnavailable(props.data.kalshiReadiness.portfolioValueUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Balance source</span>
                    <span className="text-right font-medium">{formatKalshiBalanceSource(props.data.kalshiReadiness.balanceSource)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Last successful balance sync</span>
                    <span className="text-right font-medium">{formatDate(props.data.kalshiReadiness.lastSuccessfulBalanceSyncAt)}</span>
                  </div>
                </div>
                {props.data.kalshiReadiness.balanceErrorDetail && !props.data.kalshiReadiness.balancesReachable && (
                  <div className="mt-3 text-xs leading-5 text-muted-foreground">{props.data.kalshiReadiness.balanceErrorDetail}</div>
                )}
              </div>
              {readiness.reasonCodes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {readiness.reasonCodes.map((reasonCode) => (
                    <Badge key={reasonCode} variant="outline">{reasonCode}</Badge>
                  ))}
                </div>
              )}
              {props.statusMessage && (
                <div className="rounded-[18px] border border-border/80 bg-white p-3 text-sm">
                  {props.statusMessage}
                </div>
              )}
              {props.secretsErrorMessage && (
                <div className="rounded-[18px] border border-destructive/35 bg-destructive/5 p-3 text-sm text-destructive">
                  {props.secretsErrorMessage}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={`${DESK_SURFACE_CLASS} shadow-none`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Secret References</CardTitle>
              <CardDescription>
                Review or bind both Polymarket source creds and Kalshi venue creds through the existing company secret-ref flow. Nothing sensitive is displayed here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`${INSET_SURFACE_CLASS} p-3 text-sm text-muted-foreground`}>
                <div className="font-medium text-foreground">Polymarket source bindings</div>
                <div className="mt-1 leading-6">These refs support optional source-side readiness checks and derived Polymarket credentials. Paper copying still stays safe.</div>
              </div>
              {POLYMARKET_AUTH_KEY_ORDER.map((key) => {
                const status = readiness.keyStatuses[key];
                const currentSecretId = boundSecretId(props.data.runtimeConfig.authEnv, key);
                const hasCurrentSecretOption = currentSecretId != null
                  && props.availableSecrets.some((secret) => secret.id === currentSecretId);
                return (
                  <div key={key} className="rounded-[18px] border border-border/80 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{SECRET_KEY_LABELS[key]}</div>
                        <div className="text-xs text-muted-foreground">{key}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={status.present ? "secondary" : "outline"}>
                          Present: {status.present ? "yes" : "no"}
                        </Badge>
                        <Badge variant={status.valid ? "secondary" : status.present ? "destructive" : "outline"}>
                          {status.valid ? "valid" : status.reasonCode ?? "missing"}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select
                        value={currentSecretId ?? EMPTY_SECRET_REF}
                        onValueChange={(value) => props.onBindSecret(key, value === EMPTY_SECRET_REF ? null : value)}
                        disabled={props.isUpdatingSecretRef || props.isSecretsLoading || props.secretsErrorMessage != null}
                      >
                        <SelectTrigger className="w-full border-border/80 bg-white sm:w-[320px]">
                          <SelectValue placeholder="Select a secret ref" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_SECRET_REF}>No secret ref</SelectItem>
                          {currentSecretId && !hasCurrentSecretOption && (
                            <SelectItem value={currentSecretId}>Current bound ref</SelectItem>
                          )}
                          {props.availableSecrets.map((secret) => (
                            <SelectItem key={secret.id} value={secret.id}>
                              {secretOptionLabel(secret)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="text-xs leading-5 text-muted-foreground">
                        {status.reasonCode ?? "Config-only structural check passed for this ref."}
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className={`${INSET_SURFACE_CLASS} p-3 text-sm text-muted-foreground`}>
                <div className="font-medium text-foreground">Kalshi venue bindings</div>
                <div className="mt-1 leading-6">Bind <code>KALSHI_API_KEY_ID</code> and <code>KALSHI_PRIVATE_KEY</code> here through the same company secret system. The dry-run adapter never prints raw key material.</div>
              </div>
              {KALSHI_SECRET_KEY_ORDER.map((key) => {
                const status = props.data.kalshiReadiness.keyStatuses[key];
                const currentSecretId = boundSecretId(props.data.runtimeConfig.authEnv, key);
                const hasCurrentSecretOption = currentSecretId != null
                  && props.availableSecrets.some((secret) => secret.id === currentSecretId);
                return (
                  <div key={key} className="rounded-[18px] border border-border/80 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{SECRET_KEY_LABELS[key]}</div>
                        <div className="text-xs text-muted-foreground">{key}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={status.present ? "secondary" : "outline"}>
                          Present: {status.present ? "yes" : "no"}
                        </Badge>
                        <Badge variant={status.valid ? "secondary" : status.present ? "destructive" : "outline"}>
                          {status.valid ? "valid" : status.reasonCode ?? "missing"}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select
                        value={currentSecretId ?? EMPTY_SECRET_REF}
                        onValueChange={(value) => props.onBindSecret(key, value === EMPTY_SECRET_REF ? null : value)}
                        disabled={props.isUpdatingSecretRef || props.isSecretsLoading || props.secretsErrorMessage != null}
                      >
                        <SelectTrigger className="w-full border-border/80 bg-white sm:w-[320px]">
                          <SelectValue placeholder="Select a secret ref" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_SECRET_REF}>No secret ref</SelectItem>
                          {currentSecretId && !hasCurrentSecretOption && (
                            <SelectItem value={currentSecretId}>Current bound ref</SelectItem>
                          )}
                          {props.availableSecrets.map((secret) => (
                            <SelectItem key={secret.id} value={secret.id}>
                              {secretOptionLabel(secret)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="text-xs leading-5 text-muted-foreground">
                        {status.reasonCode ?? "Kalshi secret ref is structurally ready for venue checks."}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

export function PolymarketCopy() {
  const { companyPrefix, polymarketPage } = useParams<{ companyPrefix?: string; polymarketPage?: string }>();
  const { selectedCompany, loading: companiesLoading } = useCompany();
  const { matchedCompany, hasUnknownCompanyPrefix } = useRouteCompanySync(companyPrefix);
  const queryClient = useQueryClient();

  const activeCompany = matchedCompany ?? selectedCompany;
  const activeCompanyId = activeCompany?.id ?? null;
  const companyLabel = activeCompany?.name ?? "Paperclip Company";
  const companyPrefixLabel = activeCompany?.issuePrefix ?? companyPrefix ?? "desk";
  const [privateKeyDraft, setPrivateKeyDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = () => setMobileNavOpen(false);
  const mobileNavScrollTopRef = useRef(0);
  const activeSection = polymarketPage
    ? DESK_SECTIONS.find((section) => section.page === polymarketPage) ?? null
    : DESK_SECTIONS[0];

  useEffect(() => {
    document.title = activeCompany
      ? `${activeCompany.name} – Polymarket Copy Desk · Paperclip`
      : "Polymarket Copy Desk · Paperclip";
  }, [activeCompany]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyWidth = document.body.style.width;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    if (mobileNavOpen) {
      mobileNavScrollTopRef.current = window.scrollY;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${mobileNavScrollTopRef.current}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      document.documentElement.style.overflow = "auto";
    }

    return () => {
      const lockedScrollTop = mobileNavScrollTopRef.current;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.documentElement.style.overflow = previousHtmlOverflow;

      if (mobileNavOpen) {
        window.scrollTo(0, lockedScrollTop);
      }
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileNavOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);


  const dashboardQuery = useQuery({
    queryKey: activeCompanyId ? queryKeys.polymarketCopy.dashboard(activeCompanyId) : ["polymarket-copy", "dashboard", "none"],
    queryFn: () => polymarketCopyApi.dashboard(activeCompanyId!),
    enabled: !!activeCompanyId,
    refetchInterval: 20_000,
  });

  const secretsQuery = useQuery({
    queryKey: activeCompanyId ? queryKeys.secrets.list(activeCompanyId) : ["secrets", "none"],
    queryFn: () => secretsApi.list(activeCompanyId!),
    enabled: !!activeCompanyId,
    retry: false,
  });

  const invalidateDashboard = () => {
    if (!activeCompanyId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.polymarketCopy.dashboard(activeCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.polymarketCopy.runtimeConfig(activeCompanyId) });
  };

  const invalidateDashboardAndSecrets = () => {
    if (!activeCompanyId) return;
    invalidateDashboard();
    queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(activeCompanyId) });
  };

  const walletSelectorMutation = useMutation({
    mutationFn: () => polymarketCopyApi.runWalletSelector(activeCompanyId!, "manual"),
    onSuccess: invalidateDashboard,
  });
  const monitor5mMutation = useMutation({
    mutationFn: () => polymarketCopyApi.runMonitor5m(activeCompanyId!, "manual"),
    onSuccess: invalidateDashboard,
  });
  const monitor15mMutation = useMutation({
    mutationFn: () => polymarketCopyApi.runMonitor15m(activeCompanyId!, "manual"),
    onSuccess: invalidateDashboard,
  });
  const authReadinessMutation = useMutation({
    mutationFn: () => polymarketCopyApi.checkAuthReadiness(activeCompanyId!, "manual"),
    onSuccess: invalidateDashboard,
  });
  const deriveCredentialsMutation = useMutation({
    mutationFn: () => polymarketCopyApi.deriveApiCredentials(activeCompanyId!, "manual"),
    onSuccess: invalidateDashboardAndSecrets,
  });
  const storePrivateKeyMutation = useMutation({
    mutationFn: async () => {
      if (!activeCompanyId) throw new Error("Select a company before storing secrets.");
      const value = privateKeyDraft.trim();
      if (value.length === 0) {
        throw new Error("Enter POLYMARKET_PRIVATE_KEY before storing it.");
      }

      const currentSecretId = boundSecretId(
        dashboardQuery.data?.runtimeConfig.authEnv,
        "POLYMARKET_PRIVATE_KEY",
      );
      const existingSecret = availableSecrets.find((secret) => secret.id === currentSecretId)
        ?? availableSecrets.find((secret) => secret.name === "POLYMARKET_PRIVATE_KEY")
        ?? null;

      const storedSecret = existingSecret
        ? await secretsApi.rotate(existingSecret.id, { value })
        : await secretsApi.create(activeCompanyId, {
          name: "POLYMARKET_PRIVATE_KEY",
          value,
          description: "Polymarket private key stored through the desk auth readiness flow.",
        });

      const authEnv = buildNextAuthEnv(
        dashboardQuery.data?.runtimeConfig.authEnv,
        "POLYMARKET_PRIVATE_KEY",
        storedSecret.id,
      );
      await polymarketCopyApi.updateRuntimeConfig(activeCompanyId, { authEnv });

      return existingSecret
        ? "POLYMARKET_PRIVATE_KEY rotated and bound. Next: Derive API Credentials."
        : "POLYMARKET_PRIVATE_KEY stored and bound. Next: Derive API Credentials.";
    },
    onSuccess: () => {
      setPrivateKeyDraft("");
      invalidateDashboardAndSecrets();
    },
  });
  const updateAuthRefMutation = useMutation({
    mutationFn: ({ key, secretId }: { key: PolymarketCopySecretEnvKey; secretId: string | null }) => {
      const authEnv = buildNextAuthEnv(dashboardQuery.data?.runtimeConfig.authEnv, key, secretId);
      return polymarketCopyApi.updateRuntimeConfig(activeCompanyId!, { authEnv });
    },
    onSuccess: invalidateDashboard,
  });

  const data = dashboardQuery.data;
  const availableSecrets = secretsQuery.data ?? [];
  const sortedSignals = useMemo(() => (data?.signals ?? []).slice(0, 25), [data?.signals]);
  const latestWorkerRuns = useMemo(() => {
    if (!data) return new Map<string, PolymarketCopyDashboardData["workerRuns"][number]>();
    return data.workerRuns.reduce((acc, run) => {
      if (!acc.has(run.workerKey)) acc.set(run.workerKey, run);
      return acc;
    }, new Map<string, PolymarketCopyDashboardData["workerRuns"][number]>());
  }, [data]);

  const statusMessage =
    storePrivateKeyMutation.data
    ?? deriveCredentialsMutation.data?.summary
    ?? authReadinessMutation.data?.summary
    ?? (updateAuthRefMutation.isSuccess ? "Secret reference updated. Live trading remains disabled." : null)
    ?? storePrivateKeyMutation.error?.message
    ?? deriveCredentialsMutation.error?.message
    ?? authReadinessMutation.error?.message
    ?? updateAuthRefMutation.error?.message
    ?? null;

  if (companiesLoading && !activeCompany) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (hasUnknownCompanyPrefix) {
    return <NotFoundPage scope="board" />;
  }

  if (!activeSection) {
    return <NotFoundPage scope="board" />;
  }

  if (!activeCompanyId) {
    return <EmptyState icon={Wallet} message="Select a company to open the Polymarket copy desk." />;
  }

  if (dashboardQuery.isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (!data) {
    return <EmptyState icon={Wallet} message="No Polymarket copy desk data is available yet." />;
  }

  const health5m = data.overview.workerHealth["polymarket-monitor-5m"] ?? "idle";
  const health15m = data.overview.workerHealth["polymarket-monitor-15m"] ?? "idle";
  const readiness = data.authReadiness;
  const directOwnerLabel = data.underlyingModel.directOwners
    .map((owner) => owner.name ?? owner.email ?? owner.userId)
    .join(", ") || "Unassigned";
  const tradingAnalystLabel = data.underlyingModel.tradingAnalyst?.name ?? "Not provisioned";
  const managedServices = data.underlyingModel.runtimeServices;
  const provisionedServiceCount = managedServices.filter((service) => service.exists).length;
  const serviceByKey = new Map(managedServices.map((service) => [service.key, service] as const));
  const walletSelectorService = serviceByKey.get("wallet_selector") ?? null;
  const monitor5mService = serviceByKey.get("monitor_5m") ?? null;
  const monitor15mService = serviceByKey.get("monitor_15m") ?? null;
  const riskGovernorService = serviceByKey.get("risk_governor") ?? null;
  const executionEngineService = serviceByKey.get("execution_engine") ?? null;
  const automation = data.performance.automation;
  const paperExecutorLabel = data.runtimeConfig.mode === "paper"
    ? `dynamic ${data.runtimeConfig.minTradeSizePct.toFixed(1)}%-${data.runtimeConfig.maxTradeSizePct.toFixed(1)}% of current paper bankroll`
    : "inactive";
  const liveExecutorLabel = "dormant / blocked";

  return (
    <div className="min-h-screen bg-[#f6f2ea] text-foreground" style={LIGHT_DESK_THEME}>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-72"
        style={{
          backgroundImage:
            "radial-gradient(circle at 8% 0%, rgba(233, 243, 255, 0.95) 0%, transparent 38%), radial-gradient(circle at 95% 20%, rgba(255, 232, 207, 0.65) 0%, transparent 36%), linear-gradient(160deg, rgba(254, 252, 248, 0.95) 0%, rgba(244, 239, 230, 0.9) 100%)",
        }}
      />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={closeMobileNav}
            aria-label="Close navigation"
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Polymarket desk navigation"
            className="absolute inset-y-0 left-0 z-10 flex w-[258px] max-w-[calc(100vw-1rem)] flex-col border-r border-[#d4dbe4] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(241,247,252,0.98)_100%)] p-3 shadow-[0_18px_34px_rgba(35,42,52,0.24)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[#d6dfe8] pb-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Polymarket Copy Desk</p>
                <p className="mt-1 truncate text-sm font-semibold text-foreground">{companyLabel}</p>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#c8d5e2] bg-white text-[#31546c]"
                onClick={closeMobileNav}
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
              <SectionMenu
                activeSection={activeSection.id}
                companyPrefix={companyPrefix}
                onSelect={() => {
                  closeMobileNav();
                }}
              />

              <div className={`${INSET_SURFACE_CLASS} mt-4 p-3`}>
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Desk Snapshot</div>
                <div className="mt-3 space-y-2.5 text-sm text-foreground/90">
                  <div className="flex items-center justify-between gap-3">
                    <span>Mode</span>
                    <Badge variant={data.runtimeConfig.mode === "paper" ? "secondary" : "destructive"}>{data.runtimeConfig.mode}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>5m Monitor</span>
                    <Badge variant={toneForHealth(health5m)}>{health5m}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>15m Monitor</span>
                    <Badge variant={toneForHealth(health15m)}>{health15m}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Paper executor</span>
                    <Badge variant="secondary">active</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Live executor</span>
                    <Badge variant="destructive">blocked</Badge>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      <div className="relative mx-auto max-w-[1560px] px-3 py-3 sm:px-5 lg:px-6">
        <div
          aria-hidden={mobileNavOpen ? true : undefined}
          className={`grid items-start gap-4 md:gap-6 ${mobileNavOpen ? "pointer-events-none select-none md:pointer-events-auto md:select-auto" : ""} ${sidebarCollapsed ? "md:grid-cols-[92px_minmax(0,1fr)]" : "md:grid-cols-[258px_minmax(0,1fr)]"}`}
        >
          <aside className="hidden md:self-start md:sticky md:top-3 md:block">
            <div
              className={`flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-[#d4dbe4] bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(241,247,252,0.94)_100%)] p-3 shadow-[0_18px_36px_rgba(35,42,52,0.08)] ${sidebarCollapsed ? "px-2.5" : ""}`}
            >
              <div className="flex items-center justify-between gap-2 border-b border-[#d6dfe8] pb-3">
                <div className={`min-w-0 ${sidebarCollapsed ? "hidden" : ""}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Polymarket Copy Desk</p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">{companyLabel}</p>
                </div>
                {sidebarCollapsed && (
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#cfd8e2] bg-[#f2f7fc] text-[11px] font-bold text-[#20445d]">
                    {companyPrefixLabel.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#c8d5e2] bg-white text-[#38556d]"
                  onClick={() => setSidebarCollapsed((current) => !current)}
                  aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
                <SectionMenu
                  activeSection={activeSection.id}
                  companyPrefix={companyPrefix}
                  collapsed={sidebarCollapsed}
                />

              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <header className="sticky top-3 z-30 rounded-2xl border border-[#d8e2eb] bg-white/92 px-4 py-4 shadow-[0_14px_30px_rgba(22,35,50,0.12)] backdrop-blur-sm sm:px-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#c8d5e2] bg-white text-[#31546c] md:hidden"
                      onClick={() => setMobileNavOpen(true)}
                      aria-label="Open navigation"
                    >
                      <Menu className="h-4 w-4" />
                    </button>
                    <div className="space-y-1">
                      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[2rem]">
                        {companyLabel} – Polymarket Copy Desk
                      </h1>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:max-w-[34rem] xl:justify-end">
                    <Button variant="outline" size="sm" className="border-[#c6d2df] bg-white text-[#33414e]" asChild>
                      <Link to="/dashboard">
                        Open Control Plane
                        <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#c6d2df] bg-white text-[#33414e]"
                      onClick={() => walletSelectorMutation.mutate()}
                      disabled={walletSelectorMutation.isPending}
                    >
                      <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                      Run Wallet Selection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#c6d2df] bg-white text-[#33414e]"
                      onClick={() => monitor5mMutation.mutate()}
                      disabled={monitor5mMutation.isPending}
                    >
                      <TimerReset className="mr-1.5 h-3.5 w-3.5" />
                      Run 5m Monitor
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-[#c6d2df] bg-white text-[#33414e]"
                      onClick={() => monitor15mMutation.mutate()}
                      disabled={monitor15mMutation.isPending}
                    >
                      <TimerReset className="mr-1.5 h-3.5 w-3.5" />
                      Run 15m Monitor
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <HeaderStatusCard
                    label="Mode"
                    value={<Badge variant={data.runtimeConfig.mode === "paper" ? "secondary" : "destructive"}>{data.runtimeConfig.mode}</Badge>}
                  />
                  <HeaderStatusCard
                    label="Live Enabled"
                    value={<Badge variant={toneForBoolean(data.runtimeConfig.liveEnabled, "destructive")}>{String(data.runtimeConfig.liveEnabled)}</Badge>}
                  />
                  <HeaderStatusCard
                    label="Kill Switch"
                    value={<Badge variant={data.runtimeConfig.tradingKillSwitch ? "destructive" : "secondary"}>{data.runtimeConfig.tradingKillSwitch ? "on" : "off"}</Badge>}
                  />
                  <HeaderStatusCard
                    label="5m Monitor"
                    value={<Badge variant={toneForHealth(health5m)}>{health5m}</Badge>}
                  />
                  <HeaderStatusCard
                    label="15m Monitor"
                    value={<Badge variant={toneForHealth(health15m)}>{health15m}</Badge>}
                  />
                </div>
              </div>
            </header>

            <main className="min-w-0 space-y-8 pb-12 pt-6">
              {dashboardQuery.error && <p className="text-sm text-destructive">{dashboardQuery.error.message}</p>}

              <DeskSection
                active={activeSection.id === "overview"}
                id="overview"
                title="Overview"
                description="A cleaner operator shell centered on the two live paper-monitor cadences and their shared execution pipeline."
              >
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.45fr),420px]">
                  <Card className={DESK_SURFACE_CLASS}>
                    <CardContent className="space-y-6 p-6">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={data.runtimeConfig.mode === "paper" ? "secondary" : "destructive"}>
                          Execution Mode: {data.runtimeConfig.mode}
                        </Badge>
                        <Badge variant={toneForBoolean(data.runtimeConfig.liveEnabled, "destructive")}>
                          Live Enabled: {String(data.runtimeConfig.liveEnabled)}
                        </Badge>
                        <Badge variant={data.runtimeConfig.tradingKillSwitch ? "destructive" : "secondary"}>
                          Kill Switch: {data.runtimeConfig.tradingKillSwitch ? "on" : "off"}
                        </Badge>
                        <Badge variant={toneForHealth(health5m)}>5m Monitor: {health5m}</Badge>
                        <Badge variant={toneForHealth(health15m)}>15m Monitor: {health15m}</Badge>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.88fr),minmax(0,1.12fr)]">
                        <div className={`${INSET_SURFACE_CLASS} p-4`}>
                          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            Primary Workers
                          </div>
                          <div className="mt-3 grid gap-3">
                            {[
                              {
                                label: "Polymarket 5m Monitor",
                                status: health5m,
                                exists: monitor5mService?.exists,
                                note: "Fast wallet scan and signal emission.",
                              },
                              {
                                label: "Polymarket 15m Monitor",
                                status: health15m,
                                exists: monitor15mService?.exists,
                                note: "Higher-latency confirmation pass and signal refresh.",
                              },
                            ].map((worker) => (
                              <div key={worker.label} className="rounded-[18px] border border-border/80 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="font-semibold text-foreground">{worker.label}</div>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge variant={worker.exists ? "secondary" : "outline"}>{worker.exists ? "real" : "missing"}</Badge>
                                    <Badge variant={toneForHealth(worker.status)}>{worker.status}</Badge>
                                  </div>
                                </div>
                                <div className="mt-2 text-sm leading-6 text-muted-foreground">{worker.note}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className={`${INSET_SURFACE_CLASS} p-4`}>
                          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            Shared Deterministic Pipeline
                          </div>
                          <div className="mt-3 grid gap-3">
                            {[
                              ["Signal normalization", "Shared deterministic logic"],
                              [
                                "Risk Governor",
                                riskGovernorService?.exists
                                  ? `Registered runtime service • ${riskGovernorService.status ?? "managed"}`
                                  : "Missing runtime registration",
                              ],
                              [
                                "Execution Engine",
                                executionEngineService?.exists
                                  ? `Registered runtime service • ${executionEngineService.status ?? "managed"}`
                                  : "Missing runtime registration",
                              ],
                            ].map(([label, description]) => (
                              <div key={label} className="rounded-[18px] border border-border/80 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                                <div className="font-semibold text-foreground">{label}</div>
                                <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-[18px] border border-border/80 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-foreground">Paper executor</span>
                                <Badge variant="secondary">active</Badge>
                              </div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">{paperExecutorLabel}</div>
                            </div>
                            <div className="rounded-[18px] border border-border/80 bg-white px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-foreground">Live executor</span>
                                <Badge variant="destructive">blocked</Badge>
                              </div>
                              <div className="mt-1 text-sm leading-6 text-muted-foreground">{liveExecutorLabel}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <OverviewCards data={data} />
                    </CardContent>
                  </Card>

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader className="border-b border-border/70 pb-4">
                      <CardTitle className="text-base">Desk Model</CardTitle>
                      <CardDescription>
                        One company-scoped copy-trading system with optional analyst support. No execution zoo.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 p-6 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span>Owner</span>
                        <span className="text-right font-medium">{directOwnerLabel}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Desk model</span>
                        <span className="font-medium">Company-scoped runtime</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Separate desk object</span>
                        <span className="font-medium">{data.underlyingModel.hasSeparateDeskObject ? "Yes" : "No"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Watched wallets</span>
                        <span className="font-medium">{data.overview.watchedWalletCount}</span>
                      </div>
                      <div className={`${INSET_SURFACE_CLASS} p-4`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-foreground">Trading Analyst</span>
                          <Badge variant={data.underlyingModel.tradingAnalyst ? "outline" : "secondary"}>
                            {data.underlyingModel.tradingAnalyst ? "optional support" : "not provisioned"}
                          </Badge>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-muted-foreground">
                          {data.underlyingModel.tradingAnalyst
                            ? `${tradingAnalystLabel} is available for summaries, context, and reporting, but not part of the execution chain.`
                            : "The execution path does not depend on an analyst agent."}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </DeskSection>

              <DeskSection
                active={activeSection.id === "performance"}
                id="performance"
                title="Performance"
                description="Executive-first paper-copy performance, attribution, and automation health inside the current baseline window."
              >
                <PerformanceView data={data} />
              </DeskSection>

              <DeskSection
                active={activeSection.id === "desk-status"}
                id="desk-status"
                title="Desk Status"
                description="Core desk health, exposure, ownership, and runtime thresholds in a denser operator layout."
              >
                <div className="grid gap-4 xl:grid-cols-3">
                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <BriefcaseBusiness className="h-4 w-4" />
                        Operations
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center justify-between"><span>Accepted today</span><span className="font-medium">{data.overview.acceptedCount}</span></div>
                      <div className="flex items-center justify-between"><span>Skipped today</span><span className="font-medium">{data.overview.skippedCount}</span></div>
                      <div className="flex items-center justify-between"><span>Blocked today</span><span className="font-medium">{data.overview.blockedCount}</span></div>
                      <div className="flex items-center justify-between"><span>Open paper trades</span><span className="font-medium">{data.overview.paperTradesOpen}</span></div>
                      <div className="flex items-center justify-between"><span>Closed paper trades</span><span className="font-medium">{data.overview.paperTradesClosed}</span></div>
                    </CardContent>
                  </Card>

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldAlert className="h-4 w-4" />
                        Exposure
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center justify-between"><span>Current open exposure</span><span className="font-medium">{formatUsd(data.risk.currentExposureUsd)}</span></div>
                      <div className="flex items-center justify-between"><span>Daily realized loss</span><span className="font-medium">{formatUsd(data.risk.dailyRealizedLossUsd)}</span></div>
                      <div className="flex items-center justify-between"><span>Realized PnL</span><span className="font-medium">{formatUsd(data.overview.realizedPnlUsd)}</span></div>
                      <div className="flex items-center justify-between"><span>Unrealized PnL</span><span className="font-medium">{formatUsd(data.overview.unrealizedPnlUsd)}</span></div>
                    </CardContent>
                  </Card>

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ShieldCheck className="h-4 w-4" />
                        Runtime Thresholds
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center justify-between"><span>Trade size range</span><span className="font-medium">{data.runtimeConfig.minTradeSizePct.toFixed(1)}% - {data.runtimeConfig.maxTradeSizePct.toFixed(1)}%</span></div>
                      <div className="flex items-center justify-between"><span>Max market exposure</span><span className="font-medium">{data.runtimeConfig.maxExposurePerMarketPct.toFixed(1)}%</span></div>
                      <div className="flex items-center justify-between"><span>Max wallet exposure</span><span className="font-medium">{data.runtimeConfig.maxExposurePerWalletPct.toFixed(1)}%</span></div>
                      <div className="flex items-center justify-between"><span>Max total open exposure</span><span className="font-medium">{data.runtimeConfig.maxTotalOpenExposurePct.toFixed(1)}%</span></div>
                      <div className="flex items-center justify-between"><span>Dynamic sizing</span><span className="font-medium">{data.runtimeConfig.dynamicSizing ? data.runtimeConfig.dynamicSizingBasis : "off"}</span></div>
                      <div className="flex items-center justify-between"><span>Position-count sizing</span><span className="font-medium">{String(data.runtimeConfig.positionCountBasedSizing)}</span></div>
                    </CardContent>
                  </Card>
                </div>
              </DeskSection>

              <DeskSection
                active={activeSection.id === "workers"}
                id="workers"
                title="Workers"
                description="The only active workers are the 5m and 15m monitors. Everything else is shared deterministic support logic behind the same execution path."
              >
                <div className="grid gap-4 xl:grid-cols-4">
                  {[
                    {
                      workerKey: "wallet-selector-daily",
                      label: "Wallet Selector",
                      cadence: automation.walletSelectorSchedule,
                      health: data.overview.workerHealth["wallet-selector-daily"] ?? "idle",
                      exists: walletSelectorService?.exists,
                      lastSuccess: automation.latestSuccessfulWalletSelectionRun,
                      autoRun: automation.walletSelectorAutoRunActive,
                    },
                    {
                      workerKey: "polymarket-monitor-5m",
                      label: "5m Monitor",
                      cadence: "Every five minutes",
                      health: health5m,
                      exists: monitor5mService?.exists,
                      lastSuccess: data.overview.lastSuccessful5mRun,
                      autoRun: automation.monitor5mAutoRunActive,
                    },
                    {
                      workerKey: "polymarket-monitor-15m",
                      label: "15m Monitor",
                      cadence: "Every fifteen minutes",
                      health: health15m,
                      exists: monitor15mService?.exists,
                      lastSuccess: data.overview.lastSuccessful15mRun,
                      autoRun: automation.monitor15mAutoRunActive,
                    },
                  ].map((worker) => {
                    const run = latestWorkerRuns.get(worker.workerKey);
                    return (
                      <Card key={worker.workerKey} className={DESK_SURFACE_CLASS}>
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center justify-between gap-2 text-base">
                            <span>{worker.label}</span>
                            <Badge variant={toneForHealth(worker.health)}>{worker.health}</Badge>
                          </CardTitle>
                          <CardDescription>{worker.cadence}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <div className="flex items-center justify-between"><span>Runtime registration</span><Badge variant={worker.exists ? "secondary" : "outline"}>{worker.exists ? "real" : "missing"}</Badge></div>
                          <div className="flex items-center justify-between"><span>Auto-run</span><Badge variant={worker.autoRun ? "secondary" : "outline"}>{worker.autoRun ? "active" : "off"}</Badge></div>
                          <div className="flex items-center justify-between"><span>Last successful run</span><span className="font-medium">{formatDate(worker.lastSuccess)}</span></div>
                          <div className="flex items-center justify-between"><span>Latest status</span><span className="font-medium">{run?.status ?? "idle"}</span></div>
                          <div className="flex items-center justify-between"><span>Signals in latest run</span><span className="font-medium">{run?.signalCount ?? 0}</span></div>
                          <div className="flex items-center justify-between"><span>Accepted in latest run</span><span className="font-medium">{run?.acceptedCount ?? 0}</span></div>
                        </CardContent>
                      </Card>
                    );
                  })}

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between gap-2 text-base">
                        <span>Shared Pipeline</span>
                        <Badge variant="outline">support logic</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className={`${INSET_SURFACE_CLASS} p-3`}>
                        <div className="flex items-center justify-between"><span>Signal normalization</span><span className="font-medium">deterministic</span></div>
                      </div>
                      <div className={`${INSET_SURFACE_CLASS} p-3`}>
                        <div className="flex items-center justify-between"><span>Risk Governor</span><span className="font-medium">{riskGovernorService?.status ?? (riskGovernorService?.exists ? "registered" : "missing")}</span></div>
                      </div>
                      <div className={`${INSET_SURFACE_CLASS} p-3`}>
                        <div className="flex items-center justify-between"><span>Execution Engine</span><span className="font-medium">{executionEngineService?.status ?? (executionEngineService?.exists ? "registered" : "missing")}</span></div>
                        <div className="mt-2 text-xs leading-5 text-muted-foreground">This is the shared component that makes paper trades now.</div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className={`${INSET_SURFACE_CLASS} p-3`}>
                          <div className="flex items-center justify-between"><span>Paper executor</span><Badge variant="secondary">active</Badge></div>
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">{paperExecutorLabel}</div>
                        </div>
                        <div className={`${INSET_SURFACE_CLASS} p-3`}>
                          <div className="flex items-center justify-between"><span>Live executor</span><Badge variant="destructive">blocked</Badge></div>
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">{liveExecutorLabel}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </DeskSection>

              <DeskSection
                active={activeSection.id === "wallets"}
                id="wallets"
                title="Wallets"
                description="Copy Rank is driven by win rate first, then resolved-trade proof, recent resolved activity, and last activity."
              >
                <div className={`${INSET_SURFACE_CLASS} space-y-3 p-4 text-sm`}>
                  <div className="font-medium text-foreground">The watched set targets {data.runtimeConfig.targetWatchedWalletCount} active wallets and keeps copy quality anchored to win rate plus real longevity and recent activity proof.</div>
                  <div className="leading-6 text-muted-foreground">Active copy sources still prefer 70%+ win rate with at least 30 resolved trades and 12 resolved trades in the last 30 days. The desk can still backfill with 65%+ wallets when the pool is thin, caps sports-heavy copy sources at 8, and aims to keep at least 6 non-sports wallets active whenever the eligible pool supports it.</div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">Active target {data.runtimeConfig.targetWatchedWalletCount}</Badge>
                    <Badge variant="outline">Sports-heavy cap 8</Badge>
                    <Badge variant="outline">Min non-sports 6</Badge>
                    <Badge variant="outline">Max daily replacements {data.runtimeConfig.maxDailyReplacements}</Badge>
                  </div>
                </div>
                <SectionTable
                  empty="No watched wallets yet."
                  headers={["Copy Rank", "Wallet", "Status", "Win Rate", "Resolved Trades", "Recent Resolved (30d)", "Category", "Last Activity", "Selection Notes"]}
                  rows={data.watchedWallets.map((wallet) => {
                    const snapshot = walletSelectionSnapshot(wallet.metadata);
                    const lastActivity = snapshot.lastActivityAt ?? wallet.lastRefreshedAt;
                    return [
                      <span key="rank" className="font-medium">{wallet.currentRank == null ? "—" : `#${wallet.currentRank}`}</span>,
                      <div key="wallet" className="space-y-1">
                        <div className="font-mono text-xs">{wallet.walletAddress}</div>
                        <div className="text-xs text-muted-foreground">{wallet.label || "Unlabeled"}</div>
                      </div>,
                      <Badge key="status" variant={walletStatusVariant(wallet)}>
                        {walletStatusLabel(wallet)}
                      </Badge>,
                      <span key="win-rate" className="font-semibold">{formatPercent(snapshot.winRate)}</span>,
                      <div key="resolved" className="space-y-1">
                        <div className="font-medium">{snapshot.resolvedTrades ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {snapshot.resolvedTradesLikelyTruncated && snapshot.closedPositionsFetchCeiling != null
                            ? `fetch ceiling hit at ${snapshot.closedPositionsFetchCeiling}+`
                            : "30+ required for active"}
                        </div>
                      </div>,
                      <div key="recent-resolved" className="space-y-1">
                        <div className="font-medium">{snapshot.recentResolvedTrades30d ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{snapshot.hasRecentActivity ? "active in last 30d" : "stale recent activity"}</div>
                      </div>,
                      <div key="category" className="space-y-1">
                        <div className="font-medium">{formatWalletCategory(snapshot.dominantCategory)}</div>
                        <div className="text-xs text-muted-foreground">{snapshot.recentCategoryMixLabel ?? "recent mix unavailable"}</div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                          {snapshot.sportsHeavy ? "Sports-heavy" : snapshot.diversified ? "Diversified" : "Concentrated"}
                        </div>
                      </div>,
                      <div key="last-activity" className="space-y-1">
                        <div>{formatDate(lastActivity)}</div>
                        <div className="text-xs text-muted-foreground">{snapshot.hasRecentActivity ? "recent activity confirmed" : "fails recent-activity gate"}</div>
                      </div>,
                      <div key="note" className="space-y-1 text-xs leading-5 text-muted-foreground">
                        <div>{walletSelectionNote(wallet)}</div>
                        <div className="text-[11px] uppercase tracking-[0.14em]">Secondary score {wallet.score.toFixed(3)}</div>
                      </div>,
                    ];
                  })}
                />
              </DeskSection>

              <DeskSection
                active={activeSection.id === "signals"}
                id="signals"
                title="Signals"
                description="Structured wallet activity events normalized from the dual-cadence monitoring pass."
              >
                <SectionTable
                  empty="No signals yet."
                  headers={["Time", "Source Wallet", "Market", "Action", "Cadence", "Decision", "Reason"]}
                  rows={sortedSignals.map((signal) => [
                    formatDate(signal.createdAt),
                    <span key="wallet" className="font-mono text-xs">{signal.sourceWalletAddress}</span>,
                    <div key="market" className="space-y-1">
                      <div>{signal.marketTitle || signal.marketId}</div>
                      <div className="text-xs text-muted-foreground">{signal.marketSlug || signal.marketId}</div>
                    </div>,
                    signal.action,
                    signal.cadence,
                    <DecisionBadge key="decision" decision={signal.decision} />,
                    signal.decision?.reasonCode ?? "pending",
                  ])}
                />
              </DeskSection>

              <DeskSection
                active={activeSection.id === "mirror-attempts"}
                id="mirror-attempts"
                title="Mirror Attempts / Match Diagnostics"
                description="Recent Polymarket source signals, their best Kalshi candidates, and exactly why each one matched, nearly matched, or was rejected."
              >
                <MirrorAttemptsView data={data} />
              </DeskSection>

              <DeskSection
                active={activeSection.id === "paper-trades"}
                id="paper-trades"
                title="Paper Trades"
                description="Simulated copy-trade lifecycle with explicit assumptions and no live order placement."
              >
                <SectionTable
                  empty="No paper trades yet."
                  headers={["Wallet", "Market", "Side", "Status", "Entry", "Current Mark", "Size", "Unrealized", "Realized", "Opened", "Closed"]}
                  rows={data.paperTrades.map((trade) => [
                    <span key="wallet" className="font-mono text-xs">{trade.sourceWalletAddress}</span>,
                    trade.marketTitle || trade.marketId,
                    trade.side,
                    <TradeStatusBadge key="status" trade={trade} />,
                    trade.estimatedEntryPrice == null ? "n/a" : trade.estimatedEntryPrice.toFixed(3),
                    trade.currentMarkPrice == null ? "n/a" : trade.currentMarkPrice.toFixed(3),
                    trade.quantity.toFixed(3),
                    formatUsd(trade.unrealizedPnlUsd),
                    formatUsd(trade.realizedPnlUsd),
                    formatDate(trade.openedAt),
                    formatDate(trade.closedAt),
                  ])}
                />
              </DeskSection>

              <DeskSection
                active={activeSection.id === "risk-blocks"}
                id="risk-blocks"
                title="Risk / Blocks"
                description="Blocked signals, threshold failures, kill-switch state, and current exposure posture."
              >
                <div className="space-y-4">
                  <SectionTable
                    empty="No blocked signals today."
                    headers={["Time", "Signal", "Reason", "Decision"]}
                    rows={data.risk.blockedSignals.map((decision) => {
                      const signal = data.signals.find((item) => item.id === decision.signalId);
                      return [
                        formatDate(decision.createdAt),
                        signal?.marketTitle || signal?.marketId || decision.signalId,
                        decision.reasonCode,
                        <Badge key="decision" variant="destructive">{decision.decision}</Badge>,
                      ];
                    })}
                  />

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Threshold Failures</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {data.risk.thresholdFailures.length === 0 && (
                        <div className="text-muted-foreground">No threshold failures yet today.</div>
                      )}
                      {data.risk.thresholdFailures.map((item) => (
                        <div key={item.reasonCode} className="flex items-center justify-between rounded-[18px] border border-border/80 bg-muted/25 px-3 py-2.5">
                          <span>{item.reasonCode}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              </DeskSection>

              <DeskSection
                active={activeSection.id === "auth-readiness"}
                id="auth-readiness"
                title="Auth Readiness"
                description="Optional secret refs and operator-safe credential readiness, with no impact on paper-mode startup."
              >
                <AuthReadinessPanel
                  data={data}
                  availableSecrets={availableSecrets}
                  isSecretsLoading={secretsQuery.isLoading}
                  secretsErrorMessage={secretsQuery.error ? "Secret metadata could not be loaded. Board-level access is required for binding and derivation actions." : null}
                  statusMessage={statusMessage}
                  privateKeyDraft={privateKeyDraft}
                  onPrivateKeyDraftChange={setPrivateKeyDraft}
                  onStorePrivateKey={() => storePrivateKeyMutation.mutate()}
                  onCheckReadiness={() => authReadinessMutation.mutate()}
                  onDeriveCredentials={() => deriveCredentialsMutation.mutate()}
                  onRefreshStatus={() => {
                    dashboardQuery.refetch();
                    secretsQuery.refetch();
                  }}
                  onBindSecret={(key, secretId) => updateAuthRefMutation.mutate({ key, secretId })}
                  isStoringPrivateKey={storePrivateKeyMutation.isPending}
                  isCheckingReadiness={authReadinessMutation.isPending}
                  isDerivingCredentials={deriveCredentialsMutation.isPending}
                  isUpdatingSecretRef={updateAuthRefMutation.isPending}
                />
              </DeskSection>

              <DeskSection
                active={activeSection.id === "live-readiness"}
                id="live-readiness"
                title="Live Readiness"
                description="Governance state for future live activation. V0 remains paper-only and still never places orders."
              >
                <div className="grid gap-4 xl:grid-cols-3">
                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Radar className="h-4 w-4" />
                        Live Gate Stack
                      </CardTitle>
                      <CardDescription>
                        Real Kalshi order placement stays blocked until mode, enablement, and safety gates are explicitly opened later.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-[18px] border border-border/80 bg-muted/25 p-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Mode</div>
                        <div className="mt-2 text-lg font-semibold text-foreground">{data.runtimeConfig.mode}</div>
                      </div>
                      <div className="rounded-[18px] border border-border/80 bg-muted/25 p-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Live enabled</div>
                        <div className="mt-2 text-lg font-semibold text-foreground">{String(data.runtimeConfig.liveEnabled)}</div>
                      </div>
                      <div className="rounded-[18px] border border-border/80 bg-muted/25 p-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Kill switch</div>
                        <div className="mt-2 text-lg font-semibold text-foreground">{data.runtimeConfig.tradingKillSwitch ? "on" : "off"}</div>
                      </div>
                      <div className="rounded-[18px] border border-border/80 bg-muted/25 p-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Polymarket auth readiness</div>
                        <div className="mt-2 text-lg font-semibold text-foreground">{readiness.authenticatedLiveReadiness}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader>
                      <CardTitle className="text-base">Kalshi Venue Readiness</CardTitle>
                      <CardDescription>
                        Uses the same Paperclip secret-ref system for <code>KALSHI_API_KEY_ID</code> and <code>KALSHI_PRIVATE_KEY</code>.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={data.kalshiReadiness.authConfigured ? "secondary" : "outline"}>Auth configured: {data.kalshiReadiness.authConfigured ? "yes" : "no"}</Badge>
                        <Badge variant={data.kalshiReadiness.marketDataReachable ? "secondary" : "outline"}>Market data: {data.kalshiReadiness.marketDataReachable ? "reachable" : "down"}</Badge>
                        <Badge variant={data.kalshiReadiness.balancesReachable ? "secondary" : "outline"}>Balances: {data.kalshiReadiness.balancesReachable ? "reachable" : "not ready"}</Badge>
                        <Badge variant={data.kalshiReadiness.positionsReachable ? "secondary" : "outline"}>Positions: {data.kalshiReadiness.positionsReachable ? "reachable" : "not ready"}</Badge>
                      </div>
                      <div className={`${INSET_SURFACE_CLASS} p-3 text-muted-foreground`}>
                        {data.kalshiReadiness.summary}
                      </div>
                      <div className="rounded-[18px] border border-border/80 bg-white p-3">
                        <div className="flex items-center justify-between gap-4"><span>Balance access</span><Badge variant={formatKalshiBalanceStateVariant(data.kalshiReadiness)}>{formatKalshiBalanceState(data.kalshiReadiness)}</Badge></div>
                        <div className="mt-3 flex items-center justify-between gap-4"><span>Kalshi wallet balance</span><span className="font-medium">{formatUsdOrUnavailable(data.kalshiReadiness.walletBalanceUsd)}</span></div>
                        <div className="mt-2 flex items-center justify-between gap-4"><span>Kalshi portfolio value</span><span className="font-medium">{formatUsdOrUnavailable(data.kalshiReadiness.portfolioValueUsd)}</span></div>
                        <div className="mt-2 flex items-center justify-between gap-4"><span>Balance source</span><span className="font-medium">{formatKalshiBalanceSource(data.kalshiReadiness.balanceSource)}</span></div>
                        <div className="mt-2 flex items-center justify-between gap-4"><span>Last successful balance sync</span><span className="font-medium">{formatDate(data.kalshiReadiness.lastSuccessfulBalanceSyncAt)}</span></div>
                        {data.kalshiReadiness.balanceErrorDetail && !data.kalshiReadiness.balancesReachable && (
                          <div className="mt-3 text-xs leading-5 text-muted-foreground">{data.kalshiReadiness.balanceErrorDetail}</div>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-4"><span>Execution mode</span><span className="font-medium">{data.kalshiReadiness.executionMode}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Signal source active</span><span className="font-medium">{String(data.kalshiReadiness.signalSourceActive)}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Match quality available</span><span className="font-medium">{String(data.kalshiReadiness.marketMatchQualityAvailable)}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Last readiness check</span><span className="font-medium">{formatDate(data.kalshiReadiness.checkedAt)}</span></div>
                    </CardContent>
                  </Card>

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader>
                      <CardTitle className="text-base">Mirror Path Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className={`${INSET_SURFACE_CLASS} p-3 text-muted-foreground`}>
                        Real Polymarket wallet signals now feed a Kalshi dry-run execution adapter. Live Kalshi order placement still remains disabled by default.
                      </div>
                      <div className="flex items-center justify-between gap-4"><span>Dry-run mirror orders</span><span className="font-medium">{data.performance.dryRunMirroredOrders}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Matched Kalshi markets</span><span className="font-medium">{data.performance.kalshiMatchCount}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Rejected translations</span><span className="font-medium">{data.performance.kalshiRejectedMatchCount}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Recent source signals</span><span className="font-medium">{data.performance.sourceSignalCount}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Live executor</span><span className="font-medium">disabled by default</span></div>
                    </CardContent>
                  </Card>
                </div>

                <Card className={DESK_SURFACE_CLASS}>
                  <CardHeader>
                    <CardTitle className="text-base">Recent Mirror Attempts</CardTitle>
                    <CardDescription>
                      Latest Polymarket-to-Kalshi mirror results, including rejected translations and dry-run order payloads.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {data.kalshiMirrorOrders.length === 0 ? (
                      <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
                        No Kalshi mirror attempts have been recorded yet.
                      </div>
                    ) : (
                      data.kalshiMirrorOrders.slice(0, 8).map((order) => (
                        <div key={order.id} className="rounded-[18px] border border-border/80 bg-white px-4 py-3 text-sm shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{order.kalshiMarketTitle ?? order.sourceMarketTitle ?? order.sourceMarketId}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{order.executionMode} • {order.executionStatus} • {formatDate(order.createdAt)}</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant={order.matchStatus === "matched" ? "secondary" : "outline"}>{order.matchStatus}</Badge>
                              <Badge variant={order.executionStatus === "dry_run_recorded" ? "secondary" : order.executionStatus === "execution_failed" ? "destructive" : "outline"}>{order.executionStatus}</Badge>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                            <span>Cadence: {order.cadence}</span>
                            <span>Contracts: {order.contractCount ?? "n/a"}</span>
                            <span>Limit: {order.limitPriceDollars == null ? "n/a" : `$${order.limitPriceDollars.toFixed(3)}`}</span>
                            <span>Notional: {order.notionalUsd == null ? "n/a" : formatUsd(order.notionalUsd)}</span>
                          </div>
                          {order.rejectionReason && (
                            <div className="mt-2 text-xs leading-5 text-[#8d3c34]">{order.rejectionReason}</div>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </DeskSection>

              <DeskSection
                active={activeSection.id === "audit"}
                id="audit"
                title="Audit"
                description="Runtime-safe activity log for wallet refreshes, monitor runs, signal decisions, config changes, and auth checks."
              >
                <SectionTable
                  empty="No Polymarket audit activity yet."
                  headers={["Time", "Action", "Entity", "Actor", "Details"]}
                  rows={data.auditLog.map((entry) => [
                    formatDate(entry.createdAt),
                    entry.action,
                    `${entry.entityType}:${entry.entityId}`,
                    `${entry.actorType}:${entry.actorId}`,
                    <pre key="details" className="max-w-[28rem] overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {JSON.stringify(entry.details ?? {}, null, 2)}
                    </pre>,
                  ])}
                />
              </DeskSection>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
