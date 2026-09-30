/// <reference types="vite/client" />
// HIT PARADE - the menus: every non-bout screen (lane UI; CONTRACT section 8, 16 `Menus`). Machinery from
// dyefield/runtime/src/ui/menus.ts:
//   * every control carries [data-nav]; arrows / WASD / d-pad / left stick move focus SPATIALLY inside the active screen
//     (or the open confirm), wrapping inside a [data-group] column; Enter / Space / pad A activate; Esc / Backspace / pad B
//     go back; pad Start = confirm on the title, RESUME on the pause card; a mouse hover moves focus (mouse only - a tap
//     never leaves a sticky focus, CONTRACT_MOBILE M5); range sliders take left / right themselves.
//   * key remap: per player, two key slots + one pad slot per action; the capture listens in the capture phase, swallows
//     the key, dispatches `hp:capture` {on} on window (input.ts suspends while on) and asks SWAP / CANCEL on a conflict
//     (across BOTH players: they share one keyboard).
//   * touch variants (html.hp-touch): no keyboard hint bar, touch legend on the pause card, the TOUCH CONTROLS card leads
//     SETTINGS, every target >= 44 px; the phone layout is menus.css @media (max-height: 500px).
//   * the pads are polled by the menus' own rAF loop while a screen is up (update(dt) is idempotent within a frame, so an
//     integrator that also calls it is harmless); the same loop drives the character-select Showcase region.
//
// Pause (CONTRACT 18.3): showPause() resolves 'resume' (RESUME / ESC / pad START), 'forfeit' (after the confirm), and
// 'settings' / 'movelist' - game.ts then calls show('settings' | 'movelist', { from: 'pause', onClose }) and the
// menus call onClose when the player backs out (game.ts re-opens the pause card). TRAINING OPTIONS stays inside the
// menus (a pause-stack child). show('ending', { fighter, length, score }) emits { kind: 'quitToTitle' } on dismiss.
// The menus emit intents and never start a match themselves. Flows: SEASON (run + difficulty -> select -> startSeason),
// VERSUS (opponent / CPU level / rounds / timer -> select -> stage -> VS splash -> startMatch), TRAINING (select P1 +
// dummy -> training), ONLINE (lobby -> online intents; blind select -> onlinePick). The integrator drives the rest with
// the promise-returning screens: showResults, showPause, showLadder, showCard, showVs, showEnding, showNameEntry.

import type {
  Action, CardView, LadderView, MatchCfg, MatchResult, MenuIntent, MenusDeps, NetOnlineStatus, OnlineEventName, OnlineStatus, PlayerControls, Rect, Scheme,
  UiOnlineStatus, ScreenId, UiGameData, UiSettings, VsView,
} from './types.ts';
import { banterLines, bonusRules, endingPages, introLine } from './season.ts';
import { ACTIONS } from './types.ts';
import { btn, clamp, div, el, exposeDev, flashesReduced, ICON, pulse, setReduceFlashing, setText, svg, touchModeOn, watchTouchMode } from './dom.ts';
import { colorsOf, fighter, fighterName, fillPortrait, stageList, isBoss, onPortraits, playableStage, setPortraits } from './data.ts';
import { setStrings, t, tOr } from './strings.ts';
import { buildBug } from './broadcast.ts';
import { CharSelect, type CsAct, type CsResult, type CsPick } from './charselect.ts';
import { MoveList } from './movelist.ts';
import { buildResults, type ResultChoice } from './results.ts';
import { TrainingState, trainingRows } from './training.ts';
import './styles.css';
import './menus.css';

export type UiCue = 'move' | 'select' | 'back' | 'start' | 'error';
type PauseChoice = 'resume' | 'settings' | 'forfeit' | 'movelist';

// ─────────────────────────── controls: defaults + labels (FIGHTING_DESIGN 5a/5b on the CONTRACT 1 button model) ───────────────────────────
export function defaultControls(p: 0 | 1): PlayerControls {
  if (p === 0) return {
    scheme: 0,
    keys: {
      up: ['KeyW', 'Space'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], l: ['KeyJ'], m: ['KeyK'], h: ['KeyL'], s: ['KeyI'],
      assist: ['KeyU'], throw: ['KeyH'], parry: ['KeyO'], impact: ['KeyP'], taunt: ['KeyY'], pause: ['Escape'],
    },
    pad: { up: [12], down: [13], left: [14], right: [15], l: [2], m: [3], h: [5], s: [0], assist: [1], throw: [6], parry: [4], impact: [7], taunt: [8], pause: [9] },
  };
  return {
    scheme: 0,
    keys: {
      up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], l: ['Numpad1'], m: ['Numpad2'], h: ['Numpad3'],
      s: ['Numpad5'], assist: ['Numpad4'], throw: ['Numpad0'], parry: ['Numpad6'], impact: ['NumpadAdd'], taunt: ['NumpadMultiply'], pause: [],
    },
    pad: { up: [12], down: [13], left: [14], right: [15], l: [2], m: [3], h: [5], s: [0], assist: [1], throw: [6], parry: [4], impact: [7], taunt: [8], pause: [9] },
  };
}

export function codeLabel(code: string): string {
  if (!code) return t('misc.none');
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code); if (m) return `NUM ${m[1]}`;
  m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code); if (m) return m[1] === 'Control' ? 'CTRL' : m[1].toUpperCase();
  const named: Record<string, string> = {
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB',
    Backspace: 'BKSP', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backquote: '`', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -', NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /',
    NumpadEnter: 'NUM ENT', NumpadDecimal: 'NUM .', CapsLock: 'CAPS', Mouse0: 'MOUSE L', Mouse1: 'MOUSE M', Mouse2: 'MOUSE R',
  };
  return named[code] ?? code.toUpperCase();
}
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'D-UP', 'D-DOWN', 'D-LEFT', 'D-RIGHT', 'HOME'];
export function padLabel(i: number | undefined): string { return i === undefined ? t('misc.none') : (PAD_NAMES[i] ?? `B${i}`); }

const VOL_DEFAULT = { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.7, voice: 0.9 };       // = SHELL settings DEFAULT_VOLUMES
const FS = (): { enabled: boolean; active: boolean } => {
  try { return { enabled: !!document.fullscreenEnabled, active: !!document.fullscreenElement }; } catch { return { enabled: false, active: false }; }
};

interface Flow {
  kind: 'season' | 'versus' | 'training' | 'online';
  length: 'season' | 'pilot'; difficulty: number;
  opponent: 'human' | 'cpu'; cpuLevel: number; rounds: number; timer: number;
  picks: CsResult | null; stage: string;
}
interface Capture { p: 0 | 1; action: Action; slot: 0 | 1 | 'pad'; btn: HTMLButtonElement; off: () => void }
interface Conflict { p: 0 | 1; action: Action; slot: 0 | 1 | 'pad'; value: string | number; other: { p: 0 | 1; action: Action } }
interface PadState { prev: boolean[]; dir: string; repeatT: number }

export class Menus {
  readonly root: HTMLElement;
  readonly training = new TrainingState();
  screen: ScreenId | null = null;
  /** set false when game.ts renders the Showcase itself (it then reads showcaseRect()) */
  driveShowcase = true;
  private readonly data: UiGameData;
  private readonly deps: MenusDeps;
  private readonly screens = new Map<ScreenId, HTMLElement>();
  private stack: ScreenId[] = [];
  private readonly intents = new Set<(i: MenuIntent) => void>();
  private flow: Flow = { kind: 'versus', length: 'season', difficulty: 1, opponent: 'cpu', cpuLevel: 3, rounds: 2, timer: 99, picks: null, stage: '' };
  private readonly cs: CharSelect;
  private readonly ml: MoveList;
  private readonly hints: HTMLElement;
  private readonly confirmBox: HTMLElement;
  private readonly confirmTitle: HTMLElement;
  private readonly confirmBody: HTMLElement;
  private readonly confirmYes: HTMLButtonElement;
  private readonly confirmNo: HTMLButtonElement;
  private confirmResolve: ((ok: boolean) => void) | null = null;
  private confirmReturn: HTMLElement | null = null;
  // per-screen parts
  private readonly segs = new Map<string, Map<string, HTMLButtonElement>>();
  private readonly updaters: Array<() => void> = [];
  private readonly mainDesc: HTMLElement;
  private readonly mainDescTitle: HTMLElement;
  private readonly stageBox: HTMLElement;
  private readonly vsBox: HTMLElement;
  private readonly resBox: HTMLElement;
  private readonly ladderBox: HTMLElement;
  private readonly cardBox: HTMLElement;
  private readonly endBox: HTMLElement;
  private readonly nameBox: HTMLElement;
  private readonly onlineStatus: HTMLElement;
  private readonly onSteps: HTMLElement;
  private readonly onRoom: HTMLElement;
  private readonly onOpp: HTMLElement;
  private readonly onQual: HTMLElement;
  /** CHANGED(UI) P2: what the lobby knows about the online session (status payloads + forwarded NET events) */
  private net: { phase: string; code: string; room: string; transport: string; rttMs: number; opponent: string; locked: boolean; peerRematch: boolean | null; rated: boolean | null; selectLeft: number } =
    { phase: 'idle', code: '', room: '', transport: '', rttMs: -1, opponent: '', locked: false, peerRematch: null, rated: null, selectLeft: 0 };
  private selectTimer = 0;
  private readonly onlineCode: HTMLInputElement;
  private readonly onlineName: HTMLInputElement;
  private readonly pauseLegend: HTMLElement;
  private readonly pauseTrainingBtn: HTMLButtonElement;
  private readonly pauseForfeitBtn: HTMLButtonElement;
  private readonly pauseNote: HTMLElement;
  private trNoteEl: HTMLElement | null = null;
  private readonly keysBox: HTMLElement;
  private readonly bindNote: HTMLElement;
  private readonly touchCard: HTMLElement;
  private readonly fsBtns: HTMLButtonElement[] = [];
  private setPlayer: 0 | 1 = 0;
  private keyBtns = new Map<string, HTMLButtonElement>();
  private capture: Capture | null = null;
  private conflict: Conflict | null = null;
  // modal resolvers
  private resolveResults: ((c: ResultChoice) => void) | null = null;
  private resolvePause: ((c: PauseChoice) => void) | null = null;
  private resolveLadder: ((c: 'go' | 'quit') => void) | null = null;
  private resolveAny: (() => void) | null = null;
  private resolveName: ((s: string) => void) | null = null;
  /** the results card's countdown (CONTINUE screen) disposer + the last result shown (read-back) */
  private resDispose: () => void = () => undefined;
  private lastResult: MatchResult | null = null;
  /** CONTRACT 18.3: a sub-screen opened for the pause card; backing out of its root calls this */
  private subClose: (() => void) | null = null;
  /** the fighter the move list shows by default (the last P1 pick / game.ts's setMoveList) */
  private mlFighter = '';
  private mlScheme: Scheme = 0;
  private anyArmedAt = 0;
  private vsTimer = 0;
  private endingStep = '';
  private nameLetters = [0, 0, 0];
  private nameSlot = 0;
  private nameSlots: HTMLElement[] = [];
  private nameMine: HTMLElement | null = null;
  // loop / pads
  private raf = 0;
  private lastPoll = 0;
  private lastT = 0;
  private pads: PadState[] = [];
  private padSeen = false;
  private touch = touchModeOn();
  private offs: Array<() => void> = [];
  private lastShowcase: Rect | null = null;

