// GENESIS — the audio engine (CONTRACT §17; lane: src/audio/**). WebAudio, everything synthesized, never silent.
//
//   import { createAudio } from './audio/engine.ts';
//   const audio = createAudio({ volumes: { master: 0.8 } });
//   audio.start();                                    // safe at boot: the context opens on the first user gesture
//   // every frame, after the camera pose is computed and BEFORE hud.toasts.pump (which drains view.pendingEvents):
//   audio.setListener(pose, renderer.primaryId, renderer.stats.altitude);
//   audio.update(view, dt);                           // also hears view.pendingEvents without consuming them
//   audio.onEvent(e);                                 // optional, for events routed elsewhere (deduplicated)
//   audio.cue('ignition');                            // the opening; also 'whisper', 'ui.click', 'gesture.ok', …
//   audio.setVolumes({ master, music, sfx, ambience }); audio.mute(true);
//   audio.onMuteChange((m) => prefs.set('audio.muted', m));   // the portal's Mute button, mirrored into the game's prefs
//   audio.state();                                    // levels, voices, music, meter (test surface / dev HUD)
//
// Interface sounds: cue('ui.open' | 'ui.close' | 'ui.radial' | 'ui.tick' | 'ui.arm' | 'ui.disarm' | 'ui.click' |
// 'ui.hover' | 'ui.toggle' | 'ui.confirm' | 'ui.error' | 'gesture.start' | 'gesture.ok' | 'gesture.fail') — see
// uicues.ts for where each belongs. They are batched per task (one action → its most important cue), gated per cue
// in real time and held for a moment while the context opens, so the click that unlocks the sound is itself heard.
// Mute: the game's mute() and the ForgeFlow portal's Mute button are one switch (mutesync.ts).
//
// Graph: ambience beds + spatial emitters → hush lowpass → ambience bus ┐
//        culture players / orbital score → duck → music bus ─────────────┼→ sum → glue compressor → limiter → makeup →
//        one-shot voices (spatial or not) → sfx bus ──────────────────────┘   soft clipper (|out| ≤ 0.9) → master → out
//        each bus also sends (post-fader) to a synthesized hall reverb that returns into the sum.
// The soft clipper's transfer curve is bounded, so whatever the mix does the output never clips.

import type { HandView, SimEvent, StarView, UnitVec } from '../sim/types.ts';
import { BufferBank, PRELOAD } from './bank.ts';
import { softClipCurve, rng } from './dsp.ts';
import { CueGate, cueFor, type CueSpec } from './eventmap.ts';
import { SceneProbe, attenuate, bodyPoint, hearingRef, toLocal, rotate, rotateInv, type AudioScene, type SceneWorld, type ScenePlanet, type ListenerState } from './scene.ts';
import { Ambience, type PlayOpts } from './ambience.ts';
import { Emitters } from './emitters.ts';
import { MusicDirector, type MusicState } from './musicplayer.ts';
import { FALLBACK, SFX, Sfx } from './sfx.ts';
import { SpatialOut, soundDelay } from './spatial.ts';
import { Knob, bq } from './synth.ts';
import { VoicePool } from './voices.ts';
import { UiCueMixer, isUiCue, uiRule, type UiCueRule } from './uicues.ts';
import { MuteSync, findPortal } from './mutesync.ts';

export interface AudioVolumes {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}

export interface AudioOptions {
  /** use this context (an OfflineAudioContext for renders and tests); default: a new AudioContext at start() */
  context?: BaseAudioContext;
  volumes?: Partial<AudioVolumes>;
  muted?: boolean;
  /** 'high' (HRTF panners, 40 voices, 10 emitters) or 'low' (equal-power, 24 voices, 6 emitters) */
  quality?: 'high' | 'low';
  /** where to listen for the first user gesture that may open the context (default: window) */
  unlockTarget?: EventTarget | null;
  /** seed for every random choice the engine makes (default: from the clock) */
  seed?: number;
  latencyHint?: AudioContextLatencyCategory | number;
  /** suspend the context while the tab is hidden (default true for a real AudioContext) */
  pauseWhenHidden?: boolean;
  /**
   * keep mute() in step with the ForgeFlow portal's Mute button (window.__CONTROLS__ + 'mutechange'); default true
   * for a page without an injected `context`
   */
  portal?: boolean;
}

export interface ListenerPose {
  /** system-frame position (m) */
  pos: ArrayLike<number>;
  /** system-frame orientation quaternion (x, y, z, w); the camera looks down −z */
  quat: ArrayLike<number>;
  fov?: number;
  planet?: number;
}

