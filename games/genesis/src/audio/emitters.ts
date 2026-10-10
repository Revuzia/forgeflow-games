// GENESIS — point sources in 3D (CONTRACT §17: spatial fires, crowds, storms, impacts, launches, the creature). The
// probe (scene.ts) lists what could be heard; this pool keeps the loudest few alive as continuous voices placed with
// HRTF panners, re-placed every frame from their body-frame positions (the camera turns and the world spins between
// probes), fading in when they enter the budget and out when they leave it.
//
// Each kind has a recipe of layers — looping textures, filtered noise, oscillators with slow LFOs — and events played
// through the shared voice budget into the emitter's own spatial input: a town's murmur over the work of its era
// (knapping, anvils, machines), a fire's crackle over its roar, a storm wall's rain and its thunder, every disaster
// kind (a tornado's howl, a swarm's buzz, a volcano's booms, a leviathan's moans, the forgetting fog's whispers…), the
// creature's footsteps, growls and breath by what it is doing, a rocket's roar on the ascent, a herd's calls by its
// species' voice (owls and howls at night).

import type { AudioScene, EmitterKind, SceneEmitter } from './scene.ts';
import type { AmbienceHost } from './ambience.ts';
import type { BufferBank } from './bank.ts';
import { disasterFamily } from './eventmap.ts';
import { SpatialOut } from './spatial.ts';
import { bq, bufSrc, Knob, osc } from './synth.ts';
import { AnimState } from '../sim/types.ts';

export interface EmitterHost extends AmbienceHost {
  /** listener-local [x, y, z, d] of a body-frame point on a planet, with the current frames (null: planet gone) */
  toLocal(planet: number, body: ArrayLike<number>): [number, number, number, number] | null;
}

type Filt = [BiquadFilterType, number, number?];
type Lfo = ['gain' | 'freq', number, number];
type Layer =
  | ['loop', string, number, number?, Filt?, Lfo?]
  | ['noise', 'white' | 'pink' | 'brown', number, Filt?, Lfo?]
  | ['osc', OscillatorType, number, number, Filt?, Lfo?]
  | ['ev', string, number, number];

const SWARM: Layer[] = [
  ['osc', 'sawtooth', 188, 0.05, ['lowpass', 1500], ['gain', 27, 0.03]], ['osc', 'sawtooth', 213, 0.05, ['lowpass', 1500]],
  ['osc', 'sawtooth', 241, 0.045, ['lowpass', 1500], ['gain', 31, 0.02]], ['osc', 'sawtooth', 262, 0.035, ['lowpass', 1500]],
];

