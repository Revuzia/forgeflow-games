// WOBBLEHOARD app core: the frame loop and the glue between body, stage, audio, haptics, gestures, settings and save.
// DOM-free on purpose (no document/window at import time or in createApp), so the same code runs under node with the
// mocks in _harness/mocks.ts. main.ts composes the real modules and the DOM around it.
import type {
  DebugHook, Settings, SoftBodyLike, SoftEvent, SoftMetrics, SquishAudio, SquishVoiceHandle, StageLike, V3,
} from './contracts.ts';
import type { Genome, SquishyInstance } from './core/genome.ts';
import { encodeGenome, genomeEquals, genomeFromParam, pitchRatio } from './core/genome.ts';
import { clamp, mulberry32 } from './core/rng.ts';
import type { SettingsEnv, StorageLike } from './core/settings.ts';
import { detectEnv, loadSettings, safeLocalStorage, sanitizeSetting, sanitizeSettings, saveSettings } from './core/settings.ts';
import type { ProfileStore } from './core/save.ts';
import { createProfileStore } from './core/save.ts';
import type { GestureAction, Gestures, Slot } from './input/gestures.ts';
import { createGestures } from './input/gestures.ts';
import type { BodyHost } from './input/camera.ts';
import { createBodyHost } from './input/camera.ts';
import type { Haptics } from './input/haptics.ts';
import { createHaptics } from './input/haptics.ts';
import { nameForGenome } from './ui/names.ts';

/** Every feel constant of the shell in one place. */
export const TUNING = {
  maxDt: 1 / 20,
  /** a finger stays down at least this long in SIM time, so a sub-frame tap still reaches the body as a poke */
  minContactS: 0.09,
  orbitRadPerPx: 0.0075,
  /** sign of stage.orbit(dYaw, dPitch) for a drag right / drag down. stage.ts: "pass (dx * k, dy * k) of a pointer drag and the scene turns with the finger". */
  orbitSignYaw: 1,
  orbitSignPitch: 1,
  /** stage.zoom(delta): wheel notches in, stage units out */
  zoomGain: 1,
  panMax: 0.8,
  consecutiveFrameErrorsFatal: 5,
  recentEvents: 32,
} as const;

export type Phase = 'boot' | 'title' | 'play' | 'error';

export interface PointerIn {
  id: number;
  /** CSS px relative to the canvas, origin top-left */
  x: number;
  y: number;
  /** event timestamp (same clock as AppDeps.now). Omitted = now. */
  t?: number;
  button?: number;
  type?: 'mouse' | 'touch' | 'pen';
}

export interface InputPort {
  pointerDown(p: PointerIn): void;
  pointerMove(p: PointerIn): void;
  pointerUp(p: PointerIn): void;
  pointerCancel(id: number): void;
  /** mouse hover (eyes follow) without a press */
  hover(x: number, y: number): void;
  hoverEnd(): void;
  wheel(deltaPx: number): void;
  cancelAll(): void;
  /** keyboard orbit/zoom helpers (accessibility) */
  orbitBy(dxPx: number, dyPx: number): void;
  zoomBy(notches: number): void;
  /** where Space pokes (px), or null before the first frame */
  screenCentre(): { x: number; y: number } | null;
  isDown(id: number): boolean;
}

export interface LabApi {
  play(kind: 'poke' | 'squish' | 'release' | 'land' | 'pop' | 'blend'): void;
  holdStart(): void;
  holdEnd(): void;
}

export interface AppDeps {
  createBody(genome: Genome): SoftBodyLike;
  createStage(canvas: HTMLCanvasElement): StageLike;
  createAudio(): SquishAudio;
  /** handed to createStage; node tests omit it */
  canvas?: HTMLCanvasElement;
  /** null = no persistence at all. Default: localStorage (guarded). */
  storage?: StorageLike | null;
  /** ?genome= override. Previewed only, never written to the profile. */
  genome?: Genome;
  /** URL overrides (?float=1, ?quality=): applied on top of stored settings, not persisted until the player changes them. */
  overrides?: Partial<Settings>;
  muted?: boolean;
  env?: SettingsEnv;
  haptics?: Haptics;
  /** ms, monotonic. Default performance.now. Pointer timestamps and the gesture clock use it. */
  now?: () => number;
  raf?: (cb: (ts: number) => void) => number;
  caf?: (id: number) => void;
  postShot?: (name: string, dataUrl: string) => Promise<{ ok: boolean; path?: string }>;
  onFatal?: (err: unknown) => void;
  profile?: ProfileStore;
}

