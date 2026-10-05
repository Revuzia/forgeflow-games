// DYEFIELD — the per-match recorder (_spec/CONTRACT_STATS.md §S2 + §S9). THREE-free, DOM-free.
//
// Game hooks in → one Outcome out (a finalized MatchRecord — eligible or idle —, an abandon, or a voided online match).
// The recorder only READS the world view and the drained events: it copies the few numbers it needs and never keeps a
// reference to the events array or its objects.
//
// Lifecycle (§S2.3):
//   begin(view, info)   opens a record. A second begin while one is open and not ended abandons it — unless it is an
//                       online continuation (same online.matchId: a host migration swapped the world; the view is swapped,
//                       every counter kept). Belt and braces: an offline record whose view says 'ended' is finalized
//                       first.
//   events(ev, view)    'phase' live stamps the live tick; 'phase' ended finalizes an OFFLINE record. washed / hit /
//                       special start / sub throw feed streaks, splashdowns, specials, subs. After every batch an offline
//                       record whose view says 'ended' is finalized even if its 'ended' event was never seen.
//   abandon(view, why)  QUIT / LOBBY / a failed session / a restart before the horn → abandoned (finalized first if the
//                       view already says 'ended').
//   onlineEnd(status, fin)  the ONLY finalize of an online record (§S9.1): 'complete' (fin required), 'void', 'dropped'.
//
// Exact clock (§S2.1): liveTick = round(countdownS / TICK); horn → liveS = durationS; limit → (tick − liveTick) × TICK at
// the drain that carried 'ended' (≤ 4 ticks late). Online: liveS = my seat's seated live ticks × TICK.

import { TICK } from '../core/config.ts';
import { WASHOUT } from '../core/match/world.ts';
import type { MatchResult } from '../core/match/world.ts';
import type { SimEvent } from '../core/match/events.ts';
import type { BeginInfo, MatchRecord, OnlineEndStatus, OnlineFinal, Outcome, StatsWorldView } from './types.ts';
import { scoreRecord } from './score.ts';

export const MIN_LIVE_S = 60;
export const MIN_PAINT_M2 = 100;
const SEA_CREDIT_TICKS = Math.round(WASHOUT.seaCreditS / TICK);

export interface RecorderOptions {
  /** ?statsdev=1: the 60 s rule is waived and records carry dev: true */
  statsDev: boolean;
  sink: (o: Outcome) => void;
  now?: () => number;
  /** 8-char base36 record id */
  newId?: () => string;
}

interface OpenRecord {
  id: string;
  view: StatsWorldView;
  info: BeginInfo;
  liveTick: number | null;
  specials: number;
  subs: number;
  splashdowns: number;
  streak: number;
  bestStreak: number;
  /** victim id → the last foe who hit it and the tick (TURF splashdown credit) */
  lastHit: Map<number, { by: number; tick: number }>;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

export function randomId(len = 8, rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(rnd() * 36).toString(36);
  return s;
}

/** my crew's result / place / crews / turf % / crew score from a MatchResult (§S2.2) */
export function resultFor(res: MatchResult, myTeam: number, mode: 'teams' | 'ffa', rule: 'turf' | 'washout'):
  { result: 'win' | 'loss' | 'draw'; place: number; crews: number; turfPct: number; crewScore: number } {
  const tied = res.tied ?? [];
  let result: 'win' | 'loss' | 'draw';
  if (res.winner === myTeam) result = 'win';
  else if (res.winner === 0 && (mode === 'teams' || tied.includes(myTeam))) result = 'draw';
  else result = 'loss';
  const standings = res.standings ?? [];
  let place: number, crews: number;
  if (mode === 'teams') {
    place = result === 'loss' ? 2 : 1;
    crews = standings.length || 2;
  } else {
    const mine = standings.find((s) => s.crew === myTeam);
    const shares = res.shares ?? [];
    place = mine ? mine.rank : 1 + standings.filter((s) => s.share > (shares[myTeam] ?? 0)).length;
    crews = standings.length || 8;
  }
  const share = res.shares?.[myTeam] ?? (myTeam === 1 ? res.sun : myTeam === 2 ? res.gulf : 0);
  const crewScore = rule === 'washout' ? (res.scores?.[myTeam] ?? 0) : 0;
  return { result, place, crews, turfPct: r1((share || 0) * 100), crewScore };
}

/** §S2.4 rules 2–3 (rule 1 = a natural ending, rule 4 = stats enabled, rule 5 = online status: the callers) */
export function participationOk(rec: Pick<MatchRecord, 'liveS' | 'paintedM2' | 'washes'>, statsDev: boolean): boolean {
  if (!statsDev && !(rec.liveS >= MIN_LIVE_S)) return false;
  return rec.paintedM2 >= MIN_PAINT_M2 || rec.washes >= 1;
}

export class MatchRecorder {
  private o: RecorderOptions;
  private cur: OpenRecord | null = null;
  private now: () => number;
  private newId: () => string;

  constructor(o: RecorderOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
    this.newId = o.newId ?? (() => randomId(8));
  }

  /** the open record's id (null when none) — read-backs only */
  get openId(): string | null { return this.cur ? this.cur.id : null; }
  get openOnline(): boolean { return !!this.cur?.info.online; }

  begin(view: StatsWorldView, info: BeginInfo): void {
    const c = this.cur;
    if (c) {
      if (info.online && c.info.online && c.info.online.matchId === info.online.matchId) {
        // host migration: the same match continues on a new world (§S2.3, §S9.1)
        c.view = view;
        c.info = { ...info, online: { ...info.online } };
        return;
      }
      this.closeOpen();
    }
    this.cur = {
      id: this.newId(), view, info: { ...info, online: info.online ? { ...info.online } : null },
      liveTick: null, specials: 0, subs: 0, splashdowns: 0, streak: 0, bestStreak: 0, lastHit: new Map(),
    };
    if (view.phase === 'live') this.cur.liveTick = this.liveTickOf(view);
  }

