/**
 * Funding check + tUSDC faucet.
 *
 * Gas (STT) must come from an external faucet — we cannot mint it. Collateral
 * (tUSDC) the SDK mints to the signer itself, 10,000 by default. So the order is
 * always: get STT by hand, then run this.
 */
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const line = (s = "") => console.log(s);

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env — run `npm run newkey` first.");
  const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });

  line();
  line(`\x1b[1mFunding — ${account.address}\x1b[0m`);
  line("─".repeat(60));

  const stt = await pub.getBalance({ address: account.address });
  line(`STT (gas)   ${formatEther(stt)}`);

  if (stt === 0n) {
    line();
    line("\x1b[33mNo STT. Nothing can be signed without gas.\x1b[0m");
    line("Get some from a captcha-only faucet (NOT the Google Cloud one — it gates");
    line("on holding 0.001 ETH on Ethereum mainnet):");
    line("  https://stakely.io/faucet/somnia-testnet-stt");
    line("  https://faucet.trade/somnia-shannon-stt-faucet");
    line("  or ask in the hackathon Telegram.");
    line();
    line(`Fund ${account.address}, then run this again.`);
    process.exit(1);
  }

  const collateral = (cfg.addresses as { collateral: `0x${string}` }).collateral;
  const read = async () =>
    pub.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const decimals = await pub.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" });

  const before = await read();
  line(`tUSDC       ${formatUnits(before, decimals)}   (${collateral})`);

  if (before > 0n) {
    line();
    line("\x1b[32mAlready funded. Ready to trade.\x1b[0m");
    return;
  }

  line();
  line("Minting tUSDC from the SDK faucet...");
  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl,
    chain: cfg.chain,
    wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses,
    privateKey: cfg.privateKey as `0x${string}`,
  });
  const res = await exchange.trader.faucet();
  line(`  tx ${(res as { hash?: string }).hash ?? JSON.stringify(res).slice(0, 80)}`);
  line(`  ${cfg.explorer}/tx/${(res as { hash?: string }).hash ?? ""}`);

  const after = await read();
  line();
  line(`tUSDC       ${formatUnits(after, decimals)}`);
  line("\x1b[32mFunded. Ready to trade.\x1b[0m");
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31mfund failed\x1b[0m\n", e); process.exit(1); });
