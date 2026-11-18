// SQUISH KEEPER (wobblehoard) PLAYGROUND ambience (PG_AUDIO; PLAYGROUND_BUILD.md 10, 13; PLACES 4 "Sound"). The AWAY chunk's audio
// facade: the engine imports it with the first trip (loadAmbience), never at boot. It holds:
//   AmbienceBed      one place's bed, shaped like music.ts MusicBed: its own bus (a 3 s fade in, a 2 s crossfade on travel, a pause
//                    fade), two looped noise sources at different rates summed (so the 2.5 s noise loop never repeats audibly), the
//                    place recipe's layers and events scheduled by a 100 ms tick, a shallow -6 dB dip under player effects. It NEVER
//                    asks the music for room.
//   createAmbience   the manager the engine drives: setAmbience, the crossfade, pause and mute (free within 0.2 s), the dip.
//   creak            the held creak of a hinged thing (the rocker, the swing), keyed by prop, with a dead-man switch.
//   loadRecipe       the lazy import of each place's recipe (src/audio/places/<id>.ts, inside that place's chunk).
//   things.ts        (re-exported) the place thing voices: chime, bell, splash, crunch, rustle, boing, tick, whoosh (round 2).
// Only first-load modules are imported here (dsp, music), so this chunk shares nothing with the life voices chunk. No animal or traffic
// sound, ever (PLACES P10). Every draw from the engine's PLAYGROUND stream. The designs are our own.
import { clamp } from '../core/rng.ts';
import { Bag, dbToGain, fin, harmonicWave, noiseBuffer, nodeCounters, pulseWave, type Rng, type VoiceGroup } from './dsp.ts';

type Ctx = BaseAudioContext;

export * from './things.ts';

/** What a recipe may read from the engine: the music's bar sounding at t (musicClock's source; null with the music off). */
export interface AmbEnv { barAt(t: number): { barT: number; field: number } | null }
/** A place recipe (src/audio/places/<id>.ts): its layers are built on the bed's noise mix; tick() schedules its events. */
export interface AmbRecipe {
  build(ctx: Ctx, mix: AudioNode, out: AudioNode, t: number, rng: Rng, add: (n: AudioNode) => void, env: AmbEnv): AmbLayers;
}
export interface AmbLayers {
  /** Schedule what happens in [from, until) (context time). */
  tick(from: number, until: number, rng: Rng): void;
  /** A thing's swell (the cabin's fire puff, PROP_SOUND crackle), from t for about 5 s. */
  puff?(t: number): void;
  /** The place's weather event starting at t (setAmbience weather, 0..1): a gust, a wave, the shower on (1) or off (0). */
  weather?(t: number, v: number): void;
}

const RECIPES: Record<string, () => Promise<{ recipe: AmbRecipe }>> = {
  hearthlog: () => import('./places/hearthlog.ts'),
  ripple: () => import('./places/ripple.ts'),
  frostbell: () => import('./places/frostbell.ts'),
  rainleaf: () => import('./places/rainleaf.ts'),
  lanternroof: () => import('./places/lanternroof.ts'),
  cloudloft: () => import('./places/cloudloft.ts'),
};
/** PlaceDef.ambience ids (src/data/place_*.ts) -> place ids, so the shell may pass either. Mirrored; probe_chatter checks it. D-96: the seven
 *  places only (Fizzwell Tub, Cogwhistle Bench and Echo Hollow are dropped: no recipe, no alias). */
export const AMB_ALIAS: Readonly<Record<string, string>> = {
  cabin: 'hearthlog', shore: 'ripple', ridge: 'frostbell', garden: 'rainleaf', roof: 'lanternroof', cloud: 'cloudloft',
};
/** The recipe key for a place id or an ambience id ('' for none). */
export const ambKey = (place: string): string => (Object.prototype.hasOwnProperty.call(RECIPES, place) ? place : AMB_ALIAS[place] ?? '');
const loaded = new Map<string, AmbRecipe>();
/** Import a place's recipe (its own chunk); true when ready. Home and unknown places have no ambience. */
export function loadRecipe(place: string): Promise<boolean> {
  const k = ambKey(place);
  if (!k) return Promise.resolve(false);
  if (loaded.has(k)) return Promise.resolve(true);
  return RECIPES[k]().then((m) => { loaded.set(k, m.recipe); return true; }, () => false);
}

