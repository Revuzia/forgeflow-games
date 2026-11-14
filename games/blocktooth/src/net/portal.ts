// BLOCKTOOTH — forgeflowgames.com portal bridge client (ONLINE_PLAN §3 A.1.5, lane A-GAME).
//
// The portal frames the game cross-origin and owns the login; the game never sees a token. Everything
// goes through window.parent.postMessage (portal src/lib/gameBridge.ts):
//
//   game → portal                                   portal → game
//   forgeflow:whoami {_reqId}                       forgeflow:identity {_reqId?, signedIn, id, username, avatar_url, level}
//                                                   (also pushed unsolicited on sign-in / sign-out)
//   forgeflow:run_result {_reqId, payload}          forgeflow:run_result_ack {_reqId, data}   (data = bt_submit_run's jsonb)
//   forgeflow:game_over {score}                     —
//   forgeflow:achievement {achievementSlug}         —
//   forgeflow:load {slot, _reqId}                   forgeflow:save_loaded {_reqId, data}
//   forgeflow:save {slot, data}                     —
//   forgeflow:vs_result {_reqId, payload}           forgeflow:vs_result_ack {_reqId, ok, data}  (data = bt_report_vs's jsonb)
//
// Rules:
//   * NO-OP outside the portal (window.parent === window) and until the parent answers whoami with
//     signedIn:true. A parent that never answers (an older portal, a plain iframe) leaves the client
//     'silent' for good: nothing is ever sent but the whoami probes. Guests send nothing.
//   * Only messages whose source is window.parent are read.
//   * Cloud profile WRITE LOCK (LAST CIRCLE royale/hud.js): nothing is saved before forgeflow:save_loaded
//     has answered for this account (an empty account — data null — is an answer). A timeout is not.
//   * Achievements: each goal id is posted at most once per account per page; on the first signed-in
//     identity every goal already in profile.done is posted once (goals earned as a guest are credited).
//   * Run results made before the identity answer are queued (never more than 4) and sent or dropped
//     once it arrives.
//   * VS (ONLINE_PLAN section 2 'Confirming a VS winner', lane O-REPORT): after a match EVERY signed-in human files one
//     forgeflow:vs_result for their OWN seat (bt_report_vs: placement, kills, tonnage, titan, city, match_id). The server
//     counts a win on the boards only when >= 2 humans reported and every report names the same winner; 1 human + bots =
//     personal stats only. A guest files nothing and never blocks the others. Winners are named by ACCOUNT id, so the peers
//     swap ids over the room channel (VsIdentityBook). The 8 VS achievements (data/vsgoals.ts) are posted like solo goals.
//
// App-side only: DOM / postMessage / timers. Nothing here is imported by the sim.

import type { BiomeId, Profile, TitanId, World } from '../core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../core/types.ts';
import { GOAL_BY_ID } from '../data/goals.ts';
import { VS_GOAL_BY_ID, applyVsMatch, loadVsLife, mergeVsLife, sanitizeVsLife, saveVsLife, vsLifeKey, type VsEventTally, type VsLife, type VsMatchFacts } from '../data/vsgoals.ts';
import { sanitizeProfile } from '../meta/profile.ts';

/** the run-result payload `bt_submit_run(p jsonb)` takes (platform.md §8; contract in _harness/scratch/onlineA/NOTES.md) */
export interface RunResultPayload {
  run_nonce: string;
  mode: 'solo';
  titan: TitanId;
  biome: BiomeId;
  result: 'clear' | 'dead';
  duration_s: number;
  clear_s: number | null;
  level: number;
  peak_rank: number;
  kills: number;
  crushed: number;
  tonnage: number;
  blocks: number;
  bosses: number;
  gate_kills: number;
  endless_s: number;
  endless_score: number;
  rematches: number;
  titans_eaten: number;
  vs_match_id: null;
  build_version: string | null;
  /** 'run' = the run just ended · 'endless' = the EXTENDED COVERAGE follow-up of the same run (same run_nonce) */
  phase: 'run' | 'endless';
}

export interface PortalIdentity {
  signedIn: boolean;
  id: string | null;
  username: string | null;
  avatarUrl: string | null;
  level: number | null;
}

/** what the end screen shows for one filed run */
export type RunFiling =
  | { kind: 'sent' }                                   // posted, waiting for the ack
  | { kind: 'ack'; already: boolean; rank: number | null; error: string | null }
  | { kind: 'noack' };                                 // the portal never confirmed

// ─────────────────────────────── VS match report (bt_report_vs) ───────────────────────────────

