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
