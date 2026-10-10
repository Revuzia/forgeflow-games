// GENESIS — layered ambience at the camera (CONTRACT §17). Each layer of the scene (scene.ts) drives a BED: a few
// WebAudio nodes (looping synthesized textures from the bank, filtered noise, oscillators) whose level glides toward
// the probe's target; beds that stay silent for a few seconds are torn down and rebuilt when needed, so a desert at
// noon does not pay for frogs. Some beds also SCHEDULE calls through the shared voice budget: birds of the biome by day
// (songbirds, larks, gulls, ducks, parrots, woodpeckers, doves, hawks), owls at night, surf waves breaking toward the
// shore, distant thunder rolls, the heartbeat on an airless world, whistlers in space.
//
// Levels are smoothed over seconds, so at 1000x a day that passes in a seventh of a second averages into a dim mix of
// day and night rather than flickering. The whole ambience passes a "hush" lowpass that closes in snow, fog and under
// water.

import type { AudioScene, BirdPalette, SceneLayers } from './scene.ts';
import type { BufferBank } from './bank.ts';
import { bq, bufSrc, Knob, osc } from './synth.ts';
import { SpatialOut } from './spatial.ts';

export interface PlayOpts {
  t: number;
  dest?: AudioNode;
  level: number;
  size?: number;
  count?: number;
  variant?: string;
  pri?: number;
}

/** what the ambience needs from the engine */
export interface AmbienceHost {
  play(cue: string, o: PlayOpts): number;
  rand(): number;
}

type BuildFn = (b: Bed, now: number) => boolean;
type TickFn = (b: Bed, level: number, now: number, dt: number) => void;

/** one ambience layer: its nodes exist only while it is (or was recently) audible */
class Bed {
  readonly name: string;
  readonly out: GainNode;
  readonly ctx: BaseAudioContext;
  readonly bank: BufferBank;
  private readonly kOut: Knob;
  private readonly buildFn: BuildFn;
  readonly tickFn: TickFn | null;
  readonly gain: number;
  readonly tau: number;
  srcs: AudioScheduledSourceNode[] = [];
  nodes: AudioNode[] = [];
  knobs: Record<string, Knob> = {};
  built = false;
  level = 0;
  private silentFor = 0;
  /** free state for the tick (gust phases, next event times) */
  st: Record<string, number> = {};
  readonly rand: () => number;

  constructor(ctx: BaseAudioContext, bank: BufferBank, dest: AudioNode, name: string, gain: number, tau: number, build: BuildFn, tick: TickFn | null, rand: () => number) {
    this.ctx = ctx; this.bank = bank; this.name = name; this.gain = gain; this.tau = tau; this.rand = rand;
    this.buildFn = build; this.tickFn = tick;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.kOut = new Knob(this.out.gain);
  }

  /** a looping bank texture → (filter) → gain → `dest` (default: the bed's output); null while the buffer renders */
  loop(name: string, gain: number, rate = 1, filter?: [BiquadFilterType, number, number?], now = this.ctx.currentTime, dest: AudioNode = this.out): { g: GainNode; f: BiquadFilterNode | null } | null {
    const buf = this.bank.get(name);
    if (!buf) return null;
    const s = bufSrc(this.ctx, buf, now, null, rate, true, this.rand() * buf.duration);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let f: BiquadFilterNode | null = null;
    if (filter) { f = bq(this.ctx, filter[0], filter[1], filter[2] ?? 0.707); s.connect(f); f.connect(g); this.nodes.push(f); }
    else s.connect(g);
    g.connect(dest);
    this.srcs.push(s);
    this.nodes.push(g);
    return { g, f };
  }

  /** run when the bed is torn down (extra nodes a build made: a spatial output) */
  onTeardown: (() => void)[] = [];

  /** an oscillator → gain → out */
  tone(type: OscillatorType, hz: number, gain: number, now: number, detune = 0, dest: AudioNode = this.out): OscillatorNode {
    const o = osc(this.ctx, type, hz, now, 1e9, detune);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    o.connect(g);
    g.connect(dest);
    this.srcs.push(o);
    this.nodes.push(g);
    return o;
  }

