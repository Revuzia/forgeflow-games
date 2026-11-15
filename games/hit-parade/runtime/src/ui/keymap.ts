// HIT PARADE - the drawn KEYBOARD MAP + the touch cheat sheet + plain move rows (lane UI; CONTRACT §36.3 / §36.4 OWNER
// CLARIFICATION: "something easy like a keyboard that shows moves / how to fight").
//
// drawKeyboard(): a keyboard drawn with its keys in their real places (ui/controls.ts KEYBOARD: function strip, number
// row, the letter rows, the space row, arrows, numpad - only the blocks holding a bound key, the main block cropped past
// its last bound key). Every key a player uses is lit in its family colour and carries ONE or TWO plain words (MOVE,
// JUMP, the fighter's own move names, SUPER, BLOCK, STEP IN ...); unused keys stay as faint outlines so the shape still
// reads as a keyboard. Key caps come from the bindings handed in (the live settings), so a remap shows at once. Sizes run
// on container-query units: one drawing serves HOW TO PLAY (wide), PAUSE / SETTINGS (a card column) and CHARACTER SELECT
// (`only` = the attack hand, cropped to its keys).
// touchSheet(): the touch version (the PAD's discs + what each does, with the fighter's names on SP + direction).
// moveRows(): the fighter's specials / supers as rows of key caps (+ direction arrows for SIMPLE / CLASSIC) and names.

import type { KeyBindings } from '../input.ts';
import { keyMap } from '../input.ts';
import { boardCap, boardKeys, capText, keyLabel, mapActions, type Action, type FighterKit, type Labels, type SchemeN } from './controls.ts';
import { dirSvg, div, el } from './dom.ts';
import { t } from './strings.ts';
import './controls.css';

export interface BoardOpts {
  keys: Readonly<KeyBindings>;
  scheme: SchemeN;
  kit?: FighterKit | null;
  /** draw only the keys bound to these actions (CHARACTER SELECT: the attack hand) */
  onlyActions?: readonly Action[] | null;
  /** extra class on the root (e.g. 'small') */
  cls?: string;
}

const ARROW: Partial<Record<Action, number>> = { left: 4, right: 6, up: 8, down: 2 };

/** the drawn keyboard; returns its root (`.hpk`) - the caller places it */
export function drawKeyboard(host: HTMLElement, o: BoardOpts): HTMLElement {
  const map = keyMap(o.keys);
  const show = new Set<Action>(o.onlyActions ?? mapActions(o.scheme));
  const bound = new Set<string>(Object.keys(map).filter((c) => (map[c] ?? []).some((a) => show.has(a))));
  const only = o.onlyActions ? bound : null;
  const geo = boardKeys(bound, only);
  const W = Math.max(1, ...geo.map((k) => k.x + k.w));
  const H = Math.max(1, ...geo.map((k) => k.y + k.h));
  const root = div(`hpk${o.cls ? ` ${o.cls}` : ''}${o.onlyActions ? ' only' : ''}`, host);
  root.style.setProperty('--cols', String(W));
  root.style.setProperty('--rows', String(H));
  root.setAttribute('role', 'img');
  const said: string[] = [];
  for (const k of geo) {
    const lab = keyLabel(k.code, map, show, o.kit ?? null, o.scheme);
    const key = div(`hpk-key${lab ? ` on k-${lab.kind}` : ''}${k.w >= 2 ? ' wide' : ''}`, root);
    key.dataset.code = k.code;
    key.style.left = `${(k.x / W) * 100}%`;
    key.style.top = `${(k.y / H) * 100}%`;
    key.style.width = `${(k.w / W) * 100}%`;
    key.style.height = `${(k.h / H) * 100}%`;
    const face = div('f', key);
    face.append(el('b', 'cap', boardCap(k.code)));
    if (lab) {
      key.dataset.actions = lab.actions.join(' ');
      const w = el('span', 'w');
      const d = lab.actions.length === 1 ? ARROW[lab.actions[0]] : undefined;
      if (d) { const ar = el('i', 'ar'); ar.innerHTML = dirSvg(d); w.append(ar); }
      w.append(document.createTextNode(lab.word));
      // the label shrinks to fit its key: the longest word sets the size (Bebas ~0.42 em per letter)
      const longest = Math.max(3, ...lab.word.split(/[\s/]+/).map((x) => x.length)) + (d ? 1.2 : 0);
      w.style.setProperty('--fit', (1.75 * k.w / longest).toFixed(3));
      face.append(w);
      key.title = `${capText(k.code)}: ${lab.word}`;
      said.push(`${capText(k.code)} ${lab.word}`);
    }
  }
  root.setAttribute('aria-label', said.join(', '));
  return root;
}

/** a key cap chip (bar cells, move rows, legends) */
const CAP_ARROW: Readonly<Record<string, number>> = { LEFT: 4, RIGHT: 6, UP: 8, DOWN: 2 };
/** a key cap chip; `compact` (the in-game bar) writes a numpad key as a tiny N + the key (NUM 7 -> N7) */
export function capChip(cap: string, kind = '', compact = false): HTMLElement {
  const m = /^NUM (.+)$/.exec(cap);
  const ar = CAP_ARROW[cap];
  const c = el('kbd', `hpk-cap${kind ? ` k-${kind}` : ''}${cap.length > 3 && !m && !ar ? ' long' : ''}`);
  if (m) { c.append(el('small', 'pre', compact ? 'N' : 'NUM'), document.createTextNode(m[1])); c.classList.add('num'); c.title = cap; }
  else if (ar) { const g = el('i', 'ar'); g.innerHTML = dirSvg(ar); c.append(g); c.classList.add('arrow'); c.setAttribute('aria-label', cap); c.title = cap; }
  else c.textContent = cap;
  return c;
}

