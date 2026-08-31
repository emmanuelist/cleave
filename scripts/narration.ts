/**
 * The narration script.
 *
 * One block per segment, written to be SPOKEN, not read: short sentences, no
 * subordinate clauses, numbers said the way a person says them. Each block is
 * timed to its segment so the voice never runs past the picture.
 *
 * Claims here are deliberately conservative. The mechanism is proven on-chain;
 * profitability is not, so nothing below claims it. See the limitation note in
 * docs/preflight-baseline.md.
 */
export type Block = { segment: string; secs: number; text: string };

export const NARRATION: Block[] = [
  {
    segment: "01-landing",
    secs: 24,
    text:
      "A prediction market resolves one way, or the other. " +
      "One outcome pays one. The other pays nothing. " +
      "So holding both is worth exactly one, whatever happens in the world. " +
      "Which means if you can buy both for less than one, the difference is yours, " +
      "and no price move can take it away from you.",
  },
  {
    segment: "02-instrument",
    secs: 86,
    text:
      "This is Cleave. It rests a bid on both outcomes at the same time, " +
      "holds no inventory, and takes no view on where the price is going. " +
      "Up and Down stack toward a fixed line at one point zero zero zero. " +
      "The space left over is the edge. That gap is the entire product. " +
      "It's usually only two or three points, so a true scale shows a sliver. " +
      "Rather than exaggerate it, a vernier beside it expands the last five points, " +
      "where the same number can actually be read. " +
      "Everything here is live on Somnia testnet. The marked levels in the book are our own bids. " +
      "Book value is marked to market. Complete sets are held at par, because they redeem at " +
      "exactly one whatever happens. Only the unmatched leg is marked at the book, " +
      "because only the unmatched leg carries price risk. " +
      "Markets on this venue expire every couple of minutes. When one dies, " +
      "the loop follows the series to its successor. " +
      "And the trace along the bottom is the pair cost over the session. " +
      "Watch it rise to the edge floor and stop. It's capped, not chased. " +
      "A maker that chases its own quote is just a taker with extra steps.",
  },
  {
    segment: "03-activity",
    secs: 28,
    text:
      "Here is the only real risk in this. " +
      "One leg fills and the other doesn't, so for a moment we're holding a naked position. " +
      "The loop completes the pair by crossing, but only while the total stays under one. " +
      "Above that, completing would lock in a loss. So it refuses, and it says so on screen. " +
      "That refusal is the part worth watching.",
  },
  {
    segment: "04-settlement",
    secs: 41,
    text:
      "And this is settlement. Two winning positions redeemed, twenty tUSDC, exact. " +
      "Winnings on this venue are claimed, not received. " +
      "A bot that never redeems leaves its balance stranded across dozens of finished markets " +
      "while its wallet reads close to zero. So the loop claims as it goes. " +
      "Two honest notes. This is testnet, and there is almost no organic flow here, " +
      "so these numbers would not survive a real market. " +
      "And leg risk dominates: we have proven the mechanism, not that it turns a profit. " +
      "Buy every outcome for less than one. Settlement pays exactly one.",
  },
];

/** Rough pacing check. Speech runs about 2.6 words a second at a calm delivery. */
export function pacing() {
  return NARRATION.map((b) => {
    const words = b.text.trim().split(/\s+/).length;
    const est = words / 2.6;
    return { segment: b.segment, words, est: +est.toFixed(1), secs: b.secs, fits: est <= b.secs };
  });
}
