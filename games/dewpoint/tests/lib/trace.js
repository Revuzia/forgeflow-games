// State tracing for regression proofs (tests/golden-water.test.js, tests/tools/golden-trace.js).
//
// traceRun(play, level, script) plays `script(runner)` and records the player's state:
//   - a SAMPLE every SAMPLE_TICKS ticks: [tick, x, y, z, vx, vy, vz, form, gauge, hash]
//   - `hash` covers EVERY tick since the run began (player position, velocity, gauge, form,
//     grounded, deaths, shards, and every crate / mover / door), so a difference on any single
//     tick changes every later sample, and the first differing sample brackets it to 0.5 s.
//   - the finish: tick, time in ms, shards, deaths and the sim's own fingerprint string.
// Numbers are stored as plain JSON numbers, which round-trip IEEE doubles exactly, so
// "identical" means bit-identical.
//
// The same file is used to record the golden data from the pristine snapshot and to replay it
// against the working tree; it only relies on the Runner having `tick`, `sim` and `p`.

export const SAMPLE_TICKS = 60;

const buf = new Float64Array(1);
const bytes = new Uint8Array(buf.buffer);

/** Two interleaved 32-bit FNV-1a hashes over the IEEE bytes of each number (and string chars). */
export class Hash {
  constructor() { this.a = 0x811c9dc5; this.b = 0x01000193 ^ 0x5bd1e995; }
  num(v) {
    buf[0] = v;
    let a = this.a, b = this.b;
    for (let i = 0; i < 8; i++) { a = Math.imul(a ^ bytes[i], 0x01000193); b = Math.imul(b ^ bytes[7 - i], 0x85ebca6b) + 0x1b873593 | 0; }
    this.a = a; this.b = b;
  }
  str(s) { for (let i = 0; i < s.length; i++) this.num(s.charCodeAt(i)); }
  hex() { return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0'); }
}

export function traceRun(play, level, script) {
  const r = play(level);
  const h = new Hash();
  const samples = [];
  const tick = r.tick.bind(r);
  r.tick = (...args) => {
    tick(...args);
    const s = r.sim, p = s.player, L = s.level;
    h.num(p.x); h.num(p.y); h.num(p.z); h.num(p.vx); h.num(p.vy); h.num(p.vz); h.num(p.gauge);
    h.str(p.form); h.num(p.grounded ? 1 : 0); h.num(s.deaths); h.num(s.shardsTaken.length); h.num(s.completed ? 1 : 0);
    for (const c of L.crates) { h.num(c.body.x); h.num(c.body.y); h.num(c.body.z); }
    for (const m of L.movers) h.num(m.t);
    for (const d of L.doors) h.num(d.open);
    if (s.tick % SAMPLE_TICKS === 0) samples.push([s.tick, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.form, p.gauge, h.hex()]);
  };
  script(r);
  const res = r.result();
  return {
    samples,
    finish: {
      tick: r.sim.tick, completed: r.sim.completed, timeMs: res ? res.timeMs : null, shards: res ? res.shards : null,
      deaths: r.sim.deaths, hash: h.hex(), fingerprint: r.sim.fingerprint(),
    },
  };
}

/** First difference between two traces as a readable string, or '' when they are identical. */
export function diffTrace(want, got) {
  const n = Math.min(want.samples.length, got.samples.length);
  const names = ['tick', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'form', 'gauge', 'hash'];
  for (let i = 0; i < n; i++) {
    const a = want.samples[i], b = got.samples[i];
    for (let k = 0; k < a.length; k++) {
      if (a[k] !== b[k]) return `sample ${i} (tick ${a[0]}, t=${(a[0] / 120).toFixed(2)} s): ${names[k]} expected ${a[k]}, got ${b[k]}\n  golden: ${JSON.stringify(a)}\n  now:    ${JSON.stringify(b)}`;
    }
  }
  if (want.samples.length !== got.samples.length) return `trace length: expected ${want.samples.length} samples, got ${got.samples.length}`;
  for (const k of Object.keys(want.finish)) {
    if (JSON.stringify(want.finish[k]) !== JSON.stringify(got.finish[k])) return `finish.${k}: expected ${JSON.stringify(want.finish[k])}, got ${JSON.stringify(got.finish[k])}`;
  }
  return '';
}
