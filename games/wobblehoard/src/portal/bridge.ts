// The ForgeFlow Games portal bridge client (_handoff/design/PUBLISH_CHECKLIST_SHORT.md section 2; the machine is Blocktooth's net/portal.ts and Dyefield's
// stats/portal.ts). It lives HERE, outside src/collection (probe I04 bans postMessage there), and imports nothing from the game.
//
// WHAT IT EVER SENDS (the privacy line in copy.ts is pinned to exactly this; the probe enforces it):
//     forgeflow:whoami       { type, _reqId }                  "who is signed in?": no data about the player. Answered for guests too.
//     forgeflow:achievement  { type, achievementSlug }         one trophy's slug, signed in only
//   Nothing else, ever: no score (Squish Keeper sends none unless the owner asks), no save, no load (no cloud save at launch: the Hoard is device-only,
//   COLLECTION C-6), no Hoard, item id, genome, nickname, setting or timing. The `OutMsg` type below is the whole list, so a third kind does not compile.
// WHAT IT READS:  forgeflow:identity { _reqId?, signedIn, id, ... } from window.parent only. Only `signedIn` and `id` are used (`id` keys the
//   once-per-trophy sets; it is never shown, stored or sent back). The username and the avatar are never read: they are email-derived.
//
// STATES
//     standalone  no parent window: NOTHING is posted, no listener is installed, nothing can break
//     waiting     framed; whoami asked, up to 3 times, 4 s apart
//     silent      framed but the parent never answered (an older portal, a plain iframe): nothing but those 3 whoami probes, ever. A later pushed
//                 identity still flips it (the listener stays).
//     guest       the portal answered signedIn:false: still only whoami
//     signedIn    the portal answered signedIn:true
// ACHIEVEMENTS (the portal drops guests and unknown slugs, unlocks idempotently, and gives XP = the row's points x the Badge of the Day):
//     * posted only when signed in, only for slugs this build knows (`known`), at most ONCE per slug per account per page
//     * on a signed-in identity (the first for an account, or a return after a sign-out) every trophy already earned is posted, oldest first,
//       ACH_GAP_MS (1.1 s) apart. Live unlocks go through the same pacer, so a burst is spread too.
//     * a sign-out or another account drops what was still waiting; the next sign-in posts it again (the sent set is per account)
// REPLIES are accepted only when `ev.source === window.parent` AND the origin is the portal's (or a local test host); a reply that carries a _reqId we did
// not issue is ignored.

export type PortalState = 'standalone' | 'waiting' | 'silent' | 'guest' | 'signedIn';

/** The whole list of what this client can post. */
export type OutMsg =
  | { type: 'forgeflow:whoami'; _reqId: string }
  | { type: 'forgeflow:achievement'; achievementSlug: string };

export const WHOAMI_TRIES = 3;
export const WHOAMI_WAIT_MS = 4000;
/** Two achievement posts are always at least this far apart (the memo asks for 1 s; Dyefield uses 3 s). */
export const ACH_GAP_MS = 1100;

export interface PortalEnv {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  /** inside a frame whose parent is another window */
  framed: boolean;
  /** window.parent.postMessage(msg, '*') inside try/catch */
  post(msg: OutMsg): void;
  /** window 'message' events: (data, origin, fromParent = ev.source === window.parent). Returns the unsubscribe function. */
  onMessage(fn: (data: unknown, origin: string, fromParent: boolean) => void): () => void;
}

const LOCAL_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const PAGES_RE = /^https:\/\/[a-z0-9-]+\.forgeflow-games\.pages\.dev$/;
const PROD = new Set(['https://forgeflowgames.com', 'https://www.forgeflowgames.com', 'https://forgeflow-games.pages.dev']);

/** The portal's origins (forgeflowgames.com, www, forgeflow-games.pages.dev and its previews) plus localhost / 127.0.0.1 for the local stand-in host. */
export function portalOriginAllowed(origin: string): boolean {
  return PROD.has(origin) || PAGES_RE.test(origin) || LOCAL_RE.test(origin);
}

export interface BridgeDeps {
  env: PortalEnv;
  /** may this slug be posted? (the 20 rows of data/achievements.json: an unknown slug is dropped by the portal, and this keeps anything else from leaving) */
  known(slug: string): boolean;
  /** every trophy earned so far, as slugs, oldest first */
  earned(): readonly string[];
}

export interface BridgeStats { whoami: number; achievements: number; replies: number; ignored: number }

export interface PortalBridge {
  readonly state: PortalState;
  readonly signedIn: boolean;
  /** install the listener and ask who is signed in (idempotent; a no-op standalone) */
  start(): void;
  /** a trophy was earned: post it (only when signed in; paced; once per slug per account per page) */
  achievement(slug: string): void;
  /** the state changed (an account line may need a redraw). Returns the unsubscribe function. */
  onChange(fn: () => void): () => void;
  readonly stats: BridgeStats;
  dispose(): void;
}

