// HIT PARADE - the controls MODEL (lane UI; CONTRACT §36.2 / §36.3 / §36.4 + the §36.4 OWNER CLARIFICATION). DOM-free.
//
// One place that answers "which key does what, in plain words" for every surface that teaches the controls: the in-game
// CONTROLS BAR (ui/controlsbar.ts), the drawn KEYBOARD MAP (ui/keymap.ts: HOW TO PLAY, CHARACTER SELECT, PAUSE > CONTROLS,
// SETTINGS > CONTROLS, the bar's expanded view), the MOVE LIST (ui/movelist.ts) and the touch cheat sheet.
//   * key caps come from the LIVE bindings (input.ts bindingLabels / keyMap over settings.controls[p]) - a remap shows;
//   * labels are ONE or TWO plain fighting words (owner: "k is kick, or n is punch"): MOVE, JUMP, PUNCH, KICK, HEAVY, the
//     fighter's own special names (short), SUPER, PRIME TIME, BLOCK, THROW, PARRY, IMPACT, STEP - never "L / M / H", "5S",
//     "assist" or "frame" (strings.json kw.*);
//   * with a fighter, LIGHT / MEDIUM / HEAVY read the fighter's own normal names (LEAD JAB, CROSS, HAYMAKER - the contract's
//     "per fighter you may use the move's own short name"), SPECIAL 1-4 the moves `simple.5S / 6S / 2S / 4S` route to
//     (EASY U / I / O / P route exactly as SIMPLE 5S / 6S / 2S / 4S, CONTRACT §36.5 item 2), SUPER / PRIME TIME the
//     `simple.S+H` / `S+H+2` moves; the move's `note` (lane NOTES, §36.4) is secondary detail only.

import { ACTIONS as IN_ACTIONS, bindingLabels, codeLabel, defaultKeys, defaultPad, keyMap, type Action, type BindingLabel, type KeyBindings, type PadBindings } from '../input.ts';
import type { UiFighterDef, UiMoveDef } from './types.ts';
import { t, tOr } from './strings.ts';

export type { Action, BindingLabel };
export type Labels = Record<Action, BindingLabel>;
export type SchemeN = 0 | 1 | 2;

/** every input.ts action, in input.ts order */
export const ALL_ACTIONS: readonly Action[] = IN_ACTIONS;

/** the colour family of an action (keyboard map + bar cells) */
export type KeyKind = 'move' | 'attack' | 'special' | 'super' | 'prime' | 'defend' | 'step' | 'system';
export function kindOf(a: Action): KeyKind {
  switch (a) {
    case 'left': case 'right': case 'up': case 'down': return 'move';
    case 'stepIn': case 'stepOut': return 'step';
    case 'l': case 'm': case 'h': return 'attack';
    case 's': case 'sp1': case 'sp2': case 'sp3': case 'sp4': case 'assist': return 'special';
    case 'super1': return 'super';
    case 'super3': return 'prime';
    case 'blockHold': case 'throw': case 'parry': case 'impact': return 'defend';
    default: return 'system';
  }
}

// ─────────────────────────── fighter words ───────────────────────────
/** words a shortened special name must not collapse to (they are action words of their own) */
const CLASH = new Set(['BLOCK', 'SPECIAL', 'SUPER', 'THROW', 'PARRY', 'JUMP', 'STEP', 'IMPACT', 'MOVE', 'PRIME']);
const STOP = new Set(['THE', 'OF', 'A', 'AN', 'IN', 'ON', 'HERE', 'YEAR', 'UP', 'TO']);
/** CHANGED(wf8 fix) FT-08 / WF8G-5: last words that say nothing on their own, or collide with the KICK / PUNCH keys
 *  (BICYCLE KICK -> KICK sat next to K = KICK; CLEAVER DROP -> DROP; COMMERCIAL BREAK -> BREAK) */