  constructor(host: HTMLElement, data: UiGameData, deps: MenusDeps) {
    this.data = data;
    this.deps = deps;
    setStrings(data.strings);
    const R = this.root = el('div', 'hpm');
    R.id = 'hp-menus';
    R.hidden = true;

    // ── TITLE ─────────────────────────────────────────
    const title = this.mkScreen('title');
    div('hpm-burst', title);
    const tb = div('hpm-title-bug', title);
    tb.append(buildBug(t('show.slot')));
    const corner = div('hpm-corner', title);
    corner.append(this.fsButton('hpm-fs-title'));
    const logo = div('hpm-logo', title);
    logo.setAttribute('aria-label', t('show.name'));
    const [w1, ...rest] = t('show.name').split(' ');
    logo.append(el('span', 'w1', w1), el('span', 'w2', rest.join(' ')));
    div('hpm-network', title, t('show.network'));
    div('hpm-strap', title, t('title.strap'));
    const press = btn('hpm-press', '');
    press.id = 'hpm-press';
    press.dataset.default = '';
    press.append(el('span', 'kbm', t('title.press')), el('span', 'tch', t('title.pressTouch')));
    title.append(press);
    div('hpm-host', title, t('title.host'));

    // ── MAIN MENU ─────────────────────────────────────
    const main = this.mkScreen('main');
    main.append(this.header(t('main.title'), '', false));
    const mm = div('hpm-main', main);
    const stack = div('hpm-stack', mm);
    stack.setAttribute('role', 'menu');
    const items: Array<[string, () => void]> = [
      ['season', () => this.show('season')], ['versus', () => this.show('versus')], ['online', () => this.show('online')],
      ['training', () => this.startTrainingFlow()], ['settings', () => this.show('settings')], ['credits', () => this.show('credits')],
    ];
    const card = div('hpm-card hpm-guide', mm);
    card.append(buildBug(t('show.network')));
    this.mainDescTitle = el('h3', 'hpm-guide-t', '');
    this.mainDesc = el('p', 'hpm-guide-d', '');
    card.append(this.mainDescTitle, this.mainDesc);
    items.forEach(([k, fn], i) => {
      const b = btn(`hpm-item${i === 0 ? ' hot' : ''}`, '');
      b.id = `hpm-main-${k}`;
      b.dataset.group = 'main';
      if (i === 0) b.dataset.default = '';
      b.append(el('span', 'n', String(i + 1).padStart(2, '0')), el('span', 'lbl', t(`main.${k}`)));
      b.addEventListener('click', () => { this.sound('select'); fn(); });
      b.addEventListener('focus', () => { setText(this.mainDescTitle, t(`main.${k}`)); setText(this.mainDesc, t(`main.${k}.sub`)); });
      stack.append(b);
    });

    // ── SEASON setup ──────────────────────────────────
    const season = this.mkScreen('season');
    season.append(this.header(t('season.title'), t('season.hint')));
    const sb = div('hpm-setup', season);
    sb.append(
      this.segCard('season.length', t('season.length'), [['season', t('season.full'), t('season.full.sub')], ['pilot', t('season.pilot'), t('season.pilot.sub')]],
        () => this.flow.length, (v) => { this.flow.length = v as Flow['length']; }),
      this.segCard('season.diff', t('season.diff'), [['0', t('diff.0'), t('diff.0.sub')], ['1', t('diff.1'), t('diff.1.sub')], ['2', t('diff.2'), t('diff.2.sub')]],
        () => String(this.flow.difficulty), (v) => { this.flow.difficulty = Number(v); }),
    );
    const sgo = btn('hpm-btn hot hpm-go', t('season.go'));
    sgo.id = 'hpm-season-go';
    sgo.dataset.row = 'go';
    sgo.addEventListener('click', () => { this.sound('select'); this.flow.kind = 'season'; this.openSelect('season', 'none'); });
    sb.append(sgo);

    // ── VERSUS setup ──────────────────────────────────
    const versus = this.mkScreen('versus');
    versus.append(this.header(t('versus.title'), t('versus.hint')));
    const vb = div('hpm-setup', versus);
    const lvl: Array<[string, string]> = [];
    for (let i = 1; i <= 8; i++) lvl.push([String(i), String(i)]);
    const cpuRow = this.segCard('versus.cpuLevel', t('versus.cpuLevel'), lvl.map(([v, l]) => [v, l, ''] as [string, string, string]),
      () => String(this.flow.cpuLevel), (v) => { this.flow.cpuLevel = Number(v); }, 'small');
    vb.append(
      this.segCard('versus.opp', t('versus.opponent'), [['cpu', t('versus.cpu'), t('versus.cpu.sub')], ['human', t('versus.p2'), t('versus.p2.sub')]],
        () => this.flow.opponent, (v) => { this.flow.opponent = v as Flow['opponent']; }),
      cpuRow,
      this.segCard('versus.rounds', t('versus.rounds'), [['1', '1', ''], ['2', '2', ''], ['3', '3', '']], () => String(this.flow.rounds), (v) => { this.flow.rounds = Number(v); }, 'small'),
      this.segCard('versus.timer', t('versus.timer'), [['60', '60', ''], ['99', '99', ''], ['0', t('versus.timer.inf'), '']], () => String(this.flow.timer), (v) => { this.flow.timer = Number(v); }, 'small'),
    );
    this.updaters.push(() => { cpuRow.hidden = this.flow.opponent !== 'cpu'; });
    const vgo = btn('hpm-btn hot hpm-go', t('versus.go'));
    vgo.id = 'hpm-versus-go';
    vgo.dataset.row = 'go';
    vgo.addEventListener('click', () => { this.sound('select'); this.flow.kind = 'versus'; this.openSelect('versus', this.flow.opponent); });
    vb.append(vgo);

    // ── CHARACTER SELECT ──────────────────────────────
    const csS = this.mkScreen('charselect');
    csS.append(this.header(t('cs.title'), ''));
    this.cs = new CharSelect(csS, data, {
      done: (r) => this.onPicked(r),
      back: () => this.back(),
      show: (id, color, pose) => this.showcaseShow(id, color, pose),
      sound: (c) => this.sound(c),
      defaultScheme: (p) => this.controls(p).scheme,
    });

    // ── STAGE SELECT ──────────────────────────────────
    const st = this.mkScreen('stage');
    st.append(this.header(t('stage.title'), t('stage.hint')));
    this.stageBox = div('hpm-stages', st);

    // ── VS splash ─────────────────────────────────────
    const vs = this.mkScreen('vs');
    this.vsBox = div('hpm-vs', vs);

    // ── RESULTS ───────────────────────────────────────
    const res = this.mkScreen('results');
    res.append(this.header(t('res.title'), '', false));
    this.resBox = div('hpm-resbox', res);

    // ── LADDER ────────────────────────────────────────
    const lad = this.mkScreen('ladder');
    lad.append(this.header(t('ladder.title'), '', false));
    this.ladderBox = div('hpm-ladder', lad);

    // ── CARD (rival / boss / brawl / heckler) ─────────
    const cardS = this.mkScreen('card');
    this.cardBox = div('hpm-slatecard', cardS);

    // ── ENDING ────────────────────────────────────────
    const endS = this.mkScreen('ending');
    this.endBox = div('hpm-slatecard hpm-ending', endS);

    // ── NAME ENTRY ────────────────────────────────────
    const nm = this.mkScreen('nameentry');
    nm.append(this.header(t('name.title'), t('name.hint'), false));
    this.nameBox = div('hpm-name', nm);

    // ── PAUSE ─────────────────────────────────────────
    const pause = this.mkScreen('pause');
    const pc = div('hpm-card hpm-pause', pause);
    const pl = div('hpm-pause-l', pc);
    const ph = el('h2', 'hpm-pause-t', t('pause.title'));
    pl.append(ph, el('p', 'hpm-pause-sub', t('pause.sub')));
    const pItem = (id: string, label: string, fn: () => void, hot = false): HTMLButtonElement => {
      const b = btn(`hpm-item small${hot ? ' hot' : ''}`, '');
      b.id = id;
      b.dataset.group = 'pause';
      b.append(el('span', 'lbl', label));
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      pl.append(b);
      return b;
    };
    const resume = pItem('hpm-p-resume', t('pause.resume'), () => { this.sound('select'); this.finishPause('resume'); }, true);
    resume.dataset.default = '';
    pItem('hpm-p-movelist', t('pause.movelist'), () => { this.sound('select'); this.finishPause('movelist'); });
    this.pauseTrainingBtn = pItem('hpm-p-training', t('pause.training'), () => { this.sound('select'); this.push('training'); });
    pItem('hpm-p-settings', t('pause.settings'), () => { this.sound('select'); this.finishPause('settings'); });
    const pfs = this.fsButton('hpm-p-fullscreen', true);
    pfs.dataset.group = 'pause';
    pl.append(pfs);
    this.pauseForfeitBtn = pItem('hpm-p-forfeit', t('pause.forfeit'), () => { this.sound('select'); void this.askForfeit(); });
    this.pauseNote = el('p', 'hpm-pause-note', '');
    pl.append(this.pauseNote);
    const pr = div('hpm-pause-r', pc);
    pr.append(el('h3', 'hpm-cap', t('pause.controls')));
    this.pauseLegend = div('hpm-legend', pr);

    // ── SETTINGS ──────────────────────────────────────
    const set = this.mkScreen('settings');
    set.append(this.header(t('set.title'), ''));
    const sc = div('hpm-set hpm-scroll', set);
    // touch controls card (leads in touch mode)
    this.touchCard = div('hpm-card hpm-touchset', sc);
    this.touchCard.append(el('h3', 'hpm-cap', t('set.touch')));
    this.touchCard.append(
      this.slider('touch-scale', t('set.touch.scale'), 0.8, 1.3, 0.05, () => this.s().touchScale ?? 1, (v) => this.put({ touchScale: v }), (v) => `${Math.round(v * 100)}%`),
      this.slider('touch-opacity', t('set.touch.opacity'), 0.35, 1, 0.05, () => this.s().touchOpacity ?? 0.75, (v) => this.put({ touchOpacity: v }), (v) => `${Math.round(v * 100)}%`),
      this.toggle('touch-left', t('set.touch.left'), () => !!this.s().touchLeftHanded, (v) => this.put({ touchLeftHanded: v })),
      this.toggle('haptics', t('set.touch.haptics'), () => this.s().haptics !== false, (v) => this.put({ haptics: v })),
    );
    const tr = btn('hpm-small', t('set.touch.reset'));
    tr.id = 'hpm-touch-reset';
    tr.addEventListener('click', () => { this.sound('select'); this.put({ touchLayout: null }); });
    this.touchCard.append(tr, el('p', 'hpm-note', t('set.touch.hint')));
    // controls
    const ctl = div('hpm-card hpm-keys', sc);
    const kh = div('hpm-keys-head', ctl);
    kh.append(el('h3', 'hpm-cap', t('set.controls')));
    const ptabs = div('hpm-seg small', kh);
    for (const p of [0, 1] as const) {
      const b = btn('hpm-segbtn', t('set.player', { n: p + 1 }));
      b.id = `hpm-set-p${p + 1}`;
      b.addEventListener('click', () => { this.sound('move'); this.setPlayer = p; this.endCapture(); this.conflict = null; this.note(''); this.refresh(); });
      ptabs.append(b);
      this.segMap('set.player').set(String(p), b);
    }
    ctl.append(this.segRow('set.scheme', t('set.scheme'), [['0', t('cs.simple')], ['1', t('cs.classic')]],
      () => String(this.controls(this.setPlayer).scheme), (v) => this.putControls(this.setPlayer, { scheme: Number(v) as Scheme })));
    const cols = div('hpm-bind head', ctl);
    cols.append(el('span', 'lbl', ''), el('span', 'col', t('set.keyCol')), el('span', 'col', t('set.altCol')), el('span', 'col', t('set.padCol')));
    this.keysBox = div('hpm-binds', ctl);
    for (const a of ACTIONS) {
      const row = div('hpm-bind', this.keysBox);
      row.append(el('span', 'lbl', t(`act.${a}`)));
      for (const slot of [0, 1, 'pad'] as const) {
        const b = btn('hpm-key', '');
        b.id = `hpm-key-${a}-${slot}`;
        b.dataset.action = a;
        b.dataset.slot = String(slot);
        b.addEventListener('click', () => this.beginCapture(this.setPlayer, a, slot, b));
        this.keyBtns.set(`${a}:${slot}`, b);
        row.append(b);
      }
    }
    this.bindNote = div('hpm-bindnote', ctl);
    this.bindNote.setAttribute('role', 'status');
    const rk = btn('hpm-small', t('set.reset'));
    rk.id = 'hpm-reset-keys';
    rk.addEventListener('click', () => { this.sound('select'); this.endCapture(); this.conflict = null; this.resetControls(this.setPlayer); this.note(''); });
    ctl.append(rk, el('p', 'hpm-note', t('set.p2pad')));
    // audio
    const au = div('hpm-card', sc);
    au.append(el('h3', 'hpm-cap', t('set.audio')));
    for (const k of ['master', 'music', 'sfx', 'crowd', 'voice'] as const) {
      au.append(this.slider(`vol-${k}`, t(`set.vol.${k}`), 0, 1, 0.05, () => this.s().volume?.[k] ?? VOL_DEFAULT[k],
        (v) => this.put({ volume: { ...VOL_DEFAULT, ...this.s().volume, [k]: v } }), (v) => String(Math.round(v * 100))));
    }
    // show
    const sh = div('hpm-card', sc);
    sh.append(el('h3', 'hpm-cap', t('set.show')));
    sh.append(
      this.segRow('set.gore', t('set.gore'), [['splatter', t('gore.splatter')], ['sparks', t('gore.sparks')], ['confetti', t('gore.confetti')]],
        () => this.s().gore ?? 'splatter', (v) => this.put({ gore: v as UiSettings['gore'] })),
      this.slider('shake', t('set.shake'), 0, 1, 0.05, () => this.s().screenShake ?? 1, (v) => this.put({ screenShake: v }), (v) => `${Math.round(v * 100)}%`),
      this.toggle('flashing', t('set.flashing'), () => !!this.s().reduceFlashing, (v) => this.put({ reduceFlashing: v })),
      this.segRow('set.cinematics', t('set.cinematics'), [['full', t('cin.full')], ['short', t('cin.short')]],
        () => this.s().cinematics ?? 'full', (v) => this.put({ cinematics: v as UiSettings['cinematics'] })),
    );
    // video
    const vd = div('hpm-card', sc);
    vd.append(el('h3', 'hpm-cap', t('set.video')));
    vd.append(
      this.segRow('set.quality', t('set.quality'), [['low', t('q.low')], ['med', t('q.med')], ['high', t('q.high')]],
        () => this.s().quality ?? 'high', (v) => this.put({ quality: v as UiSettings['quality'] })),
      this.toggle('bloom', t('set.bloom'), () => this.s().bloom !== false, (v) => this.put({ bloom: v })),
      this.segRow('set.language', t('set.language'), [['en', t('lang.en')]], () => 'en', () => this.put({ language: 'en' })),
    );

    // ── TRAINING options ─────────────────────────────
    const trs = this.mkScreen('training');
    trs.append(this.header(t('tr.title'), ''));
    const tc = div('hpm-card hpm-training hpm-scroll', trs);
    for (const r of trainingRows()) {
      if (r.kind === 'seg') tc.append(this.segRow(`tr.${r.key}`, r.label, r.opts.map(([v, l]) => [v, l] as [string, string]),
        () => String(this.training.get()[r.key]), (v) => this.training.set({ [r.key]: v } as never)));
      else if (r.kind === 'level') {
        const opts: Array<[string, string]> = [];
        for (let i = 1; i <= 8; i++) opts.push([String(i), String(i)]);
        tc.append(this.segRow('tr.cpuLevel', r.label, opts, () => String(this.training.get().cpuLevel), (v) => this.training.set({ cpuLevel: Number(v) }), 'small'));
      } else if (r.kind === 'toggle') tc.append(this.toggle(`tr-${r.key}`, r.label, () => !!this.training.get()[r.key], (v) => this.training.set({ [r.key]: v } as never)));
      else {
        // RESET POSITION: MID / CORNER (the dummy cornered) / YOU CORNERED - the driver builds the positioned match and the
        // bout resumes at once (CONTRACT 27.1)
        const row = el('div', 'hpm-row wrap hpm-tr-reset');
        row.append(el('span', 'lbl', r.label));
        const seg = div('hpm-seg small', row);
        for (const [where, label] of r.opts) {
          const b = btn('hpm-segbtn', label);
          b.id = `hpm-tr-reset-${where}`;
          b.addEventListener('click', () => { this.sound('select'); this.training.reset(where); this.trNote(t('tr.reset.done', { where: label })); });
          seg.append(b);
        }
        tc.append(row);
      }
    }
    this.trNoteEl = el('p', 'hpm-note hpm-tr-note', '');
    this.trNoteEl.setAttribute('role', 'status');
    tc.append(this.trNoteEl);
    this.offs.push(this.training.on((o, action) => {
      if (action === 'change') this.trNote(o.record === 'record' ? t('tr.rec.hint') : o.record === 'play' ? (this.training.recorded > 0 ? t('tr.play.hint') : t('tr.play.none')) : o.dummy === 'cpu' ? t('tr.cpu.hint', { n: o.cpuLevel }) : '');
      this.refresh();
    }));

    // ── MOVE LIST ─────────────────────────────────────
    const mls = this.mkScreen('movelist');
    mls.append(this.header(t('ml.title'), ''));
    const mlw = div('hpm-card hpm-mlcard hpm-scroll', mls);
    this.ml = new MoveList(mlw, data, () => this.sound('move'));

    // ── ONLINE ────────────────────────────────────────
    const on = this.mkScreen('online');
    on.append(this.header(t('on.title'), t('on.hint')));
    const ob = div('hpm-online', on);
    const acts = div('hpm-on-acts', ob);
    const oAct = (id: 'quick' | 'create', fn: () => void): HTMLButtonElement => {
      const b = btn('hpm-oncard', '');
      b.id = `hpm-on-${id}`;
      b.append(svg(ICON.wifi, 'ico'), el('b', '', t(`on.${id}`)), el('span', '', t(`on.${id}.sub`)));
      b.addEventListener('click', fn);
      acts.append(b);
      return b;
    };
    oAct('quick', () => { this.sound('select'); this.emit({ kind: 'online', action: 'quick', name: this.onlineName.value.trim() || undefined }); }).dataset.default = '';
    oAct('create', () => { this.sound('select'); this.emit({ kind: 'online', action: 'create', name: this.onlineName.value.trim() || undefined }); });
    const join = div('hpm-oncard join', acts);
    join.append(svg(ICON.wifi, 'ico'), el('b', '', t('on.join')), el('span', '', t('on.join.sub')));
    const jr = div('hpm-on-join', join);
    this.onlineCode = el('input', 'hpm-input code');
    this.onlineCode.id = 'hpm-on-code';
    this.onlineCode.maxLength = 4;
    this.onlineCode.placeholder = t('on.codePh');
    this.onlineCode.setAttribute('aria-label', t('on.code'));
    this.onlineCode.autocomplete = 'off';
    this.onlineCode.spellcheck = false;
    this.onlineCode.dataset.nav = '';
    this.onlineCode.addEventListener('input', () => { const v = this.onlineCode.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); if (v !== this.onlineCode.value) this.onlineCode.value = v; });
    const jgo = btn('hpm-btn hot', t('on.go'));
    jgo.id = 'hpm-on-join';
    jgo.addEventListener('click', () => {
      const code = this.onlineCode.value;
      if (!/^[A-Z]{4}$/.test(code)) { this.sound('error'); this.setOnlineStatus({ st: 'failed', reason: t('on.st.badCode') }); return; }
      this.sound('select');
      this.emit({ kind: 'online', action: 'join', code, name: this.onlineName.value.trim() || undefined });
    });
    jr.append(this.onlineCode, jgo);
    const side = div('hpm-card hpm-on-side', ob);
    side.append(el('h3', 'hpm-cap', t('on.name')));
    this.onlineName = el('input', 'hpm-input');
    this.onlineName.id = 'hpm-on-name';
    this.onlineName.maxLength = 16;
    this.onlineName.autocomplete = 'off';
    this.onlineName.spellcheck = false;
    this.onlineName.dataset.nav = '';
    this.onlineName.value = this.deps.save.get().onlineName ?? '';
    this.onlineName.addEventListener('change', () => this.deps.save.set?.({ onlineName: this.onlineName.value.trim().slice(0, 16) }));
    side.append(this.onlineName, el('h3', 'hpm-cap', t('on.status')));
    // CHANGED(UI) P2: the lobby status panel - the flow's steps, the status line (NET codes, strings.json net.*), the room
    // code to share, the opponent, and the connection (DIRECT / BACKUP LINE + ping bars) (CONTRACT 27.2)
    this.onSteps = div('hpm-on-steps', side);
    for (const k of ['search', 'room', 'connect', 'sync', 'select', 'fight'] as const) this.onSteps.append(el('i', `s-${k}`, t(`on.step.${k}`)));
    this.onlineStatus = div('hpm-on-status', side, t('on.st.idle'));
    this.onlineStatus.id = 'hpm-on-status';
    this.onlineStatus.setAttribute('role', 'status');
    this.onRoom = div('hpm-on-room', side);
    this.onRoom.hidden = true;
    this.onOpp = div('hpm-on-opp', side);
    this.onOpp.hidden = true;
    this.onQual = div('hpm-on-qual', side);
    this.onQual.hidden = true;
    const leave = btn('hpm-small', t('on.cancel'));
    leave.id = 'hpm-on-leave';
    leave.addEventListener('click', () => { this.sound('back'); this.emit({ kind: 'online', action: 'cancel' }); this.resetNet(); this.setOnlineStatus({ st: 'idle' }); });
    side.append(leave);

