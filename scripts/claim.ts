/**
 * Claim settled winnings.
 *
 * "Winnings are claimed, not received." A settled market pays out only when
 * someone asks it to; positions do not decay into collateral on their own. A
 * bot that trades for a week without redeeming has its balance stranded across
 * dozens of finalised markets while its wallet reads near zero.
 *
 * Settled markets also LEAVE the live list, so this scans recently PAST markets
 * rather than active ones.
 *
 *   npm run claim              # show what is claimable
 *   npm run claim -- --live    # redeem it
 */
import {
  SomniaMarkets, isBinaryMarket, claimableFrom, erc6909Abi,
  type ClaimableInput,
} from "@somnia-chain/markets-sdk";
import { createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const live = process.argv.includes("--live");
const SCAN = Number(process.env.CLAIM_SCAN ?? 25);
const line = (s = "") => console.log(s);

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env.");
  const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });

  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl, chain: cfg.chain, wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses, privateKey: cfg.privateKey as `0x${string}`,
  });

  line();
  line(`\x1b[1mClaim sweep — ${live ? "LIVE" : "dry run"}\x1b[0m`);
  line("─".repeat(70));
  // listPastBinaryMarkets is not exported at the package ROOT, but it lives on
  // the client. This matters: a settled market leaves loadMarkets entirely
  // (pools are recycled to the next market by nonce), so scanning loadMarkets
  // for inactive rows will never find the position you are trying to redeem.
  const past = await exchange.client.listPastBinaryMarkets({ limit: SCAN });
  line(`scanned    ${past.length} past markets`);

  const inputs: ClaimableInput[] = [];

  // Outcome tokens live on a shared ERC-6909 SINGLETON, not on the pool.
  // getMarketOnchain hands back that address plus the market's yesId/noId, so
  // there is no need to derive ids — and reading balanceOf on the pool (the
  // obvious guess) simply reverts.
  for (const m of past) {
    let oc: { outcomeToken: `0x${string}`; yesId: bigint; noId: bigint };
    try {
      oc = await exchange.client.getMarketOnchain(m.marketId as `0x${string}`) as typeof oc;
    } catch { continue; }
    for (const idx of [0, 1] as const) {
      let bal = 0n;
      try {
        bal = await pub.readContract({
          address: oc.outcomeToken, abi: erc6909Abi, functionName: "balanceOf",
          args: [account.address, idx === 0 ? oc.yesId : oc.noId],
        }) as bigint;
      } catch { continue; }
      if (bal <= 0n) continue;
      inputs.push({
        marketId: m.marketId, pool: m.poolAddress, outcomeIdx: idx, amount: bal,
        winningOutcome: m.winningOutcome ?? null,
        voided: String(m.status) === "Voided",
        status: String(m.status),
        settlementFeeBps: BigInt((m as unknown as { settlementFeeBps?: string | number | null }).settlementFeeBps ?? 0),
      });
    }
  }

  line(`holdings   ${inputs.length} outcome position(s) across settled markets`);
  for (const i of inputs) {
    line(`  ${i.marketId.slice(0, 14)}…  ${i.outcomeIdx === 0 ? "Up  " : "Down"}  ${formatUnits(i.amount, 6)}  status=${i.status} winner=${i.winningOutcome ?? "?"}`);
  }
  if (!inputs.length) { line("\nNothing held in settled markets."); await exchange.close(); return; }

  const claimable = claimableFrom(inputs);
  line();
  line(`claimable  ${claimable.length} position(s)`);
  let total = 0n;
  for (const c of claimable) {
    const amt = (c as unknown as { amount?: bigint; claimable?: bigint }).claimable
             ?? (c as unknown as { amount?: bigint }).amount ?? 0n;
    total += amt;
    const j = JSON.stringify(c, (_k, v) => (typeof v === "bigint" ? `${v}` : v));
    line(`  ${j.slice(0, 150)}`);
  }
  line(`total      ${formatUnits(total, 6)} tUSDC`);

  if (!live) { line("\nDry run — nothing signed."); await exchange.close(); return; }
  if (!claimable.length) { line("\nNothing to redeem."); await exchange.close(); return; }

  line();
  line("redeemMany...");
  const entries = claimable.map((c) => {
    const x = c as unknown as { marketId: `0x${string}`; outcomeIdx: 0 | 1; amount?: bigint; claimable?: bigint };
    return { marketId: x.marketId, outcomeIdx: x.outcomeIdx, amount: x.claimable ?? x.amount ?? 0n };
  }).filter((e) => e.amount > 0n);
  const res = await exchange.trader.redeemMany({ entries });
  line(`  tx ${res.hash}`);
  line(`  ${cfg.explorer}/tx/${res.hash}`);
  await exchange.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31mclaim failed\x1b[0m\n", e?.errorName ?? e?.message ?? e); process.exit(1); });
