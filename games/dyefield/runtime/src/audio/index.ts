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

  // first gesture → unlock (the listeners remove themselves once the context runs)
  const gestures = ['pointerdown', 'keydown', 'touchstart'] as const;
  const onGesture = (): void => {
    void unlock().then(() => { if (unlocked) for (const g of gestures) removeEventListener(g, onGesture, true); });
  };
  const hasWindow = typeof window !== 'undefined' && typeof addEventListener === 'function';
  if (hasWindow && opts.autoUnlock !== false) for (const g of gestures) addEventListener(g, onGesture, true);

  // tab hidden → suspend the context (music and loops stop instead of droning behind another tab)
  const onVis = (): void => {
    if (!unlocked) return;
    if (document.visibilityState === 'hidden') engine.suspend(); else engine.resume();
  };
  if (hasWindow && typeof document !== 'undefined' && opts.suspendWhenHidden !== false) document.addEventListener('visibilitychange', onVis);

  const api: GameAudio = {
    unlock,
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
      };
    },
    dispose(): void {
      disposed = true;
      if (hasWindow) {
        for (const g of gestures) removeEventListener(g, onGesture, true);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      }
      engine.dispose();
    },
  };
  return api;
}
