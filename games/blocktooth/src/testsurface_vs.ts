// BLOCKTOOTH ONLINE VS — the in-page test surface for VS (lane B-VIEW): `window.__BT__.newVs / .vs`.
//
//   __BT__.newVs({titan, biome, seed, bots, palette})   start a VS PRACTICE match (resolves when play has begun)
//   __BT__.vs.state()                                   the VS picture: phase, clock, seats, crown, ring, tenders, camera, follow mode
//   __BT__.vs.dom()                                     read-only DOM digest of the VS HUD (seat cards, banner, feed lines, plates, rail cards, stamps)
//   __BT__.vs.dev.*                                     DEV ONLY (?dev=1): set up state through app.mutate() like the solo cheats do:
//        jump(clockS)  level(slot, lv)  hp(slot, frac)  ko(slot, killer?)  eliminate(slot, killer?)  teleport(slot, x, z)
//        near(slot, dist)  tender(i, 'marker'|'live'|'paid')  owe(slot, n)  end(winner)  view(slot)  emit(rawEvent)
//   Cheats only SET UP state; the acceptance actions (picks, spectate, rematch) are real keys.

import type { App } from './game.ts';
import type { BiomeId, TitanId, World } from './core/types.ts';
import { BIOME_IDS, TITAN_IDS } from './core/types.ts';
import { rankForLevel } from './core/config.ts';
import { withPlayer } from './core/players.ts';
import { growToRank } from './titans/titansim.ts';
import { endMatch } from './vs/ko.ts';
import type { BotLevel } from './vs/types.ts';

export interface BtVsSeat {
  slot: number; titan: string; name: string; bot: boolean; level: number; rank: number; hp: number; maxHp: number; alive: boolean;
  eliminated: boolean; place: number; evictions: number; koCount: number; assists: number; score: number; x: number; z: number; height: number;
  rail: { open: boolean; offer: string[] | null; expireT: number; seq: number; pending: number };
  spawnProtT: number; clearedT: number; respawnT: number;
}
export interface BtVsState {
  phase: string; clock: number; view: number; local: number; mode: string; crown: number; winner: number;
  ring: { r: number; step: number; cx: number; cz: number };
  tenders: { gate: string; state: string; x: number; z: number }[];
  seats: BtVsSeat[];
  camera: { widen: number; dist: number; zoom: number };
}
export interface BtVsDom {
  seatCards: number; seatOrder: string[]; phaseText: string; clockText: string; bannerOn: boolean; bannerText: string;
  feed: string[]; plates: number; platesEdge: number; platesTiny: number; tchips: number; railCards: string[]; railOn: boolean;
  stampOn: boolean; stampText: string; specOn: boolean; warnOn: boolean; countText: string; countOn: boolean; mapBig: boolean;
}
export interface BtVsDev {
  jump(clockS: number): number;
  level(slot: number, lv: number): number;
  hp(slot: number, frac: number): number;
  ko(slot: number, killer?: number): boolean;
  eliminate(slot: number, killer?: number): boolean;
  teleport(slot: number, x: number, z: number): boolean;
  near(slot: number, dist: number): boolean;
  tender(i: number, state: 'marker' | 'live' | 'paid'): string;
  owe(slot: number, n?: number): number;
  end(winner: number): boolean;
  view(slot: number): number;
  /** push a raw SimEvent through the app's event routing (a view probe: no sim state changes) */
  emit(ev: Record<string, unknown>): boolean;
  /**
   * O-REPORT: stand in for the ONLINE layer's match context (App.vsReport) in a practice world: `humans` human seats at the start,
   * `uids` = the account id per seat (null = bot / guest). `humanSeats` (dev emulation) turns those bot seats into IDLE human seats
   * (bot = null) so the report sees a 2-human match like the online one would. null clears the context.
   */
  reportCtx(o: { matchId: string; humans: number; uids: (string | null)[]; humanSeats?: number[]; skip?: boolean } | null): boolean;
}
/** O-REPORT: what the match's result reporting did (read-only): the match id it filed under, the VS goals it earned, the portal's answer */
export interface BtVsReport {
  matchId: string;
  goals: string[];
  filing: { kind: string; already?: boolean; confirmed?: boolean; reports?: number | null; error?: string | null } | null;
  /** the local VS ledger (lifetime grind-goal counters + VS goals earned) */
  ledger: { matches: number; wins: number; done: string[] };
}
export interface BtVsSurface { state(): BtVsState | null; dom(): BtVsDom; report(): BtVsReport | null; dev?: BtVsDev }

