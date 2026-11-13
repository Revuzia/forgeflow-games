// HIT PARADE - net/online.ts (lane NET). What game.ts / menus use for ONLINE (CONTRACT §16, §18.4, §19.4):
//   const online = createOnline({ data, version, settings, save });
//   online.on('matchStart', (cfg, local) => { const m = createMatch(cfg, data); session = online.attach(m); });
//   loop: session.tick(localInputWord) at 60 Hz (keep ticking through results until 'matchEnd');
//   on the sim's MATCH_END: online.finish({ winner, frame, checksum }) (only once its frame is confirmed:
//   session.confirmedFrame() >= frame; online waits for that itself before sending RESULT - CHANGED(wf7 online): through
//   core/net/result.ts readyResult, which also needs the final checksum of the result's checksum frame).
// The flow itself lives in online_flow.ts (SimPort-based, testable with the toy sim on the lab page).
//
// CHANGED(NET) P2: `info()` (flow facts; also inside session.stats().online), `lastMatch`, `netStats()` returns the
// flow facts ({ online }) when no session exists, events 'end' ({ reason, code }) and 'ratings'; the 'matchEnd' payload
// carries `rated` + `rematch`. Deep-link test switches ?nettrace=N (session trace) and ?relaypace=interval (P1 relay
// pacing, A/B only) are read here.

import { STATE_VERSION, type Match, type MatchCfg } from '../core/sim/match.ts';
import { matchPort } from '../core/net/match_port.ts';
import type { NetStats, RollbackSession } from '../core/net/rollback.ts';
import { hashString } from '../core/net/sync.ts';
import { NET_STRINGS, OnlineFlow, type OnlineInfo, type OnlineMatchEnd, type OnlinePhase, type OnlinePick } from './online_flow.ts';
import { NetPlay } from './netplay.ts';

export { NET_STRINGS };
export type { OnlineInfo, OnlineMatchEnd, OnlinePhase, OnlinePick };

export interface OnlineDeps {
  /** GameData (core/data.ts): fighters, stages, system, clips are hashed for the HELLO data check. */
  data: { fighters: Record<string, unknown>; stages?: unknown; system?: unknown; clips?: unknown; ladder?: unknown };
  /** build id; peers must match exactly (HELLO) */
  version: string;
  settings?: unknown;
  save?: unknown;
  /** display name shown to the opponent (<= 24 chars) */
  name?: string;
  /** override of the HELLO state-layout version (default: core/sim STATE_VERSION) */
  stateVersion?: number;
  /** fighters selectable online (default: every fighter in data; bosses need unlocks -> pass the list) */
  fighters?: string[];
  /** ?relay=1 test switch */
  forceRelay?: boolean;
  log?: (m: string, d?: unknown) => void;
}

export interface Online {
  readonly phase: OnlinePhase;
  readonly session: RollbackSession | null;
  readonly local: 0 | 1;
  readonly room: string;
  /** the last 'matchEnd' payload of the current session (null before one) */
  readonly lastMatch: OnlineMatchEnd | null;
  quick(): Promise<void>;
  create(): Promise<string>;
  join(code: string): Promise<void>;
  pick(p: OnlinePick): void;
  attach(m: Match): RollbackSession;
  finish(r: { winner: -1 | 0 | 1; frame: number; checksum?: number }): void;
  roundBreak(): void;
  rematch(yes: boolean): void;
  leave(): void;
  /** P2: display name for the opponent (next session's HELLO) */
  setName(name: string): void;
  stats(): ReturnType<OnlineFlow['stats']>;
  info(): OnlineInfo;
  /** session stats (+ `online` flow facts) during a match, else `{ online }` (flow facts), null before any session */
  netStats(): NetStats | { online: OnlineInfo } | null;
  /** test only: the session trace (?nettrace=N) + the relay flush log */
  trace(): unknown;
  on(ev: 'matchStart', cb: (cfg: MatchCfg, local: 0 | 1) => void): Online;
  on(ev: 'status', cb: (s: { phase: OnlinePhase; code: string; rttMs: number; transport: string; room?: string; [k: string]: unknown }) => void): Online;
  on(ev: 'error', cb: (e: { code: string; room?: string; [k: string]: unknown }) => void): Online;
  on(ev: 'matchEnd', cb: (r: OnlineMatchEnd) => void): Online;
  /** the opponent left mid-match: `reason` 'disconnect' (presence gone 5 s) | 'forfeit' (BYE) - the stayer wins */
  on(ev: 'disconnect', cb: (r: { winner: 0 | 1; reason?: 'disconnect' | 'forfeit' }) => void): Online;
  on(ev: 'end', cb: (r: { reason: string; code: string }) => void): Online;
  on(ev: 'ratings', cb: (r: { matchId: string; data: unknown; ok: boolean }) => void): Online;
  on(ev: 'paired' | 'select' | 'opponentLocked' | 'reveal' | 'rematch' | 'net', cb: (p: never) => void): Online;
}

