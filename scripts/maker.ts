/**
 * Cleave — the maker loop.
 *
 * Two BIDS, never a sell: buy Up at p, buy Down at q, with p + q < 1.
 * A filled pair is a complete set, and a complete set redeems for exactly 1
 * (verified on-chain: see docs/preflight-baseline.md). So the edge per pair is
 * 1 - (p + q), and it carries no directional risk.
 *
 * The one real risk is LEG RISK: one bid fills and the other does not, leaving a
 * naked outcome. The loop handles it explicitly rather than hoping.
 *
 *   npm run maker                        # dry run
 *   npm run maker -- --live --minutes 10
 */
import { SomniaMarkets, isBinaryMarket, type UnifiedOrder, type UnifiedPosition } from "@somnia-chain/markets-sdk";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const live = process.argv.includes("--live");
/** Target the soonest-expiring market instead of the longest-lived, so a
 *  rollover actually happens inside a short run. Testing and demo aid. */
const SHORT = process.argv.includes("--short");
const MINUTES = Number(process.argv[process.argv.indexOf("--minutes") + 1]) || 5;
const SIZE = Number(process.env.QUOTE_SIZE ?? 5);
const TICK = 0.001;
const EDGE_TICKS = 1;    // how far inside the touch we sit
const DRIFT = 3;         // reprice once our resting order is this many ticks off
const MIN_EDGE = 0.015;  // never let a quoted pair cost more than 1 - this (1.5pp)
const INTERVAL_MS = 6_000;
/** Roll this long BEFORE the stated expiry. The venue locks the book ahead of
 *  the timestamp, so quoting right up to it earns TradingNotActive. */
const ROLL_LEAD_MS = 20_000;

const t = () => new Date().toTimeString().slice(0, 8);
const line = (s = "") => console.log(s);
const px = (n?: number) => (n === undefined ? "  —  " : n.toFixed(3));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const describe = (p: { up: string; expiry: number }) => {
  const mins = Math.round((p.expiry - Date.now()) / 60000);
  line(`${t()}  ${p.up}`);
  line(`${t()}  expires in ${mins} min · size ${SIZE} · ${live ? "\x1b[32mLIVE\x1b[0m" : "dry run"}`);
};


type Pick = { up: string; down: string; marketId: string; base: string; interval: number; expiry: number };

/**
 * Choose a market to quote. The on-chain status check costs seconds per market
 * - far longer than a book stays coherent - so selection must never share a
 * read with pricing.
 *
 * `prefer` biases towards the same asset and cadence, which is how we follow a
 * series across a rollover: markets carry no successor pointer, only an
 * intervalSec, so continuity is inferred rather than looked up.
 */