/** the payload `bt_report_vs(p jsonb)` takes: one human's OWN result in a 4-seat match (supabase/migrations/0008, platform.md section 8) */
export interface VsReportPayload {
  match_id: string;
  /** the server files the roll-up run as 'vs-' || md5(match_id) whatever is sent; sent anyway so the payload validates alone */
  run_nonce: string;
  mode: 'vs';
  titan: TitanId;
  biome: BiomeId;
  /** this reporter's final place 1..4 (1 = winner) */
  placement: number;
  /** human seats at the START of the match (1..4); bots = 4 - humans */
  humans: number;
  bots: number;
  /** account id of the winning HUMAN as this reporter saw it; null = a bot / a guest / unknown won. The winner names itself. */
  claimed_winner: string | null;
  /** seconds on the world clock to the end (countdown included) */
  duration_s: number;
  /** seconds on the MATCH clock until this seat was eliminated or the match ended */
  survived_s: number;
  level: number;
  peak_level: number;
  peak_rank: number;
  kills: number;
  crushed: number;
  tonnage: number;
  blocks: number;
  bosses: number;
  gate_kills: number;
  /** distinct rival titans this seat knocked out (0..3) */
  titans_eaten: number;
  build_version: string | null;
}

/** what the app tells the portal client about a finished VS match (the sim world + who the seats were) */
export interface VsMatchInput {
  /** the finished VS world (run.result 'vs'); read-only here */
  w: World;
  /** the LOCAL human's seat */
  slot: number;
  /** StartInfo.matchId online; offline practice makes one (newVsPracticeMatchId) */
  matchId: string;
  /** human seats at the START of the match (online: StartInfo seats of kind human; practice: 1) */
  humans: number;
  /** account id of each seat's human (null / missing = a bot, a guest, or an id not heard); the local seat is filled from the bridge identity */
  uidBySlot?: ReadonlyArray<string | null | undefined>;
  /** every SimEvent of the match fed in order (the HOSTILE TAKEOVER goal needs it); null = not tracked */
  tally?: VsEventTally | null;
  /** my seat was handed to a bot (left / desynced / disconnected): no report, no goals */
  skip?: boolean;
}

/**
 * The ONLINE layer's description of the running match (set on `App.vsReport` when a match starts; offline VS PRACTICE leaves it null).
 * Read once, when the match is decided.
 */
export interface VsReportCtx {
  /** StartInfo.matchId (every peer derives the same id) */
  matchId: string;
  /** human seats at the START (StartInfo seats of kind 'human'); bots = 4 - humans */
  humans: number;
  /** account id per seat from VsIdentityBook.uidsBySlot (null = bot / guest / not heard) */
  uidsBySlot(): (string | null)[];
  /** online: true once the other live humans' RESULT hashes are in (the report waits for it, at most 4 s; absent = report at once) */
  ready?(): boolean;
  /** true once MY seat is a bot (left / desynced / disconnected) or `!resultsMajority(myHash, otherPeersResultHashes)` (a ghost match):
   *  nothing is filed and no goals are earned */
  skip?(): boolean;
}

/**
 * Should this client file its result? `mine` = my standings hash, `others` = the hashes of the other peers' RESULT messages I received.
 * A peer whose world diverged (it never joined the WebRTC mesh and played a ghost match alone; a desync nobody caught) holds a hash that
 * a STRICT majority of the known results does not share: it must not file. No other result seen = nothing contradicts me (a lone
 * survivor of an abandoned match, or results that never arrived): file. Two humans disagreeing 1 v 1: nobody can tell, nobody files.
 */
export function resultsMajority(mine: number, others: ReadonlyArray<number>): boolean {
  if (others.length === 0) return true;
  let same = 1;
  for (const h of others) if (h === mine) same++;
  return same * 2 > others.length + 1;
}

/** what the end card shows for the filed VS result */
export type VsFiling =
  | { kind: 'sent' }
  | { kind: 'ack'; already: boolean; confirmed: boolean; reports: number | null; error: string | null }
  | { kind: 'noack' };

export interface VsMatchOutcome {
  /** VS goal ids this match newly earned (already saved to the local ledger; posted when signed in) */
  goals: string[];
  facts: VsMatchFacts;
  /** what was (or would be) filed; null when the seat is not reportable (bad seat count) */
  payload: VsReportPayload | null;
  /** resolves with the portal's answer; null when nothing was sent (standalone / silent parent / guest / not reportable) */
  filing: Promise<VsFiling | null>;
}

const BIOME_MAX_BLOCKS: Record<BiomeId, number> = { grideast: 240, whitestacks: 182, lockwater: 208 };   // 0008 bt__validate_run
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** a match id the RPC accepts (8..80 chars) and every peer derives identically from StartInfo.matchId */
export function normalizeMatchId(id: string): string {
  let s = String(id).replace(/[^A-Za-z0-9_.:-]/g, '_');
  if (!s.startsWith('blocktooth:')) s = 'blocktooth:' + s;
  return s.slice(0, 80);
}

/** offline VS PRACTICE (1 human + 3 bots) files personal stats under a match id of its own */
export function newVsPracticeMatchId(seed: number): string {
  return normalizeMatchId(`practice:${seed >>> 0}:${newRunNonce()}`);
}

