// DYEFIELD — the stats session (_spec/CONTRACT_STATS.md §S3.3 / §S5 / §S6.2 / §S11). DOM-free: every page dependency
// comes through StatsEnv (portal.ts), so the node probe runs this exact code on a fake clock.
//
//   recorder outcome → the bucket the portal state allows (§S5.2):
//       signed-in + readOk → the account bucket · standalone / guest → the guest bucket ·
//       probing / signed-in without readOk → pending (applied at the first readOk, or to guest when the boot ends in guest)
//   eligible record → detectors (§S6) on the display career → toasts at once + the paced achievement queue
//   score (§S4) → posted at once when signed-in (readOk not needed), else the outbox
//   account bucket changed → a debounced thin save (1.5 s, ≥ 4 s apart; readOk only; never for an unreadable record)
//   readOk → pick / make the account tag, take the cloud copy of MY slot as a floor (storage-less: its base), claim a
//            non-empty guest slot, apply pending, the 7-day achievement self-heal, the repair push
//
// The paced queue (§S3.3 CHANGED(review)): every forgeflow:achievement goes through ONE queue that lives in the outbox —
// one post, then ACH_GAP_MS, then the next; one post per slug per page session; a reload resumes the rest. Score and save
// posts never wait for it.

import type { SimEvent } from '../core/match/events.ts';
import type {
  AcctSlot, AchievementDef, BeginInfo, CloudRecord, DisplayCareer, LocalStore, MatchRecord, OnlineEndStatus, OnlineFinal,
  Outcome, OutboxItem, PortalState, SentEntry, Slot, StatsWorldView,
} from './types.ts';
import { MatchRecorder } from './recorder.ts';
import { ACH_BY_SLUG, ACHIEVEMENTS, detect } from './achievements.ts';
import {
  addSlot, applyOutcome, emptyAcct, emptySlot, emptyStore, foldSlots, maxMergeSlot, normSlot, PENDING_MAX, pickTag,
  provisionalSlot, randomToken, readStore, slotBehind, slotIsEmpty, slotKeyFor, STORE_KEY, STORE_KEY_DEV, storageWorks,
  thinPayload, writeStore, mergePreservingKeys,
} from './career.ts';
import { PortalLink, type StatsEnv } from './portal.ts';

export const ACH_GAP_MS = 3000;
export const SAVE_DEBOUNCE_MS = 1500;
export const SAVE_MIN_GAP_MS = 4000;
export const SCORE_MAX_AGE_MS = 6 * 3600 * 1000;
export const SELF_HEAL_MS = 7 * 24 * 3600 * 1000;
export const OUTBOX_MAX = 64;
export const SENT_MAX = 50;

export type BucketKind = 'guest' | 'account' | 'pending' | null;

export interface CoreOptions {
  env: StatsEnv;
  /** false: ?dev=1 without ?statsdev=1 — no record, no post, no store write (§S11) */
  enabled: boolean;
  statsDev: boolean;
  /** an achievement unlocked (show the toast; xp = the account will get its XP) */
  onUnlock?(a: AchievementDef, xp: boolean): void;
  /** a one-line note (the guest claim) */
  onNote?(text: string): void;
  /** anything the CAREER panel shows changed */
  onChange?(): void;
}

export class StatsCore {
  readonly env: StatsEnv;
  readonly enabled: boolean;
  readonly statsDev: boolean;
  readonly storageless: boolean;
  readonly storeKey: string;
  readonly link: PortalLink;
  readonly recorder: MatchRecorder;
  store: LocalStore;
  /** the account context, set at readOk */
  tag: string | null = null;
  slotKey: string | null = null;
  tagSince = 0;
  cloud: CloudRecord | null = null;
  lastRecord: MatchRecord | null = null;
  readonly sent: SentEntry[] = [];
  readonly postedThisSession = new Set<string>();
  private toasted = new Set<string>();
  private o: CoreOptions;
  private achTimer: unknown = null;
  private lastAchPostAt = -Infinity;
  private saveTimer: unknown = null;
  private lastSaveAt = -Infinity;
  private lastSavedJson = '';
  private started = false;
  /** errors swallowed by the hook wrappers (read-back) */
  errors: string[] = [];

