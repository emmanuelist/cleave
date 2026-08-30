/**
 * The maker loop, as a library.
 *
 * scripts/maker.ts prints it; the server streams it. Same code either way 
 * the interface is not a second implementation of the strategy, it is a view
 * onto the one that trades.
 */
import { SomniaMarkets, isBinaryMarket, erc6909Abi, type UnifiedOrder } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";

export const TICK = 0.001;
const EDGE_TICKS = 1;
const DRIFT = 3;
const MIN_EDGE = 0.015;
const ROLL_LEAD_MS = 20_000;

export type Level = [number, number];
export type EngineEvent = { at: number; kind: "roll" | "leg" | "fill" | "post" | "note"; text: string };

export interface EngineState {
  live: boolean;
  market?: { up: string; down: string; marketId: string; base: string; expiry: number };
  book: { upBid?: number; upAsk?: number; downBid?: number; downAsk?: number; upDepth: Level[]; downDepth: Level[] };
  quote: { up?: number; down?: number; pair?: number; edge?: number; capped: boolean };
  position: { up: number; down: number };
  stats: { reprices: number; rolls: number; legEvents: number; ticks: number };
  lineage: { symbol: string; expiry: number; state: "active" | "rolled" }[];
  events: EngineEvent[];
  /** Set when the engine stopped on an error, so the UI can say what happened
   *  rather than showing a hopeful 'selecting a market'. */
  fault?: string;
  updatedAt: number;
}

type Pick = { up: string; down: string; marketId: string; base: string; interval: number; expiry: number };

export function emptyState(): EngineState {
  return {
    live: false, book: { upDepth: [], downDepth: [] }, quote: { capped: false },
    position: { up: 0, down: 0 },
    stats: { reprices: 0, rolls: 0, legEvents: 0, ticks: 0 },
    lineage: [], events: [], updatedAt: Date.now(),
  };
}