function num(v: unknown, d: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

export function installVsSurface(app: App, dev: boolean): { newVs: (o: { titan?: string; biome?: string; seed?: number; bots?: string; palette?: number }) => Promise<void>; vs: BtVsSurface } {
  const vsw = (what: string): World => {
    const w = app.world;
    if (!w || w.mode !== 'vs' || !w.vs) throw new Error(`vs.${what}: no live VS match (screen=${app.screen})`);
    return w;
  };
  const devw = (what: string): World => {
    if (!dev) throw new Error(`vs.dev.${what}: cheats are disabled — open the page with ?dev=1`);
    return vsw('dev.' + what);
  };

  const state = (): BtVsState | null => {
    const w = app.world, f = app.vs;
    if (!w || !f || !w.vs) return null;
    const V = w.vs;
    const rig = app.cameraRig;
    return {
      phase: V.phase, clock: w.t - V.startT, view: w.view, local: f.local, mode: f.mode, crown: V.crown, winner: V.winner,
      ring: { r: V.ring.r, step: V.ring.step, cx: V.ring.cx, cz: V.ring.cz },
      tenders: V.tenders.map((t) => ({ gate: t.gate, state: t.state, x: t.x, z: t.z })),
      seats: w.players.map((p): BtVsSeat => ({
        slot: p.slot, titan: p.titanId, name: f.info.seats[p.slot] ? f.info.seats[p.slot].name : '?', bot: p.bot !== null,
        level: p.titan.level, rank: p.titan.rank, hp: p.titan.hp, maxHp: p.titan.maxHp, alive: p.titan.alive,
        eliminated: p.vs.eliminated, place: p.vs.place, evictions: p.vs.evictions, koCount: p.vs.koCount, assists: p.vs.assists, score: p.vs.score,
        x: p.titan.x, z: p.titan.z, height: p.titan.height,
        rail: { open: p.rail.open, offer: p.upgrades.offer ? p.upgrades.offer.slice() : null, expireT: p.rail.expireT, seq: p.rail.seq, pending: p.upgrades.pendingDrafts },
        spawnProtT: p.vs.spawnProtT, clearedT: p.vs.clearedT, respawnT: p.vs.respawnT,
      })),
      camera: { widen: rig.rivalWiden, dist: rig.distance, zoom: rig.zoom },
    };
  };

  const vis = (e: Element | null): boolean => !!e && (e as HTMLElement).getClientRects().length > 0;
  const txt = (e: Element | null): string => (e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const q = <T extends Element = HTMLElement>(sel: string): T[] => Array.from(document.querySelectorAll<T>(sel));
  const domDigest = (): BtVsDom => {
    const cards = q('[data-v2="vs-seat"]');
    const order = cards.map((c) => ({ s: c.getAttribute('data-slot') || '', o: Number((c as HTMLElement).style.order || 0) })).sort((a, b) => a.o - b.o).map((x) => x.s);
    const banner = document.querySelector('.bt-vs-banner');
    const stamp = document.querySelector('.bt-vs-stamp');
    const count = document.querySelector('.bt-vs-count');
    return {
      seatCards: cards.filter(vis).length, seatOrder: order,
      phaseText: txt(document.querySelector('.bt-vs-phase')), clockText: txt(document.querySelector('.bt-vs-clock')),
      bannerOn: !!banner && banner.classList.contains('on'), bannerText: txt(banner),
      feed: q('.bt-vs-line').map(txt),
      plates: q('.bt-vs-plate.on').length, platesEdge: q('.bt-vs-plate.on.edge').length, platesTiny: q('.bt-vs-plate.on.tiny').length,
      tchips: q('.bt-vs-tchip.on').length,
      railCards: q('[data-v2="rail-card"]').filter(vis).map((c) => (c.getAttribute('data-card') || '')),
      railOn: !!document.querySelector('.bt-vs-railbox.on'),
      stampOn: !!stamp && stamp.classList.contains('on'), stampText: txt(stamp),
      specOn: !!document.querySelector('.bt-vs-spec.on'), warnOn: !!document.querySelector('.bt-vs-warn.on'),
      countText: txt(count), countOn: !!count && count.classList.contains('on'),
      mapBig: !!document.querySelector('.bt-vs-mini.big'),
    };
  };

  const report = (): BtVsReport | null => {
    const f = app.vsFiling;
    if (!f) return null;
    const led = app.portal.vsLedger;
    return { matchId: f.matchId, goals: f.goals.slice(), filing: f.filing ? { ...f.filing } : null, ledger: { matches: led.matches, wins: led.wins, done: Object.keys(led.done).sort() } };
  };
  const surface: BtVsSurface = { state, dom: domDigest, report };
  if (dev) {
    const dv: BtVsDev = {
      jump(clockS) {
        const w = devw('jump');
        w.t = Math.max(0, w.vs!.startT + num(clockS, 0));
        return w.t - w.vs!.startT;
      },
      level(slot, lv) {
        const w = devw('level');
        const s = Math.floor(num(slot, 0));
        const P = w.players[s];
        if (!P || !P.titan.alive) return -1;
        const L = Math.max(1, Math.min(200, Math.floor(num(lv, 1))));
        if (L <= P.titan.level) return P.titan.level;
        app.mutate((ww) => withPlayer(ww, s, () => { growToRank(ww, rankForLevel(L), L); }));
        return P.titan.level;
      },
      hp(slot, frac) {
        const w = devw('hp');
        const P = w.players[Math.floor(num(slot, 0))];
        if (!P) return -1;
        P.titan.hp = Math.max(1, Math.min(1, num(frac, 1)) * P.titan.maxHp);
        return P.titan.hp;
      },
      ko(slot, killer) {
        const w = devw('ko');
        const P = w.players[Math.floor(num(slot, 0))];
        if (!P || !P.titan.alive || P.vs.eliminated) return false;
        const k = Math.floor(num(killer, -1));
        if (k >= 0 && k < w.players.length && k !== P.slot) P.vs.hits.push({ from: k, t: w.t, pct: 0.6 });
        P.titan.hp = 0;
        P.titan.alive = false;
        return true;
      },
      eliminate(slot, killer) {
        const w = devw('eliminate');
        const V = w.vs!;
        if (V.phase === 'countdown' || V.phase === 'open' || V.phase === 'takeover') w.t = V.startT + 430;
        return dv.ko(slot, killer);
      },
      teleport(slot, x, z) {
        const w = devw('teleport');
        const P = w.players[Math.floor(num(slot, 0))];
        if (!P) return false;
        const T = P.titan;
        T.x = T.px = num(x, T.x); T.z = T.pz = num(z, T.z);
        return true;
      },
      near(slot, dist) {
        const w = devw('near');
        const P = w.players[Math.floor(num(slot, 0))], me = w.players[w.view];
        if (!P || !me) return false;
        const T = P.titan, M = me.titan;
        const d = Math.max(1, num(dist, 40));
        // stand it SE-ish (toward the camera side) of the followed titan, clear of buildings is not guaranteed (dev only)
        T.x = T.px = M.x + d * 0.7; T.z = T.pz = M.z - d * 0.7;
        return true;
      },
      tender(i, st) {
        const w = devw('tender');
        const V = w.vs!;
        const T = V.tenders[Math.max(0, Math.min(V.tenders.length - 1, Math.floor(num(i, 0))))];
        const me = w.players[w.view].titan;
        if (st === 'marker') {
          T.state = 'marker'; T.markerT = w.t; T.x = me.x + 90; T.z = me.z - 90; T.spawnSlot = 0;
          app.mutate((ww) => { ww.events.push({ type: 'tenderMarker', gate: T.gate, x: T.x, z: T.z, leadS: 15, p: -1 }); });
        } else if (st === 'live') {
          if (T.markerT < 0) { T.markerT = w.t; T.x = me.x + 90; T.z = me.z - 90; }
          T.state = 'live'; T.spawnT = w.t;
          app.mutate((ww) => { ww.events.push({ type: 'tenderSpawn', gate: T.gate, x: T.x, z: T.z, p: -1 }); });
        } else {
          T.state = 'paid';
          app.mutate((ww) => { ww.events.push({ type: 'tenderPaid', gate: T.gate, shares: [0.5, 0.3, 0.2, 0], top: 0, p: -1 }); });
        }
        return T.state;
      },
      owe(slot, n = 1) {
        const w = devw('owe');
        const P = w.players[Math.floor(num(slot, 0))];
        if (!P) return -1;
        P.upgrades.pendingDrafts += Math.max(1, Math.floor(num(n, 1)));
        return P.upgrades.pendingDrafts;
      },
      end(winner) {
        const w = devw('end');
        const k = Math.floor(num(winner, 0));
        if (k < 0 || k >= w.players.length) return false;
        app.mutate((ww) => { endMatch(ww, k); });
        return true;
      },
      view(slot) {
        const w = devw('view');
        return app.vsSetViewDev(w, Math.floor(num(slot, 0)));
      },
      reportCtx(o) {
        const w = devw('reportCtx');
        if (o === null) { app.vsReport = null; return true; }
        if (!o || typeof o.matchId !== 'string') return false;
        for (const s of o.humanSeats ?? []) { const P = w.players[Math.floor(s)]; if (P) P.bot = null; }
        const uids = Array.isArray(o.uids) ? o.uids.slice(0, 4) : [];
        app.vsReport = { matchId: o.matchId, humans: Math.max(1, Math.min(4, Math.floor(num(o.humans, 1)))), uidsBySlot: () => uids.slice(), skip: o.skip ? () => true : undefined };
        return true;
      },
      emit(ev) {
        devw('emit');
        if (!ev || typeof ev.type !== 'string') return false;
        app.mutate((ww) => { ww.events.push(ev as unknown as Parameters<typeof ww.events.push>[0]); });
        return true;
      },
    };
    surface.dev = dv;
  }

  return {
    async newVs(o) {
      const c = app.choice;
      const titan = (typeof o.titan === 'string' && (TITAN_IDS as readonly string[]).includes(o.titan) ? o.titan : c.titan) as TitanId;
      const biome = (typeof o.biome === 'string' && (BIOME_IDS as readonly string[]).includes(o.biome) ? o.biome : c.biome) as BiomeId;
      const seed = Math.abs(Math.floor(num(o.seed, Math.floor(Math.random() * 0x7fffffff)))) >>> 0;
      const bots: BotLevel = o.bots === 'rookie' || o.bots === 'veteran' ? o.bots : 'regular';
      await app.startVs({ titan, biome, seed, bots, palette: Math.max(0, Math.min(2, Math.floor(num(o.palette, 0)))) });
    },
    vs: surface,
  };
}