/** The two loop rates: incommensurate, so the summed noise repeats only after hundreds of seconds. */
const RATE_A = 0.7313, RATE_B = 1.0937;
const DIP = dbToGain(-6);
export const AMB_FADE_IN_S = 3, AMB_XFADE_S = 2, AMB_PAUSE_S = 0.08;

export class AmbienceBed {
  readonly place: string;
  private readonly ctx: Ctx;
  private readonly nodes: AudioNode[] = [];
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private readonly fade: GainNode;
  private readonly dipG: GainNode;
  private readonly layers: AmbLayers;
  private readonly rng: Rng;
  private next: number;
  private wander: number;
  private readonly ph: number[];
  private dipEnd = -1;
  endT = Infinity;
  freed = false;

  constructor(ctx: Ctx, out: AudioNode, place: string, recipe: AmbRecipe, t0: number, rng: Rng, fadeInS = AMB_FADE_IN_S, env: AmbEnv = { barAt: () => null }) {
    this.ctx = ctx; this.place = place; this.rng = rng;
    const add = <T extends AudioNode>(n: T): T => { this.nodes.push(n); nodeCounters.created++; return n; };
    this.fade = add(ctx.createGain());
    this.dipG = add(ctx.createGain());
    const mix = add(ctx.createGain());
    this.dipG.connect(this.fade); this.fade.connect(out);
    const t = Math.max(ctx.currentTime, fin(t0, 0));
    this.fade.gain.setValueAtTime(0, t);
    this.fade.gain.linearRampToValueAtTime(1, t + clamp(fin(fadeInS, AMB_FADE_IN_S), 0.05, 10));
    for (const rate of [RATE_A, RATE_B]) {
      const s = add(ctx.createBufferSource());
      s.buffer = noiseBuffer(ctx); s.loop = true; s.playbackRate.value = rate;
      s.connect(mix);
      s.start(t, rng() * 2.4);
      this.srcs.push(s);
    }
    mix.gain.value = 0.7;
    this.layers = recipe.build(ctx, mix, this.dipG, t, rng, (n) => { add(n); if (n instanceof AudioScheduledSourceNode) this.srcs.push(n); }, env);
    this.next = t;
    this.wander = t;
    this.ph = [rng() * 6.28, rng() * 6.28];
  }

  /** Schedule the recipe's events up to `until` (the engine's 100 ms tick, 0.4 s ahead). */
  advance(until: number): void {
    if (this.freed || this.next >= until || this.next >= this.endT) return;
    const u = Math.min(until, this.endT);
    try { this.layers.tick(this.next, u, this.rng); } catch { /* closed */ }
    // each loop's rate wanders +-2.5% (about +-40 cents, inaudible in a noise) over 11 s and 14 s cycles, so a stretch of the loop never
    // comes back at the same time: the 2.5 s buffer leaves no seam (AU-06)
    while (this.wander + 0.5 <= u) {
      this.wander += 0.5;
      for (let k = 0; k < 2; k++) {
        const s = this.srcs[k] as AudioBufferSourceNode;
        try { s.playbackRate.linearRampToValueAtTime((k ? RATE_B : RATE_A) * (1 + 0.025 * Math.sin((2 * Math.PI * this.wander) / (k ? 14 : 11) + this.ph[k])), this.wander); } catch { /* stopped */ }
      }
    }
    this.next = u;
  }

  /** The shallow dip under a player's effect: -6 dB in 30 ms from `from`, held until `until`, back over 1 s. */
  dip(from: number, until: number): void {
    if (this.freed) return;
    const g = this.dipG.gain, now = this.ctx.currentTime, a = Math.max(now, fin(from, now));
    if (until <= this.dipEnd) return;
    const down = a > this.dipEnd;
    this.dipEnd = until;
    g.cancelScheduledValues(a);
    if (down) { g.setValueAtTime(g.value, a); g.linearRampToValueAtTime(DIP, a + 0.03); } else g.setValueAtTime(DIP, a);
    g.linearRampToValueAtTime(DIP, Math.max(a + 0.03, until));
    g.linearRampToValueAtTime(1, Math.max(a + 0.03, until) + 1);
  }

