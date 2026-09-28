// DYEFIELD — the WebAudio backend (CONTRACT_P6_11 §21). Executes the router's commands; owns no game logic.
//
//   one-shot ─ gain ─ [PannerNode, equalpower, inverse distModel(cat)] ─┐
//                                                                      ├─ sfxIn ─ sfxDuck ─ pause ─ sfxBus ─┐
//   loops (sprite buffers / the procedural charge whine) ─────────────┘                                    │
//   UI + horns + countdown ─────────────────────────────────────────────────────────── uiBus ──────────────┤
//   music cue gain ─ musicDuck ─ musicPause ─ musicBus ─────────────────────────────────────────────────────┤
//                                                                                  master ─ limiter ─ out ─┘
//
// * The sprite (one Ogg) is decoded once and sliced into one AudioBuffer per variant (loops loop the whole slice).
// * Music: looping cues are re-sequenced section by section on the AudioContext clock (1.2 s look-ahead,
//   sample-accurate start(when, offset, duration)); a cue switch 'at bar' lands on the current section's next
//   bar line with a 60 ms crossfade. Decoded music is kept per set: {lobby} or {match, final, victory, defeat}.
// * The voice pool (voices.ts) caps one-shots; loops have their own cap.

import { MUSIC, SFX, SFX_SPRITE, SPRITE_GUARD_S, type MusicCueId, type MusicEntry, type SfxId } from './manifest.ts';
import { loopSlice } from './seam.ts';
import { categoryOf, distModel, MAX_DISTANCE, type AudioSink, type LoopCmd, type MusicCmd, type PlayCmd, type SoundId, type Vec3T } from './router.ts';
import { VoicePool } from './voices.ts';
import type { AudioVolumes, ListenerPose, MusicCue } from './types.ts';

const LOOP_CAP = 12;
const LOOKAHEAD = 1.2;
const MATCH_SET: readonly MusicCueId[] = ['match', 'final', 'victory', 'defeat'];
const LOBBY_SET: readonly MusicCueId[] = ['lobby'];

interface CueVoice {
  cue: MusicCueId;
  entry: MusicEntry;
  buf: AudioBuffer;
  gain: GainNode;
  pos: number;
  nextT: number;
  scheduled: Array<{ src: AudioBufferSourceNode; t0: number; t1: number }>;
}

interface LoopVoice {
  id: SoundId;
  g: GainNode;
  p: PannerNode | null;
  srcs: AudioScheduledSourceNode[];
  buf: AudioBufferSourceNode | null;
  oscs: OscillatorNode[];
  lfo: OscillatorNode | null;
}

interface Duck { level: number; until: number }

function setParam(p: AudioParam, v: number, t: number, tau: number): void {
  if (!Number.isFinite(v)) return;
  p.cancelScheduledValues(t);
  p.setTargetAtTime(v, t, tau);
}

function setPos(p: PannerNode, v: Vec3T): void {
  if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
  else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(v.x, v.y, v.z);
}

