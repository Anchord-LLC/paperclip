import { createPrivateKey } from "node:crypto";
import type { Db } from "@paperclipai/db";
import type {
  AgentEnvConfig,
  PolymarketCopyAuthKeyStatus,
  PolymarketCopyKalshiReadiness,
  PolymarketCopyKalshiReadinessErrorClass,
  PolymarketCopyRuntimeConfig,
  PolymarketKalshiEnvKey,
} from "@paperclipai/shared";
import { secretService } from "../secrets.js";
import {
  createKalshiClient,
  isKalshiRequestError,
  type KalshiCredentials,
} from "./kalshi-client.js";
import { KALSHI_AUTH_ENV_KEYS } from "./shared.js";

const MISSING_REASON_BY_KEY: Record<PolymarketKalshiEnvKey, string> = {
  KALSHI_API_KEY_ID: "kalshi_api_key_ref_missing",
  KALSHI_PRIVATE_KEY: "kalshi_private_key_ref_missing",
};

const INVALID_BINDING_REASON_BY_KEY: Record<PolymarketKalshiEnvKey, string> = {
  KALSHI_API_KEY_ID: "kalshi_api_key_ref_invalid",
  KALSHI_PRIVATE_KEY: "kalshi_private_key_ref_invalid",
};

const MISSING_SECRET_REASON_BY_KEY: Record<PolymarketKalshiEnvKey, string> = {
  KALSHI_API_KEY_ID: "kalshi_api_key_secret_missing",
  KALSHI_PRIVATE_KEY: "kalshi_private_key_secret_missing",
};

const RESOLVE_FAILURE_REASON_BY_KEY: Record<PolymarketKalshiEnvKey, string> = {
  KALSHI_API_KEY_ID: "kalshi_api_key_secret_unresolved",
  KALSHI_PRIVATE_KEY: "kalshi_private_key_secret_unresolved",
};

const INVALID_VALUE_REASON_BY_KEY: Record<PolymarketKalshiEnvKey, string> = {
  KALSHI_API_KEY_ID: "kalshi_api_key_invalid_format",
  KALSHI_PRIVATE_KEY: "kalshi_private_key_invalid_format",
};

let readinessCache = new Map<string, { expiresAt: number; value: PolymarketCopyKalshiReadiness }>();

function classifyBalanceProbeFailure(error: unknown): {
  errorClass: PolymarketCopyKalshiReadinessErrorClass;
  reasonCode: string;
  detail: string | null;
} {
  if (isKalshiRequestError(error)) {
    const detail = error.responseBodySnippet ?? error.message;
    const lowered = detail.toLowerCase();

    if (error.kind === "network_error") {
      return { errorClass: "network_api_failure", reasonCode: "kalshi_balance_network_api_failure", detail };
    }

    if (error.kind === "malformed_response") {
      return { errorClass: "malformed_response", reasonCode: "kalshi_balance_malformed_response", detail };
    }

    if ((error.status === 400 || error.status === 401 || error.status === 403) && lowered.includes("signature")) {
      return { errorClass: "signature_failure", reasonCode: "kalshi_balance_signature_failure", detail };
    }

    if (error.status === 401 || error.status === 403) {
      return { errorClass: "auth_failure", reasonCode: "kalshi_balance_auth_failure", detail };
    }

    if (error.status === 404 && lowered.includes("subaccount")) {
      return { errorClass: "missing_subaccount", reasonCode: "kalshi_balance_missing_subaccount", detail };
    }

    return { errorClass: "network_api_failure", reasonCode: "kalshi_balance_api_failure", detail };
  }

  const detail = error instanceof Error ? error.message : String(error);
  return { errorClass: "network_api_failure", reasonCode: "kalshi_balance_api_failure", detail };
}

type SecretRefBinding = {
  type: "secret_ref";
  secretId: string;
  version?: number | "latest";
};

function isSecretRefBinding(value: unknown): value is SecretRefBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (value as { type?: unknown }).type === "secret_ref"
    && typeof (value as { secretId?: unknown }).secretId === "string";
}

function normalizeKalshiPrivateKey(value: string): string {
  return value.trim().replace(/\\n/g, "\n");
}

function validateResolvedValue(key: PolymarketKalshiEnvKey, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (key === "KALSHI_PRIVATE_KEY") {
    try {
      createPrivateKey(normalizeKalshiPrivateKey(trimmed));
      return true;
    } catch {
      return false;
    }
  }
  return trimmed.length >= 8;
}

function emptyKeyStatuses(): Record<PolymarketKalshiEnvKey, PolymarketCopyAuthKeyStatus> {
  return {
    KALSHI_API_KEY_ID: { present: false, bindingType: "missing", valid: false, reasonCode: MISSING_REASON_BY_KEY.KALSHI_API_KEY_ID },
    KALSHI_PRIVATE_KEY: { present: false, bindingType: "missing", valid: false, reasonCode: MISSING_REASON_BY_KEY.KALSHI_PRIVATE_KEY },
  };
}

