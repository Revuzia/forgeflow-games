// Seeded scenario generators (verifier's own; different seeds, pitches and timings from the probe).
export const mul32 = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const U = (r, a, b) => a + (b - a) * r();
const LU = (r, a, b) => a * Math.pow(b / a, r());
const sm = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };

/**
 * Gestures. Each pushes calls into ev and returns { end, n (discrete interactions), spans: [{kind, at, len}] }.
 * frame(): next frame time step (60 Hz +/- jitter).
 */
function gesture(kind, t, ctx) {
  const { r, ev, P, pan, frameHz = 60, jitter = 0.2 } = ctx;
  const dtf = () => (1 / frameHz) * (1 + jitter * (2 * r() - 1));
  const spans = [];
  let n = 0, end = t;
  const one = (op, a, len) => { ev.push({ t, op, a }); spans.push({ kind: op, at: t, len }); n++; end = t + len; };
  switch (kind) {
    case 'poke': one('poke', { intensity: U(r, 0.12, 1), pitch: P, pan }, 0.16); break;
    case 'pop': one('pop', { size: U(r, 0.15, 0.95), pitch: P, pan }, 0.15); break;
    case 'land': one('land', { intensity: U(r, 0.2, 0.9), pitch: P }, 0.13); break;
    case 'bumps': {
      const k = 1 + Math.floor(r() * 4);
      let u = t;
      for (let i = 0; i < k; i++) { ev.push({ t: u, op: 'bump', a: { intensity: U(r, 0.1, 0.95), pitch: P * U(r, 0.9, 1.1), pan: U(r, -0.6, 0.6) } }); spans.push({ kind: 'bump', at: u, len: 0.25 }); n++; end = u + 0.25; u += U(r, 0.06, 0.25); }
      break;
    }
    case 'squeeze': {
      const id = 'h' + Math.floor(r() * 1e9);
      const dur = U(r, 0.35, 1.6), cmax = U(r, 0.3, 0.95), att = U(r, 0.15, 0.5), rub = r() < 0.5 ? U(r, 1.5, 3.5) : 0;
      ev.push({ t, op: 'squishStart', id, a: { pitch: P, pan } }); n++;
      let u = t, prevC = 0, rate = 0;
      while (u < t + dur) {
        const x = u - t;
        const c = cmax * sm(x / att) + (rub && x > att ? 0.08 * Math.sin(2 * Math.PI * rub * (x - att)) : 0);
        const d = dtf();
        const inst = (c - prevC) / d;
        rate += (inst - rate) * (1 - Math.exp(-d / 0.06));
        prevC = c;
        ev.push({ t: u, op: 'squishUpdate', id, a: { compression: Math.max(0, c), rate } });
        u += d;
      }
      // spring back over 0.12 s
      for (let k = 1; k <= 7; k++) { const uu = u + k * 0.017; ev.push({ t: uu, op: 'squishUpdate', id, a: { compression: Math.max(0, prevC * (1 - k / 7)), rate: -prevC / 0.12 } }); }
      u += 0.13;
      ev.push({ t: u, op: 'squishEnd', id, a: {} });
      ev.push({ t: u, op: 'release', a: { compression: cmax, pitch: P, pan } }); n++;
      spans.push({ kind: 'squish', at: t, len: u - t }, { kind: 'release', at: u, len: 0.35 });
      end = u + 0.35;
      break;
    }
    case 'pickup': {
      ev.push({ t, op: 'lift', a: { pitch: P, pan } }); spans.push({ kind: 'lift', at: t, len: 0.4 }); n++;
      const dur = U(r, 0.35, 1.1), Tm = U(r, 0.55, 1);
      let u = t + 0.05;
      while (u < t + 0.05 + dur) { ev.push({ t: u, op: 'strand', a: { tension: Tm * sm((u - t - 0.05) / dur), pitch: P, pan } }); u += dtf(); }
      ev.push({ t: u, op: 'strand', a: { tension: Tm, snap: true, pitch: P, pan } }); n++;
      spans.push({ kind: 'strand', at: t + 0.05, len: u - t - 0.05 }, { kind: 'strandSnap', at: u, len: 0.35 });
      const tt = u + U(r, 0.15, 0.6);
      ev.push({ t: tt, op: 'toss', a: { speed: U(r, 0.12, 1), pan } }); spans.push({ kind: 'toss', at: tt, len: 0.45 }); n++;
      const tl = tt + U(r, 0.35, 0.9);
      ev.push({ t: tl, op: 'land', a: { intensity: U(r, 0.25, 0.9), pitch: P } }); spans.push({ kind: 'land', at: tl, len: 0.13 }); n++;
      end = tl + 0.13;
      break;
    }
    default: throw new Error(kind);
  }
  return { end, n, spans };
}

