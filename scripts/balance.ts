/**
 * Read-only balance check. No signing, no side effects — safe to spam while
 * waiting on a faucet. Pass --watch to poll every 15s until gas arrives.
 */
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const watch = process.argv.includes("--watch");

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env — run `npm run newkey` first.");
  const address = privateKeyToAccount(cfg.privateKey as `0x${string}`).address;
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const collateral = (cfg.addresses as { collateral: `0x${string}` }).collateral;
  const decimals = await pub.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals" });

  // Enough to broadcast the faucet call. ~1.38M gas estimate, capped at +30%
  // = 1.79M, times the SDK's fixed ~60 gwei bid (10x the 6 gwei base fee).
  // The node reserves the full gasLimit x maxFeePerGas whatever the tx burns.
  const NEEDED_WEI = 120_000_000_000_000_000n; // 0.12 STT

  for (;;) {
    const [stt, tusdc] = await Promise.all([
      pub.getBalance({ address }),
      pub.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    ]);
    const ok = stt >= NEEDED_WEI;
    const stamp = new Date().toTimeString().slice(0, 8);
    console.log(
      `${watch ? stamp + "  " : ""}${address}\n` +
      `  STT    ${formatEther(stt).padEnd(14)} ${ok ? "\x1b[32menough to fund\x1b[0m" : `\x1b[33mneed ${formatEther(NEEDED_WEI - stt)} more\x1b[0m`}\n` +
      `  tUSDC  ${formatUnits(tusdc, decimals)}`
    );
    if (!watch) return;
    if (ok && tusdc === 0n) { console.log("\n\x1b[32mGas has landed. Run: npm run fund\x1b[0m"); return; }
    if (ok && tusdc > 0n) { console.log("\n\x1b[32mFully funded.\x1b[0m"); return; }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
