# Preflight baseline — 2026-08-30

First end-to-end read against Somnia Shannon testnet, with the submission window
already open and nine days to the deadline. Recorded so we can tell drift from breakage later.

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

# Spread survey — 2026-08-30, later same day

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

# The gas ceiling problem — 2026-08-30

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

---

# First live order — 2026-08-30

```
market   ETH-0-30AUG26-1200/tUSDC#YES
post     buy 5 @ 0.527, post-only
id       110680464442257325224
status   open
tx       0x29f610342a8c9e70880a0d148da2d551d82845e353f8655bfd68f3f0d32b4e8c
```

The write path is verified end to end: ERC-20 approve, sign, `placeBinaryOrder`,
resting order. Gas was the only thing blocking it — with 50 STT the documented
unified API works untouched, so the raw-tier gas ceiling is now an optimisation
rather than a prerequisite.

## The finding: the book moves faster than we can price it

```
at scan   bid 0.516  ask 0.546
at post   bid 0.526  ask 0.556     <- drifted 2.0pp during the scan
after     bid 0.537  ask 0.567     <- drifted another 1.1pp
```

Two independent ~1pp moves inside about a minute, and the **spread stayed pinned
at 3.00pp through all of it.** The incumbent is not quoting a static price — it
is tracking the underlying ETH mark and re-posting a fixed-width spread around a
moving mid.

This corrects the earlier read. The incumbent is non-adaptive *in width*, not in
level. It will not tighten against us, but it does reprice continuously.

## Consequences for the maker loop

1. **A posted quote goes stale in seconds.** We landed one tick inside the bid
   and were 1pp behind the touch by the next block. Post-and-hold is not a
   strategy here; the loop must reprice.
2. **Scan-then-post is the wrong architecture.** The market scan does an
   on-chain status check per market and costs tens of seconds — longer than the
   book's coherence time. Selection and pricing cannot share a read.
3. **Use the live tail, not polling.** `watchOrderBook` is documented as live
   with zero round-trip. The loop should hold a warm subscription per market and
   reprice on push, rather than calling `fetchOrderBook` in a loop.
4. **`PostOnlyWouldCross` is the normal case, not an error.** A maker that
   cannot lose that race never posts. Retry with a re-read is now in `quote.ts`
   and belongs in the loop too.

## The thesis is unchanged, the implementation is not

Zero inventory still holds — we posted a two-sided-capable quote with no
position behind it. But "stand in a wide spread" becomes "track the mid and hold
a tighter spread around it than the incumbent", which is a live loop, not a
cron.

---

# The thesis was wrong, and the correction is better — 2026-08-30

## What failed

Quoting a **bid and an ask** on the Up book. The bid rested; the ask was
rejected:

```
11:35:03  book 0.450/0.480  ours 0.451/ —   reprice both
          ask rejected: InsufficientBalance
```

Selling Up requires owning Up. There is no naked short. "Quote both sides while
holding neither" is false if "both sides" means bid and ask.

## Where the misreading came from

> "Two opposite-side **buyers** can cross with no seller at all — the pool mints
> a fresh Up/Down pair from their combined collateral."

*Buyers.* Both of them. The mint fires when a **buy Up** crosses a **buy Down**,
not when a buy crosses a sell. Quoting both sides means two bids on two
outcomes, each needing nothing but collateral.

## What actually works

```
11:38:17  Up 0.462  Down 0.509  pair 0.973  edge 2.7pp  reprice both
11:39:31  Up 0.463  Down 0.513  pair 0.978  edge 2.2pp  reprice Down
11:40:13  Up 0.463  Down 0.514  pair 0.979  edge 2.1pp  hold
```

Both legs rested for two minutes with **zero outcome tokens held** — collateral
only. Confirmed on `ETH-0-31AUG26/tUSDC`.

## The economics, which are now much simpler

An Up and a Down together are a **complete set**, and a complete set redeems for
**exactly 1**, whatever happens in the world. So:

```
pay        p + q   (our two bids)
receive    1.000   (guaranteed, at settlement)
edge       1 - (p + q)     observed 2.1 - 2.7pp
```

This is not spread capture and it is not a directional view. **There is no
market risk in a filled pair.** The residual risks are named honestly:

1. **Leg risk.** One bid fills, the other does not. We hold a naked outcome until
   the second fills or we merge out. This is the real risk and the loop must
   manage it.
2. **Expiry risk.** Holding a single leg into settlement is a coin flip.
3. **Queue risk.** We are quoting for free optionality that never gets taken.

## Consequence for the product

The claim tightens from a market-making story to an arithmetic one:

> **Buy every outcome for less than one. Settlement pays exactly one.**

