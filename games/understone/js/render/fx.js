// Particle & juice engine — recipes and budgets from research/terraria/10-elemental-fx.md.
// SoA pool (zero alloc), two blend passes (source-over, then 'lighter'), stepped color
// ramps, midpoint-displacement lightning, hit-stop + trauma screenshake.

const N = 512;               // pool cap
const THROTTLE_AT = 300;     // halve spawns above this
const MAX_BOLTS = 4;

// particle kinds — update behavior + ramp + blend per kind
export const K = { FIRE: 0, SMOKE: 1, DROPLET: 2, BUBBLE: 3, FROST: 4, MIST: 5, WISP: 6, EMBER: 7, SPARK: 8, DUST: 9, GLINT: 10 };

const ADDITIVE = new Set([K.FIRE, K.FROST, K.WISP, K.EMBER, K.SPARK, K.GLINT]);

// stepped ramps: t = life/maxLife (1 = fresh) → color
function rampFire(t) { return t > 0.85 ? '#ffffff' : t > 0.6 ? '#ffe08a' : t > 0.35 ? '#ff9a3c' : '#d43d2a'; }
function rampFrost(t) { return t > 0.66 ? '#ffffff' : t > 0.33 ? '#a8e6ff' : '#4aa8d8'; }
function rampWisp(t) { return t > 0.75 ? '#efe0ff' : t > 0.5 ? '#b968ff' : t > 0.25 ? '#7a2bd9' : '#3d1166'; }

