# Cleave

**Quote both sides of a prediction market while holding neither.**

Built for the Somnia × DreamDEX Event Contracts Hackathon.

> *Cleave* (v.) — to split apart; also, to cling together. One word, both
> meanings. So is the mechanic it is named for: `1 tUSDso ⇄ 1 Up + 1 Down`.

---

## Status — in build

Submissions close **Sep 8, 2026 at 19:00**. The write path is verified end to
end: a post-only maker order rests on-chain at
[`0x29f6103…`](https://shannon-explorer.somnia.network/tx/0x29f610342a8c9e70880a0d148da2d551d82845e353f8655bfd68f3f0d32b4e8c).
The maker loop itself is not built yet.

What is verified today, and reproducible with `npm run preflight`:

- `@somnia-chain/markets-sdk` 0.27.0 reads 551 indexed markets on Somnia Shannon
- 8 markets live, all returning on-chain `status = 1` (Trading)
- 10,000 tUSDC minted via the SDK faucet, on-chain
- a post-only order accepted and resting, with a transaction hash

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
