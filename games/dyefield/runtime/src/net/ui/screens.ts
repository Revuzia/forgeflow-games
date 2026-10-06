// DYEFIELD — the PLAY ONLINE screens (LOBBY-UI, CONTRACT_ONLINE §O4.1–O4.3, §O10, §O12.3).
//
// DOM over the live lobby backdrop, in the menus' own language (Lilita One + Nunito, ink outlines, hard drop shadows,
// the menus' card / segmented-button / BACK classes from ui/menus.css), lazily loaded with the rest of net/** when
// PLAY ONLINE opens. Screens:
//   home    PLAY ONLINE — MODE (TEAMS · 4 v 4 / FREE-FOR-ALL) + RULE (TURF / WASHOUT), defaulting to the profile's and
//           written back to it; the three doors QUICK MATCH / CREATE ROOM / JOIN ROOM; the player's plate (LOADOUT).
//   join    JOIN ROOM — one code field (4 characters, upper-cased, alphabet-filtered; the phone keyboard opens on it)
//           plus an on-screen keypad of the 32 code characters for the gamepad and as a tap alternative.
//   search  the waiting card: CONNECTING… / FINDING PLAYERS… N waiting + the elapsed time / NO ONE ELSE YET (KEEP
//           WAITING · PLAY VS BOTS) / MATCH FOUND (a quick room's members, the auto-start countdown).
//   room    a code room: the big code + COPY / SHARE, 8 seat rows (humans: crew mark, name, OWNER / YOU, kit, device,
//           ping, KICK for the owner; empty seats BOT), the owner's MODE / RULE / ARENA / TIME OF DAY / BOTS + START
//           (≥ 2 humans connected), read-only values for everyone else, LEAVE.
//   notice  every error / closed / kicked / quota / unsupported / update / voided card, with its way out.
// The screens follow OnlineApi.status() (§O11.1): a room going to loading / live / post hides them (hooks.matchPhase:
// the match UI is SYNC's and onlinehud.ts's) and a code room back in `room` (PLAY AGAIN) shows the room screen again.
// Navigation: ./nav.ts (the menus' model: spatial arrows / d-pad, Enter / A, Esc / B, mouse hover; touch taps).

import './ui.css';
import { WEAPONS, playableMaps } from '../../core/data.ts';
import { KIT_ICONS, MAP_THUMBS } from '../../ui/icons.ts';
import { crewLook } from '../../ui/slates.ts';
import { touchModeOn, watchTouchMode } from '../../ui/boot.ts';
import { cleanName } from '../../ui/settings.ts';
import { MODE_LABELS, RULE_LABELS } from '../../ui/menus.ts';
import { NavController } from './nav.ts';
import { glyph, type GlyphName } from './glyphs.ts';
import {
  CODE_ALPHABET, CODE_LENGTH, MAX_HUMANS, QM_AUTOSTART_S, cleanCode, colorblindOn, onlineSupported, reduceMotionOn, type UiSettingsLike,
  type NetErrorCode, type NetStatus, type OnlineApi, type OnlineEvent, type OnlineMode, type OnlineProfile, type OnlineRule,
  type OnlineSkill, type RoomMember, type RoomView,
} from './types.ts';

// ───────────────────────────── copy (the harness asserts these) ─────────────────────────────
export const ONLINE_TEXT = {
  title: 'PLAY ONLINE',
  hint: 'Jump into a match, or play with friends',
  quick: 'QUICK MATCH', quickLine: 'Jump into the next open match',
  create: 'CREATE ROOM', createLine: 'Get a code to share with friends',
  join: 'JOIN ROOM', joinLine: 'Enter a friend’s 4-character code',
  youHint: 'Your name and kit come from LOADOUT',
  joinHint: 'Type the code your friend shared',
  codeNote: 'Codes use A–Z and 2–9 — never I, O, 0 or 1.',
  joinBtn: 'JOIN',
  connecting: 'CONNECTING…', finding: 'FINDING PLAYERS…', solo: 'NO ONE ELSE YET', found: 'MATCH FOUND!', joiningMatch: 'JOINING THE MATCH…',
  hostLeft: 'HOST LEFT', hostLeftLine: 'Picking a new host — hang on…',
  queueLine: 'Your match starts as soon as a room is ready.',
  keepWaiting: 'KEEP WAITING', playBots: 'PLAY VS BOTS', cancel: 'CANCEL',
  room: 'ROOM', share: 'Share this code with a friend. They pick JOIN ROOM and enter it.',
  roomHint: 'Up to 8 players · bots fill the rest',
  copyCode: 'COPY CODE', copyLink: 'COPY INVITE LINK', shareBtn: 'SHARE',
  players: 'PLAYERS', bot: 'BOT', you: 'YOU', owner: 'OWNER', kick: 'KICK', sure: 'SURE?',
  start: 'START', leave: 'LEAVE', needTwo: 'Waiting for one more player — share the code.',
  waitOwner: (n: string): string => `Waiting for ${n} to start the match.`,
  ready: (n: number): string => (n >= MAX_HUMANS ? `${n} players — a full room, no bots.` : `${n} players ready · bots fill ${MAX_HUMANS - n} seat${MAX_HUMANS - n === 1 ? '' : 's'}.`),
  unsupported: 'Your browser can’t play online',
} as const;

/** the notice cards (§O3.3 error codes + closed / kicked / voided) */
type NoticeAction = 'retry' | 'rejoin' | 'join' | 'home' | 'bots' | 'reload';
interface NoticeDef { title: string; text: string; icon: GlyphName; tone: 'warn' | 'bad' | 'info'; primary: [string, NoticeAction]; secondary?: [string, NoticeAction] }
export const NOTICES: Record<NetErrorCode | 'closed' | 'voided' | 'court', NoticeDef> = {
  room_full: { title: 'ROOM IS FULL', text: 'That room already has 8 players. Ask for another code, or start your own room.', icon: 'full', tone: 'warn', primary: ['TRY ANOTHER CODE', 'join'], secondary: ['BACK', 'home'] },
  not_found: { title: 'NO ROOM WITH THAT CODE', text: 'Check the 4 characters with your friend — the room may have closed.', icon: 'warn', tone: 'warn', primary: ['TRY AGAIN', 'join'], secondary: ['BACK', 'home'] },
  busy: { title: 'ROOMS ARE BUSY', text: 'A room could not be opened just now. Try again in a moment.', icon: 'warn', tone: 'warn', primary: ['TRY AGAIN', 'retry'], secondary: ['BACK', 'home'] },
  build: { title: 'UPDATE DYEFIELD', text: 'This room runs a different version of the game. Reload the page to get the latest one.', icon: 'update', tone: 'info', primary: ['RELOAD', 'reload'], secondary: ['BACK', 'home'] },
  proto: { title: 'UPDATE DYEFIELD', text: 'The online service has been updated. Reload the page to get the latest game.', icon: 'update', tone: 'info', primary: ['RELOAD', 'reload'], secondary: ['BACK', 'home'] },
  quota: { title: 'ONLINE IS FULL FOR TODAY', text: 'Today’s free online matches are used up.', icon: 'clock', tone: 'info', primary: ['PLAY VS BOTS', 'bots'], secondary: ['BACK', 'home'] },
  rate: { title: 'TOO MUCH TRAFFIC', text: 'The connection sent too fast and was closed. Try again.', icon: 'warn', tone: 'warn', primary: ['TRY AGAIN', 'retry'], secondary: ['BACK', 'home'] },
  origin: { title: 'CAN’T PLAY ONLINE HERE', text: 'Online matches run on forgeflowgames.com and the DYEFIELD game page. Open DYEFIELD there to play with others.', icon: 'offline', tone: 'bad', primary: ['BACK', 'home'] },
  bad: { title: 'SOMETHING WENT WRONG', text: 'The room did not accept that request. Try again.', icon: 'warn', tone: 'warn', primary: ['TRY AGAIN', 'retry'], secondary: ['BACK', 'home'] },
  network: { title: 'CONNECTION LOST', text: 'The online service could not be reached. Check your connection and try again.', icon: 'offline', tone: 'bad', primary: ['TRY AGAIN', 'retry'], secondary: ['BACK', 'home'] },
  unsupported: { title: 'YOUR BROWSER CAN’T PLAY ONLINE', text: 'Online play needs a newer browser. Update it, or play a match against bots.', icon: 'offline', tone: 'bad', primary: ['PLAY VS BOTS', 'bots'], secondary: ['BACK', 'home'] },
  kicked: { title: 'REMOVED FROM THE ROOM', text: 'The room’s owner removed you.', icon: 'door', tone: 'info', primary: ['BACK', 'home'] },
  closed: { title: 'ROOM CLOSED', text: 'This room has closed.', icon: 'door', tone: 'info', primary: ['BACK', 'home'] },
  voided: { title: 'MATCH CALLED OFF', text: 'The host’s connection dropped too many times, so this match ended with no result.', icon: 'warn', tone: 'warn', primary: ['BACK', 'home'] },
  // §O4.5 step 3: the host found this device's atlasSig different (SYNC calls showNotice('court'))
  court: { title: 'THIS DEVICE BUILT A DIFFERENT COURT', text: 'This device built a different court — reload the page to play online. A bot keeps your seat meanwhile.', icon: 'update', tone: 'warn', primary: ['RELOAD', 'reload'], secondary: ['LEAVE', 'home'] },
};
/** kicked / closed reasons → their line (§O7.4: "Removed for inactivity"; §O4.3: idle rooms close after 15 min) */
const WHY_TEXT: Record<string, string> = {
  idle: 'Removed for inactivity.',
  owner: 'The room’s owner removed you.',
  room_idle: 'The room closed after 15 minutes without a start.',
  empty: 'Everyone left, so the room closed.',
  host: 'The host left and no one could take over.',
};

