// DYEFIELD — audio entry point (CONTRACT_P6_11 §21). The ONE integration surface: createAudio().
// See ./README.md for where to call each method. Browser-only (WebAudio); the pure parts (router.ts, voices.ts,
// manifest.ts) run under node for _harness/probe_audio.ts.

import type { SimEvent } from '../core/match/events.ts';
import { AudioEngine } from './engine.ts';
import { AudioRouter } from './router.ts';
import type { AudioFrame, AudioOptions, AudioStats, AudioVolumes, GameAudio, HornKind, MusicCue, UiSound } from './types.ts';

export type { AudioFrame, AudioOptions, AudioStats, AudioVolumes, GameAudio, HornKind, MusicCue, UiSound } from './types.ts';
export type { AudioRunner, AudioProjectiles, AudioConveyor, ListenerPose, AudioMapId } from './types.ts';

export function createAudio(opts: AudioOptions = {}): GameAudio {
  const engine = new AudioEngine(opts.voiceLimit ?? 24);
  const router = new AudioRouter();
  if (opts.volumes) engine.setVolumes(opts.volumes);
  let unlocked = false;
  let disposed = false;
  let unlocking: Promise<void> | null = null;

  const unlock = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (!unlocking) {
      unlocking = engine.unlock().then(() => { unlocked = engine.ctx?.state === 'running'; if (!unlocked) unlocking = null; });
    }
    return unlocking;
  };

  // first gesture → unlock. CONTRACT_MOBILE M4: iOS Safari only resumes an AudioContext inside touchend / click (a
  // touchstart / pointerdown is too early there), so the release gestures are listened to as well. The listeners stay
  // installed: a gesture while the context is NOT running (iOS interrupts it for a call / Siri / another app's audio,
  // or a resume on returning to the tab was refused without a gesture) resumes it — a cheap state check otherwise.
  const gestures = ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click'] as const;
  const onGesture = (): void => {
    if (disposed) return;
    const st = engine.ctx?.state;
    if (unlocked && st === 'running') return;
    if (unlocked && st !== undefined && st !== 'running' && st !== 'closed') {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      unlocking = null;                           // re-arm: the context was interrupted after it had run
    }
    void unlock();
  };
  const hasWindow = typeof window !== 'undefined' && typeof addEventListener === 'function';
  const gestureOpts: AddEventListenerOptions = { capture: true, passive: true };
  if (hasWindow && opts.autoUnlock !== false) for (const g of gestures) addEventListener(g, onGesture, gestureOpts);

  // tab hidden → suspend the context (music and loops stop instead of droning behind another tab); visible again →
  // resume (M4; where the platform refuses that without a gesture, the next tap resumes it through onGesture)
  const onVis = (): void => {
    if (!unlocked) return;
    if (document.visibilityState === 'hidden') engine.suspend(); else engine.resume();
  };
  if (hasWindow && typeof document !== 'undefined' && opts.suspendWhenHidden !== false) document.addEventListener('visibilitychange', onVis);

  const api: GameAudio = {
    unlock,
    preload(): void { if (!disposed) engine.preload(); },
    setVolumes(v: Partial<AudioVolumes>): void { engine.setVolumes(v); },
    playMusic(cue: MusicCue, o?: { map?: string }): void { router.music(cue, o?.map, engine); },
    stopMusic(fadeS = 0.6): void { router.stopMusic(fadeS, engine); },
    onEvents(events: readonly SimEvent[], ctx: AudioFrame): void {
      router.onEvents(events, ctx, engine);
      engine.setListener(ctx.listener);
    },
    ui(kind: UiSound): void {
      if (!unlocked && kind !== 'hover') void unlock();     // hover is not a user activation; clicks / keys are
      router.ui(kind, engine);
    },
    horn(kind: HornKind): void { router.horn(kind, engine); },
    update(dt: number): void {
      router.update(dt, engine);
      engine.tick();
    },
    setPaused(paused: boolean): void {
      router.setPaused(paused);
      engine.setPaused(paused);
    },
    duck(seconds: number, music = 0.5, sfx = 0.6): void { engine.duck(seconds, music, sfx); },
    get unlocked(): boolean { return unlocked; },
    stats(): AudioStats {
      const p = engine.poolStats;
      return {
        unlocked, state: engine.ctx ? engine.ctx.state : 'none', cue: engine.cue, voices: engine.voices, peakVoices: p.peak,
        stolen: p.stolen, rejected: p.rejected, loops: engine.loopKeys, played: engine.played, playedBus: { ...engine.playedBus },
        counts: { ...router.counts }, loopStarts: { ...router.loopStarts },
        decoded: engine.decoded, errors: [...engine.errors], meter: engine.meterRead(), volumes: engine.volumes, paused: engine.isPaused,
        preloaded: engine.preloaded, codecs: { ...engine.codecs },
      };
    },
    dispose(): void {
      disposed = true;
      if (hasWindow) {
        for (const g of gestures) removeEventListener(g, onGesture, gestureOpts);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      }
      engine.dispose();
    },
  };
  return api;
}
