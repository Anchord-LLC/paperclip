import { describe, expect, it, vi } from "vitest";
import { derivePolymarketApiCredentialsFromPrivateKey } from "../services/polymarket/credential-derivation.ts";

describe("polymarket credential derivation", () => {
  it("derives API credentials through the official client workflow without printing them", async () => {
    const deriveClientFactory = vi.fn(async ({ host, privateKey }: { host: string; privateKey: string }) => {
      expect(host).toBe("https://clob.polymarket.com");
      expect(privateKey).toBe("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      return {
        apiKey: "derived-api-key",
        apiSecret: "derived-api-secret",
        apiPassphrase: "derived-api-passphrase",
        funderAddress: "0x1234567890abcdef1234567890abcdef12345678",
      };
    });

    const result = await derivePolymarketApiCredentialsFromPrivateKey({
      privateKey: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      deriveClientFactory,
    });

    expect(result).toEqual({
      apiKey: "derived-api-key",
      apiSecret: "derived-api-secret",
      apiPassphrase: "derived-api-passphrase",
      funderAddress: "0x1234567890abcdef1234567890abcdef12345678",
    });
    expect(deriveClientFactory).toHaveBeenCalledTimes(1);
  });

  it("fails fast on an invalid private key before any networked derivation attempt", async () => {
    await expect(derivePolymarketApiCredentialsFromPrivateKey({
      privateKey: "not-a-private-key",
    })).rejects.toThrow("Invalid Polymarket private key format");
  });
});
