// VALE sim — catalog lookups + effective rules (CONTRACT §4, §5.5).
//
// The catalog is arrays (content-friendly); the sim needs O(1) lookups by id. Built once per match.
// Rules are `mode.rules ⊕ queue.rules`: plain objects merge key by key (recursively), arrays and
// scalars from the queue replace the mode's.

import type {
  CatalogT, FighterDefT, UnitDefT, ItemDefT, TeamBuffDefT, ModeDefT, QueueDefT, MapDefT, ResourceDefT,
  RulesParamsT, SkinDefT, AbilityDefT, PassiveDefT, SetupDefT, RoleDef,
} from '../contracts/catalog.ts';
import type { z } from 'zod';

export type SpellDefT = SetupDefT['spells'][number];
export type BoonDefT = SetupDefT['boons'][number];
/** the shape shared by every castable record (AbilityDef minus `recast`; recast abilities are this) */
export type AbilityCoreT = NonNullable<AbilityDefT['recast']>['ability'];
export type RoleDefT = z.infer<typeof RoleDef>;

export interface CatalogIndex {
  readonly catalog: CatalogT;
  readonly fighters: ReadonlyMap<string, FighterDefT>;
  readonly units: ReadonlyMap<string, UnitDefT>;
  readonly items: ReadonlyMap<string, ItemDefT>;
  readonly spells: ReadonlyMap<string, SpellDefT>;
  readonly boons: ReadonlyMap<string, BoonDefT>;
  readonly teamBuffs: ReadonlyMap<string, TeamBuffDefT>;
  readonly modes: ReadonlyMap<string, ModeDefT>;
  readonly queues: ReadonlyMap<string, QueueDefT>;
  readonly maps: ReadonlyMap<string, MapDefT>;
  readonly resources: ReadonlyMap<string, ResourceDefT>;
  readonly skins: ReadonlyMap<string, SkinDefT>;
  readonly roles: ReadonlyMap<string, RoleDefT>;
  /** every castable record by id: kits, recasts, form kits, item actives, battle spells, unit abilities */
  readonly abilities: ReadonlyMap<string, AbilityCoreT>;
  /** every passive record by id: kit passives, item passives, boons, team-buff passives, unit passives */
  readonly passives: ReadonlyMap<string, PassiveDefT>;
}

function byId<T extends { id: string }>(arr: readonly T[], what: string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of arr) {
    if (m.has(r.id)) throw new Error(`catalog: duplicate ${what} id '${r.id}'`);
    m.set(r.id, r);
  }
  return m;
}

export function indexCatalog(catalog: CatalogT): CatalogIndex {
  const abilities = new Map<string, AbilityCoreT>();
  const passives = new Map<string, PassiveDefT>();
  // ability/passive ids may legitimately repeat across records (two items sharing one passive
  // record id); the first one wins for lookups, which only serve tooling and scripts.
  const addAbility = (a: AbilityDefT | AbilityCoreT): void => {
    if (!abilities.has(a.id)) abilities.set(a.id, a);
    const rc = (a as AbilityDefT).recast;
    if (rc && !abilities.has(rc.ability.id)) abilities.set(rc.ability.id, rc.ability);
  };
  const addPassive = (p: PassiveDefT): void => {
    if (!passives.has(p.id)) passives.set(p.id, p);
    if (p.forms) for (const f of Object.values(p.forms)) {
      if (!f.kit) continue;
      for (const a of [f.kit.a1, f.kit.a2, f.kit.a3, f.kit.ult]) if (a) addAbility(a);
    }
  };
  for (const f of catalog.fighters) {
    addPassive(f.kit.passive);
    addAbility(f.kit.a1); addAbility(f.kit.a2); addAbility(f.kit.a3); addAbility(f.kit.ult);
  }
  for (const it of catalog.items) {
    if (it.active) addAbility(it.active);
    for (const p of it.passives) addPassive(p);
  }
  for (const s of catalog.setup.spells) addAbility(s);
  for (const b of catalog.setup.boons) addPassive(b);
  for (const u of catalog.units) {
    for (const a of u.abilities) addAbility(a);
    if (u.passive) addPassive(u.passive);
  }
  for (const tb of catalog.teamBuffs) for (const p of tb.passives) addPassive(p);

  return {
    catalog,
    fighters: byId(catalog.fighters, 'fighter'),
    units: byId(catalog.units, 'unit'),
    items: byId(catalog.items, 'item'),
    spells: byId(catalog.setup.spells, 'spell'),
    boons: byId(catalog.setup.boons, 'boon'),
    teamBuffs: byId(catalog.teamBuffs, 'teamBuff'),
    modes: byId(catalog.modes, 'mode'),
    queues: byId(catalog.queues, 'queue'),
    maps: byId(catalog.maps, 'map'),
    resources: byId(catalog.resources, 'resource'),
    skins: byId(catalog.skins, 'skin'),
    roles: byId(catalog.roles, 'role'),
    abilities,
    passives,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep merge for rules layering: objects merge recursively, everything else (arrays, scalars,
 * null) in `over` replaces `base`. `undefined` in `over` leaves `base` alone. Never mutates inputs.
 */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return clone(base);
  if (!isPlainObject(base) || !isPlainObject(over)) return clone(over) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base)) out[k] = clone(base[k]);
  for (const k of Object.keys(over)) {
    const ov = over[k];
    if (ov === undefined) continue;
    out[k] = k in base ? deepMerge(base[k], ov) : clone(ov);
  }
  return out as T;
}
function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (isPlainObject(v)) {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o as T;
  }
  return v;
}

/** effective RulesParams for a (mode, queue) pair: mode.rules ⊕ queue.rules */
export function resolveRules(idx: CatalogIndex, modeId: string, queueId: string): RulesParamsT {
  const mode = idx.modes.get(modeId);
  if (!mode) throw new Error(`rules: unknown mode '${modeId}'`);
  const queue = idx.queues.get(queueId);
  if (!queue) throw new Error(`rules: unknown queue '${queueId}'`);
  if (queue.mode !== modeId) throw new Error(`rules: queue '${queueId}' belongs to mode '${queue.mode}', not '${modeId}'`);
  return deepMerge(mode.rules, queue.rules);
}
