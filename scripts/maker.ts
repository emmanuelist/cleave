/**
 * Cleave — the maker loop.
 *
 * Two BIDS, never a sell: buy Up at p, buy Down at q, with p + q < 1.
 *
 * Selling Up requires owning Up (the venue rejects it with InsufficientBalance).
 * But BUYING both outcomes needs only collateral, and a filled pair is a
 * complete set that redeems for exactly 1. So the maker never holds inventory
 * and never carries directional risk - it offers to buy the whole market for
 * less than the whole market is worth, and the pool mints the pair on cross.
 *
 * Edge per filled pair = 1 - (p + q), which is the spread.
 *
 *   npm run maker                 # dry run, prints what it would quote
 *   npm run maker -- --live       # quote for real
 *   npm run maker -- --live --minutes 10
 */
import { SomniaMarkets, isBinaryMarket, type UnifiedOrder } from "@somnia-chain/markets-sdk";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const live = process.argv.includes("--live");
const MINUTES = Number(process.argv[process.argv.indexOf("--minutes") + 1]) || 5;
const SIZE = Number(process.env.QUOTE_SIZE ?? 5);
const TICK = 0.001;
const EDGE = 1;        // how many ticks inside the touch we sit
const DRIFT = 3;       // reprice once our quote is this many ticks off target
const INTERVAL_MS = 6_000;

