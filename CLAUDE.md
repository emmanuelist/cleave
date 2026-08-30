# Cleave — build rules

> **Cleave** (v.) to split apart; also, to cling together. The same word for both.
> So is the mechanic: 1 USDso ⇄ 1 Up + 1 Down.

**Thesis (use this sentence verbatim, everywhere):**
*Buy every outcome for less than one. Settlement pays exactly one.*

(Superseded 2026-08-30: the original claim was "quote both sides while holding
neither", which is false - selling an outcome requires owning it. The mint fires
between two BUYERS, so both legs are bids. See docs/preflight-baseline.md.)

That sentence goes in the repo description, the README subtitle, the DoraHacks
submission field, and the closing line of the demo video. Identical wording each time.

**Event:** Somnia × DreamDEX Event Contracts Hackathon.
Submissions **OPEN since Aug 25**. Deadline **Sep 8, 2026 19:00**. $5,000 pool.
**Nine days left as of Aug 30.** 11 BUIDLs already submitted, 255 hackers registered.

**Judging weights — build against these, not against taste:**

| Criterion | Weight | Where we win it |
|---|---|---|
| Technical Implementation | 25% | Real SDK, real testnet fills, no mocks |
| Innovation & Originality | 20% | Mint-on-cross as load-bearing structure |
| UX & Design | 20% | The Cross component; the kit has no UI at all |
| Business & Ecosystem Impact | 20% | We generate trading activity by construction |
| Presentation & Demo | 15% | 3-minute scripted run of show |

---

## 1. Non-negotiables

1. **No mocks, no fake data, no demo mode.** Every number rendered comes from the
   chain or the indexer. No seeded fixtures in the demo path. Judges detect mocks
   instantly and it is the most common reason strong-looking projects lose. If a
   surface cannot be filled with real data yet, it does not ship.
2. **Verify every SDK call against installed types or the published docs before
   writing it.** Do not infer method names from other exchange SDKs. The types ship
   with the package — read them. A hallucinated SDK surface is the most expensive
   failure mode in a timeboxed build.
3. **Phase-gate.** Build one phase, stop, confirm it works against testnet, then
   start the next. No parallel half-finished systems.
4. **Never scope-cut silently.** If something has to go, say so and say why, on
   technical merit rather than effort.
5. **Green gate before any phase closes:** typecheck clean, lint zero warnings,
   build succeeds. No exceptions, no "fix it later."

## 2. Pinned versions — verified against the npm registry on 2026-08-30

```
@somnia-chain/markets-sdk   0.27.0     <- latest; publ. 2026-08-14
@somnia-chain/reactivity    ^0.2.1     <- peer dep
viem                        ^2         <- peer dep
react                       >=18       <- peer dep
```

**Prohibited:** `@somnia-chain/markets-sdk` **below 0.23.0 must never appear.**
Those versions still query the `longOpenInterest` column, which the indexer dropped
— `loadMarkets` and `listBinaryMarkets` both fail outright. Docs say ≥0.25.0; we pin
0.27.0.

The **HTTP API is spot-only and has no event-contract endpoints.** Everything we do
goes through the SDK. Do not go looking for a REST route for markets.

## 3. Protocol facts — verified, do not re-derive

**The primitive the whole product rests on.** Up and Down trade on a *single* order
book; a Down price is always `1 - Up`. Two opposite-side **buyers** can cross **with
no seller present** — the pool mints a fresh Up/Down pair from their combined
collateral. This is why two-sided quoting needs zero inventory, and it is the reason
this project cannot be ported to another venue. If you find yourself writing
inventory-management code, stop: you have lost the thesis.

**Prices are Up probabilities in the open interval (0, 1).** Not cents, not bps.

**Symbols** look like `BTC-0-12AUG26-1600/USDso#YES`.

**The indexer lags the chain.** Gate every write on live on-chain status:
`exchange.client.getMarketOnchain(marketId)` → `status !== 1` means not Trading, skip it.
Row ids come back as plain strings; the client wants them hex-typed (`as \`0x${string}\``).

**Order receipts ride on `order.info`,** typed `PlaceOrderResult` — there is no
`order.receipt` field. From 0.23.0 a reverted write throws a *decoded* revert error,
so let it propagate or catch it; do not test a status flag.

