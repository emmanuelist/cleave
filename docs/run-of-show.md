# Run of show — 3:00

A judge gives this about four minutes, tired, after thirty other submissions.
The job is not to explain the architecture. It is the fastest possible
demonstration that one sentence is true.

**Setup before recording:** `npm run serve -- --live --short` running for at
least five minutes, so activity, lineage and a rollover are already populated.
A cold screen with three log lines wastes the first thirty seconds.

---

## 0:00 — 0:25 · The arithmetic, before any product

Full screen on the unity line. No logo, no title card, no "hi, we're…".

> "This is a prediction market on Somnia. Up is trading at 0.489. Down is at
> 0.483. Buy both and you have paid 0.972.
>
> At settlement one of them pays 1 and the other pays 0 — so together, always,
> exactly 1.000. Whatever happens.
>
> That gap is 2.8 points, and it does not care which way the market goes."

Point at the vernier while saying "that gap". **Do not explain the vernier.** It
explains itself; talking over it costs eight seconds and adds nothing.

## 0:25 — 0:45 · Name the product

> "Cleave is a market maker that does only that. It rests a bid on both
> outcomes, at prices summing to less than one, and holds nothing."

One sentence. Then move.

## 0:45 — 1:25 · It is running right now

Cut to the activity log, still on screen.

> "This is live on Somnia testnet, not a recording. Those are real orders on a
> real book — ours are the marked ones. Sixty-four re-quotes so far."

Point at the countdown.

> "This market expires in twelve minutes. They all do — every couple of minutes
> the venue kills the market and rolls a successor. There's the last one,
> expired. The loop followed it."

The lineage panel is doing the work here. Rollover is what proves nothing on
screen is a fixture.

## 1:25 — 2:05 · The moment — slow down here

This is the beat. Everything before it was setup.

Scroll the activity log to a `LEG` → `FILL` pair. If none is on screen, wait for
one — they arrive every thirty seconds or so at `--short`.

```
LEG    naked Up — completing at 0.747 (budget 0.775)
FILL   pair completed
```

> "Here's the only real risk in this. One side filled and the other didn't, so
> for a moment we're holding a naked position — actually exposed to the price.
>
> It priced the other leg at 0.747. Its budget was 0.775 — anything above that
> and completing the pair locks in a loss. So it completed. Flat again."

Then find a declined one — they are common:

```
LEG    naked leg — completing at 0.560 exceeds budget 0.433; holding
```

> "And here it refused. Completing would have cost more than the pair is worth,
> so it held the position and said so instead of hiding it."

**That refusal is the most persuasive four seconds in the demo.** Anything can
show a green number. Showing the machine decline a losing trade is what
separates a working strategy from a dashboard.

## 2:05 — 2:35 · Settled, and paid

Cut to the explorer tab, already open on the redeem transaction.

> "This is settlement. Two winning positions redeemed — twenty tUSDC, exact.
> Winnings on this venue aren't received, they're claimed; a bot that never
> redeems has its balance stranded across dozens of finished markets while its
> wallet reads zero. So the loop claims as it goes."

## 2:35 — 2:50 · The limits, unprompted

Say these before anyone asks. It buys more credit than it costs.

> "Two honest things. This is testnet, and there is almost no real flow here —
> the spreads are one bot quoting a fixed width, so these numbers wouldn't
> survive a real market. And some of our fills we bought deliberately, paying
> the spread on purpose, to get a position that would settle. That trade is in
> the history at a loss and it's in the README."

## 2:50 — 3:00 · Close on the sentence

Back to the unity line.

> "Buy every outcome for less than one. Settlement pays exactly one."

Identical wording to the repo, the README, and the submission form. Stop
talking.

---

## Pre-flight

- [ ] `npm run serve -- --live --short` warm for 5+ minutes before recording
- [ ] Position shows complete sets, not zero — check the rail before you start
- [ ] At least one `LEG` completed **and** one `LEG` declined visible in the log
- [ ] Lineage has at least one `EXPIRED` entry
- [ ] Explorer tab pre-opened on the redeem tx — never navigate live
- [ ] Rehearsed out loud, twice, against a clock
- [ ] Recorded and uploaded; assume you never present live
- [ ] Every README link clicked
- [ ] Submission form uses the thesis sentence **verbatim**

## If it breaks

The wifi will fail. Have the recording.

If the venue has no live markets — it happens between rolls — the interface says
so rather than showing stale numbers. Say "the venue is between markets, this is
what it does when there is nothing to quote", and move to the explorer tab. An
empty state you designed on purpose reads as competence. Hunting for data on
camera does not.

---

# Filming it without a live screen recording

You do not have to perform this live. The camera can be scripted, which removes
mouse fumbling, wifi risk and retakes. **What is automated is the camera, not
the content**: every frame is the real app, driven by the real engine, against
real Somnia markets. Nothing is stubbed and no footage is synthesised.

## The pipeline

```bash
npm run serve -- --live --short     # leave warm ~90s so activity fills
npm run film                        # records 4 segments, ~2.5 min
npm run film:cut                    # assembles film/cleave-silent.mp4
# record narration on your Mac (Voice Memos or QuickTime)
npm run film:voice -- ~/voice.m4a   # muxes it, cleaned and levelled
```

`film:voice` runs light denoise, a 90Hz high-pass, gentle compression and
loudness normalisation to -16 LUFS, which is the streaming/broadcast target.
Video is the master: audio is padded or trimmed so the two end together.

## Narration windows

Measured from an actual run. Pace to these rather than the 3:00 ideal above.

| Segment | Length | What is on screen |
|---|---|---|
| `01-landing` | 22s | The claim and the live pair cost read from chain |
| `02-instrument` | 78s | The loop quoting, leg events, rollovers |
| `03-activity` | 23s | The log, where completion and refusal are legible |
| `04-settlement` | 36s | The redeem transaction on the explorer |
| **Total** | **2:40** | |

## Two things to watch

**The explorer is slow.** It takes ~14s to paint and ~22s to settle. The first
filming run captured a blank white page because a 4s wait was not enough. Waits
are content-based now, but if you re-film and the explorer is having a bad day,
check that segment before assuming it worked.

**A near-expiry market shows an atypical edge.** One run caught `30.8pp` because
the market was 19 seconds from expiry and prices had diverged hard. It is real,
but it is not representative, and narrating it as typical would be misleading.
The honest figure to talk over is the usual **2 to 3 points**. If a run captures
an outlier, re-film rather than explain it away.
