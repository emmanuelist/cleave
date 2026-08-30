/**
 * Post a maker quote inside the spread — Cleave's signature action.
 *
 * Post-only ("PO"), so it never crosses: if it would take, the venue rejects it
 * instead of filling. That is the whole point — we are supplying liquidity, not
 * consuming it, and we hold no inventory behind either leg.
 *
 * Dry run by default. Pass --live to actually sign.
 *   npm run quote            # show what it would post
 *   npm run quote -- --live  # post it
 */
import { SomniaMarkets, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const live = process.argv.includes("--live");
const SIZE = Number(process.env.QUOTE_SIZE ?? 5);
const line = (s = "") => console.log(s);

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env.");
  const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });

  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl,
    chain: cfg.chain,
    wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses,
    privateKey: cfg.privateKey as `0x${string}`,
  });

  const all = Object.values(await exchange.loadMarkets(true));
  const candidates = all.filter((m) => isBinaryMarket(m.info) && m.active);

  // Pick the widest two-sided book that is genuinely Trading on-chain.
  let best: { m: (typeof candidates)[number]; sym: string; bid: number; ask: number } | undefined;
  for (const m of candidates) {
    const sym = m.outcomes?.[0]?.symbol;
    if (!sym) continue;
    const marketId = (m.info as { marketId: string }).marketId;
    try {
      if ((await exchange.client.getMarketOnchain(marketId as `0x${string}`)).status !== 1) continue;
      const b = await exchange.fetchOrderBook(sym, 5);
      const bid = b.bids[0]?.[0], ask = b.asks[0]?.[0];
      if (bid === undefined || ask === undefined) continue;
      if (!best || ask - bid > best.ask - best.bid) best = { m, sym, bid, ask };
    } catch { /* market unreadable; skip */ }
  }
  if (!best) { line("No tradable two-sided market right now."); return; }

  // ── Re-read the book immediately before pricing ───────────────────────────
  // The scan above does an on-chain status check per market and takes tens of
  // seconds. Somnia has sub-second finality, so the book we selected on is
  // already stale. Pricing off it is how you get PostOnlyWouldCross().
  const fresh = await exchange.fetchOrderBook(best.sym, 5);
  const bid = fresh.bids[0]?.[0], ask = fresh.asks[0]?.[0];
  if (bid === undefined || ask === undefined) { line("Book went one-sided while scanning."); return; }
  const drift = Math.abs(bid - best.bid) + Math.abs(ask - best.ask);

  const TICK = 0.001;
  const spread = ask - bid;

  line();
  line(`\x1b[1mMaker quote — ${live ? "LIVE" : "dry run"}\x1b[0m`);
  line("─".repeat(58));
  line(`market    ${best.sym}`);
  line(`at scan   bid ${best.bid.toFixed(3)}  ask ${best.ask.toFixed(3)}`);
  line(`now       bid ${bid.toFixed(3)}  ask ${ask.toFixed(3)}  spread ${(spread * 100).toFixed(2)}pp`);
  if (drift > 0) line(`\x1b[33m          book drifted ${(drift * 100).toFixed(1)}pp during the scan\x1b[0m`);

  const stt = await pub.getBalance({ address: account.address });
  line(`gas       ${formatEther(stt)} STT available`);

  if (spread <= TICK) { line("\nSpread is one tick or less — nothing to post inside."); return; }

  if (!live) {
    line(`post      buy ${SIZE} @ ${(bid + TICK).toFixed(3)}  (post-only, one tick inside)`);
    line();
    line("Dry run — nothing signed. Re-run with --live to post it.");
    return;
  }

  // ── Post, backing off if the book moves under us ──────────────────────────
  // PostOnlyWouldCross means the ask fell to or below our bid between read and
  // write. Re-read and step back down; a maker that cannot lose this race is a
  // maker that never posts.
  let placed: Awaited<ReturnType<typeof exchange.createOrder>> | undefined;
  let price = Number((bid + TICK).toFixed(3));
  for (let attempt = 1; attempt <= 3; attempt++) {
    line();
    line(`Posting  buy ${SIZE} @ ${price.toFixed(3)}  (attempt ${attempt}/3)`);
    try {
      placed = await exchange.createOrder(best.sym, "limit", "buy", SIZE, price, { timeInForce: "PO" });
      break;
    } catch (err) {
      const name = (err as { errorName?: string }).errorName;
      if (name !== "PostOnlyWouldCross" || attempt === 3) throw err;
      const again = await exchange.fetchOrderBook(best.sym, 5);
      const nb = again.bids[0]?.[0], na = again.asks[0]?.[0];
      line(`  \x1b[33mwould cross — book is now bid ${nb?.toFixed(3) ?? "—"} ask ${na?.toFixed(3) ?? "—"}\x1b[0m`);
      if (na === undefined) throw err;
      price = Number((na - TICK).toFixed(3));   // sit just under the live ask
    }
  }
  if (!placed) return;

  const info = placed.info as { receipt?: { transactionHash?: string } };
  const hash = info?.receipt?.transactionHash;
  line(`  id     ${placed.id ?? "(none)"}`);
  line(`  status ${placed.status ?? "(none)"}`);
  if (hash) {
    line(`  tx     ${hash}`);
    line(`  ${cfg.explorer}/tx/${hash}`);
  }

  // Did it actually land at the top of the book?
  const after = await exchange.fetchOrderBook(best.sym, 5);
  line();
  line(`book now  bid ${after.bids[0]?.[0]?.toFixed(3) ?? "—"}  ask ${after.asks[0]?.[0]?.toFixed(3) ?? "—"}`);
  const onTop = after.bids[0]?.[0] === price;
  line(onTop
    ? "\x1b[32mResting at the top of the book. We are the best bid.\x1b[0m"
    : "\x1b[33mNot top of book — someone is inside us, or the post was rejected.\x1b[0m");
}

main()
  .then(async () => process.exit(0))
  .catch((e) => { console.error("\n\x1b[31mquote failed\x1b[0m\n", e); process.exit(1); });
