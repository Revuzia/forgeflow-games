// DYEFIELD — the portal bridge client (_spec/CONTRACT_STATS.md §S3): framing detection, the origin allowlist, the
// forgeflow:load probe schedule (boot probes, re-probes, the confirmed-null rule) and the raw posts.
//
// The module touches no DOM at load: everything browser-specific sits behind StatsEnv (browserEnv() builds the real one
// lazily; the node probe passes a fake env with a fake clock). The session logic on top of it — the store, the paced
// achievement queue, the outbox, saves — is stats/core.ts.
//
// States (§S3.1): standalone (window.parent === window, or reading it throws; never posts; final) · probing (framed, a
// load is out, no reply yet) · signed-in (a save_loaded reply arrived: the portal answers ONLY for a signed-in user;
// final for the page) · guest (framed, every boot probe timed out; any later reply flips to signed-in).

import type { CloudRecord, PortalState } from './types.ts';
import { validCloud, type KV } from './career.ts';

/** a probe without a reply after this long has timed out */
export const PROBE_TIMEOUT_MS = 6000;
/** gaps after each timed-out boot probe before the next one (5 probes ≈ 60 s) */
export const BOOT_GAPS_MS = [1500, 4000, 8000, 16000] as const;
/** a null reply is "empty account" only once a probe sent this long after it also answers null */
export const NULL_CONFIRM_MS = 3000;

/** what the stats layer needs from the page (browserEnv) or from a test (the probe's fake env) */
export interface StatsEnv {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  random(): number;
  /** localStorage, or null when reading it throws */
  kv: KV | null;
  /** inside a frame (window.parent !== window) */
  framed: boolean;
  /** window.parent.postMessage(msg, '*') inside try/catch */
  post(msg: Record<string, unknown>): void;
  /** subscribe to window 'message' events: (data, origin, fromParent = ev.source === window.parent) */
  onMessage(fn: (data: unknown, origin: string, fromParent: boolean) => void): void;
  /** subscribe to pagehide / visibilitychange → hidden */
  onHide(fn: () => void): void;
}

const LOCAL_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const PAGES_RE = /^https:\/\/[a-z0-9-]+\.forgeflow-games\.pages\.dev$/;
const PROD = new Set(['https://forgeflowgames.com', 'https://www.forgeflowgames.com', 'https://forgeflow-games.pages.dev']);

/** §S3.4: replies are accepted only from the portal's origins (+ the harness's localhost) */
export function originAllowed(origin: string): boolean {
  return PROD.has(origin) || PAGES_RE.test(origin) || LOCAL_RE.test(origin);
}
/** §S11: a ?statsdev=1 session posts only after a reply from one of these (the harness's mock portal) */
export function originLocal(origin: string): boolean {
  return LOCAL_RE.test(origin);
}

export interface LinkCallbacks {
  /** the first accepted reply this page (probing / guest → signed-in) */
  signedIn(): void;
  /** readOk: a valid v1 record, or a confirmed null (an empty account) */
  read(rec: CloudRecord | null): void;
  /** the reply is not a readable v1 record: read-only session (no push ever) */
  unreadable(): void;
  /** the boot schedule ended with no reply (probing → guest) */
  guest(): void;
}

type ProbeKind = 'boot' | 're' | 'confirm';

export class PortalLink {
  state: PortalState;
  readOk = false;
  unreadable = false;
  /** the last accepted reply came from localhost / 127.0.0.1 */
  localOrigin = false;
  probes = 0;
  replies = 0;
  ignored = 0;
  private env: StatsEnv;
  private cb: LinkCallbacks;
  private issued = new Map<string, number>();
  private out: { id: string; kind: ProbeKind; timer: unknown } | null = null;
  private wait: unknown = null;
  private bootIdx = 0;
  private bootDone = false;
  private nullAt: number | null = null;
  /** a re-probe was asked for while another probe was out: send it when that one times out */
  private wanted = false;
  private seq = 0;
  private started = false;

