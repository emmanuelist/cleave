/**
 * Spread survey — read-only, no signer.
 *
 * Cleave's whole premise is that there is room between the touch and nobody
 * standing in it. This measures that, across every live market, with real books.
 * If the spreads are tight, the thesis is wrong and we should know now.
 *
 * Also verifies the "one book, two sides" claim empirically: a Down price should
 * be 1 - Up. Any deviation is either an SDK bug or a free lunch.
 */
import { SomniaMarkets, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const line = (s = "") => console.log(s);
const pp = (x: number) => `${(x * 100).toFixed(2)}pp`;

async function main() {
  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl,
    chain: cfg.chain,
    wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses,
  });

  const all = Object.values(await exchange.loadMarkets(true));
  const live = all.filter((m) => isBinaryMarket(m.info) && m.active);

  line();
  line(`\x1b[1mSpread survey — ${live.length} live markets\x1b[0m`);
  line("═".repeat(78));
  line(`${"market".padEnd(30)}${"bid".padStart(8)}${"ask".padStart(8)}${"spread".padStart(10)}${"depth".padStart(10)}`);
  line("─".repeat(78));

  const spreads: number[] = [];
  let quotable = 0;

  for (const m of live) {
    const up = m.outcomes?.[0]?.symbol;
    if (!up) continue;
    let bid: number | undefined, ask: number | undefined, nb = 0, na = 0;
    try {
      const book = await exchange.fetchOrderBook(up, 10);
      bid = book.bids[0]?.[0]; ask = book.asks[0]?.[0];
      nb = book.bids.length; na = book.asks.length;
    } catch (err) {
      line(`${m.symbol.padEnd(30)}  book read failed: ${(err as Error).message.slice(0, 30)}`);
      continue;
    }
    const label = m.symbol.replace("/tUSDC", "").padEnd(30);
    if (bid === undefined || ask === undefined) {
      line(`${label}${(bid?.toFixed(3) ?? "—").padStart(8)}${(ask?.toFixed(3) ?? "—").padStart(8)}${"one-sided".padStart(10)}${`${nb}/${na}`.padStart(10)}`);
      continue;
    }
    const s = ask - bid;
    spreads.push(s);
    if (s > 0.01) quotable++;
    const colour = s > 0.02 ? "\x1b[32m" : s > 0.01 ? "\x1b[33m" : "\x1b[90m";
    line(`${label}${bid.toFixed(3).padStart(8)}${ask.toFixed(3).padStart(8)}${colour}${pp(s).padStart(10)}\x1b[0m${`${nb}/${na}`.padStart(10)}`);
  }

  line("═".repeat(78));
  if (spreads.length) {
    const sorted = [...spreads].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)]!;
    const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    line(`median ${pp(med)}   mean ${pp(mean)}   min ${pp(sorted[0]!)}   max ${pp(sorted[sorted.length - 1]!)}`);
    line(`${quotable}/${spreads.length} markets have >1pp of room to quote inside.`);
  } else {
    line("No two-sided books. Nothing to quote against yet.");
  }

  // ── Verify the "one book, two sides" invariant on a real market ────────────
  const probe = live.find((m) => m.outcomes?.[0]?.symbol && m.outcomes?.[1]?.symbol);
  if (probe) {
    const upSym = probe.outcomes![0]!.symbol, downSym = probe.outcomes![1]!.symbol;
    line();
    line(`\x1b[1mInvariant check — Down should price at 1 − Up\x1b[0m`);
    const [u, d] = await Promise.all([exchange.fetchOrderBook(upSym, 3), exchange.fetchOrderBook(downSym, 3)]);
    const ub = u.bids[0]?.[0], ua = u.asks[0]?.[0], db = d.bids[0]?.[0], da = d.asks[0]?.[0];
    line(`  ${upSym}`);
    line(`    bid ${ub?.toFixed(3) ?? "—"}   ask ${ua?.toFixed(3) ?? "—"}`);
    line(`  ${downSym}`);
    line(`    bid ${db?.toFixed(3) ?? "—"}   ask ${da?.toFixed(3) ?? "—"}`);
    if (ua !== undefined && db !== undefined) {
      const resid = Math.abs(1 - ua - db);
      line(`  1 − Up(ask) = ${(1 - ua).toFixed(3)}  vs  Down(bid) = ${db.toFixed(3)}   residual ${pp(resid)}`);
      line(resid < 0.0005
        ? "  \x1b[32minvariant holds — the two sides are one book\x1b[0m"
        : "  \x1b[33mresidual is non-trivial — investigate before relying on the mirror\x1b[0m");
    }
  }
  line();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