Falsifiable, checkable on screen, and it is the mechanic rather than a gloss on
it. `1 - (p + q)` is the number the interface should put in front of a judge,
because anyone can verify it against the book in about four seconds.

---

# Complete-set round trip — verified 2026-08-30

```
market   ETH-0-31AUG26/tUSDC
pool     0xdb17da3b7135737c8cae0b1f389bee70bf01e47c

mintSet  9990.225 -> 9989.225   1 tUSDC spent
         0x63fa4e26d06c9aab9a5d385110b9ddad82b9651b55a97bf14b89f3c3cd1a4842
burnSet  9989.225 -> 9990.225   1 tUSDC returned
         0x210c57e47e732a348bb040b3e90cce6dd4bfa36ac9879b82394809682fec8ea1

net      0.000 tUSDC
```

**`1 tUSDC <-> 1 Up + 1 Down`, exact, no fee on either leg.** This is the
identity the whole product rests on, and it is now proven on-chain rather than
quoted from documentation.

## Two things it settles

**The redemption value is real.** A complete set is worth exactly 1, so
`1 - (p + q)` is genuine edge and not an accounting artifact.

**The ask side has a legitimate route.** Selling Up failed with
`InsufficientBalance` because we owned no Up. `mintSet` is how a maker acquires
sell-side inventory while staying delta-neutral — a complete set carries no
directional exposure, so minting one and quoting an ask against it adds no
market risk. The dreamDEX docs say exactly this ("mint and merge complete sets
for sell-side inventory"); we read past it.

Not adopted yet. The two-bid model is cleaner and needs no capital committed up
front. Minting for ask-side inventory is the obvious extension once the base
loop is solid.

## Indexer note

`fetchPositions` reported `none` even immediately after the mint. Mint and burn
landed within seconds of each other and the indexer never surfaced the
intermediate state. Balance deltas on the collateral token are the reliable
read for anything faster than indexing.

---

# Reconciliation, leg risk, and the self-referential book — 2026-08-30

## Orphan reconciliation

Every previous run left its bids resting; three had accumulated. The loop now
reads open orders on both books at startup, **adopts** one still within `DRIFT`
ticks of target (keeping its queue position) and cancels the rest.

```
11:55:51  reconcile up   2 found, all cancelled
11:55:52  reconcile down 0 found, all cancelled
...
open orders   2   0.548 0.439        <- exactly one per side
```

## Leg risk

The only real exposure in the two-bid model. If one leg fills, the loop crosses
the other book to complete the pair — **but only while the pair still totals
under 1.** Above that, completing locks in a loss, so it holds the naked leg and
says so rather than papering over it. Wired and exercised (0 events: nothing has
filled yet).

## The bug that mattered: we were bidding against ourselves

Edge decayed monotonically across the first run:

```
11:55:54  pair 0.973  edge 2.7pp
11:56:10  pair 0.988  edge 1.2pp
11:57:46  pair 0.990  edge 1.0pp
```

Two causes, one shape:

1. **`watchOrderBook` includes our own resting order.** Once we are the best
   bid, `bestBid + tick` is an instruction to outbid ourselves. It ratchets one
   tick per reprice until the edge is gone.
2. Chasing a moving book does the same thing more slowly.

It only stopped because `DRIFT = 3` happened to absorb a 1-tick ratchet. That is
luck, not design — at `DRIFT = 1` it would have walked the pair straight to 1.000.

## The fix: an edge floor, not a drift threshold

Quotes are now scaled so the pair never costs more than `1 - MIN_EDGE`
(1.5pp). The loop still improves on the touch and still tracks the market; it
simply will not spend the edge to do it.

```
12:00:26  Up 0.562 Down 0.435  pair 0.985  edge 1.5pp*  reprice both (capped)
12:00:42  Up 0.563 Down 0.427  pair 0.985  edge 1.5pp*  hold
12:01:00  Up 0.558 Down 0.427  pair 0.985  edge 1.5pp*  hold
```

Pinned at the floor while the book moved under it. `*` marks a capped quote.

**The general lesson, and the one worth saying out loud in the demo:** the edge
is the product. Queue position is not worth paying for with it. A maker that
chases is just a taker with extra steps.

---

# First fills — 2026-08-30

Nothing took our passive quotes across ~6 minutes of live quoting, which matches
the spread survey's read: the only other participant is a fixed-width bot and
there is no organic flow to catch. So the fill was **forced deliberately**, and
that is stated wherever the result appears.

```
market   ETH-0-30AUG26-1200-DCD3/tUSDC     marketId 0x…dcd3
Up ask   0.323      Down ask 0.705      pair 1.028

Up    IOC  filled 5   0x6b1de65d4066ecc1cb0513c12658909d88f6c74f41eebba65498aedc6440e7a1
Down  IOC  filled 5   0x339a41025d67ac75b4345b81431ea9a57acb2972746a0c1539f59a418dbee3f8
```

We crossed **both** books. Crossing costs the spread — `upAsk + downAsk = 1.028`
against a set worth exactly 1.000, so this is a deliberate 0.140 tUSDC loss on 5
sets. Worth it, because holding a complete set makes settlement deterministic:
it redeems for exactly 1 whichever way ETH goes, so the claim path can be tested
without a coin flip on a naked leg.

**This is the inverse of the strategy, run on purpose.** Cleave posts and waits
to be paid the spread; here we paid it, to manufacture a settled position.

## Claim path

`listPastBinaryMarkets` is not exported at the package root. It does not need to
be — `loadMarkets(true)` returns all 569 indexed markets and settled ones leave
the *live* list, not the registry. `claim.ts` filters to inactive binary markets,
reads ERC-6909 outcome balances via `outcomeId(pool, nonce, idx)`, feeds
`claimableFrom`, and redeems with `redeemMany`.

Dry run confirms it scans and reports correctly (0 holdings while our market is
still live). Settlement is at ~11:53 UTC; the redeem runs after that.

Note `ClaimableInput` requires `settlementFeeBps`, which is not obvious from the
name — it is on the market row as a nullable string.

---

# Rollover — 2026-08-30

## Markets expire every two minutes

```
   0 min  ETH-245938-30AUG26-1123      2 min  ETH-0-30AUG26-1125
   0 min  BTC-7817435-30AUG26-1123     2 min  BTC-0-30AUG26-1125
```

Rollover is not an edge case on this venue, it is **the dominant behaviour**. A
loop that selects once and quotes until it stops is quoting into a dead book
within two minutes. Anything built here has to follow the series or it does
nothing.

Markets carry **no successor pointer** — only `intervalSec`. Continuity is
inferred: on expiry we re-select, scoring same-asset and same-cadence markets
above others and excluding any expiring no later than the one being replaced.

## The book locks before the stated expiry

First attempt rolled on `now >= expiry` and died:

```
12:26:00  reprice Up (capped)
          rejected: Up: TradingNotActive
```

`TradingNotActive` is not a failure — it is the rollover signal arriving ahead
of the clock. The loop now rolls `ROLL_LEAD_MS` (20s) early **and** treats
`TradingNotActive` as a roll trigger rather than a fatal error. Clean after:

```
12:29:49  window closing — rolling
12:30:00  ETH-0-30AUG26-1200-DCD3/tUSDC#YES
12:30:03  Up 0.742 Down 0.231  pair 0.975  edge 2.5pp   reprice both
```

## These are ultra-short binaries, and they converge violently

Across three consecutive two-minute markets the Up price went
`0.295 -> 0.126 -> 0.514 -> 0.870 -> 0.956 -> 0.980`. As expiry nears, the
probability collapses to near-certainty — which is exactly what a
minutes-to-expiry binary should do.

**The spread stays ~2pp throughout.** At `Up 0.980 / Down 0.011` the pair still
costs 0.99 and still redeems for 1. The arithmetic is indifferent to where in
`(0,1)` the market sits, which is a genuine strength of the two-bid model over
anything that reasons about direction: we never have to be right about ETH.

---

# Claim, and the bug it exposed — 2026-08-30

## Redemption works, exactly

```
tUSDC 9945.435 -> 9965.435     +20.000
tx 0xb785b4f03a6f0fcc68be476ad4dd617dd667ef21d6d3fac1531d91cb1116afd3
```

Two winning positions redeemed at exactly 1 each. No slippage, no fee.

## Finding the positions at all

Three wrong turns, each worth recording:

1. **`balanceOf` on `poolAddress` reverts.** Outcome tokens live on a shared
   **ERC-6909 singleton**, not the pool. `getMarketOnchain` returns that address
   plus the market's `yesId` / `noId` — no need to derive ids.
2. **`loadMarkets` does not retain settled markets.** A settled market leaves
   the registry entirely; pools are recycled to the next market by `nonce`. The
   comment in an earlier commit here — "settled markets leave the live list, not
   the registry" — was wrong.
3. **`listPastBinaryMarkets` is on the CLIENT**, not the package root.
   `exchange.client.listPastBinaryMarkets({ limit })` is the only way to find a
   redeemable position. Scanning `loadMarkets` for inactive rows never finds one.

## The bug: the loop was blind to its own fills

The claim sweep turned up **Up 15** and **Down 10** in settled markets we never
bought deliberately. Those were maker fills. The loop had been filling all along
while reporting `position Up 0 Down 0`, because leg detection used
`fetchPositions` — indexer-backed, and returning nothing throughout.

Consequences, all of which actually happened:

- The claim that "nothing has ever filled passively" was false.
- The leg-risk handler **never fired once**, because it never saw a leg.
- Naked positions were carried into settlement unhedged. They happened to win.

Position now reads ERC-6909 balances directly from the outcome-token singleton.
**Anything that gates a trading decision must read the chain, not the indexer.**
The indexer is for discovery; it is not a source of truth about your own money.

## The strategy, working

```
13:10:23  leg risk: naked Down; completing at 0.648 (budget 0.662)
13:10:24  Up 0.635 Down 0.352  pair 0.985  edge 1.5pp*  completed pair
13:11:24  Up 0.622 Down 0.363  pair 0.985  edge 1.5pp*  hold

leg events  16
position    Up 15  Down 15   (flat / paired)
```

Bids rest, they get filled, a naked leg is detected on-chain, the pair is
completed by crossing only while it stays under budget, and the loop ends
**flat: 15 complete sets, each redeeming for exactly 1.**

Also fixed here: `PostOnlyWouldCross` no longer kills the run. Losing a race to
a moving book is routine — a maker that treats it as fatal stops quoting the
moment the market gets interesting. And selection now skips markets with under
60s of runway, which were being picked only to roll off immediately.

---

# The interface, rendered — 2026-08-30

`npm run serve -- --live --short`. Real market, real books, our own bids marked.

```
market      BTC-0-30AUG26-1315        12:42 to expiry
pair        0.985                     edge 1.5pp
position    Up 15  Down 15            15 complete sets
reprices    64      rollovers 1       leg events 35

lineage     BTC-0-30AUG26-1315        QUOTING
            BTC-0-30AUG26-1300-DE0C   EXPIRED

activity    14:01:59  LEG   naked Up — completing at 0.747 (budget 0.775)
            14:02:00  FILL  pair completed
            14:02:02  POST  Up bid 0.250
```

Those three activity lines are the whole strategy in sequence: a leg fills, the
imbalance is detected **on-chain**, the pair is completed only because 0.747 sits
under the 0.775 budget, and quoting resumes. Unattended.

## Defects found by rendering, not by reading

All six were invisible in source and obvious in a screenshot:

1. **The coarse column sized its own segments in px from its own
   `clientHeight`** — but a flex column's height comes from its children, so it
   grew to ~800px and stretched every other panel. Percentages of a bounded
   parent, always.
2. The edge number clipped: 52px type inside a 20px band.
3. The verdict sentence collided with the readout.
4. Countdown never carried minutes into hours — `692:17 to expiry`.
5. A three-column grid left ~400px of dead space in two panels.
6. Favicon 404.

## The design decision the render forced

The edge is 1.5–3pp. On a true 0→1 scale that is a sliver, and the honest options
were to draw a sliver nobody can read or to inflate it and lie. Neither is
acceptable, so the column keeps true scale and a **vernier** expands 0.950–1.000
beside it — coarse for honesty, fine for legibility. That is how a measuring
instrument handles a fine reading, and it is only available to a product with a
fixed redemption value to measure against.

---

# Empty and error states, reached for real

The run of show tells you to say "this is what it does when there is nothing to
quote", so that state had to be verified rather than assumed. Both were reached
by real means: pointing the engine at a dead indexer, and killing the server
mid-session. Nothing was stubbed.

## The correctness bug this found

**A dropped stream left the numbers frozen and still looking live.** That is the
worst failure a trading interface can have: every figure was stale and nothing
on screen said so. Now a dropped or silent stream raises a banner naming the
time of the last update, and every live figure visibly degrades, the edge losing
its bloom and dropping to flat grey.

Two failure modes are covered, because they are different: the stream erroring,
and the stream going quiet without erroring. The second is caught by a watchdog
at 30s.

## Defects the render surfaced

1. **`hidden` did not hide.** `.unity-body { display: grid }` overrides the
   attribute, so the instrument kept drawing underneath the empty state.
   `[hidden] { display: none !important }` is now global.
2. **The empty state lied.** It read "Selecting a market to quote" while the
   engine had actually died on `indexer RegistryMarkets failed: HTTP 404`. The
   engine now carries a `fault` through to state and the UI names it.
3. **The footer said `live` while the engine was dead.** The stream being up and
   the engine being alive are different things; the indicator now reflects both.
4. The brand mark read as a hamburger icon at 13px.

## Verified

```
no market   Nothing to quote / The engine stopped: indexer RegistryMarkets
            failed: HTTP 404 / with the lifecycle explained beneath
stale       Disconnected from the engine. The figures below were last updated
            at 18:38:54 and are no longer live.
```
