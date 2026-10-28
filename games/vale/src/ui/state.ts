// VALE UI — client state as signals bound to the Session (contracts/session.ts). The UI never reads
// the sim or the profile store: everything arrives as SessionEvents, and every action is a Session
// call. Session events also drive the match-flow routes (draft → loading → match → post-game).

import { batch, computed, signal } from '@preact/signals';
import type {
  DraftState, GrantSummary, MatchClient, OnlineInfo, PartyMember, Profile, QueueRequest, Session, SessionEvent, Settings,
} from '../contracts/session.ts';
import type { MatchResult, MatchSetup, PlayerId } from '../contracts/sim.ts';
import type { CatalogView } from './catalog_view.ts';
import { fmtWait } from './format.ts';
import type { Router } from './router.ts';
import type { UiSound } from './audio_port.ts';
import { ReadyAlert } from './ready_alert.ts';

export type QueueEvt = Extract<SessionEvent, { type: 'queue' }>;
export interface Toast { id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error'; action?: { label: string; run: () => void }; ms: number }
export type FrayColors = 'standard' | 'stamp' | 'simple';
/** UI-only preferences that have no Settings field yet (requested in the lane report), per device */
export interface UiPrefs { frayColors: FrayColors | 'auto'; seenScreens: string[]; lastMode?: string; lastQueue?: string; roles?: [string?, string?] }

const PREFS_KEY = 'vale.ui.v1';
/** seconds left on an unanswered ready check when the reminder (queue_remind) sounds and the notification is raised again */
export const READY_REMIND_S = 4;
/** how long the end banner holds over the last frame before the shadow-line wipe to the post-game */
export const END_HOLD_MS = 3800;
function loadPrefs(): UiPrefs {
  const d: UiPrefs = { frayColors: 'auto', seenScreens: [] };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<UiPrefs>) };
  } catch { /* private window, blocked storage */ }
  return d;
}

/** what the UI uses of the renderer (CONTRACT §9; src/render/renderer.ts implements all of it) */
export interface RendererPort {
  setScene?(scene: 'menu' | MatchClient): void;
  resize?(width?: number, height?: number): void;
  render?(dt: number): void;
  setQuality?(video: Settings['video']): void;
  setSettings?(patch: Partial<Settings>): void;
  /** OPTIONAL (requested): point the menu camera at a station / show a fighter on the plinth */
  setMenuView?(view: { screen: string; fighter?: string; skin?: string; mode?: string }): void;
  /** OPTIONAL (requested): load a match's assets, reporting 0..1 */
  preload?(setup: MatchSetup, onProgress: (p: number) => void): Promise<void>;
}

export class AppState {
  readonly session: Session;
  readonly cv: CatalogView;
  readonly router: Router;
  readonly sound: UiSound;
  readonly renderer: RendererPort | null;

  readonly profile = signal<Profile>(null as unknown as Profile);
  readonly settings = computed<Settings>(() => this.profile.value.settings);
  readonly queue = signal<QueueEvt | null>(null);
  readonly searchStartedAt = signal(0);
  readonly draft = signal<DraftState | null>(null);
  readonly loading = signal<{ setup: MatchSetup; progress: number } | null>(null);
  readonly match = signal<MatchClient | null>(null);
  readonly lastSetup = signal<MatchSetup | null>(null);
  readonly postgame = signal<{ result: MatchResult; grants: GrantSummary; you: PlayerId } | null>(null);
  readonly party = signal<PartyMember[]>([]);
  readonly toasts = signal<Toast[]>([]);
  readonly prefs = signal<UiPrefs>(loadPrefs());
  readonly lastError = signal<string | null>(null);
  /** the game-server link (null: this build plays offline) */
  readonly online = signal<OnlineInfo | null>(null);
  /** true from accept until the draft opens */
  readonly accepted = signal(false);
  /** the last re-queue lockout the session gave (seconds): the next is double, capped at 60 (CONTRACT §7) */
  lastLockoutS = 0;
  /** re-queue lockout end (performance.now() ms); 0 = none */
  readonly lockoutUntil = signal(0);
  /** the request the player last queued with (play again, queue screen labels) */
  readonly lastRequest = signal<QueueRequest | null>(null);
  /** the match has ended and its last frame is held under the end banner (END_HOLD_MS) */
  readonly ending = signal(false);
  /** 1 Hz clock for countdowns that are not rings (lockout lines) */
  readonly now = signal(performance.now());

  /** the hidden-tab channels of the ready check: system notification + favicon badge (AUD-2, UI half) */
  readonly readyAlert = new ReadyAlert();

  private toastSeq = 1;
  private off: (() => void) | null = null;
  /** the reason the current queue flow already ended with (a decline arrives as 'declined' then 'idle'): one notice per flow */
  private flowEnd: string | null = null;
  /** the reminder already sounded for this ready check */
  private reminded = false;

