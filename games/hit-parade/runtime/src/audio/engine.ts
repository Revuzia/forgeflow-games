// HIT PARADE - the WebAudio backend (CONTRACT s9). Adapted from dyefield audio/engine.ts. Executes the router's
// commands; owns no game logic.
//
//   one-shot - gain - [StereoPanner] -+- sfxIn - sfxDuck - sfxPause - sfxBus ----+
//                                     +- voiceIn ------- voicePause - voiceBus --+
//   crowd one-shots + beds (loops) ------ crowdIn ----- crowdPause - crowdBus --+
//   UI one-shots ---------------------------------------------------- uiBus ----+
//   music cue gain - musicDuck - musicPause - musicBus -------------------------+- master - limiter - out
//
// * Three Opus sprites (ui mono, sfx mono, crowd stereo), each decoded once and sliced into one AudioBuffer per variant
//   (loops get their head crossfaded from the decoded guard: seam.ts). Music cues are single buffers that loop natively
//   (loopStart/loopEnd = the cue; bars are whole, the seam was crossfaded at build time).
// * Codecs: every asset is Ogg Opus with an AAC-LC (.m4a) twin (manifest `alt`). Before WebKit 18.4 (every iOS browser up
//   to iOS 18.3) Ogg cannot be decoded, so the twin is fetched when canPlayType says no Ogg-Opus, and an Ogg decode that
//   is refused anyway falls back to it once. A decode that comes back longer than the asset (an AAC twin decoded
//   WITHOUT its MP4 edit list = `delay` priming samples; an Opus decoder that ignores the pre-skip) is offset so both
//   decoders stay sample-exact.
// * Loading: nothing is fetched at construction. unlock() (first gesture) fetches the ui sprite + the wanted cue;
//   preload() / the first bout events fetch the sfx + crowd sprites (CONTRACT s9: lazy preload after the first stage).
//   Audio fetches ask for low priority (never ahead of the GLBs the player waits on).

import { MUSIC, SAMPLE_RATE, SFX, SPRITES, SPRITE_GUARD_S, type AltCodec, type MusicCueId, type SfxId, type SpriteId } from './manifest.ts';
import { loopSlice } from './seam.ts';
import type { AudioSink, Bus, LoopCmd, MusicCmd, PlayCmd } from './router.ts';
import { VoicePool } from './voices.ts';
import type { AudioVolumes } from './types.ts';

const LOOP_CAP = 8;
const KEEP_MUSIC = 3;

interface Asset { readonly url: string; readonly alt: AltCodec; readonly samples?: number }
interface Fetched { bytes: ArrayBuffer; alt: AltCodec | null }
interface Decoded { buf: AudioBuffer; off: number }

/** can this browser decode Ogg Opus? (no DOM, e.g. under node: assume yes) */
function canPlayOggOpus(): boolean {
  try {
    if (typeof document === 'undefined') return true;
    const a = document.createElement('audio');
    return typeof a.canPlayType !== 'function' || a.canPlayType('audio/ogg; codecs="opus"') !== '';
  } catch { return true; }
}

/**
 * seconds to skip at the start of a decoded AAC twin: a decoder that honours the MP4 edit list returns exactly `samples`;
 * one that ignores it returns `samples` + `delay` (the build pads so there is no end padding) - told apart by length.
 */
export function altOffset(buf: Pick<AudioBuffer, 'duration'>, a: AltCodec): number {
  const expected = a.samples / SAMPLE_RATE, delay = a.delay / SAMPLE_RATE;
  return buf.duration > expected + delay / 2 ? delay : 0;
}

/** seconds to skip at the start of a decoded Ogg Opus: 0 when the pre-skip was honoured (the normal case) */
export function oggOffset(buf: Pick<AudioBuffer, 'duration'>, samples: number): number {
  const extra = buf.duration - samples / SAMPLE_RATE;
  return extra > 100 / SAMPLE_RATE && extra < 4096 / SAMPLE_RATE ? extra : 0;
}

