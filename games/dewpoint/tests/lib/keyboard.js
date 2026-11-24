// Keyboard player model: what a person with W/A/S/D, Space, 1-4 and R can do, and nothing else.
//
// It wraps the scripted-input helper (tests/lib/play.js, the Runner) but the Runner is only ever driven through
// `runner.tick(mx, mz, jump, form, restart)` with the vector a real keyboard produces. The mapping is
// src/ui/input.js exactly:
//   x = D - A, y = W - S (a diagonal is normalised to length 1), then, for the camera yaw `yaw` (radians),
//   mx = x cos(yaw) - y sin(yaw),  mz = -x sin(yaw) - y cos(yaw)         (camera forward = (-sin yaw, -cos yaw))
// so a keyboard player has exactly 8 move directions relative to the camera, always at full stick (there is no
// "half stick" on a key). Space is the jump (a press shorter than a frame still counts for one tick: the latch);
// keys 1-4 request the form in that slot of the active element (sim.element.forms: nothing here knows water or
// fire); pressing the key of the form you are in is its special; R restarts.
//
// THE CAMERA. The yaw starts at the level's `camYaw` and changes only when the script calls `orbit()` /
// `orbitTo()` (a mouse drag, modelled at `HUMAN.orbitRate` = 120 deg/s, and the game keeps running while it
// happens). `k.orbits` / `k.orbitDeg` count them so a level can be judged on how often it makes a player do it.
// By default the game's own camera rig (src/render/camera.js, via tests/lib/camera-check.js rigFor) runs alongside
// and the keys are read against ITS control yaw, exactly as src/main.js does; the rig never turns the controls by
// itself (no recentre; its swing round walls is a picture-only offset), so `maxDrift` stays 0 unless that breaks.
// `rig: false` holds the yaw fixed instead; `rig: (sim) => ...` supplies another rig.
//
// HUMAN TIMING (HUMAN below):
//   - the game reads the keyboard once per rendered frame (1/60 s = 2 sim ticks): every input change lands on a frame;
//   - `minGap` (0.15 s): no input change sooner than that after the previous one (a chord - W and Space together,
//     or `hold('W D')` - is one change; a tap is two: down, then up at least minGap later);
//   - `latency` (0.15 s): from the moment something is true on screen to the key change it triggers. Every
//     reaction (the first press after a condition, a release "when I get there") pays it;
//   - JITTER on top of every reaction: `{ shift: +-0.15 }` delays (or hurries) every reaction by that much,
//     `{ seed, amp: 0.15 }` draws each reaction's shift from a seeded uniform(-amp, amp). Timed holds (a tap, a
//     jump held for 0.4 s) are measured from their own press, so a constant shift keeps them whole (a seeded
//     jitter also perturbs them by +-holdNoise).
// A script is therefore written like a person plays: press, watch for the moment, release - and it passes only
// if it survives every reaction being up to 0.15 s early or late.
//
// SCRIPTING (every method returns `this`; a key string is e.g. 'W', 'WD', 'S A', 'W Space', or a world heading
// '+x', '-z', '+x+z' that must line up with one of the 8 key directions at the current yaw, otherwise it throws):
//   k.hold('W', { until: (s,p) => p.x > 5 })   set the held keys (a chord = one change); optionally keep going until true
//   k.hold('D', { for: 0.5 })                  ...or for 0.5 s; then keys stay held until the next change
//   k.release()   k.tap('W', 0.3)              let go / press and release 0.3 s later
//   k.jump({ hold: 0.45 })                     Space down (keeping the held keys), up after `hold` s (min minGap)
//   k.until(pred, { timeout, label })          let time pass with the keys as they are
//   k.wait(s)                                  the same for a fixed time
//   k.form('ice')   k.special()   k.restart()  digit keys / R
//   k.orbit(deg)    k.orbitTo('+x')            drag the camera (yaw + deg; 0 looks toward -z, -90 toward +x)
//   k.runTo('W', 12)                           hold W, release when the coast will end near x = 12 (see runTo)
//   k.goTo(x, z, { tol })                      walk to a spot with axis legs and taps, like a person lining up
//   k.expect / expectSignal / expectShards / expectExit
//
// `runKeyboard(level, solve, jitter, opts)` runs a solution `solve(k)` and returns what happened; `sweepKeyboard`
// finds how far the whole solution can be shifted.

import { play } from './play.js';
import { rigFor } from './camera-check.js';
import { DT } from '../../src/sim/constants.js';
import { ALL_FORMS } from '../../src/sim/elements/index.js';

export const HUMAN = Object.freeze({
  latency: 0.15,      // s, a reaction: from "now true" to the key changing
  minGap: 0.15,       // s, no input change sooner than this after the previous one
  orbitRate: 120,     // deg/s, a mouse drag of the camera
  holdNoise: 0.05,    // s, +- on a timed hold's length (seeded jitter only)
  amp: 0.15,          // s, default seeded jitter amplitude
  frame: 2,           // sim ticks per rendered frame (60 fps)
});

