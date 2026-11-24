// Scripted-input helper: drive the headless sim the way a player would, with readable steps.
//
//   import { play } from './lib/play.js';
//   const r = play(levelData);
//   r.walkTo(4, 0)                 // hold the stick toward world x=4, z=0 until within 0.2 m
//    .jumpTo(8, 0)                 // jump and steer to (8,0), finishing on the ground there
//    .form('film')                 // request a form and assert it took
//    .walkTo(12, 0)
//    .waitUntil((s) => s.signals.get('gate'), { timeout: 5, label: 'gate opens' })
//    .expectExit();
//
// Every step throws a descriptive Error (step number, what it was doing, where Mote is)
// when it times out, gets stuck, or Mote dies unexpectedly. Steps return `this`.
// Only real inputs are used: move vector, jump, form request, restart. No teleporting.

import { Sim } from '../../src/sim/sim.js';
import { DT } from '../../src/sim/constants.js';
// every form of every element (liquid..film, ember..spark, ...): movement numbers and capability flags
import { ALL_FORMS as FORMS } from '../../src/sim/elements/index.js';

export function play(levelData, opts) { return new Runner(levelData, opts); }

export class Runner {
  constructor(levelData, opts = {}) {
    this.sim = new Sim(levelData);
    this.p = this.sim.player;
    this.stepNo = 0;
    this.what = 'start';
    this.trace = !!opts.trace;       // print one line per step
    this.events = [];                // every event the sim emitted, in order
    this.allowDeath = false;
    this._deaths = 0;
    this._jump = false;
  }

  // ------------------------------------------------------------ core
  /** Advance one tick with raw input. */
  tick(mx = 0, mz = 0, jump = false, form = null, restart = false) {
    this.sim.step({ mx, mz, jump, form, restart });
    const ev = this.sim.events;
    if (ev.length) { for (const e of ev) this.events.push(e); this.sim.events = []; }
    if (this.sim.deaths !== this._deaths) {
      const died = this.sim.deaths > this._deaths;
      this._deaths = this.sim.deaths;
      if (died && !this.allowDeath) {
        const e = [...this.events].reverse().find((x) => x.type === 'respawn');
        this.fail(`${this.sim.element.hero} died (${e ? e.cause : '?'}) at ${e ? fmt(e.from) : '?'}`);
      }
    }
  }

  get t() { return this.sim.time; }
  get pos() { return [this.p.x, this.p.y, this.p.z]; }
  get speed() { return Math.hypot(this.p.vx, this.p.vz); }

  state() {
    const p = this.p;
    return `t=${this.sim.time.toFixed(2)}s pos=${fmt([p.x, p.y, p.z])} vel=${fmt([p.vx, p.vy, p.vz])} form=${p.form} ` +
      `grounded=${p.grounded}${p.floating ? ' floating' : ''} gauge=${p.gauge.toFixed(2)} deaths=${this.sim.deaths}`;
  }

  fail(msg) {
    throw new Error(`[${this.sim.level.id} step ${this.stepNo}: ${this.what}] ${msg}\n  ${this.state()}`);
  }

  _begin(what) {
    this.stepNo++; this.what = what;
    if (this.trace) console.log(`  #${this.stepNo} ${what}  | ${this.state()}`);
  }