function hash36(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/** the local seat's facts for the goals + the report, or null when the match is not decided / the seat is not a human's any more */
export function vsFactsOf(i: VsMatchInput): VsMatchFacts | null {
  const w = i.w, vs = w.vs;
  if (w.mode !== 'vs' || !vs || vs.phase !== 'over' || vs.winner < 0 || w.run.result !== 'vs') return null;
  const P = w.players[i.slot];
  if (!P || i.skip || P.bot !== null || P.vs.data.left === 1) return null;
  const humans = Math.max(1, Math.min(w.players.length, Math.floor(i.humans)));
  return {
    titan: P.titanId,
    finished: true,
    won: vs.winner === i.slot,
    humans,
    koCount: Math.max(0, Math.floor(P.vs.koCount)),
    evictions: Math.max(0, Math.floor(P.vs.evictions)),
    crownKos: i.tally ? i.tally.crownKos : 0,
  };
}

/** the bt_report_vs payload for the local seat (null when the seat is not reportable: not a 4-seat match / no place) */
export function buildVsReport(i: VsMatchInput, myUid: string | null, buildVersion: string | null): VsReportPayload | null {
  const w = i.w, vs = w.vs;
  const facts = vsFactsOf(i);
  if (!facts || !vs || w.players.length !== 4) return null;
  const P = w.players[i.slot];
  // a human who TOOK OVER a bot seat mid-match is not one of the START humans the server counts (`humans` is fixed by the first report):
  // their report could take another human's slot (match_full). Their goals still count; nothing is filed.
  if (P.vs.data.tookOver === 1) return null;
  const place = Math.floor(P.vs.place);
  if (!(place >= 1 && place <= 4)) return null;
  const matchId = normalizeMatchId(i.matchId);
  const endT = vs.endT >= 0 ? vs.endT : w.t;
  const duration = Math.max(5, Math.floor(endT));
  const out = P.vs.eliminated && P.vs.elimT >= 0 ? P.vs.elimT : endT;
  const survived = Math.max(0, Math.min(43200, Math.floor(out - vs.startT)));
  // the winner, named by ACCOUNT id: me (the winner names itself), a human whose id I heard, else null (bot / guest / unknown)
  let claimed: string | null = null;
  if (vs.winner === i.slot) claimed = myUid;
  else {
    const W = w.players[vs.winner];
    const u = i.uidBySlot ? i.uidBySlot[vs.winner] : null;
    if (W && W.bot === null && W.vs.data.left !== 1 && typeof u === 'string' && UUID_RE.test(u)) claimed = u.toLowerCase();
  }
  // The server's plausibility bounds (0008 bt__validate_run) were fit to SOLO runs. A strong VS seat can exceed them (measured over
  // 2 016 simulated seats: 15 seats above the level bound, and the biggest tonnage reached 0.83 of its bound), and a rejected
  // report would also lose the WINNER's row (no row for the named winner = no confirmation for anyone). So the roll-up figures are
  // capped to the bound; `peak_level` (checked only to 0..250) keeps the real level. A VS-specific bound would let these caps go.
  const kills = Math.max(0, Math.min(500 + 30 * duration, Math.floor(P.titan.kills)));
  const realLevel = Math.max(1, Math.floor(P.titan.level));
  const level = Math.min(realLevel, Math.min(250, 40 + Math.floor(duration / 30)));
  const tonnage = Math.max(0, Math.min(12_000_000 + 20_000 * duration, Math.round(P.run.tonnage)));
  return {
    match_id: matchId,
    run_nonce: 'vs-' + hash36(matchId) + hash36(matchId.split('').reverse().join('')),
    mode: 'vs',
    titan: P.titanId,
    biome: w.biomeId,
    placement: place,
    humans: facts.humans,
    bots: w.players.length - facts.humans,
    claimed_winner: claimed,
    duration_s: duration,
    survived_s: survived,
    level,
    peak_level: Math.min(250, realLevel),
    peak_rank: Math.max(0, Math.min(4, Math.floor(Math.max(P.vs.peakRank, P.titan.rank)))),
    kills,
    crushed: Math.max(0, Math.min(kills, Math.floor(P.titan.crushed || 0))),
    tonnage,
    blocks: Math.max(0, Math.min(BIOME_MAX_BLOCKS[w.biomeId] ?? 208, Math.floor(P.run.blocksLeveled))),
    bosses: 0,
    gate_kills: Math.max(0, Math.min(4, Math.floor(P.vs.tenderTop))),
    titans_eaten: i.tally ? Math.min(3, i.tally.rivalsKo.size) : Math.max(0, Math.min(3, Math.floor(P.vs.evictions))),
    build_version: buildVersion,
  };
}

// ─────────────────────────────── account ids between the peers ───────────────────────────────

/** the slice of net/room.ts `Room` the id exchange uses (a fake implements it in the probes) */
export interface RoomLike {
  readonly id: string;
  send(t: string, d?: Record<string, unknown>): boolean;
  onMsg(cb: (m: { from: string; t: string; d: Record<string, unknown> }) => void): () => void;
}

/**
 * Winners are named by ACCOUNT id, but the lockstep peers only know each other's room peer ids. Each signed-in peer announces
 * `{m: matchId, u: accountId}` on the room channel (message type 'uid': one tiny Supabase broadcast, no stream) and records the
 * others'. Guests announce nothing. A lie can only withhold a confirmation: the RPC needs the named winner to have reported
 * place 1 and named ITSELF, so nobody can be handed a win.
 */
export class VsIdentityBook {
  private readonly portal: PortalClient;
  private room: RoomLike | null = null;
  private matchId = '';
  private off: (() => void) | null = null;
  private readonly byPeer = new Map<string, string>();
  private readonly replied = new Set<string>();
  constructor(portal: PortalClient) { this.portal = portal; }

  /** start listening on `room` for this match (idempotent per room) and announce my id */
  attach(room: RoomLike, matchId: string): void {
    this.detach();
    this.room = room;
    this.matchId = normalizeMatchId(matchId);
    this.off = room.onMsg((m) => this.onMsg(m));
    this.announce();
  }

  detach(): void {
    if (this.off) { try { this.off(); } catch { /* gone */ } }
    this.off = null;
    this.room = null;
  }

  /** (re)announce my account id (no-op unless signed in) */
  announce(): boolean {
    const id = this.portal.identity.id;
    const r = this.room;
    if (!r || !this.portal.signedIn || !id) return false;
    return r.send('uid', { m: this.matchId, u: id });
  }

  private onMsg(m: { from: string; t: string; d: Record<string, unknown> }): void {
    if (m.t !== 'uid' || m.d.m !== this.matchId || typeof m.d.u !== 'string' || !UUID_RE.test(m.d.u)) return;
    const fresh = !this.byPeer.has(m.from);
    this.byPeer.set(m.from, m.d.u.toLowerCase());
    // a peer I had not heard (it joined late / my first announce raced its subscribe): tell it my id once
    if (fresh && !this.replied.has(m.from)) { this.replied.add(m.from); this.announce(); }
  }

  /** account id of a room peer (null = a guest / not heard) */
  uidOf(peer: string | null | undefined): string | null {
    if (!peer) return null;
    if (this.room && peer === this.room.id) return this.portal.identity.id;
    return this.byPeer.get(peer) ?? null;
  }

  /** account id per seat from a roster of {slot, peer} (humans only; bots / unknown = null) */
  uidsBySlot(seats: ReadonlyArray<{ slot: number; peer: string | null }>, n = 4): (string | null)[] {
    const out: (string | null)[] = new Array(n).fill(null);
    for (const s of seats) if (s.slot >= 0 && s.slot < n) out[s.slot] = this.uidOf(s.peer);
    return out;
  }
}

/** standalone = no parent frame · waiting = whoami asked · silent = the parent never answered */
export type PortalState = 'standalone' | 'waiting' | 'silent' | 'guest' | 'signedIn';

export interface PortalHooks {
  /** false: never read or write the cloud profile (dev `?meta=` runs use an in-memory profile) */
  cloudProfile: boolean;
  /** the app's current profile + personal bests (read when syncing) */
  getProfile(): Profile;
  getBests(): Record<string, number>;
  /** adopt a merged profile + bests (the app saves them locally) */
  adopt(profile: Profile, bests: Record<string, number>): void;
  /** identity / state changed (the end screen re-renders its account line) */
  onChange?(): void;
}

const SLOT = 1;
const WHOAMI_TRIES = 3;
const WHOAMI_WAIT_MS = 4000;
const LOAD_TRIES = 3;
const LOAD_WAIT_MS = 12000;
const ACK_WAIT_MS = 15000;
const QUEUE_MAX = 4;
const SAVE_KEY = 'blocktooth';

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function inFrame(): boolean {
  try { return !!window.parent && window.parent !== window; } catch { return true; /* cross-origin access threw: framed */ }
}

function post(msg: Record<string, unknown>): void {
  try { window.parent.postMessage(msg, '*'); } catch { /* standalone / detached */ }
}

/** 'bt-<base36 ms>-<12 random base36>' (crypto when available; app code, never the sim RNG) */
export function newRunNonce(): string {
  let r = '';
  try {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    r = a[0].toString(36) + a[1].toString(36);
  } catch {
    r = Math.floor(Math.random() * 2 ** 52).toString(36);
  }
  return `bt-${Date.now().toString(36)}-${r.slice(0, 12).padStart(6, '0')}`;
}

/** the portal frames the game as `index.html?v=<build_version>-<nonce>` (GamePlayer.tsx) */
export function buildVersionFromUrl(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get('v');
    if (!v) return null;
    const head = v.split('-')[0].trim();
    return head ? head.slice(0, 40) : null;
  } catch { return null; }
}