export class FX {
  constructor() {
    // SoA pool
    this.x = new Float32Array(N); this.y = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N);
    this.life = new Int16Array(N); this.maxLife = new Int16Array(N);
    this.kind = new Uint8Array(N); this.size = new Uint8Array(N);
    this.seed = new Float32Array(N);
    this.colorOverride = new Array(N).fill(null);
    this.count = 0;
    this.bolts = [];           // {pts, branches, life, maxLife, a, b, tint}
    // juice
    this.freezeTimer = 0;      // hit-stop: sim pauses, render continues
    this.trauma = 0;           // screenshake
    this.tick = 0;
  }

  throttled() { return this.count >= THROTTLE_AT; }

  spawn(kind, x, y, vx, vy, life, size = 2, colorOverride = null) {
    if (this.count >= N) return;
    if (this.throttled() && (this.tick & 1)) return;   // halve spawn rate under load
    const i = this.count++;
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.seed[i] = Math.random() * 100;
    this.colorOverride[i] = colorOverride;
  }

  // ---- emitters (doc §1-4) ---------------------------------------------------
  fire(x, y, n = 1, life = 30) {
    for (let i = 0; i < n; i++) {
      this.spawn(K.FIRE, x + (Math.random() - 0.5) * 4, y,
        (Math.random() - 0.5), -0.5 - Math.random(), life - 6 + (Math.random() * 12 | 0), 3);
    }
  }
  smoke(x, y) { this.spawn(K.SMOKE, x, y, (Math.random() - 0.5) * 0.2, -0.3, 40, 3); }
  fireTrail(x, y, dirX) {
    if (Math.random() < 0.66) {
      this.spawn(K.FIRE, x, y, dirX * 0.5 + (Math.random() - 0.5) * 0.6, -0.5 + (Math.random() - 0.5) * 0.6,
        12 + (Math.random() * 8 | 0), 2);
    }
  }
  burning(e) {
    const n = Math.max(1, Math.min(4, Math.floor(e.w * e.h / 160)));
    for (let i = 0; i < n; i++) {
      this.spawn(K.FIRE, e.x + Math.random() * e.w, e.y + Math.random() * e.h,
        0, -0.4 - Math.random() * 0.8, 18 + (Math.random() * 8 | 0), 2);
    }
    if (this.tick % 8 === 0) this.smoke(e.x + e.w / 2, e.y);
  }
  splash(x, y, nx = 0, ny = -1, impact = 1) {
    const n = 8 + (Math.random() * 6 | 0);
    const base = Math.atan2(ny, nx);
    const f = Math.max(0.5, Math.min(2, impact));
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * (Math.PI / 1.5);
      const sp = (1 + Math.random() * 1.5) * f;
      this.spawn(K.DROPLET, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 20 + (Math.random() * 15 | 0),
        Math.random() < 0.17 ? 1 : 2);
    }
  }
  bubble(x, y) { this.spawn(K.BUBBLE, x, y, (Math.random() - 0.5) * 0.2, -0.3, 30 + (Math.random() * 20 | 0), 2); }
  frostBurst(x, y) {
    const n = 6 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random();
      this.spawn(K.FROST, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 15 + (Math.random() * 10 | 0), 2);
    }
  }
  mist(x, y) { this.spawn(K.MIST, x, y, (Math.random() - 0.5) * 0.2, -0.2, 30, 3); }
  shadowWisp(x, y) {
    this.spawn(K.WISP, x, y, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 20 + (Math.random() * 10 | 0), 2);
  }
  ember(x, y, color = '#d18aff') { this.spawn(K.EMBER, x, y, (Math.random() - 0.5) * 0.3, 0.05, 25, 1, color); }
  sparks(x, y, color = '#ffd75a', n = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2;
      this.spawn(K.SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 1, 10 + (Math.random() * 8 | 0), 1, color);
    }
  }
  digDust(x, y, color) {
    for (let i = 0; i < 5; i++) {
      this.spawn(K.DUST, x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 1.4, -0.5 - Math.random(), 14 + (Math.random() * 10 | 0), 2, color);
    }
  }
  glint(x, y) { this.spawn(K.GLINT, x, y, 0, 0, 3, 1); }

  // ---- lightning (doc §2) ------------------------------------------------------
  boltStrike(ax, ay, bx, by, tint = '#cfd8ff') {
    if (this.bolts.length >= MAX_BOLTS) this.bolts.shift();
    const b = { a: [ax, ay], b: [bx, by], life: 10, maxLife: 10, tint, pts: null, branches: [] };
    this.regenBolt(b);
    this.bolts.push(b);
    this.trauma = Math.min(1, this.trauma + 0.15);
  }
  regenBolt(b) {
    b.pts = this.genBolt(b.a, b.b, 4);
    b.branches = [];
    const nBr = 2 + (Math.random() * 3 | 0);
    const dx = b.b[0] - b.a[0], dy = b.b[1] - b.a[1];
    const len = Math.hypot(dx, dy);
    for (let i = 0; i < nBr; i++) {
      const t = 0.2 + Math.random() * 0.6;
      const px = b.a[0] + dx * t, py = b.a[1] + dy * t;
      const ang = Math.atan2(dy, dx) + (i % 2 ? 1 : -1) * 0.52 * (0.7 + Math.random() * 0.6);
      const bl = len * (0.3 + Math.random() * 0.2);
      b.branches.push(this.genBolt([px, py], [px + Math.cos(ang) * bl, py + Math.sin(ang) * bl], 3));
    }
  }
  genBolt(a, b, gens) {
    let pts = [a, b];
    let offset = Math.hypot(b[0] - a[0], b[1] - a[1]) / 4;
    for (let g = 0; g < gens; g++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        // normal of segment
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const d = Math.hypot(dx, dy) || 1;
        const off = (Math.random() * 2 - 1) * offset;
        next.push([mx + (-dy / d) * off, my + (dx / d) * off], q);
      }
      pts = next;
      offset *= 0.5;
    }
    return pts;
  }

  // ---- juice ----------------------------------------------------------------------
  hitStop(ticks) { this.freezeTimer = Math.max(this.freezeTimer, ticks); }
  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }
  shakeOffset() {
    const shake = this.trauma * this.trauma;
    if (shake < 0.001) return [0, 0];
    const t = this.tick * 0.35;
    // cheap continuous noise via layered sines
    const nx = Math.sin(t * 1.3 + 1.7) * 0.6 + Math.sin(t * 2.7) * 0.4;
    const ny = Math.sin(t * 1.1 + 4.2) * 0.6 + Math.sin(t * 3.1 + 2) * 0.4;
    return [Math.round(6 * shake * nx), Math.round(6 * shake * ny)];
  }

  // ---- sim -----------------------------------------------------------------------
  update() {
    this.tick++;
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - 0.022);
    for (let i = 0; i < this.count; i++) {
      const k = this.kind[i];
      if (k === K.FIRE) {
        this.vx[i] += (Math.random() - 0.5) * 0.3;
        this.vy[i] -= 0.02;
      } else if (k === K.DROPLET || k === K.DUST) {
        this.vy[i] += 0.12;
      } else if (k === K.FROST) {
        this.vx[i] *= 0.85; this.vy[i] *= 0.85;
      } else if (k === K.WISP) {
        const a = Math.sin(this.tick * 0.15 + this.seed[i]) * Math.PI * 2;
        this.vx[i] += Math.cos(a) * 0.08; this.vy[i] += Math.sin(a) * 0.08;
        this.vx[i] *= 0.92; this.vy[i] *= 0.92;
      } else if (k === K.BUBBLE) {
        this.x[i] += Math.sin(this.tick * 0.2 + this.seed[i]) * 0.3;
      } else if (k === K.SPARK) {
        this.vy[i] += 0.15;
      }
      this.x[i] += this.vx[i];
      this.y[i] += this.vy[i];
      if (--this.life[i] <= 0) {
        // fire becomes smoke at death (30% chance)
        if (k === K.FIRE && Math.random() < 0.3 && this.count < N) this.smoke(this.x[i], this.y[i]);
        const last = --this.count;
        if (i !== last) {
          this.x[i] = this.x[last]; this.y[i] = this.y[last];
          this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
          this.kind[i] = this.kind[last]; this.size[i] = this.size[last];
          this.seed[i] = this.seed[last]; this.colorOverride[i] = this.colorOverride[last];
          i--;
        }
      }
    }
    // bolts: regenerate geometry every 3 ticks (flicker), fade in 3 alpha steps
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      if (--b.life <= 0) { this.bolts.splice(i, 1); continue; }
      if (b.life % 3 === 0) this.regenBolt(b);
    }
  }

  particleColor(i) {
    if (this.colorOverride[i]) return this.colorOverride[i];
    const t = this.life[i] / this.maxLife[i];
    switch (this.kind[i]) {
      case K.FIRE: return rampFire(t);
      case K.SMOKE: return '#55504f';
      case K.DROPLET: return Math.random() < 0.15 ? '#d7f0ff' : '#7db7e8';
      case K.BUBBLE: return t < 0.1 ? '#ffffff' : '#bfe6ff';
      case K.FROST: return rampFrost(t);
      case K.MIST: return '#cfeefc';
      case K.WISP: return rampWisp(t);
      case K.GLINT: return '#ffffff';
      default: return '#c8c8c8';
    }
  }

  draw(ctx, camera, alpha) {
    const [oxRaw, oyRaw] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const ox = oxRaw, oy = oyRaw;
    let lastStyle = null, lastAlpha = 1;
    const setStyle = (s) => { if (s !== lastStyle) { ctx.fillStyle = s; lastStyle = s; } };
    const setAlpha = (a) => { if (a !== lastAlpha) { ctx.globalAlpha = a; lastAlpha = a; } };

    // pass 1: source-over kinds
    for (let i = 0; i < this.count; i++) {
      if (ADDITIVE.has(this.kind[i])) continue;
      const t = this.life[i] / this.maxLife[i];
      const k = this.kind[i];
      setAlpha(k === K.SMOKE || k === K.MIST ? 0.33 : t < 0.3 ? 0.5 : 1);
      setStyle(this.particleColor(i));
      const s = (t > 0.5 ? this.size[i] : Math.max(1, this.size[i] - 1)) * z;
      ctx.fillRect(Math.floor((this.x[i] - ox) * z), Math.floor((this.y[i] - oy) * z), s, s);
    }
    // pass 2: additive
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.count; i++) {
      if (!ADDITIVE.has(this.kind[i])) continue;
      const t = this.life[i] / this.maxLife[i];
      const k = this.kind[i];
      if (k === K.EMBER && (this.tick + i) % 5 === 0) continue;    // ember flicker
      setAlpha(k === K.FROST && t <= 0.7 ? 0.7 : 1);
      setStyle(this.particleColor(i));
      const s = (t > 0.5 ? this.size[i] : Math.max(1, this.size[i] - 1)) * z;
      ctx.fillRect(Math.floor((this.x[i] - ox) * z), Math.floor((this.y[i] - oy) * z), s, s);
    }
    // bolts: two-pass stroke (glow then core), no shadowBlur
    for (const b of this.bolts) {
      const a = b.life > 6 ? 1 : b.life > 3 ? 0.66 : 0.33;
      for (const [pts, wGlow, wCore] of [[b.pts, 3, 1]]) {
        this.strokeBolt(ctx, pts, ox, oy, z, b.tint, a * 0.35, wGlow * z);
        this.strokeBolt(ctx, pts, ox, oy, z, '#ffffff', a, wCore * z);
      }
      for (const br of b.branches) {
        this.strokeBolt(ctx, br, ox, oy, z, b.tint, a * 0.25, 2 * z);
        this.strokeBolt(ctx, br, ox, oy, z, '#ffffff', a * 0.6, 1 * z);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  strokeBolt(ctx, pts, ox, oy, z, style, alpha, width) {
    ctx.strokeStyle = style;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(Math.floor((pts[0][0] - ox) * z), Math.floor((pts[0][1] - oy) * z));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(Math.floor((pts[i][0] - ox) * z), Math.floor((pts[i][1] - oy) * z));
    }
    ctx.stroke();
  }
}
