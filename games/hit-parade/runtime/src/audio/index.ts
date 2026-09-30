// HIT PARADE - audio entry point (CONTRACT s9, s16). The ONE integration surface: createAudio(). Adapted from dyefield
// audio/index.ts. Browser-only (WebAudio); the pure parts (router.ts, voices.ts, manifest.ts, seam.ts) run under node for
// _harness/probe_audio.ts.
//
// Call sites (game.ts / menus):
//   const audio = createAudio();                    // nothing is fetched yet; the first gesture unlocks + fetches the UI sprite
//   audio.music('menu'); audio.ui('move');          // menus (ui() from a click/key also unlocks)
//   audio.bout({ fighters, stage, mode, local, sfxNames: m.tab.sfx }); audio.preload();   // when a bout loads
//   audio.events(newEvents, readMatch(m), [readFighter(m, 0), readFighter(m, 1)]);         // every rendered frame
//   audio.setPaused(true|false); audio.bout(null); audio.music('results');                  // pause / leave / results

import { loadGameData } from '../core/data.ts';
import { AudioEngine } from './engine.ts';
import { MUSIC, SPRITES, type MusicCueId, type SpriteId } from './manifest.ts';
import { AudioRouter, boutContext } from './router.ts';
import type { AnnounceLine, AudioBout, AudioGameData, AudioOptions, AudioStats, AudioVolumes, FighterSnap, GameAudio, MatchSnap, SimEvent, Splatter } from './types.ts';

// CHANGED(AUDIO) P2 (CONTRACT s9.2.3): the move tables / stages / bonus-round objects come from the game data. game.ts
// does not pass it, so the audio reads loadGameData() itself (cached in core/data.ts: the same object the game built).
let dataCache: AudioGameData | null | undefined;
function gameData(): AudioGameData | null {
  if (dataCache === undefined) {
    try { dataCache = loadGameData(); } catch { dataCache = null; }
  }
  return dataCache;
}

export type { AnnounceLine, AudioBout, AudioGameData, AudioOptions, AudioStats, AudioVolumes, GameAudio, MusicCue, Splatter, UiCue } from './types.ts';

export function createAudio(opts: AudioOptions = {}): GameAudio {
  const engine = new AudioEngine(opts.voiceLimit ?? 28);
  const router = new AudioRouter();
  if (opts.volumes) engine.setVolumes(opts.volumes);
  let unlocked = false;
  let disposed = false;
  let unlocking: Promise<void> | null = null;
  let lastT = -1;
  let boutLoaded = false;
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

  const unlock = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (!unlocking) {
      unlocking = engine.unlock().then(() => { unlocked = engine.ctx?.state === 'running'; if (!unlocked) unlocking = null; });
    }
    return unlocking;
  };

  // first gesture -> unlock. iOS Safari only resumes an AudioContext inside touchend / click (touchstart / pointerdown is
  // too early there), so the release gestures are listened to as well. The listeners stay installed: a gesture while the
  // context is NOT running (iOS interrupts it for a call / Siri, or a resume after the tab returns was refused) resumes it.
  const gestures = ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click'] as const;
  const onGesture = (): void => {
    if (disposed) return;
    const st = engine.ctx?.state;
    if (unlocked && st === 'running') return;
    if (unlocked && st !== undefined && st !== 'running' && st !== 'closed') {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      unlocking = null;
    }
    void unlock();
  };
  const hasWindow = typeof window !== 'undefined' && typeof addEventListener === 'function';
  const gestureOpts: AddEventListenerOptions = { capture: true, passive: true };
  if (hasWindow && opts.autoUnlock !== false) for (const g of gestures) addEventListener(g, onGesture, gestureOpts);

  // tab hidden -> suspend (no music droning behind another tab); visible -> resume
  const onVis = (): void => {
    if (!unlocked) return;
    if (document.visibilityState === 'hidden') engine.suspend(); else engine.resume();
  };
  if (hasWindow && typeof document !== 'undefined' && opts.suspendWhenHidden !== false) document.addEventListener('visibilitychange', onVis);

  const preloadIds = (ids?: readonly string[]): void => {
    const list = ids && ids.length ? ids : ['sfx', 'crowd'];
    const out: (SpriteId | MusicCueId)[] = [];
    for (const id of list) {
      if (id in SPRITES) out.push(id as SpriteId);
      else {
        const cue = id in MUSIC ? (id as MusicCueId) : router.resolveMusic(id);
        if (cue) out.push(cue);
      }
    }
    engine.preload(out);
  };

  const api: GameAudio = {
    unlock,
    preload(ids?: readonly string[]): void { if (!disposed) preloadIds(ids); },
    events(ev: readonly SimEvent[], m: MatchSnap, f?: readonly [FighterSnap, FighterSnap]): void {
      if (disposed) return;
      if (!boutLoaded) { boutLoaded = true; preloadIds(); }      // integrator forgot preload(): the first bout frame starts it
      const t = now();
      const dt = lastT < 0 ? 0 : Math.min(0.25, t - lastT);
      lastT = t;
      router.onEvents(ev, m, f, engine);
      router.update(router.paused ? 0 : dt, engine);
      engine.tick();
    },
    music(cue: string | null): void {
      if (disposed) return;
      const c = router.music(cue, engine);
      if (c && !unlocked) engine.preload([c]);
    },
    ui(cue: string): void {
      if (disposed) return;
      if (!unlocked && cue !== 'hover' && cue !== 'move') void unlock();     // hover is not a user activation
      router.ui(cue, engine);
    },
    setVolumes(v: Partial<AudioVolumes>): void { engine.setVolumes(v); },
    bout(info: AudioBout | null): void {
      if (disposed) return;
      router.setBout(info, engine, info ? boutContext(info, info.data ?? gameData()) : null);
      boutLoaded = info !== null && boutLoaded;
      lastT = -1;
    },
    setPaused(paused: boolean): void {
      router.setPaused(paused);
      engine.setPaused(paused);
    },
    setSplatter(mode: Splatter): void { router.splatter = mode; },
    announce(line: AnnounceLine): void { if (!disposed) router.announce(line, engine); },
    get unlocked(): boolean { return unlocked; },
    stats(): AudioStats {
      engine.tick();
      const p = engine.poolStats;
      return {
        unlocked, state: engine.ctx ? engine.ctx.state : 'none', cue: engine.cue, voices: engine.voices, peakVoices: p.peak,
        stolen: p.stolen, rejected: p.rejected, loops: engine.loopKeys, played: engine.played, playedBus: { ...engine.playedBus },
        counts: { ...router.counts }, loopStarts: { ...router.loopStarts }, events: { ...router.events }, culled: { ...router.culled },
        decoded: engine.decoded, errors: [...engine.errors], unknown: [...router.unknown], meter: engine.meterRead(),
        volumes: engine.volumes, paused: engine.isPaused, crowd: Math.round(router.crowd * 1000) / 1000, preloaded: engine.preloaded,
        codecs: { ...engine.codecs },
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
