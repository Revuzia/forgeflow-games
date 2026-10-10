// GENESIS — the music director (CONTRACT §17): each culture's music plays near its settlements and crossfades as the
// camera moves between them; in orbit (and softly over a world nobody lives on yet) the orbital score plays instead.
//
// A player per audible culture realises its endless piece bar by bar (music.ts composeBar) on the instruments
// (instruments.ts) with a lookahead scheduler driven by the frame loop: bars are scheduled ~0.6 s ahead on the audio
// clock, so a slow frame never makes the music stumble, and a hidden tab that stops the loop simply skips ahead.
// A player's fader follows its proximity weight (a ~4 s crossfade), its stereo position follows the town's bearing,
// and a far town is heard through a lowpass, as if across fields. A culture whose era, mood or war changes switches to
// its new style at the next bar line, without a seam.

import type { AudioScene, MusicCandidate } from './scene.ts';
import { smoothstep } from './scene.ts';
import { barSeconds, composeBar, describeStyle, orbitalStyle, styleFor, type MusicStyle } from './music.ts';
import { buffersFor, playNote, type NoteCtx } from './instruments.ts';
import type { BufferBank } from './bank.ts';
import { Knob } from './synth.ts';

const LOOKAHEAD = 0.6;
const MAX_POLY = 32;

/** reverb send by instrument set: outdoors for the first peoples, halls for organs, a cathedral of space in orbit */
const WET = [0.22, 0.3, 0.42, 0.3, 0.7];

export class MusicPlayer {
  readonly key: string;
  style: MusicStyle;
  private pending: MusicStyle | null = null;
  private readonly ctx: BaseAudioContext;
  private readonly bank: BufferBank;
  private readonly fader: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly pan: StereoPannerNode;
  private readonly send: GainNode;
  private readonly kFader: Knob;
  private readonly kTone: Knob;
  private readonly kPan: Knob;
  private readonly note: NoteCtx;
  private bar = 0;
  private nextBar = -1;
  get barIndex(): number { return this.bar; }
  private live: number[] = [];
  /** current fader target and when it last was non-zero */
  target = 0;
  lastHeard = 0;
  disposed = false;

  constructor(ctx: BaseAudioContext, bank: BufferBank, dest: AudioNode, wet: AudioNode | null, key: string, style: MusicStyle, r: () => number) {
    this.ctx = ctx; this.bank = bank; this.key = key; this.style = style;
    const sum = ctx.createGain();
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 18000;
    this.fader = ctx.createGain();
    this.fader.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.send = ctx.createGain();
    this.send.gain.value = WET[style.set] ?? 0.3;
    sum.connect(this.tone);
    this.tone.connect(this.fader);
    this.fader.connect(this.pan);
    this.pan.connect(dest);
    if (wet) { this.fader.connect(this.send); this.send.connect(wet); }
    this.kFader = new Knob(this.fader.gain);
    this.kTone = new Knob(this.tone.frequency);
    this.kPan = new Knob(this.pan.pan);
    this.note = { ctx, bank, out: sum, bright: style.brightness, r };
    bank.preload(buffersFor([style.ensemble.melody, style.ensemble.counter, style.ensemble.pad, style.ensemble.bass ?? '', ...style.ensemble.perc], style.tonic));
  }

  /** a new style for the same culture (applied at the next bar line) */
  restyle(s: MusicStyle): void {
    if (s.key !== this.style.key && s.key !== this.pending?.key) {
      this.pending = s;
      this.bank.preload(buffersFor([s.ensemble.melody, s.ensemble.counter, s.ensemble.pad, s.ensemble.bass ?? '', ...s.ensemble.perc], s.tonic));
    }
  }

  /** fade / tone / pan toward the targets, schedule the bars that fall in the lookahead window */
  update(now: number, gain: number, pan: number, far: number): void {
    if (this.disposed) return;
    this.target = gain;
    if (gain > 0.001) this.lastHeard = now;
    this.kFader.set(gain, now, 1.3);
    this.kPan.set(Math.max(-0.6, Math.min(0.6, pan * 0.6)), now, 0.5);
    this.kTone.set(1400 + 17000 * Math.pow(1 - far, 2), now, 0.8);
    if (gain <= 0.0005 && this.fader.gain.value < 0.002) { this.nextBar = -1; return; }
    if (this.nextBar < 0 || this.nextBar < now - 0.25) this.nextBar = now + 0.08;
    while (this.nextBar < now + LOOKAHEAD) {
      if (this.pending) {
        this.style = this.pending;
        this.pending = null;
        this.note.bright = this.style.brightness;
        this.send.gain.setTargetAtTime(WET[this.style.set] ?? 0.3, now, 1);
      }
      this.scheduleBar(this.bar, this.nextBar);
      this.nextBar += barSeconds(this.style);
      this.bar++;
    }
  }

