import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentEnvConfig,
  CompanySecret,
  PolymarketAuthEnvKey,
  PolymarketCopyDashboardData,
  PolymarketCopyPaperTrade,
  PolymarketCopySignalDecisionRecord,
} from "@paperclipai/shared";
import type { LucideIcon } from "lucide-react";
import {
  ActivitySquare,
  ArrowUpRight,
  BriefcaseBusiness,
  KeyRound,
  Radar,
  RefreshCcw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Link, useParams } from "@/lib/router";
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

const AUTH_KEY_ORDER: PolymarketAuthEnvKey[] = [
  "POLYMARKET_PRIVATE_KEY",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_API_PASSPHRASE",
  "POLYMARKET_FUNDER_ADDRESS",
];

const AUTH_KEY_LABELS: Record<PolymarketAuthEnvKey, string> = {
  POLYMARKET_PRIVATE_KEY: "Private key ref",
  POLYMARKET_API_KEY: "API key ref",
  POLYMARKET_API_SECRET: "API secret ref",
  POLYMARKET_API_PASSPHRASE: "API passphrase ref",
  POLYMARKET_FUNDER_ADDRESS: "Funder address ref",
};

const DESK_SECTIONS = [
  { id: "overview", label: "Overview", icon: ActivitySquare },
  { id: "desk-status", label: "Desk Status", icon: BriefcaseBusiness },
  { id: "workers", label: "Workers", icon: TimerReset },
  { id: "wallets", label: "Wallets", icon: Wallet },
  { id: "signals", label: "Signals", icon: TrendingUp },
  { id: "paper-trades", label: "Paper Trades", icon: ActivitySquare },
  { id: "risk-blocks", label: "Risk / Blocks", icon: ShieldAlert },
  { id: "auth-readiness", label: "Auth Readiness", icon: KeyRound },
  { id: "live-readiness", label: "Live Readiness", icon: Radar },
  { id: "audit", label: "Audit", icon: ScrollText },
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

function boundSecretId(authEnv: AgentEnvConfig | null | undefined, key: PolymarketAuthEnvKey): string | null {
  const binding = authEnv?.[key];
  if (typeof binding !== "object" || binding == null || Array.isArray(binding)) return null;
  if ((binding as { type?: unknown }).type !== "secret_ref") return null;
  const secretId = (binding as { secretId?: unknown }).secretId;
  return typeof secretId === "string" ? secretId : null;
}

function buildNextAuthEnv(
  authEnv: AgentEnvConfig | null | undefined,
  key: PolymarketAuthEnvKey,
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
  compact = false,
  onSelect,
}: {
  activeSection: DeskSectionId;
  compact?: boolean;
  onSelect?: (sectionId: DeskSectionId) => void;
}) {
  return (
    <nav className={compact ? "flex gap-2 overflow-x-auto pb-1" : "flex flex-col gap-1.5"}>
      {DESK_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = section.id === activeSection;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={isActive ? "true" : undefined}
            onClick={() => onSelect?.(section.id)}
            className={
              compact
                ? `flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-white text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                }`
                : `flex items-center gap-3 rounded-[16px] border px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "border-foreground/10 bg-foreground text-background shadow-[0_10px_24px_rgba(15,23,42,0.12)]"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground"
                }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{section.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function DeskSection({
  id,
  title,
  description,
  children,
  actions,
}: {
  id: DeskSectionId;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-40 space-y-4">
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
  onBindSecret: (key: PolymarketAuthEnvKey, secretId: string | null) => void;
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
                Review or bind company secret refs here. Private-key entry above stores through the same company secrets system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {AUTH_KEY_ORDER.map((key) => {
                const status = readiness.keyStatuses[key];
                const currentSecretId = boundSecretId(props.data.runtimeConfig.authEnv, key);
                const hasCurrentSecretOption = currentSecretId != null
                  && props.availableSecrets.some((secret) => secret.id === currentSecretId);
                return (
                  <div key={key} className="rounded-[18px] border border-border/80 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{AUTH_KEY_LABELS[key]}</div>
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
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

export function PolymarketCopy() {
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const { selectedCompany, loading: companiesLoading } = useCompany();
  const { matchedCompany, hasUnknownCompanyPrefix } = useRouteCompanySync(companyPrefix);
  const queryClient = useQueryClient();

  const activeCompany = matchedCompany ?? selectedCompany;
  const activeCompanyId = activeCompany?.id ?? null;
  const companyLabel = activeCompany?.name ?? "Paperclip Company";
  const companyPrefixLabel = activeCompany?.issuePrefix ?? companyPrefix ?? "desk";
  const [privateKeyDraft, setPrivateKeyDraft] = useState("");
  const [activeSection, setActiveSection] = useState<DeskSectionId>("overview");

  useEffect(() => {
    document.title = activeCompany
      ? `Polymarket Trading Desk · ${activeCompany.name} · Paperclip`
      : "Polymarket Trading Desk · Paperclip";
  }, [activeCompany]);

  useEffect(() => {
    const syncActiveSection = () => {
      let nextSection: DeskSectionId = DESK_SECTIONS[0].id;
      let hasMountedSections = false;

      for (const section of DESK_SECTIONS) {
        const element = document.getElementById(section.id);
        if (!element) continue;
        hasMountedSections = true;
        if (element.getBoundingClientRect().top <= 180) {
          nextSection = section.id;
        }
      }

      if (!hasMountedSections) {
        const hash = window.location.hash.replace(/^#/, "");
        if (DESK_SECTIONS.some((section) => section.id === hash)) {
          nextSection = hash as DeskSectionId;
        }
      }

      setActiveSection((current) => (current === nextSection ? current : nextSection));
    };

    syncActiveSection();
    window.addEventListener("scroll", syncActiveSection, { passive: true });
    window.addEventListener("resize", syncActiveSection);
    window.addEventListener("hashchange", syncActiveSection);
    return () => {
      window.removeEventListener("scroll", syncActiveSection);
      window.removeEventListener("resize", syncActiveSection);
      window.removeEventListener("hashchange", syncActiveSection);
    };
  }, [activeCompanyId]);

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
    mutationFn: ({ key, secretId }: { key: PolymarketAuthEnvKey; secretId: string | null }) => {
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

  if (!activeCompanyId) {
    return <EmptyState icon={Wallet} message="Select a company to open the Polymarket trading desk." />;
  }

  if (dashboardQuery.isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (!data) {
    return <EmptyState icon={Wallet} message="No Polymarket desk data is available yet." />;
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
  const monitor5mService = serviceByKey.get("monitor_5m") ?? null;
  const monitor15mService = serviceByKey.get("monitor_15m") ?? null;
  const riskGovernorService = serviceByKey.get("risk_governor") ?? null;
  const executionEngineService = serviceByKey.get("execution_engine") ?? null;
  const paperExecutorLabel = data.runtimeConfig.mode === "paper"
    ? `active at ${formatUsd(data.runtimeConfig.paperTradeUsdPerSignal)} per signal`
    : "inactive";
  const liveExecutorLabel = "dormant / blocked";

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-foreground" style={LIGHT_DESK_THEME}>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-72"
          style={{
            backgroundImage:
              "radial-gradient(circle at top left, rgba(15, 23, 42, 0.07), transparent 34%), radial-gradient(circle at top right, rgba(148, 163, 184, 0.16), transparent 28%)",
          }}
        />

        <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur-xl">
          <div className="mx-auto max-w-[1560px] px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  <span>Polymarket Trading Desk</span>
                  <span className="rounded-full border border-border/80 bg-white px-2.5 py-1 text-foreground">
                    {companyPrefixLabel}
                  </span>
                  <span className="h-1 w-1 rounded-full bg-foreground/25" />
                  <span>Standalone operator surface</span>
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[2rem]">
                    {companyLabel}
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Two active monitors drive one shared deterministic pipeline. Paper execution is active, live execution stays dormant and blocked, and the desk keeps all current auth-readiness and operator controls intact.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 xl:max-w-[34rem] xl:justify-end">
                <Button variant="outline" size="sm" className="border-border/80 bg-white" asChild>
                  <Link to="/dashboard">
                    Open Control Plane
                    <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border/80 bg-white"
                  onClick={() => walletSelectorMutation.mutate()}
                  disabled={walletSelectorMutation.isPending}
                >
                  <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                  Run Wallet Selection
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border/80 bg-white"
                  onClick={() => monitor5mMutation.mutate()}
                  disabled={monitor5mMutation.isPending}
                >
                  <TimerReset className="mr-1.5 h-3.5 w-3.5" />
                  Run 5m Monitor
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-border/80 bg-white"
                  onClick={() => monitor15mMutation.mutate()}
                  disabled={monitor15mMutation.isPending}
                >
                  <TimerReset className="mr-1.5 h-3.5 w-3.5" />
                  Run 15m Monitor
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
              <HeaderStatusCard
                label="Company"
                value={<span className="inline-flex min-w-0 items-center truncate">{companyPrefixLabel}</span>}
              />
              <HeaderStatusCard
                label="Owner"
                value={<span className="block truncate">{directOwnerLabel}</span>}
              />
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

        <div className="relative z-10 mx-auto max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid items-start gap-6 lg:grid-cols-[248px,minmax(0,1fr)] lg:gap-8">
            <aside className="hidden lg:block">
              <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-[28px] border border-border/80 bg-white/96 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                <div className="space-y-1 border-b border-border/70 pb-4">
                  <div className="text-sm font-semibold text-foreground">Desk Navigation</div>
                  <div className="text-xs leading-5 text-muted-foreground">
                    Natural page scroll with a compact operator rail for quick jumps.
                  </div>
                </div>

                <div className="mt-4">
                  <SectionMenu activeSection={activeSection} onSelect={setActiveSection} />
                </div>

                <div className={`${INSET_SURFACE_CLASS} mt-4 p-4`}>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    System Shape
                  </div>
                  <div className="mt-3 space-y-3 text-sm text-foreground/90">
                    <div className="flex items-center justify-between gap-3">
                      <span>Primary workers</span>
                      <Badge variant={monitor5mService?.exists && monitor15mService?.exists ? "secondary" : "outline"}>
                        {(monitor5mService?.exists ? 1 : 0) + (monitor15mService?.exists ? 1 : 0)}/2 real
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Shared pipeline</span>
                      <Badge variant={provisionedServiceCount === managedServices.length ? "secondary" : "outline"}>
                        {provisionedServiceCount}/{managedServices.length} services
                      </Badge>
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

            <main className="min-w-0 space-y-8">
              {dashboardQuery.error && <p className="text-sm text-destructive">{dashboardQuery.error.message}</p>}

              <div className="lg:hidden">
                <SectionMenu activeSection={activeSection} compact onSelect={setActiveSection} />
              </div>

              <DeskSection
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
                        One company-scoped trading system with optional analyst support. No execution zoo.
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
                      <div className="flex items-center justify-between"><span>Min wallet score</span><span className="font-medium">{data.runtimeConfig.minWalletScore.toFixed(2)}</span></div>
                      <div className="flex items-center justify-between"><span>Min signal materiality</span><span className="font-medium">{formatUsd(data.runtimeConfig.minSignalMateriality)}</span></div>
                      <div className="flex items-center justify-between"><span>Max spread</span><span className="font-medium">{data.runtimeConfig.maxSpreadBps} bps</span></div>
                      <div className="flex items-center justify-between"><span>Max market exposure</span><span className="font-medium">{formatUsd(data.runtimeConfig.maxExposurePerMarket)}</span></div>
                      <div className="flex items-center justify-between"><span>Max open paper exposure</span><span className="font-medium">{formatUsd(data.runtimeConfig.maxTotalOpenPaperExposure)}</span></div>
                    </CardContent>
                  </Card>
                </div>
              </DeskSection>

              <DeskSection
                id="workers"
                title="Workers"
                description="The only active workers are the 5m and 15m monitors. Everything else is shared deterministic support logic behind the same execution path."
              >
                <div className="grid gap-4 xl:grid-cols-3">
                  {[
                    {
                      workerKey: "polymarket-monitor-5m",
                      label: "5m Monitor",
                      cadence: "Every five minutes",
                      health: health5m,
                      exists: monitor5mService?.exists,
                      lastSuccess: data.overview.lastSuccessful5mRun,
                    },
                    {
                      workerKey: "polymarket-monitor-15m",
                      label: "15m Monitor",
                      cadence: "Every fifteen minutes",
                      health: health15m,
                      exists: monitor15mService?.exists,
                      lastSuccess: data.overview.lastSuccessful15mRun,
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
                id="wallets"
                title="Wallets"
                description="Active watched wallets, bench candidates, and composite score breakdowns."
              >
                <SectionTable
                  empty="No watched wallets yet."
                  headers={["Wallet", "Status", "Score", "Component Scores", "Last Refreshed"]}
                  rows={data.watchedWallets.map((wallet) => [
                    <div key="wallet" className="space-y-1">
                      <div className="font-mono text-xs">{wallet.walletAddress}</div>
                      <div className="text-xs text-muted-foreground">{wallet.label || "Unlabeled"}</div>
                    </div>,
                    <Badge key="status" variant={wallet.status === "active" ? "secondary" : wallet.status === "bench" ? "outline" : "destructive"}>
                      {wallet.status}
                    </Badge>,
                    <span key="score" className="font-medium">{wallet.score.toFixed(3)}</span>,
                    <div key="components" className="space-y-1 text-xs leading-5 text-muted-foreground">
                      <div>eff {wallet.componentScores.efficiency.toFixed(2)} • con {wallet.componentScores.consistency.toFixed(2)}</div>
                      <div>div {wallet.componentScores.diversification.toFixed(2)} • rec {wallet.componentScores.recency.toFixed(2)}</div>
                      <div>pen {wallet.componentScores.concentrationPenalty.toFixed(2)}</div>
                    </div>,
                    formatDate(wallet.lastRefreshedAt),
                  ])}
                />
              </DeskSection>

              <DeskSection
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
                id="live-readiness"
                title="Live Readiness"
                description="Governance state for future live activation. V0 remains paper-only and still never places orders."
              >
                <div className="grid gap-4 xl:grid-cols-[1.15fr,1fr]">
                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Radar className="h-4 w-4" />
                        Live Gate Stack
                      </CardTitle>
                      <CardDescription>
                        Live dispatch stays impossible by default and unresolved until a future executor exists.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2">
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
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Authenticated readiness</div>
                        <div className="mt-2 text-lg font-semibold text-foreground">{readiness.authenticatedLiveReadiness}</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={DESK_SURFACE_CLASS}>
                    <CardHeader>
                      <CardTitle className="text-base">Current Runtime Outcome</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className={`${INSET_SURFACE_CLASS} p-3 text-muted-foreground`}>
                        Even with valid credentials present, the desk remains paper-first. A future live phase still needs explicit operator controls plus a real execution implementation.
                      </div>
                      <div className="flex items-center justify-between gap-4"><span>Validation mode</span><span className="font-medium">{readiness.validationMode}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Last validation</span><span className="font-medium">{formatDate(readiness.lastValidation.checkedAt)}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Last derivation attempt</span><span className="font-medium">{formatDate(readiness.lastDerivation.attemptedAt)}</span></div>
                      <div className="flex items-center justify-between gap-4"><span>Live executor</span><span className="font-medium">Not implemented</span></div>
                    </CardContent>
                  </Card>
                </div>
              </DeskSection>

              <DeskSection
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
