// DYEFIELD — the online controller main.ts lazy-loads (CONTRACT_ONLINE §O10, §O11.2): the OnlineApi (net/api.ts), the
// LOBBY-UI screens + in-match overlays (net/ui), the driver that turns a room's match into a Game on this page, the stats
// seam (CONTRACT_STATS §S9.1), the page lifecycle online (a hidden HOST hands off; a hidden client sends 4 Hz neutral
// keep-alives; no pause online — ESC / PAUSE / blur / back open the match menu card), the dev params (?net ?netlag
// ?renderfps ?idlekick ?autopilot ?netdur — with ?dev=1 only) and window.__NET__. Nothing here is imported by the offline
// boot path: main.ts reaches it through a dynamic import() when PLAY ONLINE opens or a ?room= link arrives.

import type { Game, MatchConfig } from '../game.ts';
import type { RosterEntry } from '../core/match/roster.ts';
import type { GameNet } from './session.ts';

/** the MatchConfig of an online match (game.ts CHANGED(ONLINE) adds these fields; typed here so this module stands alone) */
export type OnlineMatchConfig = MatchConfig & { roster: RosterEntry[]; localPid: number; online: true };
/** the Game's online entry points (game.ts CHANGED(ONLINE)) */
type NetGame = Game & { attachNet(net: GameNet): void; adoptWorld(w: MatchWorld): void; renderEveryMs: number };
import type { MatchWorld } from '../core/match/world.ts';
import type { MapDef } from '../core/data.ts';
import type { MapGeometry } from '../core/mapgeo.ts';
import type { PhysicsWorld } from '../core/physics.ts';
import type { Painter } from '../core/paint/painter.ts';
import type { NavGraph } from '../core/bots/nav.ts';
import type { TeamId } from '../core/types.ts';
import { emptyIntent } from '../core/types.ts';
import { crewDef } from '../core/data.ts';
import { NetApi, type OnlineDriver, type OnlineGameHandle, type OnlineMatchLoad, type OnlineMode, type OnlineRule } from './api.ts';
import type { EndInfo } from './session.ts';
import { buildIdFrom, netBuild } from './proto.ts';
import { installNetSurface } from './devsurface.ts';
import { createOnlineUi, type OnlineUi, type ProfileLike } from './ui/index.ts';

/** the stats facade calls the online layer makes (CONTRACT_STATS §S9.1); structural, so stats/ is not imported here */
export interface StatsSeam {
  matchBegin(w: MatchWorld, info: { kit: string; skill: 'breeze' | 'swell' | 'storm'; online: { matchId: string; localPid: number; role: 'host' | 'client'; skill: 'breeze' | 'swell' | 'storm' } | null; localPid: number }): void;
  onlineEnd(status: 'complete' | 'void' | 'dropped', fin?: { result: NonNullable<EndInfo['result']>; humans: number; me: { seatedLiveTicks: number; painted: number; washes: number; washedCount: number } | null }): void;
}

/** the live parts of the online match's session (main.ts startSession) */
export interface OnlineSessionParts {
  game: Game;
  arena: { def: MapDef; geo: MapGeometry; physics: PhysicsWorld; painter: Painter; nav: NavGraph; paint: { rebuildAll(): void }; minimap: { rebuild(): void } };
  players: { rename(id: number, name: string, status?: 'human' | 'bot' | 'away'): void };
  hud: { rename(id: number, name: string): void; redrawMinimapNow(): void; slates: { victoryCardEl: HTMLElement | null } };
}

export interface OnlineEnv {
  uiRoot: HTMLElement;
  version: string;
  /** import.meta.url of the entry chunk (assets/index-<hash>.js → the BUILD_ID) */
  entryUrl: string;
  dev: boolean;
  params: URLSearchParams;
  profile: ProfileLike & { get(): Readonly<{ name: string; kit: string; crew: number; mode: string; rule: string; ffaColor: number }> };
  /** 'kbm' | 'touch' now */
  device(): 'kbm' | 'touch';
  sound(s: 'hover' | 'click' | 'back' | 'start'): void;
  menus: { returnFromOnline(): void; hideAll(): void; showPause(msg?: string): void; open(s: 'settings' | 'howto'): void };
  /** load the arena + start the online match's session (the loading card meanwhile); play begins at once (touch / lock) */
  loadMatch(cfg: OnlineMatchConfig, map: string, preset: string): Promise<OnlineSessionParts>;
  /** back to the lobby backdrop; `online` → leave the menus hidden (the online screens stay up) */
  toLobby(online: boolean): Promise<void>;
  playOffline(mode: OnlineMode, rule: OnlineRule): void;
  /** the lobby Game's mean sim ms per tick (0 = unknown) */
  lobbySimMs(): number;
  stats: StatsSeam | null;
}