  private scheduleBar(bar: number, t0: number): void {
    const s = this.style;
    const spb = 60 / s.tempo;
    const now = this.ctx.currentTime;
    this.live = this.live.filter((e) => e > now);
    for (const ev of composeBar(s, bar)) {
      const t = t0 + ev.t * spb;
      if (t < now) continue;
      // a crowded moment drops its quietest additions, never the pulse or the tune
      if (this.live.length >= MAX_POLY && ev.part !== 'melody' && ev.part !== 'bass') continue;
      // humanise: a few milliseconds of timing and a little velocity
      const jitter = ev.part === 'perc' ? (this.note.r() - 0.5) * 0.008 : (this.note.r() - 0.5) * 0.012;
      const end = playNote(this.note, ev.inst, Math.max(now, t + jitter), ev.d * spb, ev.midi, ev.v * (0.93 + 0.14 * this.note.r()));
      if (end > t) this.live.push(end);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = this.ctx.currentTime;
    this.fader.gain.cancelScheduledValues(now);
    this.fader.gain.setTargetAtTime(0, now, 0.2);
    const f = this.fader, p = this.pan, snd = this.send;
    setTimeout(() => { try { f.disconnect(); p.disconnect(); snd.disconnect(); } catch { /* gone */ } }, 1500);
  }

  describe(): string { return describeStyle(this.style); }
}

export interface MusicState {
  culture: string;
  players: { key: string; gain: number; style: string; bar: number }[];
}

export class MusicDirector {
  private readonly ctx: BaseAudioContext;
  private readonly bank: BufferBank;
  private readonly dest: AudioNode;
  private readonly wet: AudioNode | null;
  private readonly r: () => number;
  private players = new Map<string, MusicPlayer>();
  private orbitSeed = 1;
  /** 0..1 extra fade applied to everything (the opening's ignition, a duck) */
  private master = 1;
  private styles = new Map<string, MusicStyle>();

  /** styles are pure functions of the culture: cache them by everything styleFor reads */
  private styleOf(c: MusicCandidate['culture']): MusicStyle {
    const k = `${c.id}|${c.language}|${c.species}|${c.mode}|${c.tempo}|${c.instruments}|${(c.alignment ?? 0).toFixed(2)}|${c.era}|${c.war ? 1 : 0}|${c.age}|${(c.population ?? 0) < 12 ? 0 : (c.population ?? 0) < 60 ? 1 : (c.population ?? 0) < 250 ? 2 : 3}`;
    let s = this.styles.get(k);
    if (!s) {
      s = styleFor(c);
      if (this.styles.size > 256) this.styles.clear();
      this.styles.set(k, s);
    }
    return s;
  }

  constructor(ctx: BaseAudioContext, bank: BufferBank, dest: AudioNode, wet: AudioNode | null, r: () => number) {
    this.ctx = ctx; this.bank = bank; this.dest = dest; this.wet = wet; this.r = r;
  }

  /** the star's identity seeds the orbital score */
  setStar(name: string): void {
    let h = 7;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
    this.orbitSeed = h;
  }

  setMaster(x: number): void { this.master = Math.max(0, Math.min(1, x)); }

  private orbitalCache: MusicStyle | null = null;
  private orbital(): MusicStyle {
    if (!this.orbitalCache || this.orbitalCache.key !== `orbit:${this.orbitSeed}`) {
      const s = orbitalStyle(this.orbitSeed);
      this.orbitalCache = { ...s, key: `orbit:${this.orbitSeed}` };
    }
    return this.orbitalCache;
  }

  update(scene: AudioScene | null, now: number): void {
    const wanted = new Map<string, { gain: number; pan: number; far: number; style: () => MusicStyle }>();
    let loudest = 0;
    if (scene) {
      const c = scene.music;
      const lv = (m: MusicCandidate): number => smoothstep(0.02, 0.32, m.weight);
      if (c[0]) {
        const g1 = lv(c[0]);
        loudest = g1;
        wanted.set(c[0].key, { gain: g1, pan: c[0].pan, far: 1 - Math.min(1, c[0].weight * 2.2), style: () => this.styleOf(c[0].culture) });
        if (c[1]) {
          // a second town only sounds through where it is nearly as close as the first (no cacophony)
          const g2 = lv(c[1]) * (1 - 0.75 * g1) * (c[1].weight > c[0].weight * 0.6 ? 1 : 0.3);
          if (g2 > 0.02) wanted.set(c[1].key, { gain: g2, pan: c[1].pan, far: 1 - Math.min(1, c[1].weight * 2.2), style: () => this.styleOf(c[1].culture) });
        }
      }
      const og = Math.min(1, scene.orbital) * (1 - loudest);
      if (og > 0.01) wanted.set('orbital', { gain: og, pan: 0, far: 0, style: () => this.orbital() });
    }
    for (const [key, w] of wanted) {
      let p = this.players.get(key);
      const style = w.style();
      if (!p) {
        p = new MusicPlayer(this.ctx, this.bank, this.dest, this.wet, key, style, this.r);
        this.players.set(key, p);
      } else p.restyle(style);
      // the orbital score is a bed under the hum of space, not a town's band: it plays softer
      p.update(now, w.gain * (key === 'orbital' ? 0.5 : 0.85) * this.master, w.pan, w.far);
    }
    for (const [key, p] of this.players) {
      if (wanted.has(key)) continue;
      p.update(now, 0, 0, 1);
      if (now - p.lastHeard > 6) { p.dispose(); this.players.delete(key); }
    }
  }

  stop(): void {
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
  }

  state(): MusicState {
    let best = '', bg = 0;
    const players: MusicState['players'] = [];
    for (const p of this.players.values()) {
      players.push({ key: p.key, gain: Math.round(p.target * 1000) / 1000, style: p.describe(), bar: p.barIndex });
      if (p.target > bg) { bg = p.target; best = `${p.key} · ${p.describe()}`; }
    }
    return { culture: best, players };
  }
}
