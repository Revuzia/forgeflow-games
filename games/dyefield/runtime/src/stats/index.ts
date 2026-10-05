// DYEFIELD — the Stats facade (_spec/CONTRACT_STATS.md §S1 / §S10 / §S11). The ONLY module main.ts imports.
//
//   import { createStats } from './stats/index.ts';
//   const stats = createStats({ uiRoot, version: app.version, dev: app.dev, statsDev: params.get('statsdev') === '1',
//     reduceMotion: () => settings.get().reduceMotion, sound: (s) => audio.ui(s) });
//   stats.start();                                                   // once, at boot: the first portal probe
//   hooks.matchBegin = (w, cfg, n) => stats.matchBegin(w, { kit: w.runners[0].kit, skill: cfg.skill, online: null, localPid: 0 });
//   hooks.simEvents  = (ev, w) => stats.events(ev, w);
//   hooks.matchAbandon = (w, why) => stats.matchAbandon(w, why);
//   new Menus(uiRoot, { …, career: stats.career })                  // §S10.3
//   // online (CONTRACT_ONLINE §O11.3): matchBegin(w, { kit, skill: room.skill, localPid, online: OnlineMatchInfo });
//   //   stats.onlineEnd('complete' | 'void' | 'dropped', OnlineFinal?) at the end / void / drop
//
// Every hook is wrapped in try/catch (a stats bug never stops a frame). Outside the portal every bridge call is a silent
// no-op; with blocked storage the store lives in memory. ?dev=1 without ?statsdev=1 → stats are OFF for the session (no
// record, no post, no store write; the CAREER panel still shows the stored career). window.__DF_STATS__ is always
// installed (read-only snapshots).

import type { SimEvent } from '../core/match/events.ts';
import type { MatchWorld } from '../core/match/world.ts';
import type { BeginInfo, CloudRecord, DisplayCareer, OnlineEndStatus, OnlineFinal, PortalState, StatsWorldView } from './types.ts';
import { StatsCore } from './core.ts';
import { browserEnv, type StatsEnv } from './portal.ts';
import { createCareerPanel, type CareerPanel } from './ui/career_panel.ts';
import { createToaster, type Toaster } from './ui/toast.ts';

export type { BeginInfo, OnlineMatchInfo, OnlineFinal, OnlineEndStatus, StatsWorldView, MatchRecord } from './types.ts';

/** compile-time proof that a MatchWorld IS a StatsWorldView (§S2.1: no adapter offline) — the INTEGRATION lines pass the
 *  Game's world straight to matchBegin / events / matchAbandon */
export const asStatsView = (w: MatchWorld): StatsWorldView => w;

export interface StatsOptions {
  uiRoot: HTMLElement;
  version: string;
  /** ?dev=1 */
  dev: boolean;
  /** ?statsdev=1 */
  statsDev: boolean;
  reduceMotion(): boolean;
  sound?(s: 'click'): void;
  /** tests only: a fake env (clock, storage, bridge); default = the page's */
  env?: StatsEnv;
}

export interface StatsHandle {
  /** once, at boot: the first portal probe (no-op when stats are off) */
  start(): void;
  /** a match world was created (offline: online = null, localPid = 0) */
  matchBegin(w: StatsWorldView, info: BeginInfo): void;
  /** this frame's drained sim events (read-only; nothing is kept) */
  events(ev: readonly SimEvent[], w: StatsWorldView): void;
  /** a match world is being discarded before its horn */
  matchAbandon(w: StatsWorldView | null, why: 'dispose' | 'restart'): void;
  /** §S9.1: the ONLY finalize of an online record */
  onlineEnd(status: OnlineEndStatus, fin?: OnlineFinal): void;
  /** the CAREER screen body for Menus (§S10.3) */
  readonly career: CareerPanel;
  readonly toaster: Toaster;
  readonly enabled: boolean;
  readonly portal: PortalState;
  readonly readOk: boolean;
  display(): DisplayCareer;
  /** __DF_STATS__.state() */
  state(): Record<string, unknown>;
  cloudPreview(): CloudRecord | null;
}

declare global {
  interface Window {
    __DF_STATS__?: {
      state(): Record<string, unknown>;
      career(): DisplayCareer;
      cloudPreview(): CloudRecord | null;
      toast(): ReturnType<Toaster['stats']>;
    };
  }
}

export function createStats(o: StatsOptions): StatsHandle {
  const enabled = !o.dev || o.statsDev;
  let toaster: Toaster | null = null;
  let panel: CareerPanel | null = null;
  const core = new StatsCore({
    env: o.env ?? browserEnv(),
    enabled,
    statsDev: o.statsDev,
    onUnlock: (a, xp) => toaster?.show(a, xp),
    onNote: (t) => toaster?.note(t),
    onChange: () => { try { if (panel && panel.el.isConnected) panel.update(); } catch { /* a redraw never throws out */ } },
  });
  toaster = createToaster(o.uiRoot, { reduceMotion: () => { try { return !!o.reduceMotion(); } catch { return false; } }, sound: o.sound });
  panel = createCareerPanel(core);

  const handle: StatsHandle = {
    start: () => core.guard(() => core.start()),
    matchBegin: (w, info) => core.matchBegin(w, info),
    events: (ev, w) => core.events(ev, w),
    matchAbandon: (w, why) => core.matchAbandon(w, why),
    onlineEnd: (status, fin) => core.onlineEnd(status, fin),
    career: panel,
    toaster,
    get enabled() { return core.enabled; },
    get portal() { return core.portal; },
    get readOk() { return core.readOk; },
    display: () => core.display(),
    state: () => ({ ...core.snapshot(), gameVersion: o.version }),
    cloudPreview: () => core.cloudPreview(),
  };

  try {
    const ro = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    window.__DF_STATS__ = {
      state: () => ro(handle.state()),
      career: () => ro(core.display()),
      cloudPreview: () => ro(core.cloudPreview()),
      toast: () => toaster!.stats(),
    };
  } catch { /* no window (never in the browser) */ }
  return handle;
}