export function createPortalBridge(d: BridgeDeps): PortalBridge {
  const env = d.env;
  let state: PortalState = env.framed ? 'waiting' : 'standalone';
  let started = false, disposed = false;
  let offMsg: (() => void) | null = null;
  let tries = 0, seq = 0;
  let whoamiTimer: unknown = null;
  const issued = new Set<string>();
  /** the account the portal reported, or null (a guest). Never shown, never sent. */
  let account: string | null = null;
  const sent = new Map<string, Set<string>>();
  let queue: string[] = [];
  let pump: unknown = null;
  let lastPostAt = -Infinity;
  let listeners: Array<() => void> = [];
  const stats: BridgeStats = { whoami: 0, achievements: 0, replies: 0, ignored: 0 };

  const changed = (): void => { for (const f of listeners) { try { f(); } catch { /* a screen's redraw must not break the bridge */ } } };
  const send = (m: OutMsg): void => { try { env.post(m); } catch { /* the portal is gone: nothing to do */ } };

  function askWhoami(): void {
    if (disposed || state !== 'waiting') return;
    tries++;
    stats.whoami++;
    const id = `sk${++seq}`;
    issued.add(id);
    send({ type: 'forgeflow:whoami', _reqId: id });
    whoamiTimer = env.setTimeout(() => {
      whoamiTimer = null;
      if (disposed || state !== 'waiting') return;
      if (tries < WHOAMI_TRIES) { askWhoami(); return; }
      state = 'silent';   // an older portal or a plain frame: quiet for good (a pushed identity can still change it)
      changed();
    }, WHOAMI_WAIT_MS);
  }

  function stopPump(): void {
    if (pump !== null) { env.clearTimeout(pump); pump = null; }
    queue = [];
  }

  function runPump(): void {
    pump = null;
    if (disposed || state !== 'signedIn' || account === null) { queue = []; return; }
    const slug = queue.shift();
    if (slug === undefined) return;
    const set = sentFor(account);
    if (!set.has(slug)) {
      set.add(slug);
      stats.achievements++;
      lastPostAt = env.now();
      send({ type: 'forgeflow:achievement', achievementSlug: slug });
    }
    if (queue.length) pump = env.setTimeout(runPump, ACH_GAP_MS);
  }

  function sentFor(acct: string): Set<string> {
    let s = sent.get(acct);
    if (!s) { s = new Set(); sent.set(acct, s); }
    return s;
  }

  function enqueue(slug: string): void {
    if (queue.includes(slug)) return;
    queue.push(slug);
    if (pump !== null) return;
    const wait = Math.max(0, lastPostAt + ACH_GAP_MS - env.now());
    if (wait === 0) runPump(); else pump = env.setTimeout(runPump, wait);
  }

  function post(slug: string): void {
    if (state !== 'signedIn' || account === null || !d.known(slug)) return;
    if (sentFor(account).has(slug)) return;
    enqueue(slug);
  }

  function onIdentity(m: Record<string, unknown>): void {
    const rid = m._reqId;
    if (rid !== undefined && (typeof rid !== 'string' || !issued.has(rid))) { stats.ignored++; return; }   // a reply to something we never asked
    stats.replies++;
    if (whoamiTimer !== null) { env.clearTimeout(whoamiTimer); whoamiTimer = null; }
    const id = m.signedIn === true && typeof m.id === 'string' && m.id !== '' && m.id.length <= 128 ? m.id : null;
    const was = state, prev = account;
    if (id === null) {
      state = 'guest';
      account = null;
      stopPump();
    } else {
      state = 'signedIn';
      if (prev !== null && prev !== id) stopPump();   // another account: nothing queued for the last one may go out under this one
      account = id;
      if (was !== 'signedIn' || prev !== id) for (const slug of d.earned()) post(slug);   // the catch-up: whatever is earned and not yet posted for this account
    }
    if (was !== state || prev !== account) changed();
  }

  const onMessage = (data: unknown, origin: string, fromParent: boolean): void => {
    if (disposed || !fromParent) return;
    if (!portalOriginAllowed(origin)) { stats.ignored++; return; }
    if (!data || typeof data !== 'object') return;
    const m = data as Record<string, unknown>;
    if (m.type === 'forgeflow:identity') onIdentity(m);
  };

  return {
    get state() { return state; },
    get signedIn() { return state === 'signedIn'; },
    start() {
      if (started || disposed) return;
      started = true;
      if (!env.framed) { state = 'standalone'; return; }   // no parent: no listener, no post, nothing
      state = 'waiting';
      offMsg = env.onMessage(onMessage);
      askWhoami();
    },
    achievement: post,
    onChange(fn) {
      listeners = listeners.concat(fn);
      return () => { listeners = listeners.filter((f) => f !== fn); };
    },
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (whoamiTimer !== null) { env.clearTimeout(whoamiTimer); whoamiTimer = null; }
      stopPump();
      if (offMsg) { try { offMsg(); } catch { /* ignore */ } offMsg = null; }
      listeners = [];
    },
  };
}

/** The real page env. Touches window only when called (so importing this file in node is safe). */
export function browserEnv(): PortalEnv {
  let framed = false;
  try { framed = !!window.parent && window.parent !== window; } catch { framed = false; }   // reading it threw: stay standalone, the quiet default
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
    framed,
    post: (msg) => { try { window.parent.postMessage(msg, '*'); } catch { /* detached */ } },
    onMessage: (fn) => {
      const h = (ev: MessageEvent): void => {
        let fromParent = false;
        try { fromParent = ev.source === window.parent; } catch { fromParent = false; }
        fn(ev.data, ev.origin, fromParent);
      };
      window.addEventListener('message', h);
      return () => window.removeEventListener('message', h);
    },
  };
}
