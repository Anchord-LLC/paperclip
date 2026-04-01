import type { Db } from "@paperclipai/db";
import type {
  PolymarketAuthEnvKey,
  PolymarketAuthReadinessResult,
  PolymarketCopyAuthDerivationStatus,
  PolymarketCopyAuthKeyStatus,
  PolymarketCopyAuthReadiness,
  PolymarketCopyAuthValidationStatus,
  PolymarketCopyRuntimeConfig,
} from "@paperclipai/shared";
import { isAddress } from "viem";
import { secretService } from "../secrets.js";
import { POLYMARKET_AUTH_ENV_KEYS } from "./shared.js";

type SecretRefBinding = {
  type: "secret_ref";
  secretId: string;
  version?: number | "latest";
};

type AuditEntry = {
  action: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
};

const MISSING_REASON_BY_KEY: Record<PolymarketAuthEnvKey, string> = {
  POLYMARKET_PRIVATE_KEY: "private_key_ref_missing",
  POLYMARKET_API_KEY: "api_key_ref_missing",
  POLYMARKET_API_SECRET: "api_secret_ref_missing",
  POLYMARKET_API_PASSPHRASE: "api_passphrase_ref_missing",
  POLYMARKET_FUNDER_ADDRESS: "funder_address_ref_missing",
};

const INVALID_BINDING_REASON_BY_KEY: Record<PolymarketAuthEnvKey, string> = {
  POLYMARKET_PRIVATE_KEY: "private_key_ref_not_secret_ref",
  POLYMARKET_API_KEY: "api_key_ref_not_secret_ref",
  POLYMARKET_API_SECRET: "api_secret_ref_not_secret_ref",
  POLYMARKET_API_PASSPHRASE: "api_passphrase_ref_not_secret_ref",
  POLYMARKET_FUNDER_ADDRESS: "funder_address_ref_not_secret_ref",
};

const MISSING_SECRET_REASON_BY_KEY: Record<PolymarketAuthEnvKey, string> = {
  POLYMARKET_PRIVATE_KEY: "private_key_secret_missing",
  POLYMARKET_API_KEY: "api_key_secret_missing",
  POLYMARKET_API_SECRET: "api_secret_secret_missing",
  POLYMARKET_API_PASSPHRASE: "api_passphrase_secret_missing",
  POLYMARKET_FUNDER_ADDRESS: "funder_address_secret_missing",
};

const RESOLVE_FAILURE_REASON_BY_KEY: Record<PolymarketAuthEnvKey, string> = {
  POLYMARKET_PRIVATE_KEY: "private_key_secret_unresolved",
  POLYMARKET_API_KEY: "api_key_secret_unresolved",
  POLYMARKET_API_SECRET: "api_secret_secret_unresolved",
  POLYMARKET_API_PASSPHRASE: "api_passphrase_secret_unresolved",
  POLYMARKET_FUNDER_ADDRESS: "funder_address_secret_unresolved",
};

const INVALID_VALUE_REASON_BY_KEY: Record<PolymarketAuthEnvKey, string> = {
  POLYMARKET_PRIVATE_KEY: "private_key_invalid_format",
  POLYMARKET_API_KEY: "api_key_invalid_format",
  POLYMARKET_API_SECRET: "api_secret_invalid_format",
  POLYMARKET_API_PASSPHRASE: "api_passphrase_invalid_format",
  POLYMARKET_FUNDER_ADDRESS: "funder_address_invalid_format",
};

function isSecretRefBinding(value: unknown): value is SecretRefBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (value as { type?: unknown }).type === "secret_ref"
    && typeof (value as { secretId?: unknown }).secretId === "string";
}

function asReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function normalizePolymarketPrivateKey(value: string): string | null {
  const trimmed = value.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}`;
  return null;
}

function validateResolvedValue(key: PolymarketAuthEnvKey, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  if (key === "POLYMARKET_PRIVATE_KEY") {
    return normalizePolymarketPrivateKey(trimmed) != null;
  }
  if (key === "POLYMARKET_FUNDER_ADDRESS") {
    return isAddress(trimmed);
  }
  return true;
}

function emptyKeyStatuses(): Record<PolymarketAuthEnvKey, PolymarketCopyAuthKeyStatus> {
  return {
    POLYMARKET_PRIVATE_KEY: {
      present: false,
      bindingType: "missing",
      valid: false,
      reasonCode: MISSING_REASON_BY_KEY.POLYMARKET_PRIVATE_KEY,
    },
    POLYMARKET_API_KEY: {
      present: false,
      bindingType: "missing",
      valid: false,
      reasonCode: MISSING_REASON_BY_KEY.POLYMARKET_API_KEY,
    },
    POLYMARKET_API_SECRET: {
      present: false,
      bindingType: "missing",
      valid: false,
      reasonCode: MISSING_REASON_BY_KEY.POLYMARKET_API_SECRET,
    },
    POLYMARKET_API_PASSPHRASE: {
      present: false,
      bindingType: "missing",
      valid: false,
      reasonCode: MISSING_REASON_BY_KEY.POLYMARKET_API_PASSPHRASE,
    },
    POLYMARKET_FUNDER_ADDRESS: {
      present: false,
      bindingType: "missing",
      valid: false,
      reasonCode: MISSING_REASON_BY_KEY.POLYMARKET_FUNDER_ADDRESS,
    },
  };
}

function summarizeReadiness(result: "ready" | "incomplete", reasonCodes: string[]): string {
  if (result === "ready") {
    return "Config-only readiness is ready. Required Polymarket auth refs are present and structurally valid. No trade or live order call was executed.";
  }
  const details = reasonCodes.length > 0 ? reasonCodes.join(", ") : "missing required auth references";
  return `Config-only readiness is incomplete. ${details}. No trade or live order call was executed.`;
}

function latestValidationFromAuditRows(rows: AuditEntry[]): PolymarketCopyAuthValidationStatus {
  for (const row of rows) {
    if (row.action === "polymarket.auth_readiness.checked") {
      return {
        checkedAt: row.createdAt,
        result: (asNullableString(row.details?.result) as PolymarketAuthReadinessResult | null) ?? "incomplete",
        summary: asNullableString(row.details?.summary),
        validationMode:
          asNullableString(row.details?.validationMode) === "config_only" ? "config_only" : null,
        reasonCodes: asReasonCodes(row.details?.reasonCodes),
      };
    }
    if (row.action === "polymarket.auth_readiness.check_failed") {
      const reasonCode = asNullableString(row.details?.reasonCode);
      return {
        checkedAt: row.createdAt,
        result: "failed",
        summary: asNullableString(row.details?.summary) ?? "Auth readiness check failed.",
        validationMode:
          asNullableString(row.details?.validationMode) === "config_only" ? "config_only" : null,
        reasonCodes: reasonCode ? [reasonCode] : asReasonCodes(row.details?.reasonCodes),
      };
    }
  }

  return {
    checkedAt: null,
    result: null,
    summary: null,
    validationMode: null,
    reasonCodes: [],
  };
}

function latestDerivationFromAuditRows(rows: AuditEntry[]): PolymarketCopyAuthDerivationStatus {
  for (const row of rows) {
    if (row.action === "polymarket.auth_derivation.succeeded") {
      return {
        attemptedAt: row.createdAt,
        result: "succeeded",
        reasonCode: asNullableString(row.details?.reasonCode),
      };
    }
    if (row.action === "polymarket.auth_derivation.failed") {
      return {
        attemptedAt: row.createdAt,
        result: "failed",
        reasonCode: asNullableString(row.details?.reasonCode),
      };
    }
  }

  return {
    attemptedAt: null,
    result: null,
    reasonCode: null,
  };
}

export function buildPolymarketAuthReadiness(options: {
  runtimeConfig: Pick<PolymarketCopyRuntimeConfig, "mode" | "liveEnabled" | "tradingKillSwitch">;
  keyStatuses: Record<PolymarketAuthEnvKey, PolymarketCopyAuthKeyStatus>;
  lastValidation?: PolymarketCopyAuthValidationStatus;
  lastDerivation?: PolymarketCopyAuthDerivationStatus;
}): PolymarketCopyAuthReadiness {
  const reasonCodes = POLYMARKET_AUTH_ENV_KEYS
    .map((key) => options.keyStatuses[key].reasonCode)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  const dedupedReasonCodes = Array.from(new Set(reasonCodes));
  const authenticatedLiveReadiness = dedupedReasonCodes.length === 0 ? "ready" : "incomplete";

  return {
    validationMode: "config_only",
    paperModeActive: options.runtimeConfig.mode === "paper",
    liveEnabled: options.runtimeConfig.liveEnabled,
    tradingKillSwitch: options.runtimeConfig.tradingKillSwitch,
    authenticatedLiveReadiness,
    canDeriveApiCredentials: options.keyStatuses.POLYMARKET_PRIVATE_KEY.valid,
    keyStatuses: options.keyStatuses,
    reasonCodes: dedupedReasonCodes,
    summary: summarizeReadiness(authenticatedLiveReadiness, dedupedReasonCodes),
    lastValidation: options.lastValidation ?? {
      checkedAt: null,
      result: null,
      summary: null,
      validationMode: null,
      reasonCodes: [],
    },
    lastDerivation: options.lastDerivation ?? {
      attemptedAt: null,
      result: null,
      reasonCode: null,
    },
  };
}

export async function inspectPolymarketAuthReadiness(
  db: Db,
  companyId: string,
  runtimeConfig: PolymarketCopyRuntimeConfig,
  auditRows: AuditEntry[] = [],
): Promise<PolymarketCopyAuthReadiness> {
  const secretsSvc = secretService(db);
  const keyStatuses = emptyKeyStatuses();
  const authEnv = runtimeConfig.authEnv ?? {};

  for (const key of POLYMARKET_AUTH_ENV_KEYS) {
    const binding = authEnv[key];
    if (!binding) continue;

    if (!isSecretRefBinding(binding)) {
      keyStatuses[key] = {
        present: true,
        bindingType: "invalid",
        valid: false,
        reasonCode: INVALID_BINDING_REASON_BY_KEY[key],
      };
      continue;
    }

    keyStatuses[key] = {
      present: true,
      bindingType: "secret_ref",
      valid: false,
      reasonCode: null,
    };

    const secret = await secretsSvc.getById(binding.secretId);
    if (!secret || secret.companyId !== companyId) {
      keyStatuses[key] = {
        present: true,
        bindingType: "secret_ref",
        valid: false,
        reasonCode: MISSING_SECRET_REASON_BY_KEY[key],
      };
      continue;
    }

    try {
      const resolvedValue = await secretsSvc.resolveSecretValue(
        companyId,
        binding.secretId,
        binding.version ?? "latest",
      );
      if (!validateResolvedValue(key, resolvedValue)) {
        keyStatuses[key] = {
          present: true,
          bindingType: "secret_ref",
          valid: false,
          reasonCode: INVALID_VALUE_REASON_BY_KEY[key],
        };
        continue;
      }
      keyStatuses[key] = {
        present: true,
        bindingType: "secret_ref",
        valid: true,
        reasonCode: null,
      };
    } catch {
      keyStatuses[key] = {
        present: true,
        bindingType: "secret_ref",
        valid: false,
        reasonCode: RESOLVE_FAILURE_REASON_BY_KEY[key],
      };
    }
  }

  return buildPolymarketAuthReadiness({
    runtimeConfig,
    keyStatuses,
    lastValidation: latestValidationFromAuditRows(auditRows),
    lastDerivation: latestDerivationFromAuditRows(auditRows),
  });
}
