// HIT PARADE - MOVE LIST (lane UI; CONTRACT section 8, 27): per fighter, generated from data/fighters/<id>.json (`moves`,
// `simple`, `classic`, `unique`; CONTRACT 5.2 / 19.2 / 20). The picked control type (SIMPLE / CLASSIC tab) leads every row
// and the OTHER control type's input for the same move is shown under it, so both notations are always on screen.
// Sections: the fighter's UNIQUE MECHANIC card (what the mechanic does, how to use it - strings ml.how.<kind> - the
// fighter's own trait line and the moves that use it), SUPERS, SPECIALS, EX SPECIALS, ASSIST COMBO (SIMPLE), COMMAND
// NORMALS, THROWS, SYSTEM (universal verbs). Directions render as SVG arrows (numpad notation, 6 = forward), buttons as
// chips. Columns: startup, damage and the on-block advantage (blockstun - (active + recovery), SF6 convention) straight
// from the move data. CHANGED(UI) P2: a move's display name is the fighter file's `name` (FIGHTERS' source of truth),
// then strings.json `move.<fighter>.<moveId>` (the menus.py --sync-strings mirror), then the id tidied up.
// CHANGED(UI3D) (CONTRACT §35.2 / §35.12, the 3D ring): step-attacks (`input "SS.<btn>"`) render as STEP + <btn> in their own
// STEP ATTACKS section; every row carries a HOMING / LINEAR tag from the fighter data (`moves[id].homing` / `.linear`);
// HOMING NORMALS lists the fighter's homing normals (its step-catchers - normals are not listed elsewhere); SYSTEM gains
// SIDESTEP (tap STEP IN / OUT), CIRCLE WALK (hold STEP) and STEP ATTACK; a tip line says what HOMING / LINEAR mean.
// CHANGED(fix_ui_stage) (verifier modes D5): FOLLOW-UPS are listed under their parent row (indented, a ">" lead) with
// their own notation in both control types and their own HOMING / LINEAR tag: rekka parts (the parent's `cancel`
// `chain:<id>` to a `tc` move; notation = the move's `trigger` - CLASSIC motion + button, SIMPLE key; recursive, so patch
// CUE KICK > CUE 2 > CUE 3), stance follow-ups (`unique.followups` / `unique.exit` of a stance-enter move: > L / M / H / 2)
// and counter follow-ups (`counter.follow`: AUTO when the counter catches). Each follow-up once, under its first parent.
// CHANGED(ui) (CONTRACT §36.3 / §36.4 + the OWNER CLARIFICATION): three tabs EASY / SIMPLE / CLASSIC (scheme 2 / 0 / 1);
// every button chip shows the player's OWN key cap (render(..., labels): J / K / L / ; / N by default, a remap shows) instead
// of "L / M / H / S" - touch keeps the PAD's disc names; EASY rows: SPECIAL 1-4 = that key alone (the move `simple.5S /
// 6S / 2S / 4S` routes to), SUPER / PRIME TIME = their own keys, EX = COMBO key + the special key, AUTO COMBO = PUNCH again
// and again. The small line under a move is its plain-English `note` (lane NOTES, §36.4), not the designer `desc`; the
// fighter's `plan` line leads the list and the unique card reads `unique.note`. Numbers lose their "F" suffix.
// CHANGED(wf8 fix) FT-03: SYSTEM rows lead with the dedicated keys the bar / HOW TO PLAY teach (THROW = F, PARRY = R, STEP
// IN / OUT = Q / E - the player's own caps) with the chord under them as ALSO (J+K / K+L); before, the EASY tab showed only
// the chords and "IN / OUT" chips, so a new player got two answers. FT-07: a teleport kit lists its three exits (behind /
// in front / home) - EASY: the SPECIAL key alone / + toward / + away (core/sim/inputs.ts), SIMPLE / CLASSIC: the motion.

import type { Scheme, UiFighterDef, UiGameData, UiMoveDef } from './types.ts';
import { btn, chip, dirSvg, div, el } from './dom.ts';
import { has, tOr, t } from './strings.ts';
import type { Action, Labels } from './controls.ts';
import { capChip } from './keymap.ts';

/** CHANGED(ui): a notation button -> the action whose key cap it shows */
const BTN_ACTION: Readonly<Record<string, Action>> = { L: 'l', M: 'm', H: 'h', S: 's', ASSIST: 'assist', PARRY: 'parry', IMPACT: 'impact', THROW: 'throw', TAUNT: 'taunt',
  SP1: 'sp1', SP2: 'sp2', SP3: 'sp3', SP4: 'sp4', SUPER1: 'super1', SUPER3: 'super3', STEPIN: 'stepIn', STEPOUT: 'stepOut' };
