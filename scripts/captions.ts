/**
 * The caption track.
 *
 * Rendered INSIDE the page during filming rather than burned on afterwards:
 * this ffmpeg build ships without libass/libfreetype, and doing it in the page
 * is better anyway, because captions inherit the product's own typography
 * instead of generic subtitle styling.
 *
 * Judges watch muted. These carry the argument on their own, so the film works
 * with the sound off and narration becomes additive rather than load-bearing.
 */
export type Cue = { at: number; secs: number; text: string; kind?: "beat" | "note" };

/** Times are seconds from the start of each SEGMENT, not the finished cut. */
export const CUES: Record<string, Cue[]> = {
  "01-landing": [
    { at: 0.6, secs: 5.5, text: "A prediction market resolves one way or the other." },
    { at: 6.4, secs: 6.0, text: "One outcome pays 1. The other pays 0. Together, always exactly 1." },
    { at: 13.0, secs: 6.5, text: "So buy both for less than 1, and the difference is yours.", kind: "beat" },
  ],
  "02-instrument": [
    { at: 1.0, secs: 5.5, text: "Cleave rests a bid on both outcomes at once." },
    { at: 7.2, secs: 5.5, text: "It holds no inventory and takes no view on the price." },
    { at: 14.0, secs: 6.0, text: "The gap below 1.000 is the edge. That gap is the whole product.", kind: "beat" },
    { at: 22.0, secs: 5.5, text: "Live on Somnia testnet. Our own bids are the marked ones." },
    { at: 30.0, secs: 6.0, text: "Book value is marked to market: complete sets at par, unmatched legs at book." },
    { at: 38.0, secs: 5.5, text: "Markets here expire every couple of minutes." },
    { at: 45.0, secs: 6.0, text: "When one dies the loop follows the series to its successor." },
    { at: 53.0, secs: 6.0, text: "The trace rides the edge floor and holds. It is capped, not chased.", kind: "beat" },
    { at: 61.0, secs: 5.5, text: "A maker that chases is just a taker with extra steps." },
  ],
  "03-activity": [
    { at: 0.8, secs: 5.5, text: "One leg fills and the other does not. Now we are exposed." },
    { at: 7.0, secs: 6.5, text: "It completes the pair by crossing, but only while the total stays under 1." },
    { at: 14.5, secs: 6.5, text: "Above that it refuses, and says so. That refusal is the point.", kind: "beat" },
  ],
  "04-settlement": [
    { at: 1.0, secs: 5.0, text: "Settlement. Two winning positions redeemed." },
    { at: 7.0, secs: 6.0, text: "Twenty tUSDC, exact. Winnings here are claimed, not received." },
    { at: 14.5, secs: 6.5, text: "A bot that never redeems strands its balance across finished markets." },
    { at: 22.0, secs: 7.0, text: "Buy every outcome for less than one. Settlement pays exactly one.", kind: "beat" },
  ],
};

/** Injected into the page. Self-contained so it survives navigation. */
export const CAPTION_RUNTIME = `
(cues => {
  const wrap = document.createElement('div');
  wrap.id = '__cap';
  wrap.innerHTML = '<div class="__cap-in"><span class="__cap-t"></span></div>';
  const css = document.createElement('style');
  css.textContent = \`
    /* The activity log runs down the LEFT of the main column and is the thing
       the demo points at, so captions sit clear of it rather than over it.
       Right of the log text, left of the rail. */
    #__cap{position:fixed;left:560px;right:400px;bottom:0;z-index:99999;pointer-events:none;
      display:flex;justify-content:center;padding:0 0 34px;
      font-family:"Azeret Mono",ui-monospace,Menlo,monospace;}
    @media (max-width:1200px){#__cap{left:0;right:0;padding-bottom:46px;}}
    #__cap .__cap-in{
      max-width:52ch;margin:0;padding:14px 22px;text-align:center;
      background:rgba(6,7,9,.90);border:1px solid rgba(79,209,197,.30);
      border-radius:2px;backdrop-filter:blur(10px);
      box-shadow:0 18px 60px rgba(0,0,0,.6);
      opacity:0;transform:translateY(9px);
      transition:opacity .42s cubic-bezier(.2,.7,.2,1),transform .42s cubic-bezier(.2,.7,.2,1);}
    #__cap.on .__cap-in{opacity:1;transform:none;}
    #__cap .__cap-t{font-size:17px;line-height:1.52;letter-spacing:-.02em;color:#e8ebf0;}
    #__cap.beat .__cap-in{border-color:rgba(79,209,197,.62);
      box-shadow:0 0 0 1px rgba(79,209,197,.12),0 18px 70px rgba(0,0,0,.65);}
    #__cap.beat .__cap-t{color:#4fd1c5;}
  \`;
  document.head.appendChild(css);
  document.body.appendChild(wrap);
  const el = wrap.querySelector('.__cap-t');
  const t0 = performance.now();
  for (const c of cues) {
    setTimeout(() => {
      el.textContent = c.text;
      wrap.classList.toggle('beat', c.kind === 'beat');
      wrap.classList.add('on');
    }, c.at * 1000);
    setTimeout(() => wrap.classList.remove('on'), (c.at + c.secs) * 1000);
  }
})(__CUES__);
`;