  constructor(o: { session: Session; cv: CatalogView; router: Router; sound: UiSound; renderer?: RendererPort | null }) {
    this.session = o.session; this.cv = o.cv; this.router = o.router; this.sound = o.sound; this.renderer = o.renderer ?? null;
    this.profile.value = o.session.profile();
    this.party.value = o.session.party();
    this.off = o.session.on((e) => this.onEvent(e));
    setInterval(() => {
      this.now.value = performance.now();
      const o = this.session.online?.() ?? null;
      const cur = this.online.peek();
      if (JSON.stringify(o) !== JSON.stringify(cur)) this.online.value = o;
    }, 500);
  }

  /** seconds left on the re-queue lockout */
  readonly lockoutLeft = computed(() => Math.max(0, (this.lockoutUntil.value - this.now.value) / 1000));

  /** queue with a request; matchmade queues go to the search screen, custom/practice straight to their draft */
  queueFor(req: QueueRequest): void {
    const q = this.cv.queue(req.queue);
    this.lastRequest.value = req;
    this.lastError.value = null;
    this.session.queue(req);
    if (q && q.kind !== 'custom' && q.kind !== 'practice' && this.queue.value?.state === 'searching') {
      // Find match is a user gesture: the one moment a browser lets the page ask to notify (once per device)
      this.readyAlert.prime();
      this.sound.play('queue_search');
      if (this.router.route.value.screen !== 'queue') this.router.go('queue', {}, { transition: 'forward' });
    }
  }
  /** Play again: Session.playAgain when offered, else the last request */
  playAgain(): void {
    if (this.session.playAgain) { this.readyAlert.prime(); this.session.playAgain(); this.sound.play('queue_search'); }
    else if (this.lastRequest.value) this.queueFor(this.lastRequest.value);
  }

  dispose(): void { this.off?.(); this.off = null; }