/** CHANGED(ui): the chip colour of a notation button (the old chip palette: L blue, M yellow, H red, S pink, ASSIST teal) */
const BTN_KIND: Readonly<Record<string, string>> = { L: 'move', M: 'attack', H: 'prime', S: 'special', ASSIST: 'defend', SP1: 'special', SP2: 'special', SP3: 'special', SP4: 'special', SUPER1: 'super', SUPER3: 'prime',
  THROW: 'defend', PARRY: 'defend', IMPACT: 'defend', STEPIN: 'step', STEPOUT: 'step' };
/** CHANGED(ui): how chips render - the player's key caps (kbm), or the plain letters / disc names (touch / no bindings) */
let CAPS: Labels | null = null;
let TOUCH = false;
const TOUCH_NAME: Readonly<Record<string, string>> = { S: 'SP', ASSIST: 'ASSIST', SUPER1: 'SUPER', SUPER3: 'SUPER' };
function btnChip(b: string): HTMLElement {
  const a = BTN_ACTION[b];
  const cap = !TOUCH && a && CAPS ? CAPS[a]?.keys?.[0] : undefined;
  if (cap) { const c = capChip(cap, BTN_KIND[b] ?? 'system'); c.dataset.b = b.toLowerCase(); return c; }
  return chip(TOUCH ? (TOUCH_NAME[b] ?? b) : b);
}

/** CHANGED(UI3D): `step` = a STEP chip ('any' = STEP IN or OUT, 'in' / 'out' = that one) */
type Part = { d?: number; held?: number; b?: string; plus?: boolean; text?: string; step?: 'any' | 'in' | 'out' };
/** CHANGED(fix_ui_stage): `depth` 1 / 2 = a follow-up row under its parent (rekka part, stance follow-up, counter follow-up) */
interface Row { name: string; parts: Part[]; alt?: Part[]; startup?: number; damage?: number; block?: number; note?: string; id?: string; tags?: Array<'homing' | 'linear'>; depth?: number;
  /** CHANGED(wf8 fix) FT-03: the label of the `alt` line (default: the other control type's name), e.g. ALSO */
  altK?: string }

export function prettyMove(id: string, m?: UiMoveDef | null, fid = ''): string {
  if (m?.name) return m.name.toUpperCase();
  if (fid) { const k = `move.${fid}.${id}`; if (has(k)) return t(k); }
  return id.replace(/\{s\}/g, '').replace(/_(l|m|h|ex|lv\d)$/i, '').replace(/[_-]+/g, ' ').trim().toUpperCase();
}

/** "236" / "[4]6" / "5S" / "S+H+2" / "L+M" / CHANGED(UI3D) "SS.H" (a step-attack: STEP + H) -> parts */
export function parseNotation(s: string): Part[] {
  const out: Part[] = [];
  let i = 0;
  if (s.startsWith('SS.')) { out.push({ step: 'any' }, { plus: true }); i = 3; }
  const btnRe = /^(LMH|L|M|H|S|SP|ASSIST|PARRY|IMPACT|THROW|TAUNT|P|K)/i;
  while (i < s.length) {
    const c = s[i];
    if (c === '[') {
      const j = s.indexOf(']', i);
      const d = Number(s.slice(i + 1, j));
      out.push({ held: Number.isFinite(d) ? d : 4 });
      i = j + 1;
      continue;
    }
    if (c >= '1' && c <= '9') { out.push({ d: Number(c) }); i++; continue; }
    if (s.startsWith('LM', i) && !s.startsWith('LMH', i)) { out.push({ b: 'L' }, { plus: true }, { b: 'M' }); i += 2; continue; }
    if (c === '+') { out.push({ plus: true }); i++; continue; }
    if (c === ' ') { i++; continue; }
    const m = btnRe.exec(s.slice(i));
    if (m) { out.push({ b: m[1].toUpperCase() === 'SP' ? 'S' : m[1].toUpperCase() }); i += m[1].length; continue; }
    out.push({ text: c }); i++;
  }
  return out;
}

function renderParts(parts: Part[], cls = 'hpm-note'): HTMLElement {
  const box = el('span', cls);
  for (const p of parts) {
    if (p.plus) { box.append(el('span', 'plus', '+')); continue; }
    if (p.step) {
      // CHANGED(wf8 fix) FT-03: the player's own STEP keys (Q / E by default) when they are known
      const capOf = (a: Action): string | undefined => (!TOUCH && CAPS ? CAPS[a]?.keys?.[0] : undefined);
      const ci = capOf('stepIn'), co = capOf('stepOut');
      if (p.step === 'in' && ci) { box.append(capChip(ci, 'step')); continue; }
      if (p.step === 'out' && co) { box.append(capChip(co, 'step')); continue; }
      if (p.step === 'any' && ci && co) { box.append(capChip(ci, 'step'), el('span', 'slash', '/'), capChip(co, 'step')); continue; }
      box.append(chip(p.step === 'in' ? t('ml.stepIn') : p.step === 'out' ? t('ml.stepOut') : t('ml.step'), 'step'));
      continue;
    }
    if (p.text) { box.append(el('span', 'txt', p.text)); continue; }
    if (p.b) {
      if (p.b === 'LMH') { box.append(btnChip('L'), el('span', 'slash', '/'), btnChip('M'), el('span', 'slash', '/'), btnChip('H')); continue; }
      box.append(btnChip(p.b));
      continue;
    }
    const d = p.held ?? p.d ?? 5;
    const s = el('span', p.held ? 'dir held' : 'dir');
    s.innerHTML = dirSvg(d);
    box.append(s);
  }
  return box;
}

