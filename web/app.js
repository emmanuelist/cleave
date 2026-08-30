// Cleave, view layer. Renders engine state; computes nothing it isn't given.
import { mountGL } from "/gl.js";
import { mountTrace } from "/trace.js";
import { Spring } from "/spring.js";
const $ = (id) => document.getElementById(id);
const f3 = (n) => (n === undefined || n === null ? "" : n.toFixed(3));
const pp = (n) => (n === undefined || n === null ? "" : (n * 100).toFixed(1));

let latest = null;

const gl = mountGL(document.getElementById("gl"));
const trace = mountTrace(document.getElementById("trace"), { cap: 0.985, windowMs: 100_000 });

// Numerals settle like a needle. The edge is the number the whole product is
// about, so it gets physics rather than a tween.
const sEdge = new Spring(0, { stiffness: 120, damping: 16 });
const sPair = new Spring(1, { stiffness: 150, damping: 20 });
let edgeReady = false;

// Effects fire on real transitions only, never on a timer, never on a
// re-render. We diff the engine's own counters and event list.
let seenFills = 0, seenRolls = 0, seenEventAt = 0;

function driveEffects(s) {
  const fills = s.events.filter((e) => e.kind === "fill").length;
  if (s.stats.rolls > seenRolls) { seenRolls = s.stats.rolls; gl?.roll(); trace.mark("roll"); }
  const newest = s.events[0]?.at ?? 0;
  if (newest > seenEventAt) {
    for (const e of s.events) {
      if (e.at <= seenEventAt) break;
      if (e.kind === "fill") { gl?.fill(); trace.mark("fill"); }
    }
    seenEventAt = newest;
  }
  seenFills = fills;
}

