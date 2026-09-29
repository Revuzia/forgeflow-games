// DYEFIELD — the menus (CONTRACT_P6_11 §20): title / lobby, LOADOUT, PLAY → map select, SETTINGS, HOW TO PLAY,
// CREDITS, the in-match pause card and the QUIT MATCH confirm. DOM over the live 3D lobby (main.ts runs a
// lobby Game on Pier 18 at noon behind it). Toy-bright and chunky like the HUD: Lilita One + Nunito, ink
// outlines, hard drop shadows.
//
// Copy: the brief's fixed strings where they apply (DESIGN §1) — wordmark DYEFIELD, the mode line (a teams match:
// 'Harbor Cup • 4 v 4'; the title names both modes, 'Harbor Cup • 4 v 4 · Free-for-all'), the LOADOUT hint 'Pick your
// kit — crest sits on the right', the credits line (widened to 'An original 4 v 4 and free-for-all turf-paint
// shooter.' once FFA shipped), the menu labels PLAY / LOADOUT / SETTINGS / HOW TO PLAY / CREDITS;
// bot tiers BREEZE / SWELL / STORM (ids breeze / swell / storm).
//
// Navigation: every control carries [data-nav]. Arrow keys / d-pad / left stick move focus spatially inside
// the active screen (or the extra scope — the victory slate); Enter / Space / pad A activate; Esc / pad B go
// back; mouse hover moves focus. A range slider takes ←/→ itself. The key-remap capture suspends the game's
// Input while it listens.
//
// State lives in SettingsStore / ProfileStore (settings.ts); main.ts listens to them and applies changes live.
//
// CONTRACT_FFA F3: PLAY carries a MODE selector — TEAMS · 4 v 4 (the default) / FREE-FOR-ALL — persisted in the
// profile. The title's brand line names both modes whichever is picked; the profile card shows the picked one
// (TEAMS: the crew name, FFA: FREE-FOR-ALL). In FFA the LOADOUT crew toggle becomes a colour pick of the 8 FFA crews (a chip + its mark; bots take the
// other seven), and the profile card / plate / PLAY kit line / mannequin take the picked colour.

import { WEAPONS, playableMaps, teamById, TEAMS_RAW, type MapDef } from '../core/data.ts';
import type { TeamId } from '../core/types.ts';
import type { BotSkill } from '../core/match/roster.ts';
import { codeLabel, type Action, type Input } from '../input.ts';
import { RENDER_QUALITIES, type RenderQuality } from '../view/renderer.ts';
import { cleanName, NAME_MAX, SENS_MAX, SENS_MIN, BOT_SKILL_IDS, type Bindings, type ProfileMode, type ProfileStore, type SettingsStore } from './settings.ts';
import { crewLook, ffaCrews } from './slates.ts';
import { KIT_ICONS, MAP_THUMBS, SVG, roleLabel } from './icons.ts';
import { MODE_LINE_ALL, MODE_LINE_FFA, fillModeLine } from './boot.ts';
import type { Mannequin } from './mannequin.ts';
import './menus.css';

export const LOADOUT_HINT = 'Pick your kit — crest sits on the right';
/** the title's brand line (both modes) and the FFA match line; defined in boot.ts so the loading card shares them */
export { MODE_LINE_ALL, MODE_LINE_FFA };
/** CONTRACT_FFA F3: the PLAY mode selector labels */
export const MODE_LABELS: ReadonlyArray<readonly [ProfileMode, string]> = [['teams', 'TEAMS · 4 v 4'], ['ffa', 'FREE-FOR-ALL']];
/** the brief's credits line, widened for the FREE-FOR-ALL mode (owner 2026-09-28: 4 v 4-only copy was misleading) */
export const CREDITS_LINE = 'An original 4 v 4 and free-for-all turf-paint shooter.';
/** HOW TO PLAY panel 1's rule: teams (unchanged copy) / FREE-FOR-ALL (new copy, CONTRACT_FFA F3) */
export const HOW_RULE = 'Dye the court in your crew’s color. When the final horn sounds, the crew with more turf wins.';
export const HOW_RULE_FFA = 'Free-for-all: every runner is a crew of one. When the final horn sounds, the most turf wins.';
export const MENU_LABELS = ['PLAY', 'LOADOUT', 'SETTINGS', 'HOW TO PLAY', 'CREDITS'] as const;

export type Screen = 'title' | 'loadout' | 'play' | 'settings' | 'howto' | 'credits' | 'pause';
export type UiSound = 'hover' | 'click' | 'back' | 'start';

export interface StartSelection {
  /** the concrete map (RANDOM already resolved) */
  map: string;
  random: boolean;
  preset: string;
  skill: BotSkill;
  kit: string;
  crew: TeamId;
  name: string;
  /** CONTRACT_FFA F3: the match mode picked on PLAY */
  mode: ProfileMode;
  /** CONTRACT_FFA F3: the human's FFA colour (1..8) */
  ffaColor: number;
}

export interface MenuHooks {
  /** START on the map select (a real click / key / pad press: a user gesture — pointer lock may be requested) */
  start(sel: StartSelection): void;
  /** RESUME on the pause card (a user gesture) */
  resume(): void;
  /** QUIT MATCH, confirmed */
  quitMatch(): void;
  /** UI sounds (the integrator routes these to audio.ui) */
  sound?(s: UiSound): void;
  /** the gamepad Start button while no menu is up (main pauses the match) */
  padStart?(): void;
}

/** remappable actions, in the order the SETTINGS list shows them */
export const REMAP: ReadonlyArray<readonly [Action, string]> = [
  ['moveF', 'MOVE FORWARD'], ['moveB', 'MOVE BACK'], ['moveL', 'MOVE LEFT'], ['moveR', 'MOVE RIGHT'],
  ['jump', 'JUMP'], ['fire', 'FIRE'], ['slick', 'SLICK · DRINK'], ['sub', 'SUB'], ['special', 'SPECIAL'], ['pause', 'PAUSE'],
];
const ACTION_LABEL: Record<string, string> = Object.fromEntries([...REMAP, ['debug', 'DEBUG'], ['map', 'MAP']] as Array<[string, string]>);

const SKILL_TEXT: Record<BotSkill, [string, string]> = {
  breeze: ['BREEZE', 'Easy-going crews. Good for learning the court.'],
  swell: ['SWELL', 'A fair fight — the Harbor Cup standard.'],
  storm: ['STORM', 'Sharp aim, fast rotations. Bring your best.'],
};
const LIGHT_TEXT: Record<string, string> = { pier18: '', lockwell: 'INTERIOR LIGHTS', cinder: 'WARM OVERCAST' };
const PRESET_TEXT: Record<string, string> = { noon: 'NOON', golden: 'GOLDEN HOUR' };
const STAT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['range', 'RANGE'], ['damage', 'DAMAGE'], ['fireRate', 'FIRE RATE'], ['mobility', 'MOBILITY'], ['coverage', 'COVERAGE'],
];

/** a remap button's keycap: codeLabel, with L / R on the paired modifiers (both SHIFTs are bound by default) */
function keyCap(code: string): string {
  const m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  return m ? `${m[2] === 'Left' ? 'L' : 'R'} ${codeLabel(code)}` : codeLabel(code);
}

/** audio credit lines (runtime/src/audio/CREDITS.json when present; the integrator fills the placeholder) */
const AUDIO_CREDITS: string[] = (() => {
  const mods = import.meta.glob('../audio/CREDITS.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  const j = Object.values(mods)[0] as { lines?: unknown } | undefined;
  const lines = Array.isArray(j?.lines) ? j!.lines.filter((l): l is string => typeof l === 'string') : [];
  return lines.length ? lines : ['Music and sound effects: credits to come.'];
})();

// ───────────────────────────── tiny DOM helpers ─────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(cls: string, text: string, nav = true): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  if (nav) b.dataset.nav = '';
  return b;
}
function svgEl(html: string, cls = 'dfm-ico'): HTMLElement {
  const s = el('span', cls);
  s.innerHTML = html;
  return s;
}
const kitRow = (id: string) => WEAPONS.kits.find((k) => k.id === id) ?? WEAPONS.kits[0];
const subRow = (id: string) => WEAPONS.subs.find((s) => s.id === id);
const specialRow = (id: string) => WEAPONS.specials.find((s) => s.id === id);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** the crew palette in use (teams.json, or its colorblind block) */
export function crewColors(team: TeamId, colorblind: boolean): { dye: string; ui: string } {
  const t = teamById(team);
  if (colorblind) {
    const cb = TEAMS_RAW.colorblind as Record<string, { dye?: string; ui?: string }> | undefined;
    const c = cb?.[t.key];
    if (c?.dye) return { dye: c.dye, ui: c.ui ?? c.dye };
  }
  return { dye: t.dye, ui: t.ui };
}