export interface CueOptions {
  /** where it happens (body-frame unit vector on `planet`); omitted: heard in the head */
  pos?: UnitVec;
  planet?: number;
  /** 0..1.5 (default 1) */
  level?: number;
  size?: number;
  variant?: string;
  /** seconds from now */
  delay?: number;
}

export interface AudioState {
  running: boolean;
  context: string;
  sampleRate: number;
  time: number;
  muted: boolean;
  volumes: AudioVolumes;
  voices: number;
  dropped: number;
  stolen: number;
  emitters: { key: string; level: number }[];
  beds: number;
  layers: Record<string, number>;
  music: MusicState;
  meter: { peak: number; rms: number };
  bank: { ready: number; pending: number; renderMs: number; worker: boolean };
  scene: { planet: number; alt: number; space: number; inAir: number; airless: boolean; day: number; temp: number } | null;
  events: { heard: number; played: number; dropped: number };
  /** the portal's own mute (null: no portal on this page) */
  portalMuted: boolean | null;
  /** interface cues: played, dropped by the gate or a batch, held while the context opened */
  ui: { played: number; gated: number; early: number };
}

export interface GenesisAudio {
  readonly context: BaseAudioContext | null;
  readonly muted: boolean;
  /** open (or arm the opening of) the audio context; resolves true when sound is running */
  start(): Promise<boolean>;
  /** the camera this frame: pose, the world it belongs to (-1: none), the renderer's altitude estimate */
  setListener(pose: ListenerPose, planet: number, altitude: number): void;
  /** call every frame with the client WorldView (or anything shaped like it) and the frame's seconds */
  update(view: SceneWorld & { pendingEvents?: SimEvent[]; star?: StarView }, dt: number): void;
  /** a sim event (deduplicated: passing the same event object twice plays it once) */
  onEvent(e: SimEvent): void;
  setVolumes(v: Partial<AudioVolumes>): void;
  getVolumes(): AudioVolumes;
  mute(on: boolean): void;
  /**
   * told when the mute changes from outside the game's own mute() — the portal's Mute button — so the game's prefs
   * can mirror it; called at once if the portal already overrules what the game asked for. Returns an unsubscribe.
   */
  onMuteChange(cb: (muted: boolean) => void): () => void;
  /** play a named cue from the catalog ('ignition', 'whisper', 'ui.click', 'hand.grab', 'miracle.heal', …) */
  cue(name: string, opts?: CueOptions): void;
  /** every cue name the catalog knows */
  cues(): string[];
  /**
   * render the synthesized textures now instead of lazily over the first frames (call while a loading card is up);
   * `all` also renders the rarer ones (hail, frogs, work sounds, plucked strings). Returns milliseconds spent.
   */
  warm(all?: boolean): number;
  /** the last probe of what the camera hears (dev HUD, tests) */
  lastScene(): AudioScene | null;
  state(): AudioState;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  dispose(): void;
}

export function createAudio(options: AudioOptions = {}): GenesisAudio {
  return new AudioEngine(options);
}

const DEFAULT_VOLUMES: AudioVolumes = { master: 0.85, music: 0.6, sfx: 0.85, ambience: 0.75 };
const PROBE_EVERY = 0.15;
/** an interface cue asked for while the context was still opening is played if it opens within this (s) */
const EARLY_HOLD = 0.4;
/** the same direct (non-interface) cue twice within this (s) plays once */
const DIRECT_GAP = 0.03;

const wallSeconds = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

interface Bus { input: GainNode; vol: GainNode; wetIn: GainNode; wetVol: GainNode; kVol: Knob; kWet: Knob }