function str(v: unknown): string | null { return typeof v === 'string' && v !== '' ? v : null; }
function num(v: unknown): number | null { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

function readIdentity(d: Record<string, unknown>): PortalIdentity {
  const signedIn = d.signedIn === true && typeof d.id === 'string' && d.id !== '';
  return {
    signedIn,
    id: signedIn ? (d.id as string) : null,
    username: signedIn ? str(d.username) : null,
    avatarUrl: signedIn ? str(d.avatar_url) : null,
    level: signedIn ? num(d.level) : null,
  };
}

function bestsOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'number' && Number.isFinite(x) && x >= 0 && k.length <= 80) out[k] = x;
  }
  return out;
}

/** personal bests: `.clearS` keys lower wins, every other key higher wins */
export function mergeBests(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const k of Object.keys(b)) {
    const x = b[k];
    if (!(k in out)) { out[k] = x; continue; }
    out[k] = k.endsWith('.clearS') ? Math.min(out[k], x) : Math.max(out[k], x);
  }
  return out;
}

/**
 * Union of two profiles: done = union (earliest stamp); best = the better value per goal (lowerIsBetter
 * goals: the smallest positive); life counters = max; clearedBy = union; bossKills = max. perk / palette /
 * newUnlocks stay LOCAL (this device's choices); cineSeen = union. Sanitised on the way out.
 */
