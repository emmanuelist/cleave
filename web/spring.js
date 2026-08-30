/** Critically-ish damped spring. Numerals settle like a needle, not a tween. */
export class Spring {
  constructor(value = 0, { stiffness = 170, damping = 22, mass = 1 } = {}) {
    this.v = value; this.target = value; this.vel = 0;
    this.k = stiffness; this.d = damping; this.m = mass;
  }
  set(t) { this.target = t; }
  jump(t) { this.target = this.v = t; this.vel = 0; }
  step(dt) {
    dt = Math.min(dt, 1 / 30);
    const f = -this.k * (this.v - this.target) - this.d * this.vel;
    this.vel += (f / this.m) * dt;
    this.v += this.vel * dt;
    if (Math.abs(this.vel) < 1e-4 && Math.abs(this.v - this.target) < 1e-4) {
      this.v = this.target; this.vel = 0;
    }
    return this.v;
  }
}