const SKILL_TEXT: Record<OnlineSkill, string> = { breeze: 'BREEZE', swell: 'SWELL', storm: 'STORM' };
const PRESET_TEXT: Record<string, string> = { noon: 'NOON', golden: 'GOLDEN HOUR' };
const LIGHT_TEXT: Record<string, string> = { lockwell: 'INTERIOR LIGHTS', cinder: 'WARM OVERCAST', random: 'SET BY THE ARENA' };

export type OnlineScreen = 'home' | 'join' | 'search' | 'room' | 'notice';
type SearchState = 'connecting' | 'queue' | 'solo' | 'found' | 'loading' | 'hostleft';
export type UiSound = 'hover' | 'click' | 'back' | 'start';

/** the profile fields the screens read (ProfileStore satisfies it) */
export interface ProfileLike {
  get(): Readonly<{ name: string; kit: string; crew: number; mode: string; rule: string; ffaColor: number }>;
  set?(p: { mode?: OnlineMode; rule?: OnlineRule }): unknown;
  on?(fn: () => void): () => void;
}

export interface OnlineScreensHooks {
  /** BACK from the PLAY ONLINE root: show the title again (Menus.returnFromOnline) */
  close(): void;
  /** PLAY VS BOTS (solo prompt, quota / unsupported cards): the normal offline match with this mode and rule */
  playOffline(mode: OnlineMode, rule: OnlineRule): void;
  /** the screens hid for a match (loading / live / post) or came back (null): SYNC switches the backdrop */
  matchPhase?(phase: 'loading' | 'live' | 'post' | null, room: RoomView | null): void;
  sound?(s: UiSound): void;
  /** UPDATE DYEFIELD → RELOAD (default location.reload()) */
  reload?(): void;
}

export interface OnlineScreensOptions {
  api: OnlineApi;
  profile: ProfileLike;
  hooks: OnlineScreensHooks;
  /** a shared NavController (the HUD overlays use the same one); one is made when absent */
  nav?: NavController;
  /** SETTINGS (REDUCE MOTION); absent → the OS preference */
  settings?: UiSettingsLike;
}

// ───────────────────────────── tiny DOM helpers ─────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(cls: string, text: string, id?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.dataset.nav = '';
  if (id) b.id = id;
  return b;
}
const kitRow = (id: string) => WEAPONS.kits.find((k) => k.id === id) ?? WEAPONS.kits[0];
const fmtClock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** a map chip's short name: the arena's name less its last word (PIER 18 PLAZA → PIER 18, CINDER REEF → CINDER) */
const shortMapName = (full: string): string => { const w = full.split(' '); return w.length > 1 ? w.slice(0, -1).join(' ') : full; };
const pingClass = (ms: number | null): string => (ms === null ? 'na' : ms <= 120 ? 'good' : ms <= 250 ? 'ok' : 'bad');

/** the name an unnamed player plays online under: GUEST-XXXX (§O8's own default shape), the same for the whole tab session so a
 *  reconnect or a rematch keeps it — without it every unnamed player would sit in the room as the same "YOU" */
let guest = '';
export function guestName(): string {
  if (guest) return guest;
  try { guest = sessionStorage.getItem('dyefield.net.guest') ?? ''; } catch { /* blocked: a per-page name is fine */ }
  if (!/^GUEST-[A-Z2-9]{4}$/.test(guest)) {
    guest = 'GUEST-';
    for (let i = 0; i < 4; i++) guest += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    try { sessionStorage.setItem('dyefield.net.guest', guest); } catch { /* blocked */ }
  }
  return guest;
}

