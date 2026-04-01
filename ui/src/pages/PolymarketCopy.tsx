import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentEnvConfig,
  CompanySecret,
  PolymarketAuthEnvKey,
  PolymarketCopyDashboardData,
  PolymarketCopyPaperTrade,
  PolymarketCopySignalDecisionRecord,
} from "@paperclipai/shared";
import {
  ActivitySquare,
  ArrowUpRight,
  BriefcaseBusiness,
  KeyRound,
  Radar,
  RefreshCcw,
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
import { MetricCard } from "../components/MetricCard";
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
  { id: "overview", label: "Overview" },
  { id: "desk-status", label: "Desk Status" },
  { id: "worker-status", label: "Worker Status" },
  { id: "live-readiness", label: "Live Readiness" },
  { id: "auth-readiness", label: "Auth Readiness" },
  { id: "wallets", label: "Wallets" },
  { id: "signals", label: "Signals" },
  { id: "paper-trades", label: "Paper Trades" },
  { id: "risk-blocks", label: "Risk / Blocks" },
  { id: "audit", label: "Audit" },
] as const;

const EMPTY_SECRET_REF = "__none__";

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
  if (health === "healthy") return "secondary";
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

function SectionMenu({ compact = false }: { compact?: boolean }) {
  return (
    <nav className={compact ? "flex gap-2 overflow-x-auto pb-1" : "flex flex-col gap-1"}>
      {DESK_SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={
            compact
              ? "whitespace-nowrap rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground/80 transition-colors hover:border-foreground/20 hover:text-foreground"
              : "rounded-xl px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          }
        >
          {section.label}
        </a>
      ))}
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
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function OverviewCards({ data }: { data: PolymarketCopyDashboardData }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard icon={Wallet} value={data.overview.watchedWalletCount} label="Watched Wallets" />
      <MetricCard icon={TrendingUp} value={data.overview.signalsToday} label="Signals Today" description={`${data.overview.acceptedCount} accepted`} />
      <MetricCard icon={ActivitySquare} value={data.overview.paperTradesOpen} label="Open Paper Trades" description={`${data.overview.paperTradesClosed} closed`} />
      <MetricCard icon={ShieldAlert} value={formatUsd(data.overview.realizedPnlUsd)} label="Realized PnL" description={`Unrealized ${formatUsd(data.overview.unrealizedPnlUsd)}`} />
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
    return <div className="rounded-2xl border border-border bg-background/90 p-6 text-sm text-muted-foreground shadow-sm">{empty}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-background/90 shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-border align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
    <Card className="rounded-2xl border-border bg-background/90 shadow-sm">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
            onClick={props.onCheckReadiness}
            disabled={props.isCheckingReadiness}
          >
            Check Auth Readiness
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={props.onDeriveCredentials}
            disabled={props.isDerivingCredentials || !readiness.canDeriveApiCredentials}
          >
            Derive API Credentials
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={props.onRefreshStatus}
          >
            Refresh Readiness Status
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <div className="rounded-2xl border border-border bg-muted/20 p-4">
          <div className="space-y-1">
            <div className="font-medium">Store / Rotate Private Key</div>
            <p className="text-sm text-muted-foreground">
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
              />
            </div>
            <Button
              variant="outline"
              onClick={props.onStorePrivateKey}
              disabled={props.isStoringPrivateKey || props.privateKeyDraft.trim().length === 0}
            >
              Store Private Key
            </Button>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Stored only as a company secret ref. Raw key values are never written into repo files or persisted in page state beyond this input.
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <Card className="rounded-2xl border-border shadow-none">
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
              <div className="rounded-xl border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
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
                <div className="rounded-xl border border-border p-3 text-sm">
                  {props.statusMessage}
                </div>
              )}
              {props.secretsErrorMessage && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {props.secretsErrorMessage}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border shadow-none">
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
                  <div key={key} className="rounded-xl border border-border p-3">
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
                        <SelectTrigger className="w-full sm:w-[320px]">
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
                      <div className="text-xs text-muted-foreground">
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

  useEffect(() => {
    document.title = activeCompany
      ? `Polymarket Trading Desk · ${activeCompany.name} · Paperclip`
      : "Polymarket Trading Desk · Paperclip";
  }, [activeCompany]);

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
  const ceoAgentLabel = data.underlyingModel.ceoAgent?.name ?? "None";
  const tradingAnalystLabel = data.underlyingModel.tradingAnalyst?.name ?? "Not provisioned";
  const managedServices = data.underlyingModel.runtimeServices;
  const provisionedServiceCount = managedServices.filter((service) => service.exists).length;

  return (
    <div
      className="min-h-dvh bg-background"
      style={{
        backgroundImage: "radial-gradient(circle at top left, rgba(245, 158, 11, 0.08), transparent 28%), radial-gradient(circle at top right, rgba(16, 185, 129, 0.08), transparent 24%)",
      }}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-background/92 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                <span>Paperclip Trading Desk</span>
                <span className="h-1 w-1 rounded-full bg-foreground/30" />
                <span>Polymarket Operator Dashboard</span>
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Standalone Desk Surface</h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  Separate operator shell for the governed Polymarket desk. Paperclip backend remains the control plane for APIs, jobs, secrets, runtime config, and safety gates.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Direct Owner: {directOwnerLabel}</Badge>
                <Badge variant="outline">CEO Agent: {ceoAgentLabel}</Badge>
                <Badge variant="outline">Desk Model: Company Runtime</Badge>
                <Badge variant="outline">Company: {companyLabel}</Badge>
                <Badge variant="outline">Desk: {companyPrefixLabel}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard">
                  Open Control Plane
                  <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => walletSelectorMutation.mutate()}
                disabled={walletSelectorMutation.isPending}
              >
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                Run Wallet Selection
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => monitor5mMutation.mutate()}
                disabled={monitor5mMutation.isPending}
              >
                <TimerReset className="mr-1.5 h-3.5 w-3.5" />
                Run 5m Monitor
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => monitor15mMutation.mutate()}
                disabled={monitor15mMutation.isPending}
              >
                <TimerReset className="mr-1.5 h-3.5 w-3.5" />
                Run 15m Monitor
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <SectionMenu compact />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[220px,1fr] lg:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-28 space-y-4 rounded-3xl border border-border bg-background/88 p-4 shadow-sm">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Operator Menu</div>
              <div className="text-xs text-muted-foreground">
                Dedicated desk shell, separate from the normal admin sidebar.
              </div>
            </div>
            <SectionMenu />
            <div className="rounded-2xl border border-border bg-muted/20 p-3 text-sm">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Desk Snapshot</div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span>Mode</span>
                  <Badge variant={data.runtimeConfig.mode === "paper" ? "secondary" : "destructive"}>
                    {data.runtimeConfig.mode}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Live enabled</span>
                  <Badge variant={toneForBoolean(data.runtimeConfig.liveEnabled, "destructive")}>
                    {String(data.runtimeConfig.liveEnabled)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Kill switch</span>
                  <Badge variant={data.runtimeConfig.tradingKillSwitch ? "destructive" : "secondary"}>
                    {data.runtimeConfig.tradingKillSwitch ? "on" : "off"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>5m worker</span>
                  <Badge variant={toneForHealth(health5m)}>{health5m}</Badge>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>15m worker</span>
                  <Badge variant={toneForHealth(health15m)}>{health15m}</Badge>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="space-y-8">
          {dashboardQuery.error && <p className="text-sm text-destructive">{dashboardQuery.error.message}</p>}

          <DeskSection
            id="overview"
            title="Overview"
            description="Operator-facing snapshot of the Polymarket desk. Paper remains the default execution mode."
          >
            <div className="grid gap-4 xl:grid-cols-[1.4fr,0.95fr]">
              <Card className="rounded-3xl border-border bg-background/92 shadow-sm">
                <CardContent className="space-y-5 p-6">
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
                    <Badge variant={toneForHealth(health5m)}>5m Worker: {health5m}</Badge>
                    <Badge variant={toneForHealth(health15m)}>15m Worker: {health15m}</Badge>
                  </div>

                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold tracking-tight">Polymarket Desk</h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                      This operator dashboard is a separate product surface on top of Paperclip runtime governance. Wallet tracking, signal generation, risk checks, paper simulation, and auth readiness all flow through the same backend engine.
                    </p>
                  </div>

                  <OverviewCards data={data} />
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-border bg-background/92 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Desk Identity</CardTitle>
                  <CardDescription>Product surface for desk operators, with Paperclip behind it as the governed engine.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span>Direct owner</span>
                    <span className="text-right font-medium">{directOwnerLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>CEO agent</span>
                    <span className="font-medium">{ceoAgentLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Trading Analyst</span>
                    <span className="font-medium">{tradingAnalystLabel}</span>
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
                    <span>Company</span>
                    <span className="font-medium">{companyLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Control Plane</span>
                    <span className="font-medium">Paperclip backend</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Watched wallets</span>
                    <span className="font-medium">{data.overview.watchedWalletCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Bench wallets</span>
                    <span className="font-medium">{data.overview.benchCount}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Signals today</span>
                    <span className="font-medium">{data.overview.signalsToday}</span>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">Managed desk services</span>
                      <Badge variant={provisionedServiceCount === managedServices.length ? "secondary" : "outline"}>
                        {provisionedServiceCount}/{managedServices.length} provisioned
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      {managedServices.map((service) => (
                        <div key={service.key} className="flex items-center justify-between gap-3">
                          <span>{service.serviceName}</span>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={service.exists ? "secondary" : "outline"}>
                              {service.exists ? "real" : "missing"}
                            </Badge>
                            {service.exists && (
                              <Badge variant="outline">{service.status ?? "unknown"}</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </DeskSection>

          <DeskSection
            id="desk-status"
            title="Desk Status"
            description="Core desk health, ownership, exposure, and runtime thresholds."
          >
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="rounded-2xl border-border bg-background/90 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BriefcaseBusiness className="h-4 w-4" />
                    Operations
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Accepted today</span>
                    <span className="font-medium">{data.overview.acceptedCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Skipped today</span>
                    <span className="font-medium">{data.overview.skippedCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Blocked today</span>
                    <span className="font-medium">{data.overview.blockedCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Open paper trades</span>
                    <span className="font-medium">{data.overview.paperTradesOpen}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Closed paper trades</span>
                    <span className="font-medium">{data.overview.paperTradesClosed}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border bg-background/90 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert className="h-4 w-4" />
                    Exposure
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Current open exposure</span>
                    <span className="font-medium">{formatUsd(data.risk.currentExposureUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Daily realized loss</span>
                    <span className="font-medium">{formatUsd(data.risk.dailyRealizedLossUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Realized PnL</span>
                    <span className="font-medium">{formatUsd(data.overview.realizedPnlUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Unrealized PnL</span>
                    <span className="font-medium">{formatUsd(data.overview.unrealizedPnlUsd)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border bg-background/90 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4" />
                    Runtime Thresholds
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Min wallet score</span>
                    <span className="font-medium">{data.runtimeConfig.minWalletScore.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Min signal materiality</span>
                    <span className="font-medium">{formatUsd(data.runtimeConfig.minSignalMateriality)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Max spread</span>
                    <span className="font-medium">{data.runtimeConfig.maxSpreadBps} bps</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Max market exposure</span>
                    <span className="font-medium">{formatUsd(data.runtimeConfig.maxExposurePerMarket)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Max open paper exposure</span>
                    <span className="font-medium">{formatUsd(data.runtimeConfig.maxTotalOpenPaperExposure)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </DeskSection>

          <DeskSection
            id="worker-status"
            title="Worker Status"
            description="Dual-cadence worker health, recent runs, and selection cadence visibility."
          >
            <div className="grid gap-4 xl:grid-cols-3">
              {[
                {
                  workerKey: "polymarket-monitor-5m",
                  label: "5m Monitor",
                  health: health5m,
                  lastSuccess: data.overview.lastSuccessful5mRun,
                },
                {
                  workerKey: "polymarket-monitor-15m",
                  label: "15m Monitor",
                  health: health15m,
                  lastSuccess: data.overview.lastSuccessful15mRun,
                },
                {
                  workerKey: "wallet-selector-daily",
                  label: "Wallet Selector",
                  health: data.overview.workerHealth["wallet-selector-daily"] ?? "idle",
                  lastSuccess: latestWorkerRuns.get("wallet-selector-daily")?.finishedAt ?? null,
                },
              ].map((worker) => {
                const run = latestWorkerRuns.get(worker.workerKey);
                return (
                  <Card key={worker.workerKey} className="rounded-2xl border-border bg-background/90 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between gap-2 text-base">
                        <span>{worker.label}</span>
                        <Badge variant={toneForHealth(worker.health)}>{worker.health}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>Last successful run</span>
                        <span className="font-medium">{formatDate(worker.lastSuccess)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Latest status</span>
                        <span className="font-medium">{run?.status ?? "idle"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Signals in latest run</span>
                        <span className="font-medium">{run?.signalCount ?? 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Accepted in latest run</span>
                        <span className="font-medium">{run?.acceptedCount ?? 0}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </DeskSection>

          <DeskSection
            id="live-readiness"
            title="Live Readiness"
            description="Governance state for future live activation. V0 remains paper-only and still never places orders."
          >
            <div className="grid gap-4 xl:grid-cols-[1.15fr,1fr]">
              <Card className="rounded-2xl border-border bg-background/90 shadow-sm">
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
                  <div className="rounded-xl border border-border p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mode</div>
                    <div className="mt-2 text-lg font-semibold">{data.runtimeConfig.mode}</div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Live enabled</div>
                    <div className="mt-2 text-lg font-semibold">{String(data.runtimeConfig.liveEnabled)}</div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Kill switch</div>
                    <div className="mt-2 text-lg font-semibold">{data.runtimeConfig.tradingKillSwitch ? "on" : "off"}</div>
                  </div>
                  <div className="rounded-xl border border-border p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Authenticated readiness</div>
                    <div className="mt-2 text-lg font-semibold">{readiness.authenticatedLiveReadiness}</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-border bg-background/90 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Current Runtime Outcome</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="rounded-xl border border-border bg-muted/20 p-3 text-muted-foreground">
                    Even with valid credentials present, the desk remains paper-first. A future live phase still needs explicit operator controls plus a real execution implementation.
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Validation mode</span>
                    <span className="font-medium">{readiness.validationMode}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Last validation</span>
                    <span className="font-medium">{formatDate(readiness.lastValidation.checkedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Last derivation attempt</span>
                    <span className="font-medium">{formatDate(readiness.lastDerivation.attemptedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Live executor</span>
                    <span className="font-medium">Not implemented</span>
                  </div>
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
                <div key="components" className="space-y-1 text-xs text-muted-foreground">
                  <div>eff {wallet.componentScores.efficiency.toFixed(2)} | con {wallet.componentScores.consistency.toFixed(2)}</div>
                  <div>div {wallet.componentScores.diversification.toFixed(2)} | rec {wallet.componentScores.recency.toFixed(2)}</div>
                  <div>pen {wallet.componentScores.concentrationPenalty.toFixed(2)}</div>
                </div>,
                formatDate(wallet.lastRefreshedAt),
              ])}
            />
          </DeskSection>

          <DeskSection
            id="signals"
            title="Signals"
            description="Structured wallet activity events normalized from dual-cadence monitoring."
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

              <Card className="rounded-2xl border-border bg-background/90 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Threshold Failures</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {data.risk.thresholdFailures.length === 0 && (
                    <div className="text-muted-foreground">No threshold failures yet today.</div>
                  )}
                  {data.risk.thresholdFailures.map((item) => (
                    <div key={item.reasonCode} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                      <span>{item.reasonCode}</span>
                      <span className="font-medium">{item.count}</span>
                    </div>
                  ))}
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
                <pre key="details" className="max-w-[28rem] overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                  {JSON.stringify(entry.details ?? {}, null, 2)}
                </pre>,
              ])}
            />
          </DeskSection>
        </main>
      </div>
    </div>
  );
}