/** the continuous sound of every disaster kind (unknown kinds use their family's) */
const DISASTER_BEDS: Record<string, Layer[]> = {
  meteor: [['noise', 'pink', 0.55, ['bandpass', 1500, 3]], ['noise', 'brown', 0.6, ['lowpass', 200]]],
  'meteor-shower': [['ev', 'bed.whistle', 0.7, 0.6], ['noise', 'brown', 0.2, ['lowpass', 150]]],
  comet: [['noise', 'pink', 0.35, ['bandpass', 900, 2], ['freq', 0.05, 400]], ['osc', 'sine', 1760, 0.02, undefined, ['gain', 0.2, 0.01]]],
  swarm: SWARM,
  infestation: SWARM,
  volcano: [['noise', 'brown', 0.8, ['lowpass', 60], ['gain', 0.2, 0.25]], ['loop', 'lava', 0.5], ['ev', 'bed.boom', 0.12, 0.8]],
  supervolcano: [['noise', 'brown', 1, ['lowpass', 50], ['gain', 0.15, 0.3]], ['loop', 'lava', 0.6, 0.8], ['ev', 'bed.boom', 0.25, 1]],
  quake: [['noise', 'brown', 0.9, ['lowpass', 70], ['gain', 6.5, 0.4]], ['loop', 'crackle', 0.3, 0.7, ['lowpass', 700]]],
  sinkhole: [['noise', 'brown', 0.7, ['lowpass', 80]], ['loop', 'hail', 0.3, 0.5, ['lowpass', 1200]]],
  rift: [['noise', 'white', 0.15, ['bandpass', 3200, 1.5]], ['noise', 'brown', 0.6, ['lowpass', 80]], ['ev', 'bed.crack', 0.4, 0.6]],
  flood: [['noise', 'pink', 0.5, ['lowpass', 900]], ['noise', 'brown', 0.6, ['lowpass', 300]], ['loop', 'babble', 0.5, 0.8]],
  tsunami: [['noise', 'pink', 0.7, ['lowpass', 1200], ['gain', 0.15, 0.2]], ['noise', 'brown', 0.8, ['lowpass', 300]], ['loop', 'babble', 0.4, 0.7]],
  drought: [['noise', 'pink', 0.3, ['bandpass', 1800, 1.5], ['gain', 0.2, 0.12]], ['loop', 'cicadas', 0.3, 1.15]],
  'dust-bowl': [['noise', 'white', 0.35, ['bandpass', 3200, 0.8], ['gain', 0.3, 0.15]], ['noise', 'brown', 0.4, ['lowpass', 220]]],
  hurricane: [['noise', 'pink', 0.6, ['bandpass', 450, 6], ['freq', 0.07, 250]], ['noise', 'brown', 0.7, ['lowpass', 220]], ['loop', 'patter', 0.4]],
  tornado: [['noise', 'pink', 0.7, ['bandpass', 600, 7], ['freq', 0.11, 300]], ['noise', 'brown', 0.8, ['lowpass', 200]], ['loop', 'crackle', 0.3, 0.8, ['lowpass', 1500]]],
  wildfire: [['loop', 'crackle', 0.7], ['noise', 'brown', 0.7, ['lowpass', 380]]],
  firestorm: [['loop', 'crackle', 0.8, 0.9], ['noise', 'brown', 0.9, ['lowpass', 300]], ['noise', 'pink', 0.3, ['bandpass', 500, 3], ['freq', 0.1, 150]]],
  plague: [['osc', 'sine', 98, 0.12, undefined, ['gain', 0.1, 0.05]], ['osc', 'sine', 103.8, 0.12], ['noise', 'pink', 0.08, ['bandpass', 480, 2], ['gain', 0.2, 0.05]], ['ev', 'bed.cough', 0.12, 0.5]],
  blight: [['loop', 'crackle', 0.2, 1.3, ['highpass', 3000]], ['noise', 'pink', 0.1, ['highpass', 3500]]],
  'solar-flare': [['ev', 'bed.whistler', 0.5, 0.5], ['noise', 'white', 0.04, ['highpass', 4000], ['gain', 3, 0.03]]],
  'magnetic-storm': [['ev', 'bed.whistler', 0.35, 0.5], ['osc', 'sine', 55, 0.06, undefined, ['gain', 0.1, 0.04]]],
  'impact-winter': [['noise', 'white', 0.15, ['bandpass', 3000, 3], ['gain', 0.15, 0.08]], ['noise', 'brown', 0.4, ['lowpass', 200]], ['ev', 'bed.crack', 0.1, 0.4]],
  'ice-age': [['noise', 'white', 0.18, ['bandpass', 3200, 3], ['gain', 0.12, 0.1]], ['ev', 'bed.crack', 0.15, 0.5]],
  'heat-wave': [['loop', 'cicadas', 0.4, 1.2], ['osc', 'sine', 3500, 0.01, undefined, ['gain', 0.4, 0.008]]],
  'gravity-slip': [['osc', 'sine', 140, 0.06, undefined, ['freq', 0.08, 60]], ['osc', 'sine', 211, 0.05, undefined, ['freq', 0.06, 80]], ['noise', 'pink', 0.15, ['bandpass', 800, 2], ['freq', 0.1, 500]]],
  eclipse: [['osc', 'sawtooth', 55, 0.05, ['lowpass', 220]], ['osc', 'sawtooth', 82.6, 0.04, ['lowpass', 220]], ['osc', 'sine', 41.2, 0.12, undefined, ['gain', 0.05, 0.08]]],
  'moon-fall': [['noise', 'brown', 0.9, ['lowpass', 70]], ['osc', 'sine', 32, 0.25, undefined, ['gain', 0.15, 0.15]]],
  'rogue-flyby': [['noise', 'brown', 0.7, ['lowpass', 55]], ['osc', 'sine', 27, 0.25, undefined, ['gain', 0.08, 0.12]]],
  'acid-rain': [['noise', 'white', 0.3, ['highpass', 5000]], ['loop', 'crackle', 0.3, 1.5, ['highpass', 3500]], ['loop', 'patter', 0.4, 1.1]],
  'glass-storm': [['ev', 'bed.tinkle', 3, 0.6], ['ev', 'bed.zap', 0.5, 0.5], ['noise', 'pink', 0.2, ['bandpass', 2500, 1]]],
  overgrowth: [['ev', 'bed.creak', 0.5, 0.6], ['noise', 'pink', 0.15, ['highpass', 2000], ['gain', 0.2, 0.08]]],
  leviathan: [['ev', 'bed.moan', 0.12, 0.8], ['ev', 'bed.splash', 0.2, 0.6], ['noise', 'pink', 0.3, ['lowpass', 600], ['gain', 0.1, 0.15]]],
  'forgetting-fog': [['ev', 'bed.whisper', 0.9, 0.5], ['noise', 'pink', 0.12, ['lowpass', 500]]],
  stampede: [['ev', 'bed.hoof', 8, 0.6], ['noise', 'brown', 0.6, ['lowpass', 140]], ['noise', 'pink', 0.12, ['highpass', 1500]]],
};