export class AudioEngine implements AudioSink {
  ctx: AudioContext | null = null;
  readonly errors: string[] = [];
  played = 0;
  /** one-shots started per bus (world sfx vs UI / flow: horns, beeps, menu sounds) */
  readonly playedBus = { sfx: 0, ui: 0 };
  /** the output meter (after the limiter), sampled every 3rd tick: max-hold peak + short-term RMS, dBFS */
  private meter: AnalyserNode | null = null;
  private meterBuf: Float32Array | null = null;
  private meterN = 0;
  private readonly meterHold = { peak: 0, rms: 0, rmsMax: 0, limiter: 0, peakAll: 0 };
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private sfxIn!: GainNode;
  private sfxDuck!: GainNode;
  private pauseGain!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private musicDuck!: GainNode;
  private musicPause!: GainNode;
  private musicBus!: GainNode;
  private readonly pool: VoicePool;
  private readonly sfx = new Map<SfxId, AudioBuffer[]>();
  private spriteBytes: Promise<ArrayBuffer | null> | null = null;
  private spriteReady: Promise<void> | null = null;
  private readonly musicBytes = new Map<MusicCueId, Promise<ArrayBuffer | null>>();
  private readonly musicBufs = new Map<MusicCueId, AudioBuffer>();
  private readonly musicDecoding = new Map<MusicCueId, Promise<AudioBuffer | null>>();
  private readonly loops = new Map<string, LoopVoice>();
  private cur: CueVoice | null = null;
  private wantCue: MusicCueId | null = null;
  private wantAt: 'now' | 'bar' = 'now';
  private noise: AudioBuffer | null = null;
  private vol: AudioVolumes = { master: 0.8, music: 0.45, sfx: 0.9 };
  private paused = false;
  private duckM: Duck = { level: 1, until: 0 };
  private duckS: Duck = { level: 1, until: 0 };
  private warned = false;

  constructor(voiceLimit: number) {
    this.pool = new VoicePool(voiceLimit);
    this.spriteBytes = this.fetchBytes(SFX_SPRITE.url, 'sfx sprite');
    this.musicBytes.set('lobby', this.fetchBytes(MUSIC.lobby.url, 'music lobby'));
  }

