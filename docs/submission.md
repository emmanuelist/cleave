# DoraHacks submission

Paste-ready. The thesis sentence is identical here, in the repo description, on
the site, and as the closing line of the video. That repetition is deliberate.

## Category

**Crypto / Web3**

## Vision

The field caps at **256 characters**, so the long version below does not fit.
Use this (254 chars), which keeps the two differentiators (no inventory, no
directional view) and still closes on the thesis verbatim:

> Both outcomes of a prediction market settle at exactly 1 together, yet trade
> points apart with nobody in the gap. Cleave rests a bid on each, holds no
> inventory and takes no view on price. Buy every outcome for less than one.
> Settlement pays exactly one.

## Optional profile fields

| Field | Value |
|---|---|
| Layer-1s | Somnia |
| Innovation domains | DeFi, Prediction Markets, DEX |

## Long version, for the Details step or anywhere without a cap

> Prediction markets on DreamDEX quote two outcomes that together must settle at
> exactly 1. In practice they trade two to three points apart, and almost nobody
> stands in that gap: the books are thin, one-sided for long stretches, and
> quoted almost entirely by a single fixed-width bot.
>
> Making a market there normally means holding inventory and taking a view on
> the price. Cleave does neither. It rests a bid on both outcomes at prices
> summing to less than 1 and holds no outcome tokens at all. A filled pair is a
> complete set, and a complete set redeems for exactly 1 whatever happens in the
> world, so the difference is the edge and no price move can take it away.
>
> The hard part is leg risk: one bid fills and the other does not, leaving a
> naked position that is genuinely exposed. Cleave completes the pair by
> crossing, but only while the total stays under 1. Above that it refuses, holds
> the position, and says so on screen rather than locking in a loss.
>
> Buy every outcome for less than one. Settlement pays exactly one.

## Tagline

> Buy every outcome for less than one. Settlement pays exactly one.

## Links

| Field | Value |
|---|---|
| GitHub | https://github.com/emmanuelist/cleave |
| Live | https://cleave-ecru.vercel.app |
| Video | https://youtu.be/YZZcwbx3hqw |

## If asked what is built and working

Verified on Somnia Shannon, every one clickable from the README:

- complete-set mint and merge, exact round trip, `0x63fa4e26` / `0x210c57e4`
- a post-only maker order resting, `0x29f61034`
- both legs filled, `0x6b1de65d` / `0x339a4102`
- winnings redeemed, **+20.000 tUSDC**, `0xb785b4f0`

Plus lock-aware rollover, on-chain leg detection, an edge floor that stops the
loop bidding against its own quote, and book value marked to market.

## If asked whether it makes money

Say the true thing: **the mechanism is proven, profitability is not.** Two
measured sessions came in at +3.47 and -31.88 tUSDC. Leg risk is the dominant
term, and on a testnet whose only counterparty is one fixed-width bot, a small
sample cannot establish an edge either way. This is stated in the video, on the
site and in the README, so it should never arrive as a surprise.
