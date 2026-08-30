/**
 * Force a fill, deliberately.
 *
 * Nothing has taken our passive quotes — the only other participant on this
 * testnet is a fixed-width bot and there is no organic flow. So to exercise the
 * fill -> settle -> claim path we cross the spread ourselves, on the
 * soonest-expiring market, and say so plainly wherever the result is shown.
 *
 * We take BOTH sides. Crossing costs the spread (upAsk + downAsk > 1), so this
 * is a small deliberate loss — but a complete set redeems for exactly 1 whatever
 * the outcome, which makes the settlement path deterministic instead of a
 * coin flip on a naked leg.
 *
 *   npm run fill              # dry run
 *   npm run fill -- --live
 */
import { SomniaMarkets, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const live = process.argv.includes("--live");
const SIZE = Number(process.env.FILL_SIZE ?? 5);
const line = (s = "") => console.log(s);
const px = (n?: number) => (n === undefined ? "—" : n.toFixed(3));

async function main() {
  if (!cfg.privateKey) throw new Error("No PRIVATE_KEY in .env.");
  const exchange = new SomniaMarkets({
    indexerUrl: cfg.indexerUrl, chain: cfg.chain, wsRpcUrl: cfg.wsRpcUrl,
    addresses: cfg.addresses, privateKey: cfg.privateKey as `0x${string}`,
  });

  const all = Object.values(await exchange.loadMarkets(true));
  const now = Date.now();
  let pick: { up: string; down: string; marketId: string; expiry: number } | undefined;
  for (const m of all) {
    if (!isBinaryMarket(m.info) || !m.active) continue;
    const up = m.outcomes?.[0]?.symbol, down = m.outcomes?.[1]?.symbol;
    if (!up || !down) continue;
    const i = m.info as { marketId: string; expiry?: string };
    const expiry = Number(i.expiry ?? 0) * 1000;
    const mins = (expiry - now) / 60000;
    if (mins < 15 || mins > 180) continue;     // room for two fills before lock, still settles today
    try {
      if ((await exchange.client.getMarketOnchain(i.marketId as `0x${string}`)).status !== 1) continue;
      if (!pick || expiry < pick.expiry) pick = { up, down, marketId: i.marketId, expiry };
    } catch { /* skip */ }
  }
  if (!pick) { line("No market expiring in the next 3 hours."); return; }

  const [ub, db] = await Promise.all([exchange.fetchOrderBook(pick.up, 5), exchange.fetchOrderBook(pick.down, 5)]);
  const upAsk = ub.asks[0]?.[0], downAsk = db.asks[0]?.[0];
  const mins = Math.round((pick.expiry - now) / 60000);

  line();
  line(`\x1b[1mForced fill — ${live ? "LIVE" : "dry run"}\x1b[0m`);
  line("─".repeat(60));
  line(`market     ${pick.up}`);
  line(`expires    in ${mins} min`);
  line(`Up ask     ${px(upAsk)}     Down ask ${px(downAsk)}`);
  if (upAsk === undefined || downAsk === undefined) { line("\nOne side has no offer — cannot cross."); return; }
  const cost = upAsk + downAsk;
  line(`pair cost  ${cost.toFixed(3)}  (redeems for 1.000 -> ${((1 - cost) * 100).toFixed(1)}pp)`);
  line(`size       ${SIZE} -> ${(SIZE * cost).toFixed(3)} tUSDC out, ${SIZE}.000 back at settlement`);

  if (!live) { line("\nDry run — nothing signed."); return; }

  for (const [sym, ask, label] of [[pick.up, upAsk, "Up"], [pick.down, downAsk, "Down"]] as const) {
    line();
    line(`Crossing ${label} at ${px(ask)} (IOC)...`);
    try {
      const o = await exchange.createOrder(sym, "limit", "buy", SIZE, Number((ask + 0.005).toFixed(3)), { timeInForce: "IOC" });
      const hash = (o.info as { receipt?: { transactionHash?: string } })?.receipt?.transactionHash;
      line(`  status ${o.status ?? "?"}  filled ${o.filled ?? "?"}`);
      if (hash) line(`  ${cfg.explorer}/tx/${hash}`);
    } catch (e) {
      line(`  \x1b[31m${(e as { errorName?: string }).errorName ?? (e as Error).message.slice(0, 80)}\x1b[0m`);
    }
  }

  const pos = await exchange.fetchPositions([pick.up, pick.down]).catch(() => []);
  line();
  line(`positions  ${pos.length ? pos.map((p) => `${p.symbol}=${p.contracts ?? 0}`).join("  ") : "none (indexer may lag)"}`);
  line();
  line(`marketId   ${pick.marketId}`);
  line(`Settles in ${mins} min. Then: npm run claim`);
  await exchange.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31mfill failed\x1b[0m\n", e); process.exit(1); });
