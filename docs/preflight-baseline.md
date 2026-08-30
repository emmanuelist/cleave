# Preflight baseline — 2026-08-19

First end-to-end read against Somnia Shannon testnet, six days before the
submission window opens. Recorded so we can tell drift from breakage later.

## Environment

| | |
|---|---|
| SDK | `@somnia-chain/markets-sdk` 0.27.0 |
| Chain | Somnia Shannon, id `50312` |
| Indexer | `https://dev.smk.somnia.host/v1/graphql` |
| Collateral | **tUSDC** on testnet (mainnet uses USDso — do not mix the two up in copy) |
| Venue | `0x679795…e8a28c` — sole live venue, matches last-known constant |

## What the chain actually looks like

- **551 market rows indexed, 542 binary, only 8 active.** The index is
  overwhelmingly dead markets. Anything that lists markets must filter to active
  *and* re-check on-chain status, or it will render a graveyard.
- **All 8 active markets returned `status = 1` (Trading).**
- Active set is BTC and ETH only, on short windows:
  `ETH-0-19AUG26-1245`, `BTC-0-19AUG26-1245`, `BTC-0-19AUG26-1300`,
  `BTC-0-19AUG26-1600`, `ETH-0-19AUG26-1300`, `ETH-0-19AUG26-1600`,
  `ETH-0-20AUG26`, `BTC-0-20AUG26`.
- Windows are **hours, not days** — the 1245/1300/1600 suffixes are same-day
  expiries. The rollover cadence is fast, which makes the "markets die and
  respawn" behaviour a front-line concern, not an edge case.

## The finding that supports the thesis

Two reads of `ETH-0-19AUG26-1245/tUSDC#YES`, minutes apart:

```
run 1   bid 0.325 × 200   ask 0.353 × 200   3 bids / 3 asks
run 2   bid 0.572 × 200   ask 0.601 × 200   3 bids / 3 asks
```

**The spread is ~2.8–2.9 percentage points wide on three levels a side.** The
price moved 25 points between runs, so this is live, not stale.

That is a thin, wide book — which is the whole argument for Cleave. There is
real room between the touch, and almost nobody standing in it. Screenshot this
during the demo.

## Defects found and fixed

1. **`getMarketOnchain` threw** `v2 resolves markets by marketId through the
   module`. Cause: no `addresses` passed to the constructor, so the binary
   module address was unset. The SDK exports `SOMNIA_TESTNET_ADDRESSES` /
   `SOMNIA_MAINNET_ADDRESSES` for a zero-setup start — pass them. The config
   type marks addresses optional and says "features degrade if unset"; in
   practice every live-status gate is blind without them.
2. **The process never exited.** The client holds an open WebSocket handle for
   the live tail, so the event loop never drains. A read-only script exits
   explicitly once it has printed.

## Not yet verified

Everything requiring a signer: `placeOrder`, complete-set mint/merge, redeem.
Blocked on a funded testnet wallet. Nothing below is claimed to work until it
has been run:

- [ ] a real fill, with a transaction hash on the Shannon explorer
- [ ] mint-on-cross observed between two opposite-side buyers — **the thesis**
- [ ] `maybeClaim` sweeping a settled market
- [ ] behaviour across a rollover to a successor market

---

# Spread survey — 2026-08-19, later same day

`npm run spread`. Eight live markets, all two-sided. This is the number the whole
thesis rests on, so it is measured rather than assumed.

```
market                bid     ask   spread   depth
BTC-0-19AUG26-1500  0.517   0.547   3.00pp     3/3
ETH-0-19AUG26-1415  0.517   0.547   3.00pp     2/3
BTC-0-19AUG26-1415  0.553   0.582   2.90pp     3/3
ETH-0-19AUG26-1500  0.500   0.530   3.00pp     3/3
ETH-0-19AUG26-1600  0.758   0.784   2.60pp     3/3
BTC-0-19AUG26-1600  0.890   0.912   2.20pp     3/3
ETH-0-20AUG26       0.682   0.710   2.80pp     4/3
BTC-0-20AUG26       0.621   0.650   2.90pp     4/3

median 2.90pp   mean 2.80pp   min 2.20pp   max 3.00pp
8/8 markets have >1pp of room to quote inside.
```