const t = () => new Date().toTimeString().slice(0, 8);
const line = (s = "") => console.log(s);
const px = (n?: number) => (n === undefined ? "  —  " : n.toFixed(3));

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env.");

  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl,
    chain: cfg.chain,
    wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses,
    privateKey: cfg.privateKey as `0x${string}`,
  });

  // ── Select once, at startup ───────────────────────────────────────────────
  // The on-chain status check costs seconds per market, far longer than the book
  // stays coherent, so selection must never share a read with pricing.
  line(`${t()}  selecting market...`);
  const all = Object.values(await exchange.loadMarkets(true));
  const cands = all.filter((m) => isBinaryMarket(m.info) && m.active);

  let chosen: { sym: string; downSym: string; expiry: number } | undefined;
  for (const m of cands) {
    const sym = m.outcomes?.[0]?.symbol;
    const dsym = m.outcomes?.[1]?.symbol;
    if (!sym || !dsym) continue;
    const info = m.info as { marketId: string; expiry?: string };
    try {
      if ((await exchange.client.getMarketOnchain(info.marketId as `0x${string}`)).status !== 1) continue;
      const b = await exchange.fetchOrderBook(sym, 3);
      if (b.bids[0]?.[0] === undefined || b.asks[0]?.[0] === undefined) continue;
      const expiry = Number(info.expiry ?? 0);
      // Prefer the longest-dated market: a quote is worthless if the window closes under us.
      if (!chosen || expiry > chosen.expiry) chosen = { sym, downSym: dsym, expiry };
    } catch { /* skip unreadable */ }
  }
  if (!chosen) { line("No tradable market."); return; }

  const sym = chosen.sym;
  const downSym = chosen.downSym;
  const expiresIn = chosen.expiry ? Math.round((chosen.expiry * 1000 - Date.now()) / 60000) : NaN;
  line(`${t()}  ${sym}`);
  line(`${t()}  expires in ${isNaN(expiresIn) ? "?" : expiresIn} min · size ${SIZE} · ${live ? "\x1b[32mLIVE\x1b[0m" : "dry run"}`);
  line();

  // Warm the live subscription. Subsequent reads come from the local book.
  await Promise.all([exchange.watchOrderBook(sym, 5), exchange.watchOrderBook(downSym, 5)]);

  const deadline = Date.now() + MINUTES * 60_000;
  let upOrder: UnifiedOrder | undefined;
  let downOrder: UnifiedOrder | undefined;
  let rejected: string | undefined;
  let reprices = 0;

  /** Post a BUY on one outcome's book, backing off if it would cross. */
  const post = async (onSym: string, price: number): Promise<UnifiedOrder | undefined> => {
    for (let a = 1; a <= 3; a++) {
      try {
        return await exchange.createOrder(onSym, "limit", "buy", SIZE, price, { timeInForce: "PO" });
      } catch (err) {
        const name = (err as { errorName?: string }).errorName;
        if (name === "PostOnlyWouldCross" && a < 3) {
          const b = await exchange.watchOrderBook(onSym, 5);
          const ask = b.asks[0]?.[0];
          if (ask === undefined) return undefined;
          price = Number((ask - TICK).toFixed(3));
          continue;
        }
        rejected = `${onSym.endsWith("#YES") ? "Up" : "Down"}: ${name ?? (err as Error).message.slice(0, 70)}`;
        return undefined;
      }
    }
    return undefined;
  };

  while (Date.now() < deadline) {
    const [ub, db] = await Promise.all([
      exchange.watchOrderBook(sym, 5),
      exchange.watchOrderBook(downSym, 5),
    ]);
    const upBid = ub.bids[0]?.[0], downBid = db.bids[0]?.[0];
    if (upBid === undefined || downBid === undefined) { await sleep(INTERVAL_MS); continue; }

    const wantUp = Number((upBid + EDGE * TICK).toFixed(3));
    const wantDown = Number((downBid + EDGE * TICK).toFixed(3));
    const pairCost = wantUp + wantDown;
    const edge = 1 - pairCost;
    const off = (o: UnifiedOrder | undefined, want: number) =>
      o?.price === undefined ? Infinity : Math.abs(o.price - want) / TICK;

    let action = "hold";
    // Only quote when the pair is worth buying: a complete set redeems for
    // exactly 1, so paying 1 or more for one is a guaranteed loss.
    if (live && edge > 0) {
      if (off(upOrder, wantUp) > DRIFT) {
        if (upOrder?.id) { try { await exchange.cancelOrder(upOrder.id, sym); } catch { /* gone */ } }
        upOrder = await post(sym, wantUp);
        action = "reprice Up"; reprices++;
      }
      if (!rejected && off(downOrder, wantDown) > DRIFT) {
        if (downOrder?.id) { try { await exchange.cancelOrder(downOrder.id, downSym); } catch { /* gone */ } }
        downOrder = await post(downSym, wantDown);
        action = action === "hold" ? "reprice Down" : "reprice both";
      }
    } else if (edge <= 0) action = "stand aside (no edge)";

    line(
      `${t()}  Up ${px(upBid)} Down ${px(downBid)}  pair ${pairCost.toFixed(3)}` +
      `  edge ${(edge * 100).toFixed(1)}pp   ours ${px(upOrder?.price)}/${px(downOrder?.price)}   ${action}`
    );
    if (rejected) { line(`        \x1b[33mrejected: ${rejected}\x1b[0m`); break; }
    await sleep(INTERVAL_MS);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  line();
  line("─".repeat(64));
  const open = [
    ...await exchange.fetchOpenOrders(sym).catch(() => [] as UnifiedOrder[]),
    ...await exchange.fetchOpenOrders(downSym).catch(() => [] as UnifiedOrder[]),
  ];
  const pos = await exchange.fetchPositions([sym, downSym]).catch(() => []);
  line(`reprices      ${reprices}`);
  line(`open orders   ${open.length}`);
  for (const o of open) line(`  ${o.side?.padEnd(4)} ${px(o.price)} x ${o.amount ?? "?"}  ${o.status ?? ""}`);
  line(`positions     ${pos.length}`);
  for (const p of pos) line(`  ${JSON.stringify(p).slice(0, 110)}`);
  line();
  line(rejected
    ? `\x1b[33mNOT CONFIRMED — ${rejected}\x1b[0m`
    : upOrder && downOrder
      ? "\x1b[32mTHESIS HOLDS — bids resting on BOTH outcomes, zero inventory, zero directional risk.\x1b[0m"
      : "Both legs never rested (dry run, or one book stayed empty).");

  await exchange.close();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31mmaker failed\x1b[0m\n", e); process.exit(1); });