/** the god's hand moving through the air: a whoosh that follows its speed */
class HandAir {
  private readonly sp: SpatialOut;
  private readonly bp: BiquadFilterNode;
  private readonly kF: Knob;
  private readonly kQ: Knob;
  private last: [number, number, number] | null = null;
  private speed = 0;
  constructor(ctx: BaseAudioContext, bank: BufferBank, dest: AudioNode, hrtf: boolean) {
    this.sp = new SpatialOut(ctx, dest, hrtf);
    this.bp = bq(ctx, 'bandpass', 600, 1.2);
    const buf = bank.need('pink')!;
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.start(ctx.currentTime, Math.random() * buf.duration);
    s.connect(this.bp);
    this.bp.connect(this.sp.input);
    this.kF = new Knob(this.bp.frequency);
    this.kQ = new Knob(this.bp.Q);
  }
  update(hand: AudioScene['hand'], local: number[] | null, now: number, dt: number): void {
    let v = 0;
    if (hand && local) {
      const b = hand.body;
      if (this.last && dt > 0) v = Math.hypot(b[0] - this.last[0], b[1] - this.last[1], b[2] - this.last[2]) / dt;
      this.last = [b[0], b[1], b[2]];
    } else this.last = null;
    // snapshots move the hand in steps: smooth the speed over ~150 ms
    this.speed += (Math.min(400, v) - this.speed) * (1 - Math.exp(-dt / 0.15));
    const k = Math.max(0, Math.min(1, (this.speed - 6) / 60));
    this.kF.set(260 + Math.min(2600, this.speed * 22) * (hand?.held ? 0.6 : 1), now, 0.08);
    this.kQ.set(0.8 + 1.5 * k, now, 0.1);
    this.sp.place(local ?? [0, 0, -1], 0.5 * k * k, now, 0.15, 0.05);
  }
}

class AudioEngine implements GenesisAudio {
  private readonly opts: AudioOptions;
  private ctx: BaseAudioContext | null = null;
  private ownsContext = false;
  private vols: AudioVolumes;
  private readonly muteSync: MuteSync;
  private readonly rand: () => number;
  private readonly hrtf: boolean;
  private readonly probe = new SceneProbe();
  private readonly gate = new CueGate();
  private seen = new WeakSet<SimEvent>();
  private queue: SimEvent[] = [];
  private listener: ListenerState = { pos: [0, 0, 1e7], quat: [0, 0, 0, 1], planet: -1, altitude: 1e7 };
  private view: (SceneWorld & { star?: StarView }) | null = null;
  private scene: AudioScene | null = null;
  private probeT = 1;
  private visible = true;
  private unlockArmed = false;
  private stats = { heard: 0, played: 0, dropped: 0 };
  private duckUntil = 0;
  private musicHoldUntil = 0;
  private disposed = false;
  // graph (exists once a context does)
  private bank: BufferBank | null = null;
  private pool: VoicePool | null = null;
  private amb: Bus | null = null;
  private mus: Bus | null = null;
  private sfx: Bus | null = null;
  private duck: GainNode | null = null;
  private kDuck: Knob | null = null;
  private master: GainNode | null = null;
  private kMaster: Knob | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private ambience: Ambience | null = null;
  private emitters: Emitters | null = null;
  private music: MusicDirector | null = null;
  private handAir: HandAir | null = null;
  private hall: ConvolverNode | null = null;
  private starName = '';
  private readonly uiMix = new UiCueMixer<CueOptions>();
  private uiStats = { played: 0, early: 0 };
  /** interface cues waiting for the context to open (the gesture that unlocks it) */
  private early: { name: string; o: CueOptions; rule: UiCueRule; at: number }[] = [];
  private directLast = new Map<string, number>();
  private portalTarget: EventTarget | null = null;
  private onGesture = (): void => { void this.unlock(); };
  private onVisibility = (): void => { this.visibilityChanged(); };
  private onPortalMute = (e: Event): void => {
    const d = (e as CustomEvent<{ muted?: boolean }>).detail;
    const m = d && typeof d.muted === 'boolean' ? d.muted : this.muteSync.portalMuted();
    if (m != null && this.muteSync.fromPortal(m)) this.applyMaster();
  };