export function mergeProfiles(local: Profile, cloud: Profile): Profile {
  const L = sanitizeProfile(local), C = sanitizeProfile(cloud);
  const out = sanitizeProfile(L);
  for (const id of Object.keys(C.done)) {
    const t = C.done[id];
    out.done[id] = hasOwn(out.done, id) ? Math.min(out.done[id], t) : t;
  }
  for (const id of Object.keys(C.best)) {
    const b = C.best[id];
    if (!hasOwn(out.best, id) || !(out.best[id] > 0)) { if (b > 0) out.best[id] = b; continue; }
    if (!(b > 0)) continue;
    const g = hasOwn(GOAL_BY_ID, id) ? GOAL_BY_ID[id] : null;
    out.best[id] = g && g.lowerIsBetter ? Math.min(out.best[id], b) : Math.max(out.best[id], b);
  }
  const ol = out.life, cl = C.life;
  ol.runs = Math.max(ol.runs, cl.runs);
  ol.clears = Math.max(ol.clears, cl.clears);
  ol.banishes = Math.max(ol.banishes, cl.banishes);
  ol.evolutions = Math.max(ol.evolutions, cl.evolutions);
  ol.gateRematches = Math.max(ol.gateRematches, cl.gateRematches);
  for (const t of TITAN_IDS) {
    const s = new Set<BiomeId>([...ol.clearedBy[t], ...cl.clearedBy[t]]);
    ol.clearedBy[t] = BIOME_IDS.filter((b) => s.has(b));
  }
  for (const id of Object.keys(cl.bossKills) as (keyof typeof cl.bossKills)[]) {
    ol.bossKills[id] = Math.max(ol.bossKills[id] ?? 0, cl.bossKills[id] ?? 0);
  }
  for (const k of Object.keys(C.cineSeen)) out.cineSeen[k] = 1;
  return sanitizeProfile(out);
}

/** a stable comparison key (JSON of the sanitised profile + sorted bests) */
function snapshotKey(p: Profile, b: Record<string, number>): string {
  const keys = Object.keys(b).sort();
  return JSON.stringify(sanitizeProfile(p)) + '|' + keys.map((k) => k + '=' + b[k]).join(',');
}

export class PortalClient {
  private readonly hooks: PortalHooks;
  private _state: PortalState = 'standalone';
  private _identity: PortalIdentity = { signedIn: false, id: null, username: null, avatarUrl: null, level: null };
  private reqSeq = 0;
  private whoamiTimer = 0;
  private whoamiTries = 0;
  private started = false;
  /** per account: achievement slugs already posted this page */
  private readonly sentAch = new Map<string, Set<string>>();
  private caughtUp = new Set<string>();
  /** cloud profile: the account whose save_loaded answered (writes allowed) / whose load is in flight */
  private cloudReadFor: string | null = null;
  private cloudLoadFor: string | null = null;
  private loadTimer = 0;
  private readonly acks = new Map<string, { resolve(v: RunFiling): void; timer: number; clear: boolean }>();
  private readonly vsAcks = new Map<string, { resolve(v: VsFiling): void; timer: number }>();
  private queue: { payload: RunResultPayload; resolve(v: RunFiling | null): void }[] = [];
  /** reports made before the identity answered: built AT FLUSH (the winner names itself by the account id, unknown until then) */
  private vsQueue: { input: VsMatchInput; resolve(v: VsFiling | null): void }[] = [];
  /** the VS ledger (lifetime wins for the grind goals + the VS goals earned): localStorage + the cloud save's `vs` key */
  private vsLife: VsLife = loadVsLife();
  /** match ids already filed this page (a VS match is filed once) */
  private readonly vsFiled = new Set<string>();
  /** debugging / harness counters (window.__BTPORTAL__) */
  readonly stats = { runResults: 0, achievements: 0, saves: 0, loads: 0, whoami: 0, gameOver: 0, vsResults: 0, lastRun: null as RunResultPayload | null, lastVs: null as VsReportPayload | null };

