import { describe, expect, it } from "vitest";
import { patchPolymarketCopyRuntimeConfigSchema } from "@paperclipai/shared/validators/polymarket-copy";

describe("polymarket runtime auth config", () => {
  it("accepts supported auth env secret refs and keeps runtime guard flags separate", () => {
    const parsed = patchPolymarketCopyRuntimeConfigSchema.parse({
      mode: "paper",
      liveEnabled: false,
      tradingKillSwitch: true,
      authEnv: {
        POLYMARKET_PRIVATE_KEY: {
          type: "secret_ref",
          secretId: "11111111-1111-4111-8111-111111111111",
        },
        POLYMARKET_FUNDER_ADDRESS: {
          type: "secret_ref",
          secretId: "22222222-2222-4222-8222-222222222222",
        },
      },
    });

    expect(parsed.mode).toBe("paper");
    expect(parsed.liveEnabled).toBe(false);
    expect(parsed.tradingKillSwitch).toBe(true);
    expect(Object.keys(parsed.authEnv ?? {})).toEqual([
      "POLYMARKET_PRIVATE_KEY",
      "POLYMARKET_FUNDER_ADDRESS",
    ]);
  });

  it("rejects unsupported auth env keys", () => {
    const result = patchPolymarketCopyRuntimeConfigSchema.safeParse({
      authEnv: {
        OPENAI_API_KEY: {
          type: "secret_ref",
          secretId: "11111111-1111-4111-8111-111111111111",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects plaintext auth values so Polymarket follows the Paperclip secret ref pattern", () => {
    const result = patchPolymarketCopyRuntimeConfigSchema.safeParse({
      authEnv: {
        POLYMARKET_API_KEY: {
          type: "plain",
          value: "not-allowed",
        },
      },
    });

    expect(result.success).toBe(false);
  });
});
