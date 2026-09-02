/* ============================================================================
 * ASCENDANT — runtime/net/portalsync.js
 * Ties stage progress to the player's ForgeFlow Games account.
 *
 * There is no new account system here. The portal already owns sign-in and
 * storage; when Ascendant is embedded in it, the parent frame speaks the
 * gameBridge protocol (src/lib/gameBridge.ts) and writes to the `game_saves`
 * table for the signed-in user:
 *
 *   game -> portal   {type:'forgeflow:save',  data, slot}
 *   game -> portal   {type:'forgeflow:load',  slot, _reqId}
 *   portal -> game   {type:'forgeflow:save_loaded', data, _reqId}
 *
 * RULES THIS MODULE OBEYS
 *   1. localStorage is the source of truth during play. The cloud is a sync
 *      layer on top of it, never a replacement for it.
 *   2. MERGE, NEVER CLOBBER. Everything goes through Save.mergeProgress(),
 *      which only ever raises a value. An empty, missing, late or malformed
 *      cloud record is a no-op — it can never cost a player their game.
 *   3. STAGE PROGRESS ONLY. Cleared / best / deaths / orbs, and the unlocks
 *      those imply. A checkpoint is a waypoint, not save state, and is never
 *      synced (Save.exportProgress omits cpIndex entirely).
 *   4. PUSH ON PROGRESS, NOT ON MOVEMENT. Only a clear or a new best schedules
 *      a push, debounced, plus one final flush on pagehide.
 *   5. STANDALONE MUST STILL WORK. Outside an iframe, signed out, or offline,
 *      every method is a silent no-op. Nothing here blocks boot and nothing
 *      here ever puts an error in front of a guest.
 * ==========================================================================*/

import { Save } from '../core/save.js';

const SLOT = 1;
const PUSH_DEBOUNCE_MS = 1500;
const LOAD_TIMEOUT_MS = 8000;

const IS_BROWSER = typeof window !== 'undefined';

/** Embedded in a portal page? Cross-origin access to `parent` can itself throw. */
function embedded() {
  if (!IS_BROWSER) return false;
  try { return !!window.parent && window.parent !== window; } catch (e) { return false; }
}