interface CueVoice { cue: MusicCueId; src: AudioBufferSourceNode; gain: GainNode }
interface LoopVoice { id: SfxId; g: GainNode; src: AudioBufferSourceNode }
interface Duck { level: number; until: number }

function setParam(p: AudioParam, v: number, t: number, tau: number): void {
  if (!Number.isFinite(v)) return;
  p.cancelScheduledValues(t);
  p.setTargetAtTime(v, t, tau);
}

export class AudioEngine implements AudioSink {
  ctx: AudioContext | null = null;
  readonly errors: string[] = [];
  played = 0;
  readonly playedBus = { sfx: 0, ui: 0, voice: 0, crowd: 0 };
  /** plays asked for before their sprite was decoded (dropped) */
  notReady = 0;
  readonly codecs: Record<string, { codec: 'ogg' | 'aac'; off: number; duration: number }> = {};
  private meter: AnalyserNode | null = null;
  private meterBuf: Float32Array | null = null;
  private readonly meterHold = { peak: 0, rms: 0, rmsMax: 0, limiter: 0, peakAll: 0 };
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private readonly ins: Record<Bus, GainNode> = {} as Record<Bus, GainNode>;
  private readonly pauses: Partial<Record<Bus, GainNode>> = {};
  private readonly buses: Record<Bus, GainNode> = {} as Record<Bus, GainNode>;
  private sfxDuck!: GainNode;
  private musicDuck!: GainNode;
  private musicPause!: GainNode;
  private musicBus!: GainNode;
  private readonly pool: VoicePool;
  private readonly ogg = canPlayOggOpus();
  private readonly spriteBytes = new Map<SpriteId, Promise<Fetched | null>>();
  private readonly spriteReady = new Map<SpriteId, Promise<void>>();
  private readonly sfx = new Map<SfxId, AudioBuffer[]>();
  private readonly spritesDone = new Set<SpriteId>();
  private readonly musicBytes = new Map<MusicCueId, Promise<Fetched | null>>();
  private readonly musicBufs = new Map<MusicCueId, Decoded>();
  private readonly musicDecoding = new Map<MusicCueId, Promise<Decoded | null>>();
  private readonly loops = new Map<string, LoopVoice>();
  private cur: CueVoice | null = null;
  private wantCue: MusicCueId | null = null;
  private wantFade = 0.6;
  private vol: AudioVolumes = { master: 0.85, music: 0.55, sfx: 0.9, crowd: 0.8, voice: 0.9 };
  private paused = false;
  private duckM: Duck = { level: 1, until: 0 };
  private duckS: Duck = { level: 1, until: 0 };
  private warned = false;

  constructor(voiceLimit: number) {
    this.pool = new VoicePool(voiceLimit);
  }

  get voices(): number { return this.pool.count; }
  get poolStats(): { peak: number; stolen: number; rejected: number } { return { peak: this.pool.peak, stolen: this.pool.stolen, rejected: this.pool.rejected }; }
  get cue(): MusicCueId | null { return this.cur ? this.cur.cue : null; }
  /** CHANGED(integrator) 3D (G6 stability): the last music cue that actually STARTED (a one-shot stinger such as win / lose
   *  clears `cue` when it ends, so a harness reading after the 8-11 s stinger saw null) */
  lastCue: MusicCueId | null = null;
  get loopKeys(): string[] { return [...this.loops.keys()]; }
  get decoded(): string[] { return [...this.spritesDone, ...[...this.musicBufs.keys()].map((c) => `music_${c}`)]; }
  get preloaded(): string[] { return [...this.spriteBytes.keys(), ...[...this.musicBytes.keys()].map((c) => `music_${c}`)]; }
  get volumes(): AudioVolumes { return { ...this.vol }; }
  get isPaused(): boolean { return this.paused; }
  hasSprite(s: SpriteId): boolean { return this.spritesDone.has(s); }