/** a family's representative kind (for disasters the client has no bed for: a mod's, the freeform field's) */
const FAMILY_KIND: Record<string, string> = {
  incoming: 'meteor', shower: 'meteor-shower', comet: 'comet', swarm: 'swarm', eruption: 'volcano', quake: 'quake',
  collapse: 'sinkhole', rift: 'rift', wave: 'flood', dry: 'drought', wind: 'tornado', fire: 'wildfire', plague: 'plague',
  blight: 'blight', cosmic: 'solar-flare', cold: 'ice-age', heat: 'heat-wave', gravity: 'gravity-slip', eclipse: 'eclipse',
  celestial: 'moon-fall', acid: 'acid-rain', glass: 'glass-storm', growth: 'overgrowth', leviathan: 'leviathan',
  fog: 'forgetting-fog', stampede: 'stampede',
};

export function disasterBed(kind: string): Layer[] {
  return DISASTER_BEDS[kind] ?? DISASTER_BEDS[FAMILY_KIND[disasterFamily(kind)] ?? 'quake'];
}

/** loudness of a kind at level 1 */
const KIND_GAIN: Record<EmitterKind, number> = { fire: 0.8, crowd: 0.5, lava: 0.7, storm: 0.6, creature: 0.9, ship: 1, herd: 0.75, disaster: 0.85 };

class EmitterVoice {
  readonly key: string;
  readonly kind: EmitterKind;
  readonly sub: string;
  planet: number;
  body: [number, number, number];
  target = 0;
  level = 0;
  spread = 0;
  size = 0;
  param = 0;
  private readonly ctx: BaseAudioContext;
  private readonly bank: BufferBank;
  private readonly host: EmitterHost;
  readonly sp: SpatialOut;
  private srcs: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private evs: { cue: string; rate: number; level: number }[] = [];
  private knobs: Record<string, Knob> = {};
  private built = false;
  private gone = 0;
  disposed = false;

  constructor(ctx: BaseAudioContext, bank: BufferBank, host: EmitterHost, dest: AudioNode, hrtf: boolean, e: SceneEmitter, planet: number) {
    this.ctx = ctx; this.bank = bank; this.host = host;
    this.key = e.key; this.kind = e.kind; this.sub = e.sub; this.planet = planet;
    this.body = [e.body[0], e.body[1], e.body[2]];
    this.sp = new SpatialOut(ctx, dest, hrtf);
  }

  private loop(name: string, gain: number, rate = 1, f?: Filt, lfo?: Lfo): boolean {
    const buf = this.bank.get(name);
    if (!buf) return false;
    const now = this.ctx.currentTime;
    const s = bufSrc(this.ctx, buf, now, null, rate * (0.97 + 0.06 * this.host.rand()), true, this.host.rand() * buf.duration);
    this.chain(s, gain, f, lfo);
    return true;
  }

