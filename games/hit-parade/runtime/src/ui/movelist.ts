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

import type { Scheme, UiFighterDef, UiGameData, UiMoveDef } from './types.ts';
import { btn, chip, dirSvg, div, el } from './dom.ts';
import { has, tOr, t } from './strings.ts';

/** CHANGED(UI3D): `step` = a STEP chip ('any' = STEP IN or OUT, 'in' / 'out' = that one) */
type Part = { d?: number; held?: number; b?: string; plus?: boolean; text?: string; step?: 'any' | 'in' | 'out' };
interface Row { name: string; parts: Part[]; alt?: Part[]; startup?: number; damage?: number; block?: number; note?: string; id?: string; tags?: Array<'homing' | 'linear'> }

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
    if (p.step) { box.append(chip(p.step === 'in' ? t('ml.stepIn') : p.step === 'out' ? t('ml.stepOut') : t('ml.step'), 'step')); continue; }
    if (p.text) { box.append(el('span', 'txt', p.text)); continue; }
    if (p.b) {
      if (p.b === 'LMH') { box.append(chip('L'), el('span', 'slash', '/'), chip('M'), el('span', 'slash', '/'), chip('H')); continue; }
      box.append(chip(p.b));
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
  const desc = m?.desc;
  const n = [note, typeof desc === 'string' ? desc : ''].filter(Boolean).join(' - ');
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

export function buildRows(f: UiFighterDef, scheme: Scheme): Array<[string, Row[]]> {
  const secs: Array<[string, Row[]]> = [];
  const moves = f.moves ?? {};
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
  if (scheme === 0) {
    if (typeof simple['S+H'] === 'string') sup.push(moveRow(f, simple['S+H'] as string, simpleParts('S+H'), t('ml.lv1'), lv1));
    if (typeof simple['S+H+2'] === 'string') sup.push(moveRow(f, simple['S+H+2'] as string, simpleParts('S+H+2'), t('ml.lv3'), lv3));
  } else {
    for (const id of ofKind('super1')) sup.push(moveRow(f, id, lv1, t('ml.lv1'), simpleParts('S+H')));
    for (const id of ofKind('super3')) sup.push(moveRow(f, id, lv3, t('ml.lv3'), simpleParts('S+H+2')));
  }
  if (sup.length) secs.push([t('ml.supers'), sup]);

  // specials + EX
  const spc: Row[] = [];
  const ex: Row[] = [];
  if (scheme === 0) {
    for (const k of ['5S', '6S', '2S', '4S']) {
      if (typeof simple[k] !== 'string') continue;
      const c = classicFor(family(simple[k] as string));
      spc.push(moveRow(f, simple[k] as string, simpleParts(k), undefined, c ? cParts(c) : undefined));
    }
    for (const k of ['5S', '6S', '2S', '4S']) {
      if (typeof simple[k] !== 'string') continue;
      // CONTRACT 19.2: EX = the routed id with a trailing _l|_m|_h replaced by _ex (explicit A5S.. keys override)
      const explicit = simple[`A${k}`];
      const exId = typeof explicit === 'string' ? explicit : (simple[k] as string).replace(/_(l|m|h)$/i, '_ex');
      const c = classicFor(family(exId));
      if (moves[exId]) ex.push(moveRow(f, exId, [{ b: 'ASSIST' }, { plus: true }, ...simpleParts(k)], t('ml.nerve', { n: 2 }), c ? [...parseNotation(c.motion), { plus: true }, { b: 'S' }] : undefined));
    }
  } else {
    for (const c of classic) {
      const btnParts: Part[] = c.btn === 'S' ? [{ b: 'S' }] : c.btn.length > 1 ? [{ b: 'LMH' }] : [{ b: c.btn }];
      const sk = simpleKeyFor(simple, family(c.move));
      if (c.btn !== 'S') spc.push(moveRow(f, c.move, [...parseNotation(c.motion), { plus: true }, ...btnParts], undefined, sk ? simpleParts(sk) : undefined));
      // CONTRACT 19.2: motion + S = the `{s}` -> ex id whenever it exists
      const exId = c.move.includes('{s}') ? c.move.replace('{s}', 'ex') : c.btn === 'S' ? c.move : '';
      if (exId && moves[exId]) ex.push(moveRow(f, exId, [...parseNotation(c.motion), { plus: true }, { b: 'S' }], t('ml.nerve', { n: 2 }), sk ? [{ b: 'ASSIST' }, { plus: true }, ...simpleParts(sk)] : undefined));
    }
  }
  if (spc.length) secs.push([t('ml.specials'), spc]);
  if (ex.length) secs.push([t('ml.ex'), ex]);

  // assist combo (SIMPLE)
  if (scheme === 0 && Array.isArray(simple.assist) && simple.assist.length) {
    const chain = (simple.assist as unknown[]).filter((x): x is string => typeof x === 'string');
    secs.push([t('ml.assist'), [{ name: chain.map((id) => prettyMove(id, moves[id], f.id)).join(' > '), parts: [{ b: 'ASSIST' }, { plus: true }, { b: 'L' }, { b: 'L' }, { b: 'L' }], note: t('ml.assist.d') }]]);
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

/** the fighter's UNIQUE MECHANIC: title, how it works (strings ml.how.<kind>), the fighter's trait, the moves that use it */
export function uniqueCard(f: UiFighterDef): { title: string; how: string; trait: string; moves: string[] } | null {
  const u = f.unique as ({ kind: string; trait?: string } & Record<string, unknown>) | undefined;
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
  return { title, how: tOr(`ml.how.${u.kind}`, ''), trait: body, moves: [...new Set(names)] };
}

export function systemRows(): Row[] {
  const P = parseNotation;
  return [
    { name: t('ml.sys.throw'), parts: P('L+M'), note: t('ml.sys.throw.d') },
    { name: t('ml.sys.tech'), parts: P('L+M'), note: t('ml.sys.tech.d') },
    { name: t('ml.sys.parry'), parts: P('M+H'), note: t('ml.sys.parry.d') },
    { name: t('ml.sys.perfect'), parts: P('M+H'), note: t('ml.sys.perfect.d') },
    { name: t('ml.sys.rush'), parts: [...P('M+H'), { text: '>' }, ...P('66')], note: t('ml.sys.rush.d') },
    { name: t('ml.sys.impact'), parts: [{ b: 'IMPACT' }], note: t('ml.sys.impact.d') },
    { name: t('ml.sys.shove'), parts: P('M+H'), note: t('ml.sys.shove.d') },
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
  private readonly body: HTMLElement;
  private readonly tabs: [HTMLButtonElement, HTMLButtonElement];
  fighterId = '';
  scheme: Scheme = 0;

  constructor(host: HTMLElement, data: UiGameData, onTab?: () => void) {
    this.data = data;
    this.root = div('hpm-movelist', host);
    const top = div('hpm-ml-top', this.root);
    this.head = el('h3', 'hpm-ml-name', '');
    const tabBox = el('div', 'hpm-seg hpm-ml-tabs');
    const mk = (s: Scheme, label: string): HTMLButtonElement => {
      const b = btn('hpm-segbtn', label);
      b.id = `hpm-ml-${s === 0 ? 'simple' : 'classic'}`;
      b.addEventListener('click', () => { this.render(this.fighterId, s); onTab?.(); });
      tabBox.append(b);
      return b;
    };
    this.tabs = [mk(0, t('ml.simple')), mk(1, t('ml.classic'))];
    top.append(this.head, tabBox);
    this.body = div('hpm-ml-body', this.root);
    this.body.tabIndex = -1;
  }

  render(fighterId: string, scheme: Scheme): void {
    this.fighterId = fighterId;
    this.scheme = scheme;
    const f = this.data.fighters[fighterId] ?? null;
    this.head.textContent = f?.name ?? fighterId.toUpperCase();
    this.tabs.forEach((b, i) => { const on = i === scheme; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    this.body.replaceChildren();
    const secs = f ? buildRows(f, scheme) : [];
    if (!secs.length) this.body.append(el('p', 'hpm-ml-empty', t('ml.noData')));
    // the fighter's unique mechanic leads the list
    const u = f ? uniqueCard(f) : null;
    if (u) {
      const card = div('hpm-ml-unique', this.body);
      card.append(el('span', 'kick', t('ml.unique')), el('b', 'tt', u.title));
      if (u.trait) card.append(el('p', 'trait', u.trait));
      if (u.how) card.append(el('p', 'how', u.how));
      if (u.moves.length) { const mv = div('mv', card); mv.append(el('span', 'k', t('ml.unique.moves'))); for (const n of u.moves) mv.append(el('span', 'tag', n)); }
    }
    if (secs.length) this.body.append(el('p', 'hpm-ml-tip', scheme === 0 ? t('ml.simpleDmg') : t('ml.classicTip')));
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
      h.append(el('span', 'nm', ''), el('span', 'in', scheme === 0 ? t('ml.simple') : t('ml.classic')), el('span', 'fd', t('ml.col.startup')), el('span', 'fd', t('ml.col.dmg')), el('span', 'fd', t('ml.col.block')));
      return h;
    };
    let first = true;
    for (const [title, rows] of secs) {
      const sec = div('hpm-ml-sec', this.body);
      sec.append(el('h4', 'hpm-cap', title));
      if (first) { sec.append(colHead()); first = false; }
      for (const r of rows) {
        const row = div('hpm-ml-row', sec);
        if (r.id) row.dataset.move = r.id;
        const nm = el('div', 'nm');
        const nb = el('b', '', r.name);
        // CHANGED(UI3D): HOMING / LINEAR tag from the fighter data
        for (const tg of r.tags ?? []) nb.append(el('span', `hpm-ml-tag ${tg}`, t(`ml.tag.${tg}`)));
        if (r.tags?.length) row.dataset.track = r.tags[0];
        nm.append(nb);
        if (r.note) nm.append(el('span', 'note', r.note));
        const inp = el('div', 'in');
        inp.append(renderParts(r.parts));
        if (r.alt) { const a = el('span', 'alt'); a.append(el('span', 'k', scheme === 0 ? t('ml.classic') : t('ml.simple')), renderParts(r.alt, 'hpm-note small')); inp.append(a); }
        row.append(nm, inp);
        row.append(el('span', 'fd', typeof r.startup === 'number' ? `${r.startup}F` : ''), el('span', 'fd', typeof r.damage === 'number' ? String(r.damage) : ''));
        const b = el('span', `fd adv${typeof r.block === 'number' ? (r.block > 0 ? ' plus' : r.block < 0 ? ' minus' : '') : ''}`, typeof r.block === 'number' ? (r.block > 0 ? `+${r.block}` : String(r.block)) : '');
        row.append(b);
      }
    }
  }
}
