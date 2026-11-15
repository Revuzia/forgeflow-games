// GENESIS — keeping saves safe. Two jobs the save panel (ui/saves.ts) does not do itself:
//   1. after the first save, ask the browser to make this page's storage persistent (navigator.storage.persist), so a
//      low-disk eviction does not take the player's world;
//   2. in a window that cannot keep saves (a private window: no IndexedDB, or a tiny quota; or a save the browser
//      refused), say so once, in plain words: "saves unavailable, export your world".
// Pure logic takes its environment as an argument (tests pass fakes); `installPersistGuard` wires the real page and
// decorates a SaveStore's `put` without editing it. Nothing here throws into the game.

export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
}
export interface StorageEnv {
  storage?: StorageManagerLike;
  /** true when IndexedDB exists and a throwaway database can be opened (the real probe is `probeIndexedDb`) */
  idbUsable?: boolean;
}

/** below this quota a window is almost certainly private or ephemeral (a normal profile reports gigabytes) */
export const PRIVATE_QUOTA_BYTES = 150 * 1024 * 1024;

export const BANNER_TEXT = 'Saves are unavailable in this window (a private window cannot keep them). Export your world to a file from the Saves panel so you do not lose it.';

/** ask for persistent storage; null when the browser has no such call or it threw, else whether it was granted */
export async function requestPersist(s: StorageManagerLike | undefined): Promise<boolean | null> {
  try {
    if (!s || typeof s.persist !== 'function') return null;
    if (typeof s.persisted === 'function' && (await s.persisted())) return true;
    return await s.persist();
  } catch { return null; }
}

export interface Assessment { usable: boolean; reason: string }

/** can this window keep saves? (a quick check at start; a refused write is caught later by the decorator) */
export async function assessStorage(env: StorageEnv): Promise<Assessment> {
  if (env.idbUsable === false) return { usable: false, reason: 'IndexedDB is not available' };
  try {
    const est = await env.storage?.estimate?.();
    if (est && typeof est.quota === 'number' && est.quota > 0 && est.quota < PRIVATE_QUOTA_BYTES) {
      return { usable: false, reason: `the storage quota is only ${Math.round(est.quota / 1048576)} MB` };
    }
  } catch { /* an estimate that throws says nothing */ }
  return { usable: true, reason: '' };
}

/** open and delete a throwaway IndexedDB: false when the browser has none or refuses (older private windows) */
export function probeIndexedDb(idb: IDBFactory | undefined): Promise<boolean> {
  return new Promise((done) => {
    try {
      if (!idb) { done(false); return; }
      const name = `gn-probe-${Date.now().toString(36)}`;
      const r = idb.open(name, 1);
      r.onerror = () => done(false);
      r.onblocked = () => done(false);
      r.onsuccess = () => { try { r.result.close(); idb.deleteDatabase(name); } catch { /* probe only */ } done(true); };
    } catch { done(false); }
  });
}

// ───────────────────────────── the banner ─────────────────────────────

/** the small part of the DOM the banner uses (a fake in tests) */
export interface BannerDoc {
  getElementById(id: string): unknown;
  createElement(tag: string): BannerEl;
  body: { appendChild(e: BannerEl): unknown };
}
export interface BannerEl {
  id: string; textContent: string | null; style: { cssText: string }; remove(): void;
  setAttribute(k: string, v: string): void; appendChild(e: BannerEl): unknown; onclick: null | (() => void);
}

export const BANNER_ID = 'gn-saves-banner';

/** show the banner once (a second call is a no-op); returns whether it was added */
export function showSavesBanner(doc: BannerDoc, text: string = BANNER_TEXT): boolean {
  if (doc.getElementById(BANNER_ID)) return false;
  const bar = doc.createElement('div');
  bar.id = BANNER_ID;
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);max-width:min(640px,92vw);z-index:9999;display:flex;gap:12px;align-items:center;padding:8px 12px;border:1px solid rgba(217,184,120,.42);border-radius:6px;background:rgba(10,13,22,.88);color:#efe7d6;font:13px/1.35 Inter,system-ui,sans-serif;';
  const msg = doc.createElement('span');
  msg.textContent = text;
  const ok = doc.createElement('button');
  ok.textContent = 'Dismiss';
  ok.setAttribute('type', 'button');
  ok.style.cssText = 'flex:none;cursor:pointer;background:none;border:1px solid rgba(239,231,214,.3);color:#efe7d6;border-radius:4px;padding:2px 8px;font:inherit;';
  ok.onclick = () => bar.remove();
  bar.appendChild(msg);
  bar.appendChild(ok);
  doc.body.appendChild(bar);
  return true;
}

// ───────────────────────────── the wiring ─────────────────────────────

export interface PutStore { put(r: never): Promise<unknown> }

export interface GuardDeps {
  env: StorageEnv;
  doc?: BannerDoc;
  /** told what happened (tests; the page may log it) */
  note?: (what: 'persist' | 'banner', detail: string) => void;
}

const isQuota = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'QuotaExceededError';

/**
 * Decorate `store.put`: the first successful save asks for persistent storage; a save the browser refuses (other than a
 * full quota, which the panel already explains) puts the banner up. Also assesses the window at once. Returns a handle.
 */
export function installPersistGuard(store: PutStore, deps: GuardDeps): { persisted: () => boolean | null; bannerShown: () => boolean } {
  let persisted: boolean | null = null;
  let asked = false;
  let banner = false;
  const banish = (why: string): void => {
    if (banner || !deps.doc) return;
    banner = showSavesBanner(deps.doc);
    if (banner) deps.note?.('banner', why);
  };
  void assessStorage(deps.env).then((a) => { if (!a.usable) banish(a.reason); }).catch(() => undefined);
  const orig = store.put.bind(store) as (r: never) => Promise<unknown>;
  store.put = async (r: never): Promise<unknown> => {
    try {
      const k = await orig(r);
      if (!asked) {
        asked = true;
        void requestPersist(deps.env.storage).then((g) => { persisted = g; deps.note?.('persist', String(g)); });
      }
      return k;
    } catch (e) {
      if (!isQuota(e)) banish(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  return { persisted: () => persisted, bannerShown: () => banner };
}

/** the real page: probe IndexedDB, then guard the store. Safe to call where there is no window. */
export async function installPersistGuardOnPage(store: PutStore): Promise<void> {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const idbUsable = await probeIndexedDb(typeof indexedDB === 'undefined' ? undefined : indexedDB);
    installPersistGuard(store, { env: { storage: navigator.storage as StorageManagerLike | undefined, idbUsable }, doc: document as unknown as BannerDoc });
  } catch { /* the guard never stops the game */ }
}
