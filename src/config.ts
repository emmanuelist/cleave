/**
 * Verified against @somnia-chain/markets-sdk 0.27.0 and the DreamDEX Bot Kit
 * (packages/ec-core/src/config.ts) on 2026-08-19. Every value here was read off
 * a real source, not inferred.
 */
import { defineChain } from "viem";
import { SOMNIA_TESTNET_ADDRESSES, SOMNIA_MAINNET_ADDRESSES } from "@somnia-chain/markets-sdk";

export type Network = "testnet" | "mainnet";

/** Public endpoints per network. RPC/WS are stable; the indexer URL moves. */
const ENDPOINTS: Record<Network, { rpc: string; ws: string; indexer: string; chainId: number; explorer: string }> = {
  testnet: {
    rpc: "https://api.infra.testnet.somnia.network",
    ws: "wss://api.infra.testnet.somnia.network/ws",
    indexer: "https://dev.smk.somnia.host/v1/graphql",
    chainId: 50312,
    explorer: "https://shannon-explorer.somnia.network",
  },
  mainnet: {
    rpc: "https://api.infra.mainnet.somnia.network",
    ws: "wss://api.infra.mainnet.somnia.network/ws",
    indexer: "https://prd.smk.somnia.host/v1/graphql",
    chainId: 5031,
    explorer: "https://explorer.somnia.network",
  },
};

/**
 * Last-known venue ids. Deliberately NOT the source of truth — preflight reads
 * live venue ids off market rows. Kept only so an error message can say
 * "you asked for X, the chain is serving Y".
 */
export const KNOWN_VENUE_IDS: Record<Network, string> = {
  testnet: "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c",
  mainnet: "0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d",
};

/**
 * Protocol addresses, shipped baked-in by the SDK. These are NOT optional in
 * practice: without `binaryModule`, `getMarketOnchain` throws
 * "v2 resolves markets by marketId through the module" and every write that
 * gates on live status is blind. Verified by preflight on 2026-08-19.
 */
const ADDRESSES: Record<Network, unknown> = {
  testnet: SOMNIA_TESTNET_ADDRESSES,
  mainnet: SOMNIA_MAINNET_ADDRESSES,
};

export function loadConfig() {
  const network = (process.env.NETWORK ?? "testnet").toLowerCase() as Network;
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`Invalid NETWORK="${network}". Use "testnet" or "mainnet".`);
  }
  const ep = ENDPOINTS[network];
  const rpcUrl = process.env.RPC_URL ?? ep.rpc;
  const wsRpcUrl = process.env.WS_RPC_URL ?? ep.ws;

  const chain = defineChain({
    id: ep.chainId,
    name: network === "testnet" ? "Somnia Shannon" : "Somnia",
    nativeCurrency: { name: network === "testnet" ? "STT" : "SOMI", symbol: network === "testnet" ? "STT" : "SOMI", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl], webSocket: [wsRpcUrl] } },
  });

  return {
    network,
    chain,
    rpcUrl,
    wsRpcUrl,
    indexerUrl: process.env.INDEXER_URL ?? ep.indexer,
    addresses: ADDRESSES[network] as Parameters<typeof Object>[0],
    explorer: ep.explorer,
    venueId: process.env.VENUE_ID?.trim() || undefined,
    privateKey: process.env.PRIVATE_KEY?.trim() || undefined,
    dryRun: (process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
  };
}