  private chain(src: AudioScheduledSourceNode, gain: number, f?: Filt, lfo?: Lfo): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let filter: BiquadFilterNode | null = null;
    if (f) { filter = bq(this.ctx, f[0], f[1], f[2] ?? 0.707); src.connect(filter); filter.connect(g); this.nodes.push(filter); }
    else src.connect(g);
    g.connect(this.sp.input);
    this.srcs.push(src);
    this.nodes.push(g);
    if (lfo) {
      const now = this.ctx.currentTime;
      const o = osc(this.ctx, 'sine', lfo[1], now, 1e9);
      const d = this.ctx.createGain();
      d.gain.value = lfo[2];
      o.connect(d);
      d.connect(lfo[0] === 'gain' ? g.gain : (filter ? filter.frequency : g.gain));
      this.srcs.push(o);
      this.nodes.push(d);
    }
    if (filter && !this.knobs.f0) this.knobs.f0 = new Knob(filter.frequency);
    return g;
  }

  private layers(ls: Layer[]): boolean {
    for (const l of ls) {
      if (l[0] === 'loop') { if (!this.loop(l[1], l[2], l[3] ?? 1, l[4], l[5])) return false; }
      else if (l[0] === 'noise') { if (!this.loop(l[1], l[2], 1, l[3], l[4])) return false; }
      else if (l[0] === 'osc') this.chain(osc(this.ctx, l[1], l[2], this.ctx.currentTime, 1e9, (this.host.rand() - 0.5) * 8), l[3], l[4], l[5]);
      else this.evs.push({ cue: l[1], rate: l[2], level: l[3] });
    }
    return true;
  }

  /** build the layers (false while a buffer is still rendering: try again next frame) */
  private build(): boolean {
    const big = this.size > 80;
    switch (this.kind) {
      case 'fire':
        return this.layers([['loop', 'crackle', 0.7], ['noise', 'brown', Math.min(0.9, 0.3 + this.size * 0.08), ['lowpass', 300 + Math.min(600, this.size * 60), 0.8], ['gain', 0.3, 0.12]]]);
      case 'crowd':
        return this.layers([
          ['loop', big ? 'murmur2' : 'murmur', 0.7, 1, ['lowpass', 3600, 0.6]],
          ['loop', `work-${this.sub}`, big ? 0.4 : 0.28, 1, ['lowpass', 5000]],
        ]);
      case 'lava':
        return this.layers([['loop', 'lava', 0.75], ['noise', 'brown', 0.55, ['lowpass', 85, 0.9], ['gain', 0.17, 0.2]]]);
      case 'storm':
        return this.layers([['noise', 'pink', 0.45, ['lowpass', 1400, 0.6]], ['noise', 'brown', 0.6, ['lowpass', 160]], ['loop', 'patter', 0.2, 0.9, ['lowpass', 2500]], ['ev', 'thunder', 0.07, 0.6]]);
      case 'creature':
        // breath (a snore when it sleeps); steps and voice come from the tick
        return this.layers([['noise', 'pink', 0.12, ['bandpass', 340, 2], ['gain', 0.25, 0.1]]]);
      case 'ship':
        switch (this.sub) {
          case 'ascent': case 'descent':
            return this.layers([
              ['noise', 'brown', 0.9, ['lowpass', 260, 0.8]], ['noise', 'white', 0.35, ['bandpass', 1800, 0.6], ['gain', 13, 0.25]],
              ['osc', 'sine', 38, 0.4, undefined, ['gain', 3, 0.1]],
            ]);
          case 'fuelling': return this.layers([['noise', 'white', 0.22, ['highpass', 3500]], ['osc', 'sawtooth', 55, 0.18, ['lowpass', 180]]]);
          case 'building': return this.layers([['loop', 'work-metal', 0.55], ['loop', 'work-machine', 0.25]]);
          case 'sailing': return this.layers([['loop', 'babble', 0.4, 0.6, ['lowpass', 1200]], ['ev', 'bed.creak', 0.3, 0.4]]);
          default: return this.layers([['osc', 'sawtooth', 50, 0.12, ['lowpass', 150]], ['noise', 'pink', 0.03, ['highpass', 4000]]]);
        }
      case 'herd':
        if (this.sub === 'swarm') return this.layers(SWARM);
        if (this.size > 6) return this.layers([['noise', 'pink', Math.min(0.25, 0.04 * Math.log2(this.size)), ['lowpass', 320]]]);
        return true;
      case 'disaster':
        return this.layers(disasterBed(this.sub));
    }
    return true;
  }

  update(e: SceneEmitter | null, now: number, dt: number, night: number): void {
    if (e) {
      this.target = e.level;
      this.body = [e.body[0], e.body[1], e.body[2]];
      this.spread = e.spread;
      this.size = e.size;
      this.param = e.param;
      this.gone = 0;
    } else {
      this.target = 0;
      this.gone += dt;
    }
    const k = 1 - Math.exp(-dt / 0.5);
    this.level += (this.target - this.level) * k;
    if (!this.built) { if (this.target > 0.003) this.built = this.build(); if (!this.built) return; }
    const loc = this.host.toLocal(this.planet, this.body);
    if (!loc) { this.target = 0; this.sp.fadeOut(now); return; }
    let lvl = this.level * KIND_GAIN[this.kind];
    // a falling body: louder and lower as it comes down (progress 0 → 1)
    if (this.kind === 'disaster' && (this.sub === 'meteor' || this.sub === 'comet' || this.sub === 'moon-fall')) {
      const p = Math.max(0, Math.min(1, this.param));
      lvl *= 0.25 + 0.75 * p * p;
      this.knobs.f0?.set(2600 - 2100 * p, now, 0.2);
    }
    this.sp.place(loc, lvl, now, this.spread);
    this.tick(now, dt, night);
  }

  private tick(now: number, dt: number, night: number): void {
    const lv = this.level;
    if (lv < 0.01) return;
    const r = this.host.rand;
    const fire = (cue: string, rate: number, level: number, size = 1, variant = ''): void => {
      if (r() < rate * dt) this.host.play(cue, { t: now + 0.03, dest: this.sp.input, level, size, variant, pri: 2 });
    };
    for (const ev of this.evs) fire(ev.cue, ev.rate, ev.level, this.size);
    if (this.kind === 'creature') {
      const a = this.param;
      const h = this.size;
      const step = a === AnimState.walk ? 1.5 : a === AnimState.run || a === AnimState.flee ? 2.8 : a === AnimState.dance ? 2.2
        : a === AnimState.work || a === AnimState.build || a === AnimState.chop || a === AnimState.dig ? 0.8 : 0;
      fire('bed.step', step, 0.9, h);
      if (a === AnimState.fight) fire('bed.growl', 0.7, 0.9, h);
      else if (a === AnimState.eat || a === AnimState.graze) fire('bed.munch', 0.6, 0.7, h);
      else if (a === AnimState.cheer || a === AnimState.dance) fire('creature.happy', 0.2, 0.6, h);
      else if (a === AnimState.mourn) fire('bed.moan', 0.08, 0.4, h);
      else if (a !== AnimState.sleep) fire('creature.call', 0.05, 0.6, h);
    } else if (this.kind === 'herd') {
      const nocturnal = this.param > 0;
      const awake = nocturnal ? night : 1 - 0.7 * night;
      const rate = (0.05 + 0.035 * Math.log2(1 + this.size)) * awake;
      if (this.sub === 'canine') fire('herd.canine', rate, 0.8, 1, night > 0.5 ? 'night' : '');
      else if (this.sub !== 'swarm') fire(`herd.${this.sub}`, rate, 0.8);
    }
  }

  dispose(now: number): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.srcs) { try { s.stop(now + 0.1); } catch { /* stopped */ } }
    const all: AudioNode[] = [...this.srcs, ...this.nodes];
    const sp = this.sp;
    setTimeout(() => { for (const n of all) { try { n.disconnect(); } catch { /* gone */ } } sp.dispose(); }, 300);
  }

  get gone_(): number { return this.gone; }
}

