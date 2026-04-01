import type {
  PolymarketCopyAuthReadiness,
  PolymarketCopyRuntimeConfig,
} from "@paperclipai/shared";

export function evaluatePolymarketLiveDispatch(options: {
  config: Pick<PolymarketCopyRuntimeConfig, "mode" | "liveEnabled" | "tradingKillSwitch">;
  authReadiness?: Pick<PolymarketCopyAuthReadiness, "authenticatedLiveReadiness" | "reasonCodes" | "validationMode"> | null;
}): { status: "blocked" | "not_implemented"; reasonCode: string; details?: Record<string, unknown> } | null {
  const { config, authReadiness } = options;

  if (config.mode !== "live") return null;
  if (!config.liveEnabled) {
    return { status: "blocked", reasonCode: "live_disabled" };
  }
  if (config.tradingKillSwitch) {
    return { status: "blocked", reasonCode: "trading_kill_switch_active" };
  }
  if (!authReadiness || authReadiness.authenticatedLiveReadiness !== "ready") {
    return {
      status: "blocked",
      reasonCode: "auth_readiness_incomplete",
      details: {
        validationMode: authReadiness?.validationMode ?? "config_only",
        reasonCodes: authReadiness?.reasonCodes ?? [],
      },
    };
  }
  return {
    status: "not_implemented",
    reasonCode: "live_execution_not_implemented_v0",
    details: {
      validationMode: authReadiness.validationMode,
    },
  };
}
