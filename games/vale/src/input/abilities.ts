// VALE input — what a slot casts and how it aims. The sim's AbilityView names the CURRENT ability of a
// slot by id (a recast, a form's kit or an item active can replace the base ability), so the client
// indexes every castable record of the catalog by id: fighter kits (with recasts and form kits), battle
// spells, item actives and unit abilities. Targeting comes from the record (Targeting.kind / range /
// indicator / filter); the aim indicator the renderer draws is derived from it here.

import type { AbilityDefT, CatalogT, ShapeT, TargetFilterT } from '../contracts/catalog.ts';
import type { EntityView } from '../contracts/sim.ts';

export type AbilityCore = Omit<AbilityDefT, 'recast'> & { recast?: AbilityDefT['recast'] };

/** the renderer's own-aim indicator (render/renderer.ts AimSpec; structural, render is not imported) */
export interface AimSpecLike {
  shape: 'circle' | 'ring' | 'cone' | 'rect' | 'line';
  x: number; y: number; dir?: number;
  radius?: number; inner?: number; angleDeg?: number; length?: number; width?: number;
  range?: number; casterX?: number; casterY?: number;
  heal?: boolean;
}

export class AbilityIndex {
  private readonly byId = new Map<string, AbilityCore>();
  private readonly actives = new Map<string, AbilityCore>();
  constructor(c: CatalogT) {
    const add = (a: AbilityCore | undefined): void => {
      if (!a || this.byId.has(a.id)) return;
      this.byId.set(a.id, a);
      if (a.recast) add(a.recast.ability as AbilityCore);
    };
    for (const f of c.fighters) {
      for (const k of ['a1', 'a2', 'a3', 'ult'] as const) add(f.kit[k] as AbilityCore);
      for (const form of Object.values(f.kit.passive.forms ?? {})) for (const a of Object.values(form.kit ?? {})) add(a as AbilityCore);
    }
    for (const s of c.setup.spells) add(s as AbilityCore);
    for (const it of c.items) if (it.active) { add(it.active as AbilityCore); this.actives.set(it.id, it.active as AbilityCore); }
    for (const u of c.units) for (const a of u.abilities) add(a as AbilityCore);
  }
  get(id: string | undefined | null): AbilityCore | undefined { return id ? this.byId.get(id) : undefined; }
  /** an item's active ability (items without one return undefined) */
  itemActive(item: string | null | undefined): AbilityCore | undefined { return item ? this.actives.get(item) : undefined; }
}

const DELIVERY = new Set(['projectile', 'dash', 'blink']);

/** the reach of an ability: targeting.range, else its first projectile / dash / blink distance */
export function reachOf(a: AbilityCore): number {
  if (a.targeting.range > 0) return a.targeting.range;
  for (const e of a.effects) {
    if (!DELIVERY.has(e.op)) continue;
    const r = (e as { range?: number; distance?: number }).range ?? (e as { distance?: number }).distance;
    if (r && r > 0) return r;
  }
  return 0;
}

/** a projectile's width (for a line indicator) */
function lineWidth(a: AbilityCore): number {
  for (const e of a.effects) if (e.op === 'projectile') return Math.max(0.3, e.width);
  for (const e of a.effects) if (e.op === 'dash') return Math.max(0.6, e.passWidth ?? 1);
  return 0.8;
}

/** does the ability only help (heal / shield / buff, no damage)? the aim draws in Sap */
export function isHelpful(a: AbilityCore): boolean {
  const ops = JSON.stringify(a.effects);
  return !/"op":"damage"/.test(ops) && /"op":"(heal|shield)"/.test(ops);
}

/** the first area / zone shape among the effects (point abilities without an explicit indicator) */
function areaShape(a: AbilityCore): ShapeT | undefined {
  const find = (list: readonly unknown[], depth: number): ShapeT | undefined => {
    if (depth > 3) return undefined;
    for (const e of list as { op?: string; shape?: ShapeT; onHit?: unknown[]; onEnd?: unknown[]; onArrive?: unknown[] }[]) {
      if ((e.op === 'area' || e.op === 'zone') && e.shape) return e.shape;
      for (const k of ['onEnd', 'onArrive', 'onHit'] as const) {
        const sub = e[k];
        if (Array.isArray(sub)) { const s = find(sub, depth + 1); if (s) return s; }
      }
    }
    return undefined;
  };
  return find(a.effects, 0);
}