  puff(t: number): void { if (!this.freed && this.layers.puff) this.layers.puff(t); }
  weather(t: number, v: number): void { if (!this.freed && this.layers.weather) { try { this.layers.weather(t, clamp(fin(v, 0), 0, 1)); } catch { /* closed */ } } }

  /** Fade to silence over fadeS from `at`; the sources stop just after. Returns the silent time. */
  stop(at: number, fadeS: number): number {
    if (this.freed || this.endT < Infinity) return this.endT;
    const t = Math.max(this.ctx.currentTime, fin(at, 0)), f = clamp(fin(fadeS, AMB_XFADE_S), 0.02, 6);
    const g = this.fade.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + f);
    this.endT = t + f + 0.01;
    for (const s of this.srcs) { try { s.stop(this.endT + 0.02); } catch { /* stopped */ } }
    return this.endT;
  }

  /** Disconnect everything now (after the fade, on pause, on dispose). */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    for (const s of this.srcs) { try { s.stop(); } catch { /* stopped */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
    nodeCounters.freed += this.nodes.length;
    this.nodes.length = 0;
  }
}

/** What the engine lends the manager. */
export interface AmbHost {
  /** The context while it runs (null before unlock, while paused or suspended). */
  ctx(): AudioContext | null;
  /** The context's clock while it exists (paused included), null once disposed. */
  now(): number | null;
  out(): AudioNode | null;
  /** Sound may play: not muted, not paused, Place sounds above 0. */
  ok(): boolean;
  rng: Rng;
  /** The music's bar sounding at t (absent or null: no music). */
  barAt?(t: number): { barT: number; field: number } | null;
}
export interface Ambience {
  set(p: { place?: string | null; on?: boolean }): void;
  sync(): void;
  dip(from: number, until: number): void;
  puff(t: number): void;
  weather(v: number): void;
  /** Mute or pause: silent within AMB_PAUSE_S and freed (AU-06: within 0.2 s). */
  halt(): void;
  readonly live: number;
}