  constructor(o: CoreOptions) {
    this.o = o;
    this.env = o.env;
    this.enabled = o.enabled;
    this.statsDev = o.statsDev;
    this.storeKey = o.statsDev ? STORE_KEY_DEV : STORE_KEY;
    // the write-then-read storage test is itself a write: a disabled session (?dev=1 without ?statsdev=1) only reads
    this.storageless = o.enabled ? !storageWorks(o.env.kv) : !o.env.kv;
    this.store = this.storageless ? emptyStore(() => o.env.random()) : readStore(o.env.kv, this.storeKey, () => o.env.random());
    this.link = new PortalLink(o.env, {
      signedIn: () => this.onSignedIn(),
      read: (rec) => this.onReadOk(rec),
      unreadable: () => this.changed(),
      guest: () => this.onGuest(),
    });
    this.recorder = new MatchRecorder({
      statsDev: o.statsDev,
      sink: (oc) => this.onOutcome(oc),
      now: () => o.env.now(),
      newId: () => randomToken(8, () => o.env.random()),
    });
  }

  // ───────────────────────────── lifecycle / hooks ─────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.enabled) return;
    this.env.onHide(() => this.guard(() => this.onHide()));
    this.link.start();
    if (this.link.state === 'standalone') this.resolvePendingToGuest();
  }

  matchBegin(view: StatsWorldView, info: BeginInfo): void {
    if (this.enabled) this.guard(() => this.recorder.begin(view, info));
  }
  events(ev: readonly SimEvent[], view: StatsWorldView): void {
    if (this.enabled) this.guard(() => this.recorder.events(ev, view));
  }
  matchAbandon(view: StatsWorldView | null, why: 'dispose' | 'restart'): void {
    if (this.enabled) this.guard(() => this.recorder.abandon(view, why));
  }
  onlineEnd(status: OnlineEndStatus, fin?: OnlineFinal): void {
    if (this.enabled) this.guard(() => this.recorder.onlineEnd(status, fin));
  }
  /** the CAREER panel opened: one re-probe while unresolved (§S3.3) */
  careerOpened(): void {
    if (this.enabled) this.guard(() => this.link.reprobe());
  }

  /** a stats bug never stops a frame (§S10.1) */
  guard(fn: () => void): void {
    try { fn(); } catch (e) {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      if (this.errors.length < 20) this.errors.push(msg.slice(0, 600));
      try { console.warn('[dyefield stats]', e); } catch { /* no console */ }
    }
  }

  // ───────────────────────────── read-backs ─────────────────────────────

  get portal(): PortalState {
    if (!this.enabled) return this.env.framed ? 'guest' : 'standalone';
    return this.link.state;
  }
  get readOk(): boolean { return this.link.readOk && this.tag !== null; }

  bucketKind(): BucketKind {
    if (!this.enabled) return null;
    if (this.readOk) return 'account';
    const s = this.link.state;
    return s === 'standalone' || s === 'guest' ? 'guest' : 'pending';
  }

  get account(): AcctSlot | null { return this.tag ? (this.store.accts[this.tag] ?? null) : null; }

  /** §S5.4: every cloud slot with mine replaced by my bucket (readOk); otherwise the guest slot plus pending */
  display(): DisplayCareer {
    const acct = this.account;
    if (this.readOk && acct) {
      const slots: Slot[] = [];
      if (this.cloud) for (const k of Object.keys(this.cloud.slots)) if (k !== this.slotKey) slots.push(normSlot(this.cloud.slots[k]));
      slots.push(acct);
      return foldSlots(slots);
    }
    return foldSlots([provisionalSlot(this.store.guest, this.store.pending, this.store.pendingX)]);
  }

  /** the thin payload the next push would send (null before readOk) */
  cloudPreview(): CloudRecord | null {
    const acct = this.account;
    if (!this.readOk || !acct || !this.tag || !this.slotKey) return null;
    return thinPayload(this.tag, this.tagSince, this.slotKey, acct);
  }

  /** may a score / achievement / save go out right now? ('live'), later ('queue': probing / guest), never ('none') */
  postMode(): 'live' | 'queue' | 'none' {
    if (!this.enabled) return 'none';
    const s = this.link.state;
    if (s === 'standalone') return 'none';
    if (s !== 'signed-in') return 'queue';
    if (this.statsDev && !this.link.localOrigin) return 'none';   // §S11: statsdev posts only to a localhost portal
    return 'live';
  }

  // ───────────────────────────── outcomes ─────────────────────────────

  private onOutcome(o: Outcome): void {
    const at = this.bucketKind();
    if (o.k === 'record') this.lastRecord = o.rec;
    if (at === 'account') {
      const acct = this.account!;
      applyOutcome(acct, o);
      // §S3.2: a save follows a FINALIZED record (eligible or idle); an abandon / a void only bumps a counter, which rides
      // along with the next save or the pagehide save (S-f: a quit posts nothing)
      if (o.k === 'record') { this.unlock(o.rec, acct); this.requestSave(); }
    } else if (at === 'guest') {
      applyOutcome(this.store.guest, o);
      if (o.k === 'record') this.unlock(o.rec, this.store.guest);
    } else if (at === 'pending') {
      if (o.k === 'record') {
        this.store.pending.push(o.rec);
        if (this.store.pending.length > PENDING_MAX) this.store.pending.splice(0, this.store.pending.length - PENDING_MAX);
        this.unlock(o.rec, null);
      } else if (o.k === 'abandoned') this.store.pendingX.abandoned++;
      else this.store.pendingX.void++;
    } else return;
    if (o.k === 'record' && o.rec.eligible && o.rec.score > 0) this.postScore(o.rec.score);
    this.persist();
    this.link.reprobe();                                     // §S3.3: one re-probe at every finalize while unresolved
    this.changed();
  }

  /** §S6.2: detectors on the display career (after the record was applied); a slug already unlocked anywhere I know is
   *  skipped; new ones go into the bucket (none for pending: set when it is applied), toast at once, and queue */
  private unlock(r: MatchRecord, bucket: Slot | null): void {
    if (!r.eligible) return;
    const disp = this.display();
    const fresh: string[] = [];
    for (const slug of detect(r, disp.c)) {
      if (slug in disp.ach) continue;
      if (bucket) bucket.ach[slug] = r.at;
      fresh.push(slug);
    }
    for (const slug of fresh) {
      if (!this.toasted.has(slug)) {
        this.toasted.add(slug);
        const a = ACH_BY_SLUG.get(slug);
        if (a) this.safeCall(() => this.o.onUnlock?.(a, this.link.state === 'signed-in'));
      }
      this.queueAch(slug);
    }
  }

  private safeCall(fn: () => void): void { try { fn(); } catch (e) { if (this.errors.length < 20) this.errors.push(String(e)); } }

  // ───────────────────────────── the outbox + the paced queue ─────────────────────────────

  queueAch(slug: string): void {
    const mode = this.postMode();
    if (mode === 'none') return;
    if (this.postedThisSession.has(slug)) return;
    const ob = this.store.outbox;
    if (ob.some((it) => it.k === 'ach' && it.slug === slug)) return;
    ob.push({ k: 'ach', slug });
    this.trimOutbox();
    this.persist();
    this.pump();
  }

  private postScore(score: number): void {
    const mode = this.postMode();
    if (mode === 'live') { this.send({ type: 'forgeflow:score', score: Math.round(score) }, { score: Math.round(score) }); return; }
    if (mode === 'queue') {
      this.store.outbox.push({ k: 'score', score: Math.round(score), at: this.env.now() });
      this.trimOutbox();
    }
  }

  private trimOutbox(): void {
    const ob = this.store.outbox;
    while (ob.length > OUTBOX_MAX) {
      const i = ob.findIndex((it) => it.k === 'score');
      ob.splice(i >= 0 ? i : 0, 1);
    }
  }

  /** post the next queued achievement if the gap allows; re-arms itself while items remain */
  pump(): void {
    if (this.postMode() !== 'live' || this.achTimer !== null) return;
    const ob = this.store.outbox;
    let i = ob.findIndex((it) => it.k === 'ach');
    while (i >= 0 && this.postedThisSession.has((ob[i] as { slug: string }).slug)) {
      ob.splice(i, 1);
      i = ob.findIndex((it) => it.k === 'ach');
    }
    if (i < 0) { this.persist(); return; }
    const now = this.env.now();
    const wait = this.lastAchPostAt + ACH_GAP_MS - now;
    if (wait > 0) {
      this.achTimer = this.env.setTimeout(() => { this.achTimer = null; this.guard(() => this.pump()); }, wait);
      return;
    }
    const slug = (ob[i] as { slug: string }).slug;
    ob.splice(i, 1);
    this.postedThisSession.add(slug);
    this.lastAchPostAt = now;
    this.send({ type: 'forgeflow:achievement', achievementSlug: slug }, { slug });
    this.persist();
    this.achTimer = this.env.setTimeout(() => { this.achTimer = null; this.guard(() => this.pump()); }, ACH_GAP_MS);
  }

  private send(msg: Record<string, unknown>, extra: { slug?: string; score?: number }): void {
    if (!this.link.post(msg)) return;
    this.sent.push({ type: String(msg.type), ...extra, at: this.env.now() });
    if (this.sent.length > SENT_MAX) this.sent.splice(0, this.sent.length - SENT_MAX);
  }

  // ───────────────────────────── portal transitions ─────────────────────────────

  private onSignedIn(): void {
    // the outbox's score items go out now (older than 6 h: dropped — the portal stamps the CURRENT week); achievements pump
    const ob = this.store.outbox;
    const now = this.env.now();
    const scores = ob.filter((it): it is Extract<OutboxItem, { k: 'score' }> => it.k === 'score');
    this.store.outbox = ob.filter((it) => it.k !== 'score');
    if (this.postMode() === 'live') {
      for (const s of scores) if (now - s.at <= SCORE_MAX_AGE_MS) this.send({ type: 'forgeflow:score', score: s.score }, { score: s.score });
    }
    this.persist();
    this.pump();
    this.changed();
  }

  private onGuest(): void {
    this.resolvePendingToGuest();
    this.changed();
  }

  private resolvePendingToGuest(): void {
    const st = this.store;
    if (!st.pending.length && !st.pendingX.abandoned && !st.pendingX.void) return;
    for (const r of st.pending) { applyOutcome(st.guest, { k: 'record', rec: r }); this.unlock(r, st.guest); }
    st.guest.c.abandoned += st.pendingX.abandoned;
    st.guest.c.online.void += st.pendingX.void;
    st.pending = [];
    st.pendingX = { abandoned: 0, void: 0 };
    this.persist();
  }

  private onReadOk(rec: CloudRecord | null): void {
    const st = this.store;
    const now = this.env.now();
    this.cloud = rec ? { ...rec, slots: { ...rec.slots }, tags: { ...rec.tags } } : null;
    const pick = pickTag(rec, st.accts);
    let tag: string;
    if (pick) tag = pick.tag;
    else tag = randomToken(10, () => this.env.random());
    if (!st.accts[tag]) st.accts[tag] = emptyAcct(now);
    const acct = st.accts[tag];
    const cloudSince = rec && typeof rec.tags[tag] === 'number' ? rec.tags[tag] : Infinity;
    this.tagSince = Math.min(cloudSince, acct.since || now);
    acct.since = this.tagSince;
    this.tag = tag;
    st.lastTag = tag;
    this.slotKey = slotKeyFor(st.dev, tag, this.storageless);
    const cloudMine = rec ? rec.slots[this.slotKey] : undefined;
    const cloudMineN = cloudMine ? normSlot(cloudMine) : undefined;
    if (cloudMineN) maxMergeSlot(acct, cloudMineN);            // storage-less: the base; otherwise a floor (never lowers)
    this.lastSavedJson = cloudMineN ? JSON.stringify(thinPayload(tag, this.tagSince, this.slotKey, cloudMineN).slots[this.slotKey]) : '';
    // the guest claim (§S5.2 / §S6.3): fold a non-empty guest slot into this account, post its achievements
    if (!slotIsEmpty(st.guest)) {
      const before = this.display().ach;
      const guestAch = Object.keys(st.guest.ach);
      addSlot(acct, st.guest);
      st.guest = emptySlot(0);
      const claimed = guestAch.filter((s) => !(s in before));
      for (const s of guestAch) this.queueAch(s);
      if (claimed.length) this.safeCall(() => this.o.onNote?.(`${claimed.length} achievement${claimed.length === 1 ? '' : 's'} saved to your account`));
    }
    // pending records: applied to the account now (detectors re-run; posts dedupe)
    if (st.pending.length || st.pendingX.abandoned || st.pendingX.void) {
      for (const r of st.pending) { applyOutcome(acct, { k: 'record', rec: r }); this.unlock(r, acct); }
      acct.c.abandoned += st.pendingX.abandoned;
      acct.c.online.void += st.pendingX.void;
      st.pending = [];
      st.pendingX = { abandoned: 0, void: 0 };
    }
    // the 7-day self-heal: re-queue every unlocked achievement (the portal no-ops the ones it has). A storage-less session
    // cannot keep its achSyncAt stamp, so it would re-post everything on every load: it skips the self-heal (its own
    // unlocks are posted fresh through the queue as usual).
    if (!this.storageless && now - acct.achSyncAt >= SELF_HEAL_MS) {
      for (const s of Object.keys(this.display().ach)) if (ACH_BY_SLUG.has(s)) this.queueAch(s);
      acct.achSyncAt = now;
    }
    this.persist();
    // the repair push: the cloud copy of MY slot is behind my bucket (an interleaved save lost it, a pagehide skipped it)
    if (slotBehind(cloudMineN, acct)) this.requestSave();
    this.pump();
    this.changed();
  }

  // ───────────────────────────── saves ─────────────────────────────

  requestSave(): void {
    if (!this.readOk || this.link.unreadable || this.postMode() !== 'live') return;
    if (this.saveTimer !== null) return;                     // a later request coalesces into the scheduled save
    const now = this.env.now();
    const due = Math.max(now + SAVE_DEBOUNCE_MS, this.lastSaveAt + SAVE_MIN_GAP_MS);
    this.saveTimer = this.env.setTimeout(() => { this.saveTimer = null; this.guard(() => this.doSave()); }, due - now);
  }

  private doSave(): void {
    const p = this.cloudPreview();
    if (!p || this.postMode() !== 'live') return;
    this.send({ type: 'forgeflow:save', slot: 1, data: p }, {});
    this.lastSaveAt = this.env.now();
    this.lastSavedJson = JSON.stringify(p.slots[this.slotKey!]);
    this.cloud = mergePreservingKeys(this.cloud, p) as CloudRecord;
  }

  /** pagehide / hidden: push only when my slot changed since the last save, and only outside the 4 s gap (a skipped one is
   *  restored by the next session's repair push) */
  private onHide(): void {
    this.persist();
    const p = this.cloudPreview();
    if (!p || this.postMode() !== 'live' || this.link.unreadable) return;
    if (JSON.stringify(p.slots[this.slotKey!]) === this.lastSavedJson) return;
    if (this.env.now() - this.lastSaveAt < SAVE_MIN_GAP_MS) return;
    if (this.saveTimer !== null) { this.env.clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.doSave();
  }

  // ───────────────────────────── storage ─────────────────────────────

  persist(): void {
    if (!this.enabled || this.storageless) return;
    writeStore(this.env.kv, this.storeKey, this.store);
  }

  private changed(): void { this.safeCall(() => this.o.onChange?.()); }

  /** __DF_STATS__.state() */
  snapshot(): Record<string, unknown> {
    const d = this.display();
    return {
      version: 'stats-1',
      enabled: this.enabled,
      statsDev: this.statsDev,
      portal: this.portal,
      readOk: this.readOk,
      unreadable: this.link.unreadable,
      localOrigin: this.link.localOrigin,
      bucket: this.bucketKind(),
      storage: this.storageless ? 'memory' : 'local',
      slotKey: this.slotKey,
      outbox: this.store.outbox.length,
      outboxItems: this.store.outbox.map((it) => ({ ...it })),
      pending: this.store.pending.length,
      sent: this.sent.map((s) => ({ ...s })),
      lastRecord: this.lastRecord ? { ...this.lastRecord } : null,
      display: { counters: d.c, bests: d.best, ach: d.ach },
      achDefs: ACHIEVEMENTS.length,
      link: this.link.snapshot(),
      openRecord: this.recorder.openId,
      errors: this.errors.slice(),
    };
  }
}