  events(ev: readonly SimEvent[], view: StatsWorldView): void {
    const c = this.cur;
    if (!c || c.view !== view) return;
    const me = c.info.localPid;
    const tick = view.tick;
    const myTeam = view.runners[me]?.team ?? -1;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      switch (e.t) {
        case 'phase':
          if (e.phase === 'live' && c.liveTick === null) c.liveTick = this.liveTickOf(view);
          else if (e.phase === 'ended' && !c.info.online) { this.finalizeOffline(); return; }
          break;
        case 'hit':
          if (e.by >= 0) c.lastHit.set(e.victim, { by: e.by, tick });
          break;
        case 'washed': {
          if (e.victim === me) { c.streak = 0; break; }
          const vTeam = view.runners[e.victim]?.team ?? -2;
          if (e.by === me) {
            c.streak++;
            if (c.streak > c.bestStreak) c.bestStreak = c.streak;
            if (e.cause === 'sea' && vTeam !== myTeam) c.splashdowns++;
          } else if (e.by === null && e.cause === 'sea' && vTeam !== myTeam) {
            const h = c.lastHit.get(e.victim);
            if (h && h.by === me && tick - h.tick <= SEA_CREDIT_TICKS) c.splashdowns++;
          }
          break;
        }
        case 'special':
          if (e.pid === me && e.phase === 'start') c.specials++;
          break;
        case 'sub':
          if (e.pid === me && e.phase === 'throw') c.subs++;
          break;
        default: break;
      }
    }
    if (!c.info.online && view.phase === 'ended') this.finalizeOffline();
  }

  abandon(view: StatsWorldView | null, _why: 'dispose' | 'restart'): void {
    if (!this.cur) return;
    this.closeOpen();
  }

  onlineEnd(status: OnlineEndStatus, fin?: OnlineFinal): void {
    const c = this.cur;
    if (!c || !c.info.online) return;
    this.cur = null;
    const at = this.now();
    if (status === 'void') { this.o.sink({ k: 'void', at }); return; }
    if (status !== 'complete' || !fin || !fin.me) { this.o.sink({ k: 'abandoned', at }); return; }
    const v = c.view;
    const on = c.info.online;
    const myTeam = v.runners[c.info.localPid]?.team ?? 0;
    const mode = fin.result.mode ?? v.mode;
    const rule = fin.result.rule ?? v.rule;
    const rr = resultFor(fin.result, myTeam, mode, rule);
    const humans = Math.max(0, Math.round(fin.humans));
    const rec: MatchRecord = {
      id: c.id, at, v: 1, mode, rule, map: v.def.id, kit: c.info.kit, skill: on.skill,
      online: humans >= 2, humans,
      ...rr,
      washes: Math.max(0, Math.round(fin.me.washes)), washed: Math.max(0, Math.round(fin.me.washedCount)),
      paintedM2: Math.max(0, Math.round(fin.me.painted)),
      specials: c.specials, subs: c.subs, splashdowns: c.splashdowns, bestStreak: c.bestStreak,
      liveS: r1(Math.max(0, fin.me.seatedLiveTicks) * TICK),
      endedBy: fin.result.endedBy === 'limit' ? 'limit' : 'horn',
      score: 0, scoreV: 1, eligible: false,
      ...(this.o.statsDev ? { dev: true as const } : {}),
    };
    rec.eligible = participationOk(rec, this.o.statsDev);
    rec.score = scoreRecord(rec);
    this.o.sink({ k: 'record', rec });
  }

  // ── internals ──

  private liveTickOf(view: StatsWorldView): number {
    return typeof view.countdownS === 'number' ? Math.round(view.countdownS / TICK) : view.tick;
  }

  /** a begin / abandon met an open record: finalize it when its (offline) view already ended, else abandon it */
  private closeOpen(): void {
    const c = this.cur;
    if (!c) return;
    if (!c.info.online && c.view.phase === 'ended') { this.finalizeOffline(); return; }
    this.cur = null;
    this.o.sink({ k: 'abandoned', at: this.now() });
  }

  private finalizeOffline(): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    const v = c.view;
    const res = v.result;
    const me = v.runners[c.info.localPid];
    if (!res || !me) { this.o.sink({ k: 'abandoned', at: this.now() }); return; }
    const endedBy: 'horn' | 'limit' = (v.endedBy ?? res.endedBy) === 'limit' ? 'limit' : 'horn';
    const liveTick = c.liveTick ?? this.liveTickOf(v);
    const liveS = endedBy === 'horn' && typeof v.durationS === 'number' ? v.durationS : Math.max(0, v.tick - liveTick) * TICK;
    const rr = resultFor(res, me.team, v.mode, v.rule);
    const rec: MatchRecord = {
      id: c.id, at: this.now(), v: 1, mode: v.mode, rule: v.rule, map: v.def.id, kit: c.info.kit, skill: c.info.skill,
      online: false, humans: v.runners.filter((r) => !r.bot).length,
      ...rr,
      washes: me.washes, washed: me.washedCount, paintedM2: Math.round(me.painted),
      specials: c.specials, subs: c.subs, splashdowns: c.splashdowns, bestStreak: c.bestStreak,
      liveS: r1(liveS), endedBy,
      score: 0, scoreV: 1, eligible: false,
      ...(this.o.statsDev ? { dev: true as const } : {}),
    };
    rec.eligible = participationOk(rec, this.o.statsDev);
    rec.score = scoreRecord(rec);
    this.o.sink({ k: 'record', rec });
  }
}
