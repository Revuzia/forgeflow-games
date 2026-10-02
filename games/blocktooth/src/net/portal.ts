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
//
// App-side only: DOM / postMessage / timers. Nothing here is imported by the sim.

import type { BiomeId, Profile, TitanId } from '../core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../core/types.ts';
import { GOAL_BY_ID } from '../data/goals.ts';
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
  private queue: { payload: RunResultPayload; resolve(v: RunFiling | null): void }[] = [];
  /** debugging / harness counters (window.__BTPORTAL__) */
  readonly stats = { runResults: 0, achievements: 0, saves: 0, loads: 0, whoami: 0, gameOver: 0, lastRun: null as RunResultPayload | null };

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
    if (!hasOwn(GOAL_BY_ID, goalId)) return;
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
    post({ type: 'forgeflow:save', slot: SLOT, data: { [SAVE_KEY]: { v: 1, profile, best } } });
  }
}