async function selectMarket(exchange: SomniaMarkets, prefer?: Pick, short = false): Promise<Pick | undefined> {
  const all = Object.values(await exchange.loadMarkets(true));
  const now = Date.now();
  let best: Pick | undefined, bestScore = -Infinity;
  for (const m of all) {
    if (!isBinaryMarket(m.info) || !m.active) continue;
    const up = m.outcomes?.[0]?.symbol, down = m.outcomes?.[1]?.symbol;
    if (!up || !down) continue;
    const i = m.info as { marketId: string; expiry?: string; intervalSec?: string | null };
    const expiry = Number(i.expiry ?? 0) * 1000;
    if (expiry <= now + 60_000) continue;
    try { if ((await exchange.client.getMarketOnchain(i.marketId as `0x${string}`)).status !== 1) continue; }
    catch { continue; }
    const cand: Pick = { up, down, marketId: i.marketId, base: m.base ?? "?", interval: Number(i.intervalSec ?? 0), expiry };
    let score = short ? -expiry / 1000 : expiry / 1000;
    if (prefer) {
      if (cand.base === prefer.base) score += 1e9;
      if (cand.interval === prefer.interval) score += 1e8;
      if (cand.expiry <= prefer.expiry) score -= 1e10;
    }
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

export interface RunOpts { live: boolean; minutes: number; size: number; short?: boolean; intervalMs?: number }

export async function runMaker(opts: RunOpts, emit: (s: EngineState) => void): Promise<EngineState> {
  const cfg = loadConfig();
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env.");
  const st = emptyState();
  const push = (kind: EngineEvent["kind"], text: string) => {
    st.events.unshift({ at: Date.now(), kind, text });
    st.events = st.events.slice(0, 40);
  };
  const flush = () => { st.updatedAt = Date.now(); emit(structuredClone(st)); };

  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl, chain: cfg.chain, wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses, privateKey: cfg.privateKey as `0x${string}`,
  });
  const account = privateKeyToAccount(cfg.privateKey as `0x${string}`);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) }) as PublicClient;

  push("note", "selecting market");
  flush();
  let mkt = await selectMarket(exchange, undefined, opts.short);
  if (!mkt) { push("note", "no tradable market"); flush(); return st; }
  let UP = mkt.up, DOWN = mkt.down;
  st.market = { up: UP, down: DOWN, marketId: mkt.marketId, base: mkt.base, expiry: mkt.expiry };
  st.lineage.unshift({ symbol: UP, expiry: mkt.expiry, state: "active" });
  st.live = opts.live;
  push("note", `quoting ${UP}`);
  flush();

  await Promise.all([exchange.watchOrderBook(UP, 6), exchange.watchOrderBook(DOWN, 6)]);

  // Outcome ids come from the chain. fetchPositions is indexer-backed and
  // reported flat through an entire session in which we were repeatedly filled.
  let oc: { outcomeToken: `0x${string}`; yesId: bigint; noId: bigint } | undefined;
  const loadIds = async (id: string) => {
    try { oc = await exchange.client.getMarketOnchain(id as `0x${string}`) as typeof oc; } catch { oc = undefined; }
  };
  await loadIds(mkt.marketId);
  const held = async () => {
    if (!oc) return { up: 0, down: 0 };
    const read = async (id: bigint) => {
      try {
        return Number(await pub.readContract({
          address: oc!.outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [account.address, id],
        }) as bigint) / 1e6;
      } catch { return 0; }
    };
    return { up: await read(oc.yesId), down: await read(oc.noId) };
  };

  let upOrder: UnifiedOrder | undefined, downOrder: UnifiedOrder | undefined;
  let needsRoll = false;

  if (opts.live) {
    for (const [sym, slot] of [[UP, "up"], [DOWN, "down"]] as const) {
      const existing = await exchange.fetchOpenOrders(sym).catch(() => [] as UnifiedOrder[]);
      for (const o of existing) if (o.id) { try { await exchange.cancelOrder(o.id, sym); } catch { /* gone */ } }
      if (existing.length) push("note", `reconciled ${existing.length} stale ${slot} order(s)`);
    }
    flush();
  }

  const post = async (sym: string, price: number): Promise<UnifiedOrder | undefined> => {
    for (let a = 1; a <= 3; a++) {
      try { return await exchange.createOrder(sym, "limit", "buy", opts.size, price, { timeInForce: "PO" }); }
      catch (err) {
        const name = (err as { errorName?: string }).errorName;
        if (name === "TradingNotActive" || name === "MarketNotTrading"
            || name === "OrderAlreadyExpired" || name === "MarketExpired") { needsRoll = true; return undefined; }
        if (name === "PostOnlyWouldCross") {
          if (a === 3) return undefined;
          const b = await exchange.watchOrderBook(sym, 6);
          const ask = b.asks[0]?.[0];
          if (ask === undefined) return undefined;
          price = Number((ask - TICK).toFixed(3));
          continue;
        }
        push("note", `rejected ${name ?? "unknown"}`);
        return undefined;
      }
    }
    return undefined;
  };

  const deadline = Date.now() + opts.minutes * 60_000;
  const interval = opts.intervalMs ?? 6_000;

  while (Date.now() < deadline) {
    if (mkt && (needsRoll || Date.now() >= mkt.expiry - ROLL_LEAD_MS)) {
      push("roll", needsRoll ? "book locked, rolling" : "window closing, rolling");
      needsRoll = false;
      if (opts.live) for (const [o, sym] of [[upOrder, UP], [downOrder, DOWN]] as const)
        if (o?.id) { try { await exchange.cancelOrder(o.id, sym); } catch { /* gone with the market */ } }
      upOrder = undefined; downOrder = undefined;
      const l = st.lineage.find((x) => x.symbol === UP); if (l) l.state = "rolled";
      const next = await selectMarket(exchange, mkt, opts.short);
      if (!next) { push("note", "no successor, stopping"); flush(); break; }
      mkt = next; UP = next.up; DOWN = next.down;
      st.market = { up: UP, down: DOWN, marketId: next.marketId, base: next.base, expiry: next.expiry };
      st.lineage.unshift({ symbol: UP, expiry: next.expiry, state: "active" });
      st.lineage = st.lineage.slice(0, 8);
      st.stats.rolls++;
      await loadIds(next.marketId);
      await Promise.all([exchange.watchOrderBook(UP, 6), exchange.watchOrderBook(DOWN, 6)]);
      push("roll", `now quoting ${UP}`);
      flush();
      continue;
    }

    const [ub, db] = await Promise.all([exchange.watchOrderBook(UP, 6), exchange.watchOrderBook(DOWN, 6)]);
    const upBid = ub.bids[0]?.[0], downBid = db.bids[0]?.[0];
    st.book = {
      upBid, upAsk: ub.asks[0]?.[0], downBid, downAsk: db.asks[0]?.[0],
      upDepth: ub.bids.slice(0, 5) as Level[], downDepth: db.bids.slice(0, 5) as Level[],
    };
    st.stats.ticks++;

    if (upBid === undefined || downBid === undefined) { flush(); await sleep(interval); continue; }

    const rawUp = upBid + EDGE_TICKS * TICK, rawDown = downBid + EDGE_TICKS * TICK;
    const budget = 1 - MIN_EDGE;
    const scale = rawUp + rawDown > budget ? budget / (rawUp + rawDown) : 1;
    const wantUp = Number((rawUp * scale).toFixed(3));
    const wantDown = Number((rawDown * scale).toFixed(3));
    st.quote = { up: upOrder?.price, down: downOrder?.price, pair: wantUp + wantDown, edge: 1 - (wantUp + wantDown), capped: scale < 1 };

    const pos = await held();
    st.position = pos;

    if (opts.live && pos.up !== pos.down) {
      st.stats.legEvents++;
      const shortSym = pos.up > pos.down ? DOWN : UP;
      const filled = pos.up > pos.down ? upOrder?.price : downOrder?.price;
      const ask = (shortSym === UP ? ub : db).asks[0]?.[0];
      const bud = filled === undefined ? undefined : 1 - filled;
      if (ask !== undefined && bud !== undefined && ask < bud) {
        push("leg", `naked ${shortSym === UP ? "Down" : "Up"}, completing at ${ask.toFixed(3)} (budget ${bud.toFixed(3)})`);
        try {
          await exchange.createOrder(shortSym, "limit", "buy", Math.abs(pos.up - pos.down), ask + TICK, { timeInForce: "IOC" });
          push("fill", "pair completed");
        } catch { push("leg", "could not complete"); }
      } else {
        push("leg", `naked leg: completing at ${ask?.toFixed(3) ?? "?"} exceeds budget ${bud?.toFixed(3) ?? "?"}, holding`);
      }
    }

    const off = (o: UnifiedOrder | undefined, w: number) => o?.price === undefined ? Infinity : Math.abs(o.price - w) / TICK;
    if (opts.live && st.quote.edge! > 0) {
      if (off(upOrder, wantUp) > DRIFT) {
        if (upOrder?.id) { try { await exchange.cancelOrder(upOrder.id, UP); } catch { /* gone */ } }
        upOrder = await post(UP, wantUp);
        if (upOrder) { st.stats.reprices++; push("post", `Up bid ${wantUp.toFixed(3)}`); }
      }
      if (off(downOrder, wantDown) > DRIFT) {
        if (downOrder?.id) { try { await exchange.cancelOrder(downOrder.id, DOWN); } catch { /* gone */ } }
        downOrder = await post(DOWN, wantDown);
        if (downOrder) { st.stats.reprices++; push("post", `Down bid ${wantDown.toFixed(3)}`); }
      }
    }
    st.quote.up = upOrder?.price; st.quote.down = downOrder?.price;
    flush();
    await sleep(interval);
  }

  st.live = false;
  push("note", "session ended");
  flush();
  await exchange.close();
  return st;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
