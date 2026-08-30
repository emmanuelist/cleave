/**
 * The trace: pair cost over the session, plotted against the two lines that
 * matter, 1.000 (what a complete set redeems for) and the edge floor the
 * strategy refuses to quote above.
 *
 * This is the chart the product actually needs. You watch the line crawl up
 * toward unity as the market moves, hit the cap, and hold there, which is the
 * edge floor doing its job, visible rather than asserted.
 */
const TOP = 1.006, BOT = 0.950;   // window
const y = (v, h) => ((TOP - v) / (TOP - BOT)) * h;

export function mountTrace(canvas, opts = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  const pts = [];          // { t, pair }
  const marks = [];        // { t, kind }
  const CAP = opts.cap ?? 0.985;
  const WINDOW_MS = opts.windowMs ?? 4 * 60 * 1000;
  let dpr = 1;

  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
  };

  const draw = () => {
    resize();
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.scale(dpr, dpr);
    const W = w / dpr, H = h / dpr;

    const now = Date.now();
    const t0 = now - WINDOW_MS;
    const x = (t) => ((t - t0) / WINDOW_MS) * W;

    // reference lines
    const line = (v, colour, dash, label) => {
      ctx.save();
      ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(0, y(v, H)); ctx.lineTo(W, y(v, H)); ctx.stroke();
      ctx.setLineDash([]);
      if (label) {
        // Backed, because the trace runs the full width and will sit under it.
        ctx.font = '10px "Azeret Mono", monospace';
        const w = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(8,9,11,.78)";
        ctx.fillRect(2, y(v, H) + 2, w + 6, 13);
        ctx.fillStyle = colour;
        ctx.fillText(label, 5, y(v, H) + 12);
      }
      ctx.restore();
    };
    line(1.000, "rgba(139,147,161,.55)", [], "1.000  redeems");
    line(CAP,   "rgba(79,209,197,.40)", [3, 3], `${CAP.toFixed(3)}  edge floor`);

    const vis = pts.filter((p) => p.t >= t0);
    if (vis.length > 1) {
      // area under the trace, up to unity, the committed cost
      ctx.beginPath();
      ctx.moveTo(x(vis[0].t), y(vis[0].pair, H));
      for (const p of vis) ctx.lineTo(x(p.t), y(p.pair, H));
      ctx.lineTo(x(vis[vis.length - 1].t), H); ctx.lineTo(x(vis[0].t), H); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(79,209,197,.16)"); g.addColorStop(1, "rgba(79,209,197,0)");
      ctx.fillStyle = g; ctx.fill();

      // the trace itself, with bloom
      ctx.save();
      ctx.strokeStyle = "#4fd1c5"; ctx.lineWidth = 1.6;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      if (!reduce) { ctx.shadowColor = "rgba(79,209,197,.75)"; ctx.shadowBlur = 9; }
      ctx.beginPath();
      ctx.moveTo(x(vis[0].t), y(vis[0].pair, H));
      for (const p of vis) ctx.lineTo(x(p.t), y(p.pair, H));
      ctx.stroke();
      ctx.restore();

      // live head
      const last = vis[vis.length - 1];
      ctx.beginPath();
      ctx.arc(x(last.t), y(last.pair, H), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = "#4fd1c5"; ctx.fill();
    }

    // event marks, fills and rolls, on the timeline they happened
    for (const m of marks) {
      if (m.t < t0) continue;
      const mx = x(m.t);
      ctx.save();
      ctx.strokeStyle = m.kind === "fill" ? "rgba(79,209,197,.55)" : "rgba(107,127,168,.5)";
      ctx.lineWidth = 1; ctx.setLineDash(m.kind === "fill" ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
      ctx.restore();
    }

    requestAnimationFrame(draw);
  };
  draw();

  return {
    push(pair) {
      if (pair === undefined || !isFinite(pair)) return;
      const t = Date.now();
      const last = pts[pts.length - 1];
      if (last && t - last.t < 400) return;      // cap sample rate
      pts.push({ t, pair });
      while (pts.length > 2000) pts.shift();
    },
    mark(kind) {
      marks.push({ t: Date.now(), kind });
      while (marks.length > 200) marks.shift();
    },
  };
}