  constructor(hooks: PortalHooks) {
    this.hooks = hooks;
  }

  get state(): PortalState { return this._state; }
  get identity(): PortalIdentity { return { ...this._identity }; }
  get signedIn(): boolean { return this._state === 'signedIn'; }

  /** install the listener and ask who is signed in (idempotent; no-op standalone) */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!inFrame()) { this._state = 'standalone'; return; }
    this._state = 'waiting';
    window.addEventListener('message', this.onMessage);
    this.askWhoami();
    try { (window as unknown as { __BTPORTAL__?: PortalClient }).__BTPORTAL__ = this; } catch { /* ignore */ }
  }

  private nextReq(tag: string): string { return `bt${tag}${++this.reqSeq}`; }

  private askWhoami(): void {
    if (this._state !== 'waiting') return;
    this.whoamiTries++;
    this.stats.whoami++;
    post({ type: 'forgeflow:whoami', _reqId: this.nextReq('who') });
    this.whoamiTimer = window.setTimeout(() => {
      if (this._state !== 'waiting') return;
      if (this.whoamiTries < WHOAMI_TRIES) { this.askWhoami(); return; }
      this._state = 'silent';                  // an older portal / a plain frame: stay quiet for good
      this.flushQueue();
      this.changed();
    }, WHOAMI_WAIT_MS);
  }

  private readonly onMessage = (ev: MessageEvent): void => {
    let parent: Window | null = null;
    try { parent = window.parent; } catch { return; }
    if (!parent || ev.source !== parent) return;
    const d = ev.data as Record<string, unknown> | null;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
    switch (d.type) {
      case 'forgeflow:identity': this.onIdentity(readIdentity(d)); break;
      case 'forgeflow:run_result_ack': this.onAck(d); break;
      case 'forgeflow:vs_result_ack': this.onVsAck(d); break;
      case 'forgeflow:save_loaded': this.onSaveLoaded(d); break;
      default: break;
    }
  };

  private onIdentity(id: PortalIdentity): void {
    window.clearTimeout(this.whoamiTimer);
    const prev = this._identity;
    this._identity = id;
    this._state = id.signedIn ? 'signedIn' : 'guest';
    if (!id.signedIn || prev.id !== id.id) {
      // signed out / another account: the write lock closes and any load in flight is abandoned
      this.cloudReadFor = null;
      this.cloudLoadFor = null;
      window.clearTimeout(this.loadTimer);
    }
    if (id.signedIn && id.id) {
      this.catchUpAchievements(id.id);
      this.loadCloud(id.id);
    }
    this.flushQueue();
    this.changed();
  }

  private changed(): void {
    try { this.hooks.onChange?.(); } catch (e) { console.error('[blocktooth] portal onChange failed', e); }
  }

  // ─────────────────────────────── achievements ───────────────────────────────

  /** a goal was met (slug = the goal id the portal seeded for game 52) */
  achievement(goalId: string): void {
    if (this._state !== 'signedIn' || !this._identity.id) return;
    if (!hasOwn(GOAL_BY_ID, goalId) && !hasOwn(VS_GOAL_BY_ID, goalId)) return;
    let sent = this.sentAch.get(this._identity.id);
    if (!sent) { sent = new Set(); this.sentAch.set(this._identity.id, sent); }
    if (sent.has(goalId)) return;
    sent.add(goalId);
    this.stats.achievements++;
    post({ type: 'forgeflow:achievement', achievementSlug: goalId });
  }

  /** once per account per page: every goal already on file (earned as a guest or on another visit) */
  private catchUpAchievements(userId: string): void {
    if (this.caughtUp.has(userId)) return;
    this.caughtUp.add(userId);
    let done: string[] = [];
    try { done = Object.keys(this.hooks.getProfile().done).sort(); } catch { done = []; }
    for (const id of done) this.achievement(id);
    for (const id of Object.keys(this.vsLife.done).sort()) this.achievement(id);   // VS goals earned as a guest / offline
  }

  // ─────────────────────────────── run results ───────────────────────────────

  /**
   * File one finished run (bt_submit_run). Resolves with how the portal answered, or null when nothing was
   * sent (standalone / silent parent / guest).
   */
  submitRun(payload: RunResultPayload): Promise<RunFiling | null> {
    if (this._state === 'waiting') {
      return new Promise((resolve) => {
        this.queue.push({ payload, resolve });
        while (this.queue.length > QUEUE_MAX) this.queue.shift()?.resolve(null);
      });
    }
    if (this._state !== 'signedIn') return Promise.resolve(null);
    return this.sendRun(payload);
  }

  private sendRun(payload: RunResultPayload): Promise<RunFiling> {
    const reqId = this.nextReq('run');
    this.stats.runResults++;
    this.stats.lastRun = payload;
    post({ type: 'forgeflow:run_result', _reqId: reqId, payload });
    // the generic /leaderboards score (season best of tonnage; LAST CIRCLE convention)
    this.stats.gameOver++;
    post({ type: 'forgeflow:game_over', score: payload.tonnage });
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => { this.acks.delete(reqId); resolve({ kind: 'noack' }); }, ACK_WAIT_MS);
      this.acks.set(reqId, { resolve, timer, clear: payload.result === 'clear' });
    });
  }

  private flushQueue(): void {
    if (this._state === 'waiting') return;
    const q = this.queue;
    this.queue = [];
    for (const it of q) {
      if (this._state === 'signedIn') this.sendRun(it.payload).then(it.resolve, () => it.resolve(null));
      else it.resolve(null);
    }
    const vq = this.vsQueue;
    this.vsQueue = [];
    for (const it of vq) {
      const payload = this._state === 'signedIn' ? this.vsPayload(it.input) : null;
      if (payload) this.sendVs(payload).then(it.resolve, () => it.resolve(null));
      else it.resolve(null);
    }
  }

  private onAck(d: Record<string, unknown>): void {
    const reqId = typeof d._reqId === 'string' ? d._reqId : '';
    const w = this.acks.get(reqId);
    if (!w) return;
    this.acks.delete(reqId);
    window.clearTimeout(w.timer);
    const data = (d.data && typeof d.data === 'object' ? d.data : {}) as Record<string, unknown>;
    const br = (data.board_rank && typeof data.board_rank === 'object' ? data.board_rank : {}) as Record<string, unknown>;
    const rank = num(w.clear ? br.clear : br.tonnage);
    // A-SQL: a rejected run is {ok:false, error:'rejected', reason:'<code>'} (the reason is shown, e.g. clear_s_out_of_range)
    const baseErr = str(data.error) ?? (typeof d.error === 'string' ? d.error : null);
    const reason = str(data.reason);
    const err = baseErr && reason ? `${baseErr} (${reason})` : baseErr;
    w.resolve({ kind: 'ack', already: data.already === true, rank: rank !== null && rank >= 1 ? Math.floor(rank) : null, error: err });
  }

  // ─────────────────────────────── VS match end ───────────────────────────────

  /** the local VS ledger (lifetime grind-goal counters + the VS goals earned); a copy */
  get vsLedger(): VsLife { return sanitizeVsLife(this.vsLife); }

  /**
   * A VS match was decided. (1) The local ledger is updated and the VS goals this match earned are saved and posted (posting is a
   * no-op until signed in; the sign-in catch-up covers a guest's goals). (2) Signed in: ONE forgeflow:vs_result for the local seat.
   * Guests, standalone and a parent that never answered file nothing. Once per match id. null = nothing to do (undecided world,
   * a seat a bot has now, or this match was already handled).
   */
  vsMatchEnded(i: VsMatchInput): VsMatchOutcome | null {
    const facts = vsFactsOf(i);
    if (!facts) return null;
    const matchId = normalizeMatchId(i.matchId);
    if (this.vsFiled.has(matchId)) return null;
    this.vsFiled.add(matchId);
    const res = applyVsMatch(this.vsLife, facts, Date.now());
    this.vsLife = res.life;
    saveVsLife(this.vsLife);
    for (const id of res.newly) this.achievement(id);
    if (res.newly.length) this.saveCloud();
    // the winner names itself, so the one account id this client owns is bound into the payload
    const payload = this.vsPayload(i);
    let filing: Promise<VsFiling | null> = Promise.resolve(null);
    if (this._state === 'waiting') {
      filing = new Promise((resolve) => {
        this.vsQueue.push({ input: i, resolve });
        while (this.vsQueue.length > QUEUE_MAX) this.vsQueue.shift()?.resolve(null);
      });
    } else if (this._state === 'signedIn' && payload) {
      filing = this.sendVs(payload);
    }
    return { goals: res.newly, facts, payload, filing };
  }

  /** the payload as of NOW (the winner names itself by the bridge identity, so it needs the signed-in id) */
  private vsPayload(i: VsMatchInput): VsReportPayload | null {
    const myUid = this._state === 'signedIn' ? this._identity.id : null;
    return buildVsReport(i, myUid, buildVersionFromUrl(typeof location !== 'undefined' ? location.search : ''));
  }

  private sendVs(payload: VsReportPayload): Promise<VsFiling> {
    const reqId = this.nextReq('vs');
    this.stats.vsResults++;
    this.stats.lastVs = payload;
    post({ type: 'forgeflow:vs_result', _reqId: reqId, payload });
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => { this.vsAcks.delete(reqId); resolve({ kind: 'noack' }); }, ACK_WAIT_MS);
      this.vsAcks.set(reqId, { resolve, timer });
    });
  }

  private onVsAck(d: Record<string, unknown>): void {
    const reqId = typeof d._reqId === 'string' ? d._reqId : '';
    const w = this.vsAcks.get(reqId);
    if (!w) return;
    this.vsAcks.delete(reqId);
    window.clearTimeout(w.timer);
    const data = (d.data && typeof d.data === 'object' ? d.data : {}) as Record<string, unknown>;
    const baseErr = str(data.error) ?? (typeof d.error === 'string' ? d.error : null);
    const reason = str(data.reason);
    const err = baseErr && reason ? `${baseErr} (${reason})` : baseErr;
    const reports = num(data.reports);
    w.resolve({ kind: 'ack', already: data.already === true, confirmed: data.winner_confirmed === true, reports: reports !== null ? Math.floor(reports) : null, error: err });
  }

  // ─────────────────────────────── cloud profile ───────────────────────────────

  private loadCloud(userId: string): void {
    if (!this.hooks.cloudProfile) return;
    if (this.cloudReadFor === userId || this.cloudLoadFor === userId) return;
    this.cloudLoadFor = userId;
    let attempt = 0;
    const ask = (): void => {
      if (this.cloudLoadFor !== userId) return;
      attempt++;
      this.stats.loads++;
      this.pendingLoad = { reqId: this.nextReq('load'), userId };
      post({ type: 'forgeflow:load', slot: SLOT, _reqId: this.pendingLoad.reqId });
      this.loadTimer = window.setTimeout(() => {
        if (this.cloudLoadFor !== userId) return;
        if (attempt < LOAD_TRIES) { ask(); return; }
        this.cloudLoadFor = null;            // no answer: the session stays READ-ONLY for the cloud
        this.pendingLoad = null;
      }, LOAD_WAIT_MS);
    };
    ask();
  }

  private pendingLoad: { reqId: string; userId: string } | null = null;

  private onSaveLoaded(d: Record<string, unknown>): void {
    const p = this.pendingLoad;
    if (!p || d._reqId !== p.reqId || this.cloudLoadFor !== p.userId || this._identity.id !== p.userId) return;
    window.clearTimeout(this.loadTimer);
    this.pendingLoad = null;
    this.cloudLoadFor = null;
    const raw = d.data && typeof d.data === 'object' ? (d.data as Record<string, unknown>)[SAVE_KEY] : null;
    const blob = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    try {
      const local = this.hooks.getProfile(), localBests = this.hooks.getBests();
      const before = snapshotKey(local, localBests);
      let merged = sanitizeProfile(local), mergedBests = { ...localBests };
      if (blob) {
        merged = mergeProfiles(local, sanitizeProfile(blob.profile));
        mergedBests = mergeBests(localBests, bestsOf(blob.best));
        if (blob.vs !== undefined) {                       // the VS ledger: counters max, goals union (never lowers a local value)
          const mv = mergeVsLife(this.vsLife, sanitizeVsLife(blob.vs));
          if (vsLifeKey(mv) !== vsLifeKey(this.vsLife)) { this.vsLife = mv; saveVsLife(mv); }
        }
      }
      if (snapshotKey(merged, mergedBests) !== before) this.hooks.adopt(merged, mergedBests);
    } catch (e) {
      console.error('[blocktooth] cloud profile merge failed', e);
      return;                                  // keep the lock closed: a broken merge must not push
    }
    this.cloudReadFor = p.userId;              // an empty account (data null) is a real answer
    this.saveCloud();                          // push the union (local progress made as a guest included)
  }

  /** push profile + bests to slot 1 — only after this account's load answered (write lock) */
  saveCloud(): void {
    if (!this.hooks.cloudProfile || this._state !== 'signedIn' || !this._identity.id) return;
    if (this.cloudReadFor !== this._identity.id) return;
    let profile: Profile, best: Record<string, number>;
    try { profile = sanitizeProfile(this.hooks.getProfile()); best = bestsOf(this.hooks.getBests()); } catch { return; }
    this.stats.saves++;
    post({ type: 'forgeflow:save', slot: SLOT, data: { [SAVE_KEY]: { v: 1, profile, best, vs: sanitizeVsLife(this.vsLife) } } });
  }
}