/** SIMPLE routing key ("5S", "6S", "S+H", "S+H+2") -> readable notation parts */
function simpleParts(key: string): Part[] {
  if (key === 'S+H') return [{ b: 'S' }, { plus: true }, { b: 'H' }];
  if (key === 'S+H+2') return [{ d: 2 }, { plus: true }, { b: 'S' }, { plus: true }, { b: 'H' }];
  const m = /^([1-9])S$/.exec(key);
  if (m) return m[1] === '5' ? [{ b: 'S' }] : [{ d: Number(m[1]) }, { plus: true }, { b: 'S' }];
  return parseNotation(key);
}

const family = (id: string): string => id.replace(/\{s\}/g, 'm').replace(/_(l|m|h|ex)$/i, '');

function moveRow(f: UiFighterDef, moveId: string, parts: Part[], note?: string, alt?: Part[]): Row {
  const id = f.moves?.[moveId] ? moveId : moveId.replace(/\{s\}/g, 'm');
  const m = f.moves?.[id] ?? null;
  // CHANGED(ui) (CONTRACT §36.4): the player-facing `note`, never the designer `desc`
  const pn = m?.note;
  const n = [note, typeof pn === 'string' ? pn : ''].filter(Boolean).join(' - ');
  const active = m?.active ?? 0, recovery = m?.recovery ?? 0;
  const block = m && typeof m.blockstun === 'number' && m.blockstun > 0 && m.kind !== 'throw' && m.kind !== 'cmdgrab' && m.kind !== 'super3'
    ? m.blockstun - (active + recovery) : undefined;
  const tags: Array<'homing' | 'linear'> = m?.homing ? ['homing'] : m?.linear ? ['linear'] : [];
  return { name: prettyMove(id, m, f.id), parts, alt, startup: m?.startup, damage: m?.damage, block, note: n || undefined, id, tags };
}

/** CHANGED(UI3D): a step-attack's input (`SS.<btn>`, CONTRACT §35.12.5) */
export const isStepAttack = (m: UiMoveDef | undefined): boolean => typeof m?.input === 'string' && m.input.startsWith('SS.');

/** the SIMPLE key routing to a move family (5S / 6S / 2S / 4S), if any */
function simpleKeyFor(simple: Record<string, unknown>, fam: string): string | null {
  for (const k of ['5S', '6S', '2S', '4S']) { const v = simple[k]; if (typeof v === 'string' && family(v) === fam) return k; }
  return null;
}

/** a button field ('L' / 'M' / 'H' / 'S' / 'LMH' / 'LM' ...) -> parts */
function btnParts(b: string): Part[] {
  if (!b) return [];
  if (b.length > 1 && /^[LMH]+$/.test(b)) return [{ b: 'LMH' }];
  return [{ b: b === 'SP' ? 'S' : b }];
}

/** CHANGED(fix_ui_stage): a rekka part's trigger (CONTRACT 20.2) in each control type: [SIMPLE, CLASSIC] parts */
function triggerParts(m: UiMoveDef): [Part[], Part[]] | null {
  const tr = m.trigger;
  if (tr) {
    const s = tr.simple ?? '';
    const simple = /^[LMH]+$/.test(s) ? btnParts(s) : s ? simpleParts(s) : [];
    const c = tr.classic;
    const classic = c ? [...(c.motion ? [...parseNotation(c.motion), { plus: true } as Part] : []), ...btnParts(c.btn ?? '')] : [];
    return [simple.length ? simple : classic, classic.length ? classic : simple];
  }
  // a target-combo part without a trigger: the last token of "5M>5H" fires it (CONTRACT 19.1)
  const inp = m.input ?? '';
  if (inp.includes('>')) { const last = parseNotation(inp.slice(inp.lastIndexOf('>') + 1)); return [last, last]; }
  return null;
}