export interface App {
  readonly stage: StageLike;
  readonly audio: SquishAudio;
  readonly haptics: Haptics;
  readonly profile: ProfileStore;
  readonly input: InputPort;
  readonly lab: LabApi;
  readonly debug: DebugHook;
  readonly host: BodyHost;
  readonly body: SoftBodyLike;
  readonly settings: Settings;
  readonly genome: Genome;
  readonly instance: SquishyInstance;
  readonly name: string;
  readonly phase: Phase;
  readonly muted: boolean;
  readonly paused: boolean;
  readonly hidden: boolean;
  /** smoothed frames per second (dev overlay) */
  readonly fps: number;
  readonly viewport: { w: number; h: number };
  setPhase(p: Phase): void;
  start(): void;
  stop(): void;
  /** One loop iteration at rAF timestamp `ts` (ms). The rAF loop calls this; tests call it directly. */
  frame(ts: number): void;
  resize(w: number, h: number, dpr: number): void;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  toggleGravity(): void;
  toggleMute(): void;
  setMuted(m: boolean): void;
  setGenome(g: Genome): void;
  /** Resume the AudioContext from a user gesture (call synchronously inside the handler: iOS requirement). */
  unlockAudio(): void;
  /** Page visibility: hidden pauses sim + audio and releases every finger; visible resumes with no dt spike. */
  setHidden(h: boolean): void;
  pause(): void;
  resume(): void;
  onInteraction(cb: () => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
  onGenome(cb: (g: Genome, name: string) => void): () => void;
  onMute(cb: (muted: boolean) => void): () => void;
  onPhase(cb: (p: Phase) => void): () => void;
  dispose(): void;
}

interface Voice { handle: SquishVoiceHandle; mode: 'press' | 'pull'; prevStretch: number; stretchRate: number }
const NO_VOICES = (): Array<Voice | null> => [null, null];
const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);
const SETTING_KEYS = ['volume', 'squishBoost', 'haptics', 'shake', 'gravity', 'quality'] as const;

