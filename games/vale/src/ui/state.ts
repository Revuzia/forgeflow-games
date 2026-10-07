// VALE UI — client state as signals bound to the Session (contracts/session.ts). The UI never reads
// the sim or the profile store: everything arrives as SessionEvents, and every action is a Session
// call. Session events also drive the match-flow routes (draft → loading → match → post-game).

import { batch, computed, signal } from '@preact/signals';
import type {
  DraftState, GrantSummary, MatchClient, PartyMember, Profile, Session, SessionEvent, Settings,
} from '../contracts/session.ts';
import type { MatchResult, MatchSetup, PlayerId } from '../contracts/sim.ts';
import type { CatalogView } from './catalog_view.ts';
import { fmtWait } from './format.ts';
import type { Router } from './router.ts';
import type { UiSound } from './audio_port.ts';

export type QueueEvt = Extract<SessionEvent, { type: 'queue' }>;
export interface Toast { id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'error'; action?: { label: string; run: () => void }; ms: number }
export type FrayColors = 'standard' | 'stamp' | 'simple';
/** UI-only preferences that have no Settings field yet (requested in the lane report), per device */
export interface UiPrefs { frayColors: FrayColors | 'auto'; seenScreens: string[]; lastMode?: string; lastQueue?: string; roles?: [string?, string?] }

const PREFS_KEY = 'vale.ui.v1';
function loadPrefs(): UiPrefs {
  const d: UiPrefs = { frayColors: 'auto', seenScreens: [] };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...d, ...(JSON.parse(raw) as Partial<UiPrefs>) };
  } catch { /* private window, blocked storage */ }
  return d;
}

export interface RendererPort {
  setScene?(scene: 'menu' | MatchClient): void;
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
  /** true from accept until the draft opens */
  readonly accepted = signal(false);

  private toastSeq = 1;
  private off: (() => void) | null = null;

  constructor(o: { session: Session; cv: CatalogView; router: Router; sound: UiSound; renderer?: RendererPort | null }) {
    this.session = o.session; this.cv = o.cv; this.router = o.router; this.sound = o.sound; this.renderer = o.renderer ?? null;
    this.profile.value = o.session.profile();
    this.party.value = o.session.party();
    this.off = o.session.on((e) => this.onEvent(e));
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
      case 'error': this.lastError.value = e.message; console.warn('[vale] session:', e.message); break;
      case 'queue': {
        const prev = this.queue.value;
        batch(() => {
          this.queue.value = e;
          if (e.state === 'searching' && prev?.state !== 'searching') this.searchStartedAt.value = performance.now();
          if (e.state === 'found' && prev?.state !== 'found') { this.accepted.value = false; this.sound.play('queue_pop'); }
          if (e.state === 'accepted') this.accepted.value = true;
        });
        if (e.state === 'found' && prev?.state !== 'found') this.flashTitle(cv.t('ready.title', 'Match found'));
        if (e.state === 'declined' || (e.state === 'idle' && e.reason)) {
          this.accepted.value = false;
          const lock = e.lockout && e.lockout > 0 ? cv.t('queue.lockout', ' You can queue again in {t}.', { t: fmtWait(e.lockout) }) : '';
          const why = e.reason === 'timeout' ? cv.t('queue.timeout', 'The ready check ran out.')
            : e.reason === 'declined' ? cv.t('queue.declined', 'The match was declined.')
              : e.reason === 'dodged' ? cv.t('queue.dodged', 'You left the draft.')
                : e.reason === 'cancelled' ? cv.t('queue.cancelled', 'Search cancelled.') : '';
          if (why) this.toast(`${why}${lock}`, e.reason === 'cancelled' ? 'info' : 'warn');
          if (r.route.value.screen === 'draft' || r.route.value.screen === 'queue') r.reset('play', {}, 'back');
        }
        break;
      }
      case 'draft': {
        const first = !this.draft.value;
        this.draft.value = e.state;
        this.accepted.value = false;
        if (first || r.route.value.screen !== 'draft') {
          if (r.route.value.screen !== 'draft') { this.sound.play('confirm'); r.reset('draft', {}, 'forward'); }
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
      case 'postgame':
        batch(() => { this.postgame.value = { result: e.result, grants: e.grants, you: e.you }; this.match.value = null; this.loading.value = null; this.queue.value = null; });
        this.renderer?.setScene?.('menu');
        r.reset('postgame', {}, 'wipe');
        break;
    }
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
