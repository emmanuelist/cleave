/**
 * A synthetic pointer for the film.
 *
 * Playwright records no cursor, so a scripted capture reads as a screenshot
 * that happens to move. A pointer gives the shot agency: the eye follows it,
 * and it lands on whatever the narration is talking about at that moment.
 *
 * More precise than a real mouse, because it hits the right element on the
 * right word every time and never overshoots looking for it.
 */
export type Move = { at: number; sel: string; label?: string; dwell?: number };

/** Targets are CSS selectors in the page being filmed. A missing one is
 *  skipped rather than throwing: markets roll and panels come and go. */
export const MOVES: Record<string, Move[]> = {
  "01-landing": [
    { at: 2.0, sel: "h1" },
    { at: 8.0, sel: ".cell.edge dd", label: "the edge, live" },
    { at: 13.5, sel: ".live-foot" },
  ],
  "02-instrument": [
    { at: 2.5, sel: "#bUp li.mine, #bUp li:first-child", label: "our bid" },
    { at: 6.0, sel: "#bDown li.mine, #bDown li:first-child", label: "and the other side" },
    { at: 12.0, sel: "#segUp" },
    { at: 15.5, sel: "#gap", label: "the gap is the edge" },
    { at: 20.0, sel: "#edge" },
    { at: 27.0, sel: ".v-track", label: "expanded twentyfold" },
    { at: 34.0, sel: "#pEquity" },
    { at: 38.5, sel: "#pPaired", label: "sets at par" },
    { at: 43.0, sel: "#pNaked", label: "only this carries risk" },
    { at: 48.0, sel: "#countdown", label: "expires shortly" },
    { at: 52.0, sel: "#lineage li:first-child" },
    { at: 57.0, sel: ".trace-wrap", label: "capped, not chased" },
  ],
  "03-activity": [
    { at: 2.0, sel: "#posState", label: "naked leg" },
    { at: 7.5, sel: '#events li[data-k="leg"]', label: "completing" },
    { at: 13.0, sel: '#events li[data-k="fill"], #events li[data-k="leg"]', label: "or refusing" },
  ],
  "04-settlement": [],
};

export const POINTER_RUNTIME = `
(moves => {
  const p = document.createElement('div');
  p.id = '__ptr';
  p.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 22 22">' +
    '<path d="M3 1 L3 17 L7.2 13.2 L10 19.5 L12.6 18.3 L9.9 12.2 L15.5 12.2 Z"' +
    ' fill="#fff" stroke="rgba(0,0,0,.85)" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
    '<span class="__ptr-l"></span>';
  const css = document.createElement('style');
  css.textContent = \`
    #__ptr{position:fixed;left:0;top:0;z-index:100000;pointer-events:none;opacity:0;
      transform:translate(-50%,-50%);
      transition:opacity .45s ease, left 1.05s cubic-bezier(.33,.02,.2,1),
                 top 1.05s cubic-bezier(.33,.02,.2,1);
      }
    #__ptr.on{opacity:1;}
    #__ptr .__ptr-l{position:absolute;left:22px;top:12px;white-space:nowrap;
      font-family:"Azeret Mono",ui-monospace,Menlo,monospace;font-size:11px;
      letter-spacing:-.01em;color:#4fd1c5;background:rgba(6,7,9,.92);
      border:1px solid rgba(79,209,197,.34);padding:3px 8px;border-radius:2px;
      opacity:0;transition:opacity .3s ease;}
    #__ptr.labelled .__ptr-l{opacity:1;}
    /* A ring that fires on arrival, so a landing reads as a landing. */
    #__ptr::after{content:"";position:absolute;left:1px;top:1px;width:26px;height:26px;
      margin:-13px 0 0 -13px;border:1.5px solid rgba(79,209,197,.9);border-radius:50%;
      opacity:0;transform:scale(.35);}
    #__ptr.ping::after{animation:ptrPing .62s cubic-bezier(.2,.7,.2,1);}
    @keyframes ptrPing{0%{opacity:.95;transform:scale(.35)}100%{opacity:0;transform:scale(1.9)}}
  \`;
  document.head.appendChild(css);
  document.body.appendChild(p);
  const lab = p.querySelector('.__ptr-l');

  moves.forEach(m => setTimeout(() => {
    const el = document.querySelector(m.sel);
    if (!el) return;                       // panels come and go; never throw
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    p.style.left = Math.round(r.left + Math.min(r.width * 0.5, 90)) + 'px';
    p.style.top  = Math.round(r.top + r.height / 2) + 'px';
    p.classList.add('on');
    lab.textContent = m.label || '';
    p.classList.toggle('labelled', !!m.label);
    p.classList.remove('ping');
    // ping once the travel has finished, not when it starts
    setTimeout(() => p.classList.add('ping'), 1050);
  }, m.at * 1000));
})(__MOVES__);
`;