/** best-effort clipboard (navigator.clipboard, then a hidden textarea + execCommand); false when both refuse */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { await navigator.clipboard.writeText(text); return true; }
  } catch { /* the portal iframe may lack clipboard-write: fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** time to the next 00:00 UTC (the relay's daily budget resets then, §O0.1), as "5 h 12 min" */
export function untilUtcMidnight(now = Date.now()): string {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const min = Math.max(1, Math.ceil((next - now) / 60000));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

interface SeatRow { li: HTMLElement; num: HTMLElement; mark: HTMLElement; name: HTMLElement; badges: HTMLElement; kit: HTMLImageElement;
  dev: HTMLElement; ping: HTMLElement; kick: HTMLButtonElement; slot: number | null; armT: number }

export class OnlineScreens {
  readonly root: HTMLElement;
  screen: OnlineScreen | null = null;
  readonly nav: NavController;
  private readonly ownNav: boolean;
  private readonly api: OnlineApi;
  private readonly profile: ProfileLike;
  private readonly hooks: OnlineScreensHooks;
  private readonly screens = new Map<OnlineScreen, HTMLElement>();
  private popNav: (() => void) | null = null;
  private offs: Array<() => void> = [];
  private st: NetStatus = { kind: 'idle' };
  /** hidden because a match is loading / live / over (the match UI is up) */
  private matchHidden = false;
  private lastDoor: { door: 'qm' | 'create' | 'join'; mode: OnlineMode; rule: OnlineRule; code: string } = { door: 'qm', mode: 'teams', rule: 'turf', code: '' };
  /** the door HOME focuses: QUICK MATCH on open, the door just used when backing out of its screen */
  private homeFocus: 'qm' | 'create' | 'join' = 'qm';
  private touch = touchModeOn();
  // home
  private readonly modeBtns = new Map<OnlineMode, HTMLButtonElement>();
  private readonly ruleBtns = new Map<OnlineRule, HTMLButtonElement>();
  private readonly ruleNote: HTMLElement;
  private readonly doorBtns = new Map<'qm' | 'create' | 'join', HTMLButtonElement>();
  private readonly doorChips: HTMLElement[] = [];
  private readonly you: HTMLElement;
  // join
  private readonly codeInput: HTMLInputElement;
  private readonly codeBoxes: HTMLElement[] = [];
  private readonly joinBtn: HTMLButtonElement;
  private readonly keypad: HTMLElement;
  // search
  private readonly searchCard: HTMLElement;
  private readonly searchTitle: HTMLElement;
  private readonly searchChips: HTMLElement;
  private readonly searchStats: HTMLElement;
  private readonly searchLine: HTMLElement;
  private readonly searchPeople: HTMLElement;
  private readonly searchActions: HTMLElement;
  private searchState: SearchState = 'connecting';
  private queue = { waiting: 0, waitedS: 0, at: 0 };
  private foundAt = 0;
  private ticker = 0;
  // room
  private readonly roomCode: HTMLElement;
  private readonly roomCount: HTMLElement;
  private readonly seats: SeatRow[] = [];
  private readonly roomSegs = new Map<string, HTMLButtonElement>();
  private readonly roomVals = new Map<string, HTMLElement>();
  private readonly roomOwnerOnly: HTMLElement[] = [];
  private readonly roomReadOnly: HTMLElement[] = [];
  private readonly todRow: HTMLElement;
  private readonly todSeg: HTMLElement;
  private readonly todNote: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly startNote: HTMLElement;
  private readonly linkBtn: HTMLButtonElement;
  private readonly roomTitle: HTMLElement;
  private lastRoom: RoomView | null = null;
  /** the code of the room this session was last in (a CONNECTION LOST in a room offers RETRY into it, §O7.2) */
  private lastCode = '';
  // notice
  private readonly noticeCard: HTMLElement;
  private readonly noticeIcon: HTMLElement;
  private readonly noticeTitle: HTMLElement;
  private readonly noticeText: HTMLElement;
  private readonly noticeDetail: HTMLElement;
  private readonly noticeBtns: HTMLElement;
  private noticeKind = '';
  // toasts + hints
  private readonly toasts: HTMLElement;
  /** read-back: the last toasts shown (they live 2.6 s on screen) */
  private readonly toastLog: string[] = [];
  private readonly hints: HTMLElement;

  constructor(host: HTMLElement, o: OnlineScreensOptions) {
    this.api = o.api;
    this.profile = o.profile;
    this.hooks = o.hooks;
    this.ownNav = !o.nav;
    this.nav = o.nav ?? new NavController();
    this.root = el('div', 'dfm dfo');
    this.root.id = 'df-online';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', ONLINE_TEXT.title);

    // ── HOME (PLAY ONLINE) ────────────────────────────────
    const home = this.mkScreen('home');
    home.append(el('div', 'dfm-scrim full'), this.header(ONLINE_TEXT.title, ONLINE_TEXT.hint, 'BACK', () => this.close()));
    const setup = el('div', 'dfo-setup');
    const pill = (cap: string, seg: HTMLElement): HTMLElement => { const p = el('div', 'dfo-pillbox'); p.append(el('h3', 'dfm-cap', cap), seg); return p; };
    const modeSeg = el('div', 'dfo-seg');
    modeSeg.setAttribute('role', 'radiogroup');
    modeSeg.setAttribute('aria-label', 'Mode');
    for (const [m, label] of MODE_LABELS) {
      const b = btn('dfm-segbtn', label, `dfo-mode-${m}`);
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { this.sound('click'); this.profile.set?.({ mode: m }); this.refreshHome(); });
      this.modeBtns.set(m, b);
      modeSeg.append(b);
    }
    const ruleSeg = el('div', 'dfo-seg');
    ruleSeg.setAttribute('role', 'radiogroup');
    ruleSeg.setAttribute('aria-label', 'Rule');
    for (const [r, label, line] of RULE_LABELS) {
      const b = btn('dfm-segbtn', label, `dfo-rule-${r}`);
      b.setAttribute('role', 'radio');
      b.title = line;
      b.addEventListener('click', () => { this.sound('click'); this.profile.set?.({ rule: r }); this.refreshHome(); });
      this.ruleBtns.set(r, b);
      ruleSeg.append(b);
    }
    this.ruleNote = el('p', 'dfo-rulenote', '');
    this.ruleNote.setAttribute('aria-live', 'polite');
    setup.append(pill('MODE', modeSeg), pill('RULE', ruleSeg), this.ruleNote);
    const doors = el('div', 'dfo-doors');
    const door = (k: 'qm' | 'create' | 'join', icon: GlyphName, title: string, line: string): HTMLButtonElement => {
      const b = btn(`dfo-door dfo-door-${k}`, '', `dfo-door-${k}`);
      const art = el('div', 'art');
      art.append(glyph(icon, 'dfo-doorg'));
      const chips = el('div', 'chips');
      this.doorChips.push(chips);
      b.append(art, el('b', 'name', title), el('span', 'line', line), chips);
      this.doorBtns.set(k, b);
      return b;
    };
    const qm = door('qm', 'quick', ONLINE_TEXT.quick, ONLINE_TEXT.quickLine);
    qm.dataset.default = '';
    qm.addEventListener('click', () => this.doQuick());
    const cr = door('create', 'create', ONLINE_TEXT.create, ONLINE_TEXT.createLine);
    cr.addEventListener('click', () => this.doCreate());
    const jn = door('join', 'join', ONLINE_TEXT.join, ONLINE_TEXT.joinLine);
    jn.addEventListener('click', () => { this.sound('click'); this.openJoin(''); });
    doors.append(qm, cr, jn);
    this.you = el('div', 'dfo-you');
    const body = el('div', 'dfo-body dfo-homebody');
    body.append(setup, doors, this.you);
    home.append(body);

    // ── JOIN ROOM ─────────────────────────────────────────
    const join = this.mkScreen('join');
    join.append(el('div', 'dfm-scrim full'), this.header(ONLINE_TEXT.join, ONLINE_TEXT.joinHint, 'BACK', () => this.backFromJoin()));
    const jb = el('div', 'dfo-body dfo-joinbody');
    const codeCard = el('div', 'dfm-card dfo-codecard');
    const field = el('label', 'dfo-codefield');
    field.setAttribute('for', 'dfo-code');
    const boxes = el('div', 'dfo-codeboxes');
    boxes.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < CODE_LENGTH; i++) { const b = el('span', 'box', ''); this.codeBoxes.push(b); boxes.append(b); }
    this.codeInput = el('input', 'dfo-code');
    this.codeInput.id = 'dfo-code';
    this.codeInput.type = 'text';
    this.codeInput.maxLength = CODE_LENGTH + 2;         // room for a paste with a space; cleanCode trims it to 4
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.setAttribute('autocapitalize', 'characters');
    this.codeInput.setAttribute('autocorrect', 'off');
    this.codeInput.setAttribute('inputmode', 'text');
    this.codeInput.setAttribute('enterkeyhint', 'go');
    this.codeInput.setAttribute('aria-label', 'Room code, 4 characters');
    this.codeInput.dataset.nav = '';
    this.codeInput.addEventListener('input', () => this.syncCode(true));
    this.codeInput.addEventListener('dfo-submit', () => this.submitJoin());
    this.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submitJoin(); } });
    this.codeInput.addEventListener('focus', () => { join.classList.toggle('kb', this.touch); this.syncCode(false); });
    this.codeInput.addEventListener('blur', () => { join.classList.remove('kb'); this.syncCode(false); });
    field.append(boxes, this.codeInput);
    const del = btn('dfm-small dfo-del', '', 'dfo-key-del');
    del.append(glyph('del'), el('span', '', 'DELETE'));
    del.setAttribute('aria-label', 'Delete the last character');
    del.addEventListener('click', () => { this.sound('click'); this.typeCode(null); });
    this.joinBtn = btn('df-btn dfo-joinbtn', ONLINE_TEXT.joinBtn, 'dfo-join-go');
    this.joinBtn.addEventListener('click', () => this.submitJoin());
    const jrow = el('div', 'dfo-joinrow');
    jrow.append(del, this.joinBtn);
    codeCard.append(el('h3', 'dfm-cap', 'ROOM CODE'), field, el('p', 'dfo-codenote', ONLINE_TEXT.codeNote), jrow);
    this.keypad = el('div', 'dfm-card dfo-keypad');
    this.keypad.setAttribute('role', 'group');
    this.keypad.setAttribute('aria-label', 'Code keypad');
    const kg = el('div', 'grid');
    for (const ch of CODE_ALPHABET) {
      const k = btn('dfo-key', ch, `dfo-key-${ch}`);
      k.addEventListener('click', () => { this.sound('click'); this.typeCode(ch); });
      kg.append(k);
    }
    this.keypad.append(kg);
    jb.append(codeCard, this.keypad);
    join.append(jb);

    // ── SEARCH / WAITING ──────────────────────────────────
    const search = this.mkScreen('search');
    search.append(el('div', 'dfm-scrim full'));
    this.searchCard = el('div', 'dfm-card dfo-searchcard');
    this.searchCard.setAttribute('role', 'status');
    this.searchCard.setAttribute('aria-live', 'polite');
    const drops = el('div', 'dfo-drops');
    drops.setAttribute('aria-hidden', 'true');
    for (const c of ['a', 'b', 'c']) drops.append(el('i', c));
    this.searchTitle = el('h2', 'dfo-stitle', ONLINE_TEXT.connecting);
    this.searchChips = el('div', 'dfo-schips');
    this.searchStats = el('div', 'dfo-sstats');
    this.searchPeople = el('div', 'dfo-people');
    this.searchLine = el('p', 'dfo-sline', '');
    this.searchActions = el('div', 'dfo-actions');
    this.searchCard.append(drops, this.searchTitle, this.searchChips, this.searchStats, this.searchPeople, this.searchLine, this.searchActions);
    search.append(this.searchCard);

    // ── ROOM ──────────────────────────────────────────────
    const room = this.mkScreen('room');
    const rhead = this.header(ONLINE_TEXT.room, ONLINE_TEXT.roomHint, ONLINE_TEXT.leave, () => this.leaveRoom());
    this.roomTitle = rhead.querySelector('h2') as HTMLElement;
    room.append(el('div', 'dfm-scrim full'), rhead);
    const rb = el('div', 'dfo-body dfo-roombody');
    // the code
    const codeBox = el('div', 'dfm-card dfo-codebox');
    this.roomCode = el('div', 'dfo-bigcode');
    this.roomCode.id = 'dfo-room-code';
    const copy = btn('dfm-small dfo-copy', '', 'dfo-copy-code');
    copy.append(glyph('copy'), el('span', 'tx', ONLINE_TEXT.copyCode));
    copy.setAttribute('aria-label', 'Copy the room code');
    copy.addEventListener('click', () => { this.sound('click'); void this.copyCode(); });
    this.linkBtn = btn('dfm-small dfo-copy', '', 'dfo-copy-link');
    this.linkBtn.addEventListener('click', () => { this.sound('click'); void this.shareLink(); });
    const crow = el('div', 'dfo-coderow');
    crow.append(copy, this.linkBtn);
    codeBox.append(el('h3', 'dfm-cap', 'ROOM CODE'), this.roomCode, el('p', 'dfo-share', ONLINE_TEXT.share), crow);
    // the seats
    const seatsCard = el('div', 'dfm-card dfo-seats');
    const sh = el('div', 'dfo-seats-h');
    this.roomCount = el('b', 'dfo-count', '');
    sh.append(el('h3', 'dfm-cap', ONLINE_TEXT.players), this.roomCount);
    const list = el('ol', 'dfo-seatlist');
    for (let i = 0; i < MAX_HUMANS; i++) {
      const li = el('li', 'dfo-seat');
      const num = el('span', 'n', String(i + 1));
      const mark = el('i', 'mk', '');
      const nm = el('span', 'nm', '');
      const badges = el('span', 'badges');
      const who = el('span', 'who');
      who.append(nm, badges);
      const kit = el('img', 'kiticon');
      kit.alt = '';
      kit.draggable = false;
      const dev = el('span', 'dev');
      const ping = el('span', 'ping');
      const kick = btn('dfo-kick', ONLINE_TEXT.kick, `dfo-kick-${i}`);
      const row: SeatRow = { li, num, mark, name: nm, badges, kit, dev, ping, kick, slot: null, armT: 0 };
      kick.addEventListener('click', () => this.kickPress(row));
      li.append(num, mark, who, kit, dev, ping, kick);
      this.seats.push(row);
      list.append(li);
    }
    seatsCard.append(sh, list);
    // the setup
    const setupCard = el('div', 'dfm-card dfo-roomsetup');
    const opt = (cap: string, key: string, items: Array<[string, string]>, onPick: (v: string) => void, extra?: (b: HTMLButtonElement, v: string) => void): HTMLElement => {
      const o2 = el('div', 'dfo-opt');
      o2.dataset.opt = key;
      o2.append(el('h3', 'dfm-cap', cap));
      const seg = el('div', key === 'map' ? 'dfo-maps' : 'dfo-seg');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', cap);
      for (const [v, label] of items) {
        // ids dfo-r<key>-<v> (dfo-rmode-ffa …): the home screen's MODE / RULE buttons own dfo-mode-* / dfo-rule-*
        const b = btn(key === 'map' ? 'dfo-mapchip' : 'dfm-segbtn', key === 'map' ? '' : label, `dfo-r${key}-${v}`);
        b.setAttribute('role', 'radio');
        b.dataset.v = v;
        extra?.(b, v);
        b.addEventListener('click', () => { this.sound('click'); onPick(v); });
        this.roomSegs.set(`${key}:${v}`, b);
        seg.append(b);
      }
      const val = el('b', 'dfo-val', '');
      this.roomVals.set(key, val);
      this.roomOwnerOnly.push(seg);
      this.roomReadOnly.push(val);
      o2.append(seg, val);
      return o2;
    };
    const maps = playableMaps();
    setupCard.append(
      opt('MODE', 'mode', MODE_LABELS.map(([m, l]) => [m, l]), (v) => this.api.configure({ mode: v as OnlineMode })),
      opt('RULE', 'rule', RULE_LABELS.map(([r, l]) => [r, l]), (v) => this.api.configure({ rule: v as OnlineRule })),
      opt('ARENA', 'map', [['random', 'RANDOM'], ...maps.map((m) => [m.id, m.name.toUpperCase()] as [string, string])], (v) => this.api.configure({ map: v }),
        (b, v) => {
          const th = el('span', 'th');
          if (MAP_THUMBS[v]) { const img = el('img'); img.src = MAP_THUMBS[v]; img.alt = ''; img.draggable = false; th.append(img); } else th.classList.add('random');
          const full = v === 'random' ? 'RANDOM' : (maps.find((m) => m.id === v)?.name ?? v).toUpperCase();
          b.append(th, el('span', 'nm', shortMapName(full)));
          b.setAttribute('aria-label', full);
          b.title = full;
        }),
    );
    // TIME OF DAY: Pier 18 only (the other arenas set their own light, as on PLAY)
    this.todRow = el('div', 'dfo-opt');
    this.todRow.dataset.opt = 'preset';
    this.todRow.append(el('h3', 'dfm-cap', 'TIME OF DAY'));
    this.todSeg = el('div', 'dfo-seg');
    for (const p of ['noon', 'golden']) {
      const b = btn('dfm-segbtn', PRESET_TEXT[p], `dfo-rpreset-${p}`);
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { this.sound('click'); this.api.configure({ preset: p }); });
      this.roomSegs.set(`preset:${p}`, b);
      this.todSeg.append(b);
    }
    this.todNote = el('b', 'dfo-val dfo-light', '');
    const todVal = el('b', 'dfo-val', '');
    this.roomVals.set('preset', todVal);
    this.roomOwnerOnly.push(this.todSeg);
    this.roomReadOnly.push(todVal);
    this.todRow.append(this.todSeg, this.todNote, todVal);
    setupCard.append(this.todRow,
      opt('BOTS', 'skill', (['breeze', 'swell', 'storm'] as OnlineSkill[]).map((s) => [s, SKILL_TEXT[s]]), (v) => this.api.configure({ skill: v as OnlineSkill })));
    // the options scroll inside the card when it is short (a phone); START stays put under them
    const optsScroll = el('div', 'dfo-optscroll');
    optsScroll.append(...[...setupCard.children]);
    setupCard.append(optsScroll);
    const startRow = el('div', 'dfo-startrow');
    this.startNote = el('p', 'dfo-startnote', '');
    this.startNote.setAttribute('aria-live', 'polite');
    this.startBtn = btn('df-btn dfo-start', ONLINE_TEXT.start, 'dfo-start');
    this.startBtn.addEventListener('click', () => { if (this.startBtn.disabled) return; this.sound('start'); this.api.start(); });
    startRow.append(this.startNote, this.startBtn);
    setupCard.append(startRow);
    rb.append(codeBox, seatsCard, setupCard);
    room.append(rb);

    // ── NOTICE ────────────────────────────────────────────
    const notice = this.mkScreen('notice');
    notice.append(el('div', 'dfm-scrim full'));
    this.noticeCard = el('div', 'dfm-card dfo-noticecard');
    this.noticeCard.setAttribute('role', 'alertdialog');
    this.noticeIcon = el('div', 'dfo-nicon');
    this.noticeTitle = el('h2', 'dfo-ntitle', '');
    this.noticeText = el('p', 'dfo-ntext', '');
    this.noticeDetail = el('p', 'dfo-ndetail', '');
    this.noticeBtns = el('div', 'dfo-actions');
    this.noticeCard.append(this.noticeIcon, this.noticeTitle, this.noticeText, this.noticeDetail, this.noticeBtns);
    notice.append(this.noticeCard);

    // ── toasts + key hints ────────────────────────────────
    this.toasts = el('div', 'dfo-toasts');
    this.toasts.setAttribute('aria-live', 'polite');
    this.hints = el('div', 'dfm-hints dfo-hints');
    this.root.append(...this.screens.values(), this.toasts, this.hints);
    host.append(this.root);

    // listeners
    this.offs.push(this.api.onStatus((s) => this.route(s)));
    this.offs.push(this.api.onEvent((e) => this.onEvent(e)));
    this.offs.push(watchTouchMode((on) => { this.touch = on; this.root.classList.toggle('touch', on); this.renderHints(); }));
    if (this.profile.on) this.offs.push(this.profile.on(() => { if (this.screen === 'home') this.refreshHome(); }));
    this.root.classList.toggle('touch', this.touch);
    // REDUCE MOTION (SETTINGS → ACCESSIBILITY, or the OS preference): no bobbing, hopping or sliding (ui.css .dfo.rm)
    const rm = (): void => { this.root.classList.toggle('rm', reduceMotionOn(o.settings)); };
    rm();
    if (o.settings?.on) this.offs.push(o.settings.on(rm));
    this.syncCode(false);
    const onPad = (): void => this.renderHints();
    window.addEventListener('gamepadconnected', onPad);
    this.offs.push(() => window.removeEventListener('gamepadconnected', onPad));
    this.refreshHome();
  }

  // ───────────────────────────── building blocks ─────────────────────────────
  private mkScreen(s: OnlineScreen): HTMLElement {
    const e = el('section', `dfo-screen dfo-s-${s}`);
    e.dataset.screen = s;
    e.hidden = true;
    this.screens.set(s, e);
    return e;
  }

  private header(title: string, hint: string, backLabel: string, onBack: () => void): HTMLElement {
    const h = el('header', 'dfm-head dfo-head');
    const back = btn('dfm-back', '');
    back.append(el('span', 'chev', '◀'), el('span', '', backLabel));
    back.addEventListener('click', () => onBack());
    const t = el('div', 'dfm-head-t');
    t.append(el('h2', '', title));
    if (hint) t.append(el('p', 'dfm-hint', hint));
    h.append(back, t);
    return h;
  }

  private sound(s: UiSound): void { try { this.hooks.sound?.(s); } catch { /* audio is optional */ } }

  private profileNow(): OnlineProfile {
    const p = this.profile.get();
    const crew = p.crew === 2 ? 2 : p.crew === 1 ? 1 : 0;
    return { name: cleanName(p.name) || guestName(), kit: p.kit, crew, ffaColor: p.ffaColor };
  }
  private pickNow(): { mode: OnlineMode; rule: OnlineRule } {
    const p = this.profile.get();
    return { mode: p.mode === 'ffa' ? 'ffa' : 'teams', rule: p.rule === 'washout' ? 'washout' : 'turf' };
  }

  // ───────────────────────────── open / close / show ─────────────────────────────
  get visible(): boolean { return !this.root.hidden && this.screen !== null; }

  /** open PLAY ONLINE (the title's PLAY ONLINE, or a ?room= deep link with `join`) */
  open(o: { join?: string } = {}): void {
    this.root.hidden = false;
    this.matchHidden = false;
    if (!onlineSupported()) { this.showNotice('unsupported'); return; }
    this.homeFocus = 'qm';
    const s = this.api.status();
    if (o.join !== undefined) { this.openJoin(o.join); return; }
    if (s.kind === 'idle') { this.show('home'); return; }
    this.route(s);
    if (!this.screen) this.show('home');
  }

  /** close the screens (BACK from home): the menus' title comes back through hooks.close */
  close(): void {
    this.sound('back');
    this.hideAll();
    this.hooks.close();
  }

  /** hide without telling anyone (a match is starting, or the integrator tears the screens down) */
  hideAll(): void {
    this.stopTicker();
    this.root.hidden = true;
    this.screen = null;
    for (const s of this.screens.values()) s.hidden = true;
    if (this.popNav) { this.popNav(); this.popNav = null; }
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  private show(s: OnlineScreen): void {
    const scr = this.screens.get(s)!;
    const was = this.screen;
    this.screen = s;
    this.root.hidden = false;
    this.root.dataset.screen = s;
    for (const [k, e] of this.screens) e.hidden = k !== s;
    if (s !== 'search') this.stopTicker();
    if (s === 'home') this.refreshHome();
    const opts = { back: () => this.backFrom(s), initial: () => this.initialFocus(s), sound: (x: 'hover' | 'click' | 'back') => this.sound(x) };
    if (!this.popNav) this.popNav = this.nav.push(scr, opts);
    else if (was !== s) this.nav.swap(scr, opts);
    else this.nav.home();
    this.renderHints();
  }

  private initialFocus(s: OnlineScreen): HTMLElement | null {
    const q = (sel: string): HTMLElement | null => this.screens.get(s)?.querySelector<HTMLElement>(sel) ?? null;
    switch (s) {
      case 'home': return this.doorBtns.get(this.homeFocus) ?? null;
      case 'join':
        // kbm: straight into the field; touch / pad: the keypad (a tap on the field opens the phone keyboard)
        if (cleanCode(this.codeInput.value).length === CODE_LENGTH) return this.joinBtn;
        return this.touch || this.nav.padSeen ? q('#dfo-key-A') : this.codeInput;
      case 'search': return q('.dfo-actions [data-default]') ?? q('.dfo-actions button');
      case 'room': return !this.startBtn.disabled && !this.startBtn.closest('[hidden]') ? this.startBtn : q('#dfo-copy-code');
      case 'notice': return q('.dfo-actions [data-default]');
      default: return null;
    }
  }

  private backFrom(s: OnlineScreen): boolean {
    switch (s) {
      case 'home': this.close(); return true;
      case 'join': this.backFromJoin(); return true;
      case 'search': this.cancelSearch(); return true;
      case 'room': this.leaveRoom(); return true;
      case 'notice': this.noticeAction(NOTICES[this.noticeKind as keyof typeof NOTICES]?.secondary?.[1] ?? 'home'); return true;
      default: return false;
    }
  }

  // ───────────────────────────── HOME ─────────────────────────────
  private refreshHome(): void {
    const { mode, rule } = this.pickNow();
    for (const [m, b] of this.modeBtns) { const on = m === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    for (const [r, b] of this.ruleBtns) { const on = r === rule; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    this.ruleNote.textContent = RULE_LABELS.find(([r]) => r === rule)?.[2] ?? '';
    this.root.dataset.rule = rule;
    const modeChip = mode === 'ffa' ? 'FREE-FOR-ALL' : 'TEAMS · 4 v 4';
    const qmChips = this.doorChips[0];
    if (qmChips) {
      qmChips.replaceChildren(el('span', 'chip', modeChip), el('span', 'chip', rule === 'washout' ? 'WASHOUT' : 'TURF'));
    }
    const crChips = this.doorChips[1];
    if (crChips) crChips.replaceChildren(el('span', 'chip', 'PRIVATE'), el('span', 'chip', 'YOU PICK THE ARENA'));
    const jnChips = this.doorChips[2];
    if (jnChips) jnChips.replaceChildren(el('span', 'chip', 'GOT A CODE?'));
    // the player's plate
    const p = this.profile.get();
    const k = kitRow(p.kit);
    const look = mode === 'ffa' ? crewLook(p.ffaColor, 'ffa') : crewLook(p.crew === 2 ? 2 : 1, 'teams', colorblindOn());
    this.you.replaceChildren();
    const mk = el('i', 'mk', look.markGlyph);
    mk.style.background = look.dye;
    const img = el('img', 'kiticon');
    img.src = KIT_ICONS[k.id] ?? '';
    img.alt = '';
    img.draggable = false;
    const t = el('span', 'txt');
    t.append(el('b', '', cleanName(p.name) || guestName()), el('span', '', `${k.name} · ${mode === 'ffa' ? look.label : look.label}`));
    this.you.append(mk, t, img, el('span', 'hint', ONLINE_TEXT.youHint));
  }

  private doQuick(): void {
    const { mode, rule } = this.pickNow();
    this.sound('start');
    this.lastDoor = { door: 'qm', mode, rule, code: '' };
    this.searchState = 'connecting';
    this.queue = { waiting: 0, waitedS: 0, at: performance.now() };
    this.showSearch('connecting');
    this.api.quickMatch(mode, rule, this.profileNow());
  }

  private doCreate(): void {
    const { mode, rule } = this.pickNow();
    this.sound('start');
    this.lastDoor = { door: 'create', mode, rule, code: '' };
    this.showSearch('connecting');
    this.api.createRoom(mode, rule, this.profileNow());
  }

  // ───────────────────────────── JOIN ─────────────────────────────
  /** open JOIN ROOM, the field pre-filled (a ?room= deep link) */
  openJoin(code: string): void {
    this.codeInput.value = cleanCode(code);
    this.syncCode(false);
    this.show('join');
    this.nav.home(true);
  }

  private backFromJoin(): void {
    this.sound('back');
    this.codeInput.blur();
    this.homeFocus = 'join';
    this.show('home');
    const d = this.doorBtns.get('join');
    if (d) this.nav.focus(d, false);
  }

  private typeCode(ch: string | null): void {
    const cur = cleanCode(this.codeInput.value);
    this.codeInput.value = ch === null ? cur.slice(0, -1) : cleanCode(cur + ch);
    this.syncCode(false);
    if (ch !== null && cleanCode(this.codeInput.value).length === CODE_LENGTH && document.activeElement?.classList.contains('dfo-key')) this.nav.focus(this.joinBtn, false);
  }

  private syncCode(fromInput: boolean): void {
    const raw = this.codeInput.value;
    const c = cleanCode(raw);
    if (c !== raw) {
      // keep the caret at the end after a filtered character
      this.codeInput.value = c;
    }
    const focused = document.activeElement === this.codeInput;
    this.codeBoxes.forEach((b, i) => {
      b.textContent = c[i] ?? '';
      b.classList.toggle('filled', i < c.length);
      b.classList.toggle('cur', focused && i === Math.min(c.length, CODE_LENGTH - 1) && (c.length < CODE_LENGTH || i === CODE_LENGTH - 1));
    });
    this.joinBtn.disabled = c.length !== CODE_LENGTH;
    // a phone: the 4th character typed closes the keyboard and puts JOIN in view
    if (fromInput && c.length === CODE_LENGTH && this.touch) { this.codeInput.blur(); this.nav.focus(this.joinBtn, false); }
  }

  private submitJoin(): void {
    const c = cleanCode(this.codeInput.value);
    if (c.length !== CODE_LENGTH) { this.codeInput.classList.remove('shake'); void this.codeInput.offsetWidth; this.codeInput.classList.add('shake'); return; }
    this.sound('start');
    this.codeInput.blur();
    const { mode, rule } = this.pickNow();
    this.lastDoor = { door: 'join', mode, rule, code: c };
    this.showSearch('connecting');
    this.api.joinRoom(c, this.profileNow());
  }

  // ───────────────────────────── SEARCH / WAITING ─────────────────────────────
  private showSearch(state: SearchState, room: RoomView | null = null): void {
    const prev = this.searchState;
    this.searchState = state;
    this.searchCard.dataset.state = state;
    const { mode, rule } = room ? { mode: room.mode, rule: room.rule } : { mode: this.lastDoor.mode, rule: this.lastDoor.rule };
    this.searchChips.replaceChildren(el('span', 'chip', mode === 'ffa' ? 'FREE-FOR-ALL' : 'TEAMS · 4 v 4'), el('span', 'chip', rule === 'washout' ? 'WASHOUT' : 'TURF'));
    const title = state === 'connecting' ? ONLINE_TEXT.connecting : state === 'queue' ? ONLINE_TEXT.finding : state === 'solo' ? ONLINE_TEXT.solo
      : state === 'found' ? ONLINE_TEXT.found : state === 'hostleft' ? ONLINE_TEXT.hostLeft : ONLINE_TEXT.joiningMatch;
    this.searchTitle.textContent = title;
    this.searchPeople.replaceChildren();
    this.searchPeople.hidden = state !== 'found';
    let line = '';
    if (state === 'queue') line = ONLINE_TEXT.queueLine;
    else if (state === 'solo') line = `Nobody else is queued for ${mode === 'ffa' ? 'FREE-FOR-ALL' : 'TEAMS'} · ${rule === 'washout' ? 'WASHOUT' : 'TURF'} right now. Keep waiting, or play this match against bots.`;
    else if (state === 'connecting') line = this.lastDoor.door === 'join' ? `Joining room ${this.lastDoor.code}…` : this.lastDoor.door === 'create' ? 'Opening a room…' : 'Reaching the matchmaker…';
    else if (state === 'hostleft') line = ONLINE_TEXT.hostLeftLine;
    else if (state === 'loading') line = 'Loading the arena…';
    if (state === 'found' && room) {
      for (const m of room.members) this.searchPeople.append(this.personChip(m, room));
      if (prev !== 'found') this.foundAt = performance.now();
    }
    this.searchLine.textContent = line;
    // actions
    const acts: HTMLButtonElement[] = [];
    if (state === 'solo') {
      const keep = btn('df-btn', ONLINE_TEXT.keepWaiting, 'dfo-keep');
      keep.dataset.default = '';
      keep.addEventListener('click', () => { this.sound('click'); this.queue = { waiting: 1, waitedS: this.queue.waitedS, at: performance.now() }; this.api.keepWaiting(); });
      const bots = btn('df-btn df-lobby', ONLINE_TEXT.playBots, 'dfo-bots');
      bots.addEventListener('click', () => this.playBots());
      acts.push(keep, bots);
    }
    if (state !== 'loading' && state !== 'hostleft') {
      const cancel = btn(state === 'solo' ? 'dfm-small dfo-cancel' : 'df-btn df-lobby dfo-cancel', ONLINE_TEXT.cancel, 'dfo-cancel');
      if (state !== 'solo') cancel.dataset.default = '';
      cancel.addEventListener('click', () => this.cancelSearch());
      acts.push(cancel);
    }
    const same = this.searchActions.children.length === acts.length && acts.every((a, i) => (this.searchActions.children[i] as HTMLElement).id === a.id);
    if (!same) this.searchActions.replaceChildren(...acts);
    this.updateSearchStats();
    if (this.screen !== 'search') this.show('search');
    else if (!same) this.nav.home(true);
    this.startTicker();
  }

  private personChip(m: RoomMember, room: RoomView): HTMLElement {
    const look = room.mode === 'ffa' ? crewLook(m.color || 1, 'ffa') : crewLook(m.crew === 2 ? 2 : 1, 'teams', colorblindOn());
    const c = el('span', `dfo-person${m.slot === room.mySlot ? ' you' : ''}`);
    const mk = el('i', 'mk', look.markGlyph);
    mk.style.background = look.dye;
    c.append(mk, el('b', '', m.name), glyph(m.device === 'touch' ? 'touch' : 'kbm', 'dfo-g dev'));
    return c;
  }

  private updateSearchStats(): void {
    const st = this.searchState;
    this.searchStats.replaceChildren();
    if (st === 'queue') {
      const el1 = Math.max(0, this.queue.waitedS + (performance.now() - this.queue.at) / 1000);
      const w = el('span', 'stat');
      w.append(el('b', '', String(Math.max(1, this.queue.waiting))), el('span', '', this.queue.waiting === 1 ? 'waiting (you)' : 'waiting'));
      const t = el('span', 'stat');
      t.append(el('b', 'clock', fmtClock(el1)), el('span', '', 'searching'));
      this.searchStats.append(w, t);
    } else if (st === 'found') {
      const left = Math.max(0, Math.ceil(QM_AUTOSTART_S - (performance.now() - this.foundAt) / 1000));
      const s = el('span', 'stat');
      s.append(el('b', '', left > 0 ? String(left) : '…'), el('span', '', left > 0 ? 'starting in' : 'starting'));
      this.searchStats.append(s);
    }
    this.searchStats.hidden = !this.searchStats.childElementCount;
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = window.setInterval(() => { if (this.screen === 'search') this.updateSearchStats(); else this.stopTicker(); }, 250);
  }
  private stopTicker(): void { if (this.ticker) clearInterval(this.ticker); this.ticker = 0; }

  private cancelSearch(): void {
    this.sound('back');
    this.homeFocus = this.lastDoor.door;
    this.api.leave();
    this.show(this.lastDoor.door === 'join' ? 'join' : 'home');
  }

  private playBots(): void {
    this.sound('start');
    const { mode, rule } = this.lastDoor;
    // ONE owner starts the offline match, never both (a double start would load the arena twice):
    //  - the solo prompt answers the matchmaker: api.playBotsInstead() ends the online session AND starts the offline match
    //    itself (SYNC's NetApi hands it to its driver; the mock's onBots stands in for that driver);
    //  - a notice card (quota / unsupported) has no matchmaker to answer: api.leave(), then hooks.playOffline.
    // hideAll() first, so the idle status the api emits meanwhile finds the screens closed.
    this.hideAll();
    if (this.st.kind === 'solo') { this.api.playBotsInstead(); return; }
    this.api.leave();
    this.hooks.playOffline(mode, rule);
  }

  // ───────────────────────────── ROOM ─────────────────────────────
  private renderRoom(r: RoomView): void {
    const prev = this.lastRoom;
    this.lastRoom = r;
    const mine = r.mySlot === r.ownerSlot;
    this.root.dataset.owner = String(mine);
    this.roomTitle.textContent = `${ONLINE_TEXT.room} ${r.code}`;
    // the code
    if (this.roomCode.dataset.code !== r.code) {
      this.roomCode.dataset.code = r.code;
      this.roomCode.setAttribute('aria-label', `Room code ${r.code.split('').join(' ')}`);
      this.roomCode.replaceChildren(...r.code.split('').map((ch) => el('span', '', ch)));
    }
    const link = this.api.inviteUrl();
    const canShare = this.touch && typeof navigator.share === 'function';
    this.linkBtn.hidden = !link;
    this.linkBtn.replaceChildren(glyph(canShare ? 'share' : 'link'), el('span', 'tx', canShare ? ONLINE_TEXT.shareBtn : ONLINE_TEXT.copyLink));
    this.linkBtn.setAttribute('aria-label', canShare ? 'Share an invite link' : 'Copy an invite link');
    // seats: humans by slot, the empty seats BOT
    const bySlot = new Map(r.members.map((m) => [m.slot, m]));
    const humans = r.members.filter((m) => m.conn).length;
    this.roomCount.textContent = `${r.members.length} / ${MAX_HUMANS}`;
    for (let i = 0; i < MAX_HUMANS; i++) {
      const row = this.seats[i];
      const m = bySlot.get(i) ?? null;
      row.slot = m ? m.slot : null;
      row.li.dataset.slot = String(i);
      row.li.classList.toggle('bot', !m);
      row.li.classList.toggle('you', !!m && m.slot === r.mySlot);
      row.li.classList.toggle('off', !!m && !m.conn);
      if (!m) {
        row.mark.textContent = '';
        row.mark.style.background = '';
        row.mark.replaceChildren(glyph('bot', 'dfo-g'));
        row.name.textContent = ONLINE_TEXT.bot;
        row.badges.replaceChildren();
        row.kit.hidden = true;
        row.dev.replaceChildren();
        row.ping.textContent = '';
        row.ping.className = 'ping';
        row.kick.hidden = true;
        continue;
      }
      const look = r.mode === 'ffa' ? crewLook(m.color || 1, 'ffa') : m.crew === 0 ? null : crewLook(m.crew === 2 ? 2 : 1, 'teams', colorblindOn());
      row.mark.replaceChildren();
      row.mark.textContent = look ? look.markGlyph : '?';
      row.mark.style.background = look ? look.dye : '';
      row.mark.title = look ? (r.mode === 'ffa' ? look.label : look.label) : 'Any crew';
      row.name.textContent = m.name;
      const badges: HTMLElement[] = [];
      if (m.slot === r.mySlot) badges.push(el('span', 'bdg you', ONLINE_TEXT.you));
      if (m.owner || m.slot === r.ownerSlot) { const o2 = el('span', 'bdg own'); o2.append(glyph('crown', 'dfo-g'), el('span', '', ONLINE_TEXT.owner)); badges.push(o2); }
      if (!m.conn) badges.push(el('span', 'bdg off', 'RECONNECTING'));
      row.badges.replaceChildren(...badges);
      row.kit.hidden = false;
      row.kit.src = KIT_ICONS[m.kit] ?? KIT_ICONS[kitRow(m.kit).id] ?? '';
      row.kit.title = kitRow(m.kit).name;
      row.dev.replaceChildren(glyph(m.device === 'touch' ? 'touch' : 'kbm', 'dfo-g'));
      row.dev.title = m.device === 'touch' ? 'Touch' : 'Keyboard & mouse';
      row.ping.className = `ping ${pingClass(m.rttMs)}`;
      row.ping.textContent = m.rttMs === null ? '—' : `${Math.round(m.rttMs)} ms`;
      const canKick = mine && m.slot !== r.mySlot && r.phase === 'room';
      row.kick.hidden = !canKick;
      if (!canKick) this.disarm(row);
    }
    // setup: values for everyone, buttons for the owner
    const pick = (key: string, v: string): void => {
      for (const [k2, b] of this.roomSegs) {
        if (!k2.startsWith(`${key}:`)) continue;
        const on = k2 === `${key}:${v}`;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
    };
    pick('mode', r.mode); pick('rule', r.rule); pick('map', r.map); pick('preset', r.preset); pick('skill', r.skill);
    const mapName = r.map === 'random' ? 'RANDOM' : (playableMaps().find((m) => m.id === r.map)?.name ?? r.map).toUpperCase();
    this.roomVals.get('mode')!.textContent = r.mode === 'ffa' ? 'FREE-FOR-ALL' : 'TEAMS · 4 v 4';
    this.roomVals.get('rule')!.textContent = `${r.rule === 'washout' ? 'WASHOUT' : 'TURF'} — ${RULE_LABELS.find(([x]) => x === r.rule)?.[2] ?? ''}`;
    this.roomVals.get('map')!.textContent = mapName;
    this.roomVals.get('preset')!.textContent = PRESET_TEXT[r.preset] ?? r.preset.toUpperCase();
    this.roomVals.get('skill')!.textContent = SKILL_TEXT[r.skill] ?? r.skill.toUpperCase();
    const pier = r.map === 'pier18';
    this.todSeg.hidden = !mine || !pier;
    this.roomVals.get('preset')!.hidden = mine || !pier;
    this.todNote.hidden = pier;
    this.todNote.textContent = LIGHT_TEXT[r.map] ?? '';
    for (const e of this.roomOwnerOnly) if (e !== this.todSeg) e.hidden = !mine;
    for (const e of this.roomReadOnly) if (e !== this.roomVals.get('preset')) e.hidden = mine;
    // START: the owner, ≥ 2 humans connected (§O4.3)
    this.startBtn.hidden = !mine;
    this.startBtn.disabled = humans < 2;
    const owner = r.members.find((m) => m.slot === r.ownerSlot);
    this.startNote.textContent = mine ? (humans < 2 ? ONLINE_TEXT.needTwo : ONLINE_TEXT.ready(humans)) : ONLINE_TEXT.waitOwner(owner?.name ?? 'the owner');
    // ownership moved (the owner left, §O4.3)
    if (prev && prev.code === r.code && prev.ownerSlot !== r.ownerSlot) {
      this.toast(mine ? 'You own the room now' : `${owner?.name ?? 'Someone'} owns the room now`);
    }
    if (this.screen !== 'room') this.show('room');
    else {
      // the focused control may have hidden (a kicked row, START for a new owner): keep focus inside the screen
      const a = document.activeElement as HTMLElement | null;
      if (!a || !this.root.contains(a) || a.closest('[hidden]') || (a as HTMLButtonElement).disabled) this.nav.home(true);
    }
  }

  private kickPress(row: SeatRow): void {
    if (row.slot === null) return;
    if (!row.kick.classList.contains('armed')) {
      this.sound('click');
      row.kick.classList.add('armed');
      row.kick.textContent = ONLINE_TEXT.sure;
      clearTimeout(row.armT);
      row.armT = window.setTimeout(() => this.disarm(row), 3000);
      return;
    }
    this.sound('click');
    this.disarm(row);
    this.api.kick(row.slot);
  }
  private disarm(row: SeatRow): void {
    clearTimeout(row.armT);
    row.kick.classList.remove('armed');
    row.kick.textContent = ONLINE_TEXT.kick;
  }

  private leaveRoom(): void {
    this.sound('back');
    this.homeFocus = this.lastDoor.door;
    this.lastCode = '';
    this.api.leave();
    this.lastRoom = null;
    this.show('home');
  }

  private async copyCode(): Promise<void> {
    const r = this.lastRoom;
    if (!r) return;
    this.toast((await copyText(r.code)) ? `Code ${r.code} copied` : `The code is ${r.code}`);
  }

  private async shareLink(): Promise<void> {
    const url = this.api.inviteUrl();
    const r = this.lastRoom;
    if (!url || !r) return;
    if (this.touch && typeof navigator.share === 'function') {
      try { await navigator.share({ title: 'DYEFIELD', text: `Join my DYEFIELD room: ${r.code}`, url }); return; } catch { /* cancelled / refused: copy */ }
    }
    this.toast((await copyText(url)) ? 'Invite link copied' : `Room code: ${r.code}`);
  }

  // ───────────────────────────── NOTICE ─────────────────────────────
  /** a notice card (also SYNC's entry for 'court'); from a match it brings the screens back (hooks.matchPhase(null)) */
  showNotice(kind: keyof typeof NOTICES, why = '', detail = ''): void {
    if (this.matchHidden) { this.matchHidden = false; this.root.hidden = false; this.hooks.matchPhase?.(null, null); }
    this.root.hidden = false;
    const base = NOTICES[kind];
    // a connection lost in a room: RETRY rejoins that room (SYNC reconnects with the room's token) / LEAVE (§O7.2)
    const inRoom = kind === 'network' && !!this.lastCode;
    const d: NoticeDef = inRoom ? { ...base, text: `The connection to room ${this.lastCode} dropped.`, primary: ['RETRY', 'rejoin'], secondary: ['LEAVE', 'home'] } : base;
    this.noticeKind = kind;
    this.noticeCard.dataset.kind = kind;
    this.noticeCard.dataset.tone = d.tone;
    this.noticeIcon.replaceChildren(glyph(d.icon, 'dfo-g'));
    this.noticeTitle.textContent = d.title;
    let text = d.text;
    if ((kind === 'kicked' || kind === 'closed') && why) text = WHY_TEXT[why] ?? why;
    if (kind === 'voided' && why && WHY_TEXT[why]) text = WHY_TEXT[why];
    if (kind === 'quota') text = `${d.text} Online opens again at 00:00 UTC — in ${untilUtcMidnight()}. Bots are ready any time.`;
    this.noticeText.textContent = text;
    this.noticeDetail.textContent = detail;
    this.noticeDetail.hidden = !detail;
    const mk = ([label, act]: [string, NoticeAction], primary: boolean): HTMLButtonElement => {
      const b = btn(primary ? 'df-btn' : 'df-btn df-lobby', label, `dfo-n-${act}`);
      if (primary) b.dataset.default = '';
      b.addEventListener('click', () => this.noticeAction(act));
      return b;
    };
    this.noticeBtns.replaceChildren(mk(d.primary, true), ...(d.secondary ? [mk(d.secondary, false)] : []));
    this.show('notice');
    this.nav.home(true);
  }

  private noticeAction(a: NoticeAction): void {
    this.sound(a === 'home' ? 'back' : 'click');
    switch (a) {
      case 'home': this.api.leave(); this.lastCode = ''; this.show('home'); break;
      case 'rejoin': this.lastDoor = { ...this.lastDoor, door: 'join', code: this.lastCode }; this.codeInput.value = this.lastCode; this.syncCode(false); this.submitJoin(); break;
      case 'join': this.api.leave(); this.openJoin(this.lastDoor.code); break;
      case 'bots': this.playBots(); break;
      case 'reload': if (this.hooks.reload) this.hooks.reload(); else location.reload(); break;
      case 'retry':
        if (this.lastDoor.door === 'qm') this.doQuick();
        else if (this.lastDoor.door === 'create') this.doCreate();
        else { this.codeInput.value = this.lastDoor.code; this.syncCode(false); this.submitJoin(); }
        break;
    }
  }

  // ───────────────────────────── status / events ─────────────────────────────
  private route(s: NetStatus): void {
    this.st = s;
    if (this.root.hidden && !this.matchHidden) return;          // the screens are closed: nothing to show
    // out of a match (loading / live / post hid the screens) into anything but another match phase: the screens come back and
    // matchPhase(null) lets the integrator tear the match UI down, once. (A quick REMATCH that found no partner re-queues:
    // the api goes connecting → queue straight from `post`.)
    const fromMatch = this.matchHidden && s.kind !== 'room';
    if (fromMatch) { this.matchHidden = false; this.root.hidden = false; this.hooks.matchPhase?.(null, null); }
    switch (s.kind) {
      case 'idle':
        if (this.screen === 'search' || this.screen === 'room') this.show(this.screen === 'search' && this.lastDoor.door === 'join' ? 'join' : 'home');
        if (fromMatch) this.show('home');
        break;
      case 'connecting':
        if (this.screen !== 'search' || this.searchState !== 'connecting') this.showSearch('connecting');
        break;
      case 'queue':
        // `queue` arrives on change only (§O3.3): the elapsed clock runs on from its waitedS between messages
        this.queue = { waiting: s.waiting, waitedS: s.waitedS, at: performance.now() };
        this.showSearch('queue');
        break;
      case 'solo':
        this.showSearch('solo');
        break;
      case 'room': {
        const r = s.room;
        this.lastCode = r.code;
        if (r.phase === 'loading' || r.phase === 'live' || r.phase === 'post') {
          if (!this.matchHidden) {
            this.matchHidden = true;
            this.stopTicker();
            this.root.hidden = true;
            this.screen = null;
            if (this.popNav) { this.popNav(); this.popNav = null; }
          }
          this.hooks.matchPhase?.(r.phase, r);
          return;
        }
        if (this.matchHidden) { this.matchHidden = false; this.root.hidden = false; this.hooks.matchPhase?.(null, r); }
        if (r.quick) this.showSearch('found', r);
        else this.renderRoom(r);
        break;
      }
      case 'error':
        // kicked: its msg is the reason ('idle' | 'owner', §O3.3 kick.why); every other code shows a non-default msg as a detail line
        if (s.code === 'kicked') this.showNotice('kicked', s.msg);
        // §O4.5 step 3: SYNC reports a different atlasSig as {code 'bad', msg 'This device built a different court — reload'}
        else if (s.code === 'bad' && /different court/i.test(s.msg)) this.showNotice('court');
        else this.showNotice(s.code, '', s.msg && s.msg !== NOTICES[s.code]?.text ? s.msg : '');
        break;
      case 'closed':
        this.showNotice('closed', s.why);
        break;
    }
  }

  private onEvent(e: OnlineEvent): void {
    if (this.root.hidden) return;
    switch (e.t) {
      case 'joined': this.toast(`${e.name} joined`); break;
      case 'left': this.toast(`${e.name} left`); break;
      case 'kicked': this.showNotice('kicked', e.why); break;
      case 'voided': this.lastCode = ''; this.showNotice('voided', e.why); break;
      case 'migrating': if (this.screen === 'search') this.showSearch('hostleft'); break;
      case 'migrated': if (this.screen === 'search' && this.searchState === 'hostleft') this.showSearch('loading'); this.toast(`${e.hostName} is hosting now`); break;
      default: break;
    }
  }

  /** a short note at the top right (joined / left / copied) */
  toast(text: string): void {
    const t = el('div', 'dfo-toast', text);
    this.toasts.append(t);
    this.toastLog.push(text);
    if (this.toastLog.length > 12) this.toastLog.shift();
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => { t.classList.add('out'); window.setTimeout(() => t.remove(), 320); }, 2600);
  }

  // ───────────────────────────── hints ─────────────────────────────
  private renderHints(): void {
    const h = this.hints;
    h.replaceChildren();
    h.hidden = this.touch;
    if (this.touch) return;
    const pill = (key: string, label: string): void => {
      const p = el('span', 'dfm-pill');
      p.append(el('kbd', 'dfm-kbd', key), el('span', '', label));
      h.append(p);
    };
    if (this.nav.padSeen) { pill('Ⓐ', 'SELECT'); pill('Ⓑ', this.screen === 'home' ? 'BACK' : this.screen === 'room' ? 'LEAVE' : 'BACK'); }
    pill('↑↓←→', 'MOVE');
    pill('ENTER', 'SELECT');
    pill('ESC', this.screen === 'room' ? 'LEAVE' : this.screen === 'search' ? 'CANCEL' : 'BACK');
  }

  // ───────────────────────────── read-back + teardown ─────────────────────────────
  readback(): Record<string, unknown> {
    const a = document.activeElement as HTMLElement | null;
    return {
      visible: this.visible, screen: this.screen, status: this.st.kind, matchHidden: this.matchHidden,
      search: this.screen === 'search' ? { state: this.searchState, title: this.searchTitle.textContent, stats: this.searchStats.textContent, line: this.searchLine.textContent } : null,
      notice: this.screen === 'notice' ? { kind: this.noticeKind, title: this.noticeTitle.textContent, text: this.noticeText.textContent } : null,
      room: this.screen === 'room' && this.lastRoom ? { code: this.lastRoom.code, owner: this.lastRoom.mySlot === this.lastRoom.ownerSlot,
        seats: this.seats.map((s) => (s.li.classList.contains('bot') ? 'BOT' : s.name.textContent)), start: { shown: !this.startBtn.hidden, enabled: !this.startBtn.disabled },
        note: this.startNote.textContent } : null,
      code: this.codeInput.value, joinEnabled: !this.joinBtn.disabled,
      focus: a && this.root.contains(a) ? (a.id || a.textContent?.trim().slice(0, 40) || a.tagName) : null,
      toasts: [...this.toasts.children].map((t) => t.textContent), toastLog: [...this.toastLog], touch: this.touch, hints: !this.hints.hidden,
      nav: { ...this.nav.counts, padSeen: this.nav.padSeen },
    };
  }

  dispose(): void {
    this.hideAll();
    for (const f of this.offs) f();
    this.offs = [];
    for (const s of this.seats) clearTimeout(s.armT);
    if (this.ownNav) this.nav.dispose();
    this.root.remove();
  }
}
