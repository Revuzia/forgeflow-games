// HIT PARADE - UI views over GameData / SaveStore (lane UI). Shape-tolerant readers: the stages file (lane STAGES) and the
// save (lane SHELL) are read defensively so the UI keeps working while those lanes settle their formats.

import type { UiFighterDef, UiGameData, UiSave } from './types.ts';
import { el } from './dom.ts';
import { has, t, tOr } from './strings.ts';

/** CONTRACT 5.4 roster order (the character-select grid order); unknown ids in the data follow alphabetically */
export const ROSTER_ORDER = ['johnny', 'patch', 'bruno', 'zambini', 'krane', 'lotus', 'boneyard', 'spin', 'gazza', 'rerun', 'freak', 'ricky'];
export const BOSSES: Readonly<Record<string, 'miniboss' | 'boss'>> = { freak: 'miniboss', ricky: 'boss' };
/** CONTRACT 5.4 home stages: the fallback when a stages file is missing */
export const STAGE_ORDER = ['rust_theater', 'butcher_block', 'wheel_of_pain', 'rooftop', 'control_room'];

export function fighterIds(data: UiGameData): string[] {
  const ids = Object.keys(data.fighters);
  const known = ROSTER_ORDER.filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !ROSTER_ORDER.includes(id)).sort();
  return [...known, ...rest];
}

export function fighter(data: UiGameData, id: string): UiFighterDef | null {
  return data.fighters[id] ?? null;
}

export function fighterName(data: UiGameData, id: string): string {
  return data.fighters[id]?.name ?? id.toUpperCase();
}

export function isBoss(id: string): boolean { return id in BOSSES; }

/** bosses unlock after a Season clear (CONTRACT 8 save: unlocks (freak, ricky)); everyone else is always open */
export function isUnlocked(save: UiSave, id: string): boolean {
  if (!isBoss(id)) return true;
  const u = save.unlocks;
  if (!u) return false;
  if (Array.isArray(u)) return u.includes(id);
  return !!(u as Readonly<Record<string, boolean>>)[id];
}

/** archetype label: strings arch.<key> by the archetype's first word, else the raw archetype uppercased */
export function archetypeLabel(f: UiFighterDef | null): string {
  const a = (f?.archetype ?? '').trim();
  if (!a) return '';
  const k = a.toLowerCase().split(/[\s,/-]+/)[0];
  const alias: Record<string, string> = { big: 'bigbody', setplay: 'setplay', counter: 'counter', two: 'boss', showman: 'boss' };
  const key = `arch.${alias[k] ?? k}`;
  return has(key) ? t(key) : a.toUpperCase();
}

/** difficulty 1..3: the fighter file's `difficulty` (CHANGED(UI)), else by archetype (FIGHTING_DESIGN 8c column) */
export function difficulty(f: UiFighterDef | null): number {
  if (!f) return 1;
  if (typeof f.difficulty === 'number' && f.difficulty >= 1) return Math.min(3, Math.round(f.difficulty));
  const a = (f.archetype ?? '').toLowerCase();
  if (/stance|aerial|setplay|trick/.test(a)) return 3;
  if (/grappl|zoner|charge|counter|rush|boss|show/.test(a)) return 2;
  return 1;
}

export interface ColorOpt { name: string; tint: string | null }
export function colorsOf(f: UiFighterDef | null): ColorOpt[] {
  const c = f?.colors;
  if (c && c.length) return c.map((x) => ({ name: x.name, tint: x.tint }));
  return [{ name: 'ORIGINAL', tint: null }, { name: 'ALT', tint: '#3a7bd5' }];
}

export interface StageRow { id: string; name: string; tag: string }
/**
 * stages.json in any of the shapes a stages lane might write: {stages:[{id,...}]}, [{id,...}], {<id>:{...}}. Names and
 * taglines come from strings (stage.<id>.name / .tag) first - ALL copy lives in strings.json - then the data's own name.
 */
export function stageList(data: UiGameData): StageRow[] {
  const raw = data.stages as unknown;
  const ids: string[] = [];
  const names: Record<string, string> = {};
  const push = (id: unknown, name?: unknown): void => {
    if (typeof id !== 'string' || !id || ids.includes(id)) return;
    ids.push(id);
    if (typeof name === 'string') names[id] = name;
  };
  if (Array.isArray(raw)) for (const s of raw) push((s as { id?: unknown })?.id, (s as { name?: unknown })?.name);
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.stages)) for (const s of o.stages) push((s as { id?: unknown })?.id, (s as { name?: unknown })?.name);
    else for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') push(k, (o[k] as { name?: unknown }).name);
  }
  if (!ids.length) ids.push(...STAGE_ORDER);
  return ids.map((id) => ({
    id,
    name: tOr(`stage.${id}.name`, names[id] ?? id.replace(/_/g, ' ').toUpperCase()),
    tag: tOr(`stage.${id}.tag`, ''),
  }));
}

// ─────────────────────────── portraits ───────────────────────────
// Portrait images (fighter id -> URL) are handed in by the integrator (VIEW's Showcase can render them, or a baked set).
// Until one exists for a fighter, a comic badge with the fighter's initials stands in.

const portraits: Record<string, string> = {};
const portraitListeners = new Set<() => void>();
export function setPortraits(map: Readonly<Record<string, string>>): void {
  for (const k of Object.keys(map)) portraits[k] = map[k];
  for (const f of portraitListeners) f();
}
export function onPortraits(fn: () => void): () => void { portraitListeners.add(fn); return () => portraitListeners.delete(fn); }
export function portraitUrl(id: string): string | null { return portraits[id] ?? null; }

/** a stable accent hue per fighter id (fallback badges, slot tints) */
export function fighterHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  const words = name.replace(/["'.]/g, ' ').split(/\s+/).filter((w) => w && !/^(THE|OF|MC)$/i.test(w));
  const w = words.length ? words : [name];
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}

/** fill `host` with the fighter's portrait (img) or the fallback badge; tint = the picked colour's tint */
export function fillPortrait(host: HTMLElement, data: UiGameData, id: string | null, tint: string | null = null): void {
  host.replaceChildren();
  host.classList.remove('has-img', 'badge', 'random', 'empty');
  if (!id) { host.classList.add('empty'); return; }
  if (id === 'random') {
    host.classList.add('random');
    host.append(el('b', 'ini', '?'));
    return;
  }
  const url = portraitUrl(id);
  host.style.setProperty('--hue', String(fighterHue(id)));
  if (tint) host.style.setProperty('--tint', tint); else host.style.removeProperty('--tint');
  if (url) {
    const img = el('img', 'pic');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    host.classList.add('has-img');
    host.append(img);
    return;
  }
  host.classList.add('badge');
  host.append(el('b', 'ini', initials(fighterName(data, id))));
}