function arrow(d: number): HTMLElement { const s = el('span', 'hpk-dir'); s.innerHTML = dirSvg(d); return s; }

/** one row of a move list in plain words: [keys] NAME (note) */
export interface PlainRow { keys: HTMLElement; name: string; short: string; note: string; kind: string; action: Action | string }

/**
 * The fighter's specials + supers as plain rows for a scheme. EASY: U / I / O / P (the player's SPECIAL 1-4 keys), H, Y.
 * SIMPLE: SPECIAL alone / with forward / down / back (the player's SPECIAL key + direction keys), SPECIAL + HEAVY (SUPER),
 * down + SPECIAL + HEAVY (PRIME TIME). CLASSIC: the same SUPER keys + "motion" rows point at the MOVE LIST. Keys from
 * `labels` (the live bindings); touch = the PAD's discs.
 */
export function moveRows(kit: FighterKit, scheme: SchemeN, labels: Labels | null, touch: boolean): PlainRow[] {
  const cap = (a: Action): HTMLElement | null => { const c = labels?.[a]?.keys?.[0]; return c ? capChip(c, a === 's' ? 'special' : a.startsWith('sp') ? 'special' : a === 'super1' ? 'super' : a === 'super3' ? 'prime' : '') : null; };
  const disc = (txt: string, cls: string): HTMLElement => el('span', `tbtn t-${cls}`, txt);
  const box = (...parts: Array<HTMLElement | null | string>): HTMLElement => {
    const k = el('span', 'hpk-keys');
    for (const p of parts) {
      if (p === null) continue;
      if (typeof p === 'string') k.append(el('span', 'plus', p));
      else k.append(p);
    }
    return k;
  };
  const dirOf: Record<string, number> = { sp1: 5, sp2: 6, sp3: 2, sp4: 4 };
  // screen-relative forward is "toward the opponent": shown as the RIGHT arrow (P1 starts on the left)
  const out: PlainRow[] = [];
  for (const s of kit.specials) {
    const d = dirOf[s.action];
    let keys: HTMLElement;
    if (touch) keys = d === 5 ? box(disc(t('touch.s'), 's')) : box(arrow(d), '+', disc(t('touch.s'), 's'));
    // EASY with that SPECIAL key bound: the key alone; otherwise (SIMPLE / CLASSIC, or a map without it) SPECIAL + direction
    else if (scheme === 2 && labels?.[s.action]?.keys?.length) keys = box(cap(s.action));
    else keys = d === 5 ? box(cap('s')) : box(arrow(d), '+', cap('s'));
    out.push({ keys, name: s.name, short: s.short, note: s.note, kind: 'special', action: s.action });
  }
  if (kit.super1) {
    const keys = touch ? box(disc(t('touch.super'), 'super'))
      : scheme === 2 || labels?.super1?.keys?.length ? box(cap('super1')) : box(cap('s'), '+', cap('h'));
    out.push({ keys, name: kit.super1.name, short: kit.super1.short, note: kit.super1.note, kind: 'super', action: 'super1' });
  }
  if (kit.super3) {
    const keys = touch ? box(arrow(2), '+', disc(t('touch.super'), 'super'))
      : scheme === 2 || labels?.super3?.keys?.length ? box(cap('super3')) : box(arrow(2), '+', cap('s'), '+', cap('h'));
    out.push({ keys, name: kit.super3.name, short: kit.super3.short, note: kit.super3.note, kind: 'prime', action: 'super3' });
  }
  return out;
}

/** the touch cheat sheet: every PAD control as its disc + what it does (fighter names on SP + direction) */
export function touchSheet(host: HTMLElement, kit: FighterKit | null): HTMLElement {
  const box = div('hpk-touch', host);
  const row = (keys: HTMLElement[], word: string, sub = ''): void => {
    const r = div('hpk-trow', box);
    const k = el('span', 'hpk-keys');
    k.append(...keys);
    const tx = el('span', 'tx');
    tx.append(el('b', '', word));
    if (sub) tx.append(el('small', '', sub));
    r.append(k, tx);
  };
  const disc = (txt: string, cls: string): HTMLElement => el('span', `tbtn t-${cls}`, txt);
  row([disc(t('how.stick'), 'stick')], t('kw.moveJump'), t('sheet.stick'));
  row([disc(t('touch.stepin'), 'stepin'), disc(t('touch.stepout'), 'stepout')], t('kw.step'), t('sheet.step'));
  const nm = (a: Action, d: string): string => kit?.normals.find((n) => n.action === a)?.short ?? d;
  row([disc(t('touch.l'), 'l')], nm('l', t('kw.punch')));
  row([disc(t('touch.m'), 'm')], nm('m', t('kw.kick')));
  row([disc(t('touch.h'), 'h')], nm('h', t('kw.heavy')));
  const sp = kit?.specials ?? [];
  const spNames = sp.map((s) => s.short);
  row([disc(t('touch.s'), 's')], t('kw.specials'), spNames.length ? t('sheet.sp', { a: spNames[0] ?? '', b: spNames[1] ?? '', c: spNames[2] ?? '', d: spNames[3] ?? '' }) : t('sheet.spGeneric'));
  row([disc(t('touch.super'), 'super')], t('kw.super'), t('sheet.super'));
  row([disc(t('touch.parry'), 'parry')], t('kw.parry'), t('sheet.parry'));
  row([disc(t('touch.throw'), 'throw')], t('kw.throw'));
  row([disc(t('touch.impact'), 'impact')], t('kw.impact'));
  row([disc(t('touch.assist'), 'assist')], t('kw.combo'), t('sheet.assist'));
  return box;
}