    // ── CREDITS ───────────────────────────────────────
    const cr = this.mkScreen('credits');
    cr.append(this.header(t('cr.title'), ''));
    const cc = div('hpm-card hpm-credits hpm-scroll', cr);
    const logo2 = div('hpm-logo small', cc);
    logo2.append(el('span', 'w1', w1), el('span', 'w2', rest.join(' ')));
    cc.append(el('p', 'hpm-tagline', t('cr.fiction')));
    const grid = div('hpm-cgrid', cc);
    const block = (h: string, keys: string[]): void => {
      const b = div('blk', grid);
      b.append(el('h3', 'hpm-cap', t(h)));
      for (const k of keys) b.append(el('p', '', k));
    };
    block('cr.made', [t('cr.made.1'), t('cr.made.2')]);
    block('cr.built', [t('cr.built.1'), t('cr.built.2'), t('cr.built.3')]);
    block('cr.motion', [t('cr.motion.1'), t('cr.motion.2')]);
    block('cr.type', [1, 2, 3, 4, 5].map((i) => t(`cr.type.${i}`)));
    block('cr.audio', audioCredits());

    // ── confirm modal + hints ─────────────────────────
    this.confirmBox = div('hpm-confirm', R);
    this.confirmBox.hidden = true;
    this.confirmBox.setAttribute('role', 'alertdialog');
    const qc = div('hpm-card hpm-confirm-card', this.confirmBox);
    this.confirmTitle = el('h2', '', '');
    this.confirmBody = el('p', '', '');
    const qr = div('hpm-row center', qc);
    this.confirmNo = btn('hpm-btn', '');
    this.confirmNo.id = 'hpm-confirm-no';
    this.confirmNo.dataset.default = '';
    this.confirmYes = btn('hpm-btn danger', '');
    this.confirmYes.id = 'hpm-confirm-yes';
    this.confirmNo.addEventListener('click', (e) => { e.stopPropagation(); this.closeConfirm(false); });
    this.confirmYes.addEventListener('click', (e) => { e.stopPropagation(); this.closeConfirm(true); });
    qr.append(this.confirmNo, this.confirmYes);
    qc.prepend(this.confirmTitle, this.confirmBody);
    qc.append(qr);
    this.hints = div('hpm-hints', R);

    for (const s of this.screens.values()) R.insertBefore(s, this.confirmBox);
    host.append(R);