/**
 * CHANGED(fix_ui_stage) (verifier modes D5): the follow-ups of a listed move, as rows to put right under it - rekka parts
 * (cancel `chain:<id>` to a `tc` move, recursive), stance follow-ups / exits of a stance-enter move, a counter's
 * automatic follow-up. `seen` keeps each follow-up to its first parent.
 */
function followRows(f: UiFighterDef, scheme: Scheme, parentId: string | undefined, seen: Set<string>, depth = 1): Row[] {
  const moves = f.moves ?? {};
  const p = parentId ? moves[parentId] : undefined;
  if (!p || !parentId || depth > 3) return [];
  const out: Row[] = [];
  const parent = prettyMove(parentId, p, f.id);
  const lead: Part = { text: '>' };
  const add = (id: string, prim: Part[], alt: Part[] | undefined, note: string): void => {
    if (seen.has(id) || !moves[id]) return;
    seen.add(id);
    const r = moveRow(f, id, [lead, ...prim], note, alt && alt.length ? [lead, ...alt] : undefined);
    r.depth = depth;
    out.push(r, ...followRows(f, scheme, id, seen, depth + 1));
  };
  // rekka / target-combo parts reachable only through this move's chain
  const whiff = (p.cancel ?? []).includes('whiff');
  for (const c of p.cancel ?? []) {
    if (!c.startsWith('chain:')) continue;
    const id = c.slice(6);
    const m = moves[id];
    if (!m || !m.tc) continue;
    const tp = triggerParts(m);
    if (!tp) continue;
    add(id, scheme !== 1 ? tp[0] : tp[1], scheme !== 1 ? tp[1] : tp[0], t(whiff ? 'ml.follow.during' : 'ml.follow.chain', { parent }));
  }
  // a stance's follow-ups (by button) and exits (by direction) under the move that enters it
  const u = f.unique;
  if (p.stance === 'enter' && u?.kind === 'stance') {
    for (const [b, id] of Object.entries(u.followups ?? {})) add(id, btnParts(b), undefined, t('ml.follow.stance', { parent }));
    for (const [k, id] of Object.entries(u.exit ?? {})) if (/^[1-9]$/.test(k)) add(id, [{ d: Number(k) }], undefined, t('ml.follow.stance', { parent }));
  }
  // a counter's automatic follow-up (it plays when the counter catches a hit)
  const cf = p.counter?.follow;
  if (cf) add(cf, [{ text: t('ml.follow.auto') }], undefined, t('ml.follow.counter', { parent }));
  return out;
}