  setPrefs(p: Partial<UiPrefs>): void {
    this.prefs.value = { ...this.prefs.value, ...p };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs.value)); } catch { /* per-device convenience only */ }
  }
  /** FRAY seat colouring in effect: Stamp-forward is the default whenever a colourblind mode is on */
  readonly frayColors = computed<FrayColors>(() => {
    const p = this.prefs.value.frayColors;
    if (p !== 'auto') return p;
    return this.settings.value.access.colorblind !== 'off' ? 'stamp' : 'standard';
  });

  toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ms = 4200): void {
    const t: Toast = { id: this.toastSeq++, text, tone, action, ms };
    this.toasts.value = [...this.toasts.value.slice(-2), t];
    if (tone === 'error') this.sound.play('error'); else this.sound.play('notify', 300);
    setTimeout(() => this.dismissToast(t.id), ms);
  }
  dismissToast(id: number): void { this.toasts.value = this.toasts.value.filter((t) => t.id !== id); }

  refreshParty(): void { this.party.value = this.session.party(); }

  // ── session events ────────────────────────────────────────────────────────────────────────────
  private onEvent(e: SessionEvent): void {
    const cv = this.cv, r = this.router;
    switch (e.type) {
      case 'profile': this.profile.value = e.profile; break;
      case 'error': {
        this.lastError.value = e.message;
        console.warn('[vale] session:', e.message);
        // draft refusals carry a reason code the strings localise (error.draft.<reason>)
        const m = /^draft: (\w+)$/.exec(e.message);
        if (m) this.toast(cv.t(`error.draft.${m[1]}`, cv.t('error.draft.unknown_action', "You can't do that right now.")), 'error');
        break;
      }
      case 'queue': {
        const prev = this.queue.value;
        const popped = e.state === 'found' && prev?.state !== 'found';
        // a new search or ready check: the flow is open again
        if (e.state === 'searching' || e.state === 'found' || e.state === 'accepted') this.flowEnd = null;
        batch(() => {
          this.queue.value = e;
          if (e.state === 'searching' && prev?.state !== 'searching') this.searchStartedAt.value = performance.now();
          if (popped) { this.accepted.value = false; this.reminded = false; this.sound.play('queue_pop'); }
          if (e.state === 'accepted') this.accepted.value = true;
        });
        if (popped) {
          this.flashTitle(cv.t('ready.title', 'Match found'));
          this.sound.duck(true);
          this.readyAlert.found(cv.t('ready.title', 'Match found'), this.readyLine(e, 'ready.notify.body', '{mode} · {queue}. Come back and press Ready within {t}.'));
        }
        // the check is about to close on you: the reminder bell, and the notification once more
        if (e.state === 'found' && !this.reminded && e.readyTimer !== undefined && e.readyTimer > 0 && e.readyTimer <= READY_REMIND_S) {
          this.reminded = true;
          this.sound.play('queue_remind');
          this.readyAlert.remind(cv.t('ready.title', 'Match found'), this.readyLine(e, 'ready.notify.remind', 'The ready check closes in {t}. Press Ready to keep your place.'));
        }
        if (e.state !== 'found') { this.sound.duck(false); this.readyAlert.clear(); }
        if (e.lockout && e.lockout > 0) { this.lockoutUntil.value = performance.now() + e.lockout * 1000; if (e.reason) this.lastLockoutS = e.lockout; }
        if (e.state === 'accepted') this.lastLockoutS = 0;
        if ((e.state === 'searching' || e.state === 'found') && r.route.value.screen !== 'queue') r.reset('queue', {}, 'forward');
        if (e.state === 'idle' && !e.reason && e.lockout) this.toast(cv.t('queue.lockout_banner', 'You can queue again in {t}.', { t: fmtWait(e.lockout) }), 'warn');
        if (e.state === 'declined' || (e.state === 'idle' && e.reason)) {
          // the flow is over: nothing of the ready check or the draft outlives it (the client's chrome follows the
          // route, but a stale draft would still label the bar and keep the draft board's data alive)
          batch(() => { this.accepted.value = false; this.draft.value = null; });
          const why = e.reason ?? 'declined';
          // a local decline or timeout arrives twice ('declined', then 'idle'): one notice per flow end
          if (this.flowEnd !== why) {
            this.flowEnd = why;
            const lock = e.lockout && e.lockout > 0 ? cv.t('queue.lockout', ' You can queue again in {t}.', { t: fmtWait(e.lockout) }) : '';
            const text = why === 'timeout' ? cv.t('queue.timeout', 'The ready check ran out.')
              : why === 'declined' ? cv.t('queue.declined', 'The match was declined.')
                : why === 'dodged' ? cv.t('queue.dodged', 'You left the draft.')
                  : why === 'cancelled' ? cv.t('queue.cancelled', 'Search cancelled.') : '';
            if (text) this.toast(`${text}${lock}`, why === 'cancelled' ? 'info' : 'warn');
          }
          // back to Play from anywhere inside the flow (Settings opened over a draft included)
          if (r.inStack((sc) => sc === 'draft' || sc === 'queue')) r.reset('play', {}, 'back');
        }
        break;
      }
      case 'draft': {
        const first = !this.draft.value;
        this.draft.value = e.state;
        this.accepted.value = false;
        // practice with a preset fighter goes straight to loading (its draft is already decided); otherwise
        // the queue screen (and its ready check) leaves under the wipe, never sliding over the draft board
        const decided = cv.queue(e.state.queue)?.kind === 'practice' && e.state.phase !== 'pick' && e.state.phase !== 'ban';
        if ((first || r.route.value.screen !== 'draft') && !decided) {
          if (r.route.value.screen !== 'draft') { this.sound.play('confirm'); r.reset('draft', {}, 'wipe'); }
        }
        if (e.state.phase === 'done') { /* loading follows */ }
        break;
      }
      case 'loading':
        batch(() => { this.loading.value = { setup: e.setup, progress: e.progress }; this.lastSetup.value = e.setup; this.draft.value = null; });
        if (r.route.value.screen !== 'loading') r.reset('loading', {}, 'wipe');
        break;
      case 'match':
        this.match.value = e.client;
        this.renderer?.setScene?.(e.client);
        r.reset('match', {}, 'fade');
        break;
      case 'postgame': {
        // the match-end sting plays over the end banner; the last frame holds before the wipe
        const me = e.result.players.find((p) => p.player === e.you);
        const ffa = cv.isFfa(cv.mode(e.result.mode));
        if (me && e.result.reason !== 'abandon') this.sound.sting(ffa ? 'placement' : me.won ? 'victory' : 'defeat');
        const show = (): void => {
          batch(() => { this.postgame.value = { result: e.result, grants: e.grants, you: e.you }; this.match.value = null; this.loading.value = null; this.queue.value = null; this.ending.value = false; });
          this.renderer?.setScene?.('menu');
          r.reset('postgame', {}, 'wipe');
        };
        if (this.match.value && r.route.value.screen === 'match' && e.result.reason !== 'abandon') { this.ending.value = true; setTimeout(show, END_HOLD_MS); }
        else show();
        break;
      }
    }
  }

  /** a ready-check line for the notification: mode, queue and the seconds left */
  private readyLine(e: QueueEvt, key: string, fallback: string): string {
    const q = this.cv.queue(e.queue);
    const mode = this.cv.mode(q?.mode);
    return this.cv.t(key, fallback, { mode: mode?.name ?? '', queue: q?.name ?? '', t: fmtWait(Math.max(1, Math.ceil(e.readyTimer ?? e.readyMax ?? 10))) });
  }

  private titleTimer = 0;
  private flashTitle(text: string): void {
    if (typeof document === 'undefined') return;
    const base = 'VALE';
    clearInterval(this.titleTimer);
    let on = true, n = 0;
    document.title = `${text} · ${base}`;
    this.titleTimer = window.setInterval(() => {
      on = !on; n++;
      document.title = on ? `${text} · ${base}` : base;
      if (n > 24 || this.queue.value?.state !== 'found') { clearInterval(this.titleTimer); document.title = base; }
    }, 500);
  }
}