/** the aim indicator for an ability cast by `self` toward the ground point (gx, gy) */
export function aimSpec(a: AbilityCore, self: { x: number; y: number }, g: { x: number; y: number }, hoverTarget?: EntityView | null): AimSpecLike {
  const t = a.targeting;
  const range = reachOf(a);
  const dir = Math.atan2(g.y - self.y, g.x - self.x);
  const heal = isHelpful(a);
  const base = { range: range > 0 ? range : undefined, casterX: self.x, casterY: self.y, heal };
  const ind = t.indicator ?? (t.kind === 'point' ? areaShape(a) : undefined);
  if (t.kind === 'unit') {
    const at = hoverTarget ?? null;
    return { ...base, shape: 'ring', x: at ? at.x : self.x, y: at ? at.y : self.y, radius: at ? Math.max(0.6, at.radius + 0.35) : 0.01, inner: at ? Math.max(0.3, at.radius + 0.1) : 0 };
  }
  if (t.kind === 'point') {
    const p = clampToRange(self, g, range);
    if (ind?.kind === 'cone') return { ...base, shape: 'cone', x: self.x, y: self.y, dir, radius: ind.radius, angleDeg: ind.angleDeg };
    if (ind?.kind === 'rect') return { ...base, shape: 'rect', x: self.x, y: self.y, dir, length: ind.length, width: ind.width };
    if (ind?.kind === 'ring') return { ...base, shape: 'ring', x: p.x, y: p.y, radius: ind.radius, inner: ind.inner };
    return { ...base, shape: 'circle', x: p.x, y: p.y, radius: ind?.kind === 'circle' ? ind.radius : 0.75 };
  }
  // direction (and anything else that aims): a cone, a rect, or a line the length of its reach
  if (ind?.kind === 'cone') return { ...base, shape: 'cone', x: self.x, y: self.y, dir, radius: ind.radius, angleDeg: ind.angleDeg };
  if (ind?.kind === 'rect') return { ...base, shape: 'rect', x: self.x, y: self.y, dir, length: ind.length, width: ind.width };
  if (ind?.kind === 'circle') return { ...base, shape: 'circle', x: self.x, y: self.y, radius: ind.radius };
  return { ...base, shape: 'line', x: self.x, y: self.y, dir, length: Math.max(1, range || 6), width: lineWidth(a) };
}

/** a ground point pulled back to the cast range (casts land at once instead of walking) */
export function clampToRange(self: { x: number; y: number }, g: { x: number; y: number }, range: number): { x: number; y: number } {
  if (!(range > 0)) return g;
  const dx = g.x - self.x, dy = g.y - self.y, d = Math.hypot(dx, dy);
  if (d <= range || d < 1e-6) return g;
  return { x: self.x + (dx / d) * range, y: self.y + (dy / d) * range };
}

const FILTER_DEFAULTS: Required<TargetFilterT> = { enemies: true, allies: false, self: false, fighters: true, minions: true, monsters: true, structures: false, summons: true };

/** a client-side mirror of the sim's unit filter (the sim re-checks; this only steers the cursor) */
export function unitMatches(filter: TargetFilterT | undefined, me: EntityView, t: EntityView, myTeam: number): boolean {
  const f = { ...FILTER_DEFAULTS, ...(filter ?? {}) };
  if (!t.alive || !t.targetable) return false;
  if (t.id === me.id) return f.self;
  const enemy = t.team !== myTeam;
  if (enemy ? !f.enemies : !f.allies) return false;
  if (enemy && (t.visibleMask & (1 << myTeam)) === 0) return false;
  switch (t.kind) {
    case 'fighter': return f.fighters;
    case 'minion': return f.minions;
    case 'monster': return f.monsters;
    case 'structure': return f.structures;
    case 'summon': case 'ward': return f.summons;
    default: return false;
  }
}

/** can this unit ability be self-cast (the self-cast modifier) */
export function canSelfCast(a: AbilityCore): boolean {
  const f = { ...FILTER_DEFAULTS, ...(a.targeting.filter ?? {}) };
  return a.targeting.kind === 'unit' && (f.self || f.allies);
}