/** The set every solution is run under: all inputs 150 ms early, on time, 150 ms late, and seeded random shifts. */
export const JITTERS = Object.freeze([
  { label: '-150ms', shift: -0.15 },
  { label: '0ms', shift: 0 },
  { label: '+150ms', shift: 0.15 },
  { label: 'seed 1', seed: 1, amp: 0.15 },
  { label: 'seed 2', seed: 2, amp: 0.15 },
  { label: 'seed 3', seed: 3, amp: 0.15 },
  { label: 'seed 4', seed: 4, amp: 0.15 },
]);

const CODE = { W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', SPACE: 'Space' };
const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rad = (d) => d * Math.PI / 180;
const wrapDeg = (d) => ((d + 180) % 360 + 360) % 360 - 180;

/** The camera-space stick of a held key set, as input.js frame() makes it: { x right, y forward }, length <= 1. */
export function stickOf(keys) {
  let x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  let y = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y };
}

/** The world move vector for a camera-space stick and camera yaw, as input.js sample() makes it. */
export function worldOf(x, y, yaw) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { mx: x * c - y * s, mz: -x * s - y * c };
}

export class Keyboard {
  /**
   * @param levelData a level object (src/levels/*.js default export)
   * @param opts { jitter: {shift}|{seed,amp}, latency, minGap, orbitRate, trace, rig (factory, see attachRig), yaw (deg, default level.camYaw) }
   */
  constructor(levelData, opts = {}) {
    this.opts = { ...HUMAN, ...opts };
    this.jitter = opts.jitter || { shift: 0 };
    this.rand = this.jitter.seed !== undefined ? mulberry32(this.jitter.seed) : null;
    this.r = play(levelData, { trace: !!opts.trace });
    this.sim = this.r.sim;
    this.p = this.r.p;
    this.level = levelData;
    this.yawDeg = opts.yaw !== undefined ? opts.yaw : (levelData.camYaw || 0);
    this.yaw = rad(this.yawDeg);
    this.keys = new Set();
    this.n = 0;                       // ticks played
    this.last = -Infinity;            // time of the last input change
    this.orbits = 0; this.orbitDeg = 0; this.changes = 0;
    this._jumpLatch = false; this._formQueue = null; this._restartLatch = false;
    this.rig = null; this.maxDrift = 0;
    this.record = opts.record ? [] : null; this._recKeys = '';
    // the game's own camera rig drives the yaw by default (the real game reads the keys against it); `rig: false` holds it fixed
    if (opts.rig !== false) this.attachRig((opts.rig || rigFor)(this.sim));
  }

  // ------------------------------------------------------------------ time
  get t() { return this.n * DT; }

  /**
   * Run the game's own camera rig (tests/lib/camera-check.js rigFor(sim)) alongside, as src/main.js does: the stick is
   * read against the rig's control yaw, so its slow swing behind a hero running straight forward is included.
   * `maxDrift` is the largest angle (degrees) the control yaw ever differs from the yaw the model was told.
   */
  attachRig(rig) { rig.yaw = rig.controlYaw = this.yaw; rig.snap(this.sim.player); this.rig = rig; return this; }

  /** One sim tick with the keyboard as it is. Frame boundaries (even ticks) are where the keys are read. */
  _tick() {
    const F = HUMAN.frame;
    if (this.n % F === 0) {
      this._stick = stickOf(this.keys);
      if (this.rig) { this.rig.steer(this._stick.x, this._stick.y); this.yaw = this.rig.controlYaw; }
    }
    const { mx, mz } = worldOf(this._stick.x, this._stick.y, this.yaw);
    const jump = this.keys.has('Space') || this._jumpLatch;
    const restart = this._restartLatch || this.keys.has('KeyR');
    const form = this._formQueue;
    if (this.record) {                                  // opts.record: every key change and form press, by tick, to replay in a browser
      const ks = [...this.keys].sort().join(',');
      if (ks !== this._recKeys) { this.record.push([this.n, 'keys', [...this.keys]]); this._recKeys = ks; }
      if (form) this.record.push([this.n, 'form', form, this.sim.element.forms.indexOf(form)]);
    }
    this._jumpLatch = false; this._restartLatch = false; this._formQueue = null;
    this.r.tick(mx, mz, jump, form, restart);
    this.n++;
    if (this.rig && this.n % F === 0) {
      this.rig.update(F * DT, this._stick.x, this.sim.player);
      this.maxDrift = Math.max(this.maxDrift, Math.abs(wrapDeg(this.rig.controlYaw * 180 / Math.PI - this.yawDeg)));
    }
  }

  /** Let time pass (keys as they are) until tick `n`. */
  _advanceTo(n) { while (this.n < n) this._tick(); }

  _quant(t) {
    let n = Math.ceil(t / DT - 1e-9);
    if (n % HUMAN.frame) n++;
    return Math.max(n, this.n % HUMAN.frame ? this.n + 1 : this.n);
  }

  _jit() {
    if (this.rand) return (this.rand() * 2 - 1) * (this.jitter.amp === undefined ? HUMAN.amp : this.jitter.amp);
    return this.jitter.shift || 0;
  }

  /** Tick at which a REACTION to what is on screen now lands. */
  _reactAt() {
    return this._quant(Math.max(this.t + this.opts.latency + this._jit(), this.last + this.opts.minGap));
  }

  /** Tick at which a planned follow-up `after` seconds behind the last change lands. */
  _plannedAt(after) {
    const noise = this.rand ? (this.rand() * 2 - 1) * this.opts.holdNoise : 0;
    return this._quant(Math.max(this.last + after + noise, this.last + this.opts.minGap));
  }