  get voices(): number { return this.pool.count; }
  get poolStats(): { peak: number; stolen: number; rejected: number } { return { peak: this.pool.peak, stolen: this.pool.stolen, rejected: this.pool.rejected }; }
  get cue(): MusicCueId | null { return this.cur ? this.cur.cue : null; }
  get loopKeys(): string[] { return [...this.loops.keys()]; }
  get decoded(): string[] { return [...(this.sfx.size ? ['sfx'] : []), ...this.musicBufs.keys()]; }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────
  /** create (first call) and resume the context; resolves when running or after 1.5 s (never rejects) */
  async unlock(): Promise<void> {
    try {
      // before any user activation a new AudioContext starts suspended and Chrome logs a warning: wait for a gesture
      const ua = (globalThis as { navigator?: { userActivation?: { hasBeenActive: boolean } } }).navigator?.userActivation;
      if (!this.ctx && ua && !ua.hasBeenActive) return;
      if (!this.ctx) this.build();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state !== 'running') {
        await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
      }
      if (!this.spriteReady) this.spriteReady = this.decodeSprite();
      for (const cue of Object.keys(MUSIC) as MusicCueId[]) if (!this.musicBytes.has(cue)) this.musicBytes.set(cue, this.fetchBytes(MUSIC[cue].url, `music ${cue}`));
      if (this.wantCue && !this.cur) this.musicPlay(this.wantCue, 'now');
    } catch (e) {
      this.fail('unlock', e);
    }
  }

  private build(): void {
    const AC: typeof AudioContext | undefined = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) { this.fail('build', new Error('no WebAudio')); return; }
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const G = (v = 1): GainNode => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9; this.limiter.knee.value = 6; this.limiter.ratio.value = 10;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.18;
    this.master = G(this.vol.master);
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    // a tap for the harness meter (an analyser needs no output connection to be processed)
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    this.meterBuf = new Float32Array(this.meter.fftSize);
    this.limiter.connect(this.meter);
    this.sfxBus = G(this.vol.sfx); this.sfxBus.connect(this.master);
    this.pauseGain = G(this.paused ? 0 : 1); this.pauseGain.connect(this.sfxBus);
    this.sfxDuck = G(1); this.sfxDuck.connect(this.pauseGain);
    this.sfxIn = G(1); this.sfxIn.connect(this.sfxDuck);
    this.uiBus = G(this.vol.sfx); this.uiBus.connect(this.master);
    this.musicBus = G(this.vol.music); this.musicBus.connect(this.master);
    this.musicPause = G(this.paused ? 0.4 : 1); this.musicPause.connect(this.musicBus);
    this.musicDuck = G(1); this.musicDuck.connect(this.musicPause);
    const n = Math.round(ctx.sampleRate * 0.4);
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 0x9e3779b9;
    for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
  }

  dispose(): void {
    this.pool.clear();
    for (const [k, l] of this.loops) this.stopLoop(k, l, 0);
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined); }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined); }

  // ── loading ───────────────────────────────────────────────────────────────────────────────
  private fetchBytes(url: string, what: string): Promise<ArrayBuffer | null> {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.arrayBuffer(); })
      .catch((e: unknown) => { this.fail(`fetch ${what}`, e); return null; });
  }

  private async decodeSprite(): Promise<void> {
    const ctx = this.ctx;
    const bytes = this.spriteBytes ? await this.spriteBytes : null;
    if (!ctx || !bytes) return;
    try {
      const full = await ctx.decodeAudioData(bytes.slice(0));
      const sr = full.sampleRate;
      const data = full.getChannelData(0);
      const guard = Math.round(SPRITE_GUARD_S * sr);
      const k = Math.min(guard, Math.round(0.006 * sr));
      for (const id of Object.keys(SFX) as SfxId[]) {
        const e = SFX[id];
        const out: AudioBuffer[] = [];
        for (let i = 0; i < e.v.length; i++) {
          const a = Math.round(e.v[i][0] * sr);
          const n = Math.max(1, Math.min(data.length - a, Math.round((e.n[i] / 44100) * sr)));
          const b = ctx.createBuffer(1, n, sr);
          b.copyToChannel(e.loop ? loopSlice(data, a, n, guard, k) : data.subarray(a, a + n), 0);
          out.push(b);
        }
        this.sfx.set(id, out);
      }
    } catch (e) {
      this.fail('decode sfx sprite', e);
    }
  }

  private loadMusic(cue: MusicCueId): Promise<AudioBuffer | null> {
    const have = this.musicBufs.get(cue);
    if (have) return Promise.resolve(have);
    const pending = this.musicDecoding.get(cue);
    if (pending) return pending;
    let bytesP = this.musicBytes.get(cue);
    if (!bytesP) { bytesP = this.fetchBytes(MUSIC[cue].url, `music ${cue}`); this.musicBytes.set(cue, bytesP); }
    const p = bytesP.then(async (bytes) => {
      const ctx = this.ctx;
      if (!bytes || !ctx) return null;
      try {
        const buf = await ctx.decodeAudioData(bytes.slice(0));
        this.musicBufs.set(cue, buf);
        return buf;
      } catch (e) {
        this.fail(`decode music ${cue}`, e);
        return null;
      } finally {
        this.musicDecoding.delete(cue);
      }
    });
    this.musicDecoding.set(cue, p);
    return p;
  }

  /** keep the decoded set the current cue belongs to; drop the other set (memory: ~0.4 MB per decoded second) */
  private musicSet(cue: MusicCueId): void {
    const keep = cue === 'lobby' ? LOBBY_SET : MATCH_SET;
    for (const c of keep) if (c !== cue) void this.loadMusic(c);
    for (const c of [...this.musicBufs.keys()]) if (!keep.includes(c) && this.cur?.cue !== c) this.musicBufs.delete(c);
  }

  // ── AudioSink ─────────────────────────────────────────────────────────────────────────────
  play(c: PlayCmd): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || c.id === 'charge') return;
    const bufs = this.sfx.get(c.id);
    if (!bufs) { this.fallback(c); return; }
    const buf = bufs[Math.max(0, Math.min(bufs.length - 1, c.variant))];
    const rate = Math.max(0.25, Math.min(4, c.rate));
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = c.gain;
    src.connect(g);
    let tail: AudioNode = g;
    if (c.pos) { const p = this.panner(categoryOf(c.id), c.pos); g.connect(p); tail = p; }
    tail.connect(c.bus === 'ui' ? this.uiBus : this.sfxIn);
    const h = this.pool.acquire(now, c.pri + Math.min(1, c.est), now + buf.duration / rate + 0.05, () => {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(0, t, 0.012);
      try { src.stop(t + 0.07); } catch { /* not started */ }
    });
    if (!h) { g.disconnect(); if (tail !== g) tail.disconnect(); return; }
    src.onended = () => { this.pool.release(h); src.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); };
    src.start(now);
    this.played++;
    this.playedBus[c.bus === 'ui' ? 'ui' : 'sfx']++;
  }

  loop(key: string, c: LoopCmd | null): void {
    const L = this.loops.get(key);
    if (!c) { if (L) this.stopLoop(key, L, 0.08); return; }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (L && L.id === c.id) {
      setParam(L.g.gain, c.gain, now, 0.06);
      if (L.buf) setParam(L.buf.playbackRate, c.rate, now, 0.08);
      if (L.oscs.length) this.chargeParams(L, c.param, now);
      if (L.p && c.pos) setPos(L.p, c.pos);
      return;
    }
    if (L) this.stopLoop(key, L, 0.08);
    if (this.loops.size >= LOOP_CAP) return;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(c.gain, now, 0.06);
    let p: PannerNode | null = null;
    if (c.pos) { p = this.panner(categoryOf(c.id), c.pos); g.connect(p); p.connect(c.bus === 'ui' ? this.uiBus : this.sfxIn); }
    else g.connect(c.bus === 'ui' ? this.uiBus : this.sfxIn);
    const v: LoopVoice = { id: c.id, g, p, srcs: [], buf: null, oscs: [], lfo: null };
    if (c.id === 'charge') {
      // NEEDLE-GLINT charge whine: triangle + an octave sine through a low-pass, tremolo quickening with charge
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass'; lpf.frequency.value = 2600; lpf.Q.value = 0.7;
      const trem = ctx.createGain(); trem.gain.value = 0.75;
      const o1 = ctx.createOscillator(); o1.type = 'triangle';
      const o2 = ctx.createOscillator(); o2.type = 'sine';
      const o2g = ctx.createGain(); o2g.gain.value = 0.35;
      const lfo = ctx.createOscillator(); lfo.type = 'sine';
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.25;
      o1.connect(lpf); o2.connect(o2g); o2g.connect(lpf); lpf.connect(trem); trem.connect(g);
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      v.oscs = [o1, o2]; v.lfo = lfo; v.srcs = [o1, o2, lfo];
      this.chargeParams(v, c.param, now, true);
      for (const s of v.srcs) s.start(now);
    } else {
      const bufs = this.sfx.get(c.id);
      if (!bufs) { g.disconnect(); if (p) p.disconnect(); return; }
      const src = ctx.createBufferSource();
      src.buffer = bufs[0];
      src.loop = true;
      src.playbackRate.value = c.rate;
      src.connect(g);
      src.start(now, (key.length * 0.37) % Math.max(0.01, bufs[0].duration));   // de-phase identical loops
      v.buf = src; v.srcs = [src];
    }
    this.loops.set(key, v);
  }

  music(c: MusicCmd): void {
    if (c.t === 'play') this.musicPlay(c.cue, c.at);
    else if (c.t === 'stop') this.musicStop(c.fade);
    else if (c.t === 'prefetch') { if (this.ctx) for (const cue of c.cues) void this.loadMusic(cue); }
    else if (this.cur && this.ctx) setParam(this.cur.gain.gain, Math.pow(10, c.db / 20), this.ctx.currentTime, 0.4);
  }

  duck(seconds: number, music: number, sfx: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.duckM = this.applyDuck(this.musicDuck.gain, this.duckM, music, now, now + seconds);
    this.duckS = this.applyDuck(this.sfxDuck.gain, this.duckS, sfx, now, now + seconds);
  }

  private applyDuck(p: AudioParam, d: Duck, level: number, now: number, until: number): Duck {
    const nd: Duck = now < d.until ? { level: Math.min(d.level, level), until: Math.max(d.until, until) } : { level, until };
    p.cancelScheduledValues(now);
    p.setTargetAtTime(Math.max(0, Math.min(1, nd.level)), now, 0.035);
    p.setTargetAtTime(1, nd.until, 0.3);
    return nd;
  }

  // ── settings / listener ─────────────────────────────────────────────────────────────────
  setVolumes(v: Partial<AudioVolumes>): void {
    const c = (x: number | undefined, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
    this.vol = { master: c(v.master, this.vol.master), music: c(v.music, this.vol.music), sfx: c(v.sfx, this.vol.sfx) };
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    setParam(this.master.gain, this.vol.master, now, 0.03);
    setParam(this.musicBus.gain, this.vol.music, now, 0.03);
    setParam(this.sfxBus.gain, this.vol.sfx, now, 0.03);
    setParam(this.uiBus.gain, this.vol.sfx, now, 0.03);
  }

  get volumes(): AudioVolumes { return { ...this.vol }; }
  get isPaused(): boolean { return this.paused; }

  setPaused(p: boolean): void {
    this.paused = p;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    setParam(this.pauseGain.gain, p ? 0 : 1, now, 0.05);
    setParam(this.musicPause.gain, p ? 0.4 : 1, now, 0.15);
  }

  setListener(L: ListenerPose): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const ux = L.ux ?? 0, uy = L.uy ?? 1, uz = L.uz ?? 0;
    if (l.positionX) {
      l.positionX.value = L.x; l.positionY.value = L.y; l.positionZ.value = L.z;
      l.forwardX.value = L.fx; l.forwardY.value = L.fy; l.forwardZ.value = L.fz;
      l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
    } else {
      const ll = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      ll.setPosition(L.x, L.y, L.z);
      ll.setOrientation(L.fx, L.fy, L.fz, ux, uy, uz);
    }
  }

  /** per frame: keep the music scheduled */
  tick(): void {
    this.pump();
    if (this.meter && this.meterBuf && this.ctx?.state === 'running' && ++this.meterN % 3 === 0) {
      const b = this.meterBuf;
      this.meter.getFloatTimeDomainData(b as Float32Array<ArrayBuffer>);
      let pk = 0, sq = 0;
      for (let i = 0; i < b.length; i++) { const v = b[i]; const a = v < 0 ? -v : v; if (a > pk) pk = a; sq += v * v; }
      const rms = Math.sqrt(sq / b.length);
      const h = this.meterHold;
      if (pk > h.peak) h.peak = pk;
      if (pk > h.peakAll) h.peakAll = pk;
      h.rms += (rms - h.rms) * 0.25;
      if (h.rms > h.rmsMax) h.rmsMax = h.rms;
      // the compressor reports a large reduction for ~2 s after the context starts while the output is quiet (its
      // envelope settling, not limiting): the first 3 s of context time are not metered for the limiter
      const red = this.ctx.currentTime > 3 ? -(this.limiter.reduction ?? 0) : 0;
      if (red > h.limiter) h.limiter = red;
    }
  }

  /**
   * The output meter since the last read (then the window restarts): peakDb = the max sample, rmsDb = the short-term
   * RMS now, rmsMaxDb = its max in the window, limiterDb = the most gain reduction the master limiter applied,
   * peakAllDb = the max sample since the context started. dBFS; -120 = silence / not metered.
   */
  meterRead(): { peakDb: number; rmsDb: number; rmsMaxDb: number; limiterDb: number; peakAllDb: number } {
    const db = (v: number): number => (v > 1e-6 ? Math.round(20 * Math.log10(v) * 10) / 10 : -120);
    const h = this.meterHold;
    const out = { peakDb: db(h.peak), rmsDb: db(h.rms), rmsMaxDb: db(h.rmsMax), limiterDb: Math.round(h.limiter * 10) / 10, peakAllDb: db(h.peakAll) };
    h.peak = 0; h.rmsMax = 0; h.limiter = 0;
    return out;
  }

  // ── music ───────────────────────────────────────────────────────────────────────────────
  private musicPlay(cue: MusicCueId, at: 'now' | 'bar'): void {
    this.wantCue = cue;
    this.wantAt = at;
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.cur && this.cur.cue === cue && this.cur.entry.loop) return;
    const buf = this.musicBufs.get(cue);
    if (buf) { this.startCue(cue, buf, at); return; }
    void this.loadMusic(cue).then((b) => {
      if (b && this.wantCue === cue && !(this.cur && this.cur.cue === cue)) this.startCue(cue, b, this.wantAt);
    });
  }

  private startCue(cue: MusicCueId, buf: AudioBuffer, at: 'now' | 'bar'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    let t = now + 0.05;
    if (at === 'bar' && this.cur && this.cur.entry.loop) t = this.nextBar(this.cur, now + 0.1);
    if (this.cur) this.stopCue(this.cur, t, 0.06);
    const entry = MUSIC[cue];
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, Math.max(now, t - 0.03));
    g.gain.linearRampToValueAtTime(1, t + 0.03);
    g.connect(this.musicDuck);
    this.cur = { cue, entry, buf, gain: g, pos: 0, nextT: t, scheduled: [] };
    this.pump();
    this.musicSet(cue);
  }

  private sectionAt(e: MusicEntry, pos: number): number {
    if (pos < e.intro.length) return e.intro[pos];
    return e.cycle[(pos - e.intro.length) % e.cycle.length];
  }

  private pump(): void {
    const ctx = this.ctx;
    const c = this.cur;
    if (!ctx || !c) return;
    const now = ctx.currentTime;
    if (c.entry.loop && c.nextT < now - 0.05) c.nextT = now + 0.05;      // a long stall: resync instead of piling up
    while (c.nextT < now + LOOKAHEAD) {
      if (!c.entry.loop && c.pos >= 1) break;
      const idx = c.entry.loop ? this.sectionAt(c.entry, c.pos) : 0;
      const [s0, dur] = c.entry.sections[idx];
      const src = ctx.createBufferSource();
      src.buffer = c.buf;
      src.connect(c.gain);
      src.start(c.nextT, s0, dur);
      c.scheduled.push({ src, t0: c.nextT, t1: c.nextT + dur });
      c.nextT += dur;
      c.pos++;
    }
    if (c.scheduled.length > 4) c.scheduled = c.scheduled.filter((s) => s.t1 > now - 0.5);
  }

  private nextBar(c: CueVoice, t: number): number {
    const bar = 240 / c.entry.bpm;
    for (const s of c.scheduled) {
      if (t >= s.t0 && t < s.t1) {
        const k = Math.ceil((t - s.t0) / bar - 1e-6);
        return Math.min(s.t1, s.t0 + k * bar);
      }
    }
    return t;
  }

  private stopCue(c: CueVoice, t: number, fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const g = c.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setValueAtTime(g.value, Math.max(now, t - fade));
    g.linearRampToValueAtTime(0, Math.max(now + 0.01, t + 0.03));
    for (const s of c.scheduled) { try { s.src.stop(Math.max(now + 0.01, t + 0.05)); } catch { /* ended */ } }
    const gain = c.gain;
    setTimeout(() => { try { gain.disconnect(); } catch { /* gone */ } }, Math.max(0, (t - now) * 1000) + 400);
  }

  private musicStop(fade: number): void {
    this.wantCue = null;
    const ctx = this.ctx;
    if (!ctx || !this.cur) return;
    this.stopCue(this.cur, ctx.currentTime + Math.max(0.02, fade), Math.max(0.02, fade));
    this.cur = null;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────
  private panner(cat: ReturnType<typeof categoryOf>, pos: Vec3T): PannerNode {
    const ctx = this.ctx as AudioContext;
    const { ref, roll } = distModel(cat);
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = MAX_DISTANCE;
    setPos(p, pos);
    return p;
  }

  private chargeParams(v: LoopVoice, charge: number, now: number, init = false): void {
    const c = Math.max(0, Math.min(1, charge));
    const f = 330 + 820 * c;
    const tau = init ? 0.001 : 0.05;
    setParam(v.oscs[0].frequency, f, now, tau);
    setParam(v.oscs[1].frequency, f * 2.005, now, tau);
    if (v.lfo) setParam(v.lfo.frequency, 6 + 16 * c, now, tau);
  }

  private stopLoop(key: string, L: LoopVoice, fade: number): void {
    this.loops.delete(key);
    const ctx = this.ctx;
    const now = ctx ? ctx.currentTime : 0;
    try { L.g.gain.cancelScheduledValues(now); L.g.gain.setTargetAtTime(0, now, Math.max(0.005, fade / 3)); } catch { /* closed */ }
    for (const s of L.srcs) {
      try { s.stop(now + fade + 0.05); } catch { /* ended */ }
    }
    const last = L.srcs[0];
    if (last) last.onended = () => { for (const s of L.srcs) s.disconnect(); L.g.disconnect(); if (L.p) L.p.disconnect(); };
  }

  /** before the sprite is decoded (or if it failed): oscillator stand-ins for the match-flow sounds and splats */
  private fallback(c: PlayCmd): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = c.bus === 'ui' ? this.uiBus : this.sfxIn;
    const g = ctx.createGain();
    g.connect(out);
    const blip = (f: number, d: number, type: OscillatorType, peak: number): void => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(g);
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(peak, now + 0.005); g.gain.setTargetAtTime(0, now + d, 0.03);
      o.start(now); o.stop(now + d + 0.2); o.onended = () => { o.disconnect(); g.disconnect(); };
    };
    switch (c.id) {
      case 'beep': blip(880, 0.12, 'sine', 0.25); break;
      case 'beep_go': blip(1318.5, 0.25, 'sine', 0.25); break;
      case 'tick': blip(1250 * c.rate, 0.03, 'triangle', 0.2); break;
      case 'horn_start': case 'horn_minute': case 'horn_final': case 'horn_end': {
        const d = c.id === 'horn_end' ? 2.2 : c.id === 'horn_start' ? 1.1 : 0.55;
        const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 1800; lpf.connect(g);
        g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.12, now + 0.06); g.gain.setTargetAtTime(0, now + d, 0.12);
        for (const f of [130.81, 164.81, 196.0]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lpf); o.start(now); o.stop(now + d + 0.8); }
        break;
      }
      case 'splat': {
        if (!this.noise) { g.disconnect(); return; }
        const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = c.rate;
        const bpf = ctx.createBiquadFilter(); bpf.type = 'bandpass'; bpf.frequency.value = 900 * c.rate; bpf.Q.value = 1.2;
        let tail: AudioNode = g;
        if (c.pos) { const p = this.panner('splat', c.pos); g.disconnect(); g.connect(p); p.connect(out); tail = p; }
        s.connect(bpf); bpf.connect(g);
        g.gain.setValueAtTime(0.5 * c.gain, now); g.gain.setTargetAtTime(0, now + 0.01, 0.05);
        s.start(now); s.stop(now + 0.3); s.onended = () => { s.disconnect(); bpf.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); };
        break;
      }
      default: g.disconnect(); return;
    }
    this.played++;
    this.playedBus[c.bus === 'ui' ? 'ui' : 'sfx']++;
  }

  private fail(what: string, e: unknown): void {
    const msg = `${what}: ${e instanceof Error ? e.message : String(e)}`;
    this.errors.push(msg);
    if (!this.warned) { this.warned = true; console.warn(`[audio] ${msg}`); }
  }
}
