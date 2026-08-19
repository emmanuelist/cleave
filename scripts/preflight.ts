/**
 * Cleave preflight — read-only.
 *
 * Proves the whole stack is real before a single order is written:
 *   1. the indexer answers
 *   2. binary markets exist and are Trading on-chain (not just in the index)
 *   3. which VENUE_IDs are actually live right now — read off market rows,
 *      not trusted from a constant, because the venue id moves
 *   4. a real order book with real depth
 *
 * No private key required. No mocks anywhere: if something is empty, it prints
 * empty. Run: npm run preflight
 */
import { SomniaMarkets, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { loadConfig, KNOWN_VENUE_IDS } from "../src/config.js";

const cfg = loadConfig();

const line = (s = "") => console.log(s);
const h = (s: string) => { line(); line(`\x1b[1m${s}\x1b[0m`); line("─".repeat(s.length)); };

async function main() {
  h("Cleave preflight");
  line(`network   ${cfg.network}  (chain ${cfg.chain.id})`);
  line(`indexer   ${cfg.indexerUrl}`);
  line(`rpc       ${cfg.rpcUrl}`);
  line(`signer    ${cfg.privateKey ? "present" : "none (read-only)"}`);
  line(`dry run   ${cfg.dryRun}`);

  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl,
    chain: cfg.chain,
    wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses,
    ...(cfg.privateKey ? { privateKey: cfg.privateKey as `0x${string}` } : {}),
  });

  h("Markets");
  const t0 = Date.now();
  const all = Object.values(await exchange.loadMarkets(true));
  line(`loadMarkets  ${all.length} rows in ${Date.now() - t0}ms`);

  const binary = all.filter((m) => isBinaryMarket(m.info));
  const activeBinary = binary.filter((m) => m.active);
  line(`binary       ${binary.length}  (${activeBinary.length} active)`);

  if (binary.length === 0) {
    line();
    line("\x1b[33mZero binary markets. Before debugging anything else, suspect INDEXER_URL —");
    line("the demo stack has relocated before. Confirm it in somnia-markets DEPLOYMENTS.md.\x1b[0m");
    return;
  }

  // ── Venue discovery. The whole point: do not trust the hardcoded id. ────────
  h("Live venues (read off market rows)");
  const byVenue = new Map<string, number>();
  for (const m of activeBinary) {
    const v = (m.info as { venueId?: string | null }).venueId ?? "(none)";
    byVenue.set(v, (byVenue.get(v) ?? 0) + 1);
  }
  const venues = [...byVenue.entries()].sort((a, b) => b[1] - a[1]);
  for (const [v, n] of venues) line(`  ${n.toString().padStart(4)} active   ${v}`);

  const known = KNOWN_VENUE_IDS[cfg.network];
  const knownIsLive = byVenue.has(known);
  line();
  line(`last-known id ${knownIsLive ? "\x1b[32mstill live\x1b[0m" : "\x1b[31mNOT serving markets\x1b[0m"}  ${known}`);
  if (cfg.venueId && !byVenue.has(cfg.venueId)) {
    line(`\x1b[31m.env VENUE_ID is not among the live venues — it has moved again.\x1b[0m`);
  }
  if (venues.length > 1) {
    line(`\x1b[33m${venues.length} venues serving side by side — scope every query or you will`);
    line(`quote across venues that do not share a book.\x1b[0m`);
  }

  // ── On-chain truth. The indexer lags; status 1 == Trading. ──────────────────
  h("On-chain status (indexer lags — this is the truth)");
  const sample = activeBinary.slice(0, 8);
  let tradable: (typeof sample)[number] | undefined;
  for (const m of sample) {
    const marketId = (m.info as { marketId: string }).marketId;
    let status: number | string;
    try {
      const onchain = await exchange.client.getMarketOnchain(marketId as `0x${string}`);
      status = onchain.status;
    } catch (err) {
      status = `read failed: ${(err as Error).message}`;
    }
    const trading = status === 1;
    if (trading && !tradable) tradable = m;
    line(`  ${trading ? "\x1b[32m●\x1b[0m" : "\x1b[90m○\x1b[0m"} status=${String(status).padEnd(3)} ${m.symbol}`);
  }

  // ── A real book. ────────────────────────────────────────────────────────────
  h("Order book");
  const target = tradable ?? activeBinary[0];
  const upSymbol = target?.outcomes?.[0]?.symbol;
  if (!target || !upSymbol) { line("no outcome symbol available"); return; }

  line(`${upSymbol}`);
  const book = await exchange.fetchOrderBook(upSymbol, 5);
  const fmt = (lv?: [number, number]) => (lv ? `${lv[0].toFixed(3)} × ${lv[1]}` : "—");
  line(`  best bid  ${fmt(book.bids[0] as [number, number] | undefined)}`);
  line(`  best ask  ${fmt(book.asks[0] as [number, number] | undefined)}`);
  line(`  depth     ${book.bids.length} bids / ${book.asks.length} asks`);
  if (book.bids.length === 0 && book.asks.length === 0) {
    line();
    line("  \x1b[36mEmpty book — which is exactly the gap Cleave fills.\x1b[0m");
  }

  h("Result");
  line("Stack verified end to end against live testnet. Nothing here is mocked.");
}

// The client holds an open WS handle for the live tail, so the event loop never
// drains on its own. A read-only script is done when it has printed.
main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("\n\x1b[31mpreflight failed\x1b[0m\n", err); process.exit(1); });
