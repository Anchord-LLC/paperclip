import type {
  PatchPolymarketCopyRuntimeConfig,
  PolymarketCopyAuthReadiness,
  PolymarketCopyDashboardData,
  PolymarketCopyDeriveApiCredentialsResult,
  PolymarketCopyRuntimeConfig,
} from "@paperclipai/shared";
import { api } from "./client";

export const polymarketCopyApi = {
  dashboard: (companyId: string) =>
    api.get<PolymarketCopyDashboardData>(`/companies/${companyId}/polymarket-copy/dashboard`),
  runtimeConfig: (companyId: string) =>
    api.get<PolymarketCopyRuntimeConfig>(`/companies/${companyId}/polymarket-copy/runtime-config`),
  updateRuntimeConfig: (companyId: string, patch: PatchPolymarketCopyRuntimeConfig) =>
    api.patch<PolymarketCopyRuntimeConfig>(`/companies/${companyId}/polymarket-copy/runtime-config`, patch),
  checkAuthReadiness: (companyId: string, reason?: string) =>
    api.post<PolymarketCopyAuthReadiness>(`/companies/${companyId}/polymarket-copy/auth/check-readiness`, { reason }),
  deriveApiCredentials: (companyId: string, reason?: string) =>
    api.post<PolymarketCopyDeriveApiCredentialsResult>(
      `/companies/${companyId}/polymarket-copy/auth/derive-api-credentials`,
      { reason },
    ),
  runWalletSelector: (companyId: string, reason?: string) =>
    api.post<{ runId: string; reason: string; activeWallets: number; benchWallets: number }>(
      `/companies/${companyId}/polymarket-copy/runs/wallet-selector`,
      { reason },
    ),
  runMonitor5m: (companyId: string, reason?: string) =>
    api.post<{ workerRunId: string; workerKey: string; status: string }>(
      `/companies/${companyId}/polymarket-copy/runs/monitor-5m`,
      { reason },
    ),
  runMonitor15m: (companyId: string, reason?: string) =>
    api.post<{ workerRunId: string; workerKey: string; status: string }>(
      `/companies/${companyId}/polymarket-copy/runs/monitor-15m`,
      { reason },
    ),
};