async function selectMarket(exchange: SomniaMarkets, prefer?: Pick): Promise<Pick | undefined> {
  const all = Object.values(await exchange.loadMarkets(true));
  const now = Date.now();
  let best: Pick | undefined;
  let bestScore = -Infinity;
  for (const m of all) {
    if (!isBinaryMarket(m.info) || !m.active) continue;
    const up = m.outcomes?.[0]?.symbol, down = m.outcomes?.[1]?.symbol;
    if (!up || !down) continue;
    const i = m.info as { marketId: string; expiry?: string; intervalSec?: string | null };
    const expiry = Number(i.expiry ?? 0) * 1000;
    if (expiry <= now) continue;
    try {
      if ((await exchange.client.getMarketOnchain(i.marketId as `0x${string}`)).status !== 1) continue;
    } catch { continue; }
    const cand: Pick = {
      up, down, marketId: i.marketId, base: m.base ?? "?",
      interval: Number(i.intervalSec ?? 0), expiry,
    };
    // Prefer: same series as before, then the longest runway — or the shortest
    // when --short, to force a rollover inside a demo-length run.
    let score = SHORT ? -expiry / 1000 : expiry / 1000;
    if (prefer) {
      if (cand.base === prefer.base) score += 1e9;
      if (cand.interval === prefer.interval) score += 1e8;
      // A successor should start after the one it replaces, not run beside it.
      if (cand.expiry <= prefer.expiry) score -= 1e10;
    }
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env.");
  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl, chain: cfg.chain, wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses, privateKey: cfg.privateKey as `0x${string}`,
  });

  line(`${t()}  selecting market...`);
  let mkt = await selectMarket(exchange);
  if (!mkt) { line("No tradable market."); return; }
  let { up: UP, down: DOWN } = mkt;
  describe(mkt);

  await Promise.all([exchange.watchOrderBook(UP, 5), exchange.watchOrderBook(DOWN, 5)]);

  // ── Reconcile ─────────────────────────────────────────────────────────────
  // Every previous run left its orders resting. Adopt the ones still close to
  // where we want to be (keeping queue position) and cancel the rest, so a
  // restart converges instead of stacking another layer of stale bids.
  let upOrder: UnifiedOrder | undefined;
  let downOrder: UnifiedOrder | undefined;

  if (live) {
    const b0 = await exchange.watchOrderBook(UP, 5);
    const d0 = await exchange.watchOrderBook(DOWN, 5);
    const wantUp0 = Number(((b0.bids[0]?.[0] ?? 0) + EDGE_TICKS * TICK).toFixed(3));
    const wantDown0 = Number(((d0.bids[0]?.[0] ?? 0) + EDGE_TICKS * TICK).toFixed(3));
    for (const [sym, want, slot] of [[UP, wantUp0, "up"], [DOWN, wantDown0, "down"]] as const) {
      const existing = await exchange.fetchOpenOrders(sym).catch(() => [] as UnifiedOrder[]);
      let kept: UnifiedOrder | undefined;
      for (const o of existing) {
        const near = o.price !== undefined && Math.abs(o.price - want) / TICK <= DRIFT;
        if (near && !kept) { kept = o; continue; }
        if (o.id) { try { await exchange.cancelOrder(o.id, sym); } catch { /* already gone */ } }
      }
      const label = `${existing.length} found`;
      line(`${t()}  reconcile ${slot.padEnd(4)} ${label}, ${kept ? `adopted ${px(kept.price)}` : "all cancelled"}`);
      if (slot === "up") upOrder = kept; else downOrder = kept;
    }
  }
  line();

  const deadline = Date.now() + MINUTES * 60_000;
  let reprices = 0, legEvents = 0, rolls = 0;
  let rejected: string | undefined;
  let needsRoll = false;

  const post = async (sym: string, price: number): Promise<UnifiedOrder | undefined> => {
    for (let a = 1; a <= 3; a++) {
      try { return await exchange.createOrder(sym, "limit", "buy", SIZE, price, { timeInForce: "PO" }); }
      catch (err) {
        const name = (err as { errorName?: string }).errorName;
        if (name === "PostOnlyWouldCross" && a < 3) {
          const b = await exchange.watchOrderBook(sym, 5);
          const ask = b.asks[0]?.[0];
          if (ask === undefined) return undefined;
          price = Number((ask - TICK).toFixed(3));
          continue;
        }
        // The book locks before the expiry timestamp. TradingNotActive is not a
        // failure — it is the rollover signal arriving ahead of the clock.
        if (name === "TradingNotActive" || name === "MarketNotTrading") { needsRoll = true; return undefined; }
        rejected = `${sym.endsWith("#YES") ? "Up" : "Down"}: ${name ?? (err as Error).message.slice(0, 70)}`;
        return undefined;
      }
    }
    return undefined;
  };

  /** Contracts held per outcome. Indexer-backed, so it lags a fast fill. */
  const held = async () => {
    const ps: UnifiedPosition[] = await exchange.fetchPositions([UP, DOWN]).catch(() => []);
    const g = (s: string) => Number(ps.find((p) => p.symbol === s)?.contracts ?? 0);
    return { up: g(UP), down: g(DOWN) };
  };

  while (Date.now() < deadline) {
    // ── Rollover ──────────────────────────────────────────────────────────
    // Markets die on schedule and the venue rolls a successor. A loop that
    // keeps quoting a dead market is quoting into nothing, so when the window
    // closes we pull our orders and follow the series to its successor.
    if (mkt && (needsRoll || Date.now() >= mkt.expiry - ROLL_LEAD_MS)) {
      line(`${t()}  \x1b[36m${needsRoll ? "book locked" : "window closing"} — rolling\x1b[0m`);
      needsRoll = false;
      if (live) {
        for (const [o, sym] of [[upOrder, UP], [downOrder, DOWN]] as const) {
          if (o?.id) { try { await exchange.cancelOrder(o.id, sym); } catch { /* gone with the market */ } }
        }
      }
      upOrder = undefined; downOrder = undefined;
      const next = await selectMarket(exchange, mkt);
      if (!next) { line(`${t()}  no successor available — stopping`); break; }
      mkt = next; UP = next.up; DOWN = next.down;
      rolls++;
      describe(next);
      await Promise.all([exchange.watchOrderBook(UP, 5), exchange.watchOrderBook(DOWN, 5)]);
      continue;
    }

    const [ub, db] = await Promise.all([exchange.watchOrderBook(UP, 5), exchange.watchOrderBook(DOWN, 5)]);
    const upBid = ub.bids[0]?.[0], downBid = db.bids[0]?.[0];
    if (upBid === undefined || downBid === undefined) { await sleep(INTERVAL_MS); continue; }

    // Improve on the touch, but never past the point where the pair stops being
    // worth owning. Two reasons this cap is load-bearing:
    //   1. watchOrderBook includes OUR OWN resting order, so once we are the
    //      best bid, bestBid + tick is bidding against ourselves — a ratchet
    //      that walks the edge to zero one tick at a time.
    //   2. Chasing a moving book does the same thing more slowly.
    // The edge is the product. We do not pay for queue position with it.
    const rawUp = upBid + EDGE_TICKS * TICK;
    const rawDown = downBid + EDGE_TICKS * TICK;
    const budget = 1 - MIN_EDGE;
    const scale = rawUp + rawDown > budget ? budget / (rawUp + rawDown) : 1;
    const wantUp = Number((rawUp * scale).toFixed(3));
    const wantDown = Number((rawDown * scale).toFixed(3));
    const pair = wantUp + wantDown;
    const edge = 1 - pair;
    const capped = scale < 1;
    const off = (o: UnifiedOrder | undefined, w: number) =>
      o?.price === undefined ? Infinity : Math.abs(o.price - w) / TICK;

    let action = "hold";

    // ── Leg risk ───────────────────────────────────────────────────────────
    // A naked outcome is the only real exposure in this strategy. If one leg
    // filled, complete the pair by CROSSING the other book — but only while
    // the pair still totals under 1. Above that, completing locks in a loss;
    // better to keep resting and accept we are carrying a position.
    if (live) {
      const pos = await held();
      const naked = pos.up !== pos.down;
      if (naked) {
        legEvents++;
        const short = pos.up > pos.down ? DOWN : UP;
        const filledLeg = pos.up > pos.down ? upOrder?.price : downOrder?.price;
        const book = short === UP ? ub : db;
        const ask = book.asks[0]?.[0];
        const budget = filledLeg === undefined ? undefined : 1 - filledLeg;
        if (ask !== undefined && budget !== undefined && ask < budget) {
          line(`${t()}  \x1b[36mleg risk: naked ${short === UP ? "Down" : "Up"}; completing at ${px(ask)} (budget ${px(budget)})\x1b[0m`);
          try {
            await exchange.createOrder(short, "limit", "buy", Math.abs(pos.up - pos.down), ask + TICK, { timeInForce: "IOC" });
            action = "completed pair";
          } catch (e) { line(`${t()}  could not complete: ${(e as { errorName?: string }).errorName ?? "?"}`); }
        } else {
          line(`${t()}  \x1b[33mleg risk: naked, but completing at ${px(ask)} exceeds budget ${px(budget)} — holding\x1b[0m`);
        }
      }
    }

    // ── Quote ──────────────────────────────────────────────────────────────
    // Only quote when the pair is worth owning. A complete set pays exactly 1,
    // so bidding 1 or more for one is a guaranteed loss.
    if (live && edge > 0 && action === "hold") {
      if (off(upOrder, wantUp) > DRIFT) {
        if (upOrder?.id) { try { await exchange.cancelOrder(upOrder.id, UP); } catch { /* gone */ } }
        upOrder = await post(UP, wantUp); action = "reprice Up"; reprices++;
      }
      if (!rejected && off(downOrder, wantDown) > DRIFT) {
        if (downOrder?.id) { try { await exchange.cancelOrder(downOrder.id, DOWN); } catch { /* gone */ } }
        downOrder = await post(DOWN, wantDown);
        action = action === "hold" ? "reprice Down" : "reprice both";
      }
    } else if (edge <= 0) action = "stand aside (no edge)";
    if (capped && action.startsWith("reprice")) action += " (capped)";

    line(`${t()}  Up ${px(upBid)} Down ${px(downBid)}  pair ${pair.toFixed(3)}  edge ${(edge * 100).toFixed(1)}pp${capped ? "*" : " "}` +
         `   ours ${px(upOrder?.price)}/${px(downOrder?.price)}   ${action}`);
    if (rejected) { line(`        \x1b[33mrejected: ${rejected}\x1b[0m`); break; }
    await sleep(INTERVAL_MS);
  }

  line();
  line("─".repeat(66));
  const open = [
    ...await exchange.fetchOpenOrders(UP).catch(() => [] as UnifiedOrder[]),
    ...await exchange.fetchOpenOrders(DOWN).catch(() => [] as UnifiedOrder[]),
  ];
  const pos = await held();
  line(`reprices      ${reprices}`);
  line(`leg events    ${legEvents}`);
  line(`rollovers     ${rolls}`);
  line(`open orders   ${open.length}   ${open.map((o) => px(o.price)).join(" ")}`);
  line(`position      Up ${pos.up}  Down ${pos.down}${pos.up === pos.down ? "  (flat / paired)" : "  \x1b[33m(NAKED LEG)\x1b[0m"}`);
  await exchange.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31mmaker failed\x1b[0m\n", e); process.exit(1); });