/** The manager: one bed playing, beds fading out after a travel, a 100 ms tick while any is alive. */
export function createAmbience(h: AmbHost): Ambience {
  let place: string | null = null, on = true;
  const env: AmbEnv = { barAt: (t) => { try { return h.barAt ? h.barAt(t) : null; } catch { return null; } } };
  let cur: AmbienceBed | null = null;
  const old: AmbienceBed[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = (): void => {
    const t = h.now();
    if (t !== null) {
      if (cur) cur.advance(t + 0.4);
      for (let i = old.length - 1; i >= 0; i--) if (t > old[i].endT + 0.05 || old[i].freed) { old[i].free(); old.splice(i, 1); }
    } else {
      // the context is gone (disposed): free everything now
      if (cur) cur.free();
      for (const b of old) b.free();
      cur = null; old.length = 0;
    }
    if (!cur && !old.length && timer) { clearInterval(timer); timer = null; }
  };
  const retire = (b: AmbienceBed, f: number): void => { b.stop(h.now() ?? 0, f); old.push(b); };
  function sync(): void {
    const c = h.ctx(), out = h.out();
    const k = place === null ? '' : ambKey(place);
    const want = on && k !== '' && loaded.has(k) && h.ok() && !!c && !!out;
    if (cur && (!want || cur.place !== k)) { retire(cur, AMB_XFADE_S); cur = null; }
    if (want && !cur && c && out) {
      const r = loaded.get(k) as AmbRecipe;
      try { cur = new AmbienceBed(c, out, k, r, c.currentTime + 0.02, h.rng, old.length ? AMB_XFADE_S : AMB_FADE_IN_S, env); cur.advance(c.currentTime + 0.4); } catch { cur = null; }
    }
    if ((cur || old.length) && !timer) timer = setInterval(tick, 100);
  }
  return {
    set(p) { if (p.place !== undefined) place = p.place; if (p.on !== undefined) on = p.on; sync(); },
    sync,
    dip(from, until) { if (cur) cur.dip(from, until); },
    puff(t) { if (cur) cur.puff(t); },
    weather(v) { const t = h.now(); if (cur && t !== null) cur.weather(t + 0.02, v); },
    halt() {
      const all = cur ? [cur, ...old] : old.slice();
      cur = null; old.length = 0;
      for (const b of all) { b.stop(h.now() ?? 0, AMB_PAUSE_S); old.push(b); }
      // freed by the tick once silent (within AMB_PAUSE_S + 0.1 s); a suspended context gets no tick, so free them on a timer too
      setTimeout(() => { for (const b of all) b.free(); }, (AMB_PAUSE_S + 0.06) * 1000);
      if (!timer) timer = setInterval(tick, 100);
    },
    get live() { return (cur ? 1 : 0) + old.length; },
  };
}

/* ═══════════════════════════════ the held creak (PROP_SOUND creak: the rocker, the swing) ═══════════════════════════════ */

export interface HeldCreak extends VoiceGroup { lastUpdateT: number; update(level: number, at: number, pan?: number): void }

/** A wooden hinge creaking: a stick-slip pulse train (a pulse wave at the slip rate) striking one low resonance, louder and faster with
 *  the motion (level 0..1 = the speed). Dead-man: fading 0.15 s after the last update (silent by 0.3 s), sources stopped 0.6 s after it. `key` sets the
 *  wood's pitch (a little different per thing). */
export function creak(ctx: Ctx, out: AudioNode, t0: number, rng: Rng, pan: number, key: number): HeldCreak {
  const t = Math.max(0, fin(t0, 0));
  const bag = new Bag(ctx, out, 'creak', pan, true);
  const f = (280 + 37 * (Math.abs(key | 0) % 5)) * (1 + 0.04 * (rng() - 0.5));
  const car = bag.osc('sine', f, t);
  car.setPeriodicWave(harmonicWave(ctx, 'creak', [1, 0.5, 0.35, 0.2, 0.1]));
  const pw = pulseWave(ctx, 'slip', [1, 0.9, 0.8, 0.6, 0.45, 0.3, 0.2]);
  const slip = bag.osc('sine', 9, t);
  slip.setPeriodicWave(pw.wave);
  const am = bag.gain(0);
  slip.connect(am.gain);
  const bp = bag.biquad('bandpass', f * 2.2, 2.5);
  const env = bag.gain(0);
  car.connect(am); am.connect(bp); bp.connect(env); env.connect(bag.head);
  const srcs = [car, slip];
  let stopAt = t + 0.6, last = t;
  for (const s of srcs) s.stop(stopAt);
  bag.endTime = stopAt + 0.02;
  const A = dbToGain(-22);
  return {
    kind: 'creak', held: true,
    get endTime() { return bag.endTime; }, get alive() { return bag.alive; }, get dying() { return bag.dying; },
    get lastUpdateT() { return last; },
    kill: (fd, at) => bag.kill(fd, at), free: () => bag.free(),
    update(level, at, pn) {
      if (!bag.alive || bag.dying) return;
      const u = Math.max(t, fin(at, ctx.currentTime)), L = clamp(fin(level, 0), 0, 1);
      last = u;
      slip.frequency.setTargetAtTime(7 + 16 * L, u, 0.05);
      env.gain.cancelScheduledValues(u);
      env.gain.setTargetAtTime(L < 0.05 ? 0 : A * Math.pow(L, 0.8), u, 0.05);
      env.gain.setTargetAtTime(0, u + 0.15, 0.02);
      if (pn !== undefined && bag.panner) bag.panner.pan.setTargetAtTime(clamp(fin(pn, 0), -1, 1), u, 0.05);
      if (stopAt - u < 0.4) { stopAt = u + 0.6; try { for (const s of srcs) s.stop(stopAt); bag.endTime = stopAt + 0.02; } catch { /* the sweep ends it */ } }
    },
  };
}

/* ═══════════════════════════════ recipe helpers (round 2; the recipes import these with the away chunk) ═══════════════════════════════ */

/** A layer of a bed: the bed's noise mix through one filter into one gain (2 nodes, freed with the bed). */
export function layer(ctx: Ctx, mix: AudioNode, out: AudioNode, add: (n: AudioNode) => void, type: BiquadFilterType, f: number, q: number, gain: number): { f: BiquadFilterNode; g: GainNode } {
  const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; add(b);
  const g = ctx.createGain(); g.gain.value = gain; add(g);
  mix.connect(b); b.connect(g); g.connect(out);
  return { f: b, g };
}

/** Weather follow (setAmbience weather): a recipe keeps its own seeded timer unless the shell sent a weather event in the last 30 s. */
export class WeatherClock {
  private last = -1e9;
  next: number;
  private readonly lo: number;
  private readonly hi: number;
  constructor(t: number, lo: number, hi: number, rng: Rng) { this.lo = lo; this.hi = hi; this.next = t + 1 + rng() * (lo * 0.5); }
  /** The shell's event at t: true (it now leads). */
  heard(t: number): void { this.last = t; }
  /** The own timer's events in [from, until): calls fn(t) for each, unless the shell has led in the last 30 s. */
  run(from: number, until: number, rng: Rng, fn: (t: number) => void): void {
    while (this.next < until) {
      if (this.next >= from && this.next > this.last + 30) fn(this.next);
      this.next += this.lo + (this.hi - this.lo) * rng();
    }
  }
}

/** Random micro-ticks (rain patter, sizzle) as one gain curve over [from, until): Poisson at `rate` a second, each a 1 ms rise and a
 *  `decayMs` fall, levels a * (0.3..1); written onto `g` (no node per tick). */
export function patterCurve(g: AudioParam, from: number, until: number, rate: number, a: number, decayMs: number, rng: Rng): void {
  const d = until - from;
  if (!(d > 0.002) || !(a > 0)) return;
  const n = Math.max(4, Math.ceil(d * 1000)), c = new Float32Array(n);
  const tau = Math.max(0.3, decayMs);
  let t = -Math.log(1 - rng()) / Math.max(rate, 1e-6);
  while (t < d) {
    const i0 = Math.floor(t * 1000), v = a * (0.3 + 0.7 * rng());
    for (let i = i0; i < Math.min(n, i0 + Math.ceil(tau * 5)); i++) c[i] = Math.max(c[i], v * Math.exp(-(i - i0) / tau));
    t += -Math.log(1 - rng()) / Math.max(rate, 1e-6);
  }
  try { g.setValueCurveAtTime(c, from, d - 0.0002); } catch { /* an overlapping event: skip this window */ }
}

/** One Minnaert bubble channel for a bed (drips, pops, a pull-back fizz): ONE oscillator and ONE gain for the bed's whole life, each
 *  bubble an automation of them (dsp.ts bubble()'s pitch, damping and soft onset), so a bed's node count never grows with its drips
 *  (at most 14 steady). Monophonic: a bubble that starts while another rings cuts it (drips and fizz are sparse and short). */
export class BubbleChannel {
  private readonly o: OscillatorNode;
  private readonly g: GainNode;
  private readonly sr: number;
  constructor(ctx: Ctx, out: AudioNode, t: number, add: (n: AudioNode) => void) {
    this.sr = ctx.sampleRate;
    this.o = ctx.createOscillator(); this.g = ctx.createGain();
    add(this.o); add(this.g);
    this.g.gain.value = 0;
    this.o.connect(this.g); this.g.connect(out);
    this.o.start(t);
  }
  play(t: number, radiusM: number, amp: number, rise = 0.3, soft = 1): void {
    const r = clamp(fin(radiusM, 0.002), 0.0003, 0.03), f0 = 3.26 / r;
    const d = (0.13 / r + 0.0072 / Math.pow(r, 1.5)) / Math.max(soft, 0.1);
    if (!(f0 < this.sr * 0.4) || !Number.isFinite(t)) return;
    const a = clamp(fin(amp, 0), 0, 4), att = Math.min(0.0017, 0.9 / d), f = this.o.frequency, g = this.g.gain;
    try {
      f.setValueAtTime(f0, t);
      f.setTargetAtTime(Math.min(f0 * (1 + clamp(fin(rise, 0.3), -0.4, 1.5)), this.sr * 0.45), t, 0.9 / d);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(a * 0.22, t + att * 0.45);
      g.linearRampToValueAtTime(a, t + att);
      g.setTargetAtTime(0, t + att, 1 / d);
    } catch { /* closed */ }
  }
}