  // ------------------------------------------------------------ steps
  /** Do nothing (or hold an input) for `seconds`. */
  wait(seconds, input = {}) {
    this._begin(`wait ${seconds}s`);
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) this.tick(input.mx || 0, input.mz || 0, !!input.jump);
    return this;
  }

  /** Hold a raw world-space stick direction for `seconds`. */
  move(mx, mz, seconds, jump = false) {
    this._begin(`move (${mx},${mz}) ${seconds}s`);
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) this.tick(mx, mz, jump);
    return this;
  }

  /**
   * Wait until pred(sim, player) is true. opts: { timeout=10, label, mx, mz, jump, toward:[x,z] }.
   * `toward` keeps the stick pointed at a world point while waiting.
   */
  waitUntil(pred, opts = {}) {
    const timeout = opts.timeout === undefined ? 10 : opts.timeout;
    this._begin(`waitUntil ${opts.label || pred.toString().slice(0, 60)}`);
    const n = Math.round(timeout / DT);
    for (let i = 0; i < n; i++) {
      if (pred(this.sim, this.p)) return this;
      let mx = opts.mx || 0, mz = opts.mz || 0;
      if (opts.toward) {
        const dx = opts.toward[0] - this.p.x, dz = opts.toward[1] - this.p.z, d = Math.hypot(dx, dz);
        if (d > 0.05) { mx = dx / d; mz = dz / d; } else { mx = 0; mz = 0; }
      }
      this.tick(mx, mz, !!opts.jump);
    }
    if (pred(this.sim, this.p)) return this;
    this.fail(`condition not met within ${timeout}s`);
  }

  /** Request a form. Asserts it took effect unless opts.expect === false. */
  form(name, opts = {}) {
    this._begin(`form ${name}`);
    if (!FORMS[name]) this.fail(`unknown form "${name}"`);
    // pressing the button of the form you are in is that form's special: say so rather than fire it by accident
    if (this.p.form === name && FORMS[name].special) this.fail(`already ${name}: pressing its button again would fire its special (use r.special())`);
    // One press, like a player. The sim remembers it through the cooldown and for up to
    // FORM_BUFFER seconds if there is no room yet, so wait that long for it to take or be refused.
    this.tick(opts.mx || 0, opts.mz || 0, false, name);
    for (let i = 0; i < 72 && this.p.form !== name && this.p.pendForm === name; i++) this.tick(opts.mx || 0, opts.mz || 0, false, null);
    if (opts.expect === false) return this;
    if (this.p.form !== name) {
      const d = [...this.events].reverse().find((x) => x.type === 'denied');
      this.fail(`form change to ${name} was refused${d ? ` (${d.reason})` : ''}`);
    }
    return this;
  }

  /**
   * Press the button of the form the hero is ALREADY in: that form's special (Blaze: flare).
   * Asserts the special fired unless opts.expect === false (then it must have been refused).
   */
  special(opts = {}) {
    this._begin(`special (${this.p.form})`);
    const n0 = this.events.length;
    this.tick(opts.mx || 0, opts.mz || 0, !!opts.jump, this.p.form);
    const fired = this.events.slice(n0).some((e) => e.type === 'special');
    if (opts.expect === false) { if (fired) this.fail('the special fired but was expected to be refused'); return this; }
    if (!fired) {
      const d = this.events.slice(n0).find((e) => e.type === 'denied');
      this.fail(FORMS[this.p.form].special ? `the special was refused${d ? ` (${d.reason})` : ''}` : `${this.p.form} has no special`);
    }
    return this;
  }

  /**
   * Walk/slide/drift in a straight line toward world (x, z).
   * opts: tol (0.2 m), timeout (auto), slow (true: ease the stick near the target),
   *       jump (false: hold jump the whole way), stuck (1.5 s without progress fails; 0 disables),
   *       y (optional: also require |feet y - y| < 0.3 to count as arrived).
   */
  walkTo(x, z, opts = {}) {
    const tol = opts.tol === undefined ? 0.2 : opts.tol;
    this._begin(`walkTo (${x}, ${z})`);
    const p = this.p;
    const d0 = Math.hypot(x - p.x, z - p.z);
    const sp = FORMS[p.form].speed;
    const timeout = opts.timeout === undefined ? d0 / (sp * 0.4) + 3 : opts.timeout;
    const stuckLimit = opts.stuck === undefined ? 1.5 : opts.stuck;
    const slow = opts.slow !== false;
    const n = Math.round(timeout / DT);
    let best = d0, bestT = 0;
    for (let i = 0; i < n; i++) {
      if (this.sim.completed) return this;   // walked into the exit on the way: nothing more to do
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d <= tol && (opts.y === undefined || Math.abs(p.y - opts.y) < 0.3)) return this;
      if (d < best - 0.02) { best = d; bestT = i; }
      else if (stuckLimit > 0 && (i - bestT) * DT > stuckLimit) this.fail(`stuck: no progress toward (${x}, ${z}) for ${stuckLimit}s (still ${d.toFixed(2)} m away)`);
      if (FORMS[p.form].move === 'slide' && slow && d > 1e-6) {
        // Ice has momentum: steer by the velocity error toward a speed we can still brake from.
        const want = Math.min(FORMS[p.form].speed, Math.sqrt(2 * 6 * d));
        const ex = dx / d * want - p.vx, ez = dz / d * want - p.vz, e = Math.hypot(ex, ez);
        const g = Math.min(1, e / 0.5);
        this.tick(e > 1e-6 ? ex / e * g : 0, e > 1e-6 ? ez / e * g : 0, !!opts.jump);
        continue;
      }
      let k = 1;
      if (slow && d < 0.6) k = Math.max(0.25, d / 0.6);
      this.tick(d > 1e-6 ? dx / d * k : 0, d > 1e-6 ? dz / d * k : 0, !!opts.jump);
    }
    this.fail(`did not reach (${x}, ${z}) within ${timeout.toFixed(1)}s`);
  }

  /** Follow several waypoints: path([[x,z],[x,z],...], opts) */
  path(points, opts = {}) {
    for (const pt of points) this.walkTo(pt[0], pt[1], opts);
    return this;
  }

  /** Release the stick until horizontal speed drops below `below` m/s (ice needs this). */
  stop(opts = {}) {
    const below = opts.below === undefined ? 0.15 : opts.below;
    this._begin('stop');
    const n = Math.round((opts.timeout || 12) / DT);
    for (let i = 0; i < n; i++) {
      if (this.speed < below && (this.p.grounded || FORMS[this.p.form].move === 'float' || this.p.floating)) return this;
      // brake actively, as a player would: push against the motion (matters for ice)
      const v = this.speed, k = Math.min(1, v / 1.0);
      if (opts.coast || v < 1e-6) this.tick(0, 0, false);
      else this.tick(-this.p.vx / v * k, -this.p.vz / v * k, false);
    }
    this.fail(`still moving at ${this.speed.toFixed(2)} m/s`);
  }

  /** Tap or hold jump for `hold` seconds while keeping the stick at (mx, mz). */
  jump(hold = 0.4, mx = 0, mz = 0) {
    this._begin(`jump hold=${hold}`);
    if (!FORMS[this.p.form].jump) this.fail(`${this.p.form} cannot jump`);
    const n = Math.max(1, Math.round(hold / DT));
    this.tick(mx, mz, false);                 // make sure the press is a fresh edge
    for (let i = 0; i < n; i++) this.tick(mx, mz, true);
    this.tick(mx, mz, false);
    return this;
  }

  /**
   * Jump toward (x, z): press jump, steer at the target in the air, and finish once grounded
   * (or floating) within `tol` of it. opts: hold (s to keep jump held, default full), tol (0.35),
   * timeout (4), run (0: metres of run-up toward the target before pressing jump).
   */
  jumpTo(x, z, opts = {}) {
    const tol = opts.tol === undefined ? 0.35 : opts.tol;
    this._begin(`jumpTo (${x}, ${z})`);
    const p = this.p;
    if (!FORMS[p.form].jump) this.fail(`${p.form} cannot jump`);
    const steer = (jump) => {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      const k = d < 0.4 ? d / 0.4 : 1;
      this.tick(d > 1e-6 ? dx / d * k : 0, d > 1e-6 ? dz / d * k : 0, jump);
    };
    if (opts.run) {
      const sx = p.x, sz = p.z;
      for (let i = 0; i < 600 && Math.hypot(p.x - sx, p.z - sz) < opts.run; i++) steer(false);
    }
    if (!(p.grounded || p.floating)) this.fail(`jumpTo needs ${this.sim.element.hero} on the ground (or floating) to start`);
    const holdN = opts.hold === undefined ? Infinity : Math.round(opts.hold / DT);
    const n = Math.round((opts.timeout || 4) / DT);
    steer(false);
    let left = false;
    for (let i = 0; i < n; i++) {
      steer(i < holdN && (!left || p.vy > 0));
      if (!p.grounded && !p.floating) left = true;
      else if (left) {
        // landed: walk the last bit
        if (Math.hypot(x - p.x, z - p.z) <= tol) return this;
        const what = this.what;
        this.walkTo(x, z, { tol, timeout: 3 });
        this.what = what;
        return this;
      }
    }
    this.fail(`jump toward (${x}, ${z}) did not land within ${(opts.timeout || 4)}s`);
  }

  /** Press restart (R): back to the last checkpoint. */
  restart() {
    this._begin('restart');
    this.tick(0, 0, false, null, true);
    this.tick(0, 0, false, null, false);
    return this;
  }

  /** Run fn(runner) with deaths allowed (for scripts that test a hazard on purpose). */
  dying(fn) {
    this.allowDeath = true;
    try { fn(this); } finally { this.allowDeath = false; }
    return this;
  }

  /** Assert a condition right now. */
  expect(pred, label = '') {
    this._begin(`expect ${label || pred.toString().slice(0, 60)}`);
    if (!pred(this.sim, this.p)) this.fail('expectation failed');
    return this;
  }

  /** Assert a named signal's value. */
  expectSignal(name, value = true) {
    this._begin(`expectSignal ${name}=${value}`);
    if (this.sim.signals.get(name) !== value) this.fail(`signal "${name}" is ${this.sim.signals.get(name)}`);
    return this;
  }

  /** The level must complete within `timeout` seconds (Mote keeps heading for `toward` if given). */
  expectExit(opts = {}) {
    const timeout = opts.timeout === undefined ? 2 : opts.timeout;
    this._begin('expectExit');
    const n = Math.round(timeout / DT);
    for (let i = 0; i < n && !this.sim.completed; i++) {
      let mx = 0, mz = 0;
      if (opts.toward) {
        const dx = opts.toward[0] - this.p.x, dz = opts.toward[1] - this.p.z, d = Math.hypot(dx, dz);
        if (d > 0.05) { mx = dx / d; mz = dz / d; }
      }
      this.tick(mx, mz, false);
    }
    if (!this.sim.completed) this.fail('level was not completed');
    return this;
  }

  /** Assert how many shards have been collected so far. */
  expectShards(count) {
    this._begin(`expectShards ${count}`);
    if (this.sim.shardsTaken.length !== count) this.fail(`have ${this.sim.shardsTaken.length} shard(s), expected ${count}`);
    return this;
  }

  /** Names of every sfx emitted so far. */
  sfx() { return this.events.filter((e) => e.type === 'sfx').map((e) => e.name); }

  /** Result of a completed run. */
  result() {
    return this.events.find((e) => e.type === 'complete') || null;
  }
}

function fmt(v) { return `(${v.map((n) => (Math.round(n * 100) / 100)).join(', ')})`; }