let lastT = performance.now();
function animate(now) {
  const dt = (now - lastT) / 1000; lastT = now;
  const e = sEdge.step(dt), p = sPair.step(dt);
  if (edgeReady) {
    document.getElementById("edge").textContent = (e * 100).toFixed(1);
    document.getElementById("rPair").textContent = p.toFixed(3);
    // The ground breathes in proportion to edge, 0 to ~4pp normalised.
    gl?.setEdge(Math.max(0, Math.min(1, e / 0.04)));
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

const V_FLOOR = 0.95;   // vernier window: 0.950 -> 1.000, twentyfold expansion

function renderUnity(s) {
  const up = s.quote.up ?? s.book.upBid;
  const down = s.quote.down ?? s.book.downBid;
  const known = up !== undefined && down !== undefined;
  const pair = known ? up + down : undefined;
  const edge = pair === undefined ? undefined : 1 - pair;

  // Coarse column: percentages of the unit interval. Never px, the column's
  // height comes from its children, so measuring it to size them loops.
  $("segUp").style.height = known ? `${(Math.max(0, up) * 100).toFixed(2)}%` : "0%";
  $("segDown").style.height = known ? `${(Math.max(0, down) * 100).toFixed(2)}%` : "0%";
  $("gap").style.height = known ? `${(Math.max(0, 1 - up - down) * 100).toFixed(2)}%` : "0%";
  $("pUp").textContent = f3(up);
  $("pDown").textContent = f3(down);

  // Vernier: same quantity, expanded. Clamped so a pair below the window
  // floor pins to the bottom rather than escaping the track.
  const frac = pair === undefined ? 0 : Math.min(1, Math.max(0, (1 - pair) / (1 - V_FLOOR)));
  $("vPair").style.top = `${(frac * 100).toFixed(2)}%`;
  $("vGap").style.height = `${(frac * 100).toFixed(2)}%`;
  $("vPaid").style.top = `${(frac * 100).toFixed(2)}%`;
  $("vPairVal").textContent = f3(pair);

  $("rUp").textContent = f3(up);
  $("rDown").textContent = f3(down);
  if (edge === undefined) {
    $("edge").textContent = ""; $("rPair").textContent = "";
  } else {
    if (!edgeReady) { sEdge.jump(edge); sPair.jump(pair); edgeReady = true; }
    else { sEdge.set(edge); sPair.set(pair); }
    trace.push(pair);
  }

  const v = $("verdict");
  if (!known) { v.dataset.state = "idle"; v.textContent = "Acquiring market…"; }
  else if (edge > 0) {
    v.dataset.state = "under";
    v.textContent = `Both outcomes for ${f3(pair)}. Settlement pays 1.000 whichever way it resolves. That is ${pp(edge)}pp, with no directional risk.`;
  } else {
    v.dataset.state = "over";
    v.textContent = `Pair costs ${f3(pair)} against a redemption of 1.000. No edge, so it stands aside.`;
  }
}

function renderBook(elId, topId, levels, mine) {
  const ol = $(elId);
  $(topId).textContent = f3(levels?.[0]?.[0]);
  ol.innerHTML = "";
  if (!levels || !levels.length) {
    const li = document.createElement("li");
    li.className = "empty"; li.textContent = "no resting bids";
    ol.append(li); return;
  }
  const max = Math.max(...levels.map((l) => l[1] || 0), 1);
  for (const [price, size] of levels) {
    const li = document.createElement("li");
    li.style.setProperty("--w", (size / max).toFixed(3));
    if (mine !== undefined && Math.abs(price - mine) < 1e-9) li.className = "mine";
    const p = document.createElement("span"); p.textContent = f3(price);
    const q = document.createElement("span"); q.textContent = size;
    li.append(p, q); ol.append(li);
  }
}

function renderPosition(s) {
  const { up, down } = s.position;
  $("posUp").textContent = up;
  $("posDown").textContent = down;
  const el = $("posState");
  if (up === 0 && down === 0) { el.dataset.state = "flat"; el.textContent = "flat, no exposure"; }
  else if (up === down) { el.dataset.state = "paired"; el.textContent = `${up} complete set${up === 1 ? "" : "s"}, redeems for ${up}.000`; }
  else { el.dataset.state = "naked"; el.textContent = `naked ${up > down ? "Up" : "Down"} ${Math.abs(up - down)}, completing`; }
  $("sRe").textContent = s.stats.reprices;
  $("sRoll").textContent = s.stats.rolls;
  $("sLeg").textContent = s.stats.legEvents;
}

function renderLineage(s) {
  const ol = $("lineage");
  if (!s.lineage.length) { ol.innerHTML = '<li class="lin-empty">No markets yet</li>'; return; }
  ol.innerHTML = "";
  for (const m of s.lineage) {
    const li = document.createElement("li");
    li.className = m.state;
    const sym = document.createElement("span");
    sym.className = "sym"; sym.textContent = m.symbol.replace("/tUSDC#YES", "");
    const tag = document.createElement("span");
    tag.className = "tag"; tag.textContent = m.state === "active" ? "QUOTING" : "EXPIRED";
    li.append(sym, tag); ol.append(li);
  }
}

function renderEvents(s) {
  const ol = $("events");
  if (!s.events.length) { ol.innerHTML = '<li class="ev-empty">Waiting for the engine…</li>'; return; }
  ol.innerHTML = "";
  for (const e of s.events) {
    const li = document.createElement("li");
    li.dataset.k = e.kind;
    const t = document.createElement("span");
    t.className = "t"; t.textContent = new Date(e.at).toTimeString().slice(0, 8);
    const k = document.createElement("span");
    k.className = "k"; k.textContent = e.kind.toUpperCase();
    const x = document.createElement("span"); x.textContent = e.text;
    li.append(t, k, x); ol.append(li);
  }
}

function renderChrome(s) {
  $("market").textContent = s.market ? s.market.up.replace("/tUSDC#YES", "") : "";
  const mode = $("mode");
  mode.dataset.live = String(s.live);
  mode.textContent = s.live ? "LIVE" : "READ-ONLY";
}

function tickCountdown() {
  const el = $("countdown");
  if (!latest?.market?.expiry) { el.textContent = ""; return; }
  const ms = latest.market.expiry - Date.now();
  if (ms <= 0) { el.textContent = "expired"; return; }
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  el.textContent = h > 0
    ? `${h}h ${String(m).padStart(2, "0")}m to expiry`
    : `${m}:${String(sec).padStart(2, "0")} to expiry`;
}

function render(s) {
  latest = s;
  driveEffects(s);
  renderChrome(s);
  renderUnity(s);
  renderBook("bUp", "bUpTop", s.book.upDepth, s.quote.up);
  renderBook("bDown", "bDownTop", s.book.downDepth, s.quote.down);
  renderPosition(s);
  renderLineage(s);
  renderEvents(s);
  tickCountdown();
}

document.body.classList.add("boot");
addEventListener("load", () => setTimeout(() => document.body.classList.remove("boot"), 1400));

const src = new EventSource("/api/stream");
src.onmessage = (e) => { $("conn").dataset.on = "true"; $("conn").textContent = "live"; render(JSON.parse(e.data)); };
src.onerror = () => { $("conn").dataset.on = "false"; $("conn").textContent = "reconnecting…"; };
setInterval(tickCountdown, 1000);
addEventListener("resize", () => latest && renderUnity(latest));
