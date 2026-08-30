/**
 * The ground. A single fullscreen quad, WebGL2, no dependency.
 *
 * Everything it renders is driven by live state:
 *   uEdge   — how much edge exists right now. Drives the field's motion: it
 *             breathes when there is edge and goes still when there is none.
 *   uPulse  — a shockwave per fill. Real fills only; never a timer.
 *   uRoll   — a sweep when the market rolls.
 *
 * Degrades to a static CSS gradient if WebGL2 is unavailable or the viewer
 * prefers reduced motion.
 */
const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2  uRes;
uniform float uTime;
uniform float uEdge;      // 0..1, normalised edge
uniform float uPulse;     // seconds since last fill (large = idle)
uniform float uRoll;      // seconds since last rollover
uniform vec2  uMouse;     // 0..1

// value noise + fbm — cheap, stable, no texture
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.545); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 q = uv; q.x *= uRes.x / uRes.y;

  // Breathing is proportional to edge. No edge, no motion — the panel goes
  // still exactly when the strategy stands aside.
  float breath = 0.25 + uEdge * 0.75;
  float t = uTime * (0.012 + uEdge * 0.035);

  // Volumetric depth: two drifting fbm layers at different rates.
  float d1 = fbm(q * 2.1 + vec2(t, t * 0.6));
  float d2 = fbm(q * 4.7 - vec2(t * 0.8, t * 1.3));
  float d3 = fbm(q * 0.9 + vec2(t * 0.25, -t * 0.4));
  float vol = mix(mix(d1, d2, 0.45), d3, 0.35);

  // Depth falls away from the reading area (upper left), so the instrument
  // sits in a lit volume rather than on a flat ground.
  vec2 focus = vec2(0.30, 0.62);
  float r = distance(vec2(q.x / (uRes.x/uRes.y), uv.y), focus);
  float lit = smoothstep(1.05, 0.06, r);

  // Cursor adds a faint parallax lift — presence, not decoration.
  float m = smoothstep(0.55, 0.0, distance(uv, uMouse));

  float base = 0.10 + vol * 0.34 * breath + lit * 0.52 + m * 0.16;

  // Shockwave on a real fill: an expanding ring, ~1.4s of life.
  float ring = 0.0;
  if (uPulse < 1.4) {
    float age = uPulse / 1.4;
    float radius = age * 1.25;
    float band = abs(r - radius);
    ring = smoothstep(0.055, 0.0, band) * (1.0 - age) * 0.85;
  }

  // Rollover: a vertical sweep, so a market change is felt, not just listed.
  float sweep = 0.0;
  if (uRoll < 1.1) {
    float age = uRoll / 1.1;
    sweep = smoothstep(0.10, 0.0, abs(uv.y - (1.0 - age))) * (1.0 - age) * 0.5;
  }

  vec3 ground = vec3(0.085, 0.105, 0.135) * (base * 11.0);
  vec3 teal   = vec3(0.31, 0.82, 0.77);
  vec3 col = ground
           + teal * ring * 1.35
           + teal * sweep * 0.85
           + teal * lit * 0.16 * breath
           + vec3(0.10,0.16,0.26) * vol * lit * 0.55;

  // Chromatic drift at the periphery — lens character, strongest where the
  // eye is not reading.
  float ca = smoothstep(0.25, 1.0, r) * 0.006;
  col.r += fbm((q + vec2(ca, 0.0)) * 3.0) * 0.022;
  col.b += fbm((q - vec2(ca, 0.0)) * 3.0) * 0.032;

  // Grain: breaks banding on large dark gradients.
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.020;

  o = vec4(col, 1.0);
}`;

export function mountGL(canvas) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl || reduce) { canvas.style.display = "none"; return null; }

  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.style.display = "none"; return null; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); canvas.style.display = "none"; return null; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = (n) => gl.getUniformLocation(prog, n);
  const u = { res: U("uRes"), time: U("uTime"), edge: U("uEdge"), pulse: U("uPulse"), roll: U("uRoll"), mouse: U("uMouse") };

  const state = { edge: 0, lastFill: -1e9, lastRoll: -1e9, mouse: [0.5, 0.5] };
  let raf = 0, dpr = Math.min(devicePixelRatio || 1, 2);

  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  };
  addEventListener("resize", resize); resize();
  addEventListener("pointermove", (e) => {
    state.mouse = [e.clientX / innerWidth, 1 - e.clientY / innerHeight];
  }, { passive: true });

  const t0 = performance.now();
  const frame = () => {
    const now = (performance.now() - t0) / 1000;
    resize();
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, now);
    gl.uniform1f(u.edge, state.edge);
    gl.uniform1f(u.pulse, now - state.lastFill);
    gl.uniform1f(u.roll, now - state.lastRoll);
    gl.uniform2f(u.mouse, state.mouse[0], state.mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  };
  frame();

  // Pause when hidden — nothing renders that nobody can see.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf); else frame();
  });

  const since = () => (performance.now() - t0) / 1000;
  return {
    setEdge: (e) => { state.edge = Math.max(0, Math.min(1, e)); },
    fill: () => { state.lastFill = since(); },
    roll: () => { state.lastRoll = since(); },
  };
}
