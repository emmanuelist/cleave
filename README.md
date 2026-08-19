# Cleave

**Quote both sides of a prediction market while holding neither.**

Built for the Somnia × DreamDEX Event Contracts Hackathon.

> *Cleave* (v.) — to split apart; also, to cling together. One word, both
> meanings. So is the mechanic it is named for: `1 tUSDso ⇄ 1 Up + 1 Down`.

---

## Status — pre-build

Submissions open **Aug 25** and close **Sep 8, 2026**. This repository currently
contains the rig: pinned SDK, verified protocol constants, and a read-only
preflight that proves the stack against live testnet. **No trading code has been
written yet, and nothing here claims a fill.**

What is verified today, and reproducible with `npm run preflight`:

- `@somnia-chain/markets-sdk` 0.27.0 reads 551 indexed markets on Somnia Shannon
- 8 markets live, all returning on-chain `status = 1` (Trading)
- real order book depth on `ETH-0-19AUG26-1245/tUSDC#YES`

See [docs/preflight-baseline.md](docs/preflight-baseline.md) for the full run,
including two defects found and fixed.

## The primitive this rests on

On Somnia Markets, Up and Down trade on a **single order book** — a Down price is
always `1 − Up`. Two opposite-side **buyers** can cross **with no seller present**:
the pool mints a fresh Up/Down pair out of their combined collateral.

That is the whole product. Everywhere else, quoting both sides of a market means
holding both sides — you need inventory, or capital to acquire it. Here the pool
manufactures the pair at the moment of the cross, so a maker can stand in the
spread holding nothing at all.

Remove that primitive and Cleave does not port to another venue. It stops being
a product.

## Why it is worth building

From the first live read: the active book is **~2.9 percentage points wide on
three levels a side**. Thin and wide, on markets that expire within hours. There
is real room between the touch and almost nobody standing in it.

The DreamDEX Bot Kit ships `ec-maker`, which quotes two-sided from a terminal and
deploys to Railway. Cleave is not competing with that loop — it is the argument
that two-sided quoting should be something a person can do from a browser,
watching the pair get minted, rather than a headless bot only its author can run.

## Verification

Nothing in this project is mocked. There is no demo mode and no seeded fixture on
the demo path — every rendered value comes from the indexer or the chain. When
data is absent the interface says so rather than inventing a placeholder.

```bash
npm install
cp .env.example .env     # a read-only preflight needs no key
npm run preflight
```

## Limits

Stated plainly, because a judge is going to ask:

- **Testnet only.** Somnia Shannon, chain 50312, tUSDC collateral. Not audited,
  not deployed to mainnet, not handling real money.
- **No on-chain reactivity.** Somnia's on-chain reactivity requires roughly a
  32 SOM minimum subscription balance. This project runs at zero cost, so live
  updates use off-chain reactivity — the node's WebSocket feed — which is free
  and adds no liveness assumption we would not already have in a browser client.
  A deliberate trade, not an oversight.
- **`VENUE_ID` moves.** Testnet changed venue three times in the first week of
  August 2026. Nothing here hardcodes it as truth: preflight reads live venue ids
  off actual market rows and tells you when the constant has gone stale.
- **Winnings are claimed, not received.** A settled market pays out only when
  asked. Any long-running component must sweep settled markets from inside its
  own loop — claiming signs with the same key as trading, and two senders on one
  key race each other's nonce.

## Licence

MIT.