  /** a slow sine LFO onto a parameter */
  lfo(p: AudioParam, rate: number, depth: number, now: number): void {
    const o = osc(this.ctx, 'sine', rate, now, 1e9);
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(p);
    this.srcs.push(o);
    this.nodes.push(g);
  }

  drive(target: number, now: number, dt: number): void {
    const k = 1 - Math.exp(-dt / Math.max(0.05, this.tau));
    this.level += (target - this.level) * k;
    if (this.level < 1e-4 && target <= 0) this.level = 0;
    if (!this.built && target > 0.003) this.built = this.buildFn(this, now);
    if (!this.built) return;
    this.kOut.set(this.level * this.gain, now, 0.08);
    if (this.tickFn) this.tickFn(this, this.level, now, dt);
    if (this.level < 0.002 && target <= 0.002) {
      this.silentFor += dt;
      if (this.silentFor > 4) this.teardown(now);
    } else this.silentFor = 0;
  }

  teardown(now: number): void {
    for (const s of this.srcs) { try { s.stop(now + 0.05); } catch { /* stopped */ } }
    const nodes = this.nodes, srcs = this.srcs;
    setTimeout(() => { for (const n of [...srcs, ...nodes]) { try { n.disconnect(); } catch { /* gone */ } } }, 200);
    for (const f of this.onTeardown) { try { f(); } catch { /* gone */ } }
    this.onTeardown = [];
    this.srcs = [];
    this.nodes = [];
    this.knobs = {};
    this.built = false;
    this.silentFor = 0;
    this.st = {};
  }
}

const BIRD_CALLS: (keyof BirdPalette)[] = ['song', 'lark', 'jungle', 'gull', 'water', 'taiga', 'desert', 'raptor'];

export class Ambience {
  private readonly ctx: BaseAudioContext;
  private readonly bank: BufferBank;
  private readonly host: AmbienceHost;
  private readonly input: GainNode;
  private readonly hush: BiquadFilterNode;
  private readonly kHush: Knob;
  private readonly beds: Bed[] = [];
  private readonly byName = new Map<string, Bed>();
  private surfOut: SpatialOut | null = null;
  private readonly hrtf: boolean;
  private targets: SceneLayers | null = null;
  private birds: BirdPalette | null = null;
  private coast: [number, number, number] | null = null;
  private windN = 0;
  private dusk = 0;
  private night = 0;
  private starActivity = 0;
  /** real seconds since a sim lightning strike was heard (the distant-roll scheduler stands back while real ones sound) */
  thunderQuiet = 1e9;

  constructor(ctx: BaseAudioContext, bank: BufferBank, dest: AudioNode, host: AmbienceHost, hrtf: boolean) {
    this.ctx = ctx; this.bank = bank; this.host = host; this.hrtf = hrtf;
    this.input = ctx.createGain();
    this.hush = bq(ctx, 'lowpass', 18000, 0.6);
    this.input.connect(this.hush);
    this.hush.connect(dest);
    this.kHush = new Knob(this.hush.frequency);
    this.makeBeds();
  }

  private bed(name: string, gain: number, tau: number, build: BuildFn, tick: TickFn | null = null): void {
    const b = new Bed(this.ctx, this.bank, this.input, name, gain, tau, build, tick, () => this.host.rand());
    this.beds.push(b);
    this.byName.set(name, b);
  }