  constructor(o: AudioOptions) {
    this.opts = o;
    this.vols = { ...DEFAULT_VOLUMES, ...(o.volumes ?? {}) };
    const portal = (o.portal ?? !o.context) && typeof window !== 'undefined';
    this.muteSync = new MuteSync(!!o.muted, portal ? findPortal : () => null);
    if (portal) {
      this.portalTarget = window;
      window.addEventListener('mutechange', this.onPortalMute);
    }
    this.rand = rng(o.seed ?? ((Date.now() ^ Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) * 1000)) >>> 0));
    this.hrtf = (o.quality ?? 'high') === 'high';
  }

  get context(): BaseAudioContext | null { return this.ctx; }
  get muted(): boolean { return this.muteSync.muted; }

  // ───────────────────────────── lifecycle ─────────────────────────────

  async start(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.opts.context) {
      if (!this.ctx) this.attach(this.opts.context, false);
      return true;
    }
    if (!this.ctx) {
      // a context made before any user gesture starts suspended (and Chrome warns): wait for the first gesture
      const ua = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined;
      if (ua && !ua.hasBeenActive) { this.armUnlock(); return false; }
      this.createContext();
    }
    return this.unlock();
  }

  private createContext(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext({ latencyHint: this.opts.latencyHint ?? 'interactive' });
    this.attach(ctx, true);
  }

  private async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.ctx) this.createContext();
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx instanceof AudioContext && ctx.state !== 'running' && this.visible) {
      try { await ctx.resume(); } catch { /* not allowed yet */ }
    }
    const ok = !(ctx instanceof AudioContext) || ctx.state === 'running';
    if (ok) { this.disarmUnlock(); this.playEarly(); } else this.armUnlock();
    return ok;
  }

  private armUnlock(): void {
    if (this.unlockArmed) return;
    const tgt = this.opts.unlockTarget === undefined ? (typeof window !== 'undefined' ? window : null) : this.opts.unlockTarget;
    if (!tgt) return;
    this.unlockArmed = true;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) tgt.addEventListener(ev, this.onGesture, { capture: true, passive: true } as AddEventListenerOptions);
  }

  private disarmUnlock(): void {
    if (!this.unlockArmed) return;
    const tgt = this.opts.unlockTarget === undefined ? (typeof window !== 'undefined' ? window : null) : this.opts.unlockTarget;
    this.unlockArmed = false;
    if (!tgt) return;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) tgt.removeEventListener(ev, this.onGesture, { capture: true } as EventListenerOptions);
  }

  private visibilityChanged(): void {
    if (typeof document === 'undefined') return;
    this.visible = !document.hidden;
    const ctx = this.ctx;
    if (!(ctx instanceof AudioContext) || !this.kMaster) return;
    const now = ctx.currentTime;
    if (!this.visible) {
      this.kMaster.set(0, now, 0.05);
      setTimeout(() => { if (!this.visible && ctx.state === 'running') void ctx.suspend(); }, 300);
    } else {
      void ctx.resume().then(() => this.applyMaster());
    }
  }

  async suspend(): Promise<void> { if (this.ctx instanceof AudioContext) await this.ctx.suspend(); }
  async resume(): Promise<void> { await this.unlock(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disarmUnlock();
    this.portalTarget?.removeEventListener('mutechange', this.onPortalMute);
    this.portalTarget = null;
    this.early.length = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.music?.stop();
    this.emitters?.stop();
    this.ambience?.stop();
    this.pool?.stopAll();
    this.bank?.terminate();
    if (this.ownsContext && this.ctx instanceof AudioContext) void this.ctx.close();
    this.ctx = null;
  }

  // ───────────────────────────── the graph ─────────────────────────────

  private bus(ctx: BaseAudioContext, sum: AudioNode, hall: AudioNode, v: number): Bus {
    const input = ctx.createGain(), vol = ctx.createGain(), wetIn = ctx.createGain(), wetVol = ctx.createGain();
    vol.gain.value = v; wetVol.gain.value = v;
    input.connect(vol); vol.connect(sum);
    wetIn.connect(wetVol); wetVol.connect(hall);
    return { input, vol, wetIn, wetVol, kVol: new Knob(vol.gain), kWet: new Knob(wetVol.gain) };
  }

  private attach(ctx: BaseAudioContext, owned: boolean): void {
    this.ctx = ctx;
    this.ownsContext = owned;
    const bank = new BufferBank(ctx);
    this.bank = bank;
    this.pool = new VoicePool(ctx, this.hrtf ? 40 : 24);
    // master chain
    const sum = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.3;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 2; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.25;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(4096, 0.6, 0.97);
    clip.oversample = '2x';
    const master = ctx.createGain();
    master.gain.value = 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    sum.connect(glue); glue.connect(limiter); limiter.connect(makeup); makeup.connect(clip); clip.connect(master);
    master.connect(analyser);
    analyser.connect(ctx.destination);
    this.master = master;
    this.kMaster = new Knob(master.gain);
    this.analyser = analyser;
    this.meterBuf = new Float32Array(analyser.fftSize);
    // the hall: one synthesized impulse response shared by every bus (sends are post-fader)
    const hall = ctx.createConvolver();
    hall.normalize = false;
    // the hall's impulse response arrives from the DSP worker within the first frames (update() attaches it)
    hall.buffer = owned ? bank.get('ir-hall') : bank.need('ir-hall');
    this.hall = hall;
    const hallRet = ctx.createGain();
    hallRet.gain.value = 0.42;
    hall.connect(hallRet);
    hallRet.connect(sum);
    this.amb = this.bus(ctx, sum, hall, this.vols.ambience);
    this.sfx = this.bus(ctx, sum, hall, this.vols.sfx);
    // headroom: the catalog's recipes peak near full scale on their own; trimmed here they sit over the ambience and
    // music without leaning on the limiter (which would pump the whole mix on every slap)
    this.sfx.input.gain.value = 0.6;
    this.mus = this.bus(ctx, sum, hall, this.vols.music);
    // the music bus has a duck in front (big moments push the music back for a few seconds)
    this.duck = ctx.createGain();
    this.duck.connect(this.mus.input);
    this.kDuck = new Knob(this.duck.gain);
    const host = { play: (cue: string, o: PlayOpts) => this.play(cue, o), rand: this.rand };
    this.ambience = new Ambience(ctx, bank, this.amb.input, host, this.hrtf);
    this.emitters = new Emitters(ctx, bank, this.ambience.inputNode, {
      ...host,
      toLocal: (planet, body) => {
        const pv = this.planetOf(planet);
        return pv ? toLocal(pv, this.listener, body) : null;
      },
    }, this.hrtf, this.hrtf ? 10 : 6);
    this.music = new MusicDirector(ctx, bank, this.duck, this.mus.wetIn, this.rand);
    // a real context renders its textures in a worker (an offline one — tests, renders — warms synchronously)
    if (owned && typeof Worker !== 'undefined') {
      import('./dspspawn.ts').then((m) => { if (!this.disposed) bank.useWorker(m.spawnDspWorker()); }).catch(() => { /* main-thread pump */ });
    }
    bank.preload(PRELOAD);
    this.applyMaster();
    if (owned && (this.opts.pauseWhenHidden ?? true) && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.visible = !document.hidden;
    }
  }

  private applyMaster(): void {
    if (!this.ctx || !this.kMaster) return;
    const v = this.muteSync.muted || !this.visible ? 0 : Math.max(0, Math.min(1, this.vols.master));
    this.kMaster.set(v, this.ctx.currentTime, 0.08);
  }

  setVolumes(v: Partial<AudioVolumes>): void {
    for (const k of ['master', 'music', 'sfx', 'ambience'] as const) {
      const x = v[k];
      if (typeof x === 'number' && Number.isFinite(x)) this.vols[k] = Math.max(0, Math.min(1, x));
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [b, x] of [[this.amb, this.vols.ambience], [this.mus, this.vols.music], [this.sfx, this.vols.sfx]] as [Bus | null, number][]) {
      if (!b) continue;
      b.kVol.set(x, now, 0.05);
      b.kWet.set(x, now, 0.05);
    }
    this.applyMaster();
  }

  getVolumes(): AudioVolumes { return { ...this.vols }; }

  mute(on: boolean): void {
    this.muteSync.request(!!on);
    if (this.muteSync.muted) this.early.length = 0;
    this.applyMaster();
  }

  onMuteChange(cb: (muted: boolean) => void): () => void {
    return this.muteSync.subscribe(cb);
  }

  // ───────────────────────────── per frame ─────────────────────────────

  setListener(pose: ListenerPose, planet: number, altitude: number): void {
    const L = this.listener;
    L.pos = [pose.pos[0], pose.pos[1], pose.pos[2]];
    L.quat = [pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]];
    L.planet = Number.isFinite(planet) ? planet : (pose.planet ?? -1);
    L.altitude = Number.isFinite(altitude) ? altitude : 1e6;
  }

  private planetOf(id: number): ScenePlanet | undefined {
    const v = this.view;
    if (!v) return undefined;
    for (const p of v.planets) if (p.id === id) return p;
    return undefined;
  }

  private running(): boolean {
    const c = this.ctx;
    return !!c && !this.disposed && (!(c instanceof AudioContext) || c.state === 'running');
  }

  update(view: SceneWorld & { pendingEvents?: SimEvent[]; star?: StarView }, dtIn: number): void {
    if (this.disposed) return;
    this.view = view;
    const dt = Math.max(0, Math.min(0.25, Number.isFinite(dtIn) ? dtIn : 0));
    // hear the events the mirror holds (non-consuming; the toasts drain them after us)
    const pe = view.pendingEvents;
    if (pe && pe.length) for (const e of pe) this.onEvent(e);
    if (!this.running()) return;
    if (this.early.length) this.playEarly();
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const clock = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    this.bank!.pump(3, clock);
    if (this.hall && !this.hall.buffer && this.bank!.has('ir-hall')) this.hall.buffer = this.bank!.get('ir-hall');
    const star = view.star;
    if (star && star.name !== this.starName) { this.starName = star.name; this.music!.setStar(star.name); }
    this.probeT += dt;
    if (!this.scene || this.probeT >= PROBE_EVERY) {
      this.probeT = 0;
      try { this.scene = this.probe.probe(view, this.listener); } catch (err) { console.warn('[genesis audio] probe failed', err); }
    }
    const sc = this.scene;
    // the shore, re-projected with this frame's camera
    let coast: [number, number, number] | null = null;
    const pv = sc ? this.planetOf(sc.planet) : undefined;
    if (sc?.coastBody && pv) {
      const v = [0, 0, 0];
      rotate(pv.quat, sc.coastBody[0], sc.coastBody[1], sc.coastBody[2], v);
      rotateInv(this.listener.quat, v[0], v[1], v[2], v);
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      coast = [v[0] / l, v[1] / l, v[2] / l];
    }
    this.drainEvents();
    this.ambience!.update(sc, coast, star?.activity ?? 0, now, dt);
    this.emitters!.update(sc, now, dt);
    // the ignition holds the music back, then lets the orbital score rise out of it
    if (this.musicHoldUntil > 0) {
      const k = now < this.musicHoldUntil ? 0 : Math.min(1, (now - this.musicHoldUntil) / 6);
      this.music!.setMaster(k);
      if (k >= 1) this.musicHoldUntil = 0;
    }
    this.music!.update(sc, now);
    this.kDuck!.set(now < this.duckUntil ? 0.45 : 1, now, now < this.duckUntil ? 0.12 : 1.2);
    // the hand's air
    if (sc?.hand && pv) {
      if (!this.handAir && this.bank!.has('pink')) this.handAir = new HandAir(ctx, this.bank!, this.sfx!.input, this.hrtf);
      this.handAir?.update(sc.hand, toLocal(pv, this.listener, sc.hand.body), now, dt);
    } else this.handAir?.update(null, null, now, dt);
    this.pool!.prune(now);
  }

  // ───────────────────────────── one-shots ─────────────────────────────

  /** play a catalog cue into a destination (default: the sfx bus); returns its end time (0: dropped) */
  private play(cue: string, o: PlayOpts & { local?: number[]; spread?: number; amb?: boolean }): number {
    const ctx = this.ctx;
    if (!ctx || !this.pool || !this.bank || !this.sfx) return 0;
    const recipe = SFX[cue] ?? FALLBACK;
    let dest: AudioNode = o.dest ?? this.sfx.input;
    let sp: SpatialOut | null = null;
    if (!o.dest && o.local) {
      sp = new SpatialOut(ctx, this.sfx.input, this.hrtf);
      sp.placeAt(o.local, 1, o.t, o.spread ?? 0);
      dest = sp.input;
    }
    const v = this.pool.alloc(o.pri ?? 5, dest, o.t);
    if (!v) { sp?.dispose(); this.stats.dropped++; return 0; }
    if (sp) { const s = sp; v.extra.push({ disconnect: () => s.dispose() }); }
    v.out.gain.value = Math.max(0, Math.min(1.6, o.level));
    const wetIn = o.dest ? (this.amb?.wetIn ?? null) : this.sfx.wetIn;
    const s = new Sfx(ctx, this.bank, this.pool, v, wetIn, { t: o.t, size: o.size ?? 1, count: o.count ?? 1, variant: o.variant ?? '', rng: this.rand });
    try { recipe(s); } catch (err) { console.warn(`[genesis audio] cue '${cue}' failed`, err); }
    if (s.end > v.end) v.end = s.end;
    this.stats.played++;
    return s.end;
  }

  /**
   * Events are only queued here and placed in update(), after the frame's listener pose and planet frames are known:
   * a planet crosses kilometres of its orbit between frames (more at 1000x), so placing an event against last frame's
   * camera would put it in the wrong place. Callers may therefore pass events at any time (a snapshot handler).
   */
  onEvent(e: SimEvent): void {
    if (!e || typeof e !== 'object' || this.seen.has(e)) return;
    this.seen.add(e);
    this.stats.heard++;
    if (!this.running()) return;
    if (this.queue.length >= 512) this.queue.shift();
    this.queue.push(e);
  }

  private drainEvents(): void {
    if (!this.queue.length) return;
    const now = this.ctx!.currentTime;
    const q = this.queue;
    this.queue = [];
    for (const e of q) {
      const spec = cueFor(e);
      if (!spec) continue;
      const n = this.gate.admit(spec, now);
      if (!n) continue;
      this.placeAndPlay(spec, e.planet, e.pos, n, now);
    }
  }

  /** where and how loud a cue is heard from the listener, then play it */
  private placeAndPlay(spec: CueSpec, planet: number | undefined, pos: ArrayLike<number> | undefined, count: number, now: number, delayExtra = 0): void {
    const sc = this.scene;
    const alt = sc?.alt ?? this.listener.altitude;
    let level = spec.gain;
    let local: number[] | undefined;
    let dist = 0;
    let spread = 0;
    const samePlanet = planet != null && sc != null && planet === sc.planet;
    let p = pos;
    // a hand act without a place happens where the hand is
    if (!p && spec.cls === 'god' && spec.cue.startsWith('hand.') && this.view?.hand) {
      const h: HandView = this.view.hand;
      if (sc && h.planet === sc.planet) { p = h.pos; planet = h.planet; }
    }
    const pv = planet != null ? this.planetOf(planet) : undefined;
    if (p && pv && (planet === sc?.planet)) {
      const h = spec.cue === 'launch' ? 12 : spec.cue.startsWith('hand.') ? Math.max(1, this.view?.hand?.alt ?? 4) : 2;
      const loc = toLocal(pv, this.listener, bodyPoint(pv, p, h));
      local = [loc[0], loc[1], loc[2]];
      dist = loc[3];
    }
    const inAir = sc?.inAir ?? 0;
    switch (spec.cls) {
      case 'god':
        // the god always hears their own acts, placed where they happen
        level *= local ? Math.max(0.6, attenuate(dist, hearingRef(500, alt))) : 0.9;
        spread = 0.1;
        break;
      case 'world': {
        if (!local || !samePlanet) return;
        const big = spec.size > 50 || spec.cue === 'launch' || spec.cue === 'eruption' || spec.cue === 'quake';
        // no air, no sound — except what the ground carries
        const carrier = Math.max(inAir, big ? 0.25 : 0.05);
        level *= carrier * attenuate(dist, hearingRef(spec.reach, alt));
        if (level < 0.012) return;
        break;
      }
      case 'news':
        if (local && samePlanet) {
          level *= Math.max(0.3, attenuate(dist, hearingRef(spec.reach * 1.5, alt)));
          spread = dist > spec.reach ? 0.45 : 0.15;
        } else { level *= 0.28; local = undefined; }
        break;
      default:
        local = undefined;
    }
    const delay = spec.travel && local && dist > 120 && spec.cls === 'world' ? soundDelay(dist) : 0;
    const end = this.play(spec.cue, { t: now + 0.01 + delay + delayExtra, level, size: spec.size, count, variant: spec.variant, pri: spec.pri, local, spread });
    if (!end) return;
    if (spec.cue === 'thunder') this.ambience?.heardThunder();
    // big moments push the music back
    if ((spec.cue === 'impact' && spec.size > 40) || spec.cue === 'launch' || spec.cue === 'world.cracked' || spec.cue === 'world.erased' || spec.cue === 'eruption') {
      this.duckUntil = Math.max(this.duckUntil, now + delay + 3.5);
    }
  }

  cue(name: string, o: CueOptions = {}): void {
    if (this.disposed || typeof name !== 'string' || !name) return;
    if (isUiCue(name)) {
      // the interface: batched per task (one action → its most important cue), gated per cue in real time
      if (this.muteSync.muted) return;
      if ((o.delay ?? 0) > 0) {
        // deliberately scheduled (a sequence): not part of an action's batch, but still gated
        if (this.running() && this.uiMix.admit(name, wallSeconds())) this.playUi(name, o, uiRule(name));
        else this.uiMix.gated++;
        return;
      }
      if (this.uiMix.submit(name, o)) queueMicrotask(() => this.flushUi());
      return;
    }
    if (!this.running()) return;
    const wall = wallSeconds();
    if (wall - (this.directLast.get(name) ?? -Infinity) < DIRECT_GAP) return;
    this.directLast.set(name, wall);
    this.playDirect(name, o, name === 'ignition' ? 10 : 8);
  }

  /** the batch of interface cues one action raised: play its winner now, or hold it while the context opens */
  private flushUi(): void {
    if (this.disposed) return;
    const w = this.uiMix.flush(wallSeconds());
    if (!w) return;
    if (this.running()) { this.playUi(w.name, w.data, w.rule); return; }
    // the context is opening (the gesture that unlocks it is this very click or key) or waits for one
    if (this.muteSync.muted || (!this.ctx && !this.unlockArmed)) return;
    if (this.early.length >= 3) this.early.shift();
    this.early.push({ name: w.name, o: w.data, rule: w.rule, at: wallSeconds() });
  }

  private playEarly(): void {
    if (!this.early.length || !this.running()) return;
    const t = wallSeconds();
    const held = this.early;
    this.early = [];
    for (const e of held) {
      if (t - e.at > EARLY_HOLD) continue;
      this.uiStats.early++;
      this.playUi(e.name, e.o, e.rule);
    }
  }

  private playUi(name: string, o: CueOptions, rule: UiCueRule): void {
    this.uiStats.played++;
    this.playDirect(name, o, rule.pri);
  }

  private playDirect(name: string, o: CueOptions, pri: number): void {
    const now = this.ctx!.currentTime;
    const spec: CueSpec = {
      cue: name, cls: o.pos ? 'god' : 'ui', gain: o.level ?? 1, size: o.size ?? 1, pri,
      travel: false, reach: 1000, gap: 0, variant: o.variant ?? '',
    };
    if (name === 'ignition') {
      this.musicHoldUntil = now + 9;
      this.music?.setMaster(0);
      this.duckUntil = now + 9;
    }
    this.placeAndPlay(spec, o.planet ?? this.scene?.planet, o.pos, 1, now, Math.max(0, o.delay ?? 0));
  }

  cues(): string[] { return Object.keys(SFX).sort(); }

  warm(all = false): number {
    const bank = this.bank;
    if (!bank) return 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const names = [...PRELOAD];
    if (all) {
      names.push('work-stone', 'work-metal', 'work-machine');
      for (const inst of ['lyre', 'harp', 'pizz']) for (let m = 30; m <= 96; m += 6) names.push(`pluck:${inst}:${m}`);
    }
    for (const n of names) bank.need(n);
    if (this.hall && !this.hall.buffer) this.hall.buffer = bank.get('ir-hall');
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  lastScene(): AudioScene | null { return this.scene; }

  // ───────────────────────────── state ─────────────────────────────

  state(): AudioState {
    const ctx = this.ctx;
    let peak = 0, rms = 0;
    if (this.analyser && this.meterBuf && this.running()) {
      this.analyser.getFloatTimeDomainData(this.meterBuf);
      let s = 0;
      for (let i = 0; i < this.meterBuf.length; i++) { const v = this.meterBuf[i]; s += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
      rms = Math.sqrt(s / this.meterBuf.length);
    }
    const sc = this.scene;
    return {
      running: this.running(),
      context: ctx ? (ctx instanceof AudioContext ? ctx.state : 'offline') : this.unlockArmed ? 'waiting for a gesture' : 'none',
      sampleRate: ctx?.sampleRate ?? 0,
      time: ctx?.currentTime ?? 0,
      muted: this.muteSync.muted,
      volumes: { ...this.vols },
      voices: this.pool?.active ?? 0,
      dropped: this.pool?.dropped ?? 0,
      stolen: this.pool?.stolen ?? 0,
      emitters: this.emitters?.list() ?? [],
      beds: this.ambience?.activeBeds() ?? 0,
      layers: this.ambience?.levels() ?? {},
      music: this.music?.state() ?? { culture: '', players: [] },
      meter: { peak: Math.round(peak * 1000) / 1000, rms: Math.round(rms * 10000) / 10000 },
      bank: { ready: this.bank?.ready() ?? 0, pending: this.bank?.pending() ?? 0, renderMs: Math.round(this.bank?.renderMs ?? 0), worker: this.bank?.threaded ?? false },
      scene: sc ? { planet: sc.planet, alt: Math.round(sc.alt), space: sc.space, inAir: sc.inAir, airless: sc.airless, day: sc.day, temp: sc.temp } : null,
      events: { ...this.stats },
      portalMuted: this.muteSync.portalMuted(),
      ui: { played: this.uiStats.played, gated: this.uiMix.gated, early: this.uiStats.early },
    };
  }
}