interface PadState { buttons: boolean[]; axisX: number; axisY: number; repeatT: number; dir: string }

export class Menus {
  readonly root: HTMLElement;
  screen: Screen | null = null;
  /** 'lobby' = the title stack is the root screen; 'pause' = the pause card is */
  context: 'lobby' | 'pause' | null = null;
  /** an extra focus scope outside the menus (the victory slate's buttons) */
  extraScope: HTMLElement | null = null;
  mannequin: Mannequin | null = null;
  /** a key event already handled by the app (the ESC that opened the pause card) */
  handledEvent: Event | null = null;
  private readonly hooks: MenuHooks;
  private readonly settings: SettingsStore;
  private readonly profile: ProfileStore;
  private readonly input: Input;
  private readonly screens = new Map<Screen, HTMLElement>();
  private stack: Screen[] = [];
  private readonly maps: MapDef[];
  // title parts
  private readonly profName: HTMLElement;
  private readonly profCrew: HTMLElement;
  private readonly profMark: HTMLElement;
  private readonly kitCard: HTMLElement;
  private readonly modeText: HTMLElement;
  /** HOW TO PLAY panel 1's rule line: HOW_RULE (teams, unchanged) / HOW_RULE_FFA, by the profile's mode */
  private howRule: HTMLElement | null = null;
  // CONTRACT_FFA F3: the PLAY mode selector + the LOADOUT FFA colour pick
  private readonly modeBtns = new Map<ProfileMode, HTMLButtonElement>();
  private readonly crewCap: HTMLElement;
  private readonly crewRow: HTMLElement;
  private readonly colorRow: HTMLElement;
  private readonly colorBtns = new Map<number, HTMLButtonElement>();
  // loadout parts
  private readonly kitTiles = new Map<string, HTMLButtonElement>();
  private readonly crewBtns = new Map<TeamId, HTMLButtonElement>();
  private readonly nameInput: HTMLInputElement;
  private readonly statsBox: HTMLElement;
  private readonly subBox: HTMLElement;
  private readonly spBox: HTMLElement;
  private readonly plate: HTMLElement;
  readonly mannequinSlot: HTMLElement;
  // play parts
  private readonly mapCards = new Map<string, HTMLButtonElement>();
  private readonly presetRow: HTMLElement;
  private readonly presetBtns = new Map<string, HTMLButtonElement>();
  private readonly lightNote: HTMLElement;
  private readonly skillBtns = new Map<BotSkill, HTMLButtonElement>();
  private readonly skillNote: HTMLElement;
  private readonly playKit: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  // settings parts
  private readonly keyBtns = new Map<string, HTMLButtonElement>();
  private readonly bindNote: HTMLElement;
  private readonly setCtl = new Map<string, HTMLElement>();
  private capture: { action: Action; slot: number; btn: HTMLButtonElement; off: () => void } | null = null;
  private conflict: { action: Action; slot: number; code: string; other: Action } | null = null;
  // how-to parts (live key labels)
  private readonly howKeys: Array<[HTMLElement, Action]> = [];
  // pause parts
  private readonly pauseMsg: HTMLElement;
  private readonly legendBox: HTMLElement;
  private readonly howLegend: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly hints: HTMLElement;
  private pad: PadState = { buttons: [], axisX: 0, axisY: 0, repeatT: 0, dir: '' };
  private padSeen = false;
  private offs: Array<() => void> = [];
  private dragOff: (() => void) | null = null;

  constructor(host: HTMLElement, o: { hooks: MenuHooks; settings: SettingsStore; profile: ProfileStore; input: Input }) {
    this.hooks = o.hooks;
    this.settings = o.settings;
    this.profile = o.profile;
    this.input = o.input;
    this.maps = playableMaps();
    this.root = el('div', 'dfm');
    this.root.id = 'df-menus';
    this.root.hidden = true;

    // ── TITLE ─────────────────────────────────────────────
    const title = this.mkScreen('title');
    const scrim = el('div', 'dfm-scrim');
    const brand = el('div', 'dfm-brand');
    const wm = el('h1', 'df-wordmark');
    wm.setAttribute('aria-label', 'DYEFIELD');
    wm.append(el('span', 'dye', 'DYE'), el('span', 'field', 'FIELD'));
    const mode = el('p', 'df-mode');
    const m1 = el('i', '', '◉'); m1.setAttribute('aria-hidden', 'true');
    const m2 = el('i', 'g', '▲'); m2.setAttribute('aria-hidden', 'true');
    this.modeText = el('span');
    fillModeLine(this.modeText, MODE_LINE_ALL);
    mode.append(m1, this.modeText, m2);
    brand.append(wm, mode);
    const stack = el('nav', 'dfm-stack');
    stack.setAttribute('aria-label', 'Main menu');
    const items: Array<[string, () => void]> = [
      ['PLAY', () => this.open('play')],
      ['LOADOUT', () => this.open('loadout')],
      ['SETTINGS', () => this.open('settings')],
      ['HOW TO PLAY', () => this.open('howto')],
      ['CREDITS', () => this.open('credits')],
    ];
    items.forEach(([label, fn], i) => {
      const b = btn(`dfm-item${i === 0 ? ' dfm-item-play' : ''}`, '');
      b.id = `dfm-${label.toLowerCase().replace(/ /g, '-')}`;
      b.dataset.group = 'stack';
      if (i === 0) b.dataset.default = '';
      b.append(el('span', 'chev', '▶'), el('span', 'lbl', label));
      b.addEventListener('click', () => { this.sound('click'); fn(); });
      stack.append(b);
    });
    // profile card (top right)
    const prof = el('div', 'dfm-profile');
    this.profMark = el('span', 'mark');
    const pt = el('div', 'txt');
    this.profName = el('b', '', '');
    this.profCrew = el('span', '', '');
    pt.append(this.profName, this.profCrew);
    prof.append(this.profMark, pt);
    // current-loadout card (bottom right)
    this.kitCard = btn('dfm-kitcard', '');
    this.kitCard.id = 'dfm-kitcard';
    this.kitCard.addEventListener('click', () => { this.sound('click'); this.open('loadout'); });
    title.append(scrim, brand, stack, prof, this.kitCard);

    // ── LOADOUT ───────────────────────────────────────────
    const lo = this.mkScreen('loadout');
    lo.append(el('div', 'dfm-scrim wide'), this.header('LOADOUT', LOADOUT_HINT));
    const loBody = el('div', 'dfm-lo');
    const colA = el('div', 'dfm-lo-a');
    const kits = el('div', 'dfm-kits');
    kits.setAttribute('role', 'radiogroup');
    kits.setAttribute('aria-label', 'Kit');
    for (const k of WEAPONS.kits) {
      const b = btn('dfm-kit', '');
      b.dataset.kit = k.id;
      b.id = `dfm-kit-${k.id}`;
      b.setAttribute('role', 'radio');
      const img = el('img', 'kiticon');
      img.src = KIT_ICONS[k.id] ?? '';
      img.alt = '';
      img.draggable = false;
      b.append(img, el('b', '', k.name), el('span', 'role', roleLabel(k.role)));
      b.addEventListener('click', () => { this.sound('click'); this.pickKit(k.id); });
      this.kitTiles.set(k.id, b);
      kits.append(b);
    }
    const crew = el('div', 'dfm-crew');
    this.crewCap = el('h3', 'dfm-cap', 'CREW');
    crew.append(this.crewCap);
    const crewRow = el('div', 'dfm-seg crew');
    this.crewRow = crewRow;
    for (const t of [1, 2] as TeamId[]) {
      const td = teamById(t);
      const b = btn(`dfm-crewbtn ${td.key}`, '');
      b.id = `dfm-crew-${td.key}`;
      b.append(el('i', '', td.markGlyph), el('span', '', td.name));
      b.addEventListener('click', () => { this.sound('click'); this.profile.set({ crew: t }); });
      this.crewBtns.set(t, b);
      crewRow.append(b);
    }
    // FFA: the colour pick of the 8 crews (a chip + its mark)
    this.colorRow = el('div', 'dfm-colors');
    this.colorRow.setAttribute('role', 'radiogroup');
    this.colorRow.setAttribute('aria-label', 'Color');
    this.colorRow.hidden = true;
    for (const c of ffaCrews()) {
      const b = btn('dfm-color', '');
      b.id = `dfm-color-${c.key}`;
      b.dataset.color = String(c.id);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.label);
      b.title = c.label;
      b.style.setProperty('--c', c.dye);
      b.style.setProperty('--cg', c.dyeGloss);
      b.append(el('i', '', c.markGlyph));
      b.addEventListener('click', () => { this.sound('click'); this.profile.set({ ffaColor: c.id }); });
      this.colorBtns.set(c.id, b);
      this.colorRow.append(b);
    }
    crew.append(crewRow, this.colorRow);
    const nameBox = el('label', 'dfm-namebox');
    nameBox.append(el('h3', 'dfm-cap', 'NAME'));
    this.nameInput = el('input', 'dfm-name');
    this.nameInput.id = 'dfm-name';
    this.nameInput.type = 'text';
    this.nameInput.maxLength = NAME_MAX;
    this.nameInput.placeholder = 'YOU';
    this.nameInput.autocomplete = 'off';
    this.nameInput.spellcheck = false;
    this.nameInput.dataset.nav = '';
    this.nameInput.addEventListener('input', () => {
      const c = cleanName(this.nameInput.value);
      if (c !== this.nameInput.value) this.nameInput.value = c;
    });
    this.nameInput.addEventListener('change', () => this.profile.set({ name: cleanName(this.nameInput.value) }));
    this.nameInput.addEventListener('blur', () => this.profile.set({ name: cleanName(this.nameInput.value) }));
    nameBox.append(this.nameInput);
    colA.append(kits, crew, nameBox);
    const colB = el('div', 'dfm-lo-b');
    this.statsBox = el('div', 'dfm-card dfm-stats');
    const subsp = el('div', 'dfm-subsp');
    this.subBox = el('div', 'dfm-card dfm-mini');
    this.spBox = el('div', 'dfm-card dfm-mini');
    subsp.append(this.subBox, this.spBox);
    colB.append(this.statsBox, subsp);
    const colC = el('div', 'dfm-lo-c');
    this.mannequinSlot = el('div', 'dfm-mannequin');
    this.mannequinSlot.id = 'dfm-mannequin';
    this.plate = el('div', 'dfm-plate');
    colC.append(this.mannequinSlot, this.plate);
    loBody.append(colA, colB, colC);
    lo.append(loBody);