  /** Make an input change at tick `n` (letting time pass until then) and record it. */
  _change(n, fn) {
    this._advanceTo(n);
    fn();
    this.last = this.t;
    this.changes++;
  }

  // ------------------------------------------------------------------ parsing keys
  /** The set of key codes for a spec: 'W', 'WD', 'S A', 'W Space', '+x', '-x+z', or an array of those. */
  keysFor(spec) {
    if (Array.isArray(spec)) return new Set(spec.flatMap((s) => [...this.keysFor(s)]));
    const out = new Set();
    const text = String(spec || '').trim();
    if (!text || text === '-' || text.toLowerCase() === 'none') return out;
    for (const tok of text.split(/\s+/)) {
      if (/^[+-][xz]/i.test(tok)) { for (const c of this._headingKeys(tok)) out.add(c); continue; }
      if (tok.toLowerCase() === 'space') { out.add('Space'); continue; }
      if (/^Key[WASD]$/.test(tok)) { out.add(tok); continue; }      // a key code (goTo passes bestKeys().keys back in)
      if (!/^[wasd]+$/i.test(tok)) throw new Error(`keyboard: cannot read key spec "${tok}"`);
      for (const ch of tok.toUpperCase()) out.add(CODE[ch]);
    }
    if (out.has('KeyW') && out.has('KeyS')) out.delete('KeyW'), out.delete('KeyS');
    if (out.has('KeyA') && out.has('KeyD')) out.delete('KeyA'), out.delete('KeyD');
    return out;
  }

  /** The key combination whose world direction (at the current yaw) is the heading '+x', '-z', '+x+z' ...; throws if none is within 1 degree. */
  _headingKeys(h) {
    let dx = 0, dz = 0;
    for (const m of h.matchAll(/([+-])([xz])/gi)) { const v = m[1] === '+' ? 1 : -1; if (m[2].toLowerCase() === 'x') dx += v; else dz += v; }
    const want = Math.atan2(dx, dz);
    const best = this.bestKeys(dx, dz);
    if (Math.abs(wrapDeg((best.heading - want) * 180 / Math.PI)) > 1) {
      throw new Error(`keyboard: heading ${h} is ${Math.abs(wrapDeg((best.heading - want) * 180 / Math.PI)).toFixed(1)} degrees off the nearest of the 8 key directions at camera yaw ${this.yawDeg.toFixed(1)}`);
    }
    return best.keys;
  }