**Winnings are claimed, not received.** A settled market pays out only when someone
asks. Positions do not decay into collateral on their own. A bot that trades for a
week without redeeming has its balance stranded across dozens of finalised markets
while its wallet reads near zero. Call `maybeClaim` **inside the main loop**, never
on a background timer — claiming signs from the same key as trading, and two senders
on one key race each other's nonce. For the same reason: **never run two bots on one key.**

**Markets expire and respawn.** Every window has a hard expiry and the venue rolls a
successor automatically. A settled market leaves the live list, so winnings are found
by scanning *recently settled* markets, not live ones.

**`VENUE_ID` is mandatory and it moves.** One deployment hosts several venues and
their markets sit side by side in the indexer. Both networks changed venue **three
times in the first week of August 2026**, and briefly shared one id before diverging.

```
testnet  0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c
mainnet  0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d
```

Treat those as a *starting point*, read from env, never hardcode in source. If the app
reports no markets or errors that live markets span several venues, re-check the id
first — it is almost always this.

## 4. Order-placement gotchas — each one silently rejects or reverts

- `expireTimestampNs = 0` is **rejected**, and it does not mean "no expiry" — there is
  no never-expires sentinel. Pass a future nanosecond timestamp:
  `(Date.now() + lifetimeMs) * 1_000_000`.
- `priceRaw = 0` is a literal limit price of zero and **never crosses**. To take, price
  through the touch: buy at or above best ask, sell at or below best bid.
- `placeTakerOrderWithoutVault` **no longer exists** (removed in the June 2026 spot
  upgrade). The single entry point is the payable `placeOrder`.
- Native SOMI **buys need ≥ 5,000,000 gas** or they revert `InsufficientGasForPayout`
  (`0x782b2567`) — and simulate at the *same* gas limit you broadcast, or the sim lies.
- Native SOMI vault balances key off sentinel `0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00`,
  not `address(0)`.
- `getPoolParams()` returns **7** fields in this exact order: `baseToken, quoteToken,
  makerFee, takerFee, tickSize, minQuantity, lotSize`. Maker fee before taker fee;
  minQuantity before lotSize.

There are **no API rate limits** — market data is the chain and the public RPCs are
unthrottled. Snapshot once, then stay current from live on-chain watches rather than
re-polling.

## 5. Cost ceiling — hard constraint

**This project spends zero dollars.** Testnet only.

- STT comes from captcha-only faucets with **no mainnet-ETH holding requirement**.
  Avoid the Google Cloud faucet specifically — it gates on holding 0.001 ETH on
  Ethereum mainnet. Use Stakely / faucet.trade / the hackathon Telegram.
- **On-chain reactivity is out of scope.** It requires a ~32 SOM minimum subscription
  balance, which we are not going to fund. Use **off-chain reactivity** (WebSocket,
  node-served, costs nothing) for everything live. This is a deliberate architectural
  choice, not an oversight — say so in the README limits section.
- No paid hosting tier, no paid API keys, no App Store account.

If a design requires spending money, it is the wrong design. Raise it, do not quietly
pay for it.

## 6. Frontend

Direction comes from the `premium-product-design` skill. Hackathon-specific:

- **Hand-build the components.** Tailwind, an icon set, `clsx`. Nothing that makes this
  look like the other thirty entries. A default component-library look is recognisable
  at a glance.
- **One signature component, and it *is* the thesis: The Cross.** A live order book
  where two incoming buy orders meet and a new Up/Down pair is minted from nothing.
  Not decoration — it is the claim rendered as an object, the thing the demo points at,
  and the thing a judge remembers when they cannot remember our name. Build it first
  and make it unmissable.
- **Design for the beat.** What is the judge looking at in second 40? That element gets
  built before anything peripheral.
- Real content lengths and every state: empty book, no live markets, market rolled to a
  successor mid-session, settled-and-unclaimed, wallet disconnected, long symbols,
  large numbers.

## 7. README is a verification surface

Above the fold: the thesis sentence · live deployed link · demo video · testnet
explorer link to a **real fill our maker produced** · SDK version. Then a section
stating plainly that nothing is mocked, and proving it.

**State the limits honestly** — testnet only, unaudited, no on-chain reactivity and
why, known-fragile parts. Naming our own gaps reads as engineering maturity and
pre-empts the question a judge was already forming.