  constructor(env: StatsEnv, cb: LinkCallbacks) {
    this.env = env;
    this.cb = cb;
    this.state = env.framed ? 'probing' : 'standalone';
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.state === 'standalone') return;
    this.env.onMessage((d, o, p) => this.onMessage(d, o, p));
    this.send('boot');
  }

  /** a re-probe (at every finalize, every CAREER open) while unresolved. With a probe already out or scheduled the request
   *  is remembered and sent when that probe times out (a probe sent while the player was signed out never gets a reply:
   *  the portal drops loads for a signed-out user), so a sign-in between the two triggers is still picked up. */
  reprobe(): void {
    if (!this.started || this.state === 'standalone' || this.readOk || this.unreadable) return;
    if (this.out || this.wait !== null) {
      if (!(this.out?.kind === 'boot' || (this.wait !== null && this.state === 'probing'))) this.wanted = true;
      return;
    }
    this.send('re');
  }

  /** a raw post to the portal (never in standalone). The caller decides WHETHER to post (core.ts). */
  post(msg: Record<string, unknown>): boolean {
    if (this.state === 'standalone') return false;
    try { this.env.post(msg); return true; } catch { return false; }
  }

  // ── internals ──

  private send(kind: ProbeKind): void {
    const now = this.env.now();
    const id = `dfs-${++this.seq}-${now.toString(36)}`;
    this.issued.set(id, now);
    this.probes++;
    const timer = this.env.setTimeout(() => this.timeout(id), PROBE_TIMEOUT_MS);
    this.out = { id, kind, timer };
    this.post({ type: 'forgeflow:load', slot: 1, _reqId: id });
  }

  private timeout(id: string): void {
    if (!this.out || this.out.id !== id) return;
    const kind = this.out.kind;
    this.out = null;
    if (kind !== 'boot') {
      if (this.wanted && !this.readOk && !this.unreadable) { this.wanted = false; this.send('re'); }
      return;
    }
    if (this.state !== 'probing') return;
    if (this.bootIdx < BOOT_GAPS_MS.length) {
      const gap = BOOT_GAPS_MS[this.bootIdx++];
      this.wait = this.env.setTimeout(() => { this.wait = null; if (this.state === 'probing') this.send('boot'); }, gap);
      return;
    }
    this.bootDone = true;
    this.state = 'guest';
    this.cb.guest();
  }

  private stopProbing(): void {
    if (this.out) { this.env.clearTimeout(this.out.timer); this.out = null; }
    if (this.wait !== null) { this.env.clearTimeout(this.wait); this.wait = null; }
  }

  private onMessage(data: unknown, origin: string, fromParent: boolean): void {
    if (!fromParent || !data || typeof data !== 'object') return;
    const m = data as Record<string, unknown>;
    if (m.type !== 'forgeflow:save_loaded') return;
    if (!originAllowed(origin)) { this.ignored++; return; }
    const rid = typeof m._reqId === 'string' ? m._reqId : null;
    if (rid !== null && !this.issued.has(rid)) { this.ignored++; return; }
    this.replies++;
    this.localOrigin = originLocal(origin);
    const wasConfirm = !!this.out && this.out.kind === 'confirm' && this.out.id === rid;
    this.stopProbing();
    this.wanted = false;
    if (this.state !== 'signed-in') {
      this.state = 'signed-in';
      this.cb.signedIn();
    }
    if (this.readOk || this.unreadable) return;
    const d = m.data;
    if (d === null || d === undefined) {
      const now = this.env.now();
      const sentAt = rid !== null ? (this.issued.get(rid) ?? -Infinity) : now;
      if (this.nullAt !== null && (wasConfirm || sentAt >= this.nullAt + NULL_CONFIRM_MS - 1)) {
        this.readOk = true;
        this.cb.read(null);
        return;
      }
      if (this.nullAt === null) this.nullAt = now;
      // the confirming probe, NULL_CONFIRM_MS after the first null (a reply to an older probe does not confirm)
      const at = this.nullAt + NULL_CONFIRM_MS;
      this.wait = this.env.setTimeout(() => { this.wait = null; if (!this.readOk && !this.unreadable) this.send('confirm'); }, Math.max(0, at - now));
      return;
    }
    if (validCloud(d)) {
      this.readOk = true;
      this.cb.read(d);
      return;
    }
    this.unreadable = true;
    this.cb.unreadable();
  }

  /** read-back */
  snapshot(): { state: PortalState; readOk: boolean; unreadable: boolean; localOrigin: boolean; probes: number; replies: number; ignored: number; bootDone: boolean } {
    return { state: this.state, readOk: this.readOk, unreadable: this.unreadable, localOrigin: this.localOrigin, probes: this.probes, replies: this.replies, ignored: this.ignored, bootDone: this.bootDone };
  }
}

/** the real page env. Touches window only when called. */
export function browserEnv(): StatsEnv {
  let framed = false;
  try { framed = !!window.parent && window.parent !== window; } catch { framed = false; }   // §S3.1: reading parent throws → standalone
  let kv: KV | null = null;
  try { kv = window.localStorage; } catch { kv = null; }
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
    random: () => Math.random(),
    kv,
    framed,
    post: (msg) => { try { window.parent.postMessage(msg, '*'); } catch { /* the portal is gone: nothing to do */ } },
    onMessage: (fn) => {
      window.addEventListener('message', (ev: MessageEvent) => {
        let fromParent = false;
        try { fromParent = ev.source === window.parent; } catch { fromParent = false; }
        fn(ev.data, ev.origin, fromParent);
      });
    },
    onHide: (fn) => {
      window.addEventListener('pagehide', () => fn());
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') fn(); });
    },
  };
}