export function buildRows(f: UiFighterDef, scheme: Scheme): Array<[string, Row[]]> {
  const secs: Array<[string, Row[]]> = [];
  const moves = f.moves ?? {};
  // CHANGED(fix_ui_stage): every listed special / EX / super brings its follow-ups right under it (each follow-up once)
  const seen = new Set<string>();
  const withFollow = (list: Row[], r: Row): void => { list.push(r, ...followRows(f, scheme, r.id, seen)); };
  const simple = (f.simple ?? {}) as Record<string, unknown>;
  const classic = f.classic ?? [];
  const ids = Object.keys(moves);
  const ofKind = (...k: string[]): string[] => ids.filter((id) => k.includes(moves[id].kind));
  const classicFor = (fam: string): { motion: string; btn: string } | null => {
    const c = classic.find((x) => family(x.move) === fam && x.btn !== 'S');
    return c ? { motion: c.motion, btn: c.btn } : null;
  };
  const cParts = (c: { motion: string; btn: string }): Part[] => [...parseNotation(c.motion), { plus: true }, ...(c.btn === 'S' ? [{ b: 'S' }] : c.btn.length > 1 ? [{ b: 'LMH' }] : [{ b: c.btn }])];

  // supers
  const sup: Row[] = [];
  const lv1 = [...parseNotation('236236'), { plus: true }, { b: 'LMH' }];
  const lv3 = [...parseNotation('214214'), { plus: true }, { b: 'LMH' }];
  if (scheme === 2) {
    // CHANGED(ui): EASY - SUPER / PRIME TIME have their own keys (CONTRACT §36.1); the SIMPLE chord under them
    if (typeof simple['S+H'] === 'string') withFollow(sup, moveRow(f, simple['S+H'] as string, [{ b: 'SUPER1' }], t('ml.lv1'), simpleParts('S+H')));
    if (typeof simple['S+H+2'] === 'string') withFollow(sup, moveRow(f, simple['S+H+2'] as string, [{ b: 'SUPER3' }], t('ml.lv3'), simpleParts('S+H+2')));
  } else if (scheme === 0) {
    if (typeof simple['S+H'] === 'string') withFollow(sup, moveRow(f, simple['S+H'] as string, simpleParts('S+H'), t('ml.lv1'), lv1));
    if (typeof simple['S+H+2'] === 'string') withFollow(sup, moveRow(f, simple['S+H+2'] as string, simpleParts('S+H+2'), t('ml.lv3'), lv3));
  } else {
    for (const id of ofKind('super1')) withFollow(sup, moveRow(f, id, lv1, t('ml.lv1'), simpleParts('S+H')));
    for (const id of ofKind('super3')) withFollow(sup, moveRow(f, id, lv3, t('ml.lv3'), simpleParts('S+H+2')));
  }
  if (sup.length) secs.push([t('ml.supers'), sup]);

  // specials + EX
  const spc: Row[] = [];
  const ex: Row[] = [];
  if (scheme === 0 || scheme === 2) {
    // CHANGED(ui): EASY = SPECIAL k's own key (the SIMPLE notation under it); SIMPLE = S + direction (CLASSIC under it)
    const SK = ['5S', '6S', '2S', '4S'];
    for (const k of SK) {
      if (typeof simple[k] !== 'string') continue;
      const c = classicFor(family(simple[k] as string));
      if (scheme === 2) withFollow(spc, moveRow(f, simple[k] as string, [{ b: `SP${SK.indexOf(k) + 1}` }], undefined, simpleParts(k)));
      else withFollow(spc, moveRow(f, simple[k] as string, simpleParts(k), undefined, c ? cParts(c) : undefined));
    }
    for (const k of SK) {
      if (typeof simple[k] !== 'string') continue;
      // CONTRACT 19.2: EX = the routed id with a trailing _l|_m|_h replaced by _ex (explicit A5S.. keys override)
      const explicit = simple[`A${k}`];
      const exId = typeof explicit === 'string' ? explicit : (simple[k] as string).replace(/_(l|m|h)$/i, '_ex');
      const c = classicFor(family(exId));
      if (!moves[exId]) continue;
      if (scheme === 2) withFollow(ex, moveRow(f, exId, [{ b: 'ASSIST' }, { plus: true }, { b: `SP${SK.indexOf(k) + 1}` }], t('ml.nerve', { n: 2 }), [{ b: 'ASSIST' }, { plus: true }, ...simpleParts(k)]));
      else withFollow(ex, moveRow(f, exId, [{ b: 'ASSIST' }, { plus: true }, ...simpleParts(k)], t('ml.nerve', { n: 2 }), c ? [...parseNotation(c.motion), { plus: true }, { b: 'S' }] : undefined));
    }
  } else {
    for (const c of classic) {
      const btnParts: Part[] = c.btn === 'S' ? [{ b: 'S' }] : c.btn.length > 1 ? [{ b: 'LMH' }] : [{ b: c.btn }];
      const sk = simpleKeyFor(simple, family(c.move));
      if (c.btn !== 'S') withFollow(spc, moveRow(f, c.move, [...parseNotation(c.motion), { plus: true }, ...btnParts], undefined, sk ? simpleParts(sk) : undefined));
      // CONTRACT 19.2: motion + S = the `{s}` -> ex id whenever it exists
      const exId = c.move.includes('{s}') ? c.move.replace('{s}', 'ex') : c.btn === 'S' ? c.move : '';
      if (exId && moves[exId]) withFollow(ex, moveRow(f, exId, [...parseNotation(c.motion), { plus: true }, { b: 'S' }], t('ml.nerve', { n: 2 }), sk ? [{ b: 'ASSIST' }, { plus: true }, ...simpleParts(sk)] : undefined));
    }
  }
  teleportExits(f, scheme, spc);                            // CHANGED(wf8 fix) FT-07
  if (spc.length) secs.push([t('ml.specials'), spc]);
  if (ex.length) secs.push([t('ml.ex'), ex]);

  // assist combo (SIMPLE: hold ASSIST + tap L; CHANGED(ui) EASY: tap LIGHT again and again - the auto-combo, CONTRACT §36.5 item 3)
  if (scheme !== 1 && Array.isArray(simple.assist) && simple.assist.length) {
    const chain = (simple.assist as unknown[]).filter((x): x is string => typeof x === 'string');
    const name = chain.map((id) => prettyMove(id, moves[id], f.id)).join(' > ');
    if (scheme === 2) secs.push([t('ml.mash'), [{ name, parts: [{ b: 'L' }, { b: 'L' }, { b: 'L' }, { b: 'L' }], note: t('ml.mash.d') }]]);
    else secs.push([t('ml.assist'), [{ name, parts: [{ b: 'ASSIST' }, { plus: true }, { b: 'L' }, { b: 'L' }, { b: 'L' }], note: t('ml.assist.d') }]]);
  }

  // CHANGED(UI3D): step-attacks (STEP + button, from a sidestep or while circling) lead the normals
  const stp = ids.filter((id) => isStepAttack(moves[id])).map((id) => moveRow(f, id, parseNotation(moves[id].input ?? ''), t('ml.stepatk.d')));
  if (stp.length) secs.push([t('ml.stepatk'), stp]);

  // command normals
  const cmd = ofKind('command').filter((id) => !isStepAttack(moves[id])).map((id) => moveRow(f, id, parseNotation(moves[id].input ?? '')));
  if (cmd.length) secs.push([t('ml.normals'), cmd]);

  // CHANGED(UI3D): the homing normals (plain 5X / 2X / j.X are not listed elsewhere) = the fighter's step-catchers
  const hom = ofKind('normal').filter((id) => moves[id].homing).map((id) => moveRow(f, id, parseNotation(moves[id].input ?? id)));
  if (hom.length) secs.push([t('ml.homingNormals'), hom]);

  // throws
  const thr = ofKind('throw', 'cmdgrab').map((id) => moveRow(f, id, parseNotation(moves[id].input ?? 'L+M')));
  if (thr.length) secs.push([t('ml.throws'), thr]);
  return secs;
}