  // ------------------------------------------------------------------------------------------------- lifecycle
  /** start downloads (idempotent): sprite ids and/or music cue ids */
  preload(ids: readonly (SpriteId | MusicCueId)[]): void {
    for (const id of ids) {
      if (id in SPRITES) {
        const s = id as SpriteId;
        if (!this.spriteBytes.has(s)) this.spriteBytes.set(s, this.fetchAsset(SPRITES[s], `sprite ${s}`));
        if (this.ctx && !this.spriteReady.has(s)) this.spriteReady.set(s, this.decodeSprite(s));
      } else if (id in MUSIC) {
        const c = id as MusicCueId;
        if (!this.musicBytes.has(c)) this.musicBytes.set(c, this.fetchAsset(MUSIC[c], `music ${c}`));
      }
    }
  }

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
      this.preload(['ui']);
      for (const s of this.spriteBytes.keys()) if (!this.spriteReady.has(s)) this.spriteReady.set(s, this.decodeSprite(s));
      if (this.wantCue && !this.cur) this.musicPlay(this.wantCue, this.wantFade);
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
    this.limiter.threshold.value = -6; this.limiter.knee.value = 4; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.15;
    this.master = G(this.vol.master);
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    this.meterBuf = new Float32Array(this.meter.fftSize);
    this.limiter.connect(this.meter);
    // sfx: in -> duck -> pause -> bus
    this.buses.sfx = G(this.vol.sfx); this.buses.sfx.connect(this.master);
    this.pauses.sfx = G(this.paused ? 0 : 1); this.pauses.sfx.connect(this.buses.sfx);
    this.sfxDuck = G(1); this.sfxDuck.connect(this.pauses.sfx);
    this.ins.sfx = G(1); this.ins.sfx.connect(this.sfxDuck);
    // voice (announcer + fighters): in -> pause -> bus
    this.buses.voice = G(this.vol.voice); this.buses.voice.connect(this.master);
    this.pauses.voice = G(this.paused ? 0 : 1); this.pauses.voice.connect(this.buses.voice);
    this.ins.voice = G(1); this.ins.voice.connect(this.pauses.voice);
    // crowd: in -> pause -> bus
    this.buses.crowd = G(this.vol.crowd); this.buses.crowd.connect(this.master);
    this.pauses.crowd = G(this.paused ? 0 : 1); this.pauses.crowd.connect(this.buses.crowd);
    this.ins.crowd = G(1); this.ins.crowd.connect(this.pauses.crowd);
    // ui (never paused; follows the sfx volume)
    this.buses.ui = G(this.vol.sfx); this.buses.ui.connect(this.master);
    this.ins.ui = this.buses.ui;
    // music
    this.musicBus = G(this.vol.music); this.musicBus.connect(this.master);
    this.musicPause = G(this.paused ? 0.4 : 1); this.musicPause.connect(this.musicBus);
    this.musicDuck = G(1); this.musicDuck.connect(this.musicPause);
  }

  dispose(): void {
    this.pool.clear();
    for (const [k, l] of this.loops) this.stopLoop(k, l, 0);
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined); }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined); }

  // --------------------------------------------------------------------------------------------------- loading
  private fetchRaw(url: string, what: string): Promise<ArrayBuffer | null> {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(url, { priority: 'low' } as RequestInit).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.arrayBuffer(); })
      .catch((e: unknown) => { this.fail(`fetch ${what}`, e); return null; });
  }

  /** the Ogg where this browser can play Opus, else the AAC twin */
  private fetchAsset(e: Asset, what: string): Promise<Fetched | null> {
    const alt = this.ogg ? null : e.alt;
    return this.fetchRaw(alt ? alt.url : e.url, alt ? `${what} (aac)` : what).then((bytes) => (bytes ? { bytes, alt } : null));
  }

  /** decode; a refused Ogg falls back to the AAC twin once. `samples` = the asset's length (offset detection). */
  private async decodeAsset(got: Fetched | null, e: Asset, samples: number, what: string): Promise<Decoded | null> {
    const ctx = this.ctx;
    if (!ctx || !got) return null;
    const note = (d: Decoded, codec: 'ogg' | 'aac'): Decoded => {
      this.codecs[what] = { codec, off: Math.round(d.off * SAMPLE_RATE), duration: Math.round(d.buf.duration * 1000) / 1000 };
      return d;
    };
    try {
      const buf = await ctx.decodeAudioData(got.bytes.slice(0));
      return note({ buf, off: got.alt ? altOffset(buf, got.alt) : oggOffset(buf, samples) }, got.alt ? 'aac' : 'ogg');
    } catch (err) {
      if (got.alt) { this.fail(`decode ${what} (aac)`, err); return null; }
      const bytes = await this.fetchRaw(e.alt.url, `${what} (aac)`);
      if (!bytes) { this.fail(`decode ${what}`, err); return null; }
      try {
        const buf = await ctx.decodeAudioData(bytes);
        return note({ buf, off: altOffset(buf, e.alt) }, 'aac');
      } catch (err2) {
        this.fail(`decode ${what}`, err);
        this.fail(`decode ${what} (aac)`, err2);
        return null;
      }
    }
  }

  private async decodeSprite(s: SpriteId): Promise<void> {
    const ctx = this.ctx;
    const bytesP = this.spriteBytes.get(s);
    const got = bytesP ? await bytesP : null;
    if (!ctx || !got) return;
    const sp = SPRITES[s];
    const dec = await this.decodeAsset(got, sp, sp.samples, `sprite ${s}`);
    if (!dec) return;
    try {
      const full = dec.buf;
      const sr = full.sampleRate;
      const chans: Float32Array[] = [];
      for (let c = 0; c < full.numberOfChannels; c++) chans.push(full.getChannelData(c));
      const guard = Math.round(SPRITE_GUARD_S * sr);
      const k = Math.min(guard, Math.round(0.006 * sr));
      for (const id of Object.keys(SFX) as SfxId[]) {
        const e = SFX[id];
        if (e.sprite !== s) continue;
        const out: AudioBuffer[] = [];
        for (let i = 0; i < e.v.length; i++) {
          const a = Math.round((e.v[i][0] + dec.off) * sr);
          const n = Math.max(1, Math.min(chans[0].length - a, Math.round((e.n[i] / SAMPLE_RATE) * sr)));
          const b = ctx.createBuffer(chans.length, n, sr);
          for (let c = 0; c < chans.length; c++) b.copyToChannel(e.loop ? loopSlice(chans[c], a, n, guard, k) : chans[c].slice(a, a + n), c);
          out.push(b);
        }
        this.sfx.set(id, out);
      }
      this.spritesDone.add(s);
    } catch (e) {
      this.fail(`slice sprite ${s}`, e);
    }
  }

  private loadMusic(cue: MusicCueId): Promise<Decoded | null> {
    const have = this.musicBufs.get(cue);
    if (have) return Promise.resolve(have);
    const pending = this.musicDecoding.get(cue);
    if (pending) return pending;
    let bytesP = this.musicBytes.get(cue);
    if (!bytesP) { bytesP = this.fetchAsset(MUSIC[cue], `music ${cue}`); this.musicBytes.set(cue, bytesP); }
    const p = bytesP.then(async (got) => {
      try {
        const d = await this.decodeAsset(got, MUSIC[cue], MUSIC[cue].samples, `music ${cue}`);
        if (d) {
          this.musicBufs.set(cue, d);
          // memory: ~0.4 MB per decoded stereo second - keep the playing cue + the most recent few
          while (this.musicBufs.size > KEEP_MUSIC) {
            const drop = [...this.musicBufs.keys()].find((c) => c !== cue && c !== this.cur?.cue);
            if (!drop) break;
            this.musicBufs.delete(drop);
            this.musicBytes.delete(drop);
          }
        }
        return d;
      } finally {
        this.musicDecoding.delete(cue);
      }
    });
    this.musicDecoding.set(cue, p);
    return p;
  }

  // ------------------------------------------------------------------------------------------------ AudioSink
  play(c: PlayCmd): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const sprite = SFX[c.id].sprite;
    const bufs = this.sfx.get(c.id);
    if (!bufs) { this.notReady++; this.preload([sprite]); return; }
    const buf = bufs[Math.max(0, Math.min(bufs.length - 1, c.variant))];
    const rate = Math.max(0.25, Math.min(4, c.rate));
    const now = ctx.currentTime;
    const t0 = now + Math.max(0, c.delay);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = c.gain;
    src.connect(g);
    let tail: AudioNode = g;
    if (c.pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, c.pan));
      g.connect(p);
      tail = p;
    }
    tail.connect(this.ins[c.bus]);
    const h = this.pool.acquire(now, c.pri + Math.min(1, c.gain), t0 + buf.duration / rate + 0.05, () => {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(0, t, 0.012);
      try { src.stop(t + 0.07); } catch { /* not started */ }
    });
    if (!h) { g.disconnect(); if (tail !== g) tail.disconnect(); return; }
    src.onended = () => { this.pool.release(h); src.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); };
    src.start(t0);
    this.played++;
    this.playedBus[c.bus]++;
  }

  loop(key: string, c: LoopCmd | null): void {
    const L = this.loops.get(key);
    if (!c) { if (L) this.stopLoop(key, L, 0.4); return; }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (L && L.id === c.id) { setParam(L.g.gain, c.gain, now, 0.25); return; }
    if (L) this.stopLoop(key, L, 0.4);
    if (this.loops.size >= LOOP_CAP) return;
    const bufs = this.sfx.get(c.id);
    if (!bufs) { this.preload([SFX[c.id].sprite]); return; }
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(c.gain, now, 0.4);
    g.connect(this.ins[c.bus]);
    const src = ctx.createBufferSource();
    src.buffer = bufs[0];
    src.loop = true;
    src.playbackRate.value = c.rate;
    src.connect(g);
    src.start(now, (key.length * 0.37) % Math.max(0.01, bufs[0].duration));    // de-phase the beds
    this.loops.set(key, { id: c.id, g, src });
  }

  music(c: MusicCmd): void {
    if (c.t === 'play') this.musicPlay(c.cue, c.fade);
    else this.musicStop(c.fade);
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
    p.setTargetAtTime(Math.max(0, Math.min(1, nd.level)), now, 0.03);
    p.setTargetAtTime(1, nd.until, 0.25);
    return nd;
  }

  // ---------------------------------------------------------------------------------------------------- settings
  setVolumes(v: Partial<AudioVolumes>): void {
    const c = (x: number | undefined, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d);
    this.vol = { master: c(v.master, this.vol.master), music: c(v.music, this.vol.music), sfx: c(v.sfx, this.vol.sfx),
      crowd: c(v.crowd, this.vol.crowd), voice: c(v.voice, this.vol.voice) };
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    setParam(this.master.gain, this.vol.master, now, 0.03);
    setParam(this.musicBus.gain, this.vol.music, now, 0.03);
    setParam(this.buses.sfx.gain, this.vol.sfx, now, 0.03);
    setParam(this.buses.ui.gain, this.vol.sfx, now, 0.03);
    setParam(this.buses.crowd.gain, this.vol.crowd, now, 0.03);
    setParam(this.buses.voice.gain, this.vol.voice, now, 0.03);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const b of ['sfx', 'voice', 'crowd'] as const) { const g = this.pauses[b]; if (g) setParam(g.gain, p ? 0 : 1, now, 0.05); }
    setParam(this.musicPause.gain, p ? 0.4 : 1, now, 0.15);
  }

  /** the output meter, sampled when called (index.ts calls it every frame and from stats()) */
  tick(): void {
    if (!this.meter || !this.meterBuf || this.ctx?.state !== 'running') return;
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
    // the compressor reports a large reduction for ~2 s after the context starts while its envelope settles
    const red = this.ctx.currentTime > 3 ? -(this.limiter.reduction ?? 0) : 0;
    if (red > h.limiter) h.limiter = red;
  }

  meterRead(): { peakDb: number; rmsDb: number; rmsMaxDb: number; limiterDb: number; peakAllDb: number } {
    const db = (v: number): number => (v > 1e-6 ? Math.round(20 * Math.log10(v) * 10) / 10 : -120);
    const h = this.meterHold;
    const out = { peakDb: db(h.peak), rmsDb: db(h.rms), rmsMaxDb: db(h.rmsMax), limiterDb: Math.round(h.limiter * 10) / 10, peakAllDb: db(h.peakAll) };
    h.peak = 0; h.rmsMax = 0; h.limiter = 0;
    return out;
  }

  // ------------------------------------------------------------------------------------------------------ music
  private musicPlay(cue: MusicCueId, fade: number): void {
    this.wantCue = cue;
    this.wantFade = fade;
    const ctx = this.ctx;
    if (!ctx) { this.preload([cue]); return; }
    if (this.cur && this.cur.cue === cue && MUSIC[cue].loop) return;
    const d = this.musicBufs.get(cue);
    if (d) { this.startCue(cue, d, fade); return; }
    void this.loadMusic(cue).then((b) => {
      if (b && this.wantCue === cue && !(this.cur && this.cur.cue === cue)) this.startCue(cue, b, this.wantFade);
    });
  }

  private startCue(cue: MusicCueId, d: Decoded, fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const e = MUSIC[cue];
    const f = Math.max(0.02, fade);
    if (this.cur) this.stopCue(this.cur, f);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + f);
    g.connect(this.musicDuck);
    const src = ctx.createBufferSource();
    src.buffer = d.buf;
    const len = e.samples / SAMPLE_RATE;
    if (e.loop) {
      src.loop = true;
      src.loopStart = d.off;
      src.loopEnd = d.off + len;
      src.start(now + 0.01, d.off);
    } else {
      src.start(now + 0.01, d.off, len);
      src.onended = () => { if (this.cur && this.cur.src === src) this.cur = null; };
    }
    src.connect(g);
    this.cur = { cue, src, gain: g };
    this.lastCue = cue;
  }

  private stopCue(c: CueVoice, fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const g = c.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    try { c.src.stop(now + fade + 0.05); } catch { /* ended */ }
    const gain = c.gain;
    setTimeout(() => { try { gain.disconnect(); } catch { /* gone */ } }, (fade + 0.4) * 1000);
  }

  private musicStop(fade: number): void {
    this.wantCue = null;
    if (!this.ctx || !this.cur) return;
    this.stopCue(this.cur, Math.max(0.02, fade));
    this.cur = null;
  }

  // ---------------------------------------------------------------------------------------------------- helpers
  private stopLoop(key: string, L: LoopVoice, fade: number): void {
    this.loops.delete(key);
    const ctx = this.ctx;
    const now = ctx ? ctx.currentTime : 0;
    try { L.g.gain.cancelScheduledValues(now); L.g.gain.setTargetAtTime(0, now, Math.max(0.005, fade / 3)); } catch { /* closed */ }
    try { L.src.stop(now + fade + 0.05); } catch { /* ended */ }
    L.src.onended = () => { L.src.disconnect(); L.g.disconnect(); };
  }

  private fail(what: string, e: unknown): void {
    const msg = `${what}: ${e instanceof Error ? e.message : String(e)}`;
    this.errors.push(msg);
    if (!this.warned) { this.warned = true; console.warn(`[audio] ${msg}`); }
  }
}