export class Emitters {
  private readonly ctx: BaseAudioContext;
  private readonly bank: BufferBank;
  private readonly dest: AudioNode;
  private readonly host: EmitterHost;
  private readonly hrtf: boolean;
  max: number;
  private voices = new Map<string, EmitterVoice>();

  constructor(ctx: BaseAudioContext, bank: BufferBank, dest: AudioNode, host: EmitterHost, hrtf: boolean, max: number) {
    this.ctx = ctx; this.bank = bank; this.dest = dest; this.host = host; this.hrtf = hrtf; this.max = max;
  }

  /** `scene` may be stale between probes (voices keep their last targets); call every frame */
  update(scene: AudioScene | null, now: number, dt: number): void {
    // keys are per world (two worlds can both have a 'fire:1203')
    const want = new Map<string, SceneEmitter>();
    if (scene) for (const e of scene.emitters) { if (want.size >= this.max) break; want.set(`${scene.planet}:${e.key}`, e); }
    for (const [key, e] of want) {
      let v = this.voices.get(key);
      // a ship that changed phase (fuelling → ascent) is a different sound
      if (v && v.sub !== e.sub) { v.dispose(now); this.voices.delete(key); v = undefined; }
      if (!v) {
        if (this.voices.size >= this.max * 1.5) continue;
        v = new EmitterVoice(this.ctx, this.bank, this.host, this.dest, this.hrtf, e, scene!.planet);
        this.voices.set(key, v);
      }
      v.planet = scene!.planet;
    }
    const night = scene ? 1 - scene.day : 0;
    for (const [key, v] of this.voices) {
      v.update(want.get(key) ?? null, now, dt, night);
      if (!want.has(key) && v.level < 0.002 && v.gone_ > 1.5) { v.dispose(now); this.voices.delete(key); }
    }
  }

  get count(): number { return this.voices.size; }

  list(): { key: string; level: number }[] {
    return [...this.voices.values()].map((v) => ({ key: v.key, level: Math.round(v.level * 1000) / 1000 }));
  }

  stop(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices.values()) v.dispose(now);
    this.voices.clear();
  }
}
