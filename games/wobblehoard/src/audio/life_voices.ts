// SQUISH KEEPER (wobblehoard) PLAYGROUND voices, the lazy part (PG_AUDIO; PLAYGROUND_BUILD.md 10 and 14.3). The engine imports this
// module dynamically at the first unlock (or at the first PLAYGROUND call), so the first load carries only the buses, musicClock and
// thin stubs (14.3's overflow rule: a lane over its first-load cap moves code into its own lazy module). Everything here runs only
// once LIFE runs (the life chunk loads after the first frame of play), so nothing a player hears at boot waits for it.
//   creature()   the phrase LIFE planned (creature.ts), the ChatterLimiter backstop, the echo, the headroom plan, the touch duck
//   musicBox()   the Music Box tune and the kettle's whistle (props.ts), TuneGate's spacing rules, the bed's melody resting meanwhile
//   prop()       the ball (a bump; its held roll); the place thing voices join with the away chunk (S1)
//   autoThud()   the budgeted soft variant of a body's own landing or bump
// Every draw comes from the engine's PLAYGROUND stream (CHATTER_SALT), never engRng.
import { clamp } from '../core/rng.ts';
import { c01, dbToGain, fin, makeRng, type Rng, type VoiceGroup } from './dsp.ts';
import type { MasterChain } from './chain.ts';
import { BAR_S, SLOT_S } from './music.ts';
import { land } from './voices.ts';
import { bump } from './interact.ts';
import { ChatterLimiter, ECHO_DB, ECHO_S, GROUP_DB, PIECE_DB, WHOLE_PEAK, chatterBus, creaturePhrase, phraseLen, sylStarts, type ChatterBus } from './creature.ts';
import { PROP, TUNE, TUNE_BARS, TuneGate, TuneVoice, ballBump, ballRoll, type HeldProp } from './props.ts';

/** What the engine lends this module (engine.ts makes it once). */
export interface LifeVoiceHost {
  ctx(): AudioContext | null;
  chain(): MasterChain | null;
  ready(): boolean;
  muted(): boolean;
  /** The Voices slider is above 0. */
  voicesOn(): boolean;
  rng: Rng;
  /** engine.ts acceptPg: bookkeeping, mute, polyphony, the music's clearing delay for `clearKind`; never an engRng draw. */
  accept(kind: string, clearKind: string): { c: AudioContext; t0: number } | null;
  register(g: VoiceGroup): void;
  registerFx(g: VoiceGroup, kind: string, t0: number): void;
  sweepSteal(): void;
  fieldAt(t: number): number;
  barAt(t: number): { barT: number; field: number } | null;
  quietMelody(from: number, until: number): void;
  pumpLater(v: { advance(until: number): boolean; readonly alive: boolean }): void;
  /** The end of the latest ceremony (context time): chatter waits until 1 s after it (AU-09). */
  ceremonyUntil(): number;
  drop(): void;
  throttle(kind: string, n: number): void;
  started(kind: string): void;
  /** The away chunk's thing voices, once a place's ambience has loaded (null before). */
  away(): { creak: typeof import('./ambience.ts').creak; puff(t: number): void; strike: typeof import('./ambience.ts').STRIKE; held: typeof import('./ambience.ts').heldNoise } | null;
}

type CreatureP = { phrase: Float32Array; n: number; flavour: number; register: number; pitch: number; pan: number; level: number; group?: number; echo?: boolean; at?: number; sing?: boolean; echoes?: number };
type PropP = { kind: number; intensity: number; note?: number; pan?: number; auto: boolean; key?: number; held?: number; size?: number };

export interface LifeVoices {
  creature(p: CreatureP): boolean;
  setTouching(on: boolean): void;
  musicBox(p: { on: boolean; tune?: number }): void;
  prop(p: PropP): void;
  autoThud(p: { kind: number; intensity: number; pitch?: number; pan?: number }): void;
}

const LOOKAHEAD = 0.004;
/** The touch duck: -6 dB, held until 0.6 s after the release (LIFE 8.4). */
const DUCK = dbToGain(-6), DUCK_AFTER_S = 0.6;

/** A gain planned as straight segments [t, v, t, v, ...]. Linear ramps are evaluated by time; measured in Chromium, a setTargetAtTime on
 *  a node with no sound flowing through it starts its approach only when the node is next processed (the touch duck's return waited for
 *  the next phrase), so the chatter bus never uses it. */
