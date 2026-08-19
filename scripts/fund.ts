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

/** faucet() selector + the default 10,000e6 amount, for gas estimation. */
const FAUCET_CALLDATA = `0x57915897${"00".repeat(28)}02540be400` as `0x${string}`;

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

  // ── Gas affordability, checked BEFORE broadcasting ────────────────────────
  // The node reserves gasLimit x maxFeePerGas up front, regardless of what the
  // tx actually burns. The SDK defaults to a 10,000,000 ceiling and bids well
  // over base fee, so it reserves ~0.6 STT for a call that costs ~0.008. We
  // estimate, add headroom, and say plainly what is missing.
  const gasPrice = await pub.getGasPrice();
  let gasEstimate: bigint;
  try {
    gasEstimate = await pub.estimateGas({ account: account.address, to: collateral, data: FAUCET_CALLDATA });
  } catch {
    gasEstimate = 1_500_000n; // observed ~1.38M on 2026-08-19
  }
  const gasLimit = (gasEstimate * 130n) / 100n;          // 30% headroom
  const reserve = gasLimit * gasPrice * 2n;              // node bids over base fee
  line(`gas est     ${gasEstimate} units @ ${Number(gasPrice) / 1e9} gwei`);
  line(`reserve     ${formatEther(reserve)} STT needed to broadcast`);

  if (stt < reserve) {
    const short = reserve - stt;
    line();
    line(`\x1b[31mNot enough STT. Short by ${formatEther(short)} STT.\x1b[0m`);
    line(`You can afford ${stt / gasPrice} gas units; this call needs ~${gasEstimate}.`);
    line();
    line("Top up the same address, then run this again:");
    line(`  ${account.address}`);
    line();
    line("Stakely dispenses only 0.001 STT, which is not enough for one call.");
    line("Ask in the hackathon Telegram, or the Somnia Discord #dev-chat.");
    line("Aim for at least 1 STT — a maker loop signs constantly.");
    process.exit(1);
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
  const res = await exchange.trader.faucet({ gas: gasLimit });
  line(`  tx ${(res as { hash?: string }).hash ?? JSON.stringify(res).slice(0, 80)}`);
  line(`  ${cfg.explorer}/tx/${(res as { hash?: string }).hash ?? ""}`);

  const after = await read();
  line();
  line(`tUSDC       ${formatUnits(after, decimals)}`);
  line("\x1b[32mFunded. Ready to trade.\x1b[0m");
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31mfund failed\x1b[0m\n", e); process.exit(1); });
