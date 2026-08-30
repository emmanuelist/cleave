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
  SomniaMarkets, isBinaryMarket, claimableFrom, outcomeId, erc6909Abi,
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
  // listPastBinaryMarkets is not exported at the package root, but loadMarkets
  // already returns every indexed market - the overwhelming majority of which
  // are settled. Settled markets leave the LIVE list, not the registry.
  const all = Object.values(await exchange.loadMarkets(true));
  const past = all
    .filter((m) => isBinaryMarket(m.info) && !m.active)
    .map((m) => m.info as unknown as {
      marketId: `0x${string}`; poolAddress: `0x${string}`; nonce?: string | number;
      status: string; winningOutcome?: number | null; settlementFeeBps?: string | number;
    })
    .slice(0, SCAN);
  line(`scanned    ${past.length} settled markets (of ${all.length} indexed)`);

  const inputs: ClaimableInput[] = [];

  for (const m of past) {
    const pool = m.poolAddress;
    const nonce = BigInt(m.nonce ?? 0);
    for (const idx of [0, 1] as const) {
      const id = outcomeId(pool, nonce, idx);
      let bal = 0n;
      try {
        bal = await pub.readContract({
          address: pool, abi: erc6909Abi, functionName: "balanceOf",
          args: [account.address, id],
        }) as bigint;
      } catch { continue; }
      if (bal <= 0n) continue;
      inputs.push({
        marketId: m.marketId, pool, outcomeIdx: idx, amount: bal,
        winningOutcome: m.winningOutcome ?? null,
        voided: String(m.status) === "Voided",
        status: String(m.status),
        settlementFeeBps: BigInt(m.settlementFeeBps ?? 0),
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
    line(`  ${JSON.stringify(c).slice(0, 130)}`);
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