const GENERIC = new Set(['KICK', 'PUNCH', 'DROP', 'BREAK']);

/**
 * A move name short enough for a key cap / bar cell: kept whole up to `max` characters, else its last word (>= 4 letters,
 * not an action word, not a GENERIC word), else its first meaningful word (a possessive loses its 'S), else its longest.
 * HEADLINE HOOK -> HOOK, DOUBLE-DOOR LARIAT -> LARIAT, CLEAVER DROP -> CLEAVER, BICYCLE KICK -> BICYCLE, BUTCHER'S BLOCK ->
 * BUTCHER, BATTLE OF THE YEAR -> BATTLE. The full name stays in titles / the move list. CHANGED(wf8 fix): GENERIC + 's.
 */
export function shortName(name: string, max = 11): string {
  const n = name.toUpperCase().replace(/\s+/g, ' ').trim();
  if (n.length <= max) return n;
  const words = n.split(' ');
  const last = words[words.length - 1];
  if (last.length >= 4 && last.length <= max && !CLASH.has(last) && !STOP.has(last) && !GENERIC.has(last)) return last;
  const keep = words.filter((w) => !CLASH.has(w) && !STOP.has(w) && !GENERIC.has(w));
  const first = keep[0]?.replace(/'S$/, '');
  if (first && first.length >= 4 && first.length <= max) return first;
  const best = words.filter((w) => !CLASH.has(w) && !STOP.has(w)).sort((a, b) => b.length - a.length)[0];
  return (best ?? last).slice(0, max);
}

const moveOf = (f: UiFighterDef | null | undefined, id: unknown): { id: string; m: UiMoveDef } | null => {
  if (!f || typeof id !== 'string' || !id) return null;
  const real = f.moves?.[id] ? id : id.replace(/\{s\}/g, 'm');
  const m = f.moves?.[real];
  return m ? { id: real, m } : null;
};
const nameOf = (id: string, m: UiMoveDef): string => (m.name ? m.name.toUpperCase() : id.replace(/_(l|m|h|ex)$/i, '').replace(/[_-]+/g, ' ').toUpperCase());
const noteOf = (m: UiMoveDef): string => (typeof (m as { note?: unknown }).note === 'string' ? (m as { note: string }).note : '');

/** one fighter-specific move behind an action (EASY SPECIAL 1-4, SUPER, PRIME TIME, the three normals); CHANGED(wf8 fix)
 *  FT-07: `tip` = how the key changes it (a teleport's three exits: alone / toward / away) */
export interface KitMove { action: Action; moveId: string; name: string; short: string; note: string; tip?: string }
export interface FighterKit {
  id: string; name: string; plan: string;
  /** l / m / h: the standing normals 5L / 5M / 5H */
  normals: KitMove[];
  /** sp1..sp4 = simple.5S / 6S / 2S / 4S (missing classes fall back to 5S like the sim) */
  specials: KitMove[];
  super1: KitMove | null;
  super3: KitMove | null;
  unique: { title: string; note: string } | null;
  /** EASY: tapping LIGHT again follows this route (simple.assist) */
  route: string[];
}

const SP_KEYS: ReadonlyArray<readonly [Action, string]> = [['sp1', '5S'], ['sp2', '6S'], ['sp3', '2S'], ['sp4', '4S']];

export function fighterKit(f: UiFighterDef | null | undefined): FighterKit | null {
  if (!f) return null;
  const simple = (f.simple ?? {}) as Record<string, unknown>;
  const mk = (action: Action, id: unknown, maxShort = 11): KitMove | null => {
    const x = moveOf(f, id);
    if (!x) return null;
    const name = nameOf(x.id, x.m);
    return { action, moveId: x.id, name, short: shortName(name, maxShort), note: noteOf(x.m) };
  };
  const normals: KitMove[] = [];
  for (const [a, k] of [['l', '5L'], ['m', '5M'], ['h', '5H']] as const) {
    let id: string | null = f.moves?.[k] ? k : null;
    if (!id) for (const [mid, m] of Object.entries(f.moves ?? {})) if (m.input === k && m.kind === 'normal') { id = mid; break; }
    const km = mk(a, id);
    if (km) normals.push(km);
  }
  const specials: KitMove[] = [];
  const u = f.unique as ({ kind?: string; trait?: string; note?: string } | undefined);
  for (const [a, k] of SP_KEYS) {
    const km = mk(a, typeof simple[k] === 'string' ? simple[k] : simple['5S']);
    if (!km) continue;
    // CHANGED(wf8 fix) FT-07: a teleport on a SPECIAL key takes its exit from the held direction (core/sim/inputs.ts)
    if (u?.kind === 'teleport' && (f.moves?.[km.moveId] as { teleport?: unknown } | undefined)?.teleport) km.tip = t('ml.tp.tip');
    specials.push(km);
  }
  let unique: FighterKit['unique'] = null;
  if (u && u.kind) {
    const trait = typeof u.trait === 'string' ? u.trait : '';
    const head = trait.includes(':') ? trait.slice(0, trait.indexOf(':')).trim() : '';
    const title = head || (u.kind === 'none' ? (f.persona ?? f.name).toUpperCase() : tOr(`ml.unique.${u.kind}`, u.kind.toUpperCase()));
    unique = { title, note: typeof u.note === 'string' ? u.note : '' };
  }
  const plan = typeof (f as { plan?: unknown }).plan === 'string' ? (f as { plan: string }).plan : '';
  const route = Array.isArray(simple.assist) ? (simple.assist as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return {
    id: f.id, name: f.name, plan, normals, specials,
    super1: mk('super1', simple['S+H']), super3: mk('super3', simple['S+H+2']), unique, route,
  };
}

/**
 * The one- or two-word label of an action (CONTRACT §36.4 clarification). `f` = the fighter on screen (its own move names
 * on LIGHT / MEDIUM / HEAVY and SPECIAL 1-4); `ctx` 'bar' = the in-game bar's shortest form, 'key' = a key cap label.
 */
export function actionWord(a: Action, kit?: FighterKit | null, ctx: 'bar' | 'key' | 'list' = 'list', scheme: SchemeN = 2): string {
  const own = kit ? [...kit.normals, ...kit.specials].find((k) => k.action === a) : undefined;
  if (own) return ctx === 'list' ? own.name : own.short;
  switch (a) {
    case 'left': case 'right': return t('kw.move');
    case 'up': return t('kw.jump');
    case 'down': return t('kw.crouch');
    case 'l': return t('kw.punch');
    case 'm': return t('kw.kick');
    case 'h': return t('kw.heavy');
    case 's': return scheme === 1 ? t('kw.exSpecial') : t('kw.special');
    case 'assist': return scheme === 2 ? t('kw.ex') : t('kw.combo');   // CHANGED(wf8 fix) FT-04: EASY's N = hold for EX
    case 'sp1': case 'sp2': case 'sp3': case 'sp4': return t('kw.spN', { n: Number(a.slice(2)) });
    case 'super1': return t('kw.super');
    case 'super3': return t('kw.prime');
    case 'blockHold': return t('kw.block');
    case 'throw': return t('kw.throw');
    case 'parry': return t('kw.parry');
    case 'impact': return t('kw.impact');
    case 'taunt': return t('kw.taunt');
    case 'stepIn': return ctx === 'bar' ? t('kw.step') : t('kw.stepIn');
    case 'stepOut': return ctx === 'bar' ? t('kw.step') : t('kw.stepOut');
    case 'pause': return t('kw.pause');
    case 'controls': return t('kw.controls');
    default: return String(a).toUpperCase();
  }
}

/** the SETTINGS row name of an action (generic, no fighter): PUNCH / SPECIAL 1 / BLOCK (HOLD) ... */
export function settingsName(a: Action, scheme: SchemeN): string {
  if (a === 'blockHold') return t('kw.blockHold');
  if (a === 'left') return t('kw.left');
  if (a === 'right') return t('kw.right');
  if (a === 'controls') return t('kw.controlsBar');
  if (a === 'assist' && scheme === 2) return t('kw.exHold');   // CHANGED(wf8 fix) FT-04
  return actionWord(a, null, 'list', scheme);
}

// ─────────────────────────── bindings ───────────────────────────
/** a player's controls as the settings store keeps them (UiSettings.controls[p], structurally) */
export interface ControlsLike { scheme?: number; keys?: Partial<Record<string, string[]>>; pad?: Partial<Record<string, number[]>> }

/** the full key / pad map of a player: the saved one over the defaults (an action a save does not name keeps its default) */
export function keysOf(c: ControlsLike | null | undefined, p: 0 | 1): KeyBindings {
  const d = defaultKeys(p);
  if (!c || !c.keys) return d;
  const out = { ...d } as KeyBindings;
  for (const a of IN_ACTIONS) { const v = c.keys[a]; if (Array.isArray(v)) out[a] = v.filter((x) => typeof x === 'string'); }
  return out;
}
export function padOf(c: ControlsLike | null | undefined): PadBindings {
  const d = defaultPad();
  if (!c || !c.pad) return d;
  const out = { ...d } as PadBindings;
  for (const a of IN_ACTIONS) { const v = c.pad[a]; if (Array.isArray(v)) out[a] = v.filter((x) => typeof x === 'number'); }
  return out;
}
export function labelsOf(c: ControlsLike | null | undefined, p: 0 | 1): Labels { return bindingLabels(keysOf(c, p), padOf(c)); }
export function codeMapOf(c: ControlsLike | null | undefined, p: 0 | 1): Record<string, Action[]> { return keyMap(keysOf(c, p)); }

/** a key cap for the bar / lists: arrows read as glyph names, numpad keys keep their NUM prefix (rendered small) */
export function capText(code: string): string { return codeLabel(code); }

// ─────────────────────────── the in-game bar ───────────────────────────
/** one bar cell: the keys (caps + codes), the word, its colour family; `actions` = what it stands for. CHANGED(wf8 fix)
 *  FT-01: `plus` = a second key + word in the same cell ("SHIFT BLOCK + S LOW") */
export interface BarCell { id: string; actions: Action[]; codes: string[]; caps: string[]; word: string; kind: KeyKind; title?: string; plus?: { caps: string[]; word: string } }

/**
 * The two rows of the CONTROLS BAR for a player (CONTRACT §36.2): row 1 = attacks (EASY: the three normals, SPECIAL 1-4
 * with the fighter's names, SUPER, PRIME TIME; SIMPLE / CLASSIC: the normals, SPECIAL, COMBO, SUPER, PRIME TIME), row 2 =
 * MOVE, JUMP, STEP, BLOCK, THROW, PARRY, IMPACT. A cell whose action has no key is left out (P2's default map has no
 * SPECIAL 1-4 / SUPER keys).
 */
export function barRows(labels: Labels, scheme: SchemeN, kit: FighterKit | null): [BarCell[], BarCell[]] {
  const cell = (id: string, actions: Action[], word: string, kind: KeyKind, max = 1, title?: string): BarCell | null => {
    const codes: string[] = [];
    for (const a of actions) for (const c of (labels[a]?.codes ?? []).slice(0, max)) if (!codes.includes(c)) codes.push(c);
    if (!codes.length) return null;
    return { id, actions, codes, caps: codes.map(capText), word, kind, title };
  };
  const one = (a: Action, kind: KeyKind = kindOf(a)): BarCell | null => {
    const own = kit ? [...kit.normals, ...kit.specials].find((k) => k.action === a) : undefined;
    return cell(a, [a], actionWord(a, kit, 'bar', scheme), kind, 1, own?.name);
  };
  const r1: Array<BarCell | null> = [one('l'), one('m'), one('h')];
  if (scheme === 2) {
    r1.push(one('sp1'), one('sp2'), one('sp3'), one('sp4'));
    // CHANGED(wf8 fix) FT-04: EASY's N = hold it with a special = the EX version (2 NERVE bars); lit when affordable
    const ex = cell('ex', ['assist'], t('kw.ex'), 'special', 1);
    if (ex) { ex.title = t('cbar.ex.t', { key: ex.caps[0] ?? '' }); r1.push(ex); }
  } else r1.push(one('s'), one('assist'));
  // CHANGED(wf8 fix) FT-07: a key whose special changes with a direction says how in its tooltip
  for (const c of r1) { const km = kit?.specials.find((k) => k.action === c?.id); if (c && km?.tip) c.title = `${km.name}. ${km.tip}`; }
  r1.push(cell('super1', ['super1'], t('kw.super'), 'super', 1, kit?.super1?.name), cell('super3', ['super3'], t('kw.prime'), 'prime', 1, kit?.super3?.name));
  // CHANGED(wf8 fix) FT-01: BLOCK carries its low half - "SHIFT BLOCK + S LOW" (a held BLOCK alone stays standing: lows hit)
  const block = cell('block', ['blockHold'], t('kw.block'), 'defend');
  const low = labels.down?.codes?.[0];
  if (block && low) { block.plus = { caps: [capText(low)], word: t('kw.low') }; block.title = t('cbar.block.t', { block: block.caps[0] ?? '', down: capText(low) }); }
  const r2: Array<BarCell | null> = [
    cell('move', ['left', 'right'], t('kw.move'), 'move'),
    cell('jump', ['up'], t('kw.jump'), 'move', 1),
    cell('step', ['stepIn', 'stepOut'], t('kw.step'), 'step'),
    block,
    cell('throw', ['throw'], t('kw.throw'), 'defend'),
    cell('parry', ['parry'], t('kw.parry'), 'defend'),
    cell('impact', ['impact'], t('kw.impact'), 'defend'),
  ];
  return [r1.filter((x): x is BarCell => !!x), r2.filter((x): x is BarCell => !!x)];
}

// ─────────────────────────── keyboard geometry (ui/keymap.ts draws it) ───────────────────────────
/** a key on the drawn keyboard: code, x / y / w in key units, the block it belongs to */
export interface KeyGeo { code: string; x: number; y: number; w: number; h: number; block: 'fn' | 'num' | 'main' | 'nav' | 'pad'; cap?: string }

function row(block: KeyGeo['block'], y: number, x0: number, keys: ReadonlyArray<string | readonly [string, number]>): KeyGeo[] {
  const out: KeyGeo[] = [];
  let x = x0;
  for (const k of keys) {
    const [code, w] = typeof k === 'string' ? [k, 1] : k;
    if (code) out.push({ code, x, y, w, h: 1, block });
    x += w;
  }
  return out;
}

/** the ANSI keyboard: function strip (Esc, F1-F4), number row, the three letter rows, the space row, arrows, numpad */
export const KEYBOARD: readonly KeyGeo[] = [
  ...row('fn', 0, 0, ['Escape', ['', 0.5], 'F1', 'F2', 'F3', 'F4']),
  ...row('num', 1, 0, ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', ['Backspace', 2]]),
  ...row('main', 2, 0, [['Tab', 1.5], 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', ['Backslash', 1.5]]),
  ...row('main', 3, 0, [['CapsLock', 1.75], 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', ['Enter', 2.25]]),
  ...row('main', 4, 0, [['ShiftLeft', 2.25], 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', ['ShiftRight', 2.75]]),
  ...row('main', 5, 0, [['ControlLeft', 1.5], ['MetaLeft', 1.25], ['AltLeft', 1.25], ['Space', 6.25], ['AltRight', 1.25], ['ControlRight', 1.5]]),
  // arrows (an inverted T) and the numpad sit right of the main block
  { code: 'ArrowUp', x: 16.25, y: 4, w: 1, h: 1, block: 'nav' },
  { code: 'ArrowLeft', x: 15.25, y: 5, w: 1, h: 1, block: 'nav' },
  { code: 'ArrowDown', x: 16.25, y: 5, w: 1, h: 1, block: 'nav' },
  { code: 'ArrowRight', x: 17.25, y: 5, w: 1, h: 1, block: 'nav' },
  ...row('pad', 1, 18.75, ['NumLock', 'NumpadDivide', 'NumpadMultiply', 'NumpadSubtract']),
  ...row('pad', 2, 18.75, ['Numpad7', 'Numpad8', 'Numpad9']),
  ...row('pad', 3, 18.75, ['Numpad4', 'Numpad5', 'Numpad6']),
  ...row('pad', 4, 18.75, ['Numpad1', 'Numpad2', 'Numpad3']),
  { code: 'NumpadAdd', x: 21.75, y: 2, w: 1, h: 2, block: 'pad' },
  { code: 'NumpadEnter', x: 21.75, y: 4, w: 1, h: 2, block: 'pad' },
  { code: 'Numpad0', x: 18.75, y: 5, w: 2, h: 1, block: 'pad' },
  { code: 'NumpadDecimal', x: 20.75, y: 5, w: 1, h: 1, block: 'pad' },
];
const GEO = new Map(KEYBOARD.map((k) => [k.code, k]));
export function keyGeo(code: string): KeyGeo | null { return GEO.get(code) ?? null; }

/** keycap text on the drawn keyboard (short: the key is small) */
export function boardCap(code: string): string {
  const special: Record<string, string> = {
    Escape: 'ESC', Tab: 'TAB', CapsLock: 'CAPS', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', ControlRight: 'CTRL',
    MetaLeft: 'WIN', AltLeft: 'ALT', AltRight: 'ALT', Space: 'SPACE', Enter: 'ENTER', Backspace: 'BKSP', Backslash: '\\', NumLock: 'NUM',
    NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+', NumpadEnter: 'ENT', NumpadDecimal: '.',
    ArrowUp: 'UP', ArrowDown: 'DN', ArrowLeft: 'LT', ArrowRight: 'RT',
  };
  if (special[code]) return special[code];
  const m = /^Numpad(\d)$/.exec(code);
  if (m) return m[1];
  return codeLabel(code);
}

/**
 * Which part of the keyboard to draw for a set of bound codes: every block that holds one of them; the main block cropped
 * on the right just past its last bound key (its left edge - Tab / Caps / Shift - always stays: Shift is BLOCK). Function
 * and number rows only when they hold a bound key. `only` (CHARACTER SELECT's attack-hand map) draws just those codes at
 * their real positions, cropped to their box.
 */
export function boardKeys(bound: ReadonlySet<string>, only?: ReadonlySet<string> | null): KeyGeo[] {
  if (only) {
    const ks = KEYBOARD.filter((k) => only.has(k.code));
    if (!ks.length) return [];
    const x0 = Math.min(...ks.map((k) => k.x)), y0 = Math.min(...ks.map((k) => k.y));
    return ks.map((k) => ({ ...k, x: k.x - x0, y: k.y - y0 }));
  }
  const has = (b: KeyGeo['block']): boolean => KEYBOARD.some((k) => k.block === b && bound.has(k.code));
  const blocks = new Set<KeyGeo['block']>();
  if (has('main') || has('fn') || has('num')) blocks.add('main');
  if (has('fn')) blocks.add('fn');
  if (has('num')) blocks.add('num');
  if (has('nav')) blocks.add('nav');
  if (has('pad')) blocks.add('pad');
  let ks = KEYBOARD.filter((k) => blocks.has(k.block));
  // crop the main block (+ fn / num rows) right after the last bound column
  if (blocks.has('main')) {
    const mainish = (k: KeyGeo): boolean => k.block === 'main' || k.block === 'fn' || k.block === 'num';
    const right = Math.max(...KEYBOARD.filter((k) => mainish(k) && bound.has(k.code)).map((k) => k.x + k.w), 6);
    ks = ks.filter((k) => !mainish(k) || k.x < right - 0.01).map((k) => (mainish(k) && k.x + k.w > right + 0.6 ? { ...k, w: Math.max(1, right - k.x) } : k));
  }
  // drop the unused top rows of the main block (fn row / number row only when bound)
  const yMin = Math.min(...ks.map((k) => k.y));
  // close the horizontal gap between blocks that are drawn
  const xs = [...new Set(ks.map((k) => k.block))];
  const out: KeyGeo[] = [];
  let shift = 0;
  let lastRight = -Infinity;
  for (const b of ['main', 'fn', 'num', 'nav', 'pad'] as const) {
    if (!xs.includes(b)) continue;
    const bk = ks.filter((k) => k.block === b);
    const bx0 = Math.min(...bk.map((k) => k.x));
    if (b === 'nav' || b === 'pad') {
      shift = Number.isFinite(lastRight) ? bx0 - (lastRight + 0.5) : bx0;
    } else shift = 0;
    for (const k of bk) out.push({ ...k, x: k.x - shift, y: k.y - yMin });
    lastRight = Math.max(lastRight, ...bk.map((k) => k.x - shift + k.w));
  }
  // an empty row (the number row when only Esc / F1 are bound above the letters) shrinks to a thin gap
  const used = new Set<number>();
  for (const k of out) for (let r = k.y; r < k.y + k.h; r++) used.add(r);
  const maxR = Math.max(0, ...used);
  const rowAt = new Map<number, number>();
  let acc = 0;
  for (let r = 0; r <= maxR; r++) {
    if (used.has(r)) { rowAt.set(r, acc); acc += 1; } else if (acc > 0) acc += 0.25;
  }
  return out.map((k) => ({ ...k, y: rowAt.get(k.y) ?? k.y }));
}

/** the actions of a scheme shown on the keyboard map / settings list (input.ts schemeActions, TAUNT last). CHANGED(wf8 fix)
 *  FT-04: EASY lights N too - hold it with a special = the EX version (it was grey on every map and called COMBO) */
export function mapActions(scheme: SchemeN): Action[] {
  const core: Action[] = scheme === 2
    ? ['left', 'right', 'up', 'down', 'blockHold', 'l', 'm', 'h', 'sp1', 'sp2', 'sp3', 'sp4', 'assist', 'super1', 'super3', 'throw', 'parry', 'impact', 'stepIn', 'stepOut', 'taunt', 'pause', 'controls']
    : ['left', 'right', 'up', 'down', 'blockHold', 'l', 'm', 'h', 's', 'assist', 'super1', 'super3', 'throw', 'parry', 'impact', 'stepIn', 'stepOut', 'taunt', 'pause', 'controls', 'sp1', 'sp2', 'sp3', 'sp4'];
  return core;
}

/** the label a key carries on the map: every mapped action bound to it, in words (two actions -> "JUMP / ..." ) */
export function keyLabel(code: string, map: Record<string, Action[]>, show: ReadonlySet<Action>, kit: FighterKit | null, scheme: SchemeN): { word: string; kind: KeyKind; actions: Action[] } | null {
  const acts = (map[code] ?? []).filter((a) => show.has(a));
  if (!acts.length) return null;
  const words = [...new Set(acts.map((a) => actionWord(a, kit, 'key', scheme)))];
  return { word: words.join(' / '), kind: kindOf(acts[0]), actions: acts };
}