## The read: this is one bot, not a market

Spreads cluster in a 0.8pp band (2.2–3.0) across eight independent markets on two
different underlyings at four different expiries, with near-identical depth (3
levels a side, uniform size). Organic order flow does not look like that.

That pattern is a **single automated quoter posting fixed-width, fixed-size
two-sided quotes** — almost certainly the venue's own seeding bot, or one
entrant's `ec-maker` left running. Which means:

- The incumbent is **not adaptive**. It is not going to tighten in response to us.
  A quote posted one tick inside it wins the queue and keeps winning it.
- There is essentially **no competition for the spread** right now. The 2.9pp is
  not compensation for risk anyone is actively pricing — it is just unoccupied.
- Corollary: our numbers during the hackathon will look better than they would in
  a real market. Say so in the README rather than letting a judge infer we did
  not notice.

## The invariant holds exactly

```
BTC-0-19AUG26-1500#YES   bid 0.517   ask 0.547
BTC-0-19AUG26-1500#NO    bid 0.453   ask 0.483
1 − Up(ask) = 0.453   vs   Down(bid) = 0.453   residual 0.00pp
```

Zero residual. Up and Down really are one book, exactly mirrored.

**This simplifies the build considerably.** We do not manage two books, two
inventories, or a hedge between them. Posting a bid and an ask on the Up book
*is* quoting both sides — and because the pool mints the pair when they cross,
neither leg needs inventory behind it. The product is one book, two resting
orders, and no position.

---

# The gas ceiling problem — 2026-08-19

The unified API (`exchange.createOrder`) cannot run on a faucet-funded wallet,
and the ceiling is not reachable from the config it accepts.

## Mechanism

`TraderConfig.gas` documents a **10,000,000 default ceiling**, overridable
"per-call via its params' `gas`". The node reserves `gasLimit × maxFeePerGas`
before broadcasting, whatever the tx actually burns. On Shannon the SDK bids a
fixed ~60 gwei against a 6 gwei base fee, so:

```
10,000,000 gas x 60 gwei = 0.600 STT reserved, per transaction
```

Observed on a failed `approve` (a ~46k-gas ERC-20 call):

```
gasLimit     0x989680      = 10,000,000
maxFeePerGas 0x0df8475800  = 59,999,875,072  (~60 gwei, 10x base)
result       Details: insufficient balance
```

## Why it cannot be worked around from the unified tier

- `SomniaMarketsConfig` carries `indexerUrl`, `chain`, `wsRpcUrl`, `fees`,
  `addresses` — **no `gas`**, so the lazily-built `exchange.trader` always takes
  the 10M default.
- `setSigner()` accepts only `Pick<TraderConfig, "privateKey" | "account" |
  "walletClient">` — no gas either.
- `createOrder`'s params bag (`CreateOrderParams`) is time-in-force, slippage and
  builder attribution. No gas.
- The failing `approve` is issued *internally* by `createOrder`, so even a
  per-call override on the order would not cover it.

The only route to a sane ceiling is dropping to the raw tier:
`client.createTrader({ privateKey, gas })`, which does accept it.

## Consequence

A wallet needs **0.6 STT resident per in-flight transaction** to use the
documented happy path, for calls that burn ~0.008. Faucets dispense 0.001–0.1.
So the documented API is unusable on exactly the wallet state a new participant
has, and the failure surfaces as `Missing or invalid parameters` — with
`insufficient balance` buried in the cause chain.

**Feedback report item.** Along with `getMarketOnchain` requiring `addresses`
and the faucet's own 13x reserve-to-burn ratio, this is the third instance of
the same pattern: a real precondition reported as a parameter error.
