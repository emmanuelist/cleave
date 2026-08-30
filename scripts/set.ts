/**
 * Complete-set round trip: 1 tUSDC -> 1 Up + 1 Down -> 1 tUSDC.
 *
 * This is the mechanic the whole product is named for, and it needs no
 * counterparty, so it is verifiable on demand. It also unlocks the ask side:
 * selling Up failed with InsufficientBalance because we owned no Up. Minting a
 * set is how a maker legitimately acquires sell-side inventory while staying
 * delta-neutral (a complete set is worth exactly 1 regardless of outcome).
 *
 *   npm run set              # dry run
 *   npm run set -- --live
 */
import { SomniaMarkets, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const live = process.argv.includes("--live");
const AMOUNT = 1_000_000n;               // 1 tUSDC, 6 decimals
const line = (s = "") => console.log(s);

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env.");
  const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
  const collateral = (cfg.addresses as { collateral: `0x${string}` }).collateral;

  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl, chain: cfg.chain, wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses, privateKey: cfg.privateKey as `0x${string}`,
  });

  const all = Object.values(await exchange.loadMarkets(true));
  let target: { pool: `0x${string}`; sym: string; up: string; down: string; expiry: number } | undefined;
  for (const m of all) {
    if (!isBinaryMarket(m.info) || !m.active) continue;
    const i = m.info as { marketId: string; poolAddress: `0x${string}`; expiry?: string };
    try {
      if ((await exchange.client.getMarketOnchain(i.marketId as `0x${string}`)).status !== 1) continue;
      const expiry = Number(i.expiry ?? 0);
      const up = m.outcomes?.[0]?.symbol, down = m.outcomes?.[1]?.symbol;
      if (!up || !down) continue;
      if (!target || expiry > target.expiry) target = { pool: i.poolAddress, sym: m.symbol, up, down, expiry };
    } catch { /* skip */ }
  }
  if (!target) { line("No tradable market."); return; }

  const bal = () => pub.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  // Unified positions: the root export. getOutcomeBalances lives in
  // binary/portfolio, which the package's exports map does not expose.
  const outcomes = async () => {
    const p = await exchange.fetchPositions([target!.up, target!.down]).catch(() => []);
    return p.length ? p.map((x) => `${x.symbol ?? "?"}=${x.contracts ?? 0}`).join(" ") : "none";
  };

  line();
  line(`\x1b[1mComplete-set round trip — ${live ? "LIVE" : "dry run"}\x1b[0m`);
  line("─".repeat(62));
  line(`market    ${target.sym}`);
  line(`pool      ${target.pool}`);
  line(`amount    ${formatUnits(AMOUNT, 6)} tUSDC`);

  const before = await bal();
  line(`collateral before  ${formatUnits(before, 6)}`);
  line(`outcomes   before  ${JSON.stringify(await outcomes())}`);

  if (!live) { line("\nDry run — nothing signed."); return; }

  line();
  line("mintSet: collateral -> Up + Down ...");
  const mint = await exchange.trader.mintSet({ pool: target.pool, amount: AMOUNT });
  line(`  tx ${mint.hash}`);
  const midC = await bal();
  line(`  collateral ${formatUnits(before, 6)} -> ${formatUnits(midC, 6)}  (${formatUnits(before - midC, 6)} spent)`);
  line(`  outcomes   ${JSON.stringify(await outcomes())}`);

  line();
  line("burnSet: Up + Down -> collateral ...");
  const burn = await exchange.trader.burnSet({ pool: target.pool, amount: AMOUNT });
  line(`  tx ${burn.hash}`);
  const after = await bal();
  line(`  collateral ${formatUnits(midC, 6)} -> ${formatUnits(after, 6)}  (${formatUnits(after - midC, 6)} returned)`);
  line(`  outcomes   ${JSON.stringify(await outcomes())}`);

  line();
  const net = after - before;
  line(net === 0n
    ? "\x1b[32mRound trip exact. 1 tUSDC <-> 1 Up + 1 Down, no leakage.\x1b[0m"
    : `\x1b[33mNet change ${formatUnits(net, 6)} tUSDC — a fee or rounding sits in the cycle.\x1b[0m`);
  await exchange.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31mset failed\x1b[0m\n", e?.errorName ?? e?.message ?? e); process.exit(1); });
