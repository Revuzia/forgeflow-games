// HIT PARADE - MOVE LIST (lane UI; CONTRACT section 8): per fighter, in SIMPLE and CLASSIC notation, read from
// data/fighters/<id>.json (`moves`, `simple`, `classic`, `unique`; CONTRACT 5.2). Sections: SUPERS, SPECIALS, EX SPECIALS,
// ASSIST COMBO (SIMPLE), COMMAND NORMALS, THROWS, UNIQUE, SYSTEM (universal verbs). Directions render as SVG arrows
// (numpad notation, 6 = forward), buttons as chips. A move's display name is strings.json `move.<fighter>.<moveId>`
// (CONTRACT 20.1: the UI mirrors the fighter files' `name` there), else the move's `name`, else the id tidied up
// (brickbat_m -> BRICKBAT); its note is the move's `desc`. Startup and damage columns come straight from the move data.

import type { Scheme, UiFighterDef, UiGameData, UiMoveDef } from './types.ts';
import { btn, chip, dirSvg, div, el } from './dom.ts';
import { has, tOr, t } from './strings.ts';

type Part = { d?: number; held?: number; b?: string; plus?: boolean; text?: string };
interface Row { name: string; parts: Part[]; startup?: number; damage?: number; note?: string }

export function prettyMove(id: string, m?: UiMoveDef | null, fid = ''): string {
  if (fid) { const k = `move.${fid}.${id}`; if (has(k)) return t(k); }
  if (m?.name) return m.name.toUpperCase();
  return id.replace(/\{s\}/g, '').replace(/_(l|m|h|ex|lv\d)$/i, '').replace(/[_-]+/g, ' ').trim().toUpperCase();
}