export interface OnlineController {
  readonly api: NetApi;
  readonly ui: OnlineUi;
  /** open PLAY ONLINE (optionally JOIN ROOM pre-filled) */
  open(join?: string): void;
  /** Game hook: the match menu card up / down */
  netMenu(on: boolean): void;
  /** Game hook: the victory slate showed (online: the REMATCH / PLAY AGAIN / LEAVE controls) */
  victory(el: HTMLElement | null): boolean;
  /** an online match is running on this page */
  inMatch(): boolean;
  /** QUIT / LEAVE MATCH from anywhere: leave the room, back to the lobby */
  leaveMatch(): void;
  /** the stats matchBegin info of the online match being built (main.ts's Game.matchBegin hook); null offline */
  beginInfo(w: MatchWorld): { kit: string; skill: 'breeze' | 'swell' | 'storm'; online: { matchId: string; localPid: number; role: 'host' | 'client'; skill: 'breeze' | 'swell' | 'storm' }; localPid: number } | null;
  dispose(): void;
}

const ALL_KEYS = ['net', 'netlag', 'renderfps', 'idlekick', 'autopilot', 'netdur'];

export function createOnline(env: OnlineEnv): OnlineController {
  const p = env.params;
  const devOn = env.dev;
  const num = (k: string): number | undefined => {
    if (!devOn || !p.has(k)) return undefined;
    const v = Number(p.get(k));
    return Number.isFinite(v) ? v : undefined;
  };
  // ?net= works on localhost only (§O10)
  let relay: string | undefined;
  if (devOn && p.get('net')) {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') relay = p.get('net') ?? undefined;
  }
  const renderFps = num('renderfps');
  void ALL_KEYS;

  let parts: OnlineSessionParts | null = null;
  let load: OnlineMatchLoad | null = null;
  let localPid = 0;
  let keepAliveT = 0;

  const driver: OnlineDriver = {
    load: async (spec) => {
      load = spec;
      localPid = spec.localPid;
      const prof = env.profile.get();
      const cfg: OnlineMatchConfig = {
        kit: spec.kit, skill: spec.skill, seed: spec.seed >>> 0, durationS: spec.durationS, humanName: prof.name || undefined,
        crew: spec.roster[spec.localPid]?.team as TeamId, devBrush: false, ...(spec.mode === 'ffa' ? { mode: 'ffa' as const } : {}),
        ...(spec.rule === 'washout' ? { rule: 'washout' as const } : {}), roster: spec.roster, localPid: spec.localPid, online: true,
      };
      // the stats seam: every online match start (CONTRACT_STATS §S9.1); a migration repeats it with the same matchId
      pendingBegin = spec;
      parts = await env.loadMatch(cfg, spec.map, spec.preset);
      const g = parts.game as NetGame;
      if (renderFps && renderFps > 0) g.renderEveryMs = 1000 / renderFps;
      ui.hud.attach();
      const P = parts;
      const h: OnlineGameHandle = {
        world: g.world,
        arena: { def: P.arena.def, geo: P.arena.geo, physics: P.arena.physics, painter: P.arena.painter, nav: P.arena.nav },
        attach: (net) => g.attachNet(net),
        adopt: (w) => g.adoptWorld(w),
        courtReload: () => { P.arena.paint.rebuildAll(); P.arena.minimap.rebuild(); P.hud.redrawMinimapNow(); },
        renamed: (id, n, st) => { P.players.rename(id, n, st); P.hud.rename(id, n); },
      };
      return h;
    },
    ended: (e, spec, me) => {
      const st = env.stats;
      ui.hud.detach();
      if (!st) return;
      try {
        if (e.status === 'void') st.onlineEnd('void');
        else if (e.status === 'dropped') st.onlineEnd('dropped');
        else if (e.result) {
          const humans = e.runners.filter((r) => r.seat?.human === true).length;
          const mine = e.runners.find((r) => r.id === me)?.seat ?? null;
          st.onlineEnd('complete', {
            result: e.result, humans,
            me: mine ? { seatedLiveTicks: mine.liveTicks, painted: mine.painted, washes: mine.washes, washedCount: mine.washedCount } : null,
          });
        }
      } catch (er) { console.warn('[dyefield/net] stats onlineEnd', er); }
      void spec;
    },
    toLobby: () => { ui.hud.detach(); ui.hud.hidePost(); parts = null; void env.toLobby(true); },
    playOffline: (mode, rule) => env.playOffline(mode, rule),
    simMs: () => env.lobbySimMs() || 4,
    device: () => env.device(),
    migrated: (w, spec, role) => {
      // the same match continues on a new host: the stats record swaps its view (a continuation, never an abandon)
      try { env.stats?.matchBegin(w, { kit: w.runners[spec.localPid]?.kit ?? spec.kit, skill: spec.skill, online: { matchId: spec.matchId, localPid: spec.localPid, role, skill: spec.skill }, localPid: spec.localPid }); }
      catch (er) { console.warn('[dyefield/net] stats matchBegin (migration)', er); }
    },
  };

  /** the online match the Game's own matchBegin hook should report (main.ts asks onlineBegin()) */
  let pendingBegin: OnlineMatchLoad | null = null;

  const api = new NetApi({
    relay, driver,
    build: netBuild(env.version, buildIdFrom(env.entryUrl)),
    dev: devOn ? { netlag: num('netlag'), idlekick: num('idlekick'), autopilot: num('autopilot') ?? null, netdur: num('netdur') } : {},
  });

  const ui = createOnlineUi(env.uiRoot, {
    api, profile: env.profile,
    screens: {
      close: () => env.menus.returnFromOnline(),
      playOffline: (mode, rule) => { api.leave(false); env.playOffline(mode, rule); },
      matchPhase: (phase) => {
        // back on the room screen (a code room's PLAY AGAIN) or an error mid-match: the lobby backdrop behind the screens
        if (phase === null && parts) { parts = null; ui.hud.detach(); ui.hud.hidePost(); void env.toLobby(true); }
      },
      sound: (s) => env.sound(s),
    },
    hud: {
      resume: () => { parts?.game.resume(); },
      settings: () => { env.menus.showPause(''); env.menus.open('settings'); },
      howto: () => { env.menus.showPause(''); env.menus.open('howto'); },
      leaveMatch: () => ctl.leaveMatch(),
      leavePost: () => { parts = null; ui.hud.hidePost(); void env.toLobby(true).then(() => ui.screens.open()); },
      crewOf: (runner) => {
        const g = parts?.game;
        const r = g?.world.runners[runner];
        if (!r) return null;
        try { const c = crewDef(g!.matchMode, r.team); return { mark: c.markGlyph, dye: c.dye }; } catch { return null; }
      },
      sound: (s) => env.sound(s),
    },
  });
  installNetSurface(api);

  // ── the page lifecycle online (§O6.2, §O5.2, §O10)
  const neutral = emptyIntent();
  const onVisibility = (): void => {
    const s = api.session;
    if (!s) return;
    if (document.visibilityState === 'hidden') {
      if (s.role === 'host') { s.handoff(); return; }                  // a hidden host hands off at once
      // a hidden client keeps its seat with 4 Hz neutral keep-alives (browsers clamp hidden timers to ≥ 1 s: fine)
      clearInterval(keepAliveT);
      keepAliveT = window.setInterval(() => {
        const c = api.session?.client;
        if (c) { c.focusLost = true; neutral.yaw = c.lastIntent.yaw; neutral.pitch = c.lastIntent.pitch; c.keepAlive(neutral); }
      }, 250);
    } else {
      clearInterval(keepAliveT);
      keepAliveT = 0;
      const c = api.session?.client;
      if (c) c.focusLost = false;
    }
  };
  const onPageHide = (): void => { const s = api.session; if (s && s.role === 'host') s.handoff(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  const ctl: OnlineController = {
    api, ui,
    open: (join?: string) => {
      env.menus.hideAll();
      ui.screens.open(join ? { join } : {});
    },
    netMenu: (on) => { if (on) ui.hud.showMenu(); else ui.hud.hideMenu(); },
    victory: (el) => {
      if (!parts || !el) return false;
      const st = api.status();
      if (st.kind === 'room') ui.hud.showPost(st.room, parts.hud.slates.victoryCardEl);
      return true;
    },
    inMatch: () => !!parts && !!api.session,
    leaveMatch: () => {
      ui.hud.detach();
      ui.hud.hidePost();
      parts = null;
      api.leave(false);
      void env.toLobby(true).then(() => ui.screens.open());
    },
    beginInfo: (w) => {
      const b = pendingBegin;
      if (!b) return null;
      return { kit: w.runners[b.localPid]?.kit ?? b.kit, skill: b.skill, online: { matchId: b.matchId, localPid: b.localPid, role: b.role, skill: b.skill }, localPid: b.localPid };
    },
    dispose: () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      clearInterval(keepAliveT);
      ui.dispose();
    },
  };
  void localPid;
  return ctl;
}