    // listeners
    const onKey = (e: KeyboardEvent): void => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
    const onOver = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      const tg = (e.target as HTMLElement | null)?.closest?.('[data-nav]') as HTMLElement | null;
      if (!tg || tg === document.activeElement || !this.inScope(tg)) return;
      if (tg.tagName === 'INPUT' && (tg as HTMLInputElement).type === 'text') return;
      this.focus(tg, true);
    };
    R.addEventListener('pointerover', onOver);
    // the title screen: any tap / click anywhere starts
    // any click / tap on the title starts (on click, not pointerdown: the tap's own click must not land on the main menu)
    title.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.hpm-corner') || this.screen !== 'title') return; this.sound('start'); this.show('main'); });
    const onFs = (): void => this.syncFullscreen();
    document.addEventListener('fullscreenchange', onFs);
    this.offs.push(() => document.removeEventListener('fullscreenchange', onFs));
    this.offs.push(watchTouchMode((on2) => this.setTouchMode(on2)));
    this.offs.push(this.deps.settings.on((s) => { setReduceFlashing(!!s.reduceFlashing); this.refresh(); }));
    this.offs.push(onPortraits(() => this.cs.refreshPortraits()));
    setReduceFlashing(!!this.s().reduceFlashing);
    this.setTouchMode(this.touch);
    this.syncFullscreen();
    this.refresh();
    exposeDev('menus', this);
  }

  // ─────────────────────────── CONTRACT 16 ───────────────────────────
  onIntent(cb: (i: MenuIntent) => void): () => void { this.intents.add(cb); return () => this.intents.delete(cb); }

  /** open a screen. title / main reset the stack; params: charselect {mode, opponent}, movelist {fighter, scheme},
   *  online {status}, stage {}; the modal screens have their own promise-returning methods */
  show(screen: ScreenId, params?: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    this.subClose = null;
    if (p.from === 'pause') {
      // CONTRACT 18.3: settings / movelist opened for the pause card; backing out calls onClose
      this.stack = [screen];
      this.subClose = typeof p.onClose === 'function' ? (p.onClose as () => void) : null;
      if (screen === 'movelist') this.ml.render(typeof p.fighter === 'string' ? p.fighter : this.mlDefault(), (p.scheme === 1 ? 1 : p.scheme === 0 ? 0 : this.mlScheme) as Scheme);
      this.render(screen);
      return;
    }
    if (screen === 'ending') {
      const fid = typeof p.fighter === 'string' ? p.fighter : this.mlDefault();
      void this.showEnding({ fighter: fid, score: typeof p.score === 'number' ? p.score : 0, unlocked: Array.isArray(p.unlocked) ? (p.unlocked as string[]) : [] })
        .then(() => this.emit({ kind: 'quitToTitle' }));
      return;
    }
    if (screen === 'title') this.stack = ['title'];
    else if (screen === 'main') this.stack = ['title', 'main'];
    else if (screen === 'charselect' && typeof p.mode === 'string') {
      this.flow.kind = p.mode as Flow['kind'];
      this.stack = this.stack.length ? this.stack : ['title', 'main'];
      this.openSelect(p.mode as Flow['kind'], (p.opponent as 'human' | 'cpu' | 'dummy' | 'none') ?? 'none');
      return;
    } else if (screen === 'movelist') {
      this.ml.render(typeof p.fighter === 'string' ? p.fighter : this.mlDefault(), (p.scheme === 1 ? 1 : p.scheme === 0 ? 0 : this.mlScheme) as Scheme);
      this.push('movelist');
      return;
    } else if (screen === 'online' && p.status) {
      this.setOnlineStatus(p.status as OnlineStatus);
      this.push('online');
      return;
    } else { this.push(screen); return; }
    this.render(screen);
  }

  hide(): void {
    this.endCapture();
    this.resDispose();
    this.root.hidden = true;
    this.screen = null;
    this.stack = [];
    this.confirmBox.hidden = true;
    for (const s of this.screens.values()) s.hidden = true;
    this.showcaseRegion(false);
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.stopLoop();
  }

  showResults(r: MatchResult): Promise<ResultChoice> {
    this.stack = ['results'];
    this.resDispose();
    return new Promise<ResultChoice>((resolve) => {
      this.resolveResults = resolve;
      const view = buildResults(this.resBox, this.data, r, (c) => this.finishResults(c), this.touch);
      this.resDispose = view.dispose;
      this.lastResult = r;
      this.render('results');
      if (view.buttons[0]) this.focus(view.buttons[0], false);
      this.music('results');
    });
  }

  showPause(o: { training?: boolean; online?: boolean; fighter?: string; scheme?: Scheme } = {}): Promise<PauseChoice> {
    this.stack = ['pause'];
    this.pauseTrainingBtn.hidden = !o.training;
    const fl = this.pauseForfeitBtn.querySelector('.lbl');
    if (fl) fl.textContent = o.training ? tOr('pause.exitTraining', t('pause.forfeit')) : t('pause.forfeit');
    setText(this.pauseNote, o.online ? t('pause.online') : '');
    if (o.fighter) { this.mlFighter = o.fighter; this.mlScheme = o.scheme ?? this.controls(0).scheme; }
    return new Promise<PauseChoice>((resolve) => {
      this.resolvePause = resolve;
      this.render('pause');
    });
  }

  // ─────────────────────────── additive API (CHANGED(UI)) ───────────────────────────
  showVs(v: VsView, autoMs = 2600): Promise<void> {
    this.stack = ['vs'];
    this.buildVs(v);
    return this.anyKeyScreen('vs', autoMs);
  }

  showLadder(v: LadderView): Promise<'go' | 'quit'> {
    this.stack = ['ladder'];
    this.buildLadder(v);
    return new Promise((resolve) => {
      this.resolveLadder = resolve;
      this.render('ladder');
      // the current episode in view (a phone shows about five rows)
      this.ladderBox.querySelector<HTMLElement>('.hpm-lad-row.cur')?.scrollIntoView({ block: 'nearest' });
    });
  }

  showCard(c: CardView): Promise<void> {
    this.stack = ['card'];
    this.buildCard(c);
    return this.anyKeyScreen('card', 0);
  }

  /**
   * CHANGED(UI) P2 (CONTRACT 27.4): the per-fighter ENDING sequence - SEASON FINALE, the fighter's ending text (fighters/<id>
   * .json `ending`, paged by sentences), RATINGS TOTAL, THE BOARD (the local board incl. this clear), UNLOCKED - one card
   * per press; resolves after the last card.
   */
  async showEnding(p: { fighter: string; score: number; unlocked: string[]; length?: 'season' | 'pilot'; continues?: number }): Promise<void> {
    const pages = endingPages(this.data, p.fighter);
    const cards: Array<{ kind: 'finale' | 'text' | 'ratings' | 'board' | 'unlock'; page?: number }> = [{ kind: 'finale' }];
    pages.forEach((_, i) => cards.push({ kind: 'text', page: i }));
    cards.push({ kind: 'ratings' });
    if ((this.deps.save.get().board ?? []).length) cards.push({ kind: 'board' });
    if (p.unlocked.length) cards.push({ kind: 'unlock' });
    for (let k = 0; k < cards.length; k++) {
      this.stack = ['ending'];
      this.buildEnding(p, cards[k], pages, k, cards.length);
      this.endingStep = `${cards[k].kind}${cards[k].page !== undefined ? cards[k].page : ''}`;
      await this.anyKeyScreen('ending', 0);
    }
    this.endingStep = '';
  }

  showNameEntry(p: { score: number; fighter: string }): Promise<string> {
    this.stack = ['nameentry'];
    this.buildNameEntry(p);
    return new Promise((resolve) => { this.resolveName = resolve; this.render('nameentry'); });
  }

  /** the fighter / scheme the pause card's MOVE LIST shows (game.ts sets it when a bout starts) */
  setMoveList(fighterId: string, scheme: Scheme = 0): void { this.mlFighter = fighterId; this.mlScheme = scheme; }

  private mlDefault(): string {
    return this.mlFighter || this.flow.picks?.p1.fighter || Object.keys(this.data.fighters)[0] || 'johnny';
  }

  /** online lobby status line (the net layer calls it) */
  setOnlineStatus(st0: OnlineStatus): void {
    if (!('st' in st0)) {
      const s = st0 as NetOnlineStatus;
      // NET's status / error payload: a NET_STRINGS code key + its vars (CONTRACT 19.4); the room code rides as `room`
      const vars: Record<string, string | number> = {};
      for (const k of Object.keys(s)) { const v = (s as Record<string, unknown>)[k]; if (typeof v === 'string' || typeof v === 'number') vars[k] = v; }
      if (typeof s.rttMs === 'number') vars.rtt = Math.round(s.rttMs);
      if (typeof s.room === 'string') vars.code = s.room;
      setText(this.onlineStatus, tOr(s.code, s.code, vars));
      const failed = /error|mismatch|busy|full|no_|cheat|left|nocontest/.test(s.code);
      this.onlineStatus.dataset.st = failed ? 'failed' : s.code === 'net.direct' || s.code === 'net.select' || s.code === 'net.loading' ? 'connected' : 'searching';
      // CHANGED(UI) P2: remember the session facts the payload carries (connection quality, phase, room)
      if (typeof s.phase === 'string') this.net.phase = s.phase;
      if (typeof s.rttMs === 'number' && s.rttMs >= 0) this.net.rttMs = s.rttMs;
      const tr = (s as { transport?: unknown }).transport;
      if (typeof tr === 'string') this.net.transport = tr;
      if (typeof s.room === 'string' && s.room) this.net.room = s.room;
      this.net.code = s.code;
      if (s.code === 'net.rematch_asked') this.net.peerRematch = true;
      if (failed || s.phase === 'ended' || s.phase === 'idle') this.net.peerRematch = null;
      this.renderNet();
      return;
    }
    const s = st0 as UiOnlineStatus;
    const txt = s.st === 'waiting' ? t('on.st.waiting', { code: s.code }) : s.st === 'connected' ? t('on.st.connected', { name: s.name, ping: s.ping })
      : s.st === 'failed' ? t('on.st.failed', { reason: s.reason }) : t(`on.st.${s.st}`);
    setText(this.onlineStatus, txt);
    this.onlineStatus.dataset.st = s.st;
    if (s.st === 'waiting') { this.net.room = s.code; this.net.phase = 'room'; }
    else if (s.st === 'searching') this.net.phase = 'searching';
    else if (s.st === 'connecting') this.net.phase = 'connecting';
    else if (s.st === 'connected') { this.net.opponent = s.name; this.net.rttMs = s.ping; this.net.phase = 'select'; }
    else if (s.st === 'relay') this.net.transport = 'relay';
    else if (s.st === 'idle') this.resetNet();
    this.renderNet();
  }

  /**
   * CHANGED(UI) P2 (CONTRACT 27.2): the NET 19.4 events besides status / error, forwarded by game.ts:
   * select (opponent name + pick countdown), opponentLocked, rematch (peerWants), matchEnd (rated), end (session over).
   */
  onlineEvent(name: OnlineEventName, payload?: unknown): void {
    const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    switch (name) {
      case 'paired': if (typeof p.room === 'string') this.net.room = p.room; this.net.phase = 'connecting'; break;
      case 'select': {
        this.net.phase = 'select';
        this.net.locked = false;
        this.net.peerRematch = null;
        if (typeof p.opponent === 'string' && p.opponent) this.net.opponent = p.opponent;
        const secs = typeof p.seconds === 'number' && p.seconds > 0 ? Math.round(p.seconds) : 30;
        this.startSelectClock(secs);
        break;
      }
      case 'opponentLocked': this.net.locked = true; this.cs.opponentLocked(); break;
      case 'reveal': window.clearInterval(this.selectTimer); this.net.phase = 'loading'; break;
      case 'rematch': this.net.peerRematch = !!p.peerWants; if (p.peerWants) setText(this.onlineStatus, t('net.rematch_asked')); break;
      case 'matchEnd': this.net.phase = 'result'; this.net.rated = typeof p.rated === 'boolean' ? p.rated : null; break;
      case 'end': this.net.phase = 'ended'; this.net.peerRematch = null; window.clearInterval(this.selectTimer); break;
      default: break;
    }
    this.renderNet();
    this.cs.setOnline({ opponent: this.net.opponent, locked: this.net.locked, secondsLeft: this.net.selectLeft });
    const rb = this.resBox.querySelector<HTMLElement>('.hpm-res-rematch');
    if (rb) { rb.hidden = this.net.peerRematch !== true; }
    else if (this.net.peerRematch === true && this.screen === 'results') {
      const acts = this.resBox.querySelector('.hpm-res-acts');
      if (acts) { const b = el('div', 'hpm-res-rematch', t('net.rematch_asked')); acts.prepend(b); }
    }
  }

  private startSelectClock(secs: number): void {
    window.clearInterval(this.selectTimer);
    this.net.selectLeft = secs;
    this.selectTimer = window.setInterval(() => {
      this.net.selectLeft = Math.max(0, this.net.selectLeft - 1);
      this.cs.setOnline({ opponent: this.net.opponent, locked: this.net.locked, secondsLeft: this.net.selectLeft });
      if (this.net.selectLeft <= 0) {
        window.clearInterval(this.selectTimer);
        // time is up: lock the fighter under the cursor (NET picks a random one 1.5 s later otherwise); the select's own
        // done() path emits the onlinePick intent
        this.cs.forcePick();
      }
    }, 1000);
  }

  private resetNet(): void {
    window.clearInterval(this.selectTimer);
    this.net = { phase: 'idle', code: '', room: '', transport: '', rttMs: -1, opponent: '', locked: false, peerRematch: null, rated: null, selectLeft: 0 };
    this.renderNet();
  }

  /** the lobby panel: step ribbon, room code, opponent, connection */
  private renderNet(): void {
    const n = this.net;
    const order = ['search', 'room', 'connect', 'sync', 'select', 'fight'];
    const at: Record<string, string> = { searching: 'search', room: 'room', connecting: 'connect', syncing: 'sync', select: 'select', loading: 'fight', match: 'fight', result: 'fight' };
    const k = order.indexOf(at[n.phase] ?? '');
    [...this.onSteps.children].forEach((c, i) => { c.classList.toggle('done', k >= 0 && i < k); c.classList.toggle('on', i === k); });
    this.onSteps.hidden = k < 0;
    const showRoom = !!n.room && (n.phase === 'room' || n.code === 'net.waiting_peer') && n.room.length <= 6;
    this.onRoom.hidden = !showRoom;
    if (showRoom) { this.onRoom.replaceChildren(el('span', '', t('on.room')), el('b', '', n.room), el('small', '', t('on.room.share'))); }
    this.onOpp.hidden = !n.opponent;
    if (n.opponent) this.onOpp.replaceChildren(el('span', '', t('on.opponent')), el('b', '', n.opponent));
    this.onQual.hidden = !n.transport || n.transport === 'none';
    if (!this.onQual.hidden) this.onQual.replaceChildren(this.qualityChip());
  }

  /** DIRECT LINE / BACKUP LINE + 4 ping bars + the round trip (status rttMs) */
  private qualityChip(): HTMLElement {
    const n = this.net;
    const relay = n.transport === 'relay';
    const rtt = n.rttMs;
    const bars = rtt < 0 ? 0 : rtt < 60 ? 4 : rtt < 120 ? 3 : rtt < 200 ? 2 : 1;
    const c = el('span', `hpm-qual${relay ? ' relay' : ''} b${bars}`);
    const bx = el('span', 'bars');
    for (let i = 0; i < 4; i++) bx.append(el('i', i < bars ? 'on' : ''));
    c.append(bx, el('b', '', relay ? t('on.q.relay') : t('on.q.direct')));
    if (rtt >= 0) c.append(el('span', 'ms', t('on.q.ms', { n: Math.round(rtt) })));
    return c;
  }

  /** online blind select: the opponent's locked pick (reveals the P2 card) */
  revealOpponent(p: CsPick): void { this.cs.reveal(p); }

  /** portraits (fighter id -> image URL); VIEW / the integrator hands them in */
  setPortraits(map: Readonly<Record<string, string>>): void { setPortraits(map); }

  /** the Showcase region in CSS px while the character select shows it, else null */
  showcaseRect(): Rect | null { return this.screen === 'charselect' && !this.root.hidden ? this.cs.showcaseRect() : null; }

  confirm(title: string, body: string, yes: string, no: string): Promise<boolean> {
    this.confirmTitle.textContent = title;
    this.confirmBody.textContent = body;
    this.confirmYes.textContent = yes;
    this.confirmNo.textContent = no;
    this.confirmReturn = document.activeElement as HTMLElement | null;
    this.confirmBox.hidden = false;
    this.focus(this.confirmNo, false);
    return new Promise((resolve) => { this.confirmResolve = resolve; });
  }

  setTouchMode(on: boolean): void {
    this.touch = on;
    this.root.classList.toggle('touch', on);
    this.renderHints();
    this.renderLegend();
  }

  get visible(): boolean { return !this.root.hidden && this.screen !== null; }

  /** per frame (optional; the menus run their own loop while visible): pads + the Showcase */
  update(dt: number): void {
    const now = performance.now();
    if (now - this.lastPoll < 8) return;
    this.lastPoll = now;
    this.pollPads(dt);
    this.driveShowcaseFrame(dt);
  }

  readback(): Record<string, unknown> {
    const a = document.activeElement as HTMLElement | null;
    return {
      visible: this.visible, screen: this.screen, stack: [...this.stack],
      focus: a && this.root.contains(a) ? (a.id || a.textContent?.trim().slice(0, 40) || a.tagName) : null,
      confirm: !this.confirmBox.hidden, capture: this.capture ? `${this.capture.p}:${this.capture.action}:${this.capture.slot}` : null,
      conflict: this.conflict ? { ...this.conflict, other: { ...this.conflict.other } } : null, note: this.bindNote.textContent ?? '',
      flow: { ...this.flow, picks: this.flow.picks ? { ...this.flow.picks } : null }, cs: this.cs.readback(), training: this.training.get(),
      touch: this.touch, hints: !this.hints.hidden, gamepad: this.padSeen, showcase: this.showcaseRect(), fullscreen: FS(),
      ending: this.endingStep, net: { ...this.net },
      result: this.lastResult ? { mode: this.lastResult.cfg.mode, winner: this.lastResult.winner, rounds: this.resBox.querySelectorAll('.hpm-res-rounds .rr:not(.head)').length,
        continue: !!this.resBox.querySelector('.hpm-res-cont'), countdown: this.resBox.querySelector('.hpm-res-cont .n')?.textContent ?? null } : null,
    };
  }

  dispose(): void {
    this.endCapture();
    this.stopLoop();
    for (const f of this.offs) f();
    this.offs = [];
    this.root.remove();
  }

  // ─────────────────────────── flows ───────────────────────────
  private emit(i: MenuIntent): void { for (const f of [...this.intents]) { try { f(i); } catch (e) { console.error('[hit-parade ui] intent handler', e); } } }

  private startTrainingFlow(): void {
    this.flow.kind = 'training';
    this.openSelect('training', 'dummy');
  }

  private openSelect(kind: Flow['kind'], opponent: 'human' | 'cpu' | 'dummy' | 'none'): void {
    this.flow.picks = null;
    const pads = this.connectedPads();
    this.cs.open(kind, opponent, this.deps.save.get(), { pads });
    this.push('charselect');
    this.music('charselect');
  }

  private onPicked(r: CsResult): void {
    this.flow.picks = r;
    this.mlFighter = r.p1.fighter;
    this.mlScheme = r.p1.scheme;
    const seed = (Math.random() * 0x7fffffff) | 0;
    const P = (pk: CsPick, cpu: number) => ({ fighter: pk.fighter, color: pk.color, scheme: pk.scheme, cpu });
    switch (this.flow.kind) {
      case 'season':
        this.emit({ kind: 'startSeason', fighter: r.p1.fighter, color: r.p1.color, scheme: r.p1.scheme, length: this.flow.length, difficulty: this.flow.difficulty });
        break;
      case 'online':
        this.emit({ kind: 'onlinePick', fighter: r.p1.fighter, color: r.p1.color, scheme: r.p1.scheme });
        break;
      case 'training': {
        const d = r.p2 ?? r.p1;
        const tr = this.training.get();
        const stage = this.defaultStage(r.p1.fighter);
        // CHANGED(UI) P2: P2 is no CPU unless DUMMY: CPU (P1 always sent CPU 0 = the TUTOR band, which walked in and attacked a
        // STAND dummy); the training driver owns the dummy from here (CONTRACT 27.1)
        const cfg: MatchCfg = { mode: 'training', stage, seed, p: [P(r.p1, -1), P(d, tr.dummy === 'cpu' ? tr.cpuLevel : -1)], rounds: 1, timer: 0 };
        this.emit({ kind: 'training', cfg });
        break;
      }
      default:
        this.buildStages();
        this.push('stage');
        break;
    }
  }

  private defaultStage(fid: string): string {
    const list = stageList(this.data);
    const home = fighter(this.data, fid)?.stage;
    return playableStage(this.data, home && list.some((s) => s.id === home) ? home : (list[0]?.id ?? 'rust_theater'));
  }

  private buildStages(): void {
    const box = this.stageBox;
    box.replaceChildren();
    const list = stageList(this.data);
    const built = list.filter((s) => s.built);                 // CHANGED(integrator): todo stages = COMING SOON
    const mk = (id: string, name: string, tag: string, k: number, soon = false): HTMLButtonElement => {
      const b = btn(soon ? 'hpm-stagecard soon' : 'hpm-stagecard', '');
      b.id = `hpm-stage-${id}`;
      b.dataset.stage = id;
      if (k === 0) b.dataset.default = '';
      const art = div(`art s-${id}`, b);
      if (id === 'random') art.append(svg(ICON.dice, 'dice'));
      art.append(el('span', 'no', id === 'random' ? '?' : String(k).padStart(2, '0')));
      b.append(el('b', 'nm', name), el('span', 'tg', tag));
      if (soon) b.append(el('span', 'soon', t('cs.soon')));     // outside .art: the art is greyed, the label is not
      b.addEventListener('click', () => {
        if (soon) { this.sound('error'); return; }
        this.sound('select');
        const pool = built.length ? built : list;
        const real = id === 'random' ? pool[Math.floor(Math.random() * pool.length)].id : id;
        this.flow.stage = real;
        void this.startVersus(real);
      });
      box.append(b);
      return b;
    };
    list.forEach((s, k) => mk(s.id, s.name, s.tag, k + 1, !s.built));
    mk('random', t('stage.random'), t('stage.random.tag'), 0);
    // RANDOM last in the row, but focused first
    const first = box.querySelector<HTMLElement>(`#hpm-stage-${list[0]?.id}`);
    if (first) { box.querySelector('[data-default]')?.removeAttribute('data-default'); first.dataset.default = ''; }
  }

  private async startVersus(stage: string): Promise<void> {
    const r = this.flow.picks;
    if (!r || !r.p2) return;
    const seed = (Math.random() * 0x7fffffff) | 0;
    const cpu = this.flow.opponent === 'cpu' ? this.flow.cpuLevel : -1;
    const cfg: MatchCfg = {
      mode: 'versus', stage, seed,
      p: [{ fighter: r.p1.fighter, color: r.p1.color, scheme: r.p1.scheme, cpu: -1 }, { fighter: r.p2.fighter, color: r.p2.color, scheme: r.p2.scheme, cpu }],
      rounds: this.flow.rounds, timer: this.flow.timer,
    };
    await this.showVs({ p: [{ fighter: r.p1.fighter, color: r.p1.color }, { fighter: r.p2.fighter, color: r.p2.color, label: cpu >= 0 ? t('hud.cpu', { n: cpu }) : undefined }], stage, mode: 'versus' });
    this.emit({ kind: 'startMatch', cfg });
  }

  // ─────────────────────────── modal screen builders ───────────────────────────
  private buildVs(v: VsView): void {
    const box = this.vsBox;
    box.replaceChildren();
    const kicker = v.mode === 'online' ? t('vs.online') : v.mode === 'training' ? t('vs.training')
      : v.kind === 'rival' ? t('vs.rival') : v.kind === 'miniboss' ? t('vs.miniboss') : v.kind === 'boss' ? t('vs.boss')
        : v.episode ? t('vs.episode', { n: v.episode }) : t('vs.versus');
    const top = div('hpm-vs-top', box);
    top.append(buildBug(kicker));
    for (let i = 0; i < 2; i++) {
      const s = v.p[i];
      const side = div(`hpm-vs-side p${i + 1}`, box);
      const pic = div('hp-portrait hpm-vs-pic', side);
      const col = colorsOf(fighter(this.data, s.fighter))[s.color];
      fillPortrait(pic, this.data, s.fighter, col?.tint ?? null);
      const plate = div('hpm-vs-plate', side);
      plate.append(el('b', '', fighterName(this.data, s.fighter)), el('span', '', s.label ?? fighter(this.data, s.fighter)?.persona ?? ''));
      // CHANGED(UI) P2: the fighter's CONTRACT 26.3 introLine as a speech line on the VS card
      const line = introLine(this.data, s.fighter);
      if (line) plate.append(el('q', 'intro', line));
    }
    div('hpm-vs-vs', box, t('vs.vs'));
    const bot = div('hpm-vs-bot', box);
    bot.append(el('span', '', t('vs.onset', { stage: tOr(`stage.${v.stage}.name`, v.stage.toUpperCase()) })));
    if (v.mode === 'online') {
      bot.append(el('span', 'rated', v.rated ? t('vs.rated') : t('vs.unrated')));
      if (this.net.transport) bot.append(this.qualityChip());
    }
  }

  private buildLadder(v: LadderView): void {
    const box = this.ladderBox;
    box.replaceChildren();
    const me = div('hpm-card hpm-lad-me', box);
    const pic = div('hp-portrait hpm-lad-pic', me);
    const col = colorsOf(fighter(this.data, v.fighter))[v.color];
    fillPortrait(pic, this.data, v.fighter, col?.tint ?? null);
    me.append(el('span', 'hpm-cap', t('ladder.contestant')), el('b', 'nm', fighterName(this.data, v.fighter)),
      el('span', 'len', v.length === 'pilot' ? t('ladder.pilot') : t('ladder.full')));
    const sc = div('kv', me);
    sc.append(el('span', '', t('ladder.score')), el('b', '', Math.floor(v.score).toLocaleString('en-US')));
    if (typeof v.ratings === 'number') { const rt = div('kv', me); rt.append(el('span', '', t('ladder.ratings')), el('b', '', `${Math.round(v.ratings)}`)); }
    if (typeof v.continues === 'number' && v.continues > 0) { const ct = div('kv', me); ct.append(el('span', '', t('ladder.continues')), el('b', '', String(v.continues))); }

    // CHANGED(UI) P2: real progress - EPISODE n OF N, a track of every slot (cleared / next / ahead), the NEXT UP preview
    const main = div('hpm-lad-main', box);
    const episodes = v.bouts.filter((b) => b.kind !== 'brawl' && b.kind !== 'heckler').length;
    const cur = v.bouts[v.current];
    const epNow = v.bouts.slice(0, v.current + 1).filter((b) => b.kind !== 'brawl' && b.kind !== 'heckler').length;
    const prog = div('hpm-lad-prog', main);
    const bonusNow = cur && (cur.kind === 'brawl' || cur.kind === 'heckler');
    prog.append(el('b', 'ep', bonusNow ? t(`ladder.${cur.kind}`) : t('ladder.progress', { n: Math.max(1, epNow), of: episodes })));
    const track = div('hpm-lad-track', prog);
    v.bouts.forEach((b, k) => {
      const cell = el('i', `k-${b.kind}${k < v.current ? ' done' : k === v.current ? ' cur' : ''}${b.result === 'lost' ? ' lost' : ''}`);
      cell.title = b.kind;
      track.append(cell);
    });
    const done = v.bouts.slice(0, v.current).filter((b) => b.result === 'won' || b.result === undefined || b.result === null).length;
    prog.append(el('span', 'pct', t('ladder.cleared', { n: done, of: v.bouts.length })));
    if (cur) {
      const next = div('hpm-card hpm-lad-next', main);
      next.append(el('span', 'hpm-cap', t('ladder.nextUp')));
      const isBout = cur.kind !== 'brawl' && cur.kind !== 'heckler';
      if (isBout && cur.opponent) {
        const np = div('hp-portrait hpm-lad-npic', next);
        fillPortrait(np, this.data, cur.opponent);
        const tx = div('tx', next);
        const f = fighter(this.data, cur.opponent);
        tx.append(el('b', 'nm', fighterName(this.data, cur.opponent)), el('span', 'pe', f?.persona ?? ''));
        const st = f?.stage;
        if (st) tx.append(el('span', 'st', t('ladder.onStage', { stage: tOr(`stage.${st}.name`, st.toUpperCase()) })));
        const line = introLine(this.data, cur.opponent);
        if (line) tx.append(el('q', 'ln', line));
        if (cur.kind !== 'bout') next.append(el('span', `badge k-${cur.kind}`, t(`ladder.${cur.kind}`)));
      } else {
        const np = div('hp-portrait hpm-lad-npic bonus', next);
        np.append(el('b', 'ini', String(cur.kind === 'heckler' ? 40 : 45)));
        const tx = div('tx', next);
        tx.append(el('b', 'nm', t(`card.${cur.kind}.title`)), el('span', 'pe', t(`card.${cur.kind}.body`)));
      }
    }
    const list = div('hpm-lad-list', main);
    let ep = 0;
    v.bouts.forEach((b, k) => {
      const isBout = b.kind !== 'brawl' && b.kind !== 'heckler';
      if (isBout) ep++;
      const row = div(`hpm-lad-row k-${b.kind}${k === v.current ? ' cur' : ''}${b.result ? ` ${b.result}` : k < v.current ? ' won' : ''}`, list);
      row.append(el('span', 'ep', isBout ? t('ladder.ep', { n: ep }) : ''));
      const p2 = div('hp-portrait mini', row);
      const known = b.opponent && (k <= v.current || b.kind === 'rival' || isBoss(b.opponent));
      if (isBout) fillPortrait(p2, this.data, known ? (b.opponent ?? null) : 'random');
      else p2.classList.add('bonus');
      row.append(el('b', 'nm', isBout ? (known && b.opponent ? fighterName(this.data, b.opponent) : t('ladder.mystery')) : t(`ladder.${b.kind}`)));
      if (b.kind !== 'bout' && isBout) row.append(el('span', 'badge', t(`ladder.${b.kind === 'boss' ? 'boss' : b.kind}`)));
      if (b.result) row.append(el('span', 'res', b.result === 'won' ? t('ladder.won') : t('ladder.lost')));
      else if (k < v.current) row.append(el('span', 'res', t('ladder.won')));
      else if (k === v.current) row.append(el('span', 'res next', t('ladder.next')));
    });
    const acts = div('hpm-lad-acts', box);
    const go = btn('hpm-btn hot', t('ladder.go'));
    go.id = 'hpm-ladder-go';
    go.dataset.default = '';
    go.addEventListener('click', () => { this.sound('start'); this.finishLadder('go'); });
    const quit = btn('hpm-btn', t('ladder.quit'));
    quit.id = 'hpm-ladder-quit';
    quit.addEventListener('click', async () => {
      this.sound('select');
      if (await this.confirm(t('ladder.quit'), t('res.continueNote'), t('confirm.yes'), t('confirm.no'))) this.finishLadder('quit');
    });
    acts.append(go, quit);
  }

  private buildCard(c: CardView): void {
    const box = this.cardBox;
    box.replaceChildren();
    box.dataset.kind = c.kind;
    div('hpm-sc-tint', box);
    const bug = buildBug(t(`card.${c.kind}.kicker`));
    bug.classList.add('hpm-sc-bug');
    box.append(bug);
    const art = div('hpm-sc-art', box);
    // CHANGED(UI) P2: game.ts passes { a: the player, b: the opponent } for EVERY card (the P1 card drew the PLAYER as
    // the boss); a boss card without `b` (the lab / older callers) treats `a` as the boss
    const boss = c.kind === 'miniboss' || c.kind === 'boss';
    const player = boss ? (c.b ? c.a : undefined) : c.a;
    const opp = boss ? (c.b ?? c.a) : c.b;
    const pics = c.kind === 'rival' ? [player, opp] : boss ? [opp] : [];
    for (const id of pics) { const p = div('hp-portrait hpm-sc-pic', art); fillPortrait(p, this.data, id ?? null); }
    if (!pics.length) {
      // BRAWL BREAK 45 s / HECKLER TOSS 40 s (CONTRACT 4.3 item 14): a big seconds badge on the hazard stripes
      art.classList.add('bonus');
      const secs = div('hpm-sc-secs', art);
      secs.append(el('b', '', String(c.seconds ?? (c.kind === 'heckler' ? 40 : 45))), el('span', '', t('card.seconds')));
    }
    const lt = div('hpm-sc-lt', box);
    lt.append(el('span', 'kick', t(`card.${c.kind}.kicker`)));
    const name = (id?: string): string => (id ? fighterName(this.data, id) : '');
    const head = c.kind === 'rival' ? t('card.rival.title', { a: name(player), b: name(opp) })
      : c.kind === 'miniboss' ? t('card.miniboss.title', { name: name(opp) }) : c.kind === 'boss' ? t('card.boss.title', { name: name(opp) })
        : t(`card.${c.kind}.title`);
    lt.append(el('div', 'head', head));
    // banter: the caller's two lines, else both sides' CONTRACT 26.3 lines from the fighter files (P1 1, P2 1, P1 2, P2 2)
    const lines: Array<{ who: 0 | 1; text: string; direction: boolean }> = c.banter
      ? c.banter.map((text, i) => ({ who: (i % 2) as 0 | 1, text, direction: /^\(.*\)$/.test(text.trim()) }))
      : c.kind === 'rival' || boss ? (player && opp ? banterLines(this.data, player, opp) : []) : [];
    if (c.kind !== 'rival') {
      const body = t(`card.${c.kind}.body`);
      if (body) lt.append(el('div', 'sub', body));
    }
    if (c.kind === 'brawl' || c.kind === 'heckler') {
      const rules = bonusRules(c.kind);
      if (rules.length) {
        const ul = el('ul', 'hpm-sc-rules');
        rules.forEach((r0, i) => { const li = el('li', ''); li.append(el('b', '', String(i + 1)), el('span', '', r0)); ul.append(li); });
        lt.append(ul);
      }
    }
    box.classList.toggle('talk', lines.length > 0);
    if (lines.length) {
      const bb = div('hpm-banter', lt);
      for (const ln of lines.slice(0, 4)) {
        const q = div(`q p${ln.who + 1}${ln.direction ? ' dir' : ''}`, bb);
        q.append(el('b', '', name(ln.who === 0 ? player : opp)), el('p', '', ln.text));
      }
    }
    if (c.kind === 'boss') lt.append(el('div', 'warn', t('card.boss.warn')));
    if (c.kind === 'boss' && opp && fighter(this.data, opp)?.unique?.kind === 'phases') lt.append(el('div', 'warn two', t('card.boss.phase2')));
    div('hpm-sc-any', box, this.touch ? t('misc.tapAny') : t('card.continue'));
  }

  private buildEnding(p: { fighter: string; score: number; unlocked: string[]; continues?: number }, card: { kind: string; page?: number },
    pages: string[], k: number, n: number): void {
    const box = this.endBox;
    box.replaceChildren();
    box.dataset.kind = card.kind;
    div('hpm-sc-tint', box);
    const bug = buildBug(t('ending.kicker'));
    bug.classList.add('hpm-sc-bug');
    box.append(bug);
    const name = fighterName(this.data, p.fighter);
    const art = div('hpm-sc-art', box);
    const lt = div('hpm-sc-lt', box);
    switch (card.kind) {
      case 'finale': {
        const pic = div('hp-portrait hpm-sc-pic', art);
        fillPortrait(pic, this.data, p.fighter);
        lt.append(el('span', 'kick', t('ending.finale')), el('div', 'head', t('ending.title', { name })));
        const line = introLine(this.data, p.fighter);
        lt.append(el('div', 'sub', line || (fighter(this.data, p.fighter)?.persona ?? '')));
        break;
      }
      case 'text': {
        const pic = div('hp-portrait hpm-sc-pic', art);
        fillPortrait(pic, this.data, p.fighter);
        lt.append(el('span', 'kick', t('ending.epilogue', { n: (card.page ?? 0) + 1, of: pages.length })));
        lt.append(el('div', 'sub story', pages[card.page ?? 0] ?? ''));
        break;
      }
      case 'ratings': {
        art.classList.add('bonus');
        const secs = div('hpm-sc-secs total', art);
        const v = el('b', '', '0');
        secs.append(v, el('span', '', t('ending.ratings')));
        this.countUp(v, Math.max(0, Math.floor(p.score)));
        lt.append(el('span', 'kick', t('ending.ratingsKick')), el('div', 'head', t('ending.ratingsHead', { name })));
        // the continues line only when the caller says how many were used (game.ts may not pass it yet)
        const c = p.continues;
        lt.append(el('div', 'sub', typeof c !== 'number' ? t('ending.renewed') : c > 0 ? t('ending.continues', { n: c }) : t('ending.noContinues')));
        break;
      }
      case 'board': {
        art.classList.add('board');
        const brd = div('hpm-card hpm-board big', art);
        brd.append(el('h3', 'hpm-cap', t('name.board')));
        const rows = [...(this.deps.save.get().board ?? [])].sort((a, b) => b.score - a.score).slice(0, 5);
        let mine = false;
        rows.forEach((r, i) => {
          const me = !mine && r.fighter === p.fighter && r.score === Math.floor(p.score);
          if (me) mine = true;
          const row = div(`row${me ? ' me' : ''}`, brd);
          row.append(el('span', 'k', String(i + 1)), el('b', '', r.name), el('span', 'f', fighterName(this.data, r.fighter)), el('span', 'v', r.score.toLocaleString('en-US')));
        });
        lt.append(el('span', 'kick', t('ending.boardKick')), el('div', 'head', mine ? t('ending.onBoard') : t('ending.offBoard')));
        break;
      }
      default: {
        for (const id of p.unlocked.slice(0, 2)) { const pic = div('hp-portrait hpm-sc-pic', art); fillPortrait(pic, this.data, id); }
        lt.append(el('span', 'kick', t('ending.unlockKick')), el('div', 'head', t('ending.unlock', { names: p.unlocked.map((id) => fighterName(this.data, id)).join(', ') })));
        lt.append(el('div', 'warn ok', t('ending.unlockSub')));
      }
    }
    div('hpm-sc-page', box, t('ending.page', { n: k + 1, of: n }));
    div('hpm-sc-any', box, k === n - 1 ? t('ending.wrap') : this.touch ? t('misc.tapAny') : t('card.continue'));
  }

  /** a number that counts up to `to` over ~1.2 s (the RATINGS TOTAL card) */
  private countUp(e: HTMLElement, to: number): void {
    const t0 = performance.now();
    const dur = flashesReduced() ? 0 : 1200;
    const step = (now: number): void => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      e.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString('en-US');
      if (k < 1 && e.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private buildNameEntry(p: { score: number; fighter: string }): void {
    const box = this.nameBox;
    box.replaceChildren();
    this.nameLetters = [0, 0, 0];
    this.nameSlot = 0;
    const card = div('hpm-card hpm-name-card', box);
    const pic = div('hp-portrait hpm-name-pic', card);
    fillPortrait(pic, this.data, p.fighter);
    const sc = div('hpm-name-score', card);
    sc.append(el('span', '', t('ending.ratings')), el('b', '', Math.floor(p.score).toLocaleString('en-US')));
    const slots = div('hpm-name-slots', card);
    this.nameSlots = [];
    for (let i = 0; i < 3; i++) {
      const s = btn('hpm-name-slot', 'A');
      s.id = `hpm-name-${i}`;
      s.dataset.i = String(i);
      s.addEventListener('click', () => { this.nameSlot = i; this.nameLetters[i] = (this.nameLetters[i] + 1) % 26; this.sound('move'); this.renderName(); });
      slots.append(s);
      this.nameSlots.push(s);
    }
    const done = btn('hpm-btn hot', t('name.done'));
    done.id = 'hpm-name-done';
    done.addEventListener('click', () => this.finishName());
    card.append(done);
    // CHANGED(UI) P2: the local board with THIS run slotted in where its score ranks (the name fills in as it is typed)
    const board = div('hpm-card hpm-board', box);
    board.append(el('h3', 'hpm-cap', t('name.board')));
    const all = [...(this.deps.save.get().board ?? [])].map((r) => ({ ...r, me: false }));
    const mine = { name: '', score: Math.floor(p.score), fighter: p.fighter, me: true };
    all.push(mine);
    all.sort((a, b) => b.score - a.score || (a.me ? 1 : 0) - (b.me ? 1 : 0));
    const rank = all.indexOf(mine);
    const top = all.slice(0, 5);
    if (rank >= 5) top.push(mine);
    this.nameMine = null;
    top.forEach((r) => {
      const row = div(`row${r.me ? ' me' : ''}`, board);
      const nm = el('b', '', r.me ? '' : r.name);
      row.append(el('span', 'k', String(all.indexOf(r) + 1)), nm, el('span', 'f', fighterName(this.data, r.fighter)), el('span', 'v', r.score.toLocaleString('en-US')));
      if (r.me) this.nameMine = nm;
    });
    board.append(el('p', 'hpm-note rank', rank < 10 ? t('name.rank', { n: rank + 1 }) : t('name.noRank')));
    this.renderName();
  }

  private renderName(): void {
    this.nameSlots.forEach((s, i) => { s.textContent = String.fromCharCode(65 + this.nameLetters[i]); s.classList.toggle('on', i === this.nameSlot); });
    if (this.nameMine) this.nameMine.textContent = this.nameLetters.map((n) => String.fromCharCode(65 + n)).join('');
  }

  private finishName(): void {
    const r = this.resolveName;
    this.resolveName = null;
    this.sound('start');
    if (r) r(this.nameLetters.map((n) => String.fromCharCode(65 + n)).join(''));
  }

  private anyKeyScreen(s: ScreenId, autoMs: number): Promise<void> {
    window.clearTimeout(this.vsTimer);
    return new Promise<void>((resolve) => {
      this.resolveAny = resolve;
      this.anyArmedAt = performance.now() + 450;
      this.render(s);
      if (autoMs > 0) this.vsTimer = window.setTimeout(() => this.finishAny(true), autoMs);
      const box = this.screens.get(s);
      if (box && !flashesReduced()) pulse(box.firstElementChild, [{ transform: 'scale(1.06)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], 260);
    });
  }

  private finishAny(force = false): void {
    if (!force && performance.now() < this.anyArmedAt) return;
    window.clearTimeout(this.vsTimer);
    const r = this.resolveAny;
    this.resolveAny = null;
    if (r) { this.sound('select'); r(); }
  }

  private finishResults(c: ResultChoice): void {
    this.resDispose();
    const r = this.resolveResults;
    this.resolveResults = null;
    this.sound('select');
    if (r && c === 'rematch' && this.lastResult?.cfg.mode === 'online') this.rematchWaiting();
    if (r) r(c);
  }

  /**
   * CHANGED(UI) P2 (CONTRACT 27.2 / 29.6): online REMATCH keeps the results card up while game.ts asks the peer - the
   * choices become a waiting panel (OPPONENT WANTS A REMATCH lights up on the peer's yes; 'select' opens the blind pick,
   * 'end' sends game.ts to the lobby); LEAVE = {kind: 'online', action: 'cancel'} (game.ts leaves the session).
   */
  private rematchWaiting(): void {
    const acts = this.resBox.querySelector<HTMLElement>('.hpm-res-acts');
    if (!acts) return;
    acts.replaceChildren();
    acts.classList.add('waiting');
    const w = div('hpm-res-wait', acts);
    w.append(el('b', '', t('res.rematchWait')), el('span', 'dots', '...'));
    const peer = el('div', 'hpm-res-rematch', t('net.rematch_asked'));
    peer.hidden = this.net.peerRematch !== true;
    acts.append(peer);
    const leave = btn('hpm-btn', t('on.cancel'));
    leave.id = 'hpm-res-leave';
    leave.addEventListener('click', () => { this.sound('back'); this.emit({ kind: 'online', action: 'cancel' }); });
    acts.append(leave);
    this.focus(leave, false);
  }
  private finishLadder(c: 'go' | 'quit'): void { const r = this.resolveLadder; this.resolveLadder = null; if (r) r(c); }
  private finishPause(c: PauseChoice): void { const r = this.resolvePause; this.resolvePause = null; if (r) r(c); }

  private async askForfeit(): Promise<void> {
    const training = !this.pauseTrainingBtn.hidden;
    if (training) { this.finishPause('forfeit'); return; }
    if (await this.confirm(t('pause.forfeitQ'), t('pause.forfeitBody'), t('pause.forfeitYes'), t('pause.stay'))) this.finishPause('forfeit');
  }

  private closeConfirm(ok: boolean): void {
    this.confirmBox.hidden = true;
    this.sound(ok ? 'select' : 'back');
    const r = this.confirmResolve;
    this.confirmResolve = null;
    const back = this.confirmReturn;
    this.confirmReturn = null;
    if (back && this.inScope(back)) this.focus(back, false);
    if (r) r(ok);
  }

  // ─────────────────────────── screens / stack ───────────────────────────
  private mkScreen(s: ScreenId): HTMLElement {
    const e = el('section', `hpm-screen hpm-s-${s}`);
    e.dataset.screen = s;
    e.hidden = true;
    this.screens.set(s, e);
    return e;
  }

  private header(title: string, hint: string, back = true): HTMLElement {
    const h = el('header', 'hpm-head');
    if (back) {
      const b = btn('hpm-back', '');
      b.append(svg(ICON.back), el('span', '', t('misc.back')));
      b.addEventListener('click', () => this.back());
      h.append(b);
    }
    const tt = div('hpm-head-t', h);
    tt.append(el('h2', '', title));
    if (hint) tt.append(el('p', 'hpm-hint', hint));
    return h;
  }

  private push(s: ScreenId): void {
    if (this.stack[this.stack.length - 1] !== s) this.stack.push(s);
    this.render(s);
  }

  /** Esc / pad B / BACK: pop a screen; on the pause root = RESUME. True when handled. */
  back(): boolean {
    if (this.capture) { this.endCapture(); this.note(''); return true; }
    if (this.conflict) { this.conflict = null; this.note(''); this.renderKeys(); return true; }
    if (!this.confirmBox.hidden) { this.closeConfirm(false); return true; }
    if (!this.visible) return false;
    const cur = this.screen;
    if (cur === 'charselect') { /* CharSelect steps back itself and calls hooks.back() on its first step */ }
    if (cur === 'pause' && this.stack.length === 1) { this.sound('back'); this.finishPause('resume'); return true; }
    if (cur === 'vs' || cur === 'card' || cur === 'ending') { this.finishAny(); return true; }
    if (cur === 'results' || cur === 'ladder' || cur === 'nameentry') return false;
    if (this.stack.length === 1 && this.subClose) {
      const f = this.subClose;
      this.subClose = null;
      this.sound('back');
      f();
      return true;
    }
    if (this.stack.length > 1) {
      this.stack.pop();
      this.sound('back');
      this.render(this.stack[this.stack.length - 1], cur);
      return true;
    }
    return false;
  }

  private render(s: ScreenId, from: ScreenId | null = null): void {
    this.endCapture();
    if (s !== 'results') this.resDispose();
    this.conflict = null;
    this.screen = s;
    for (const [k, e] of this.screens) e.hidden = k !== s;
    this.root.hidden = false;
    this.root.dataset.screen = s;
    this.refresh();
    this.renderHints();
    this.showcaseRegion(s === 'charselect');
    if (s === 'title' || s === 'main') this.music('menu');
    const scr = this.screens.get(s) as HTMLElement;
    let target: HTMLElement | null = null;
    if (from) {
      const map: Partial<Record<ScreenId, string>> = s === 'pause'
        ? { settings: 'hpm-p-settings', movelist: 'hpm-p-movelist', training: 'hpm-p-training' }
        : { season: 'hpm-main-season', versus: 'hpm-main-versus', online: 'hpm-main-online', settings: 'hpm-main-settings', credits: 'hpm-main-credits', charselect: s === 'main' ? 'hpm-main-training' : '' };
      const id = map[from];
      if (id) target = scr.querySelector<HTMLElement>(`#${id}`);
    }
    // a screen's [data-default], else its first control that is not the header BACK button
    target = target ?? scr.querySelector<HTMLElement>('[data-default]') ?? this.navItems().find((e) => !e.classList.contains('hpm-back')) ?? this.navItems()[0] ?? null;
    if (target && s !== 'charselect') this.focus(target, false);
    else if (s === 'charselect' && document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    const scroller = scr.querySelector<HTMLElement>('.hpm-scroll');
    if (scroller && !from) scroller.scrollTop = 0;
    this.startLoop();
  }

  // ─────────────────────────── building blocks ───────────────────────────
  private segMap(key: string): Map<string, HTMLButtonElement> {
    let m = this.segs.get(key);
    if (!m) { m = new Map(); this.segs.set(key, m); }
    return m;
  }

  /** a big labelled segmented pick (setup screens): [value, label, sub] */
  private segCard(key: string, label: string, opts: ReadonlyArray<readonly [string, string, string]>, get: () => string, put: (v: string) => void, size = ''): HTMLElement {
    const card = el('div', `hpm-card hpm-segcard ${size}`.trim());
    // CHANGED(UI) P2 (verifier D14): setup cards are ROWS - up / down steps row to row (onto the row's picked value), left /
    // right changes the value (menus.move); P1 laid them out two per line, so DOWN from OPPONENT skipped CPU LEVEL
    card.dataset.row = key;
    card.append(el('h3', 'hpm-cap', label));
    const row = div(`hpm-seg ${size}`.trim(), card);
    row.setAttribute('role', 'radiogroup');
    const note = el('p', 'hpm-note', '');
    for (const [v, l, sub] of opts) {
      const b = btn('hpm-segbtn', l);
      b.id = `hpm-${key.replace(/\./g, '-')}-${v}`;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { this.sound('move'); put(v); this.refresh(); });
      b.addEventListener('focus', () => { if (sub) setText(note, sub); });
      row.append(b);
      this.segMap(key).set(v, b);
    }
    if (opts.some((o) => o[2])) card.append(note);
    this.updaters.push(() => {
      const cur = get();
      for (const [v, b] of this.segMap(key)) { const on = v === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
      const o = opts.find((x) => x[0] === cur);
      if (o && o[2] && !card.contains(document.activeElement)) setText(note, o[2]);
    });
    return card;
  }

  /** a settings row: label + segmented buttons */
  private segRow(key: string, label: string, opts: ReadonlyArray<readonly [string, string]>, get: () => string, put: (v: string) => void, size = ''): HTMLElement {
    const row = el('div', 'hpm-row wrap');
    row.append(el('span', 'lbl', label));
    const seg = div(`hpm-seg small ${size}`.trim(), row);
    for (const [v, l] of opts) {
      const b = btn('hpm-segbtn', l);
      b.id = `hpm-${key.replace(/\./g, '-')}-${v}`;
      b.addEventListener('click', () => { this.sound('move'); put(v); this.refresh(); });
      seg.append(b);
      this.segMap(key).set(v, b);
    }
    this.updaters.push(() => {
      const cur = get();
      for (const [v, b] of this.segMap(key)) { const on = v === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    });
    return row;
  }

  private slider(id: string, label: string, min: number, max: number, step: number, get: () => number, put: (v: number) => void, fmt: (v: number) => string): HTMLElement {
    const row = el('label', 'hpm-row hpm-slider');
    const r = el('input');
    r.type = 'range';
    r.min = String(min); r.max = String(max); r.step = String(step);
    r.id = `hpm-${id}`;
    r.dataset.nav = '';
    const val = el('output', 'val', '');
    r.addEventListener('input', () => put(Number(r.value)));
    r.addEventListener('change', () => this.sound('move'));
    row.append(el('span', 'lbl', label), r, val);
    this.updaters.push(() => {
      const v = clamp(get(), min, max);
      if (document.activeElement !== r || Number(r.value) !== v) r.value = String(v);
      val.textContent = fmt(v);
      r.style.setProperty('--fill', `${(((v - min) / (max - min)) * 100).toFixed(1)}%`);
    });
    return row;
  }

  private toggle(id: string, label: string, get: () => boolean, put: (v: boolean) => void): HTMLElement {
    const row = el('div', 'hpm-row hpm-toggle');
    const b = btn('hpm-switch', '');
    b.id = `hpm-${id}`;
    b.setAttribute('role', 'switch');
    b.append(el('i'), el('span', 'st', ''));
    b.addEventListener('click', () => { this.sound('move'); put(!get()); this.refresh(); });
    row.append(el('span', 'lbl', label), b);
    this.updaters.push(() => {
      const on = get();
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
      setText(b.querySelector('.st') as HTMLElement, on ? t('misc.on') : t('misc.off'));
    });
    return row;
  }

  private fsButton(id: string, item = false): HTMLButtonElement {
    const b = btn(item ? 'hpm-item small hpm-fs-item' : 'hpm-fs', '');
    b.id = id;
    if (item) b.append(el('span', 'lbl', t('misc.fullscreen')));
    else { b.append(svg(ICON.fs)); b.setAttribute('aria-label', t('misc.fullscreen')); }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sound('select');
      try {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      } catch { /* unsupported */ }
    });
    this.fsBtns.push(b);
    return b;
  }

  private syncFullscreen(): void {
    const f = FS();
    for (const b of this.fsBtns) {
      b.hidden = !f.enabled;
      b.setAttribute('aria-pressed', String(f.active));
      const l = b.querySelector('.lbl');
      if (l) l.textContent = f.active ? t('misc.exitFullscreen') : t('misc.fullscreen');
    }
  }

  // ─────────────────────────── settings access ───────────────────────────
  private s(): UiSettings { try { return this.deps.settings.get() ?? {}; } catch { return {}; } }
  private put(p: Partial<UiSettings>): void { try { this.deps.settings.set(p); } catch (e) { console.error('[hit-parade ui] settings.set', e); } this.refresh(); }

  controls(p: 0 | 1): PlayerControls {
    const c = this.s().controls?.[p];
    const d = defaultControls(p);
    if (!c) return d;
    return { scheme: c.scheme === 1 ? 1 : 0, keys: { ...d.keys, ...c.keys }, pad: { ...d.pad, ...c.pad } };
  }

  private putControls(p: 0 | 1, patch: Partial<PlayerControls>): void {
    const both: [PlayerControls, PlayerControls] = [this.controls(0), this.controls(1)];
    both[p] = { ...both[p], ...patch };
    this.put({ controls: both });
  }

  private resetControls(p: 0 | 1): void {
    if (this.deps.settings.resetControls) { this.deps.settings.resetControls(p); this.refresh(); return; }
    this.putControls(p, defaultControls(p));
  }

  refresh(): void {
    for (const u of this.updaters) u();
    const sp = this.segMap('set.player');
    for (const [v, b] of sp) { const on = Number(v) === this.setPlayer; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    this.renderKeys();
    this.renderLegend();
    this.touchCard.hidden = !this.touch && !TOUCH_PARAM;
  }

  // ─────────────────────────── key remap ───────────────────────────
  private renderKeys(): void {
    const c = this.controls(this.setPlayer);
    for (const a of ACTIONS) {
      for (const slot of [0, 1, 'pad'] as const) {
        const b = this.keyBtns.get(`${a}:${slot}`);
        if (!b) continue;
        if (this.capture && this.capture.action === a && this.capture.slot === slot) continue;
        const v = slot === 'pad' ? padLabel(c.pad[a]?.[0]) : codeLabel(c.keys[a]?.[slot] ?? '');
        setText(b, v);
        b.classList.toggle('empty', v === t('misc.none'));
        b.classList.toggle('conflict', !!this.conflict && this.conflict.other.action === a && this.conflict.other.p === this.setPlayer);
      }
    }
  }

  private note(text: string, kind: '' | 'warn' | 'ok' = ''): void {
    this.bindNote.replaceChildren();
    this.bindNote.className = `hpm-bindnote ${kind}`.trim();
    if (text) this.bindNote.append(el('span', '', text));
  }

  private beginCapture(p: 0 | 1, action: Action, slot: 0 | 1 | 'pad', b: HTMLButtonElement): void {
    this.sound('select');
    this.endCapture();
    this.conflict = null;
    this.renderKeys();
    b.textContent = slot === 'pad' ? t('set.pressPad') : t('set.pressKey');
    b.classList.add('listening');
    this.note(t('set.captureNote'));
    window.dispatchEvent(new CustomEvent('hp:capture', { detail: { on: true } }));
    if (this.deps.input) this.deps.input.suspended = true;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { this.endCapture(); this.note(''); this.sound('back'); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') { this.assign(p, action, slot, null); return; }
      if (slot === 'pad' || !e.code) return;
      this.assign(p, action, slot, e.code);
    };
    window.addEventListener('keydown', onKey, true);
    this.capture = { p, action, slot, btn: b, off: () => window.removeEventListener('keydown', onKey, true) };
  }

  private endCapture(): void {
    const c = this.capture;
    if (!c) return;
    this.capture = null;
    c.off();
    c.btn.classList.remove('listening');
    // swallow the keyup of the captured key before the game's Input sees keys again
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('hp:capture', { detail: { on: false } }));
      if (this.deps.input) { this.deps.input.suspended = false; this.deps.input.releaseAll?.(); }
    }, 0);
    this.renderKeys();
  }

  private actionOf(p: 0 | 1, value: string | number, isPad: boolean): Array<{ p: 0 | 1; action: Action }> {
    const out: Array<{ p: 0 | 1; action: Action }> = [];
    const ps: Array<0 | 1> = isPad ? [p] : [0, 1];                  // keys conflict across players (one keyboard)
    for (const q of ps) {
      const c = this.controls(q);
      for (const a of ACTIONS) {
        const list = isPad ? (c.pad[a] ?? []) : (c.keys[a] ?? []);
        if ((list as Array<string | number>).includes(value)) out.push({ p: q, action: a });
      }
    }
    return out;
  }

  private assign(p: 0 | 1, action: Action, slot: 0 | 1 | 'pad', value: string | number | null, force = false): void {
    const cap = this.capture;
    this.endCapture();
    const isPad = slot === 'pad';
    const both: [PlayerControls, PlayerControls] = [this.controls(0), this.controls(1)];
    const mine = both[p];
    const listOf = (c: PlayerControls, a: Action): Array<string | number> => ((isPad ? c.pad[a] : c.keys[a]) ?? []).slice() as Array<string | number>;
    const setList = (c: PlayerControls, a: Action, l: Array<string | number>): void => {
      if (isPad) c.pad = { ...c.pad, [a]: l as number[] }; else c.keys = { ...c.keys, [a]: l as string[] };
    };
    const idx = isPad ? 0 : (slot as number);
    const label = (v: string | number): string => (isPad ? padLabel(v as number) : codeLabel(v as string));
    if (value === null) {
      const l = listOf(mine, action);
      l.splice(idx, 1);
      setList(mine, action, l);
      this.put({ controls: both });
      this.note(t('set.cleared', { action: t(`act.${action}`) }));
      if (cap) this.focus(cap.btn, false);
      return;
    }
    const others = this.actionOf(p, value, isPad).filter((o) => !(o.p === p && o.action === action));
    if (others.length && !force) {
      const o = others[0];
      this.conflict = { p, action, slot, value, other: o };
      this.renderKeys();
      this.bindNote.replaceChildren();
      this.bindNote.className = 'hpm-bindnote warn';
      const who = o.p !== p ? `${t('set.player', { n: o.p + 1 })} ` : '';
      const swap = btn('hpm-small hot', t('set.swap'));
      swap.id = 'hpm-swap';
      const cancel = btn('hpm-small', t('misc.cancel'));
      cancel.id = 'hpm-swap-cancel';
      swap.addEventListener('click', () => { const k = this.conflict; this.conflict = null; if (k) this.assign(k.p, k.action, k.slot, k.value, true); });
      cancel.addEventListener('click', () => { this.conflict = null; this.note(''); this.renderKeys(); this.sound('back'); if (cap) this.focus(cap.btn, false); });
      this.bindNote.append(el('span', '', t('set.conflict', { key: label(value), action: `${who}${t(`act.${o.action}`)}` })), swap, cancel);
      this.focus(swap, false);
      this.sound('error');
      return;
    }
    const l = listOf(mine, action);
    const old = l[idx];
    for (const o of others) {
      // SWAP: the other action takes this slot's old value (or just loses the value)
      const oc = both[o.p];
      const ol = listOf(oc, o.action);
      const j = ol.indexOf(value);
      if (old !== undefined && !ol.includes(old)) ol[j] = old; else ol.splice(j, 1);
      setList(oc, o.action, ol);
    }
    const dup = l.indexOf(value);
    if (dup >= 0 && dup !== idx) l[dup] = old as string | number;
    if (idx < l.length) l[idx] = value; else l.push(value);
    setList(mine, action, l.filter((x) => x !== undefined && x !== ''));
    this.put({ controls: both });
    this.note(t('set.assigned', { key: label(value), action: t(`act.${action}`) }), 'ok');
    this.sound('select');
    const b = this.keyBtns.get(`${action}:${slot}`) ?? cap?.btn;
    if (b) this.focus(b, false);
  }

  // ─────────────────────────── pause legend + hints ───────────────────────────
  private renderLegend(): void {
    const box = this.pauseLegend;
    box.replaceChildren();
    box.classList.toggle('touch', this.touch);
    if (this.touch) {
      for (const [k, label] of [['touch.l', 'act.l'], ['touch.m', 'act.m'], ['touch.h', 'act.h'], ['touch.s', 'act.s'], ['touch.parry', 'act.parry'], ['touch.impact', 'act.impact'], ['touch.throw', 'act.throw'], ['touch.assist', 'act.assist']] as const) {
        const r = div('hpm-leg', box);
        r.append(el('span', `tbtn t-${k.split('.')[1]}`, t(k)), el('span', 'lbl', t(label)));
      }
      return;
    }
    const c = this.controls(0);
    const k = (a: Action): string => codeLabel(c.keys[a]?.[0] ?? '');
    const rows: Array<[string[], string]> = [
      [[k('up'), k('left'), k('down'), k('right')], t('hint.move')],
      [[k('l')], t('act.l')], [[k('m')], t('act.m')], [[k('h')], t('act.h')], [[k('s')], t('act.s')],
      [[k('assist')], t('act.assist')], [[k('throw')], t('act.throw')], [[k('parry')], t('act.parry')], [[k('impact')], t('act.impact')],
    ];
    for (const [keys, label] of rows) {
      const r = div('hpm-leg', box);
      const ks = el('span', 'keys');
      for (const key of keys) ks.append(el('kbd', 'hpm-kbd', key));
      r.append(ks, el('span', 'lbl', label));
    }
  }

  private renderHints(): void {
    const h = this.hints;
    h.replaceChildren();
    h.hidden = this.touch || this.screen === null || ['title', 'vs', 'card', 'ending'].includes(this.screen);
    if (h.hidden) return;
    const pill = (key: string, label: string): void => {
      const p = el('span', 'hpm-pill');
      p.append(el('kbd', 'hpm-kbd', key), el('span', '', label));
      h.append(p);
    };
    if (this.padSeen) { const p = el('span', 'hpm-pill pad'); p.append(svg(ICON.pad), el('span', '', 'A / B')); h.append(p); }
    pill(this.screen === 'charselect' ? 'WASD' : 'ARROWS', t('hint.move'));
    pill('ENTER', t('hint.select'));
    if (this.screen !== 'results' && this.screen !== 'ladder') pill('ESC', this.screen === 'pause' ? t('hint.resume') : t('hint.back'));
  }

  // ─────────────────────────── navigation ───────────────────────────
  private activeEl(): HTMLElement | null {
    if (!this.confirmBox.hidden) return this.confirmBox;
    if (this.conflict) return this.bindNote;
    if (this.visible && this.screen) return this.screens.get(this.screen) ?? null;
    return null;
  }

  private inScope(e: HTMLElement): boolean { const a = this.activeEl(); return !!a && a.contains(e); }

  navItems(): HTMLElement[] {
    const scope = this.activeEl();
    if (!scope) return [];
    return [...scope.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => {
      if ((e as HTMLButtonElement).disabled) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && e.closest('[hidden]') === null;
    });
  }

  focus(e: HTMLElement, sound: boolean): void {
    if (document.activeElement === e) return;
    e.focus({ preventScroll: false });
    if (sound) this.sound('move');
  }

  /** spatial move in the active scope; wraps inside a [data-group] column */
  move(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const items = this.navItems();
    if (!items.length) return false;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !items.includes(cur)) { this.focus(items.find((e) => e.hasAttribute('data-default')) ?? items[0], true); return true; }
    // CHANGED(UI) P2 (D14): row screens - up / down go to the adjacent row's picked value (or its first control)
    const row = cur.closest<HTMLElement>('[data-row]');
    if (row && (dir === 'up' || dir === 'down')) {
      const scope = this.activeEl();
      const rows = scope ? [...scope.querySelectorAll<HTMLElement>('[data-row]')].filter((r) => r.closest('[hidden]') === null && r.getBoundingClientRect().height > 0) : [];
      const next = rows[rows.indexOf(row) + (dir === 'down' ? 1 : -1)];
      if (next) {
        const pickIn = (sel: string): HTMLElement | null => (next.matches(sel) ? next : null) ?? [...next.querySelectorAll<HTMLElement>(sel)].find((e) => items.includes(e)) ?? null;
        const target = pickIn('.on[data-nav]') ?? pickIn('[data-nav]');
        if (target) { this.focus(target, true); return true; }
      }
      if (!next && dir === 'down') return false;           // up from the first row falls through to the header (BACK)
    }
    // left / right stay inside the row (its end is a wall, never a jump into the row above)
    const rowItems = row && (dir === 'left' || dir === 'right') ? items.filter((e) => row.contains(e)) : null;
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best: HTMLElement | null = null, bestS = Infinity;
    for (const it of rowItems ?? items) {
      if (it === cur) continue;
      const r = it.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      let along: number, across: number, overlap: boolean;
      if (dir === 'up' || dir === 'down') {
        along = dir === 'down' ? r.top - r0.top : r0.bottom - r.bottom;
        across = Math.abs(x - cx);
        overlap = r.left < r0.right && r.right > r0.left;
      } else {
        along = dir === 'right' ? r.left - r0.left : r0.right - r.right;
        across = Math.abs(y - cy);
        overlap = r.top < r0.bottom && r.bottom > r0.top;
      }
      if (along <= 2) continue;
      const sc = along + across * (overlap ? 0.5 : 2.5);
      if (sc < bestS) { bestS = sc; best = it; }
    }
    if (!best && (dir === 'up' || dir === 'down') && cur.dataset.group) {
      const g = items.filter((e) => e.dataset.group === cur.dataset.group);
      best = dir === 'down' ? g[0] : g[g.length - 1];
      if (best === cur) best = null;
    }
    if (!best) return false;
    this.focus(best, true);
    return true;
  }

  private activate(): void {
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !this.inScope(cur)) { this.move('down'); return; }
    if (cur.tagName === 'INPUT') {
      const i = cur as HTMLInputElement;
      if (i.type === 'text') { i.blur(); this.move('down'); }
      return;
    }
    cur.click();
  }

  private scrollActive(dir: 1 | -1): void {
    const scr = this.screen ? this.screens.get(this.screen) : null;
    const s = scr?.querySelector<HTMLElement>('.hpm-scroll');
    if (s) s.scrollBy({ top: dir * 90, behavior: flashesReduced() ? 'auto' : 'smooth' });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.capture || e.defaultPrevented || !this.visible) return;
    const t0 = e.target as HTMLElement | null;
    const typing = !!t0 && t0.tagName === 'INPUT' && (t0 as HTMLInputElement).type === 'text';
    const range = !!t0 && t0.tagName === 'INPUT' && (t0 as HTMLInputElement).type === 'range';
    const code = e.code;
    const dirOf = (): 'up' | 'down' | 'left' | 'right' | null => {
      if (code === 'ArrowUp' || (!typing && code === 'KeyW')) return 'up';
      if (code === 'ArrowDown' || (!typing && code === 'KeyS')) return 'down';
      if (code === 'ArrowLeft' || (!typing && code === 'KeyA')) return 'left';
      if (code === 'ArrowRight' || (!typing && code === 'KeyD')) return 'right';
      return null;
    };
    const confirmKey = code === 'Enter' || code === 'NumpadEnter' || (!typing && (code === 'Space' || code === 'KeyJ'));
    const backKey = code === 'Escape' || (!typing && (code === 'Backspace' || code === 'KeyK'));
    // screens with their own grammar
    if (this.confirmBox.hidden && !this.conflict) {
      if (this.screen === 'title') {
        if (e.repeat || /^(Shift|Control|Alt|Meta)/.test(code) || code === 'Tab') return;
        e.preventDefault();
        this.sound('start');
        this.show('main');
        return;
      }
      if (this.screen === 'vs' || this.screen === 'card' || this.screen === 'ending') {
        if (e.repeat) return;
        if (confirmKey || backKey) { e.preventDefault(); this.finishAny(); }
        return;
      }
      if (this.screen === 'charselect') {
        const d = dirOf();
        if (e.repeat && !d) return;
        let act: CsAct | null = d;
        if (!act && confirmKey) act = 'confirm';
        if (!act && backKey) act = 'back';
        if (!act) return;
        e.preventDefault();
        this.cs.input('active', act);
        return;
      }
      if (this.screen === 'nameentry' && !typing) {
        const d = dirOf();
        if (d === 'up' || d === 'down') { e.preventDefault(); this.nameLetters[this.nameSlot] = (this.nameLetters[this.nameSlot] + (d === 'up' ? 1 : 25)) % 26; this.sound('move'); this.renderName(); return; }
        if (d === 'left' || d === 'right') { e.preventDefault(); this.nameSlot = clamp(this.nameSlot + (d === 'left' ? -1 : 1), 0, 2); this.sound('move'); this.renderName(); return; }
        if (/^Key[A-Z]$/.test(code) && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK'].includes(code)) {
          e.preventDefault();
          this.nameLetters[this.nameSlot] = code.charCodeAt(3) - 65;
          this.nameSlot = Math.min(2, this.nameSlot + 1);
          this.renderName();
          return;
        }
        if (confirmKey) { e.preventDefault(); if (this.nameSlot < 2) { this.nameSlot++; this.renderName(); } else this.finishName(); return; }
        return;
      }
    }
    const d = dirOf();
    if (d) {
      if (typing && (d === 'left' || d === 'right')) return;
      if (range && (d === 'left' || d === 'right')) return;
      e.preventDefault();
      if (!this.move(d) && (d === 'up' || d === 'down')) this.scrollActive(d === 'down' ? 1 : -1);
      return;
    }
    if (confirmKey) {
      if (t0 && t0.tagName === 'BUTTON' && this.inScope(t0) && (code === 'Enter' || code === 'Space' || code === 'NumpadEnter')) return;   // native click
      e.preventDefault();
      this.activate();
      return;
    }
    if (backKey) {
      if (typing && code !== 'Escape') return;
      e.preventDefault();
      if (typing) { (t0 as HTMLInputElement).blur(); return; }
      this.back();
      return;
    }
    if (code === 'Tab') {
      const items = this.navItems();
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      this.focus(items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length], true);
    }
  }

  // ─────────────────────────── loop: pads + showcase ───────────────────────────
  private startLoop(): void {
    if (this.raf) return;
    // CHANGED(integrator): seed each pad's previous buttons with what is held NOW, so a button already down when a screen
    // appears is not a fresh press. Measured before: pad START paused a bout (SHELL Input edge) and the pause card's first
    // poll saw the same START as a new press -> 'resume' (every other START press left the bout running).
    try {
      const list = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()] : [];
      list.filter((g): g is Gamepad => !!g && g.connected).forEach((gp, pi) => {
        const st = this.pads[pi] ?? (this.pads[pi] = { prev: [], dir: '', repeatT: 0 });
        st.prev = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      });
    } catch { /* no Gamepad API */ }
    this.lastT = performance.now();
    const tick = (now: number): void => {
      this.raf = 0;
      if (!this.visible) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
      this.lastT = now;
      this.update(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  private connectedPads(): number {
    try { return [...(navigator.getGamepads?.() ?? [])].filter((g) => g && g.connected).length; } catch { return 0; }
  }

  private pollPads(dt: number): void {
    let list: Array<Gamepad | null> = [];
    try { list = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()] : []; } catch { list = []; }
    const pads = list.filter((g): g is Gamepad => !!g && g.connected);
    if (!pads.length) return;
    if (!this.padSeen) { this.padSeen = true; this.renderHints(); }
    pads.forEach((gp, pi) => {
      const st = this.pads[pi] ?? (this.pads[pi] = { prev: [], dir: '', repeatT: 0 });
      const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      const prev = st.prev;                               // edges against LAST frame's buttons (read before replacing)
      const pressed = (i: number): boolean => !!now[i] && !prev[i];
      const newly = now.findIndex((v, i) => v && !prev[i]);
      st.prev = now;
      // remap capture of a pad slot
      if (this.capture && this.capture.slot === 'pad') {
        if (newly >= 0) this.assign(this.capture.p, this.capture.action, 'pad', newly);
        return;
      }
      if (this.capture) return;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      let dir = '';
      if (now[12] || ay < -0.55) dir = 'up';
      else if (now[13] || ay > 0.55) dir = 'down';
      else if (now[14] || ax < -0.55) dir = 'left';
      else if (now[15] || ax > 0.55) dir = 'right';
      let fireDir = false;
      if (!dir) { st.dir = ''; st.repeatT = 0; } else {
        fireDir = dir !== st.dir || st.repeatT <= 0;
        st.repeatT = dir !== st.dir ? 0.38 : (st.repeatT <= 0 ? 0.12 : st.repeatT - dt);
        st.dir = dir;
      }
      const confirmP = pressed(0);
      const backP = pressed(1);
      const startP = pressed(9);
      if (!this.visible) return;
      if (!this.confirmBox.hidden || this.conflict) {
        if (fireDir) this.move(dir as 'up');
        if (confirmP) this.activate();
        if (backP) this.back();
        return;
      }
      switch (this.screen) {
        case 'title': if (confirmP || startP) { this.sound('start'); this.show('main'); } return;
        case 'vs': case 'card': case 'ending': if (confirmP || startP || backP) this.finishAny(); return;
        case 'charselect': {
          const who: 0 | 1 | 'active' = this.cs.readback().simultaneous ? (pi === 1 ? 1 : 0) : 'active';
          if (fireDir) this.cs.input(who, dir as CsAct);
          if (confirmP || startP) this.cs.input(who, 'confirm');
          if (backP) this.cs.input(who, 'back');
          return;
        }
        case 'nameentry':
          if (fireDir && (dir === 'up' || dir === 'down')) { this.nameLetters[this.nameSlot] = (this.nameLetters[this.nameSlot] + (dir === 'up' ? 1 : 25)) % 26; this.renderName(); }
          if (fireDir && (dir === 'left' || dir === 'right')) { this.nameSlot = clamp(this.nameSlot + (dir === 'left' ? -1 : 1), 0, 2); this.renderName(); }
          if (confirmP || startP) { if (this.nameSlot < 2) { this.nameSlot++; this.renderName(); } else this.finishName(); }
          return;
        default: break;
      }
      if (startP && this.screen === 'pause' && this.stack.length === 1) { this.finishPause('resume'); return; }
      if (fireDir) {
        const cur = document.activeElement as HTMLElement | null;
        if ((dir === 'left' || dir === 'right') && cur && cur.tagName === 'INPUT' && (cur as HTMLInputElement).type === 'range') {
          const r = cur as HTMLInputElement;
          if (dir === 'left') r.stepDown(); else r.stepUp();
          r.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (!this.move(dir as 'up') && (dir === 'up' || dir === 'down')) this.scrollActive(dir === 'down' ? 1 : -1);
      }
      if (confirmP) this.activate();
      if (backP) this.back();
    });
  }

  private showcaseShow(id: string | null, color: number, pose: 'idle' | 'intro' | 'win'): void {
    const sc = this.deps.showcase;
    if (!sc) return;
    if (!id) { sc.hide?.(); return; }
    sc.show(id, color, pose).catch((e: unknown) => console.warn('[hit-parade ui] showcase', e));
  }

  private showcaseRegion(on: boolean): void {
    const sc = this.deps.showcase;
    if (!sc || !this.driveShowcase) return;
    if (!on) {
      if (this.lastShowcase) { sc.setRect?.(null); sc.hide?.(); this.lastShowcase = null; }
      this.screens.get('charselect')?.classList.remove('hpm-3d');
    }
  }

  /**
   * CHANGED(integrator): the Showcase draws into the shared #game canvas UNDER this DOM, and every screen paints an opaque
   * backdrop, so in the game the 3D model was never visible (the UI lab used a DOM stub). While the select screen drives
   * the Showcase it moves its backdrop to ::before with a CSS mask hole at the showcase rect (menus.css .hpm-3d).
   */
  private showcaseHole(r: Rect): void {
    const scr = this.screens.get('charselect');
    if (!scr) return;
    const b = scr.getBoundingClientRect();
    const st = scr.style;
    st.setProperty('--sc-x', `${Math.round(r.x - b.left)}px`);
    st.setProperty('--sc-y', `${Math.round(r.y - b.top)}px`);
    st.setProperty('--sc-w', `${Math.round(r.w)}px`);
    st.setProperty('--sc-h', `${Math.round(r.h)}px`);
    scr.classList.add('hpm-3d');
  }

  private driveShowcaseFrame(dt: number): void {
    const sc = this.deps.showcase;
    if (!sc || !this.driveShowcase) return;
    const r = this.showcaseRect();
    if (!r) return;
    const l = this.lastShowcase;
    if (!l || l.x !== r.x || l.y !== r.y || l.w !== r.w || l.h !== r.h) { sc.setRect?.(r); this.lastShowcase = r; this.showcaseHole(r); }
    sc.frame(dt);
    sc.render();
  }

  private trNote(s: string): void { if (this.trNoteEl) setText(this.trNoteEl, s); }

  private sound(c: UiCue): void { try { this.deps.audio?.ui?.(c); } catch { /* audio is optional */ } }
  private music(c: string): void { try { this.deps.audio?.music?.(c); } catch { /* optional */ } }
}

const TOUCH_PARAM = ((): boolean => { try { return new URLSearchParams(location.search).get('touch') === '1'; } catch { return false; } })();

/** audio credit lines: runtime/src/audio/CREDITS.json (generated by the AUDIO lane) when present */
function audioCredits(): string[] {
  const mods = import.meta.glob('../audio/CREDITS.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  const j = Object.values(mods)[0] as { lines?: unknown } | undefined;
  const lines = Array.isArray(j?.lines) ? (j!.lines as unknown[]).filter((l): l is string => typeof l === 'string') : [];
  return lines.length ? lines : [t('cr.audio.pending')];
}
