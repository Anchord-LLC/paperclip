import { describe, expect, it } from "vitest";
import type { PolymarketAuthEnvKey, PolymarketCopyAuthKeyStatus } from "@paperclipai/shared";
import { buildPolymarketAuthReadiness } from "../services/polymarket/auth-readiness.ts";
import { evaluatePolymarketLiveDispatch } from "../services/polymarket/live-guards.ts";

function makeKeyStatuses(
  overrides: Partial<Record<PolymarketAuthEnvKey, Partial<PolymarketCopyAuthKeyStatus>>> = {},
): Record<PolymarketAuthEnvKey, PolymarketCopyAuthKeyStatus> {
  const keys: PolymarketAuthEnvKey[] = [
    "POLYMARKET_PRIVATE_KEY",
    "POLYMARKET_API_KEY",
    "POLYMARKET_API_SECRET",
    "POLYMARKET_API_PASSPHRASE",
    "POLYMARKET_FUNDER_ADDRESS",
  ];

  return keys.reduce<Record<PolymarketAuthEnvKey, PolymarketCopyAuthKeyStatus>>((acc, key) => {
    acc[key] = {
      present: false,
      bindingType: "missing",
      valid: false,
      reasonCode: `${key.toLowerCase()}_missing`,
      ...overrides[key],
    };
    return acc;
  }, {} as Record<PolymarketAuthEnvKey, PolymarketCopyAuthKeyStatus>);
}

describe("polymarket auth readiness", () => {
  it("stays incomplete in paper mode with zero auth secrets while leaving paper mode usable", () => {
    const readiness = buildPolymarketAuthReadiness({
      runtimeConfig: {
        mode: "paper",
        liveEnabled: false,
        tradingKillSwitch: true,
      },
      keyStatuses: makeKeyStatuses(),
    });

    expect(readiness.paperModeActive).toBe(true);
    expect(readiness.authenticatedLiveReadiness).toBe("incomplete");
    expect(readiness.canDeriveApiCredentials).toBe(false);
    expect(readiness.reasonCodes.length).toBeGreaterThan(0);
  });

  it("stays incomplete when only part of the auth bundle is wired", () => {
    const readiness = buildPolymarketAuthReadiness({
      runtimeConfig: {
        mode: "paper",
        liveEnabled: false,
        tradingKillSwitch: true,
      },
      keyStatuses: makeKeyStatuses({
        POLYMARKET_PRIVATE_KEY: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
      }),
    });

    expect(readiness.canDeriveApiCredentials).toBe(true);
    expect(readiness.authenticatedLiveReadiness).toBe("incomplete");
    expect(readiness.reasonCodes).toContain("polymarket_api_key_missing");
  });

  it("becomes ready only when the full auth bundle is present and structurally valid", () => {
    const readiness = buildPolymarketAuthReadiness({
      runtimeConfig: {
        mode: "paper",
        liveEnabled: false,
        tradingKillSwitch: true,
      },
      keyStatuses: makeKeyStatuses({
        POLYMARKET_PRIVATE_KEY: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_API_KEY: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_API_SECRET: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_API_PASSPHRASE: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_FUNDER_ADDRESS: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
      }),
    });

    expect(readiness.authenticatedLiveReadiness).toBe("ready");
    expect(readiness.reasonCodes).toEqual([]);
  });

  it("does not activate live dispatch just because auth exists", () => {
    const readiness = buildPolymarketAuthReadiness({
      runtimeConfig: {
        mode: "paper",
        liveEnabled: false,
        tradingKillSwitch: true,
      },
      keyStatuses: makeKeyStatuses({
        POLYMARKET_PRIVATE_KEY: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_API_KEY: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_API_SECRET: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_API_PASSPHRASE: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
        POLYMARKET_FUNDER_ADDRESS: {
          present: true,
          bindingType: "secret_ref",
          valid: true,
          reasonCode: null,
        },
      }),
    });

    expect(evaluatePolymarketLiveDispatch({
      config: {
        mode: "paper",
        liveEnabled: false,
        tradingKillSwitch: true,
      },
      authReadiness: readiness,
    })).toBeNull();

    expect(evaluatePolymarketLiveDispatch({
      config: {
        mode: "live",
        liveEnabled: false,
        tradingKillSwitch: false,
      },
      authReadiness: readiness,
    })).toEqual({
      status: "blocked",
      reasonCode: "live_disabled",
    });
  });
});