/** Stage ids from a stages.json of unknown shape (array of {id}, {stages:[...]}, or an id-keyed object). */
export function stageIds(stages: unknown): string[] {
  if (Array.isArray(stages)) return stages.map((s) => (typeof s === 'string' ? s : String((s as { id?: string }).id ?? ''))).filter(Boolean);
  if (stages && typeof stages === 'object') {
    const o = stages as Record<string, unknown>;
    if (Array.isArray(o.stages)) return stageIds(o.stages);
    return Object.keys(o).filter((k) => k !== 'version' && k !== '$schema' && typeof o[k] === 'object');
  }
  return [];
}

/** Hash of every gameplay-relevant table (fighters, system, clips, stages): peers with different data never match. */
export function gameDataHash(data: OnlineDeps['data']): number {
  let json = '';
  try { json = JSON.stringify([data.system ?? null, data.fighters, data.clips ?? null, data.stages ?? null]); } catch { json = Object.keys(data.fighters).join(','); }
  return hashString(json);
}

/** Deep-link switches: ?room=CODE (join), ?relay=1 (force the relay tier, test only), ?nettrace=N (session trace, test
 *  only), ?relaypace=interval (P1 relay pacing, A/B test only). */
export function readOnlineParams(search = typeof location !== 'undefined' ? location.search : ''): { room: string | null; relay: boolean; trace: number; relayPacing: 'bucket' | 'interval' } {
  const q = new URLSearchParams(search);
  const room = q.get('room');
  const tr = Math.max(0, Math.min(20000, Number(q.get('nettrace') ?? 0) || 0));
  return { room: room ? NetPlay.cleanCode(room) : null, relay: q.get('relay') === '1', trace: tr, relayPacing: q.get('relaypace') === 'interval' ? 'interval' : 'bucket' };
}

export function createOnline(deps: OnlineDeps): Online {
  const fighters = deps.fighters ?? Object.keys(deps.data.fighters).filter((id) => id !== 'freak' && id !== 'ricky');
  let stages = stageIds(deps.data.stages);
  if (!stages.length) stages = ['rust_theater'];
  const qp = readOnlineParams();
  const flow = new OnlineFlow({
    version: deps.version,
    dataHash: gameDataHash(deps.data),
    stateVersion: deps.stateVersion ?? STATE_VERSION,
    fighters,
    stages,
    name: deps.name,
    forceRelay: deps.forceRelay ?? qp.relay,
    log: deps.log,
    trace: qp.trace,
    relayPacing: qp.relayPacing,
  });
  const api: Online = {
    get phase() { return flow.phase; },
    get session() { return flow.session; },
    get local() { return flow.local; },
    get room() { return flow.room; },
    get lastMatch() { return flow.lastMatch; },
    quick: () => flow.quick(),
    create: () => flow.create(),
    join: (code: string) => flow.join(code),
    pick: (p: OnlinePick) => flow.pick(p),
    attach: (m: Match) => flow.attachPort(matchPort(m)),
    finish: (r) => flow.finish(r),
    roundBreak: () => flow.roundBreak(),
    rematch: (yes: boolean) => flow.rematch(yes),
    leave: () => flow.leave(),
    setName: (name: string) => flow.setName(name),
    stats: () => flow.stats(),
    info: () => flow.info(),
    netStats: () => (flow.session ? flow.session.stats() : flow.phase === 'idle' ? null : { online: flow.info() }),
    trace: () => flow.traceDump(),
    on(ev: string, cb: (...a: never[]) => void): Online {
      flow.on(ev as never, cb);
      return api;
    },
  } as Online;
  return api;
}