  /** Of the 8 key directions the one whose world heading is closest to the direction (dx, dz): { keys:[codes], heading (atan2(mx,mz)), mx, mz }. */
  bestKeys(dx, dz) {
    const combos = [['KeyW'], ['KeyW', 'KeyD'], ['KeyD'], ['KeyS', 'KeyD'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyW', 'KeyA']];
    const l = Math.hypot(dx, dz) || 1;
    let best = null;
    for (const keys of combos) {
      const st = stickOf(new Set(keys)), w = worldOf(st.x, st.y, rad(this.yawDeg));      // the script thinks in the yaw it was told, not the rig's drift
      const dot = (w.mx * dx + w.mz * dz) / l;
      if (!best || dot > best.dot) best = { dot, keys, heading: Math.atan2(w.mx, w.mz), mx: w.mx, mz: w.mz };
    }
    return best;
  }

  // ------------------------------------------------------------------ steps
  _step(what) { this.r._begin(what); }
  fail(msg) { this.r.fail(msg); }

  /**
   * Set the held keys to exactly `spec` (one input change). Reactive: it lands `latency + jitter` after now;
   * with { after: s } it is a planned follow-up that many seconds behind the previous change.
   * opts: { until: pred, timeout (20 s), label } keep going until pred(sim, player); { for: s } keep going that long.
   */
  hold(spec, opts = {}) {
    const keys = this.keysFor(spec);
    this._step(`hold [${[...keys].map((c) => c.replace('Key', '')).join(' ') || '-'}]${opts.label ? ' ' + opts.label : ''}`);
    this._keysChange(keys, opts.after);
    if (opts.until) this.until(opts.until, opts);
    else if (opts.for) this.wait(opts.for);
    return this;
  }

  _keysChange(keys, after) {
    if (keys.size === this.keys.size && [...keys].every((c) => this.keys.has(c))) return;   // already held: no change, no reaction
    const at = after === undefined ? this._reactAt() : this._plannedAt(after);
    this._change(at, () => {
      if (keys.has('Space') && !this.keys.has('Space')) this._jumpLatch = true;
      this.keys = new Set(keys);
    });
  }

  /** Let go of everything. */
  release(opts = {}) { this._step('release'); this._keysChange(new Set(), opts.after); return this; }

  /** Press `spec`, let go `seconds` later (at least minGap). */
  tap(spec, seconds = 0.2, opts = {}) {
    const keys = this.keysFor(spec);
    this._step(`tap [${[...keys].map((c) => c.replace('Key', '')).join(' ')}] ${seconds}s`);
    this._keysChange(keys, opts.after);
    this._keysChange(new Set(), seconds);
    return this;
  }

  /**
   * Jump: Space goes down (the keys already held stay held, plus `opts.keys` if given), up `hold` seconds later
   * (at least minGap: a person cannot tap faster than the model's grid). The jump button is released after the
   * press, so the call returns while Mote is still in the air; follow it with `until`.
   * opts: { hold (0.45: a full-height jump; ~0.15 is the shortest), keys, after }
   */
  jump(opts = {}) {
    const hold = opts.hold === undefined ? 0.45 : opts.hold;
    this._step(`jump hold=${hold}`);
    const extra = opts.keys ? this.keysFor(opts.keys) : new Set();
    const down = new Set([...this.keys, ...extra, 'Space']);
    this._keysChange(down, opts.after);
    const up = new Set(down); up.delete('Space');
    this._keysChange(up, hold);
    return this;
  }

  /**
   * A short sequence of key changes, planned together: steps are [seconds after the previous change, keys held from
   * then on]; the first is a reaction (or `opts.after`). Each gap is at least minGap. Example, a hop that
   * lets go of forward early: k.macro([[0, 'W Space'], [0.2, 'Space'], [0.25, '']]).
   */
  macro(steps, opts = {}) {
    this._step(`macro ${steps.map((s) => `${s[0]}:${s[1] || '-'}`).join(' ')}`);
    steps.forEach((s, i) => this._keysChange(this.keysFor(s[1]), i === 0 ? opts.after : s[0]));
    return this;
  }

  /**
   * Hop: the movement keys and Space go down together; the movement keys come up `tap` s later and Space `hold` s
   * after the press (both at least minGap; hold >= tap). In the air the keys steer (airAccel 20): a short tap
   * is a short hop. Returns when the keys are up (still in the air; follow with land()).
   */
  hop(spec, opts = {}) {
    const tap = opts.tap === undefined ? 0.15 : opts.tap, hold = opts.hold === undefined ? 0.45 : opts.hold;
    const dir = this.keysFor(spec);
    const down = [...dir, 'Space'].map((c) => (c === 'Space' ? 'Space' : c.replace('Key', ''))).join(' ');
    const steps = [[0, down]];
    if (tap < hold) steps.push([tap, 'Space'], [hold - tap, '']); else steps.push([hold, dir.size ? [...dir].map((c) => c.replace('Key', '')).join(' ') : ''], [tap - hold, '']);
    return this.macro(steps, opts);
  }

  /** A hop, then wait to land and come to rest (a person pauses on a step before the next one). */
  hopTo(spec, opts = {}) { return this.hop(spec, opts).land().settle(); }

  /** Request a form with its digit key; asserts it took (the sim buffers a request for 0.5 s). opts: { release: true } lets go of the movement keys with the press. */
  form(name, opts = {}) {
    this._step(`form ${name}`);
    const forms = this.sim.element.forms, slot = forms.indexOf(name);
    if (slot < 0) this.fail(`${name} is not one of ${this.sim.element.id}'s forms (${forms.join(', ')})`);
    if (this.p.form === name && ALL_FORMS[name] && ALL_FORMS[name].special) this.fail(`already ${name}: pressing its key again fires its special (use k.special())`);
    this._change(opts.after === undefined ? this._reactAt() : this._plannedAt(opts.after), () => {
      this._formQueue = name;
      if (opts.release) this.keys.clear();            // the movement keys come up with the press (one change)
    });
    const n0 = this.r.events.length;
    for (let i = 0; i < 72 && this.p.form !== name; i++) this._tick();
    if (opts.expect !== false && this.p.form !== name) {
      const d = this.r.events.slice(n0).reverse().find((x) => x.type === 'denied');
      this.fail(`form change to ${name} was refused${d ? ` (${d.reason})` : ''}`);
    }
    return this;
  }

  /** Press the key of the form the hero is in: that form's special. Asserts it fired unless opts.expect === false. */
  special(opts = {}) {
    const name = this.p.form;
    this._step(`special (${name})`);
    const n0 = this.r.events.length;
    this._change(opts.after === undefined ? this._reactAt() : this._plannedAt(opts.after), () => { this._formQueue = name; });
    this._tick(); this._tick();
    const fired = this.r.events.slice(n0).some((e) => e.type === 'special');
    if (opts.expect !== false && !fired) this.fail(`the special of ${name} did not fire`);
    return this;
  }

  /** R: back to the last checkpoint (crates return too). */
  restart() {
    this._step('restart');
    this._change(this._reactAt(), () => { this._restartLatch = true; });
    this._tick(); this._tick();
    return this;
  }

  /** Drag the camera: yaw += deg (0 looks toward -z, -90 toward +x, 90 toward -x, 180 toward +z), at HUMAN.orbitRate. */
  orbit(deg) {
    this._step(`orbit ${deg > 0 ? '+' : ''}${deg} deg`);
    this._change(this._reactAt(), () => { this.orbits++; this.orbitDeg += Math.abs(deg); });
    const ticks = Math.max(1, Math.round(Math.abs(deg) / this.opts.orbitRate / DT));
    const total = rad(deg);
    for (let i = 0; i < ticks; i++) {
      const d = total / ticks;
      this.yawDeg += d * 180 / Math.PI;
      if (this.rig) { this.rig.orbit(-d / 0.0052, 0); this.yaw = this.rig.controlYaw; } else this.yaw += d;
      this._tick();
    }
    this.last = this.t;
    return this;
  }

  /** Orbit the camera (the short way round) until it looks toward a world heading: '+x', '-x', '+z', '-z'. */
  orbitTo(heading) {
    let dx = 0, dz = 0;
    for (const m of heading.matchAll(/([+-])([xz])/gi)) { const v = m[1] === '+' ? 1 : -1; if (m[2].toLowerCase() === 'x') dx += v; else dz += v; }
    const target = Math.atan2(-dx, -dz) * 180 / Math.PI;          // yaw whose forward (-sin, -cos) is (dx, dz)
    const d = wrapDeg(target - this.yawDeg);
    if (Math.abs(d) < 0.5) return this;
    return this.orbit(d);
  }

  // ------------------------------------------------------------------ time passing
  /** Let `seconds` pass with the keys as they are (a decision point follows: what comes next is a reaction). */
  wait(seconds) {
    this._step(`wait ${seconds}s`);
    this._advanceTo(this.n + Math.round(seconds / DT));
    return this;
  }

  /** Let time pass until pred(sim, player) is true (read every frame). opts: { timeout (20 s), label }. */
  until(pred, opts = {}) {
    const timeout = opts.timeout === undefined ? 20 : opts.timeout;
    this._step(`until ${opts.label || pred.toString().slice(0, 70)}`);
    const limit = this.n + Math.round(timeout / DT);
    for (;;) {
      if (this.n % HUMAN.frame === 0 && (this.sim.completed || pred(this.sim, this.p))) return this;
      if (this.n >= limit) this.fail(`condition not met within ${timeout}s`);
      this._tick();
    }
  }
  waitUntil(pred, opts = {}) { return this.until(pred, opts); }

  /** Let the hero come to rest on its own (keys must be released): until grounded/floating and slower than `below`. */
  settle(opts = {}) {
    const below = opts.below === undefined ? 0.1 : opts.below;
    return this.until((s, p) => (p.grounded || p.floating) && Math.hypot(p.vx, p.vz) < below, { timeout: opts.timeout || 12, label: 'come to rest' });
  }

  /** Until the hero is on the ground (or floating) again; returns at once if it already is. */
  land(opts = {}) {
    return this.until((s, p) => p.grounded || p.floating, { timeout: opts.timeout || 4, label: 'land' });
  }

  // ------------------------------------------------------------------ movement helpers
  /** Metres a walking form drifts after the key is let go, and metres per second it covers meanwhile. */
  _coast(form) {
    const F = ALL_FORMS[form] || {};
    if (F.move === 'slide') return { v: F.speed, dec: (F.accel || 9) + 0.4 * (F.friction || 0), brake: true };
    if (F.move === 'float') return { v: F.speed, dec: F.drag || 5, brake: false };
    return { v: F.speed || 5, dec: F.decel || 40, brake: false };
  }

  /**
   * Run in one key direction and let go "when the coast will end near" a point: hold `spec` until the distance
   * still to go along the heading is at most speed*latency + stopping distance (+ opts.margin), then release (a form that
   * slides is braked with the opposite keys until it is nearly still), then wait until still. This is the
   * move every other helper is built from. The target is a world [x, z] point, or a number meaning that
   * coordinate on the heading's axis ('x' or 'z', from the heading; diagonal headings need a point).
   * opts: { margin (0), stop (true), timeout, label, jump (hold Space too) }
   */
  runTo(spec, target, opts = {}) {
    const keys = this.keysFor(spec);
    const { ux, uz, tx, tz, rem } = this._along(keys, target);
    const label = opts.label || `to (${tx.toFixed(1)}, ${tz.toFixed(1)})`;
    this._step(`runTo ${[...keys].map((c) => c.replace('Key', '')).join('')} ${label}`);
    this._keysChange(keys, opts.after);
    const C = this._coast(this.p.form);
    const lead = () => {
      const v = Math.max(0, this.p.vx * ux + this.p.vz * uz);
      return v * this.opts.latency + v * v / (2 * C.dec) + (opts.margin || 0);
    };
    this.until(() => rem() <= lead(), { timeout: opts.timeout === undefined ? 20 : opts.timeout, label });
    if (opts.stop === false) return this;
    this.stopNow();
    return this;
  }

  /** The world heading (unit ux, uz), target point and "metres still to go" function of a key set and a mark (see runTo). */
  _along(keys, target) {
    const st = stickOf(keys), w = worldOf(st.x, st.y, rad(this.yawDeg)), wl = Math.hypot(w.mx, w.mz) || 1;
    const ux = w.mx / wl, uz = w.mz / wl;
    let tx, tz;
    if (Array.isArray(target)) { tx = target[0]; tz = target[1]; }
    else if (Math.abs(uz) < 0.01) { tx = target; tz = this.p.z; }
    else if (Math.abs(ux) < 0.01) { tx = this.p.x; tz = target; }
    else throw new Error('keyboard: a diagonal heading needs a [x, z] target');
    return { ux, uz, tx, tz, rem: () => (tx - this.p.x) * ux + (tz - this.p.z) * uz };
  }

  /**
   * Run toward a mark and jump as it arrives: hold `spec` until the distance still to go is at most
   * speed*latency + margin (the reaction will land the press about on the mark), press Space for `hold` s with the
   * keys still held, and (unless opts.land === false) keep going until grounded again.
   * opts: { hold (0.45), margin (0), land (true), release (true: everything is let go when the jump button is, and
   * after landing it waits to come to rest; false: keep running), timeout }
   */
  jumpAt(spec, mark, opts = {}) {
    const keys = this.keysFor(spec);
    const { ux, uz, tx, tz, rem } = this._along(keys, mark);
    const label = opts.label || `jump at (${tx.toFixed(1)}, ${tz.toFixed(1)})`;
    this._step(`jumpAt ${[...keys].map((c) => c.replace('Key', '')).join('')} ${label}`);
    this._keysChange(keys, opts.after);
    this.until(() => { const v = Math.max(0, this.p.vx * ux + this.p.vz * uz); return rem() <= v * this.opts.latency + (opts.margin || 0); },
      { timeout: opts.timeout === undefined ? 20 : opts.timeout, label });
    const hold = opts.hold === undefined ? 0.45 : opts.hold;
    this._keysChange(new Set([...keys, 'Space']));
    this._keysChange(opts.release === false ? keys : new Set(), hold);          // let go of everything with the jump button (default)
    if (opts.land !== false) { this.land(); if (opts.release !== false) this.settle(); }
    return this;
  }

  /** Stop: release (or, for a sliding form, press against the motion until it is nearly still), then wait until still. */
  stopNow(opts = {}) {
    this._step('stop');
    const C = this._coast(this.p.form), form0 = this.p.form;
    if (C.brake && Math.hypot(this.p.vx, this.p.vz) > 0.4) {
      const dir = this.bestKeys(-this.p.vx, -this.p.vz);
      this._keysChange(new Set(dir.keys), opts.after);
      // brake until nearly still, or until the form changes under the keys (melted on a hot floor: let go at once)
      const vx0 = this.p.vx, vz0 = this.p.vz;       // ...or until it has turned round (bounced off a wall): the brake key would now push it away
      this.until((s, p) => Math.hypot(p.vx, p.vz) < 0.35 || p.form !== form0 || p.vx * vx0 + p.vz * vz0 < 0, { timeout: 6, label: 'braked' });
    }
    this._keysChange(new Set(), C.brake ? 0 : opts.after);
    this.until((s, p) => Math.hypot(p.vx, p.vz) < 0.1 && (p.grounded || p.floating || this.p.form === 'steam'), { timeout: opts.timeout || 12, label: 'at rest' });
    return this;
  }

  _isSlide() { const F = ALL_FORMS[this.p.form]; return !!F && F.move === 'slide'; }

  /** Metres a tap of `seconds` moves a walking form (key down for `seconds`, then coasting to a stop). */
  tapDistance(seconds, form = this.p.form) {
    const F = ALL_FORMS[form] || {};
    if (F.move === 'slide') {                       // ice: speeds up while the key is down, then glides to a stop on friction alone
      const wet = this.p.inWater ? 1 : 0;            // in water ice has half the push and three times the friction (sim.js)
      const a = (F.accel || 9) * (wet ? 0.5 : 1), fr = (F.friction || 2.4) * (wet ? 3 : 1), vv = Math.min(a * seconds, (F.speed || 6.5) * (wet ? 0.5 : 1));
      return 0.5 * a * Math.min(seconds, vv / a) ** 2 + (vv > a * seconds - 1e-9 ? 0 : vv * (seconds - vv / a)) + vv * vv / (2 * fr);
    }
    const v = F.speed || 5, a = F.accel || 50, dec = F.decel || 40;
    const ta = v / a;
    if (seconds < ta) { const vv = a * seconds; return 0.5 * a * seconds * seconds + vv * vv / (2 * dec); }
    return 0.5 * v * ta + v * (seconds - ta) + v * v / (2 * dec);
  }

  /**
   * Walk to (x, z) the way a person lines up on a keyboard: one axis at a time with the key that points that way,
   * run-and-coast for the long part, short taps for the last half metre, looking each time at where Mote
   * ended up. Gives up (fails) if it is still more than `tol` away after `maxLegs` legs.
   * `tol` is per axis (|dx| and |dz| both within it); it cannot be finer than half the smallest key step (0.42 m for a walker).
   * opts: { tol (0.6), order ('xz' | 'zx' | 'auto'), maxLegs (12), approach (3: metres short of a far target the run stops), via: [[x,z],...] }
   */
  goTo(x, z, opts = {}) {
    const tol = opts.tol === undefined ? 0.6 : opts.tol;
    // the smallest step a keyboard has is a tap of minGap: a walking form moves tapDistance(minGap) (0.83 m for liquid)
    // however short the tap, so no tolerance under half of that can be promised
    if (tol < this.tapDistance(this.opts.minGap) / 2 - 1e-9 && !this._isSlide()) throw new Error(`keyboard.goTo: tol ${tol} is finer than the smallest key step allows (${(this.tapDistance(this.opts.minGap) / 2).toFixed(2)} m)`);
    for (const v of opts.via || []) this.goTo(v[0], v[1], { ...opts, via: undefined, tol: opts.viaTol || tol * 1.5 });
    this._step(`goTo (${x}, ${z})`);
    if (this.keys.size || Math.hypot(this.p.vx, this.p.vz) > 0.3) this.stopNow();       // a person lets go and waits to stop first
    const maxLegs = opts.maxLegs || 12;
    let gain = 1;
    for (let leg = 0; leg < maxLegs; leg++) {
      const ex = x - this.p.x, ez = z - this.p.z;
      if ((Math.abs(ex) <= tol && Math.abs(ez) <= tol) || this.sim.completed) return this;
      // which axis first: the longer one (a person goes for the big gap first), or as asked
      let axis;
      if (opts.order === 'xz' && Math.abs(ex) > tol) axis = 'x';
      else if (opts.order === 'zx' && Math.abs(ez) > tol) axis = 'z';
      else axis = Math.abs(ex) >= Math.abs(ez) ? 'x' : 'z';
      if (axis === 'x' && Math.abs(ex) <= tol) axis = 'z';
      if (axis === 'z' && Math.abs(ez) <= tol) axis = 'x';
      const d = axis === 'x' ? ex : ez;
      const best = this.bestKeys(axis === 'x' ? d : 0, axis === 'z' ? d : 0);
      const C = this._coast(this.p.form);
      const maxT = C.brake ? 0.6 : 1.3;
      if (Math.abs(d) <= this.tapDistance(maxT, this.p.form)) {
        // up to about 6 m: hold the key for about the right time (dead reckoning, which is what a person does), then let it settle
        let T = this.opts.minGap;
        while (this.tapDistance(T) * gain < Math.abs(d) - this.tapDistance(1 / 60) * gain / 2 && T < maxT) T += 1 / 60;
        const x0 = this.p.x, z0 = this.p.z, predicted = this.tapDistance(T);
        this.tap(best.keys, T);
        this.until((s, p) => Math.hypot(p.vx, p.vz) < 0.1, { timeout: C.brake ? 14 : 4, label: 'tap settles' });
        // a person learns how far a tap goes here (water, a slope, a mover): scale the next one by what this one did
        gain = Math.max(0.15, Math.min(2.5, Math.hypot(this.p.x - x0, this.p.z - z0) / Math.max(predicted, 1e-3)));
      } else {
        // a long way: run to about 3 m short of the spot and stop (the release is a reaction, so it lands +-0.8 m off),
        // then the last stretch is dead-reckoned by taps, as a person slows down near an edge
        const goal = axis === 'x' ? x : z, ap = Math.abs(d) > (opts.approach === undefined ? 3 : opts.approach) + 1 ? (opts.approach === undefined ? 3 : opts.approach) : 0;
        this.runTo(best.keys, goal - Math.sign(d) * ap, { label: `${axis} to ${(goal - Math.sign(d) * ap).toFixed(1)}` });
      }
    }
    const miss = Math.max(Math.abs(x - this.p.x), Math.abs(z - this.p.z));
    if (miss > tol) this.fail(`goTo (${x}, ${z}): still ${miss.toFixed(2)} m off on one axis after ${maxLegs} legs (tol ${tol})`);
    return this;
  }

  /**
   * Fly a floating form (steam) to above (x, z): each time, look where it would stop if the keys came up now
   * (speed*latency + speed^2 / (2 drag)), press the one of the 8 directions that points from there to the spot, and
   * let go when that stopping place is within `tol`; then wait for it to drift to rest. Height is whatever the
   * form does meanwhile (steam rises on its own). Fails after `maxLegs` presses.
   * opts: { tol (0.6), maxLegs (14), timeout (8 s of flight) }
   */
  flyTo(x, z, opts = {}) {
    const tol = opts.tol === undefined ? 0.6 : opts.tol, p = this.p;
    const F = ALL_FORMS[p.form] || {};
    if (F.move !== 'float') this.fail(`flyTo needs a floating form, not ${p.form}`);
    const drag = F.drag || 5, L = this.opts.latency;
    this._step(`flyTo (${x}, ${z})`);
    const stopAt = () => {
      const sp = Math.hypot(p.vx, p.vz);
      if (sp < 1e-6) return [p.x, p.z];
      const k = (sp * L + sp * sp / (2 * drag)) / sp;
      return [p.x + p.vx * k, p.z + p.vz * k];
    };
    const miss = () => { const s = stopAt(); return [x - s[0], z - s[1]]; };
    const limit = this.n + Math.round((opts.timeout === undefined ? 8 : opts.timeout) / DT);
    for (let leg = 0; leg < (opts.maxLegs || 14); leg++) {
      let e = miss();
      if (Math.hypot(e[0], e[1]) <= tol) {
        this._keysChange(new Set());
        this.until(() => Math.hypot(p.vx, p.vz) < 0.3, { timeout: 4, label: 'drift to a stop' });
        e = [x - p.x, z - p.z];
        if (Math.hypot(e[0], e[1]) <= tol * 1.1) return this;
        continue;
      }
      const pick = (v) => {            // a diagonal only when the spot is nearly on one, otherwise the key of the longer axis
        const b = this.bestKeys(v[0], v[1]);
        const off = Math.abs(wrapDeg((b.heading - Math.atan2(v[0], v[1])) * 180 / Math.PI));
        if (b.keys.length === 1 || off <= 14) return b;
        return Math.abs(v[0]) > Math.abs(v[1]) ? this.bestKeys(v[0], 0) : this.bestKeys(0, v[1]);
      };
      const best = pick(e);
      this._keysChange(new Set(best.keys));
      this.until(() => {
        const m = miss(), d = Math.hypot(m[0], m[1]);
        if (d <= tol * 0.8) return true;
        const b2 = pick(m);
        return b2.keys.join() !== best.keys.join() && Math.abs(wrapDeg((b2.heading - best.heading) * 180 / Math.PI)) > 50;
      }, { timeout: Math.max(0.5, (limit - this.n) * DT), label: 'steer' });
      if (this.n >= limit) break;
    }
    this.fail(`flyTo (${x}, ${z}): not there after ${opts.maxLegs || 14} presses (at ${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  }

  /**
   * Hop up (stairs, ledges): hop, land, settle, repeat until the feet are at least `y` m high (at most `max` hops).
   * opts: { tap (0.3), hold (0.45), max (6) }
   */
  climb(spec, y, opts = {}) {
    this._step(`climb to y=${y}`);
    for (let i = 0; i < (opts.max || 6) && this.p.y < y - 0.05; i++) this.hopTo(spec, { tap: opts.tap === undefined ? 0.3 : opts.tap, hold: opts.hold });
    if (this.p.y < y - 0.05) this.fail(`climb: still at y=${this.p.y.toFixed(2)} after ${opts.max || 6} hops`);
    return this;
  }

  // ------------------------------------------------------------------ assertions
  expect(pred, label) { this.r.expect(pred, label); return this; }
  expectSignal(name, value = true) { this.r.expectSignal(name, value); return this; }
  expectShards(n) { this.r.expectShards(n); return this; }

  /** The level must complete within `timeout` s with the keys as they are (keep holding toward the door). */
  expectExit(opts = {}) {
    this._step('expectExit');
    const limit = this.n + Math.round((opts.timeout === undefined ? 3 : opts.timeout) / DT);
    while (this.n < limit && !this.sim.completed) this._tick();
    if (!this.sim.completed) this.fail('level was not completed');
    return this;
  }

  /** The time of the completion event, s (the route time), or null. */
  get routeTime() { const e = this.r.result(); return e ? e.timeMs / 1000 : null; }
}

/**
 * Run `solve(k)` on a fresh game under one jitter setting. Never throws: returns
 * { ok, error, time, orbits, orbitDeg, changes, k }.
 */
export function runKeyboard(level, solve, jitter = { shift: 0 }, opts = {}) {
  const k = new Keyboard(level, { ...opts, jitter });
  try {
    solve(k);
    if (!k.sim.completed) throw new Error('the solution ended without completing the level');
    return { ok: true, error: null, time: k.routeTime, orbits: k.orbits, orbitDeg: k.orbitDeg, changes: k.changes, k };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), time: null, orbits: k.orbits, orbitDeg: k.orbitDeg, changes: k.changes, k };
  }
}

/**
 * Run only the areas `areas[from..]` of a solution (each `(k) => ...`), starting where a player respawns into that
 * area: at the first checkpoint inside `level.areas[from].box` (a death or a restart puts Mote there, as a drop). Used to
 * check the rest of a level when an earlier area is known to fail under some jitter. Never throws.
 */
export function runKeyboardFrom(level, areas, from, jitter = { shift: 0 }, opts = {}) {
  const k = new Keyboard(level, { ...opts, jitter });
  try {
    if (from > 0) {
      const box = level.areas[from].box;     // [x0, z0, x1, z1]
      const cp = level.pieces.filter((p) => p.type === 'checkpoint' && p.pos[0] >= Math.min(box[0], box[2]) && p.pos[0] <= Math.max(box[0], box[2]))
        .sort((a, b) => a.pos[0] - b.pos[0])[0];
      if (!cp) throw new Error(`no checkpoint in area ${from} of ${level.id}`);
      k.r.allowDeath = true; k.sim.teleport(cp.pos[0], cp.pos[1], cp.pos[2]); k.r.allowDeath = false;
      for (let i = 0; i < 80; i++) k._tick();                 // settle on the ground, as after a respawn
      k.last = -Infinity;
    }
    for (let i = from; i < areas.length; i++) areas[i](k);
    if (!k.sim.completed) throw new Error('the solution ended without completing the level');
    return { ok: true, error: null, time: k.routeTime, k };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), time: null, k };
  }
}

/**
 * How far can every reaction be shifted? Runs the solution at constant shifts from -maxShift to +maxShift in
 * `step` seconds and returns { results: [{shift, ok}], lo, hi } where [lo, hi] is the widest unbroken
 * passing run containing 0 (null if 0 itself fails).
 */
export function sweepKeyboard(level, solve, { maxShift = 0.3, step = 0.025, opts = {} } = {}) {
  const results = [];
  const n = Math.round(maxShift / step);
  for (let i = -n; i <= n; i++) {
    const shift = Math.round(i * step * 1000) / 1000;
    results.push({ shift, ok: runKeyboard(level, solve, { shift }, opts).ok });
  }
  const z = results.findIndex((r) => r.shift === 0);
  if (!results[z].ok) return { results, lo: null, hi: null };
  let a = z, b = z;
  while (a > 0 && results[a - 1].ok) a--;
  while (b < results.length - 1 && results[b + 1].ok) b++;
  return { results, lo: results[a].shift, hi: results[b].shift };
}