/**
 * CHANGED(wf8 fix) FT-07: a teleport kit's IN FRONT / HOME exits as rows right under its teleport special (each once):
 * EASY - toward / away + the SPECIAL key that routes to the teleport (the sim reads the direction, core/sim/inputs.ts),
 * SIMPLE - the motion on KICK / HEAVY (motions work on L / M / H in SIMPLE), CLASSIC - its own motion + button.
 */
function teleportExits(f: UiFighterDef, scheme: Scheme, rows: Row[]): void {
  const u = f.unique as ({ kind?: string } | undefined);
  if (u?.kind !== 'teleport') return;
  const moves = f.moves ?? {};
  const simple = (f.simple ?? {}) as Record<string, unknown>;
  const SK = ['5S', '6S', '2S', '4S'];
  const k = SK.findIndex((x) => typeof simple[x] === 'string' && !!(moves[simple[x] as string] as { teleport?: unknown } | undefined)?.teleport);
  if (k < 0) return;
  const base = simple[SK[k]] as string;
  const at = rows.findIndex((r) => r.id !== undefined && family(r.id) === family(base));
  if (at < 0) return;
  const cl = (f.classic ?? []).find((c) => family(c.move) === family(base));
  const out: Row[] = [];
  for (const [to, d, btnK] of [['front', 6, 'M'], ['home', 4, 'H']] as const) {
    const id = Object.keys(moves).find((x) => { const tp = (moves[x] as { teleport?: { to?: string } }).teleport; return !!tp && tp.to === to && moves[x].kind !== 'ex' && family(x) === family(base); });
    if (!id || rows.some((r) => r.id === id)) continue;
    const motion: Part[] = cl ? [...parseNotation(cl.motion), { plus: true }, { b: btnK }] : [];
    const parts: Part[] = scheme === 2 ? [{ d }, { plus: true }, { b: `SP${k + 1}` }] : motion;
    if (!parts.length) continue;
    const r = moveRow(f, id, parts, undefined, scheme === 2 && motion.length ? motion : undefined);
    r.name = `${r.name} - ${t(`ml.tp.${to}`)}`;
    if (scheme === 2) r.altK = t('ml.classic');
    r.depth = 1;
    out.push(r);
  }
  rows.splice(at + 1, 0, ...out);
}

/** the fighter's UNIQUE MECHANIC: title, how it works (strings ml.how.<kind>), the fighter's trait, the moves that use it */
export function uniqueCard(f: UiFighterDef): { title: string; how: string; trait: string; note: string; moves: string[] } | null {
  const u = f.unique as ({ kind: string; trait?: string; note?: string } & Record<string, unknown>) | undefined;
  if (!u || !u.kind) return null;
  const trait = typeof u.trait === 'string' && u.trait ? u.trait : tOr(`trait.${f.id}`, '');
  const head = trait.includes(':') ? trait.slice(0, trait.indexOf(':')).trim() : '';
  const title = head || (u.kind === 'none' ? (f.persona ?? f.name).toUpperCase() : tOr(`ml.unique.${u.kind}`, u.kind.toUpperCase()));
  const body = trait.includes(':') ? trait.slice(trait.indexOf(':') + 1).trim() : trait;
  const lists: unknown[] = [u.moves, u.enter, u.steps, u.armored].filter(Array.isArray);
  const ids: string[] = [];
  for (const l of lists) for (const id of l as unknown[]) if (typeof id === 'string' && !ids.includes(family(id))) ids.push(family(id));
  const names = ids.slice(0, 6).map((id) => {
    const real = f.moves?.[id] ? id : Object.keys(f.moves ?? {}).find((k) => family(k) === id) ?? id;
    return prettyMove(real, f.moves?.[real] ?? null, f.id);
  });
  return { title, how: tOr(`ml.how.${u.kind}`, ''), trait: body, note: typeof u.note === 'string' ? u.note : '', moves: [...new Set(names)] };
}