async function resolveKalshiSecretValues(db: Db, companyId: string, authEnv: AgentEnvConfig | null | undefined) {
  const secretsSvc = secretService(db);
  const keyStatuses = emptyKeyStatuses();
  const resolved: Partial<Record<PolymarketKalshiEnvKey, string>> = {};

  for (const key of KALSHI_AUTH_ENV_KEYS) {
    const binding = authEnv?.[key];
    if (!binding) continue;

    if (!isSecretRefBinding(binding)) {
      keyStatuses[key] = { present: true, bindingType: "invalid", valid: false, reasonCode: INVALID_BINDING_REASON_BY_KEY[key] };
      continue;
    }

    keyStatuses[key] = { present: true, bindingType: "secret_ref", valid: false, reasonCode: null };
    const secret = await secretsSvc.getById(binding.secretId);
    if (!secret || secret.companyId !== companyId) {
      keyStatuses[key] = { present: true, bindingType: "secret_ref", valid: false, reasonCode: MISSING_SECRET_REASON_BY_KEY[key] };
      continue;
    }

    try {
      const value = await secretsSvc.resolveSecretValue(companyId, binding.secretId, binding.version ?? "latest");
      if (!validateResolvedValue(key, value)) {
        keyStatuses[key] = { present: true, bindingType: "secret_ref", valid: false, reasonCode: INVALID_VALUE_REASON_BY_KEY[key] };
        continue;
      }
      resolved[key] = value;
      keyStatuses[key] = { present: true, bindingType: "secret_ref", valid: true, reasonCode: null };
    } catch {
      keyStatuses[key] = { present: true, bindingType: "secret_ref", valid: false, reasonCode: RESOLVE_FAILURE_REASON_BY_KEY[key] };
    }
  }

  return { keyStatuses, resolved };
}

export async function resolveKalshiCredentials(
  db: Db,
  companyId: string,
  runtimeConfig: Pick<PolymarketCopyRuntimeConfig, "authEnv">,
): Promise<{ credentials: KalshiCredentials | null; keyStatuses: Record<PolymarketKalshiEnvKey, PolymarketCopyAuthKeyStatus> }> {
  const { keyStatuses, resolved } = await resolveKalshiSecretValues(db, companyId, runtimeConfig.authEnv);
  if (!resolved.KALSHI_API_KEY_ID || !resolved.KALSHI_PRIVATE_KEY) {
    return { credentials: null, keyStatuses };
  }

  return {
    credentials: {
      apiKeyId: resolved.KALSHI_API_KEY_ID,
      privateKeyPem: normalizeKalshiPrivateKey(resolved.KALSHI_PRIVATE_KEY),
    },
    keyStatuses,
  };
}

export async function inspectKalshiReadiness(options: {
  db: Db;
  companyId: string;
  runtimeConfig: Pick<PolymarketCopyRuntimeConfig, "authEnv" | "kalshiExecutionMode" | "kalshiApiBaseUrl">;
  signalSourceActive: boolean;
}): Promise<PolymarketCopyKalshiReadiness> {
  const cacheKey = `${options.companyId}:${options.runtimeConfig.kalshiExecutionMode}:${options.runtimeConfig.kalshiApiBaseUrl}`;
  const cached = readinessCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const checkedAt = new Date();
  const { credentials, keyStatuses } = await resolveKalshiCredentials(options.db, options.companyId, options.runtimeConfig);
  const reasonCodes = Object.values(keyStatuses).flatMap((status) => status.reasonCode ? [status.reasonCode] : []);
  const authConfigured = credentials != null;
  const client = createKalshiClient(options.runtimeConfig.kalshiApiBaseUrl);

  let marketDataReachable = false;
  let balancesReachable = false;
  let positionsReachable = false;
  let walletBalanceUsd: number | null = null;
  let portfolioValueUsd: number | null = null;
  let lastSuccessfulBalanceSyncAt: Date | null = null;
  let balanceSource: PolymarketCopyKalshiReadiness["balanceSource"] = credentials ? "primary_account" : null;
  let balanceErrorClass: PolymarketCopyKalshiReadinessErrorClass | null = null;
  let balanceErrorDetail: string | null = null;

  try {
    const marketProbe = await client.getMarkets({ status: "open", limit: 1 });
    marketDataReachable = Array.isArray(marketProbe.markets);
  } catch {
    reasonCodes.push("kalshi_market_data_unreachable");
  }

  if (credentials) {
    try {
      const balance = await client.getBalance(credentials);
      balancesReachable = true;
      walletBalanceUsd = balance.balanceUsd;
      portfolioValueUsd = balance.portfolioValueUsd;
      lastSuccessfulBalanceSyncAt = checkedAt;
      balanceSource = "primary_account";
    } catch (error) {
      const classified = classifyBalanceProbeFailure(error);
      balanceErrorClass = classified.errorClass;
      balanceErrorDetail = classified.detail;
      reasonCodes.push(classified.reasonCode);
      reasonCodes.push("kalshi_balance_unreachable");
    }

    try {
      await client.getPositions(credentials, { limit: 1 });
      positionsReachable = true;
    } catch {
      reasonCodes.push("kalshi_positions_unreachable");
    }
  } else {
    reasonCodes.push("kalshi_auth_incomplete");
  }

  const dedupedReasonCodes = Array.from(new Set(reasonCodes));
  const value: PolymarketCopyKalshiReadiness = {
    checkedAt,
    executionMode: options.runtimeConfig.kalshiExecutionMode,
    authConfigured,
    marketDataReachable,
    balancesReachable,
    positionsReachable,
    signalSourceActive: options.signalSourceActive,
    marketMatchQualityAvailable: marketDataReachable,
    walletBalanceUsd,
    portfolioValueUsd,
    lastSuccessfulBalanceSyncAt,
    balanceSource,
    balanceErrorClass,
    balanceErrorDetail,
    keyStatuses,
    reasonCodes: dedupedReasonCodes,
    summary: authConfigured
      ? balancesReachable
        ? "Kalshi adapter is configured and can read the authenticated account balance for the bound company secret refs while dry-run mirroring stays enabled."
        : marketDataReachable
          ? "Kalshi secret refs are configured, but the authenticated balance probe did not succeed during the latest readiness check."
          : "Kalshi secret refs are configured, but market data could not be reached during the latest readiness probe."
      : "Kalshi secret refs are incomplete. Bind KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY through the existing company secret flow before live venue readiness can complete.",
  };

  readinessCache.set(cacheKey, { expiresAt: Date.now() + 30_000, value });
  return value;
}