const KINDS = [['poke', 0.35], ['squeeze', 0.2], ['pop', 0.1], ['bumps', 0.15], ['pickup', 0.12], ['land', 0.08]];
function pick(r) { let x = r(); for (const [k, p] of KINDS) { if ((x -= p) < 0) return k; } return 'poke'; }

/** Continuous play from t0 to t1 at a target rate (interactions/s) that wanders between lo and hi. */
export function playScenario(seed, t0, t1, { lo = 3, hi = 6, frameHz = 60, jitter = 0.2 } = {}) {
  const r = mul32(seed);
  const ev = [], spans = [];
  let t = t0, P = LU(r, 0.7, 1.43), nextP = t0 + U(r, 8, 15), n = 0;
  let target = U(r, lo, hi);
  while (t < t1) {
    if (t > nextP) { P = LU(r, 0.7, 1.43); nextP = t + U(r, 8, 15); }
    target = Math.min(hi, Math.max(lo, target + U(r, -0.4, 0.4)));
    const g = gesture(pick(r), t, { r, ev, P, pan: U(r, -0.7, 0.7), frameHz, jitter });
    spans.push(...g.spans); n += g.n;
    // next gesture: overlap allowed (another hand / the pile): exponential gaps scaled so that n/s ~ target
    const per = g.n / target;
    t = t + Math.max(0.05, per * (-Math.log(1 - r())));
  }
  return { ev, spans, n, rate: n / (t1 - t0) };
}

/** Sparse: one gesture, then a gap log-uniform in [gLo, gHi] after it ends. */
export function sparseScenario(seed, t0, t1, { gLo = 1, gHi = 4, kinds = null } = {}) {
  const r = mul32(seed);
  const ev = [], spans = [];
  let t = t0, P = LU(r, 0.7, 1.43), n = 0;
  while (t < t1) {
    const k = kinds ? kinds[Math.floor(r() * kinds.length)] : pick(r);
    const g = gesture(k, t, { r, ev, P, pan: U(r, -0.7, 0.7) });
    spans.push(...g.spans); n += g.n;
    t = g.end + LU(r, gLo, gHi);
    if (r() < 0.15) P = LU(r, 0.7, 1.43);
  }
  return { ev, spans, n, rate: n / (t1 - t0) };
}

/** Isolated one-shots for separation (each effect's window is clear of the next): random variant, random pitch. */
export function placements(seed, t0, t1, gap = null) {
  const r = mul32(seed);
  const ev = [], spans = [];
  let t = t0;
  const kinds = ['poke', 'pop', 'land', 'bumps1', 'squeeze', 'pickup', 'toss', 'lift', 'release'];
  while (t < t1 - 3) {
    const k = kinds[Math.floor(r() * kinds.length)];
    const P = LU(r, 0.7, 1.43), pan = U(r, -0.6, 0.6);
    let g;
    if (k === 'bumps1') { ev.push({ t, op: 'bump', a: { intensity: U(r, 0.05, 1), pitch: P, pan } }); g = { end: t + 0.25, spans: [{ kind: 'bump', at: t, len: 0.25 }] }; }
    else if (k === 'toss') { ev.push({ t, op: 'toss', a: { speed: U(r, 0.1, 1), pan } }); g = { end: t + 0.45, spans: [{ kind: 'toss', at: t, len: 0.45 }] }; }
    else if (k === 'lift') { ev.push({ t, op: 'lift', a: { pitch: P, pan } }); g = { end: t + 0.4, spans: [{ kind: 'lift', at: t, len: 0.4 }] }; }
    else if (k === 'release') { ev.push({ t, op: 'release', a: { compression: U(r, 0.1, 1), pitch: P, pan } }); g = { end: t + 0.35, spans: [{ kind: 'release', at: t, len: 0.35 }] }; }
    else if (k === 'pickup') {
      // just the strand + snap (no lift/toss/land: those are placed alone)
      const dur = U(r, 0.4, 1.2), Tm = U(r, 0.5, 1);
      let u = t; const hz = U(r, 30, 120);
      while (u < t + dur) { ev.push({ t: u, op: 'strand', a: { tension: Tm * sm((u - t) / dur), pitch: P, pan } }); u += (1 / hz) * (1 + 0.3 * (2 * r() - 1)); }
      ev.push({ t: u, op: 'strand', a: { tension: Tm, snap: true, pitch: P, pan } });
      g = { end: u + 0.4, spans: [{ kind: 'strand', at: t, len: u - t }, { kind: 'strandSnap', at: u, len: 0.35 }] };
    } else g = gesture(k, t, { r, ev, P, pan });
    spans.push(...g.spans);
    t = gap ? g.end + U(r, gap[0], gap[1]) : g.end + 0.15 + LU(r, 0.15, 3.5);
  }
  return { ev, spans };
}