/**
 * The SYSTEM verbs. CHANGED(wf8 fix) FT-03: THROW / PARRY rows lead with the dedicated THROW / PARRY keys (F / R by default,
 * every scheme - the keys the bar and HOW TO PLAY teach) and show the chord under them as ALSO, when those keys are bound
 * (`CAPS`, set by render()); without them (touch, an unbound key) the chord leads as before.
 */
export function systemRows(): Row[] {
  const P = parseNotation;
  const also = t('ml.also');
  const own = (a: Action): boolean => !TOUCH && !!CAPS?.[a]?.keys?.length;
  const sysRow = (name: string, a: 'throw' | 'parry', chord: Part[], note: string, tail: Part[] = []): Row => own(a)
    ? { name, parts: [{ b: a === 'throw' ? 'THROW' : 'PARRY' }, ...tail], alt: [...chord, ...tail], altK: also, note }
    : { name, parts: [...chord, ...tail], note };
  return [
    sysRow(t('ml.sys.throw'), 'throw', P('L+M'), t('ml.sys.throw.d')),
    sysRow(t('ml.sys.tech'), 'throw', P('L+M'), t('ml.sys.tech.d')),
    sysRow(t('ml.sys.parry'), 'parry', P('M+H'), t('ml.sys.parry.d')),
    sysRow(t('ml.sys.perfect'), 'parry', P('M+H'), t('ml.sys.perfect.d')),
    sysRow(t('ml.sys.rush'), 'parry', P('M+H'), t('ml.sys.rush.d'), [{ text: '>' }, ...P('66')]),
    { name: t('ml.sys.impact'), parts: [{ b: 'IMPACT' }], note: t('ml.sys.impact.d') },
    sysRow(t('ml.sys.shove'), 'parry', P('M+H'), t('ml.sys.shove.d')),
    { name: t('ml.sys.dash'), parts: [...P('66'), { text: '/' }, ...P('44')], note: t('ml.sys.dash.d') },
    // CHANGED(UI3D) (CONTRACT §35.2): the ring verbs
    { name: t('ml.sys.sidestep'), parts: [{ step: 'in' }, { text: '/' }, { step: 'out' }], note: t('ml.sys.sidestep.d') },
    { name: t('ml.sys.circle'), parts: [{ text: t('ml.hold') }, { step: 'in' }, { text: '/' }, { step: 'out' }], note: t('ml.sys.circle.d') },
    { name: t('ml.sys.stepatk'), parts: [{ step: 'any' }, { text: '>' }, { b: 'LMH' }], note: t('ml.sys.stepatk.d') },
  ];
}

/** the MOVE LIST panel; returns its root + a re-render hook (fighter / scheme changes) */
export class MoveList {
  readonly root: HTMLElement;
  private readonly data: UiGameData;
  private readonly head: HTMLElement;
  private readonly plan: HTMLElement;
  private readonly body: HTMLElement;
  /** CHANGED(ui): EASY / SIMPLE / CLASSIC (scheme 2 / 0 / 1) */
  private readonly tabs: Map<Scheme, HTMLButtonElement> = new Map();
  fighterId = '';
  scheme: Scheme = 2;
  private labels: Labels | null = null;
  private touch = false;

  constructor(host: HTMLElement, data: UiGameData, onTab?: () => void) {
    this.data = data;
    this.root = div('hpm-movelist', host);
    const top = div('hpm-ml-top', this.root);
    const nm = div('hpm-ml-head', top);
    this.head = el('h3', 'hpm-ml-name', '');
    // CHANGED(ui) (CONTRACT §36.4): the fighter's plan line under the name
    this.plan = el('p', 'hpm-ml-plan', '');
    nm.append(this.head, this.plan);
    const tabBox = el('div', 'hpm-seg hpm-ml-tabs');
    const mk = (s: Scheme, id: string, label: string): void => {
      const b = btn('hpm-segbtn', label);
      b.id = `hpm-ml-${id}`;
      b.addEventListener('click', () => { this.render(this.fighterId, s, this.labels, this.touch); onTab?.(); });
      tabBox.append(b);
      this.tabs.set(s, b);
    };
    mk(2, 'easy', t('ml.easy'));
    mk(0, 'simple', t('ml.simple'));
    mk(1, 'classic', t('ml.classic'));
    top.append(tabBox);
    this.body = div('hpm-ml-body', this.root);
    this.body.tabIndex = -1;
  }