  private makeBeds(): void {
    const ctx = this.ctx;
    const host = this.host;
    // ── wind: a low roar and a whistle per ear, each with its own gusts ──
    this.bed('wind', 0.55, 1.2, (b, now) => {
      if (!this.bank.get('brown') || !this.bank.get('pink')) return false;
      for (const side of [-1, 1]) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = side * 0.7;
        pan.connect(b.out);
        b.nodes.push(pan);
        const low = b.loop('brown', 0.8, side < 0 ? 1 : 1.07, ['lowpass', 300, 0.8], now, pan);
        const high = b.loop('pink', 0.3, side < 0 ? 1 : 0.96, ['bandpass', 700, 3], now, pan);
        if (!low || !high || !low.f || !high.f) return false;
        const s = side < 0 ? 'L' : 'R';
        b.knobs[`lowF${s}`] = new Knob(low.f.frequency); b.knobs[`highF${s}`] = new Knob(high.f.frequency);
        b.knobs[`highQ${s}`] = new Knob(high.f.Q); b.knobs[`low${s}`] = new Knob(low.g.gain); b.knobs[`high${s}`] = new Knob(high.g.gain);
      }
      return true;
    }, (b, _level, now, dt) => {
      const t = this.targets;
      if (!t) return;
      for (const s of ['L', 'R']) {
        // gusts: a random walk toward targets that change every second or few
        const due = b.st[`next${s}`] ?? 0;
        if (now >= due) { b.st[`goal${s}`] = Math.pow(host.rand(), 1.4); b.st[`next${s}`] = now + 0.6 + host.rand() * 2.6 / (0.5 + t.gust); }
        const g0 = b.st[`g${s}`] ?? 0.5;
        const g = g0 + ((b.st[`goal${s}`] ?? 0.5) - g0) * (1 - Math.exp(-dt * (0.6 + 1.4 * t.gust)));
        b.st[`g${s}`] = g;
        const gust = 0.3 + g * (0.5 + 0.9 * t.gust);
        b.knobs[`low${s}`]?.set(0.7 * gust, now, 0.12);
        b.knobs[`lowF${s}`]?.set(170 + 480 * g * (0.4 + this.windN), now, 0.15);
        // a narrow band of noise holds a small fraction of the roar's energy: the whistle (the howl over ridges and
        // round the god's ears high up) needs a much larger gain to be heard, and rises with the gusts
        b.knobs[`high${s}`]?.set(3.2 * (0.06 + t.windPitch) * Math.pow(gust, 1.5), now, 0.12);
        b.knobs[`highF${s}`]?.set(280 + 1400 * t.windPitch * (0.5 + 0.7 * g), now, 0.25);
        b.knobs[`highQ${s}`]?.set(3 + 16 * t.windPitch, now, 0.3);
      }
    });
    // ── surf: waves rising, breaking and hissing back, from the direction of the shore ──
    this.bed('surf', 0.6, 1.5, (b, now) => {
      if (!this.bank.get('pink') || !this.bank.get('white')) return false;
      const so = new SpatialOut(ctx, b.out, this.hrtf);
      const wave = b.loop('pink', 0.15, 1, ['lowpass', 900, 0.6], now, so.input);
      const hiss = b.loop('white', 0.05, 1, ['highpass', 2600, 0.7], now, so.input);
      if (!wave || !hiss) { so.dispose(); return false; }
      this.surfOut = so;
      b.onTeardown.push(() => { so.dispose(); if (this.surfOut === so) this.surfOut = null; });
      b.st.next = now + 0.2;
      b.knobs.wave = new Knob(wave.g.gain); b.knobs.hiss = new Knob(hiss.g.gain);
      return true;
    }, (b, level, now) => {
      const so = this.surfOut;
      if (so) so.place(this.coast ? [this.coast[0] * 40, this.coast[1] * 40, this.coast[2] * 40] : [0, 0, -40], 1, now, this.coast ? 0.25 : 0.6);
      if (now < b.st.next || level < 0.005) return;
      // schedule one wave: swell, crash, backwash hiss
      const rise = 1.1 + host.rand() * 1.2;
      const peak = 0.75 + host.rand() * 0.35;
      const t0 = now + 0.05;
      const wave = b.knobs.wave.p, hiss = b.knobs.hiss.p;
      wave.cancelScheduledValues(t0);
      wave.setTargetAtTime(peak, t0, rise / 3);
      wave.setTargetAtTime(0.32, t0 + rise, 0.45);
      wave.setTargetAtTime(0.12, t0 + rise + 1.6, 1.1);
      hiss.cancelScheduledValues(t0);
      hiss.setTargetAtTime(0.06, t0, 0.3);
      hiss.setTargetAtTime(0.75 * peak, t0 + rise * 0.9, 0.12);
      hiss.setTargetAtTime(0.04, t0 + rise + 0.35, 1.0);
      b.st.next = t0 + rise + 2.2 + host.rand() * 3.6 / (0.6 + this.windN);
    });
    // ── open sea: a slow swell all around ──
    this.bed('sea', 0.45, 2, (b, now) => {
      const g = b.loop('brown', 0.7, 1, ['lowpass', 380, 0.7], now);
      const h = b.loop('pink', 0.12, 0.9, ['lowpass', 1400, 0.7], now);
      if (!g || !h) return false;
      b.lfo(g.g.gain, 0.11, 0.35, now);
      b.lfo(h.g.gain, 0.13, 0.08, now);
      return true;
    });
    // ── birds: calls scheduled by the biome palette (the bed itself is silent; calls play through the budget) ──
    this.bed('birds', 1, 2.2, () => true, (b, level, now, dt) => {
      const pal = this.birds;
      if (!pal || level < 0.01) return;
      // Poisson arrivals, a dawn chorus a little busier
      const rate = level * (1.3 + 1.5 * this.dusk);
      if (host.rand() > rate * dt) return;
      let x = host.rand(), call: keyof BirdPalette = 'song';
      for (const k of BIRD_CALLS) { x -= pal[k]; if (x <= 0) { call = k; break; } }
      this.call(`bird.${call}`, level * (0.4 + 0.6 * host.rand()), now, 0.85, b.out);
    });
    // owls by night, where there are trees
    this.bed('owls', 1, 3, () => true, (_b, level, now, dt) => {
      if (level < 0.02 || host.rand() > level * 0.12 * dt) return;
      this.call('bird.night', level * 0.8, now, 0.7, this.input);
    });
    // ── insects, frogs ──
    this.bed('insects', 0.3, 2.5, (b, now) => {
      const a = b.loop('crickets', 0.8, 1, undefined, now);
      const c = b.loop('crickets', 0.45, 1.035, ['highpass', 3000], now);
      return !!a && !!c;
    });
    this.bed('cicadas', 0.22, 2.5, (b, now) => {
      const g = b.loop('cicadas', 0.9, 1, undefined, now);
      if (!g) return false;
      b.lfo(g.g.gain, 0.06, 0.25, now);
      return true;
    });
    this.bed('frogs', 0.3, 2.5, (b, now) => !!b.loop('frogs', 0.9, 1, undefined, now));
    // ── precipitation ──
    this.bed('rain', 0.6, 0.8, (b, now) => {
      const p = b.loop('patter', 0.6, 1, ['highpass', 500, 0.7], now);
      const body = b.loop('pink', 0.3, 1, ['lowpass', 2600, 0.6], now);
      const roar = b.loop('brown', 0.0, 1, ['lowpass', 420, 0.7], now);
      if (!p || !body || !roar) return false;
      b.knobs.patter = new Knob(p.g.gain); b.knobs.body = new Knob(body.g.gain); b.knobs.roar = new Knob(roar.g.gain);
      return true;
    }, (b, level, now) => {
      b.knobs.patter?.set(0.65 * Math.pow(level, 0.7), now, 0.3);
      b.knobs.body?.set(0.35 * Math.pow(level, 1.2), now, 0.3);
      b.knobs.roar?.set(0.5 * Math.pow(level, 2.2), now, 0.3);
    });
    this.bed('hail', 0.55, 0.6, (b, now) => !!b.loop('hail', 0.9, 1, undefined, now) && !!b.loop('brown', 0.25, 1, ['lowpass', 300], now));
    this.bed('snow', 0.16, 2, (b, now) => !!b.loop('pink', 0.8, 0.8, ['lowpass', 1300, 0.6], now));
    this.bed('sand', 0.4, 1, (b, now) => {
      const g = b.loop('white', 0.6, 1, ['bandpass', 2800, 0.8], now);
      if (!g) return false;
      b.lfo(g.g.gain, 0.4, 0.3, now);
      return !!b.loop('brown', 0.4, 1, ['lowpass', 250], now);
    });
    this.bed('ash', 0.25, 1.5, (b, now) => !!b.loop('pink', 0.6, 0.85, ['lowpass', 1500], now) && !!b.loop('patter', 0.2, 0.5, ['lowpass', 1800], now));
    this.bed('acid', 0.3, 1, (b, now) => !!b.loop('white', 0.35, 1, ['highpass', 5200], now) && !!b.loop('crackle', 0.25, 1.4, ['highpass', 3500], now));
    this.bed('blood', 0.4, 1.5, (b, now) => !!b.loop('brown', 0.7, 0.8, ['lowpass', 130], now) && !!b.loop('patter', 0.4, 0.75, ['lowpass', 2400], now));
    // ── distant thunder (only while no real strike is being heard) ──
    this.bed('thunder', 1, 1, () => true, (_b, level, now, dt) => {
      if (level <= 0 || this.thunderQuiet < 8) return;
      if (host.rand() > (level / 60) * dt) return;
      this.call('thunder', 0.35 + 0.35 * host.rand(), now, 1, this.input, 0.4, 1200);
    });
    // ── fire, lava, crowds, streams ──
    this.bed('fire', 0.55, 0.8, (b, now) => !!b.loop('crackle', 0.7, 1, undefined, now) && !!b.loop('brown', 0.5, 1, ['lowpass', 380, 0.8], now));
    this.bed('lava', 0.55, 1.2, (b, now) => {
      const g = b.loop('brown', 0.7, 0.9, ['lowpass', 90, 0.9], now);
      if (!g || !b.loop('lava', 0.8, 1, undefined, now)) return false;
      b.lfo(g.g.gain, 0.17, 0.25, now);
      return true;
    });
    this.bed('crowd', 0.35, 1.5, (b, now) => !!b.loop('murmur', 0.8, 1, ['lowpass', 3200, 0.6], now));
    this.bed('stream', 0.4, 1.5, (b, now) => !!b.loop('babble', 0.9, 1, undefined, now));
    this.bed('underwater', 0.45, 0.4, (b, now) => !!b.loop('brown', 0.8, 0.8, ['lowpass', 320, 0.8], now) && !!b.loop('babble', 0.35, 0.45, ['lowpass', 900], now));
    this.bed('quake', 0.65, 0.5, (b, now) => {
      const g = b.loop('brown', 0.9, 0.7, ['lowpass', 70, 1], now);
      const r = b.loop('crackle', 0.25, 0.7, ['lowpass', 700], now);
      if (!g || !r) return false;
      b.lfo(g.g.gain, 6.5, 0.45, now);
      b.lfo(r.g.gain, 9, 0.15, now);
      return true;
    });
    // ── space: a deep beating hum, a whisper of solar wind, whistlers when the star is active ──
    this.bed('space', 0.1, 2.5, (b, now) => {
      if (!this.bank.get('brown') || !this.bank.get('pink')) return false;
      // a hum built on 55 Hz with its harmonics (small speakers cannot play a pure 41 Hz; the harmonics carry it),
      // two near-unison partials beating slowly, a little drift
      const lp = bq(ctx, 'lowpass', 520, 0.7);
      lp.connect(b.out);
      b.nodes.push(lp);
      b.tone('sine', 55, 0.3, now, 0, lp);
      b.tone('sine', 55.35, 0.24, now, 0, lp);
      b.tone('sine', 82.4, 0.14, now, 0, lp);
      b.tone('sine', 110.2, 0.1, now, 0, lp);
      const tri = b.tone('triangle', 164.8, 0.05, now, 0, lp);
      b.lfo(tri.detune, 0.03, 12, now);
      const n = b.loop('brown', 0.3, 0.6, ['lowpass', 120, 0.8], now);
      const w = b.loop('pink', 0.06, 1, ['bandpass', 2200, 10], now);
      if (!n || !w || !w.f) return false;
      b.lfo(w.f.frequency, 0.025, 900, now);
      return true;
    }, (_b, level, now, dt) => {
      if (level < 0.05) return;
      const rate = 0.02 + this.starActivity * 0.5;
      if (host.rand() < rate * level * dt) this.call('bed.whistler', 0.5 * level, now, 0.4, this.input);
    });
    // ── an airless world: silence, and the god's own heartbeat ──
    this.bed('heartbeat', 0.26, 1.5, (b, now) => {
      if (!this.bank.get('heartbeat') || !this.bank.get('brown')) return false;
      b.loop('brown', 0.12, 0.4, ['lowpass', 55, 0.8], now);
      b.st.next = now + 0.3;
      return true;
    }, (b, level, now) => {
      if (level < 0.02 || now < b.st.next) return;
      const buf = this.bank.get('heartbeat');
      if (!buf) return;
      const t = now + 0.03;
      const s = bufSrc(ctx, buf, t, t + buf.duration, 1);
      const f = bq(ctx, 'lowpass', 260, 0.7);
      const g = ctx.createGain();
      g.gain.value = 0.9;
      s.connect(f); f.connect(g); g.connect(b.out);
      s.onended = () => { try { g.disconnect(); f.disconnect(); } catch { /* gone */ } };
      // a resting heart, ~58 beats a minute, never quite regular
      b.st.next = t + 60 / (56 + host.rand() * 5);
    });
  }

  /** an ambient call through the voice budget, panned at random (and sometimes far: quieter, darker) */
  private call(cue: string, level: number, now: number, spread: number, dest: AudioNode, pri = 1, lowpass = 0): void {
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = (this.host.rand() * 2 - 1) * spread;
    let head: AudioNode = pan;
    let lp: BiquadFilterNode | null = null;
    const far = this.host.rand() < 0.4;
    if (far || lowpass) {
      lp = bq(this.ctx, 'lowpass', lowpass || 2600 + this.host.rand() * 3000, 0.7);
      lp.connect(pan);
      head = lp;
    }
    pan.connect(dest);
    const end = this.host.play(cue, { t: now + 0.02, dest: head, level: level * (far ? 0.55 : 1), pri });
    const done = Math.max(0.5, (end || now + 3) - now + 0.5);
    setTimeout(() => { try { pan.disconnect(); lp?.disconnect(); } catch { /* gone */ } }, done * 1000 + 300);
  }

  /** apply a probe (null: nothing heard — everything fades) and advance smoothing; call every frame */
  update(scene: AudioScene | null, coastLocal: [number, number, number] | null, starActivity: number, now: number, dt: number): void {
    this.targets = scene?.layers ?? null;
    this.birds = scene?.birds ?? null;
    this.coast = coastLocal;
    this.windN = scene ? Math.min(1, scene.windSpeed / 20) : 0;
    this.dusk = scene?.dusk ?? 0;
    this.night = scene ? 1 - scene.day : 0;
    this.starActivity = starActivity;
    this.thunderQuiet += dt;
    const L = this.targets;
    const z = (k: keyof SceneLayers): number => (L ? L[k] : 0);
    // owls: night over woodland (the palettes of the tree birds), near the ground
    const woods = scene ? Math.min(1, scene.birds.song + scene.birds.taiga + scene.birds.jungle) : 0;
    const owl = scene ? this.night * scene.inAir * woods * (1 - Math.min(1, z('rain') * 1.5)) / (1 + (scene.alt / 160) ** 2) : 0;
    const want: Record<string, number> = {
      wind: z('wind'), surf: z('surf'), sea: z('sea'), birds: z('birds'), owls: owl, insects: z('insects'),
      cicadas: z('cicadas'), frogs: z('frogs'), rain: z('rain'), hail: z('hail'), snow: z('snow'), sand: z('sand'),
      ash: z('ash'), acid: z('acid'), blood: z('blood'), thunder: z('thunderRate'), fire: z('fire'), lava: z('lava'),
      crowd: z('crowd'), stream: z('stream'), underwater: z('underwater'), quake: z('quake'), space: z('space'),
      heartbeat: z('heartbeat'),
    };
    for (const b of this.beds) b.drive(want[b.name] ?? 0, now, dt);
    // the hush: snow and fog soften the world, water closes over it
    const h = L ? L.hush : 0;
    this.kHush.set(600 + 17400 * Math.pow(1 - Math.min(1, h), 2.2), now, 0.3);
  }

  /** where point sources (emitters) join the ambience: before the hush, so water and snow close over them too */
  get inputNode(): AudioNode { return this.input; }

  /** a real strike was just heard */
  heardThunder(): void { this.thunderQuiet = 0; }

  levels(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of this.beds) out[b.name] = Math.round(b.level * 1000) / 1000;
    return out;
  }

  activeBeds(): number {
    let n = 0;
    for (const b of this.beds) if (b.built) n++;
    return n;
  }

  stop(): void {
    const now = this.ctx.currentTime;
    for (const b of this.beds) if (b.built) b.teardown(now);
  }
}