export const PortalSync = {
  /** 'off' until start() finds a parent frame; then 'idle' | 'loading' | 'synced'. */
  status: 'off',
  /** Set when a cloud record has been folded in — for the dev overlay. */
  lastMerge: null,
  /**
   * Optional callback, set by boot once the UI exists: fired when a cloud merge
   * actually changed something, so a record that lands after the menu has
   * painted still shows up without a reload.
   */
  onMerged: null,

  _on: false,
  _reqId: 0,
  _pending: null,     // {id, timer, resolve, promise}
  _timer: 0,
  _listener: null,
  _saveSub: null,

  /**
   * Wire up the bridge and pull the account's record once.
   * Resolves when the cloud record has been merged, or immediately when there
   * is no parent frame. NEVER rejects — boot must not depend on the network.
   *
   * @returns {Promise<{synced:boolean, merged:boolean, stages:number}>}
   */
  start() {
    const off = { synced: false, merged: false, stages: 0 };
    if (this._on || !embedded()) return Promise.resolve(off);
    this._on = true;
    this.status = 'idle';

    this._listener = (ev) => {
      let same = false;
      try { same = ev.source === window.parent; } catch (e) { same = false; }
      if (!same) return;
      const msg = ev.data;
      if (!msg || typeof msg !== 'object' || msg.type !== 'forgeflow:save_loaded') return;
      const p = this._pending;
      /* The bridge echoes _reqId; tolerate an older portal build that does not. */
      if (!p || (msg._reqId != null && msg._reqId !== p.id)) return;
      this._settle(msg.data, false);
    };
    try { window.addEventListener('message', this._listener, false); } catch (e) { /* ignore */ }

    /* Push only when real progress moved. These are the only events that can
       change what another device needs to know. */
    this._saveSub = (evt) => {
      if (!evt) return;
      if (evt.type === 'clear' || evt.type === 'best' || evt.type === 'unlock') this.schedulePush();
    };
    try { Save.on(this._saveSub); } catch (e) { /* ignore */ }

    const flush = () => { try { this.flush(); } catch (e) { /* ignore */ } };
    try {
      window.addEventListener('pagehide', flush, false);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      }, false);
    } catch (e) { /* ignore */ }

    return this.pull();
  },

  /**
   * Ask the portal for this account's record and MERGE it into the local save.
   * A timeout, a missing reply, a null record or an empty one all land on the
   * same harmless outcome: local progress untouched.
   */
  pull() {
    const none = { synced: false, merged: false, stages: 0 };
    if (!this._on || !embedded()) return Promise.resolve(none);
    if (this._pending) return this._pending.promise;

    const id = 'asc-' + (++this._reqId) + '-' + Date.now().toString(36);
    this.status = 'loading';

    let resolve = null;
    const promise = new Promise((res) => { resolve = res; });
    const timer = setTimeout(() => this._settle(undefined, true), LOAD_TIMEOUT_MS);
    this._pending = { id, timer, resolve, promise };

    try {
      window.parent.postMessage({ type: 'forgeflow:load', slot: SLOT, _reqId: id }, '*');
    } catch (e) {
      this._settle(undefined, true);
    }
    return promise;
  },

  /** Fold a reply in (or give up on one) exactly once. */
  _settle(data, timedOut) {
    const p = this._pending;
    if (!p) return;
    this._pending = null;
    try { clearTimeout(p.timer); } catch (e) { /* ignore */ }

    let res = { changed: false, stages: 0 };
    let readable = false;
    /* An absent / null / non-object record is the EMPTY CLOUD case: do nothing.
       mergeProgress is additive anyway, so this is belt and braces. */
    if (data && typeof data === 'object') {
      try {
        res = Save.mergeProgress(data) || res;
        /* READABLE means we actually understood the record — not merely that a
           reply arrived. A record whose `stages` is not an object (corrupted in
           storage, or written by a future schema) merges to nothing, and that is
           NOT permission to push over it. */
        readable = !!data.stages && typeof data.stages === 'object';
      } catch (e) { res = { changed: false, stages: 0 }; readable = false; }
    }
    this.status = timedOut ? 'idle' : 'synced';
    this.lastMerge = { at: Date.now(), changed: !!res.changed, stages: res.stages | 0, timedOut: !!timedOut };

    /* If the cloud was behind (or genuinely empty) push what this device knows,
       so the account catches up without waiting for the next clear.
       NOT when the record was unreadable: the portal upserts by REPLACEMENT, so
       pushing a fresh device's empty snapshot over a record we failed to parse
       would delete a real account's progress. An unreadable record is the one
       case where doing nothing is the only safe move — a later genuine clear
       still pushes through schedulePush() on the save event. */
    if (!timedOut && (readable || !data)) this.schedulePush();
    if (res.changed && typeof this.onMerged === 'function') {
      try { this.onMerged(this.lastMerge); } catch (e) { /* never break a sync */ }
    }
    p.resolve({ synced: !timedOut, merged: !!res.changed, stages: res.stages | 0 });
  },

  /** Debounced push. Cheap to call on every clear. */
  schedulePush() {
    if (!this._on || !embedded()) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = 0; this.push(); }, PUSH_DEBOUNCE_MS);
  },

  /** Send the current progress snapshot now. Silent on every failure. */
  push() {
    if (!this._on || !embedded()) return false;
    let payload = null;
    try { payload = Save.exportProgress(); } catch (e) { return false; }
    if (!payload) return false;
    try {
      window.parent.postMessage({ type: 'forgeflow:save', data: payload, slot: SLOT }, '*');
      return true;
    } catch (e) { return false; }
  },

  /** Cancel the debounce and push immediately (pagehide / manual). */
  flush() {
    if (this._timer) { try { clearTimeout(this._timer); } catch (e) { /* ignore */ } this._timer = 0; }
    return this.push();
  },

  /** Tear down (tests). */
  stop() {
    if (!this._on) return;
    this._on = false;
    this.status = 'off';
    if (this._timer) { try { clearTimeout(this._timer); } catch (e) { /* ignore */ } this._timer = 0; }
    if (this._pending) { try { clearTimeout(this._pending.timer); } catch (e) { /* ignore */ } this._pending = null; }
    try { if (this._listener) window.removeEventListener('message', this._listener, false); } catch (e) { /* ignore */ }
    try { if (this._saveSub) Save.off(this._saveSub); } catch (e) { /* ignore */ }
    this._listener = null;
    this._saveSub = null;
  },
};

export default PortalSync;