  /** CHANGED(ui): `labels` = the player's live key caps (chips show them); `touch` = the PAD's disc names */
  render(fighterId: string, scheme: Scheme, labels: Labels | null = this.labels, touch = this.touch): void {
    this.fighterId = fighterId;
    this.scheme = scheme;
    this.labels = labels;
    this.touch = touch;
    CAPS = labels;
    TOUCH = touch;
    const f = this.data.fighters[fighterId] ?? null;
    this.head.textContent = f?.name ?? fighterId.toUpperCase();
    const plan = typeof f?.plan === 'string' ? f.plan : '';
    this.plan.textContent = plan ? `${t('ml.plan')}: ${plan}` : '';
    for (const [s, b] of this.tabs) { const on = s === scheme; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    this.root.dataset.scheme = String(scheme);
    this.body.replaceChildren();
    const secs = f ? buildRows(f, scheme) : [];
    if (!secs.length) this.body.append(el('p', 'hpm-ml-empty', t('ml.noData')));
    // the fighter's unique mechanic leads the list
    const u = f ? uniqueCard(f) : null;
    if (u) {
      const card = div('hpm-ml-unique', this.body);
      card.append(el('span', 'kick', t('ml.unique')), el('b', 'tt', u.title));
      // CHANGED(ui) (CONTRACT §36.4): the plain unique note first; the designer trait line only when there is no note
      if (u.note) card.append(el('p', 'trait', u.note));
      else if (u.trait) card.append(el('p', 'trait', u.trait));
      if (u.how) card.append(el('p', 'how', u.how));
      if (u.moves.length) { const mv = div('mv', card); mv.append(el('span', 'k', t('ml.unique.moves'))); for (const n of u.moves) mv.append(el('span', 'tag', n)); }
    }
    if (secs.length) this.body.append(el('p', 'hpm-ml-tip', scheme === 2 ? t('ml.easyTip') : scheme === 0 ? t('ml.simpleDmg') : t('ml.classicTip')));
    // CHANGED(UI3D): what the HOMING / LINEAR tags mean (CONTRACT §35.4)
    if (secs.length) {
      const tip = el('p', 'hpm-ml-tip ring');
      tip.append(el('span', 'hpm-ml-tag homing', t('ml.tag.homing')), document.createTextNode(` ${t('ml.tip.homing')} `),
        el('span', 'hpm-ml-tag linear', t('ml.tag.linear')), document.createTextNode(` ${t('ml.tip.linear')}`));
      this.body.append(tip);
    }
    secs.push([t('ml.system'), systemRows()]);
    const colHead = (): HTMLElement => {
      const h = div('hpm-ml-row head', this.body);
      h.append(el('span', 'nm', ''), el('span', 'in', scheme === 2 ? t('ml.easy') : scheme === 0 ? t('ml.simple') : t('ml.classic')), el('span', 'fd', t('ml.col.startup')), el('span', 'fd', t('ml.col.dmg')), el('span', 'fd', t('ml.col.block')));
      return h;
    };
    let first = true;
    for (const [title, rows] of secs) {
      const sec = div('hpm-ml-sec', this.body);
      sec.append(el('h4', 'hpm-cap', title));
      if (first) { sec.append(colHead()); first = false; }
      for (const r of rows) {
        // CHANGED(fix_ui_stage): a follow-up row sits indented under its parent (`data-follow` = its depth)
        const row = div(`hpm-ml-row${r.depth ? ` sub d${Math.min(3, r.depth)}` : ''}`, sec);
        if (r.id) row.dataset.move = r.id;
        if (r.depth) row.dataset.follow = String(r.depth);
        const nm = el('div', 'nm');
        const nb = el('b', '', r.name);
        // CHANGED(UI3D): HOMING / LINEAR tag from the fighter data
        for (const tg of r.tags ?? []) nb.append(el('span', `hpm-ml-tag ${tg}`, t(`ml.tag.${tg}`)));
        if (r.tags?.length) row.dataset.track = r.tags[0];
        nm.append(nb);
        if (r.note) nm.append(el('span', 'note', r.note));
        const inp = el('div', 'in');
        inp.append(renderParts(r.parts));
        if (r.alt) { const a = el('span', 'alt'); a.append(el('span', 'k', r.altK ?? (scheme === 1 ? t('ml.simple') : scheme === 2 ? t('ml.simple') : t('ml.classic'))), renderParts(r.alt, 'hpm-note small')); inp.append(a); }
        row.append(nm, inp);
        // CHANGED(ui): plain numbers (no "F" suffix on player screens)
        row.append(el('span', 'fd', typeof r.startup === 'number' ? String(r.startup) : ''), el('span', 'fd', typeof r.damage === 'number' ? String(r.damage) : ''));
        const b = el('span', `fd adv${typeof r.block === 'number' ? (r.block > 0 ? ' plus' : r.block < 0 ? ' minus' : '') : ''}`, typeof r.block === 'number' ? (r.block > 0 ? `+${r.block}` : String(r.block)) : '');
        row.append(b);
      }
    }
  }
}