export function createApp(deps: AppDeps): App {
  const now = deps.now ?? (() => performance.now());
  const env = deps.env ?? detectEnv();
  const storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
  const profile = deps.profile ?? createProfileStore(storage);
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.caf ?? ((id) => cancelAnimationFrame(id));

  // ---- settings: `persisted` is what the player chose; `settings` adds the session-only URL overrides ----
  let persisted: Settings = loadSettings(storage, env);
  let settings: Settings = sanitizeSettings({ ...persisted, ...(deps.overrides ?? {}) }, persisted);
  const overridden = new Set<string>(Object.keys(deps.overrides ?? {}));
  let muted = !!deps.muted;
  let hiddenFlag = false;

  // ---- the squishy ----
  let genome: Genome = deps.genome ?? profile.profile.instance.genome;
  const instance = profile.profile.instance;
  const nameOf = (g: Genome): string => (genomeEquals(g, instance.genome) ? instance.name : nameForGenome(g));

  // ---- modules (construct in dependency order, undo on failure so a boot error leaks no GL context / AudioContext) ----
  const audio = deps.createAudio();
  const stage: StageLike = deps.createStage(deps.canvas as HTMLCanvasElement);
  let body: SoftBodyLike;
  try { body = deps.createBody(genome); stage.setBody(body, genome); } catch (e) { try { stage.dispose(); } catch { /* ignore */ } throw e; }
  const haptics = deps.haptics ?? createHaptics({ enabled: settings.haptics });

  // ---- state ----
  let phase: Phase = 'boot';
  let viewport = { w: 1, h: 1 };
  let simTime = 0;
  let stepCount = 0;
  let paused = false;
  let running = false;
  let rafId = 0;
  let lastTs: number | null = null;
  let virtualMs: number | null = null; // gesture clock while paused (deterministic stepping)
  let clockOffset = 0;
  let needsRender = true;
  let fpsEma = 60;
  let errStreak = 0;
  let pointerNdc: { x: number; y: number } | null = null;
  const evBuf: SoftEvent[] = [];
  const recent: SoftEvent[] = [];
  const voices = NO_VOICES();
  const fingerDown = [false, false];
  const grabActive = [false, false];
  const downAt = [0, 0];
  const fingerPan = [0, 0];
  const pendingUp: Array<{ at: number; why: 'tap' | 'release' } | null> = [null, null];
  const skipRelease = [-1, -1];
  const timers: Array<{ at: number; fn: () => void }> = [];
  const rng = mulberry32(0x57155);
  let labHold: { handle: SquishVoiceHandle; t0: number } | null = null;
  let applied: Partial<Settings> & { muted?: boolean } = {};
  const L = {
    interaction: new Set<() => void>(), settings: new Set<(s: Settings) => void>(), genome: new Set<(g: Genome, n: string) => void>(),
    mute: new Set<(m: boolean) => void>(), phase: new Set<(p: Phase) => void>(),
  };
  const fire = <T extends unknown[]>(set: Set<(...a: T) => void>, ...a: T): void => { for (const f of [...set]) { try { f(...a); } catch (e) { console.error(e); } } };

  const host = createBodyHost({ camera: () => stage.camera, body: () => body, viewport: () => viewport });
  const clockNow = (): number => (virtualMs !== null ? virtualMs : now() + clockOffset);
  const evTime = (t: number | undefined): number => (virtualMs !== null ? virtualMs : (t !== undefined && Number.isFinite(t) && Math.abs(t - now()) < 5000 ? t : now()) + clockOffset);
  const interact = (): void => fire(L.interaction);

  const panOfNdc = (x: number): number => clamp(x * TUNING.panMax, -TUNING.panMax, TUNING.panMax);
  const panOfPoint = (p: V3): number => { const n = host.ndcOf(p); return n ? panOfNdc(n.x) : 0; };
  const pitch = (): number => pitchRatio(genome);

  // ---------------------------------------------------------------- settings application
  function applySettings(force = false): void {
    const a = applied;
    const mutedNow = muted || (hiddenFlag && !audio.setPaused); // setPaused (suspend) is better; mute is the fallback
    if (force || a.volume !== settings.volume || a.squishBoost !== settings.squishBoost || a.muted !== mutedNow) {
      audio.setSettings({ master: settings.volume, squishBoost: settings.squishBoost, muted: mutedNow });
    }
    if (force || a.shake !== settings.shake) stage.setShakeScale(settings.shake);
    if (force || a.quality !== settings.quality) stage.setQuality(settings.quality);
    if (force || a.gravity !== settings.gravity) { body.gravity = settings.gravity; stage.setFloatMode(!settings.gravity); }
    if (force || a.haptics !== settings.haptics) haptics.setEnabled(settings.haptics);
    applied = { volume: settings.volume, squishBoost: settings.squishBoost, shake: settings.shake, quality: settings.quality, gravity: settings.gravity, haptics: settings.haptics, muted: mutedNow };
    needsRender = true;
  }

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) return;
    const v = sanitizeSetting(key, value, settings);
    settings = { ...settings, [key]: v };
    persisted = { ...persisted, [key]: v };
    overridden.delete(key);
    saveSettings(storage, persisted);
    applySettings();
    fire(L.settings, { ...settings });
  }

  // ---------------------------------------------------------------- voices
  function endVoice(f: number, fade?: number): void {
    const v = voices[f];
    if (!v) return;
    voices[f] = null;
    try { v.handle.end(fade); } catch (e) { console.error(e); }
  }
  function endAllVoices(fade?: number): void {
    endVoice(0, fade); endVoice(1, fade);
    if (labHold) { try { labHold.handle.end(fade); } catch { /* ignore */ } labHold = null; }
  }
  function startVoice(f: number, mode: 'press' | 'pull', at: V3): void {
    if (f !== 0 && f !== 1) return;
    if (!(fingerDown[f] || grabActive[f])) return; // the finger is already up: nothing to hold a voice for
    endVoice(f, 0.04);
    const handle = audio.squishStart({ pitch: pitch() * (mode === 'pull' ? 1.12 : 1), pan: panOfPoint(at) });
    if (!handle) return;
    fingerPan[f] = panOfPoint(at);
    voices[f] = { handle, mode, prevStretch: body.metrics.stretch, stretchRate: 0 };
  }
  function updateVoices(dt: number): void {
    const m = body.metrics;
    let rate = 0;
    for (let f = 0; f < 2; f++) {
      const v = voices[f];
      if (!v) continue;
      let comp: number;
      let r: number;
      if (v.mode === 'press') { comp = m.compression; r = m.compressionRate; }
      else {
        const raw = (m.stretch - v.prevStretch) / Math.max(dt, 1e-3);
        v.stretchRate += (clamp(raw, -12, 12) - v.stretchRate) * 0.35;
        v.prevStretch = m.stretch;
        comp = m.stretch; r = v.stretchRate;
      }
      if (Math.abs(r) > Math.abs(rate)) rate = r;
      try { v.handle.update({ compression: clamp01(comp), rate: Number.isFinite(r) ? r : 0, pan: fingerPan[f] }); } catch (e) { console.error(e); }
    }
    if (rate !== 0) haptics.squeeze(rate);
    if (labHold) {
      const k = clamp01((simTime - labHold.t0) / 1.2);
      try { labHold.handle.update({ compression: 0.15 + 0.8 * k, rate: 2.2 * (1 - k) + 0.3 * Math.sin(simTime * 18), pan: 0 }); } catch { /* ignore */ }
    }
  }
  /** a voice must never outlive its finger: release events are not guaranteed (no 'release' below 0.08 compression) */
  function sweepVoices(): void {
    for (let f = 0; f < 2; f++) if (voices[f] && !fingerDown[f] && !grabActive[f]) endVoice(f, 0.08);
  }

  // ---------------------------------------------------------------- scheduled one-shots (sim-time, so pause/step stay deterministic)
  function schedule(delayMs: number, fn: () => void): void { timers.push({ at: simTime + delayMs / 1000, fn }); }
  function runTimers(): void {
    for (let i = 0; i < timers.length;) {
      if (timers[i].at <= simTime) { const t = timers.splice(i, 1)[0]; try { t.fn(); } catch (e) { console.error(e); } } else i++;
    }
  }
  /** one to three bubble pops, 40-120 ms apart */
  function pops(n: number, at: V3, size: number): void {
    const pan = panOfPoint(at);
    let delay = 0;
    for (let i = 0; i < n; i++) {
      delay += 40 + rng() * 80;
      const sz = clamp01(size * (0.55 + rng() * 0.6));
      schedule(delay, () => { audio.pop({ size: sz, pitch: pitch(), pan }); haptics.pop(); });
    }
  }

  // ---------------------------------------------------------------- SoftEvent -> audio / haptics / shake / fx
  function handleEvent(ev: SoftEvent): void {
    const I = clamp01(ev.intensity);
    const f = ev.finger;
    switch (ev.kind) {
      case 'poke':
        profile.bump('pokes');
        audio.poke({ intensity: I, pitch: pitch(), pan: panOfPoint(ev.at) });
        haptics.poke();
        stage.shake(0.06 + 0.14 * I);
        break;
      case 'press':
        profile.bump('squishes');
        startVoice(f, 'press', ev.at);
        break;
      case 'release': {
        endVoice(f);
        if ((f === 0 || f === 1) && skipRelease[f] === stepCount) break; // the contact became a pull (or was cancelled): no bloop
        profile.bump('releases');
        audio.release({ compression: I, pitch: pitch(), pan: panOfPoint(ev.at) });
        haptics.release();
        stage.shake(0.15 + 0.5 * I);
        if (I > 0.5) {
          stage.spawnFx('bubbles', ev.at, I);
          pops(1 + Math.min(2, Math.floor(((I - 0.5) / 0.5) * 2.999)), ev.at, I);
        }
        break;
      }
      case 'land':
        audio.land({ intensity: I, pitch: pitch() });
        stage.spawnFx('dust', ev.at, I);
        if (I > 0.45) stage.spawnFx('ring', ev.at, I);
        stage.shake(0.1 + 0.4 * I);
        break;
      case 'grab':
        profile.bump('pulls');
        startVoice(f, 'pull', ev.at);
        break;
      case 'snap': {
        endVoice(f);
        profile.bump('releases');
        audio.release({ compression: I, pitch: pitch(), pan: panOfPoint(ev.at) });
        haptics.release();
        stage.shake(0.1 + 0.4 * I);
        if (I > 0.3) stage.spawnFx('bubbles', ev.at, I);
        if (I > 0.5) stage.spawnFx('glitter', ev.at, I);
        pops(1 + Math.min(2, Math.floor(I * 2.999)), ev.at, Math.max(0.4, I));
        break;
      }
    }
  }

  function drain(): void {
    evBuf.length = 0;
    body.drainEvents(evBuf);
    for (const ev of evBuf) {
      recent.push({ kind: ev.kind, at: { ...ev.at }, normal: { ...ev.normal }, intensity: ev.intensity, heldFor: ev.heldFor, finger: ev.finger });
      if (recent.length > TUNING.recentEvents) recent.shift();
      handleEvent(ev);
    }
    sweepVoices();
  }

  // ---------------------------------------------------------------- gesture actions -> body / stage
  function executeUp(slot: Slot, why: 'tap' | 'release' | 'pull' | 'cancel'): void {
    pendingUp[slot] = null;
    if (!fingerDown[slot]) return;
    fingerDown[slot] = false;
    if (why === 'pull' || why === 'cancel') skipRelease[slot] = stepCount + 1;
    body.fingerUp(slot);
  }

  function onAction(a: GestureAction): void {
    switch (a.type) {
      case 'fingerDown': {
        if (pendingUp[a.slot]) executeUp(a.slot, 'release');
        else if (fingerDown[a.slot]) executeUp(a.slot, 'cancel');
        if (grabActive[a.slot]) { grabActive[a.slot] = false; body.grabRelease(a.slot); }
        body.fingerDown(a.slot, { point: a.hit.point, normal: a.hit.normal, dir: a.hit.dir });
        fingerDown[a.slot] = true;
        downAt[a.slot] = simTime;
        fingerPan[a.slot] = panOfPoint(a.hit.point);
        break;
      }
      case 'fingerPressure': if (fingerDown[a.slot]) body.fingerPressure(a.slot, a.target); break;
      case 'fingerMove': if (fingerDown[a.slot]) { body.fingerMove(a.slot, a.point); fingerPan[a.slot] = panOfPoint(a.point); } break;
      case 'fingerUp':
        if (a.why === 'tap' || a.why === 'release') {
          if (simTime - downAt[a.slot] >= TUNING.minContactS) executeUp(a.slot, a.why);
          else pendingUp[a.slot] = { at: downAt[a.slot] + TUNING.minContactS, why: a.why };
        } else executeUp(a.slot, a.why);
        break;
      case 'grab':
        grabActive[a.slot] = true;
        fingerPan[a.slot] = panOfPoint(a.target);
        body.grab(a.slot, a.vertex, a.target);
        break;
      case 'grabMove': if (grabActive[a.slot]) { body.grabMove(a.slot, a.target); fingerPan[a.slot] = panOfPoint(a.target); } break;
      case 'grabRelease':
        if (grabActive[a.slot]) { grabActive[a.slot] = false; body.grabRelease(a.slot); }
        break;
      case 'orbit':
        stage.orbit(TUNING.orbitSignYaw * a.dx * TUNING.orbitRadPerPx, TUNING.orbitSignPitch * a.dy * TUNING.orbitRadPerPx);
        needsRender = true;
        break;
      case 'zoom':
        stage.zoom(a.delta * TUNING.zoomGain);
        needsRender = true;
        break;
      case 'gesture':
        interact();
        break;
    }
  }

  const gestures: Gestures = createGestures(host, onAction);

  // ---------------------------------------------------------------- the simulation step (shared by the rAF loop and debug.step)
  function flushPendingUps(): void {
    for (const s of [0, 1] as const) { const p = pendingUp[s]; if (p && simTime >= p.at) executeUp(s, p.why); }
  }

  function simStep(dt: number): void {
    gestures.update(clockNow());
    flushPendingUps();
    if (dt > 0) body.step(dt);
    simTime += dt;
    stepCount++;
    drain();
    runTimers();
    updateVoices(dt);
  }

  function present(dt: number): void {
    stage.update(dt, { time: simTime, pointerNdc });
    stage.render();
    needsRender = false;
  }

  function frame(ts: number): void {
    if (hiddenFlag) { lastTs = null; return; }
    if (paused) {
      if (needsRender) present(0);
      lastTs = null;
      return;
    }
    let dt = 1 / 60;
    if (lastTs !== null) {
      const raw = (ts - lastTs) / 1000;
      dt = clamp(Number.isFinite(raw) ? raw : 1 / 60, 0, TUNING.maxDt);
      if (raw > 0 && raw < 1) fpsEma += (1 / raw - fpsEma) * 0.1;
    }
    lastTs = ts;
    simStep(dt);
    present(dt);
  }

  function tick(ts: number): void {
    if (!running) return;
    rafId = raf(tick);
    try { frame(ts); errStreak = 0; } catch (e) {
      errStreak++;
      console.error(e);
      if (errStreak >= TUNING.consecutiveFrameErrorsFatal) { stop(); app.setPhase('error'); try { deps.onFatal?.(e); } catch { /* ignore */ } }
    }
  }

  function start(): void { if (running) return; running = true; lastTs = null; rafId = raf(tick); }
  function stop(): void { running = false; if (rafId) { try { caf(rafId); } catch { /* ignore */ } rafId = 0; } }

  // ---------------------------------------------------------------- pause / resume / hidden
  function releaseEverything(): void {
    gestures.cancelAll(clockNow());
    for (const s of [0, 1] as const) {
      if (grabActive[s]) { grabActive[s] = false; body.grabRelease(s); }
      if (fingerDown[s] || pendingUp[s]) executeUp(s, 'cancel');
    }
    endAllVoices(0.05);
    timers.length = 0;
    haptics.cancel();
  }

  function pause(): void {
    if (paused) return;
    paused = true;
    virtualMs = now() + clockOffset;
  }
  function resume(): void {
    if (!paused) return;
    paused = false;
    if (virtualMs !== null) clockOffset = virtualMs - now();
    virtualMs = null;
    lastTs = null; // no dt spike
  }

  function setHidden(h: boolean): void {
    if (h === hiddenFlag) return;
    hiddenFlag = h;
    if (h) releaseEverything();
    else lastTs = null;
    try { audio.setPaused?.(h); } catch { /* ignore */ }
    applySettings();
  }

  // ---------------------------------------------------------------- input port
  const input: InputPort = {
    pointerDown(p) {
      pointerNdc = { x: (p.x / Math.max(1, viewport.w)) * 2 - 1, y: 1 - (p.y / Math.max(1, viewport.h)) * 2 };
      if (phase !== 'play') return;
      gestures.pointerDown({ id: p.id, x: p.x, y: p.y, t: evTime(p.t), button: p.button ?? 0 });
    },
    pointerMove(p) {
      pointerNdc = { x: (p.x / Math.max(1, viewport.w)) * 2 - 1, y: 1 - (p.y / Math.max(1, viewport.h)) * 2 };
      if (phase !== 'play') return;
      gestures.pointerMove({ id: p.id, x: p.x, y: p.y, t: evTime(p.t) });
    },
    pointerUp(p) {
      if (p.type && p.type !== 'mouse') pointerNdc = null;
      if (phase !== 'play') return;
      gestures.pointerUp({ id: p.id, x: p.x, y: p.y, t: evTime(p.t) });
    },
    pointerCancel(id) { gestures.pointerCancel(id, clockNow()); },
    hover(x, y) { pointerNdc = { x: (x / Math.max(1, viewport.w)) * 2 - 1, y: 1 - (y / Math.max(1, viewport.h)) * 2 }; },
    hoverEnd() { pointerNdc = null; },
    wheel(deltaPx) { if (phase === 'play') gestures.wheel(deltaPx); },
    cancelAll() { gestures.cancelAll(clockNow()); },
    orbitBy(dx, dy) { if (phase === 'play') { interact(); onAction({ type: 'orbit', dx, dy }); } },
    zoomBy(n) { if (phase === 'play') { interact(); onAction({ type: 'zoom', delta: n, source: 'wheel' }); } },
    screenCentre: () => host.screenCentre(),
    isDown: (id) => gestures.isActive(id),
  };

  // ---------------------------------------------------------------- genome / mute / audio unlock
  function setGenome(g: Genome): void {
    releaseEverything();
    genome = g;
    body = deps.createBody(g);
    stage.setBody(body, g);
    body.gravity = settings.gravity;
    stage.setFloatMode(!settings.gravity);
    recent.length = 0;
    needsRender = true;
    fire(L.genome, g, nameOf(g));
  }

  function setMuted(m: boolean): void {
    if (m === muted) return;
    muted = m;
    applySettings();
    fire(L.mute, muted);
  }

  let audioRunningAt = -1e9;
  function unlockAudio(): void {
    try {
      const t = now();
      // stats() reads (and resets) the analyser peak, so only re-check a context we believe is running about once a second
      if (audio.ready && t - audioRunningAt < 1000) return;
      if (audio.ready && audio.stats().state === 'running') { audioRunningAt = t; return; }
      audioRunningAt = -1e9;
      const p = audio.unlock();
      if (p && typeof p.catch === 'function') p.catch(() => { /* blocked until a real gesture: retried on the next one */ });
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- lab + debug hook
  const lab: LabApi = {
    play(kind) {
      const I = 0.75;
      switch (kind) {
        case 'poke': audio.poke({ intensity: I, pitch: pitch() }); break;
        case 'release': audio.release({ compression: 0.8, pitch: pitch() }); break;
        case 'land': audio.land({ intensity: I, pitch: pitch() }); break;
        case 'pop': audio.pop({ size: 0.6, pitch: pitch() }); break;
        case 'blend': audio.blend({ durationS: 3 }); break;
        case 'squish': lab.holdStart(); schedule(1400, () => lab.holdEnd()); break;
      }
    },
    holdStart() {
      if (labHold) return;
      const handle = audio.squishStart({ pitch: pitch() });
      if (handle) labHold = { handle, t0: simTime };
    },
    holdEnd() {
      if (!labHold) return;
      const h = labHold.handle;
      labHold = null;
      try { h.end(); } catch { /* ignore */ }
    },
  };

  const px = (x: number, y: number): { x: number; y: number } => ({ x: x * viewport.w, y: y * viewport.h });
  const debugId = (id: number): number => -1 - id;
  const lastDebugPx: Record<number, { x: number; y: number }> = {};
  const postShot = deps.postShot ?? (async (name: string, dataUrl: string) => {
    const r = await fetch(`/__shot/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataUrl });
    return (await r.json()) as { ok: boolean; path?: string };
  });

  const debug: DebugHook = {
    version: 1,
    state() {
      const m: SoftMetrics = { ...body.metrics };
      return {
        phase, metrics: m, settings: { ...settings }, genome, genomeCode: encodeGenome(genome), fps: Math.round(fpsEma * 10) / 10,
        stage: stage.stats(), audio: audio.stats(), events: recent.map((e) => ({ ...e })), stateHash: body.stateHash(),
      };
    },
    pause,
    resume,
    step(dt = 1 / 60, n = 1) {
      if (!paused) pause();
      const steps = Math.max(0, Math.floor(n));
      const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, TUNING.maxDt) : 1 / 60;
      let acc = 0;
      for (let i = 0; i < steps; i++) {
        if (virtualMs !== null) virtualMs += h * 1000;
        simStep(h);
        acc += h;
        if (acc >= 0.05) { stage.update(acc, { time: simTime, pointerNdc }); acc = 0; }
      }
      stage.update(acc, { time: simTime, pointerNdc });
      stage.render();
      needsRender = false;
    },
    pointerDown(x, y, id = 0) {
      const p = px(x, y), gid = debugId(id);
      lastDebugPx[gid] = p;
      input.pointerDown({ id: gid, x: p.x, y: p.y, type: 'touch' });
    },
    pointerMove(x, y, id = 0) {
      const p = px(x, y), gid = debugId(id);
      lastDebugPx[gid] = p;
      input.pointerMove({ id: gid, x: p.x, y: p.y, type: 'touch' });
    },
    pointerUp(id = 0) {
      const gid = debugId(id);
      const p = lastDebugPx[gid];
      if (!p) return;
      input.pointerUp({ id: gid, x: p.x, y: p.y, type: 'touch' });
      delete lastDebugPx[gid];
    },
    setGenome(seedOrCode) { setGenome(genomeFromParam(String(seedOrCode))); },
    setSetting(key, value) { setSetting(key, value); },
    async shot(name) {
      try {
        stage.render();
        const url = stage.canvas.toDataURL('image/png');
        return await postShot(name, url);
      } catch { return { ok: false }; }
    },
    playSound(kind) { lab.play(kind); },
    bodyScreen() {
      const d = host.bodyScreen();
      return d ? { x: d.x / viewport.w, y: d.y / viewport.h, rPx: d.r } : null;
    },
  };

  // ---------------------------------------------------------------- the app object
  const app: App = {
    get stage() { return stage; },
    get audio() { return audio; },
    get haptics() { return haptics; },
    get profile() { return profile; },
    input, lab, debug, host,
    get body() { return body; },
    get settings() { return settings; },
    get genome() { return genome; },
    get instance() { return instance; },
    get name() { return nameOf(genome); },
    get phase() { return phase; },
    get muted() { return muted; },
    get paused() { return paused; },
    get hidden() { return hiddenFlag; },
    get fps() { return fpsEma; },
    get viewport() { return viewport; },
    setPhase(p) {
      if (p === phase) return;
      if (phase === 'play' && p !== 'play') releaseEverything();
      phase = p;
      fire(L.phase, p);
    },
    start, stop, frame,
    resize(w, h, dpr) {
      viewport = { w: Math.max(1, w), h: Math.max(1, h) };
      stage.resize(viewport.w, viewport.h, dpr);
      needsRender = true;
    },
    setSetting,
    toggleGravity() { setSetting('gravity', !settings.gravity); },
    toggleMute() { setMuted(!muted); },
    setMuted,
    setGenome,
    unlockAudio,
    setHidden,
    pause, resume,
    onInteraction(cb) { L.interaction.add(cb); return () => L.interaction.delete(cb); },
    onSettings(cb) { L.settings.add(cb); return () => L.settings.delete(cb); },
    onGenome(cb) { L.genome.add(cb); return () => L.genome.delete(cb); },
    onMute(cb) { L.mute.add(cb); return () => L.mute.delete(cb); },
    onPhase(cb) { L.phase.add(cb); return () => L.phase.delete(cb); },
    dispose() {
      stop();
      releaseEverything();
      profile.dispose();
      L.interaction.clear(); L.settings.clear(); L.genome.clear(); L.mute.clear(); L.phase.clear();
      try { stage.dispose(); } catch { /* ignore */ }
      try { audio.dispose?.(); } catch { /* ignore */ }
    },
  };

  applySettings(true);
  return app;
}