/** "236" / "[4]6" / "5S" / "S+H+2" / "L+M" -> parts */
export function parseNotation(s: string): Part[] {
  const out: Part[] = [];
  let i = 0;
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

function renderParts(parts: Part[]): HTMLElement {
  const box = el('span', 'hpm-note');
  for (const p of parts) {
    if (p.plus) { box.append(el('span', 'plus', '+')); continue; }
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

function moveRow(f: UiFighterDef, moveId: string, parts: Part[], note?: string): Row {
  const id = f.moves?.[moveId] ? moveId : moveId.replace(/\{s\}/g, 'm');
  const m = f.moves?.[id] ?? null;
  const desc = (m as { desc?: unknown } | null)?.desc;
  const n = [note, typeof desc === 'string' ? desc : ''].filter(Boolean).join(' - ');
  return { name: prettyMove(id, m, f.id), parts, startup: m?.startup, damage: m?.damage, note: n || undefined };
}

export function buildRows(f: UiFighterDef, scheme: Scheme): Array<[string, Row[]]> {
  const secs: Array<[string, Row[]]> = [];
  const moves = f.moves ?? {};
  const simple = (f.simple ?? {}) as Record<string, unknown>;
  const classic = f.classic ?? [];
  const ids = Object.keys(moves);
  const ofKind = (...k: string[]): string[] => ids.filter((id) => k.includes(moves[id].kind));

  // supers
  const sup: Row[] = [];
  if (scheme === 0) {
    if (typeof simple['S+H'] === 'string') sup.push(moveRow(f, simple['S+H'] as string, simpleParts('S+H'), t('ml.lv1')));
    if (typeof simple['S+H+2'] === 'string') sup.push(moveRow(f, simple['S+H+2'] as string, simpleParts('S+H+2'), t('ml.lv3')));
  } else {
    for (const id of ofKind('super1')) sup.push(moveRow(f, id, [...parseNotation('236236'), { plus: true }, { b: 'LMH' }], t('ml.lv1')));
    for (const id of ofKind('super3')) sup.push(moveRow(f, id, [...parseNotation('214214'), { plus: true }, { b: 'LMH' }], t('ml.lv3')));
  }
  if (sup.length) secs.push([t('ml.supers'), sup]);

  // specials + EX
  const spc: Row[] = [];
  const ex: Row[] = [];
  if (scheme === 0) {
    for (const k of ['5S', '6S', '2S', '4S']) if (typeof simple[k] === 'string') spc.push(moveRow(f, simple[k] as string, simpleParts(k)));
    for (const k of ['5S', '6S', '2S', '4S']) {
      if (typeof simple[k] !== 'string') continue;
      // CONTRACT 19.2: EX = the routed id with a trailing _l|_m|_h replaced by _ex (explicit A5S.. keys override)
      const explicit = simple[`A${k}`];
      const exId = typeof explicit === 'string' ? explicit : (simple[k] as string).replace(/_(l|m|h)$/i, '_ex');
      if (moves[exId]) ex.push(moveRow(f, exId, [{ b: 'ASSIST' }, { plus: true }, ...simpleParts(k)], t('ml.nerve', { n: 2 })));
    }
  } else {
    for (const c of classic) {
      const btnParts: Part[] = c.btn === 'S' ? [{ b: 'S' }] : c.btn.length > 1 ? [{ b: 'LMH' }] : [{ b: c.btn }];
      if (c.btn !== 'S') spc.push(moveRow(f, c.move, [...parseNotation(c.motion), { plus: true }, ...btnParts]));
      // CONTRACT 19.2: motion + S = the `{s}` -> ex id whenever it exists
      const exId = c.move.includes('{s}') ? c.move.replace('{s}', 'ex') : c.btn === 'S' ? c.move : '';
      if (exId && moves[exId]) ex.push(moveRow(f, exId, [...parseNotation(c.motion), { plus: true }, { b: 'S' }], t('ml.nerve', { n: 2 })));
    }
  }
  if (spc.length) secs.push([t('ml.specials'), spc]);
  if (ex.length) secs.push([t('ml.ex'), ex]);

  // assist combo (SIMPLE)
  if (scheme === 0 && Array.isArray(simple.assist) && simple.assist.length) {
    const chain = (simple.assist as unknown[]).filter((x): x is string => typeof x === 'string');
    secs.push([t('ml.assist'), [{ name: chain.map((id) => prettyMove(id, moves[id], f.id)).join(' > '), parts: [{ b: 'ASSIST' }, { plus: true }, { b: 'L' }, { b: 'L' }, { b: 'L' }], note: t('ml.assist.d') }]]);
  }

  // command normals
  const cmd = ofKind('command').map((id) => moveRow(f, id, parseNotation(moves[id].input ?? '')));
  if (cmd.length) secs.push([t('ml.normals'), cmd]);

  // throws
  const thr = ofKind('throw', 'cmdgrab').map((id) => moveRow(f, id, parseNotation(moves[id].input ?? 'L+M')));
  if (thr.length) secs.push([t('ml.throws'), thr]);

  // unique: the kind's label + the fighter's trait line (strings trait.<fighter> first, then the data's `trait`)
  if (f.unique && f.unique.kind) {
    const k = f.unique.kind;
    const raw = (f.unique as { trait?: unknown }).trait;
    const trait = tOr(`trait.${f.id}`, typeof raw === 'string' ? raw : '');
    if (k !== 'none' || trait) secs.push([t('ml.unique'), [{ name: k === 'none' ? (f.persona ?? f.name).toUpperCase() : tOr(`ml.unique.${k}`, k.toUpperCase()), parts: [], note: trait || undefined }]]);
  }
  return secs;
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
    if (scheme === 0 && secs.length) this.body.append(el('p', 'hpm-ml-tip', t('ml.simpleDmg')));
    secs.push([t('ml.system'), systemRows()]);
    for (const [title, rows] of secs) {
      const sec = div('hpm-ml-sec', this.body);
      sec.append(el('h4', 'hpm-cap', title));
      for (const r of rows) {
        const row = div('hpm-ml-row', sec);
        const nm = el('div', 'nm');
        nm.append(el('b', '', r.name));
        if (r.note) nm.append(el('span', 'note', r.note));
        row.append(nm, renderParts(r.parts));
        const fd = el('span', 'fd', typeof r.startup === 'number' ? `${r.startup}F` : '');
        const dm = el('span', 'fd', typeof r.damage === 'number' ? String(r.damage) : '');
        row.append(fd, dm);
      }
    }
  }
}
