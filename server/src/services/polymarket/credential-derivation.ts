import type { ApiKeyCreds } from "@polymarket/clob-client";
import { ClobClient } from "@polymarket/clob-client";
import { createWalletClient, http, type Hex } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { normalizePolymarketPrivateKey } from "./auth-readiness.js";

export interface PolymarketDerivedApiCredentials {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  funderAddress: string;
}

type DeriveClientFactory = (options: {
  host: string;
  privateKey: string;
}) => Promise<PolymarketDerivedApiCredentials>;

async function defaultDeriveClientFactory(options: {
  host: string;
  privateKey: string;
}): Promise<PolymarketDerivedApiCredentials> {
  const normalizedPrivateKey = normalizePolymarketPrivateKey(options.privateKey);
  if (!normalizedPrivateKey) {
    throw new Error("Invalid Polymarket private key format");
  }

  const account = privateKeyToAccount(normalizedPrivateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const client = new ClobClient(options.host, 137, walletClient);
  const creds: ApiKeyCreds = await client.createOrDeriveApiKey();

  return {
    apiKey: creds.key,
    apiSecret: creds.secret,
    apiPassphrase: creds.passphrase,
    funderAddress: account.address,
  };
}

export async function derivePolymarketApiCredentialsFromPrivateKey(options: {
  privateKey: string;
  host?: string;
  deriveClientFactory?: DeriveClientFactory;
}): Promise<PolymarketDerivedApiCredentials> {
  const host = options.host ?? process.env.POLYMARKET_CLOB_BASE_URL ?? "https://clob.polymarket.com";
  const deriveClientFactory = options.deriveClientFactory ?? defaultDeriveClientFactory;
  return deriveClientFactory({
    host,
    privateKey: options.privateKey,
  });
}