    // ── PLAY → map select ─────────────────────────────────
    const play = this.mkScreen('play');
    const playHead = this.header('PLAY', 'Pick an arena');
    // CONTRACT_FFA F3: the MODE selector (TEAMS · 4 v 4 / FREE-FOR-ALL), persisted in the profile
    const modeBox = el('div', 'dfm-modebox');
    modeBox.append(el('h3', 'dfm-cap', 'MODE'));
    // its own class (not .dfm-seg): the PLAY screen's first .dfm-seg stays the TIME OF DAY row
    const modeSeg = el('div', 'dfm-modeseg');
    modeSeg.setAttribute('role', 'radiogroup');
    modeSeg.setAttribute('aria-label', 'Mode');
    for (const [m, label] of MODE_LABELS) {
      const b = btn('dfm-segbtn dfm-modebtn', label);
      b.id = `dfm-mode-${m}`;
      b.dataset.mode = m;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { this.sound('click'); this.profile.set({ mode: m }); });
      this.modeBtns.set(m, b);
      modeSeg.append(b);
    }
    modeBox.append(modeSeg);
    playHead.append(modeBox);
    play.append(el('div', 'dfm-scrim full'), playHead);
    const mapRow = el('div', 'dfm-maps');
    mapRow.setAttribute('role', 'radiogroup');
    const mkMap = (id: string, name: string, type: string, favors: string[], thumb: string | null, tagline: string): HTMLButtonElement => {
      const b = btn('dfm-map', '');
      b.dataset.map = id;
      b.id = `dfm-map-${id}`;
      b.setAttribute('role', 'radio');
      const th = el('div', 'thumb');
      if (thumb) {
        const img = el('img');
        img.src = thumb;
        img.alt = '';
        img.draggable = false;
        th.append(img);
      } else {
        th.classList.add('random');
        th.append(svgEl(SVG.dice, 'dice'));
      }
      const fav = el('div', 'favors');
      for (const f of favors) fav.append(el('span', '', f.toUpperCase()));
      b.append(th, el('b', 'name', name), el('span', 'type', type), fav, el('p', 'tag', tagline));
      b.addEventListener('click', () => { this.sound('click'); this.profile.set({ map: id }); });
      this.mapCards.set(id, b);
      return b;
    };
    for (const m of this.maps) mapRow.append(mkMap(m.id, m.name, m.type, m.favors ?? [], MAP_THUMBS[m.id] ?? null, m.tagline ?? ''));
    mapRow.append(mkMap('random', 'RANDOM', 'one of the three arenas', ['SURPRISE'], null,
      'The horn picks the court. Your kit, your crew, a new floor to dye.'));
    const opts = el('div', 'dfm-opts');
    const tod = el('div', 'dfm-opt');
    tod.append(el('h3', 'dfm-cap', 'TIME OF DAY'));
    this.presetRow = el('div', 'dfm-seg');
    for (const p of ['noon', 'golden']) {
      const b = btn('dfm-segbtn', PRESET_TEXT[p] ?? p.toUpperCase());
      b.id = `dfm-preset-${p}`;
      b.addEventListener('click', () => { this.sound('click'); this.profile.set({ preset: p }); });
      this.presetBtns.set(p, b);
      this.presetRow.append(b);
    }
    this.lightNote = el('div', 'dfm-light', '');
    tod.append(this.presetRow, this.lightNote);
    const bots = el('div', 'dfm-opt');
    bots.append(el('h3', 'dfm-cap', 'BOTS'));
    const skillRow = el('div', 'dfm-seg');
    for (const s of BOT_SKILL_IDS) {
      const b = btn('dfm-segbtn', SKILL_TEXT[s][0]);
      b.id = `dfm-skill-${s}`;
      b.dataset.skill = s;
      b.addEventListener('click', () => { this.sound('click'); this.profile.set({ skill: s }); });
      this.skillBtns.set(s, b);
      skillRow.append(b);
    }
    this.skillNote = el('p', 'dfm-note', '');
    bots.append(skillRow, this.skillNote);
    const you = el('div', 'dfm-opt');
    you.append(el('h3', 'dfm-cap', 'YOUR KIT'));
    this.playKit = btn('dfm-playkit', '');
    this.playKit.id = 'dfm-playkit';
    this.playKit.addEventListener('click', () => { this.sound('click'); this.open('loadout'); });
    you.append(this.playKit);
    this.startBtn = btn('df-btn dfm-start', 'START');
    this.startBtn.id = 'dfm-start';
    this.startBtn.addEventListener('click', () => this.doStart());
    opts.append(tod, bots, you, this.startBtn);
    play.append(mapRow, opts);

    // ── SETTINGS ──────────────────────────────────────────
    const set = this.mkScreen('settings');
    set.append(el('div', 'dfm-scrim full'), this.header('SETTINGS', ''));
    const cols = el('div', 'dfm-set');
    const ctl = el('section', 'dfm-card dfm-keys');
    const kh = el('div', 'dfm-keys-head');
    kh.append(el('h3', 'dfm-cap', 'CONTROLS'), el('span', 'dfm-keys-cols', 'KEY · ALT'));
    ctl.append(kh);
    for (const [a, label] of REMAP) {
      const row = el('div', 'dfm-bind');
      row.append(el('span', 'lbl', label));
      for (let slot = 0; slot < 2; slot++) {
        const b = btn('dfm-key', '');
        b.dataset.action = a;
        b.dataset.slot = String(slot);
        b.id = `dfm-key-${a}-${slot}`;
        b.addEventListener('click', () => this.beginCapture(a, slot, b));
        this.keyBtns.set(`${a}:${slot}`, b);
        row.append(b);
      }
      ctl.append(row);
    }
    this.bindNote = el('div', 'dfm-bindnote');
    this.bindNote.setAttribute('role', 'status');
    const resetKeys = btn('dfm-small', 'RESET KEYS');
    resetKeys.id = 'dfm-reset-keys';
    resetKeys.addEventListener('click', () => { this.sound('click'); this.endCapture(); this.conflict = null; this.settings.resetBindings(); this.note(''); });
    ctl.append(this.bindNote, resetKeys);
    const right = el('div', 'dfm-set-r');
    const mouse = el('section', 'dfm-card');
    mouse.append(el('h3', 'dfm-cap', 'MOUSE'));
    mouse.append(this.slider('sens', 'SENSITIVITY', SENS_MIN, SENS_MAX, 0.05, () => this.settings.get().sensitivity,
      (v) => this.settings.set({ sensitivity: v }), (v) => `${v.toFixed(2)}×`));
    mouse.append(this.toggle('invert', 'INVERT Y', () => this.settings.get().invertY, (v) => this.settings.set({ invertY: v })));
    const audio = el('section', 'dfm-card');
    audio.append(el('h3', 'dfm-cap', 'VOLUME'));
    for (const [k, label] of [['master', 'MASTER'], ['music', 'MUSIC'], ['sfx', 'EFFECTS']] as const) {
      audio.append(this.slider(`vol-${k}`, label, 0, 1, 0.01, () => this.settings.get().volume[k],
        (v) => this.settings.set({ volume: { ...this.settings.get().volume, [k]: v } }), (v) => `${Math.round(v * 100)}`));
    }
    const video = el('section', 'dfm-card');
    video.append(el('h3', 'dfm-cap', 'VIDEO'));
    const qrow = el('div', 'dfm-row wrap');
    qrow.append(el('span', 'lbl', 'QUALITY'));
    const qseg = el('div', 'dfm-seg small');
    for (const q of RENDER_QUALITIES) {
      const b = btn('dfm-segbtn', q.toUpperCase());
      b.id = `dfm-quality-${q}`;
      b.addEventListener('click', () => { this.sound('click'); this.settings.set({ quality: q as RenderQuality }); });
      this.setCtl.set(`quality:${q}`, b);
      qseg.append(b);
    }
    qrow.append(qseg);
    video.append(qrow, this.toggle('fps', 'SHOW FPS', () => this.settings.get().showFps, (v) => this.settings.set({ showFps: v })));
    const access = el('section', 'dfm-card');
    const ah = el('div', 'dfm-cardhead');
    const sw = el('div', 'dfm-swatch');
    sw.append(el('i', 'sun', '◉'), el('i', 'gulf', '▲'));
    ah.append(el('h3', 'dfm-cap', 'ACCESSIBILITY'), sw);
    access.append(ah);
    const cb = this.toggle('colorblind', 'COLORBLIND MARKS', () => this.settings.get().colorblind, (v) => this.settings.set({ colorblind: v }));
    access.append(cb, this.toggle('motion', 'REDUCE MOTION', () => this.settings.get().reduceMotion, (v) => this.settings.set({ reduceMotion: v })));
    right.append(mouse, audio, video, access);
    cols.append(ctl, right);
    set.append(cols);

    // ── HOW TO PLAY ───────────────────────────────────────
    const how = this.mkScreen('howto');
    how.append(el('div', 'dfm-scrim full'), this.header('HOW TO PLAY', ''));
    const panels = el('div', 'dfm-how');
    panels.append(
      this.howPanel(1, 'THE FLOOR IS THE SCORE', HOW_ART.floor, [
        HOW_RULE,
        'Floors count most; walls count a little.']),
      this.howPanel(2, 'SLICK & DRINK', HOW_ART.slick, [
        ['Hold ', ['slick'], ' on your own color to slick down: you sink, your crest cuts through like a fin, and your tank refills fast.'],
        'Enemy dye slows you to a slog.']),
      this.howPanel(3, 'FOUR KITS', this.kitsArt(), [
        'MIST-RASP sprays, SHEET-DRUM rolls, NEEDLE-GLINT charges a long line, POP-WELL lobs bursts.',
        'Pick yours in LOADOUT.']),
      this.howPanel(4, 'SUB & SPECIAL', HOW_ART.subsp, [
        ['', ['sub'], ' throws a JELLY CHARGE (most of a tank). Paint and washes fill your special; ', ['special'], ' unleashes CLOUDBURST or WELLSPRING.'],
        ['Hit ', ['fire'], ' to shoot, ', ['jump'], ' to jump.']]),
    );
    this.howRule = panels.querySelector('.dfm-howp p');
    this.howLegend = el('div', 'dfm-card dfm-howkeys');
    how.append(panels, this.howLegend);

    // ── CREDITS ───────────────────────────────────────────
    const cr = this.mkScreen('credits');
    cr.append(el('div', 'dfm-scrim full'), this.header('CREDITS', ''));
    const cc = el('div', 'dfm-card dfm-credits');
    const cwm = el('div', 'df-wordmark small');
    cwm.append(el('span', 'dye', 'DYE'), el('span', 'field', 'FIELD'));
    cc.append(cwm, el('p', 'dfm-tagline', CREDITS_LINE));
    const grid = el('div', 'dfm-cgrid');
    const block = (h: string, lines: string[]): HTMLElement => {
      const b = el('div', 'blk');
      b.append(el('h3', 'dfm-cap', h));
      for (const l of lines) b.append(el('p', '', l));
      return b;
    };
    grid.append(
      block('MADE BY', ['ForgeFlow Games — Forge Flow Labs', 'Design, code, art and tuning in-house']),
      block('BUILT WITH', ['Three.js (MIT)', 'Rapier physics by Dimforge (Apache-2.0)', 'TypeScript · Vite', 'Blender — every model, map and animation']),
      block('TYPE', ['Lilita One by Juan Montoreano (SIL OFL)', 'Nunito by Vernon Adams, Cyreal & Jacques Le Bailly (SIL OFL)']),
      block('AUDIO', AUDIO_CREDITS),
    );
    cc.append(grid);
    cr.append(cc);

    // ── PAUSE ─────────────────────────────────────────────
    const pause = this.mkScreen('pause');
    pause.classList.add('df-pause');
    const pc = el('div', 'df-pause-card');
    const pl = el('div', 'dfm-pause-l');
    pl.append(el('h2', '', 'PAUSED'));
    const resume = btn('df-btn', 'RESUME');
    resume.id = 'df-resume';
    resume.dataset.default = '';
    resume.dataset.group = 'pause';
    resume.addEventListener('click', (e) => { e.stopPropagation(); this.sound('click'); this.hooks.resume(); });
    pl.append(resume);
    for (const [label, fn, id] of [
      ['SETTINGS', () => this.open('settings'), 'df-p-settings'],
      ['HOW TO PLAY', () => this.open('howto'), 'df-p-howto'],
      ['QUIT MATCH', () => this.askQuit(), 'df-p-quit'],
    ] as Array<[string, () => void, string]>) {
      const b = btn('dfm-item small', '');
      b.id = id;
      b.dataset.group = 'pause';
      b.append(el('span', 'chev', '▶'), el('span', 'lbl', label));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.sound('click'); fn(); });
      pl.append(b);
    }
    this.pauseMsg = el('p', 'dfm-pausemsg', '');
    this.pauseMsg.hidden = true;
    pl.append(this.pauseMsg);
    const pr = el('div', 'dfm-pause-r');
    pr.append(el('h3', 'dfm-cap', 'CONTROLS'));
    this.legendBox = el('div', 'dfm-legend');
    pr.append(this.legendBox);
    pc.append(pl, pr);
    pause.append(pc);

    // ── QUIT confirm (modal over the pause card)
    this.confirm = el('div', 'dfm-confirm');
    this.confirm.hidden = true;
    this.confirm.setAttribute('role', 'alertdialog');
    const qc = el('div', 'dfm-card dfm-confirm-card');
    const quit = btn('df-btn danger', 'QUIT');
    quit.id = 'dfm-quit-yes';
    const stay = btn('dfm-small', 'STAY');
    stay.id = 'dfm-quit-no';
    stay.dataset.default = '';
    quit.addEventListener('click', (e) => { e.stopPropagation(); this.sound('click'); this.confirm.hidden = true; this.hooks.quitMatch(); });
    stay.addEventListener('click', (e) => { e.stopPropagation(); this.sound('back'); this.closeConfirm(); });
    const qrowb = el('div', 'dfm-row center');
    qrowb.append(stay, quit);
    qc.append(el('h2', '', 'QUIT MATCH?'), el('p', '', 'Leave this match and head back to the lobby.'), qrowb);
    this.confirm.append(qc);

    // ── key-hint pills (bottom right, every screen)
    this.hints = el('div', 'dfm-hints');

    this.root.append(...this.screens.values(), this.confirm, this.hints);
    host.append(this.root);

    // listeners
    const onKey = (e: KeyboardEvent): void => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
    const onOver = (e: Event): void => {
      const t = (e.target as HTMLElement | null)?.closest?.('[data-nav]') as HTMLElement | null;
      if (!t || t === document.activeElement || !this.inScope(t)) return;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
      this.focus(t, true);
    };
    this.root.addEventListener('mouseover', onOver);
    const onPad = (): void => { this.padSeen = true; this.renderHints(); };
    window.addEventListener('gamepadconnected', onPad);
    this.offs.push(() => window.removeEventListener('gamepadconnected', onPad));
    this.offs.push(this.settings.on(() => this.refresh()));
    this.offs.push(this.profile.on((_p, keys) => {
      this.refresh();
      if (keys.includes('kit') || keys.includes('crew') || keys.includes('mode') || keys.includes('ffaColor')) this.syncMannequin(keys.includes('kit'));
    }));
    this.dragOff = null;
    this.refresh();
  }

  // ───────────────────────────── building blocks ─────────────────────────────
  private mkScreen(s: Screen): HTMLElement {
    const e = el('section', `dfm-screen dfm-s-${s}`);
    e.dataset.screen = s;
    e.hidden = true;
    this.screens.set(s, e);
    return e;
  }

  private header(title: string, hint: string): HTMLElement {
    const h = el('header', 'dfm-head');
    const back = btn('dfm-back', '');
    back.append(el('span', 'chev', '◀'), el('span', '', 'BACK'));
    back.addEventListener('click', () => this.back());
    const t = el('div', 'dfm-head-t');
    t.append(el('h2', '', title));
    if (hint) t.append(el('p', 'dfm-hint', hint));
    h.append(back, t);
    return h;
  }

  private slider(id: string, label: string, min: number, max: number, step: number, get: () => number,
    put: (v: number) => void, fmt: (v: number) => string): HTMLElement {
    const row = el('label', 'dfm-row dfm-slider');
    const r = el('input');
    r.type = 'range';
    r.min = String(min); r.max = String(max); r.step = String(step);
    r.id = `dfm-${id}`;
    r.dataset.nav = '';
    const val = el('output', 'val', '');
    r.addEventListener('input', () => { put(Number(r.value)); });
    r.addEventListener('change', () => this.sound('click'));
    row.append(el('span', 'lbl', label), r, val);
    const upd = (): void => {
      const v = get();
      if (document.activeElement !== r || Number(r.value) !== v) r.value = String(v);
      val.textContent = fmt(v);
      r.style.setProperty('--fill', `${(((v - min) / (max - min)) * 100).toFixed(1)}%`);
    };
    (row as HTMLElement & { dfUpd?: () => void }).dfUpd = upd;
    this.setCtl.set(id, row);
    return row;
  }

  private toggle(id: string, label: string, get: () => boolean, put: (v: boolean) => void): HTMLElement {
    const row = el('div', 'dfm-row dfm-toggle');
    const b = btn('dfm-switch', '');
    b.id = `dfm-${id}`;
    b.setAttribute('role', 'switch');
    b.append(el('i'));
    b.addEventListener('click', () => { this.sound('click'); put(!get()); });
    row.append(el('span', 'lbl', label), b);
    const upd = (): void => {
      const on = get();
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    };
    (row as HTMLElement & { dfUpd?: () => void }).dfUpd = upd;
    this.setCtl.set(id, row);
    return row;
  }

  private howPanel(n: number, title: string, art: string | HTMLElement, paras: Array<string | Array<string | Action[]>>): HTMLElement {
    const p = el('article', 'dfm-card dfm-howp');
    const a = el('div', 'art');
    if (typeof art === 'string') a.innerHTML = art; else a.append(art);
    const h = el('h3', '');
    h.append(el('span', 'n', String(n)), el('span', '', title));
    p.append(a, h);
    for (const para of paras) {
      const e = el('p', '');
      if (typeof para === 'string') e.textContent = para;
      else {
        for (const part of para) {
          if (typeof part === 'string') e.append(part);
          else {
            const k = el('kbd', 'dfm-kbd', '');
            this.howKeys.push([k, part[0]]);
            e.append(k);
          }
        }
      }
      p.append(e);
    }
    return p;
  }

  private kitsArt(): HTMLElement {
    const g = el('div', 'kits4');
    for (const k of WEAPONS.kits) {
      const img = el('img', 'kiticon');
      img.src = KIT_ICONS[k.id] ?? '';
      img.alt = k.name;
      img.draggable = false;
      g.append(img);
    }
    return g;
  }

  // ───────────────────────────── screens / stack ─────────────────────────────
  get visible(): boolean { return !this.root.hidden && this.screen !== null; }

  /** lobby root: the title stack */
  showTitle(): void {
    this.context = 'lobby';
    this.stack = ['title'];
    this.root.hidden = false;
    this.root.dataset.context = 'lobby';
    this.show('title');
  }

  /** the in-match pause card (msg: e.g. a refused pointer lock) */
  showPause(msg = ''): void {
    this.context = 'pause';
    this.stack = ['pause'];
    this.root.hidden = false;
    this.root.dataset.context = 'pause';
    this.pauseMsg.textContent = msg;
    this.pauseMsg.hidden = !msg;
    this.confirm.hidden = true;
    this.show('pause');
  }

  setPauseMessage(msg: string): void {
    this.pauseMsg.textContent = msg;
    this.pauseMsg.hidden = !msg;
  }

  hideAll(): void {
    this.endCapture();
    this.commitName();
    this.root.hidden = true;
    this.screen = null;
    this.context = null;
    this.stack = [];
    this.confirm.hidden = true;
    for (const s of this.screens.values()) s.hidden = true;
    this.bindMannequin(false);
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  open(s: Screen): void {
    if (this.screen === s) return;
    this.stack.push(s);
    this.show(s);
  }

  /** Esc / pad B / the BACK button: pop a screen. On the pause root: RESUME. Returns true when handled. */
  back(): boolean {
    if (this.capture) { this.endCapture(); this.note(''); return true; }
    if (this.conflict) { this.conflict = null; this.note(''); this.renderKeys(); return true; }
    if (!this.confirm.hidden) { this.sound('back'); this.closeConfirm(); return true; }
    if (!this.visible) return false;
    if (this.stack.length > 1) {
      this.commitName();
      this.stack.pop();
      this.sound('back');
      this.show(this.stack[this.stack.length - 1]);
      return true;
    }
    if (this.screen === 'pause') { this.sound('click'); this.hooks.resume(); return true; }
    return false;
  }

  private show(s: Screen): void {
    const prev = this.screen;
    this.screen = s;
    for (const [k, e] of this.screens) e.hidden = k !== s;
    this.root.dataset.screen = s;
    this.bindMannequin(s === 'loadout');
    this.refresh();
    this.renderHints();
    const scr = this.screens.get(s)!;
    // focus: a screen's default, or (coming back) the item that opened the child
    let target: HTMLElement | null = null;
    if (prev && (s === 'title' || s === 'pause')) {
      const from = prev === 'play' ? 'dfm-play' : prev === 'loadout' ? 'dfm-loadout' : prev === 'settings' ? (s === 'pause' ? 'df-p-settings' : 'dfm-settings')
        : prev === 'howto' ? (s === 'pause' ? 'df-p-howto' : 'dfm-how-to-play') : prev === 'credits' ? 'dfm-credits' : '';
      target = from ? scr.querySelector<HTMLElement>(`#${from}`) : null;
    }
    if (!target && s === 'loadout') target = this.kitTiles.get(this.profile.get().kit) ?? null;
    if (!target && s === 'play') target = this.startBtn;
    target = target ?? scr.querySelector<HTMLElement>('[data-default]') ?? this.navItems()[0] ?? null;
    if (target) this.focus(target, false);
  }

  private askQuit(): void {
    this.confirm.hidden = false;
    const d = this.confirm.querySelector<HTMLElement>('[data-default]');
    if (d) this.focus(d, false);
  }

  private closeConfirm(): void {
    this.confirm.hidden = true;
    const q = this.screens.get('pause')?.querySelector<HTMLElement>('#df-p-quit');
    if (q) this.focus(q, false);
  }

  private doStart(): void {
    const p = this.profile.get();
    let map = p.map;
    const random = map === 'random' || !this.maps.some((m) => m.id === map);
    if (random) map = this.maps[Math.floor(Math.random() * this.maps.length)]?.id ?? 'pier18';
    this.commitName();
    this.sound('start');
    this.hooks.start({
      map, random, preset: map === 'pier18' ? p.preset : '', skill: p.skill, kit: p.kit, crew: p.crew, name: cleanName(this.profile.get().name),
      mode: p.mode, ffaColor: p.ffaColor,
    });
  }

  private commitName(): void {
    const v = cleanName(this.nameInput.value);
    if (v !== this.profile.get().name) this.profile.set({ name: v });
  }

  private pickKit(id: string): void {
    if (this.profile.get().kit === id) { this.mannequin?.setKit(id, true); return; }
    this.profile.set({ kit: id });
  }

  // ───────────────────────────── the mannequin ─────────────────────────────
  setMannequin(m: Mannequin | null): void {
    this.mannequin = m;
    this.syncMannequin(false);
    if (this.screen === 'loadout') this.bindMannequin(true);
  }

  private syncMannequin(preview: boolean): void {
    const m = this.mannequin;
    if (!m) return;
    const p = this.profile.get();
    // FFA: the mannequin wears the picked FFA colour (main.ts's dye callback resolves it in the profile's mode)
    const t = (p.mode === 'ffa' ? p.ffaColor : p.crew) as TeamId;
    m.team = t;
    m.setKit(p.kit, preview);
    m.setTeam(t);
  }

  private bindMannequin(on: boolean): void {
    if (this.dragOff) { this.dragOff(); this.dragOff = null; }
    if (on && this.mannequin) this.dragOff = this.mannequin.bindDrag(this.mannequinSlot);
  }

  /** LOADOUT is up and the mannequin should be drawn: its slot in CSS px (canvas space), else null */
  mannequinRect(): { x: number; y: number; w: number; h: number } | null {
    if (this.screen !== 'loadout' || !this.mannequin || this.root.hidden) return null;
    const r = this.mannequinSlot.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // ───────────────────────────── refresh (settings / profile → DOM) ─────────────────────────────
  refresh(): void {
    const p = this.profile.get();
    const s = this.settings.get();
    const ffa = p.mode === 'ffa';
    const team = teamById(p.crew);
    // FFA: the player's colour (teams.json → ffa) drives the menus' accent instead of the crew's
    const fc = crewLook(p.ffaColor, 'ffa');
    const col = ffa ? { ui: fc.ui, dye: fc.dye } : crewColors(p.crew, s.colorblind);
    const mark = ffa ? fc.markGlyph : team.markGlyph;
    const crewName = ffa ? fc.label : team.name;
    this.root.style.setProperty('--crew', col.ui);
    this.root.style.setProperty('--crew-dye', col.dye);
    if (ffa) { this.root.style.setProperty('--crew-gloss', fc.dyeGloss); this.root.style.setProperty('--crew-ink', fc.uiInk); }
    else { this.root.style.removeProperty('--crew-gloss'); this.root.style.removeProperty('--crew-ink'); }
    this.root.dataset.crew = ffa ? 'ffa' : team.key;
    this.root.dataset.mode = p.mode;
    // title: the brand line names BOTH modes whatever is picked (owner 2026-09-28: a 4 v 4-only line read as if FFA
    // did not exist); the picked mode shows on the profile card below (profCrew) and on PLAY's MODE selector
    fillModeLine(this.modeText, MODE_LINE_ALL);
    if (this.howRule) this.howRule.textContent = ffa ? HOW_RULE_FFA : HOW_RULE;
    this.profMark.textContent = mark;
    this.profName.textContent = p.name || 'YOU';
    this.profCrew.textContent = ffa ? MODE_LABELS[1][1] : team.name;
    const k = kitRow(p.kit);
    const sub = subRow(k.sub), sp = specialRow(k.special);
    this.kitCard.replaceChildren();
    const kimg = el('img', 'kiticon');
    kimg.src = KIT_ICONS[k.id] ?? '';
    kimg.alt = '';
    kimg.draggable = false;
    const kt = el('div', 'txt');
    kt.append(el('span', 'cap', 'LOADOUT'), el('b', '', k.name), el('span', 'role', roleLabel(k.role)));
    const chips = el('div', 'chips');
    if (sub) chips.append(this.chip(SVG['jelly-charge'], sub.name));
    if (sp) chips.append(this.chip(SVG[sp.id] ?? '', sp.name));
    kt.append(chips);
    this.kitCard.append(kimg, kt);
    // loadout
    for (const [id, b] of this.kitTiles) { const on = id === p.kit; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    for (const [t, b] of this.crewBtns) { const on = t === p.crew; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    // FFA: the colour pick replaces the crew toggle
    this.crewRow.hidden = ffa;
    this.colorRow.hidden = !ffa;
    this.crewCap.textContent = ffa ? `COLOR · ${fc.label}` : 'CREW';
    for (const [id, b] of this.colorBtns) { const on = id === p.ffaColor; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    for (const [m, b] of this.modeBtns) { const on = m === p.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    if (document.activeElement !== this.nameInput) this.nameInput.value = p.name;
    this.renderStats(k);
    this.subBox.replaceChildren(...this.miniCard('SUB', sub?.name ?? '—', str(sub?.blurb), SVG['jelly-charge']));
    this.spBox.replaceChildren(...this.miniCard('SPECIAL', sp?.name ?? '—', str(sp?.blurb), SVG[sp?.id ?? ''] ?? ''));
    this.plate.replaceChildren(el('i', '', mark), el('b', '', p.name || 'YOU'), el('span', '', k.name));
    // play
    for (const [id, b] of this.mapCards) { const on = id === p.map; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    const pier = p.map === 'pier18';
    this.presetRow.hidden = !pier;
    this.lightNote.hidden = pier;
    this.lightNote.textContent = p.map === 'random' ? 'SET BY THE ARENA' : (LIGHT_TEXT[p.map] ?? '');
    for (const [id, b] of this.presetBtns) { const on = id === p.preset; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    for (const [id, b] of this.skillBtns) { const on = id === p.skill; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    this.skillNote.textContent = SKILL_TEXT[p.skill][1];
    this.playKit.replaceChildren();
    const pimg = el('img', 'kiticon');
    pimg.src = KIT_ICONS[k.id] ?? '';
    pimg.alt = '';
    pimg.draggable = false;
    const pk = el('span', 'txt');
    pk.append(el('b', '', k.name), el('span', '', `${mark} ${crewName}`));
    this.playKit.append(pimg, pk);
    // settings
    for (const [, row] of this.setCtl) (row as HTMLElement & { dfUpd?: () => void }).dfUpd?.();
    for (const q of RENDER_QUALITIES) {
      const b = this.setCtl.get(`quality:${q}`);
      if (b) { const on = s.quality === q; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    }
    this.renderKeys();
    this.renderLegend();
    for (const [e, a] of this.howKeys) e.textContent = this.keyText(a);
  }

  private chip(icon: string, text: string): HTMLElement {
    const c = el('span', 'chip');
    if (icon) c.append(svgEl(icon));
    c.append(el('span', '', text));
    return c;
  }

  private miniCard(cap: string, name: string, blurb: string, icon: string): HTMLElement[] {
    const ic = svgEl(icon, 'dfm-bigico');
    const t = el('div', 'txt');
    t.append(el('span', 'cap', cap), el('b', '', name), el('p', '', blurb));
    return [ic, t];
  }

  private renderStats(k: ReturnType<typeof kitRow>): void {
    const box = this.statsBox;
    box.replaceChildren();
    const h = el('div', 'dfm-stats-h');
    h.append(el('b', '', k.name), el('span', 'role', roleLabel(k.role)));
    box.append(h, el('p', 'blurb', str(k.blurb)));
    for (const [key, label] of STAT_ROWS) {
      const v = Math.max(0, Math.min(10, Math.round(Number(k.stats?.[key] ?? 0))));
      const row = el('div', 'dfm-stat');
      row.dataset.stat = key;
      const bar = el('div', 'bar');
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '10');
      bar.setAttribute('aria-valuenow', String(v));
      bar.setAttribute('aria-label', label);
      for (let i = 0; i < 10; i++) bar.append(el('i', i < v ? 'on' : ''));
      row.append(el('span', 'lbl', label), bar, el('span', 'val', String(v)));
      box.append(row);
    }
  }

  // ───────────────────────────── key remap ─────────────────────────────
  keyText(a: Action): string {
    const b = this.settings.get().bindings[a] ?? [];
    return b.length ? codeLabel(b[0]) : '—';
  }

  private renderKeys(): void {
    const b = this.settings.get().bindings;
    for (const [a] of REMAP) {
      for (let slot = 0; slot < 2; slot++) {
        const e = this.keyBtns.get(`${a}:${slot}`);
        if (!e) continue;
        if (this.capture && this.capture.action === a && this.capture.slot === slot) continue;
        const code = b[a]?.[slot];
        e.textContent = code ? keyCap(code) : '—';
        e.classList.toggle('empty', !code);
        e.classList.toggle('unbound', slot === 0 && !(b[a]?.length));
        e.classList.toggle('conflict', !!this.conflict && this.conflict.other === a);
        e.title = code ?? '';
      }
    }
  }

  private note(text: string, kind: '' | 'warn' | 'ok' = ''): void {
    this.bindNote.replaceChildren();
    this.bindNote.className = `dfm-bindnote ${kind}`;
    if (text) this.bindNote.append(el('span', '', text));
  }

  private beginCapture(a: Action, slot: number, b: HTMLButtonElement): void {
    this.sound('click');
    this.endCapture();
    this.conflict = null;
    this.renderKeys();
    b.textContent = 'PRESS A KEY';
    b.classList.add('listening');
    this.note('Press a key or mouse button · ESC cancels · DELETE clears', '');
    this.input.suspended = true;
    const t0 = performance.now();
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { this.endCapture(); this.note(''); this.sound('back'); return; }
      if (e.code === 'Delete' || e.code === 'Backspace') { this.assign(a, slot, null); return; }
      if (!e.code) return;
      this.assign(a, slot, e.code);
    };
    const onMouse = (e: MouseEvent): void => {
      if (performance.now() - t0 < 120) return;          // the click that opened the capture
      if (e.button > 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.assign(a, slot, `Mouse${e.button}`);
    };
    const onCtx = (e: Event): void => { e.preventDefault(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', onCtx, true);
    this.capture = {
      action: a, slot, btn: b,
      off: () => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mousedown', onMouse, true);
        // the contextmenu of a right-click binding arrives after mouseup: drop the blocker a moment later
        setTimeout(() => window.removeEventListener('contextmenu', onCtx, true), 400);
      },
    };
  }

  private endCapture(): void {
    const c = this.capture;
    if (!c) return;
    this.capture = null;
    c.off();
    c.btn.classList.remove('listening');
    // swallow the keyup of the captured key before the game's Input sees it again
    setTimeout(() => { this.input.suspended = false; this.input.releaseAll(); }, 0);
    this.renderKeys();
  }

  /** put `code` on action a / slot; a code bound elsewhere asks to SWAP first (conflict detection) */
  private assign(a: Action, slot: number, code: string | null, force = false): void {
    const c = this.capture;
    this.endCapture();
    const cur = this.settings.get().bindings;
    const next: Bindings = {} as Bindings;
    for (const k of Object.keys(cur) as Action[]) next[k] = [...cur[k]];
    const mine = next[a];
    if (code === null) {
      mine.splice(slot, 1);
      next[a] = mine;
      this.settings.set({ bindings: next });
      this.note(`${ACTION_LABEL[a] ?? a}: slot cleared`, '');
      this.sound('click');
      if (c) this.focus(c.btn, false);
      return;
    }
    let other: Action | null = null;
    for (const k of Object.keys(next) as Action[]) if (k !== a && next[k].includes(code)) { other = k; break; }
    if (other && !force) {
      this.conflict = { action: a, slot, code, other };
      this.renderKeys();
      this.bindNote.replaceChildren();
      this.bindNote.className = 'dfm-bindnote warn';
      const msg = el('span', '', `${codeLabel(code)} is already on ${ACTION_LABEL[other] ?? other}.`);
      const swap = btn('dfm-small hot', 'SWAP');
      swap.id = 'dfm-swap';
      const cancel = btn('dfm-small', 'CANCEL');
      cancel.id = 'dfm-swap-cancel';
      swap.addEventListener('click', () => { const k = this.conflict; this.conflict = null; if (k) this.assign(k.action, k.slot, k.code, true); });
      cancel.addEventListener('click', () => { this.conflict = null; this.note(''); this.renderKeys(); this.sound('back'); if (c) this.focus(c.btn, false); });
      this.bindNote.append(msg, swap, cancel);
      this.focus(swap, false);
      this.sound('hover');
      return;
    }
    const old = mine[slot] ?? null;
    if (other) {
      // SWAP: the other action takes this slot's old code where it had `code` (or just loses it)
      const i = next[other].indexOf(code);
      if (old && !next[other].includes(old)) next[other][i] = old; else next[other].splice(i, 1);
    }
    const dup = mine.indexOf(code);
    if (dup >= 0 && dup !== slot) {                         // the other slot of the same action: swap the slots
      mine[dup] = old ?? '';
    }
    if (slot < mine.length) mine[slot] = code; else mine.push(code);
    next[a] = mine.filter((x) => !!x);
    this.settings.set({ bindings: next });
    this.note(other ? `${codeLabel(code)} → ${ACTION_LABEL[a] ?? a} (swapped with ${ACTION_LABEL[other] ?? other})` : `${codeLabel(code)} → ${ACTION_LABEL[a] ?? a}`, 'ok');
    this.sound('click');
    const b = this.keyBtns.get(`${a}:${Math.min(slot, next[a].length - 1)}`) ?? c?.btn;
    if (b) this.focus(b, false);
  }

  /** the control legend on the pause card, from the live bindings */
  private renderLegend(): void {
    const b = this.settings.get().bindings;
    const k = (a: Action): string => (b[a]?.[0] ? codeLabel(b[a][0]) : '—');
    const rows: Array<[string[], string]> = [
      [[k('moveF'), k('moveL'), k('moveB'), k('moveR')], 'MOVE'],
      [['MOUSE'], 'AIM'],
      [[k('fire')], 'FIRE'],
      [[k('slick')], 'SLICK · DRINK'],
      [[k('jump')], 'JUMP'],
      [[k('sub')], 'SUB'],
      [[k('special')], 'SPECIAL'],
      [[k('pause')], 'PAUSE'],
    ];
    for (const box of [this.legendBox, this.howLegend]) {
      box.replaceChildren();
      for (const [keys, label] of rows) {
        const r = el('div', 'dfm-leg');
        const ks = el('span', 'keys');
        for (const key of keys) ks.append(el('kbd', 'dfm-kbd', key));
        r.append(ks, el('span', 'lbl', label));
        box.append(r);
      }
    }
  }

  /** [[keys…], label] rows for the countdown legend (slates) */
  legend(): Array<[string, string]> {
    const k = (a: Action): string => this.keyText(a);
    const move = ['moveF', 'moveL', 'moveB', 'moveR'].map((a) => k(a as Action)).join('');
    return [[move.length <= 4 ? move : `${k('moveF')}/${k('moveB')}`, 'move'], [k('fire'), 'fire'], [k('slick'), 'slick'], [k('jump'), 'jump']];
  }

  // ───────────────────────────── hints ─────────────────────────────
  private renderHints(): void {
    const h = this.hints;
    h.replaceChildren();
    const pad = this.padSeen;
    const pill = (key: string, label: string, icon = false): void => {
      const p = el('span', 'dfm-pill');
      if (icon) p.append(svgEl(SVG.gamepad, 'pad'));
      p.append(el('kbd', 'dfm-kbd', key), el('span', '', label));
      h.append(p);
    };
    if (pad) { pill('Ⓐ', 'SELECT', true); pill('Ⓑ', 'BACK'); }
    pill('↑↓←→', 'MOVE');
    pill('ENTER', 'SELECT');
    if (this.screen !== 'title') pill('ESC', this.screen === 'pause' ? 'RESUME' : 'BACK');
  }

  // ───────────────────────────── navigation ─────────────────────────────
  private activeEl(): HTMLElement | null {
    if (!this.confirm.hidden) return this.confirm;
    if (this.conflict) return this.bindNote;
    if (this.visible && this.screen) return this.screens.get(this.screen) ?? null;
    return this.extraScope;
  }

  private inScope(e: HTMLElement): boolean {
    const a = this.activeEl();
    return !!a && a.contains(e);
  }

  navItems(): HTMLElement[] {
    const scope = this.activeEl();
    if (!scope) return [];
    return [...scope.querySelectorAll<HTMLElement>('[data-nav], .df-btn')].filter((e) => {
      if ((e as HTMLButtonElement).disabled) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && e.closest('[hidden]') === null;
    });
  }

  focus(e: HTMLElement, sound: boolean): void {
    if (document.activeElement === e) return;
    e.focus({ preventScroll: true });
    if (sound) this.sound('hover');
  }

  /** spatial move in the active scope; wraps inside a [data-group] column */
  move(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const items = this.navItems();
    if (!items.length) return false;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !items.includes(cur)) { this.focus(items.find((e) => e.hasAttribute('data-default')) ?? items[0], true); return true; }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best: HTMLElement | null = null, bestS = Infinity;
    for (const it of items) {
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
      const s = along + across * (overlap ? 0.5 : 2.5);
      if (s < bestS) { bestS = s; best = it; }
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
      if (i.type === 'text') { if (document.activeElement === i) { this.commitName(); this.move('down'); } else i.focus(); }
      return;
    }
    cur.click();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.capture || e === this.handledEvent || e.defaultPrevented) return;
    const scope = this.activeEl();
    if (!scope) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text';
    const range = !!t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range';
    switch (e.code) {
      case 'ArrowUp': case 'ArrowDown':
        e.preventDefault();
        if (typing) this.commitName();
        this.move(e.code === 'ArrowUp' ? 'up' : 'down');
        break;
      case 'ArrowLeft': case 'ArrowRight':
        if (typing || range) return;
        e.preventDefault();
        this.move(e.code === 'ArrowLeft' ? 'left' : 'right');
        break;
      case 'Enter': case 'NumpadEnter':
        if (typing) { e.preventDefault(); this.commitName(); (t as HTMLInputElement).blur(); this.move('down'); return; }
        if (t && t.tagName === 'BUTTON' && scope.contains(t)) return;   // the native button click
        e.preventDefault();
        this.activate();
        break;
      case 'Escape':
        if (!this.visible && !(!this.confirm.hidden)) return;
        e.preventDefault();
        if (typing) { (t as HTMLInputElement).blur(); this.commitName(); return; }
        this.back();
        break;
      case 'Tab': {
        // keep Tab inside the active screen
        const items = this.navItems();
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const n = items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length];
        this.focus(n, true);
        break;
      }
      default:
        break;
    }
  }

  // ───────────────────────────── per frame: gamepad ─────────────────────────────
  update(dt: number): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) { this.pad.buttons = []; return; }
    if (!this.padSeen) { this.padSeen = true; this.renderHints(); }
    const prev = this.pad.buttons;
    const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    const pressed = (i: number): boolean => !!now[i] && !prev[i];
    this.pad.buttons = now;
    const scope = this.activeEl();
    if (!scope) {
      if (pressed(9)) this.hooks.padStart?.();
      return;
    }
    if (pressed(0)) {
      const cur = document.activeElement as HTMLElement | null;
      if (cur && cur.tagName === 'INPUT' && (cur as HTMLInputElement).type === 'range') this.move('down');
      else this.activate();
    }
    if (pressed(1)) this.back();
    if (pressed(9) && this.screen === 'pause') this.hooks.resume();
    // d-pad + left stick with key-repeat
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    let dir = '';
    if (now[12] || ay < -0.55) dir = 'up';
    else if (now[13] || ay > 0.55) dir = 'down';
    else if (now[14] || ax < -0.55) dir = 'left';
    else if (now[15] || ax > 0.55) dir = 'right';
    if (!dir) { this.pad.dir = ''; this.pad.repeatT = 0; return; }
    const fire = dir !== this.pad.dir || this.pad.repeatT <= 0;
    this.pad.repeatT = dir !== this.pad.dir ? 0.38 : (this.pad.repeatT <= 0 ? 0.12 : this.pad.repeatT - dt);
    this.pad.dir = dir;
    if (!fire) return;
    const cur = document.activeElement as HTMLElement | null;
    if ((dir === 'left' || dir === 'right') && cur && cur.tagName === 'INPUT' && (cur as HTMLInputElement).type === 'range') {
      const r = cur as HTMLInputElement;
      if (dir === 'left') r.stepDown(); else r.stepUp();
      r.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    this.move(dir as 'up' | 'down' | 'left' | 'right');
  }

  private sound(s: UiSound): void {
    try { this.hooks.sound?.(s); } catch { /* audio is optional */ }
  }

  /** harness read-back */
  readback(): Record<string, unknown> {
    const a = document.activeElement as HTMLElement | null;
    return {
      visible: this.visible, screen: this.screen, context: this.context, stack: [...this.stack],
      focus: a && this.root.contains(a) ? (a.id || a.textContent?.trim().slice(0, 40) || a.tagName) : null,
      confirm: !this.confirm.hidden, capture: this.capture ? `${this.capture.action}:${this.capture.slot}` : null,
      conflict: this.conflict ? { ...this.conflict } : null, note: this.bindNote.textContent || '',
      profile: { ...this.profile.get() }, mannequin: this.mannequin?.info() ?? null,
      modeLine: this.modeText.textContent,
      gamepad: this.padSeen,
    };
  }

  dispose(): void {
    this.endCapture();
    for (const f of this.offs) f();
    this.offs = [];
    this.bindMannequin(false);
    this.root.remove();
  }
}

// ───────────────────────────── HOW TO PLAY illustrations (inline SVG, the in-game marks + icons) ─────────────────────────────
const HOW_ART = {
  floor: `<svg viewBox="0 0 240 140" aria-hidden="true">
    <defs><clipPath id="dfh-court"><path d="M30 26h180l22 82H8z"/></clipPath></defs>
    <path d="M30 26h180l22 82H8z" fill="#e9e2d2" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/>
    <g clip-path="url(#dfh-court)">
      <path d="M-4 30c30-10 62 6 78 22s10 34 32 46 8 28-10 34H-4z" fill="var(--sun-dye)"/>
      <circle cx="96" cy="44" r="7" fill="var(--sun-dye)"/><circle cx="112" cy="84" r="5" fill="var(--sun-dye)"/>
      <path d="M244 20c-26 4-52 14-64 34s-4 36-24 50-2 30 14 34h74z" fill="var(--gulf-dye)"/>
      <circle cx="150" cy="40" r="6" fill="var(--gulf-dye)"/><circle cx="138" cy="96" r="4" fill="var(--gulf-dye)"/>
      <g stroke="rgba(20,32,58,.18)" stroke-width="1.5"><path d="M76 26l-10 82M120 26v82M164 26l10 82M19 67h202"/></g>
    </g>
    <rect x="44" y="118" width="152" height="12" rx="6" fill="#e9e2d2" stroke="#14203a" stroke-width="3"/>
    <rect x="46" y="120" width="70" height="8" rx="4" fill="var(--sun-dye)"/><rect x="138" y="120" width="56" height="8" rx="4" fill="var(--gulf-dye)"/>
    <circle cx="36" cy="124" r="10" fill="#fff8ec" stroke="#14203a" stroke-width="3"/><text x="36" y="129" text-anchor="middle" font-size="13" fill="var(--sun-dye)">◉</text>
    <circle cx="204" cy="124" r="10" fill="#fff8ec" stroke="#14203a" stroke-width="3"/><text x="204" y="128.5" text-anchor="middle" font-size="12" fill="var(--gulf-dye)">▲</text>
  </svg>`,
  slick: `<svg viewBox="0 0 240 140" aria-hidden="true">
    <path d="M6 70c24-8 44 6 70 0s46-10 74 0 52 6 84-2v68H6z" fill="var(--sun-dye)" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M18 92c20-6 40 4 60 0M90 102c22-6 40 4 62 0" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round" fill="none"/>
    <path d="M112 72c4-26 22-44 44-48-10 12-14 30-8 48z" fill="var(--sun)" stroke="#14203a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M64 70c14-6 26-6 40 0M36 72c10-5 18-5 26-1" stroke="#fff8ec" stroke-width="4" stroke-linecap="round" fill="none"/>
    <rect x="192" y="14" width="24" height="84" rx="12" fill="rgba(20,32,58,.35)" stroke="#14203a" stroke-width="4"/>
    <rect x="196" y="40" width="16" height="54" rx="8" fill="var(--sun-dye)"/>
    <path d="M204 34V20M198 26l6-6 6 6" stroke="#fff8ec" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`,
  subsp: `<svg viewBox="0 0 240 140" aria-hidden="true">
    <g transform="translate(8 16)"><circle cx="36" cy="36" r="34" fill="#22325a" stroke="#14203a" stroke-width="4"/>
      <g transform="translate(11 11) scale(2.1)" color="var(--sun)">${SVG['jelly-charge'].replace(/<\/?svg[^>]*>/g, '')}</g></g>
    <g transform="translate(84 16)"><circle cx="36" cy="36" r="34" fill="#22325a" stroke="#14203a" stroke-width="4"/>
      <g transform="translate(11 11) scale(2.1)" color="var(--sun)">${SVG.cloudburst.replace(/<\/?svg[^>]*>/g, '')}</g></g>
    <g transform="translate(160 16)"><circle cx="36" cy="36" r="34" fill="#22325a" stroke="#14203a" stroke-width="4"/>
      <g transform="translate(11 11) scale(2.1)" color="var(--sun)">${SVG.wellspring.replace(/<\/?svg[^>]*>/g, '').replace(/#14203a/g, '#fff8ec')}</g></g>
    <g font-family="Lilita One, sans-serif" font-size="13" fill="#14203a" text-anchor="middle" letter-spacing="1">
      <text x="44" y="112">JELLY</text><text x="120" y="112" font-size="11">CLOUDBURST</text><text x="196" y="112" font-size="11">WELLSPRING</text></g>
    <path d="M24 122h40M100 122h40M176 122h40" stroke="#14203a" stroke-width="3" stroke-linecap="round" opacity=".25"/>
  </svg>`,
};