class Line {
  private p: number[] = [0, 1];
  at(t: number): number {
    const p = this.p;
    if (t <= p[0]) return p[1];
    for (let i = 2; i < p.length; i += 2) if (t <= p[i]) return p[i - 1] + ((p[i + 1] - p[i - 1]) * (t - p[i - 2])) / Math.max(1e-9, p[i] - p[i - 2]);
    return p[p.length - 1];
  }
  /** From `now` (holding the planned value there) through the points `pts` (times after now, in order). */
  set(pm: AudioParam, now: number, pts: number[]): void {
    const v = this.at(now);
    pm.cancelScheduledValues(now);
    pm.setValueAtTime(v, now);
    this.p = [now, v];
    for (let i = 0; i < pts.length; i += 2) {
      const t = Math.max(pts[i], this.p[this.p.length - 2] + 1e-4);
      pm.linearRampToValueAtTime(pts[i + 1], t);
      this.p.push(t, pts[i + 1]);
    }
  }
}

export function createLifeVoices(h: LifeVoiceHost): LifeVoices {
  const chatLimiter = new ChatterLimiter();
  /** Autonomous lands, bumps and thing sounds: at most 3 a second (LIFE 10.1, desktop). */
  const autoLimiter = new ChatterLimiter({ voices: 3, refill: 3, burst: 3 });
  let cbus: ChatterBus | null = null;
  const spans: { t0: number; end: number; w: number }[] = [];
  let touching = false, touchOffT = -1e9;
  const syl = new Float32Array(16);
  const gate = new TuneGate();
  const tunes: (TuneVoice | null)[] = [null, null];
  const held = new Map<number, HeldProp>();
  const now = (): number => h.ctx()?.currentTime ?? 0;
  const touchingAt = (t: number): boolean => touching || t < touchOffT + DUCK_AFTER_S;
  const duck = new Line(), norm = new Line();

  function bus(): ChatterBus | null {
    const c = h.ctx(), ch = h.chain();
    if (!cbus && c && ch) { cbus = chatterBus(c, ch.chatter); if (touchingAt(c.currentTime)) duck.set(cbus.duck.gain, c.currentTime, [c.currentTime + 0.01, DUCK]); }
    return cbus;
  }

  /** Re-plan the headroom gain from now: wherever the voices sounding together add up past 1.41 (+3 dB) of one whole voice at full
   *  level, the bus comes down by just that much (12 ms before the new voice starts) and back up when they end (AU-05). */
  function planNorm(t: number): void {
    if (!cbus) return;
    for (let i = spans.length - 1; i >= 0; i--) if (spans[i].end < t - 0.1) spans.splice(i, 1);
    const pts = [t];
    for (const q of spans) { if (q.t0 > t) pts.push(q.t0); if (q.end > t) pts.push(q.end); }
    pts.sort((a, b) => a - b);
    const plan: number[] = [];
    let last = norm.at(t);
    for (const p of pts) {
      let w = 0;
      for (const q of spans) if (q.t0 <= p + 1e-6 && q.end > p + 1e-6) w += q.w;
      const tg = w > 1.41 ? 1.41 / w : 1;
      if (tg < last - 1e-4) plan.push(p - 0.014, last, p - 0.002, tg);           // down just before the new voice
      else if (tg > last + 1e-4) plan.push(p + 0.02, last, p + 0.1, tg);         // back up after one ends
      last = tg;
    }
    norm.set(cbus.norm.gain, t, plan);
  }

  function startTune(tune: number): void {
    const c = h.ctx(), ch = h.chain();
    if (!c || !ch) return;
    const t = c.currentTime;
    let t0 = t + 0.06;
    const b = h.barAt(t0);
    if (b) t0 = b.barT + Math.ceil((t0 - b.barT) / SLOT_S - 1e-9) * SLOT_S;   // the next eighth of the music's own grid
    const dur = TUNE_BARS[tune] * BAR_S;
    if (!gate.admit(tune, t0, dur)) { h.throttle('tune', 1); return; }
    if (tune === TUNE.box) stopTune(TUNE.kettle, t0);
    const v = new TuneVoice(c, ch.plain, tune, t0, h.fieldAt, h.register);
    tunes[tune] = v;
    h.quietMelody(t0, t0 + dur + 0.3);
    v.advance(t + 0.5);
    h.pumpLater(v);
  }

  function stopTune(tune: number, at?: number): void {
    const v = tunes[tune];
    if (!v) return;
    const t = Math.max(now(), fin(at, now()));
    tunes[tune] = null;
    if (t >= v.end) return;                           // it had already finished: nothing to stop, and the bed's melody is back
    v.stop(t);
    gate.stop(tune, t);
    h.quietMelody(v.t0, Math.max(t, v.t0) + 0.3);
  }

  return {
    creature(p) {
      const c = h.ctx();
      if (!c) { h.drop(); return false; }
      h.started('creature');
      if (h.muted() || !h.voicesOn()) return false;
      // copy what we need NOW: the caller reuses p and its phrase array (AU-11)
      const n = clamp(Math.floor(fin(p.n, 0)), 0, 4);
      if (!n) return false;
      for (let i = 0; i < n * 4; i++) syl[i] = fin(p.phrase[i], 0);
      const reg = p.register === 1 ? 1 : 0, group = clamp(Math.floor(fin(p.group, 1)), 1, 3), echo = p.echo === true;
      // the Echo Stone (PLACES 4.9): a second repeat at twice the delay, 12 dB under the first
      const echo2 = echo && Math.floor(fin(p.echoes, 1)) >= 2;
      const t = c.currentTime, t0 = clamp(fin(p.at, 0), t + LOOKAHEAD, t + 4);
      if (t0 < h.ceremonyUntil() + 1) { h.throttle('chatter', 1); return false; }                       // ceremonies + 1 s (AU-09)
      const len = phraseLen(syl, n);
      if (!chatLimiter.admit(t0, sylStarts(syl, n), len + (echo ? (echo2 ? 2 : 1) * ECHO_S : 0), echo ? (echo2 ? 2 : 1.5) : 1, touchingAt(t))) { h.throttle('chatter', 1); return false; }
      const out = bus();
      if (!out) return false;
      h.sweepSteal();
      const amp = WHOLE_PEAK * c01(p.level, 1) * (reg ? dbToGain(PIECE_DB + (group >= 2 ? GROUP_DB : 0)) : 1);
      const base = { syl, n, flavour: clamp(Math.floor(fin(p.flavour, 0)), 0, 5), register: reg, pitch: fin(p.pitch, 1), pan: clamp(fin(p.pan, 0), -1, 1), group, sing: p.sing === true, fieldAt: h.fieldAt, rng: h.rng };
      h.register(creaturePhrase(c, out.norm, t0, { ...base, amp }));
      spans.push({ t0, end: t0 + len, w: amp / WHOLE_PEAK });
      if (echo) {
        const ea = amp * dbToGain(ECHO_DB);
        h.register(creaturePhrase(c, out.norm, t0 + ECHO_S, { ...base, amp: ea, echo: true }));
        spans.push({ t0: t0 + ECHO_S, end: t0 + ECHO_S + len, w: ea / WHOLE_PEAK });
        if (echo2) {
          const eb = ea * dbToGain(ECHO_DB);
          h.register(creaturePhrase(c, out.norm, t0 + 2 * ECHO_S, { ...base, amp: eb, echo: true }));
          spans.push({ t0: t0 + 2 * ECHO_S, end: t0 + 2 * ECHO_S + len, w: eb / WHOLE_PEAK });
        }
      }
      planNorm(t);
      return true;
    },

    setTouching(on) {
      const was = touching, t = now();
      touching = on === true;
      if (was && !touching) touchOffT = t;
      if (!cbus) return;
      const off = Math.max(t, touchOffT + DUCK_AFTER_S);
      duck.set(cbus.duck.gain, t, touching ? [t + 0.05, DUCK] : [off, DUCK, off + 0.3, 1]);
    },

    musicBox(p) {
      const tune = p.tune === TUNE.kettle ? TUNE.kettle : TUNE.box;
      if (p.on !== true) { stopTune(tune); return; }
      if (!h.ready()) { h.drop(); return; }
      h.started(tune === TUNE.box ? 'musicBox' : 'kettle');
      if (h.muted()) return;
      startTune(tune);
    },

    prop(p) {
      const kind = Math.floor(fin(p.kind, 0)), auto = p.auto === true, pan = clamp(fin(p.pan, 0), -1, 1);
      const c = h.ctx(), ch = h.chain();
      if (!c || !ch) { h.drop(); return; }
      if (kind === PROP.ball && p.key !== undefined && p.held !== undefined) {
        // the ball's held roll, keyed by prop: quiet and continuous, it never makes room
        if (h.muted()) return;
        const key = Math.floor(fin(p.key, 0)), lv = c01(p.held, 0);
        let v = held.get(key);
        if (!v || !v.alive || v.dying) {
          held.delete(key);
          if (lv < 0.02) return;
          const a = h.accept('roll', '');
          if (!a) return;
          v = ballRoll(a.c, ch.plain, a.t0, h.rng, pan);
          h.register(v);
          held.set(key, v);
        }
        v.update(lv, c.currentTime, pan);
        return;
      }
      const aw = h.away();
      if (kind === PROP.creak && aw && p.key !== undefined) {
        // a hinged thing's held creak (the rocker, the swing), keyed by prop, with its own dead-man switch
        if (h.muted()) return;
        const key = 1000 + Math.floor(fin(p.key, 0)), lv = c01(p.held ?? p.intensity, 0);
        let v = held.get(key);
        if (!v || !v.alive || v.dying) {
          held.delete(key);
          if (lv < 0.05) return;
          const a = h.accept('creak', '');
          if (!a) return;
          v = aw.creak(a.c, ch.plain, a.t0, h.rng, pan, key);
          h.register(v);
          held.set(key, v);
        }
        v.update(lv, c.currentTime, pan);
        return;
      }
      if (kind === PROP.crackle && aw) { h.started('puff'); aw.puff(c.currentTime); return; }   // the fire puffs up: a swell of the bed
      if ((kind === PROP.rustle || kind === PROP.whoosh) && aw && p.key !== undefined && p.held !== undefined) {
        // a shaking branch or a ride, held while it moves (round 2), with the same dead-man switch
        if (h.muted()) return;
        const key = (kind === PROP.rustle ? 2000 : 3000) + Math.floor(fin(p.key, 0)), lv = c01(p.held, 0);
        let v = held.get(key);
        if (!v || !v.alive || v.dying) {
          held.delete(key);
          if (lv < 0.05) return;
          const a = h.accept(kind === PROP.rustle ? 'rustle' : 'whoosh', '');
          if (!a) return;
          v = aw.held(a.c, ch.plain, a.t0, h.rng, pan, kind === PROP.rustle ? 'rustle' : 'whoosh') as unknown as HeldProp;
          h.register(v);
          held.set(key, v);
        }
        v.update(lv, c.currentTime, pan);
        return;
      }
      const sv = kind === PROP.ball ? null : aw ? aw.strike[kind] : undefined;
      if (sv === undefined) { h.drop(); return; }      // a place thing before the away chunk is here, or an unknown kind
      if (auto && !autoLimiter.admit(c.currentTime, 1, 0.25)) { h.throttle('auto', 1); return; }
      const a = h.accept(auto ? 'propAuto' : sv ? 'thing' : 'ball', auto ? '' : 'pop');
      if (!a) return;
      const I = c01(p.intensity, 0.5), soft = auto ? 0.6 : 1;
      let t0 = a.t0;
      if (kind === PROP.tick) { const b = h.barAt(t0); if (b) t0 = b.barT + Math.ceil((t0 - b.barT) / SLOT_S - 1e-9) * SLOT_S; }   // on the music's eighth grid
      const g = sv ? sv(a.c, ch.plain, t0, { rng: h.rng, intensity: I, note: p.note, pan, soft, size: p.size })
        : ballBump(a.c, ch.plain, t0, { rng: h.rng, intensity: I, pan, soft, size: p.size });
      if (auto) h.register(g); else h.registerFx(g, sv ? 'thing' : 'ball', t0);   // a sound that moved by itself never asks the music for room
    },

    autoThud(p) {
      const c = h.ctx(), ch = h.chain();
      if (!c || !ch) { h.drop(); return; }
      const I = c01(p.intensity, 0);
      if (I < 0.04) return;
      if (!autoLimiter.admit(c.currentTime, 1, 0.2)) { h.throttle('auto', 1); return; }
      const a = h.accept(p.kind === 1 ? 'autoBump' : 'autoLand', '');
      if (!a) return;
      const q = { rng: makeRng((h.rng() * 4294967296) >>> 0), jitter: 1, intensity: I * 0.5, pitch: clamp(fin(p.pitch, 1), 0.5, 2), pan: clamp(fin(p.pan, 0), -1, 1) };
      h.register(p.kind === 1 ? bump(a.c, ch.plain, a.t0, q) : land(a.c, ch.plain, a.t0, q));
    },
  };
}
