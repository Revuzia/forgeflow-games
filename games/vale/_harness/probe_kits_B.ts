// probe (lane CONTENT): roster half B (ardit ervet nurrow lisvel ulkro tunlan vashil sukri) in the real sim.
//
// Loads the REAL content/fighters/<id>.json for the eight half-B fighters, with the real
// content/resources.json, classes.json and roles.json, into a fixture catalog (the synthetic arena map and rules
// of fixtures/catalog_fixture.ts; zod-validated by the real Catalog schema). Each fighter is spawned at
// level 18 with every ability at its max rank and cast at a valid target against training enemy fighters
// (`fx_target`, a synthetic 100k-hp body with no kit), checking the events the kit promises (damage, status,
// dash, shield, heal, marks, counters, forms, zones, displacement) and that nothing throws.
//
//   node _harness/probe_kits_B.ts            exit 0 = PASS
//
// Sections: content lint (roster table, calibration, filters, ops) · catalog build · every fighter's passive and
// abilities (+ the Ervet Hilt kit and the Ulkro Long Run form) · cross-checks over every ability · a 4v4 run.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog, type CatalogT } from '../src/contracts/catalog.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { TICK_HZ } from '../src/contracts/sim.ts';
import { fighter as fxFighter, rawCatalog } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, near, ofType, section, stepSec, type SeatSpec } from './fixtures/sim_fixture.ts';
import { levelUpAbility, setLevel, tryCast, type CastResult } from '../src/sim/abilities.ts';
import { dealDamage, killEntity } from '../src/sim/combat.ts';
import type { Entity } from '../src/sim/entity.ts';
import { SLOT_INDEX } from '../src/sim/entity.ts';
import { issueAttack, issueMove } from '../src/sim/movement.ts';
import { addCounter, applyStatus, counterValue, findBuff, hasStatus, markStacks } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HALF_B = ['ardit', 'ervet', 'nurrow', 'lisvel', 'ulkro', 'tunlan', 'vashil', 'sukri'] as const;
type Raw = Record<string, unknown>;
type Any = Record<string, unknown>;

// ── real content ────────────────────────────────────────────────────────────────────────────────
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const o: Raw = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$comment' && k !== '$schema') o[k] = strip(x);
    return o;
  }
  return v;
}
const readJson = (p: string): unknown => strip(JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, '')));
const realFighters = HALF_B.map((id) => readJson(`content/fighters/${id}.json`) as Raw);
const realSkins = HALF_B.map((id) => readJson(`content/skins/${id}.json`) as Raw[]);
const resources = readJson('content/resources.json') as Raw[];
const classes = readJson('content/classes.json') as Raw[];
const roles = readJson('content/roles.json') as Raw[];
const vfxIds = new Set((readJson('content/vfx.json') as { id: string }[]).map((v) => v.id));
const audioCues = new Set(Object.keys((readJson('content/audio.json') as { cues: object }).cues));

function walk(node: unknown, path: string, fn: (n: Any, p: string) => void): void {
  if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}[${i}]`, fn)); return; }
  if (node && typeof node === 'object') {
    fn(node as Any, path);
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, fn);
  }
}

// ── content lint: the ROSTER.md table, VOCAB calibration, and the authoring rules ───────────────────
interface Row { cls: string; role: string; second?: string; res: string; diff: number; range: number; dtype: string; height: number; accent: string }
const ROSTER: Record<string, Row> = {
  ardit: { cls: 'class_plinth', role: 'grovehunter', second: 'lampglass', res: 'res_light', diff: 1, range: 1.9, dtype: 'phys', height: 2.35, accent: 'aubade' },
  ervet: { cls: 'class_breaker', role: 'shadehold', second: 'dialcross', res: 'res_light', diff: 2, range: 2.0, dtype: 'phys', height: 2.1, accent: 'aubade' },
  nurrow: { cls: 'class_striker', role: 'grovehunter', second: 'dialcross', res: 'res_tally', diff: 3, range: 1.7, dtype: 'phys', height: 1.8, accent: 'serenade' },
  lisvel: { cls: 'class_slinger', role: 'shaftlight', second: 'lampglass', res: 'res_light', diff: 1, range: 5.9, dtype: 'phys', height: 1.85, accent: 'aubade' },
  ulkro: { cls: 'class_slinger', role: 'shaftlight', second: 'grovehunter', res: 'res_tally', diff: 3, range: 5.4, dtype: 'phys', height: 1.85, accent: 'hourless' },
  tunlan: { cls: 'class_caster', role: 'dialcross', second: 'shaftlight', res: 'res_heat', diff: 2, range: 5.2, dtype: 'magic', height: 2.05, accent: 'serenade' },
  vashil: { cls: 'class_caster', role: 'dialcross', second: 'shaftlight', res: 'res_light', diff: 1, range: 5.3, dtype: 'magic', height: 2.05, accent: 'aubade' },
  sukri: { cls: 'class_tender', role: 'lampglass', res: 'res_light', diff: 2, range: 5.0, dtype: 'magic', height: 1.65, accent: 'hourless' },
};
function hueSat(hex: string): { h: number; s: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx === 0 ? 0 : d / mx };
}
/** the bible's reserved relationship hues: ally 200-225, harm 28-50, heal 125-150, tritan 340-350; inside one a colour stays <= 40% saturation */
const reservedOk = (hex: string): boolean => {
  const { h, s } = hueSat(hex);
  const inBand = (h >= 200 && h <= 225) || (h >= 28 && h <= 50) || (h >= 125 && h <= 150) || (h >= 340 && h <= 350);
  return !inBand || s <= 0.4;
};
section('content lint', () => {
  const resIds = new Set(resources.map((r) => r.id as string)), classIds = new Set(classes.map((c) => c.id as string)), roleIds = new Set(roles.map((c) => c.id as string));
  for (const f of realFighters) {
    const id = f.id as string;
    const row = ROSTER[id];
    const k = f.kit as Any;
    check(`${id}: resource and class ids are the shared ones (res_*, class_*)`, resIds.has(f.resource as string) && classIds.has(f.class as string) &&
      /^res_/.test(f.resource as string) && /^class_/.test(f.class as string), [f.resource, f.class]);
    check(`${id}: matches the ROSTER.md table (class, resource, positions, difficulty, attack, height)`,
      f.class === row.cls && f.resource === row.res && f.role === row.role && f.secondaryRole === row.second && f.difficulty === row.diff &&
      (f.attack as Any).range === row.range && (f.attack as Any).damageType === row.dtype && (f.art as Any).height === row.height,
      [f.class, f.resource, f.role, f.secondaryRole, f.difficulty, (f.attack as Any).range, (f.art as Any).height]);
    check(`${id}: role and secondaryRole are real positions`, roleIds.has(f.role as string) && (f.secondaryRole === undefined || roleIds.has(f.secondaryRole as string)));
    check(`${id}: tags carry the origin (${row.accent}) and melee / ranged`, (f.tags as string[]).includes(row.accent) && (f.tags as string[]).some((t) => t === 'melee' || t === 'ranged'), f.tags);
    const lore = (f.lore as string).trim().split(/\s+/).length;
    check(`${id}: lore is 60-120 words`, lore >= 60 && lore <= 120, lore);
    // VOCAB calibration (public-system reference ranges)
    const b = f.base as Any, g = f.growth as Any;
    const inR = (v: unknown, lo: number, hi: number): boolean => typeof v === 'number' && v >= lo && v <= hi;
    check(`${id}: L1 hp 560-690 (+92-112), ad 52-66 (+2.8-3.8), armor 26-38 (+4-5), resist 30-32 (+1.3-2)`,
      inR(b.hp, 560, 690) && inR(g.hp, 92, 112) && inR(b.ad, 52, 66) && inR(g.ad, 2.8, 3.8) && inR(b.armor, 26, 38) && inR(g.armor, 4, 5) &&
      inR(b.resist, 30, 32) && inR(g.resist, 1.3, 2), [b, g]);
    check(`${id}: attackSpeed 0.62-0.70 (+1.5-3.5%/lvl), moveSpeed 3.30-3.60`, inR(b.attackSpeed, 0.62, 0.7) && inR(g.attackSpeed, 0.015, 0.035) && inR(b.moveSpeed, 3.3, 3.6), [b.attackSpeed, g.attackSpeed, b.moveSpeed]);
    const baseRes = (b.res as number | undefined) ?? 0, growRes = (g.res as number | undefined) ?? 0;
    check(`${id}: base.res is an offset on the pool (-20..+120; growth -10..+10 on the 40/level pool)`, baseRes >= -20 && baseRes <= 120 && growRes >= -10 && growRes <= 10 &&
      (row.res === 'res_light' || (b.res === undefined && g.res === undefined)), [baseRes, growRes]);
    const range = (f.attack as Any).range as number;
    check(`${id}: attack range inside the ${row.dtype === 'phys' && range < 3 ? 'melee 1.6-2.1' : 'ranged 5.0-6.0'} m window`, range < 3 ? inR(range, 1.6, 2.1) : inR(range, 5, 6), range);
    check(`${id}: palette hexes are not a reserved relationship hue above 40% saturation`, reservedOk((f.palette as Any).primary as string) && reservedOk((f.palette as Any).secondary as string), f.palette);
    check(`${id}: runRefSpeed 3.6, accentMaterial accent, all 12 required clip roles`, (f.art as Any).runRefSpeed === 3.6 && (f.art as Any).accentMaterial === 'accent' &&
      ['idle', 'run', 'attack1', 'attack2', 'cast_a1', 'cast_a2', 'cast_a3', 'cast_ult', 'death', 'recall', 'idle_lobby', 'victory'].every((c) => c in ((f.art as Any).clips as Any)));
    let scripts = 0, badFilters = 0, longRange = 0, noTelegraph = 0;
    const msgs: string[] = [];
    walk(f.kit, 'kit', (n, p) => {
      if (n.op === 'script') scripts++;
      for (const key of ['filter', 'passFilter']) {
        const flt = n[key] as Any | undefined;
        if (flt && flt.allies === true && flt.enemies !== false) { badFilters++; msgs.push(`${p}.${key}`); }
      }
      if (n.cond && typeof n.cond === 'object') walk(n.cond, `${p}.cond`, (c, cp) => {
        const flt = c.filter as Any | undefined;
        if (c.kind === 'targetIs' && flt && flt.allies === true && flt.enemies !== false) { badFilters++; msgs.push(cp); }
      });
      const tg = n.targeting as Any | undefined;
      if (tg && ((tg.range as number | undefined) ?? 0) > 14) { longRange++; msgs.push(`${p}.targeting.range ${tg.range}`); }
      void noTelegraph;
    });
    check(`${id}: no 'script' ops`, scripts === 0, scripts);
    check(`${id}: every allies:true filter says enemies:false`, badFilters === 0, msgs);
    check(`${id}: ability ranges <= 14 m`, longRange === 0, msgs);
    const abilities: [string, Any][] = [['a1', k.a1 as Any], ['a2', k.a2 as Any], ['a3', k.a3 as Any], ['ult', k.ult as Any]];
    for (const [fid, form] of Object.entries(((k.passive as Any).forms ?? {}) as Record<string, Any>)) {
      for (const [s, a] of Object.entries((form.kit ?? {}) as Record<string, Any>)) abilities.push([`${fid}.${s}`, a]);
    }
    for (const [s, a] of abilities) {
      const isUlt = s === 'ult';
      const r = ((a.targeting as Any).range as number | undefined) ?? 0;
      check(`${id} ${s}: range ${r} m ${isUlt ? '<= 14 m (edge marker past 10 m)' : '<= 10 m'}`, r <= (isUlt ? 14 : 10), r);
      const cd = a.cooldown as number | number[];
      const cds = Array.isArray(cd) ? cd : [cd];
      check(`${id} ${s}: ${isUlt ? 'ultimate cooldowns 70-130 s over 3 ranks' : 'cooldowns 5-16 s over 5 ranks'}`,
        isUlt ? cds.length === 3 && cds.every((x) => x >= 70 && x <= 130) && cds[0] >= cds[2]
          : cds.every((x) => x >= 5 && x <= 16), cds);
      check(`${id} ${s}: maxRank ${isUlt ? 3 : 5}`, a.maxRank === (isUlt ? 3 : 5), a.maxRank);
      check(`${id} ${s}: icon path follows VOCAB`, a.icon === `assets/ui/icons/abilities/${a.id as string}.svg`, a.icon);
      // rank-1 primary damage 30-95 (+ratio <= 0.9): utility hits and multi-hit shards sit at the low end
      let firstDamage: Any | undefined;
      walk(a.effects, 'effects', (n) => { if (!firstDamage && n.op === 'damage') firstDamage = n; });
      if (firstDamage && !isUlt) {
        const am = firstDamage.amount as Any;
        const base1 = Array.isArray(am.base) ? (am.base as number[])[0] : (am.base as number);
        const ratios = ['ad', 'bonusAd', 'ap', 'bonusHp', 'maxHp'].map((x) => (am[x] as number | undefined) ?? 0);
        check(`${id} ${s}: rank-1 damage base ${base1} in 30-95 with ratios <= 0.9`, (base1 >= 30 || am.perCounter !== undefined) && base1 <= 95 && ratios.every((x) => x <= 0.9), am);
      }
    }
    // skins: base + one standard + one deluxe, released in 2026.10.0, hues
    const sk = realSkins[HALF_B.indexOf(id as typeof HALF_B[number])];
    check(`${id}: skins are <id>_base + a standard + a deluxe, releasedIn 2026.10.0`, sk.length === 3 && sk[0].id === `${id}_base` && sk[0].tier === 'base' &&
      sk[1].tier === 'standard' && sk[2].tier === 'deluxe' && sk.every((s) => s.releasedIn === '2026.10.0' && s.fighter === id), sk.map((s) => s.id));
    check(`${id}: skin vfxTint is outside the reserved relationship bands`, sk.every((s) => s.vfxTint === undefined || reservedOk(s.vfxTint as string)), sk.map((s) => s.vfxTint));
  }
});

// ── fixture catalog: real half-B content + the real resources / classes / roles ─────────────────────
// `fx_target` is the training enemy: huge hp, no armor, no kit. It uses the real no-resource id.
const TARGET = 'fx_target';
const fxTarget = fxFighter(TARGET, { resource: 'res_unlit', base: { hp: 100000, ad: 1, attackSpeed: 0.5, moveSpeed: 3.5 }, radius: 0.5 });
let catalog: CatalogT;
section('catalog build', () => {
  const raw = rawCatalog({ fighters: [...realFighters, fxTarget], resources });
  raw.classes = classes;
  raw.roles = roles;
  const r = Catalog.safeParse(raw);
  if (!r.success) {
    throw new Error(`half-B catalog failed schema validation:\n${r.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  catalog = r.data;
  check('real half-B fighters + resources + classes + roles validate as one catalog', catalog.fighters.length === HALF_B.length + 1 && catalog.resources.length === resources.length);
});
if (!catalog!) { finish('probe_kits_B'); }

// ── arena helpers ─────────────────────────────────────────────────────────────────────────────────
const Y = 52; // below the fixture wall (x 28..32, y 0..45) and thicket, away from both fountains
type Slot = 'a1' | 'a2' | 'a3' | 'ult';
const SLOTS: Slot[] = ['a1', 'a2', 'a3', 'ult'];
const dist = (a: Entity, b: Entity): number => Math.hypot(a.x - b.x, a.y - b.y);

interface Arena { w: World; me: Entity; foes: Entity[]; allies: Entity[] }
/** caster at (10, Y) facing +x; `foes` / `allies` are fx_target bodies at the given x offsets from the caster */
function arena(id: string, o: { foes?: number[]; allies?: number[]; foeDy?: number[]; allyDy?: number[]; level?: number } = {}): Arena {
  const seats: SeatSpec[] = [{ fighter: id, team: 0, x: 10, y: Y }];
  (o.allies ?? []).forEach((dx, i) => seats.push({ fighter: TARGET, team: 0, x: 10 + dx, y: Y + (o.allyDy?.[i] ?? 0) }));
  (o.foes ?? []).forEach((dx, i) => seats.push({ fighter: TARGET, team: 1, x: 10 + dx, y: Y + (o.foeDy?.[i] ?? 0) }));
  const w = makeWorld(catalog, seats);
  const me = fighterEnt(w, 0);
  const na = (o.allies ?? []).length;
  const allies = (o.allies ?? []).map((_, i) => fighterEnt(w, 1 + i));
  const foes = (o.foes ?? []).map((_, i) => fighterEnt(w, 1 + na + i));
  setLevel(w, me, o.level ?? 18);
  for (let r = 0; r < 5; r++) for (const s of SLOTS) levelUpAbility(w, me, s);
  me.facing = 0;
  me.hp = me.maxHp;
  me.res = me.resource?.model === 'pool' ? me.maxRes : me.resource?.model === 'build' ? 100 : 0;
  for (const e of [...allies, ...foes]) { e.hp = e.maxHp; e.autoAttack = false; }
  me.autoAttack = false;
  w.hashDirty = true;
  w.vision.update(w.entities, w.tick);
  return { w, me, foes, allies };
}

/** cast a slot and run `secs` of game time; events of the cast tick are captured, steps appended */
function cast(a: Arena, slot: Slot, o: { x?: number; y?: number; target?: Entity } = {}, secs = 1): { res: CastResult; evs: SimEvent[] } {
  const w = a.w;
  const n = w.events.length;
  const res = tryCast(w, a.me, SLOT_INDEX[slot], o.x, o.y, o.target?.id);
  const evs = w.events.slice(n);
  for (const e of stepSec(w, secs)) evs.push(e);
  return { res, evs };
}
const step = (a: Arena, secs: number): SimEvent[] => stepSec(a.w, secs);
/** refresh the caster for the next cast of the same slot */
const refresh = (a: Arena): void => {
  for (const s of SLOTS) { const sl = a.me.slots[SLOT_INDEX[s]]!; sl.cooldown = 0; if (sl.stash) sl.stash.clear(); }
  a.me.res = a.me.resource?.model === 'pool' ? a.me.maxRes : a.me.resource?.model === 'build' ? 100 : 0;
  a.me.overheat = 0;
};
const dmgOn = (evs: SimEvent[], ability: string, dst: Entity, dtype?: string): Extract<SimEvent, { e: 'damage' }>[] =>
  ofType(evs, 'damage').filter((d) => d.ability === ability && d.dst === dst.id && d.amount > 0 && (dtype === undefined || d.dtype === dtype));
const healsOn = (evs: SimEvent[], dst: Entity): Extract<SimEvent, { e: 'heal' }>[] => ofType(evs, 'heal').filter((h) => h.dst === dst.id);
const statusEvs = (evs: SimEvent[], dst: Entity, kind: string): Extract<SimEvent, { e: 'status' }>[] => ofType(evs, 'status').filter((s) => s.dst === dst.id && s.status === kind);
const statusOn = (evs: SimEvent[], dst: Entity, kind: string): boolean => statusEvs(evs, dst, kind).length > 0;
const total = (xs: { amount: number }[]): number => xs.reduce((s, x) => s + x.amount, 0);
const hasBuff = (e: Entity, id: string): boolean => findBuff(e, id) !== null;
const zoneUp = (a: Arena, def: string): boolean => a.w.entities.some((e) => e.kind === 'zone' && e.def === def);
const setSlotReady = (a: Arena, slot: Slot): void => { a.me.slots[SLOT_INDEX[slot]]!.cooldown = 0; };
const baseOf = (id: string): Any => (catalog.fighters.find((f) => f.id === id) as unknown as Any);

// ── 0. level 18 setup sanity (every fighter) ──────────────────────────────────────────────────────
for (const id of HALF_B) {
  section(`${id}: spawns at level 18 with a full kit`, () => {
    const a = arena(id, { foes: [3] });
    const k = catalog.fighters.find((f) => f.id === id)!;
    check(`${id}: level 18, abilities at max rank (5 5 5 3)`, a.me.level === 18 && SLOTS.map((s) => a.me.slots[SLOT_INDEX[s]]!.rank).join(' ') === '5 5 5 3',
      [a.me.level, SLOTS.map((s) => a.me.slots[SLOT_INDEX[s]]!.rank)]);
    check(`${id}: slot ids match the kit`, SLOTS.every((s) => a.me.slots[SLOT_INDEX[s]]!.id === k.kit[s].id));
    check(`${id}: full hp, sane stats`, a.me.hp === a.me.maxHp && a.me.maxHp > 2000 && a.me.stats.armor > 80 && a.me.stats.ad > 60, [a.me.maxHp, a.me.stats.armor, a.me.stats.ad]);
    const model = a.me.resource!.model;
    check(`${id}: resource ${k.resource} (${model}) max ${a.me.maxRes}`, model === 'none' ? a.me.maxRes === 0 : a.me.maxRes >= 100, a.me.maxRes);
    if (model === 'pool') check(`${id}: Light pool at level 18 is 980-1250`, a.me.maxRes >= 980 && a.me.maxRes <= 1250, a.me.maxRes);
    step(a, 5);
    check(`${id}: idle for 5 s without throwing; still alive`, a.me.alive);
  });
}

// ── 9 · Ardit (Plinth, res_light) ───────────────────────────────────────────────────────────────────
section('ardit', () => {
  { // A2 Glare: 5 m 70 degree cone: damage, 25% slow, disarm; passive Turned Blades: +12 armor and resist per disarmed enemy fighter (3 stacks, 5 s)
    const a = arena('ardit', { foes: [3, -3, 3], foeDy: [0, 0, 3.3] });
    const [foe, behind, wide] = a.foes;
    const arm0 = a.me.stats.armor;
    const { res, evs } = cast(a, 'a2', { x: 20, y: Y }, 0.8);
    check('Glare: casts', res === 'ok', res);
    check('Glare: the cone area carries the bespoke ardit_a2_glare preset', ofType(evs, 'area').some((x) => x.ability === 'ardit_glare' && x.vfx === 'ardit_a2_glare'));
    check('Glare: magic damage on the enemy in the cone', dmgOn(evs, 'ardit_glare', foe, 'magic').length === 1);
    check('Glare: slowed and disarmed', hasStatus(foe, 'slow') && hasStatus(foe, 'disarm'));
    check('Glare: not behind and not outside the 70 degrees', dmgOn(evs, 'ardit_glare', behind).length === 0 && dmgOn(evs, 'ardit_glare', wide).length === 0 &&
      !hasStatus(behind, 'disarm') && !hasStatus(wide, 'disarm'));
    check('Turned Blades: one stack after one disarm (+12 armor and resist)', findBuff(a.me, 'ardit_turned')?.stacks === 1 && a.me.stats.armor >= arm0 + 11.5, [findBuff(a.me, 'ardit_turned')?.stacks, arm0, a.me.stats.armor]);
    refresh(a); a.me.x = 10; a.me.y = Y;
    cast(a, 'a2', { x: 20, y: Y }, 0.5);
    check('Turned Blades: the same enemy cannot stack it again inside 1.5 s', findBuff(a.me, 'ardit_turned')?.stacks === 1, findBuff(a.me, 'ardit_turned')?.stacks);
    step(a, 1.2); refresh(a);
    cast(a, 'a2', { x: 20, y: Y }, 0.5);
    check('Turned Blades: a later disarm adds a second stack', findBuff(a.me, 'ardit_turned')?.stacks === 2, findBuff(a.me, 'ardit_turned')?.stacks);
  }
  { // A1 Lancing Run: 7 m run; passes minions, stops at the first enemy FIGHTER: magic damage + airborne 0.75 s
    const a = arena('ardit', { foes: [5, 8] });
    const [foe, far] = a.foes;
    const minion = addUnit(a.w, 'fx_minion', 1, 13, Y);
    const { res, evs } = cast(a, 'a1', { x: 17, y: Y }, 1);
    check('Lancing Run: casts', res === 'ok', res);
    check('Lancing Run: a dash event', ofType(evs, 'dash').some((d) => d.src === a.me.id));
    check('Lancing Run: magic damage on the first enemy fighter', dmgOn(evs, 'ardit_lancing_run', foe, 'magic').length === 1);
    check('Lancing Run: airborne', statusOn(evs, foe, 'airborne'));
    check('Lancing Run: passes the minion in front without a hit', dmgOn(evs, 'ardit_lancing_run', minion).length === 0 && !statusOn(evs, minion, 'airborne'));
    check('Lancing Run: stops at the first fighter (short of 7 m, not at the far one)', a.me.x > 13 && a.me.x < 15 && dmgOn(evs, 'ardit_lancing_run', far).length === 0, a.me.x);
    check('Lancing Run: costs Light', a.me.res < a.me.maxRes);
  }
  { // A3 Spire Strike: magic damage +60% to monsters, 20% slow
    const a = arena('ardit', { foes: [1.5] });
    const [foe] = a.foes;
    const monster = addUnit(a.w, 'fx_monster', 1, 11.5, Y + 0.5);
    const { res, evs } = cast(a, 'a3', {}, 0.6);
    const d1 = dmgOn(evs, 'ardit_spire_strike', foe, 'magic'), d2 = dmgOn(evs, 'ardit_spire_strike', monster, 'magic');
    check('Spire Strike: casts', res === 'ok', res);
    check('Spire Strike: magic damage on the fighter and on the monster', d1.length === 1 && d2.length === 1);
    check('Spire Strike: 60% more against the monster', d1.length === 1 && d2.length === 1 && near(d2[0].amount / d1[0].amount, 1.6, 0.02), [d1[0]?.amount, d2[0]?.amount]);
    check('Spire Strike: slows the fighter', hasStatus(foe, 'slow'));
  }
  { // Ultimate Muster: 6 m follow beacon: allies +20% move speed and +45 armor/resist; enemy fighters that enter are disarmed 1 s
    const a = arena('ardit', { foes: [4, 9], allies: [3] });
    const [inside, outside] = a.foes, [ally] = a.allies;
    const arm0 = ally.stats.armor;
    const { res, evs } = cast(a, 'ult', {}, 0.9);
    check('Muster: casts', res === 'ok', res);
    check('Muster: the bespoke ardit_ult_muster preset reaches the presentation', ofType(evs, 'area').some((x) => x.vfx === 'ardit_ult_muster'));
    check('Muster: allies within 6 m (Ardit too) get the ward buff', hasBuff(ally, 'ardit_muster_ward') && hasBuff(a.me, 'ardit_muster_ward'));
    ally.statsDirty = true; step(a, 0.05);
    check('Muster: ally armor +45 at rank 3 and 20% move speed', ally.stats.armor >= arm0 + 44 && ally.stats.moveSpeed > 3.5 * 1.15, [arm0, ally.stats.armor, ally.stats.moveSpeed]);
    check('Muster: an enemy fighter inside when it rises is disarmed', hasStatus(inside, 'disarm') || statusOn(evs, inside, 'disarm'));
    check('Muster: Turned Blades answers the disarm', hasBuff(a.me, 'ardit_turned'));
    // an enemy walking in is disarmed on entering
    issueMove(a.w, outside, a.me.x, a.me.y, false);
    const walk = step(a, 1.6);
    check('Muster: an enemy fighter that walks into the 6 m radius is disarmed', statusOn(walk, outside, 'disarm'), dist(outside, a.me));
    // the beacon follows him
    issueMove(a.w, a.me, a.me.x + 5, Y, false);
    step(a, 1.8);
    const z = a.w.entities.find((e) => e.kind === 'zone' && e.def === 'ardit_muster');
    check('Muster: the zone follows Ardit', !!z && Math.hypot(z.x - a.me.x, z.y - a.me.y) < 0.6, z ? [z.x, a.me.x] : null);
    step(a, 3);
    check('Muster: ends after 5 s', !zoneUp(a, 'ardit_muster') && !zoneUp(a, 'ardit_muster_edge'));
  }
});

// ── 10 · Ervet (Breaker, res_light, forms) ─────────────────────────────────────────────────────────
section('ervet', () => {
  { // passive Dawnglass Edge: +2% max hp magic damage per attack; +15 armor and resist whole
    const a = arena('ervet', { foes: [2.2] });
    const [foe] = a.foes;
    const base = baseOf('ervet').base as Any, growth = baseOf('ervet').growth as Any;
    const wantArmor = (base.armor as number) + (growth.armor as number) * 17 + 15;
    check('Dawnglass Edge: +15 armor whole', near(a.me.stats.armor, wantArmor, 0.5), [a.me.stats.armor, wantArmor]);
    issueAttack(a.w, a.me, foe);
    const evs = step(a, 2);
    const extra = dmgOn(evs, 'ervet_dawnglass_edge', foe, 'magic');
    check('Dawnglass Edge: every attack adds 2% of her max hp as magic damage', extra.length >= 1 && near(extra[0].amount, a.me.maxHp * 0.02, 1), [extra[0]?.amount, a.me.maxHp * 0.02]);
    check('Dawnglass Edge: whole form does not cleave', dmgOn(evs, 'ervet_dawnglass_edge', foe, 'phys').length === 0);
  }
  { // A1 Heavy Arc / A2 Glass Guard (whole)
    const a = arena('ervet', { foes: [2, -2] });
    const [foe, behind] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: 20, y: Y }, 0.8);
    check('Heavy Arc: casts', res === 'ok', res);
    check('Heavy Arc: magic damage and a slow in the arc, none behind her', dmgOn(evs, 'ervet_heavy_arc', foe, 'magic').length === 1 && hasStatus(foe, 'slow') && dmgOn(evs, 'ervet_heavy_arc', behind).length === 0);
    refresh(a);
    const g = cast(a, 'a2', {}, 0.4);
    const sh = ofType(g.evs, 'shield').filter((s) => s.dst === a.me.id);
    check('Glass Guard: shields herself for 90 + 10% max hp', sh.length === 1 && sh[0].amount >= 90 + 0.1 * a.me.maxHp - 1, sh[0]?.amount);
  }
  { // A3 Shatter -> Hilt form: stats, kit swap, 6 s timeout; Quick Jab, Shard Kick, Reform
    const a = arena('ervet', { foes: [2, 5] });
    const [foe, far] = a.foes;
    const armWhole = a.me.stats.armor, asWhole = a.me.stats.attackSpeed, msWhole = a.me.stats.moveSpeed;
    const { res, evs } = cast(a, 'a3', {}, 0.7);
    check('Shatter: casts', res === 'ok', res);
    check('Shatter: magic damage and a 40% slow within 3 m, none at 5 m', dmgOn(evs, 'ervet_shatter', foe, 'magic').length === 1 && hasStatus(foe, 'slow') && dmgOn(evs, 'ervet_shatter', far).length === 0);
    check('Shatter: leaves a shard field zone (bespoke ervet_a3_shatter)', zoneUp(a, 'ervet_shards') && ofType(evs, 'area').some((x) => x.vfx === 'ervet_a3_shatter'));
    check('Shatter: switches her to Hilt form', a.me.form === 'hilt', a.me.form);
    check('Hilt: a1 a2 a3 become Quick Jab, Shard Kick, Reform', ['ervet_quick_jab', 'ervet_shard_kick', 'ervet_reform'].every((id, i) => a.me.slots[SLOT_INDEX[SLOTS[i]]]!.id === id),
      SLOTS.slice(0, 3).map((s) => a.me.slots[SLOT_INDEX[s]]!.id));
    check('Hilt: -30 armor from the whole value (15 less than base), +30% attack speed, +20% move speed', near(a.me.stats.armor, armWhole - 30, 0.5) && a.me.stats.attackSpeed > asWhole * 1.18 &&
      near(a.me.stats.moveSpeed, msWhole * 1.2, 0.05), [armWhole, a.me.stats.armor, asWhole, a.me.stats.attackSpeed, msWhole, a.me.stats.moveSpeed]);
    check('Hilt: attack reach 1.7 m', near(a.me.stats.range, 1.7, 0.01), a.me.stats.range);
    const stashed = a.me.slots[SLOT_INDEX.a3]!.stash?.get('ervet_shatter') ?? 0;
    check('Hilt: Shatter\'s cooldown is stashed and keeps ticking', stashed > 10 && stashed < 12, stashed);
    // Quick Jab: 3 m dash, stops at the first enemy
    foe.x = 12.5; foe.y = Y; a.w.hashDirty = true;
    const j = cast(a, 'a1', { x: 20, y: Y }, 0.6);
    check('Quick Jab: dash, then magic damage on the first enemy', ofType(j.evs, 'dash').length >= 1 && dmgOn(j.evs, 'ervet_quick_jab', foe, 'magic').length === 1, a.me.x);
    // Shard Kick: three shards in a fan all land on a target at point-blank range
    a.me.x = 10; a.me.y = Y; foe.x = 12; foe.y = Y; foe.statuses.length = 0; a.w.hashDirty = true;
    const k = cast(a, 'a2', { x: 20, y: Y }, 0.8);
    check('Shard Kick: three shards hit a target at 2 m (magic damage x3, slow)', dmgOn(k.evs, 'ervet_shard_kick', foe, 'magic').length === 3 && hasStatus(foe, 'slow'), dmgOn(k.evs, 'ervet_shard_kick', foe).length);
    check('Shard Kick: projectile events carry lib_shard_volley', ofType(k.evs, 'projectile').filter((p) => p.ability === 'ervet_shard_kick').length === 3 && ofType(k.evs, 'projectile').some((p) => p.vfx === 'lib_shard_volley'));
    // Reform: area damage and back to the whole blade; Shatter's cooldown kept ticking while she held the hilt
    a.me.x = 10; a.me.y = Y; foe.x = 11.5; foe.y = Y; a.w.hashDirty = true;
    const r = cast(a, 'a3', {}, 0.5);
    check('Reform: magic damage within 2 m', dmgOn(r.evs, 'ervet_reform', foe, 'magic').length === 1);
    check('Reform: the blade is whole again (form cleared, kit restored)', a.me.form === null && a.me.slots[SLOT_INDEX.a1]!.id === 'ervet_heavy_arc' && a.me.slots[SLOT_INDEX.a3]!.id === 'ervet_shatter');
    check('Reform: Shatter is still on cooldown after the swap back (stashed time kept running)', a.me.slots[SLOT_INDEX.a3]!.cooldown > 6 && a.me.slots[SLOT_INDEX.a3]!.cooldown < 11, a.me.slots[SLOT_INDEX.a3]!.cooldown);
    // timeout
    refresh(a);
    cast(a, 'a3', {}, 0.5);
    check('Shatter again: Hilt', a.me.form === 'hilt');
    step(a, 6.2);
    check('Hilt reverts by itself after 6 s', a.me.form === null && a.me.slots[SLOT_INDEX.a1]!.id === 'ervet_heavy_arc', a.me.form);
  }
  { // ultimate Whole Again: leap, area damage + airborne, oversized blade (great form): +0.6 m reach and a 120 degree cleave on attacks
    const a = arena('ervet', { foes: [8, 12, 8.4], foeDy: [0, 0, 1.2] });
    const [foe, far, side] = a.foes;
    const { res, evs } = cast(a, 'ult', { x: 16, y: Y }, 1.2);
    check('Whole Again: casts', res === 'ok', res);
    check('Whole Again: leap (dash event) lands near the point', ofType(evs, 'dash').some((d) => d.src === a.me.id) && near(a.me.x, 16, 0.6), a.me.x);
    check('Whole Again: magic damage and airborne within 3.5 m, none at 6 m', dmgOn(evs, 'ervet_whole_again', foe, 'magic').length === 1 && statusOn(evs, foe, 'airborne') && dmgOn(evs, 'ervet_whole_again', far).length === 0);
    check('Whole Again: the bespoke ervet_ult_whole preset reaches the presentation', ofType(evs, 'area').some((x) => x.vfx === 'ervet_ult_whole'));
    check('Whole Again: great form, attack reach 2.6 m', a.me.form === 'great' && near(a.me.stats.range, 2.6, 0.01), [a.me.form, a.me.stats.range]);
    foe.statuses.length = 0; side.statuses.length = 0;
    issueAttack(a.w, a.me, foe);
    const hits = step(a, 2.5);
    check('Great Blade: the attack cleaves a secondary target in the arc (phys)', dmgOn(hits, 'ervet_dawnglass_edge', side, 'phys').length >= 1);
    check('Great Blade: the primary target is not hit twice (no cleave damage on it)', dmgOn(hits, 'ervet_dawnglass_edge', foe, 'phys').length === 0 && dmgOn(hits, 'ervet_dawnglass_edge', foe, 'magic').length >= 1);
    step(a, 6);
    check('Great Blade: ends after 6 s, reach back to 2 m', a.me.form === null && near(a.me.stats.range, 2, 0.01), [a.me.form, a.me.stats.range]);
  }
  { // the ultimate from the Hilt: the great form replaces it and the whole kit returns
    const a = arena('ervet', { foes: [3] });
    cast(a, 'a3', {}, 0.5);
    check('hilt then ult: in Hilt first', a.me.form === 'hilt');
    a.me.slots[SLOT_INDEX.ult]!.cooldown = 0;
    const { res } = cast(a, 'ult', { x: 14, y: Y }, 1);
    check('hilt then ult: the ultimate casts from the Hilt', res === 'ok', res);
    check('hilt then ult: great form with the whole kit back', a.me.form === 'great' && a.me.slots[SLOT_INDEX.a1]!.id === 'ervet_heavy_arc', [a.me.form, a.me.slots[SLOT_INDEX.a1]!.id]);
  }
});

// ── 11 · Nurrow (Striker, res_tally) ───────────────────────────────────────────────────────────────
section('nurrow', () => {
  { // A1 Felt Step: 4 m lunge toward a point, stops at the first enemy fighter, magic damage; passes minions
    const a = arena('nurrow', { foes: [3.2] });
    const [foe] = a.foes;
    const minion = addUnit(a.w, 'fx_minion', 1, 11.5, Y);
    const { res, evs } = cast(a, 'a1', { x: 14, y: Y }, 0.8);
    check('Felt Step: casts at 0 Tally', res === 'ok', res);
    check('Felt Step: dash then magic damage on the fighter', ofType(evs, 'dash').length >= 1 && dmgOn(evs, 'nurrow_felt_step', foe, 'magic').length === 1);
    check('Felt Step: passes the minion', dmgOn(evs, 'nurrow_felt_step', minion).length === 0);
    check('Felt Step: stops short of the fighter', a.me.x > 11.5 && a.me.x < 13, a.me.x);
    check('Felt Step: landing an ability builds Tally', a.me.res >= 5, a.me.res);
  }
  { // A2 Lullaby Dart: sleep on the first enemy fighter, no damage; damage wakes
    const a = arena('nurrow', { foes: [5, 8] });
    const [foe, behind] = a.foes;
    const { res, evs } = cast(a, 'a2', { x: 20, y: Y }, 0.9);
    check('Lullaby Dart: casts', res === 'ok', res);
    check('Lullaby Dart: the first enemy fighter falls asleep, the one behind does not', hasStatus(foe, 'sleep') && !hasStatus(behind, 'sleep'));
    check('Lullaby Dart: no damage at all', ofType(evs, 'damage').filter((d) => d.src === a.me.id).length === 0);
    check('Lullaby Dart: the projectile carries nurrow_a2_lullaby and the hit nurrow_a2_drowse', ofType(evs, 'projectile').some((p) => p.vfx === 'nurrow_a2_lullaby') && ofType(evs, 'hit').some((h) => h.vfx === 'nurrow_a2_drowse'));
    dealDamage(a.w, behind, foe, 5, 'true');
    check('Lullaby Dart: damage wakes the sleeper', !hasStatus(foe, 'sleep'));
  }
  { // A3 Snuff (35 Tally): adjacent enemy, magic damage + silence; refused with no Tally
    const a = arena('nurrow', { foes: [1.5] });
    const [foe] = a.foes;
    a.me.res = 0;
    check('Snuff: refused at 0 Tally', tryCast(a.w, a.me, SLOT_INDEX.a3, undefined, undefined, foe.id) === 'cost');
    a.me.res = 100;
    const { res, evs } = cast(a, 'a3', { target: foe }, 0.5);
    check('Snuff: casts at 100 Tally', res === 'ok', res);
    check('Snuff: magic damage and silence', dmgOn(evs, 'nurrow_snuff', foe, 'magic').length === 1 && statusOn(evs, foe, 'silence'));
    check('Snuff: spends 35 Tally (the hit gives 5 back)', a.me.res >= 65 && a.me.res <= 72, a.me.res);
  }
  { // Ultimate Lull the Rest: lunge to the named fighter; every OTHER enemy fighter within 5 m of it sleeps 2 s
    const a = arena('nurrow', { foes: [5, 6.5, 7, 16], foeDy: [0, 1.5, -2, 0] });
    const [target, b1, b2, far] = a.foes;
    const { res, evs } = cast(a, 'ult', { target }, 1.2);
    check('Lull the Rest: casts on an enemy fighter within 6 m', res === 'ok', res);
    check('Lull the Rest: magic damage on the named target, who stays awake', dmgOn(evs, 'nurrow_lull_the_rest', target, 'magic').length === 1 && !hasStatus(target, 'sleep'));
    check('Lull the Rest: the others near them sleep', hasStatus(b1, 'sleep') && hasStatus(b2, 'sleep'));
    check('Lull the Rest: the far one does not', !hasStatus(far, 'sleep'));
    check('Lull the Rest: she lands beside the target', dist(a.me, target) < 1.8, dist(a.me, target));
    check('Lull the Rest: the bespoke nurrow_ult_lull preset reaches the presentation', ofType(evs, 'area').some((x) => x.vfx === 'nurrow_ult_lull'));
    step(a, 2.2);
    check('Lull the Rest: the sleep ends after 2 s', !hasStatus(b1, 'sleep'));
    const min = arena('nurrow', {});
    const m = addUnit(min.w, 'fx_minion', 1, 13, Y);
    check('Lull the Rest: a minion is not a valid target', tryCast(min.w, min.me, SLOT_INDEX.ult, undefined, undefined, m.id) === 'target');
  }
  { // passive Quiet Kill: a takedown puts enemy fighters within 5 m to sleep for 1 s
    const a = arena('nurrow', { foes: [2, 4, 9] });
    const [victim, near1, far] = a.foes;
    victim.hp = 1;
    const n = a.w.events.length;
    killEntity(a.w, victim, a.me);
    const evs = a.w.events.slice(n).concat(step(a, 0.1));
    check('Quiet Kill: a fighter within 5 m falls asleep', hasStatus(near1, 'sleep') || statusOn(evs, near1, 'sleep'));
    check('Quiet Kill: one at 9 m does not', !hasStatus(far, 'sleep') && !statusOn(evs, far, 'sleep'));
  }
});

// ── 12 · Lisvel (Slinger, res_light) ───────────────────────────────────────────────────────────────
section('lisvel', () => {
  { // A1 Dawn Line: piercing arrow; the path stays lit 3 s: allies and Lisvel +25% speed, enemies slowed; passive Reach of Morning
    const a = arena('lisvel', { foes: [4, 7, 5.5], foeDy: [0, 0, 3], allies: [2] });
    const [f0, f1, off] = a.foes, [ally] = a.allies;
    const { res, evs } = cast(a, 'a1', { x: 20, y: Y }, 0.8);
    check('Dawn Line: casts', res === 'ok', res);
    check('Dawn Line: phys damage on every enemy on the path (pierce), none off it', dmgOn(evs, 'lisvel_dawn_line', f0, 'phys').length === 1 && dmgOn(evs, 'lisvel_dawn_line', f1, 'phys').length === 1 &&
      dmgOn(evs, 'lisvel_dawn_line', off).length === 0);
    check('Dawn Line: the lit path hastes the ally on it and Lisvel herself', statusOn(evs, ally, 'haste') && statusOn(evs, a.me, 'haste'));
    check('Dawn Line: enemies on the path are slowed, the one off it is not', statusOn(evs, f0, 'slow') && statusOn(evs, f1, 'slow') && !statusOn(evs, off, 'slow'));
    check('Dawn Line: the lit path is the bespoke lisvel_a1_line preset', ofType(evs, 'area').some((x) => x.vfx === 'lisvel_a1_line'));
    check('Reach of Morning: one stack per enemy fighter hit (two), +0.4 m each', findBuff(a.me, 'lisvel_reach')?.stacks === 2 && near(a.me.stats.range, 5.9 + 0.8, 0.01), [findBuff(a.me, 'lisvel_reach')?.stacks, a.me.stats.range]);
    step(a, 3.2);
    check('Dawn Line: the path fades after 3 s', !zoneUp(a, 'lisvel_line_haste') && !zoneUp(a, 'lisvel_line_snare'));
  }
  { // A2 Backstep: hop 3 m away from the cursor; the next attack reaches 2 m farther and slows 25%
    const a = arena('lisvel', { foes: [5] });
    const [foe] = a.foes;
    const { res } = cast(a, 'a2', { x: 20, y: Y }, 0.5);
    check('Backstep: casts', res === 'ok', res);
    check('Backstep: she hopped 3 m away from the cursor (to -x)', near(a.me.x, 7, 0.4), a.me.x);
    check('Backstep: empowered next attack buff', hasBuff(a.me, 'lisvel_backstep_shot'));
    foe.x = 15; foe.y = Y; a.w.hashDirty = true; a.w.vision.update(a.w.entities, a.w.tick);
    const dd = Math.hypot(foe.x - a.me.x, foe.y - a.me.y);
    check('Backstep: the target now stands beyond her normal reach (5.9 m + radii)', dd > 5.9 + 1.05 && dd < 5.9 + 2 + 1, dd);
    issueAttack(a.w, a.me, foe);
    step(a, 0.2);
    check('Backstep: she starts the attack from where she stands (reach +2 m: no walking first)', near(a.me.x, 7, 0.05) && a.me.atkWindup >= 0, [a.me.x, a.me.atkWindup]);
    step(a, 1.2);
    check('Backstep: the empowered attack slows the target 25% and the empowerment is spent', hasStatus(foe, 'slow') && !hasBuff(a.me, 'lisvel_backstep_shot'), [hasStatus(foe, 'slow')]);
  }
  { // A3 Morning Draw: +50% attack speed at rank 5 for 4 s
    const a = arena('lisvel', {});
    const as0 = a.me.stats.attackSpeed;
    cast(a, 'a3', {}, 0.2);
    check('Morning Draw: +50% of base attack speed at rank 5', near(a.me.stats.attackSpeed - as0, 0.5 * ((baseOf('lisvel').base as Any).attackSpeed as number), 0.01), [as0, a.me.stats.attackSpeed]);
    step(a, 4.2);
    check('Morning Draw: ends after 4 s', near(a.me.stats.attackSpeed, as0, 0.01));
  }
  { // Ultimate Sun Corridor: after 0.75 s a 14 x 3 m shaft: damage + slow; allies +30% speed; Lisvel +20% attack speed inside
    const a = arena('lisvel', { foes: [6, 13, 6, -3], foeDy: [0, 0, 3, 0], allies: [4] });
    const [f0, f1, off, behind] = a.foes, [ally] = a.allies;
    const { res, evs } = cast(a, 'ult', { x: 30, y: Y }, 1.6);
    check('Sun Corridor: casts (14 m, edge marker past 10 m)', res === 'ok', res);
    check('Sun Corridor: damage lands after the delay on both enemies in the shaft (13 m is still inside 14)', dmgOn(evs, 'lisvel_sun_corridor', f0, 'phys').length === 1 && dmgOn(evs, 'lisvel_sun_corridor', f1, 'phys').length === 1);
    check('Sun Corridor: not outside the 3 m width, not behind her', dmgOn(evs, 'lisvel_sun_corridor', off).length === 0 && dmgOn(evs, 'lisvel_sun_corridor', behind).length === 0);
    check('Sun Corridor: enemies in it are slowed', hasStatus(f0, 'slow') || statusOn(evs, f0, 'slow'));
    check('Sun Corridor: the delay is telegraphed (area event with delay 0.75 and the bespoke preset)', ofType(evs, 'area').some((x) => x.ability === 'lisvel_sun_corridor' && near(x.delay, 0.75) && x.vfx === 'lisvel_ult_corridor'));
    check('Sun Corridor: allies inside move faster; she gains attack speed', statusOn(evs, ally, 'haste') && hasBuff(a.me, 'lisvel_corridor_draw'));
    step(a, 5.5);
    check('Sun Corridor: gone after 5 s', !zoneUp(a, 'lisvel_corridor_haste') && !zoneUp(a, 'lisvel_corridor_draw') && !hasBuff(a.me, 'lisvel_corridor_draw'));
  }
});

// ── 13 · Ulkro (Slinger, res_tally) ────────────────────────────────────────────────────────────────
section('ulkro', () => {
  { // passive Run-up: a stack per 4 m run (max 4)
    const a = arena('ulkro', {});
    check('Run-up: no stacks standing still', counterValue(a.me, 'ulkro_runup') === 0);
    issueMove(a.w, a.me, 23, Y, false);
    step(a, 4.2);
    const n = counterValue(a.me, 'ulkro_runup');
    check('Run-up: 13 m of running gives 3 stacks', n === 3, n);
    issueMove(a.w, a.me, 40, Y, false);
    step(a, 5);
    check('Run-up: capped at 4 stacks', counterValue(a.me, 'ulkro_runup') === 4, counterValue(a.me, 'ulkro_runup'));
    issueMove(a.w, a.me, a.me.x, a.me.y, false);
    step(a, 9);
    check('Run-up: the stacks fade 8 s after the last one', counterValue(a.me, 'ulkro_runup') === 0, counterValue(a.me, 'ulkro_runup'));
  }
  { // A1 Hurl: +25% damage per Run-up stack and spends them all
    const a = arena('ulkro', { foes: [6] });
    const [foe] = a.foes;
    const c0 = cast(a, 'a1', { x: 20, y: Y }, 1);
    const d0 = total(dmgOn(c0.evs, 'ulkro_hurl', foe, 'phys'));
    check('Hurl: casts and deals phys damage with no stacks', c0.res === 'ok' && d0 > 100, [c0.res, d0]);
    refresh(a); a.me.x = 10; a.me.y = Y;
    addCounter(a.me, 'ulkro_runup', 4, 4);
    const c4 = cast(a, 'a1', { x: 20, y: Y }, 1);
    const d4 = total(dmgOn(c4.evs, 'ulkro_hurl', foe, 'phys'));
    check('Hurl: four stacks double the damage (+25% each)', near(d4 / d0, 2, 0.03), [d0, d4]);
    check('Hurl: spends all the stacks', counterValue(a.me, 'ulkro_runup') === 0, counterValue(a.me, 'ulkro_runup'));
    refresh(a); a.me.x = 10; a.me.y = Y;
    addCounter(a.me, 'ulkro_runup', 3, 4);
    cast(a, 'a1', { x: 20, y: 80 }, 0.5); // thrown wide: misses, keeps the stacks
    check('Hurl: a miss keeps the stacks', counterValue(a.me, 'ulkro_runup') === 3, counterValue(a.me, 'ulkro_runup'));
  }
  { // A2 Bound: 4 m leap and +2 stacks
    const a = arena('ulkro', {});
    const { res, evs } = cast(a, 'a2', { x: 14, y: Y }, 0.6);
    check('Bound: casts at 0 Tally', res === 'ok', res);
    check('Bound: a 4 m leap', ofType(evs, 'dash').length >= 1 && near(a.me.x, 14, 0.4), a.me.x);
    check('Bound: +2 Run-up stacks', counterValue(a.me, 'ulkro_runup') === 2, counterValue(a.me, 'ulkro_runup'));
  }
  { // A3 Hamstring Dart (35 Tally): damage, 40% slow, revealed
    const a = arena('ulkro', { foes: [5] });
    const [foe] = a.foes;
    a.me.res = 0;
    check('Hamstring Dart: refused at 0 Tally', tryCast(a.w, a.me, SLOT_INDEX.a3, undefined, undefined, foe.id) === 'cost');
    a.me.res = 100;
    const { res, evs } = cast(a, 'a3', { target: foe }, 0.5);
    check('Hamstring Dart: casts at range', res === 'ok', res);
    check('Hamstring Dart: phys damage, slow and reveal', dmgOn(evs, 'ulkro_hamstring_dart', foe, 'phys').length === 1 && statusOn(evs, foe, 'slow') && statusOn(evs, foe, 'reveal'));
    check('Hamstring Dart: spends 35 Tally (the hit gives 5 back)', a.me.res >= 65 && a.me.res <= 72, a.me.res);
  }
  { // Ultimate Long Run (40 Tally): 5 s of +35% move speed; every 3 m a dart at the nearest enemy fighter within 7 m
    const a = arena('ulkro', { foes: [5, 10, 15, 20], foeDy: [3, 3, 3, 3] });
    const ms0 = a.me.stats.moveSpeed;
    a.me.res = 0;
    check('Long Run: refused at 0 Tally', tryCast(a.w, a.me, SLOT_INDEX.ult) === 'cost');
    a.me.res = 100;
    const { res, evs } = cast(a, 'ult', {}, 0.3);
    check('Long Run: casts at 40 Tally', res === 'ok', res);
    check('Long Run: the bespoke ulkro_ult_run preset reaches the presentation', ofType(evs, 'area').some((x) => x.vfx === 'ulkro_ult_run'));
    check('Long Run: form long_run, 35% faster', a.me.form === 'long_run' && near(a.me.stats.moveSpeed, ms0 * 1.35, 0.05), [a.me.form, ms0, a.me.stats.moveSpeed]);
    issueMove(a.w, a.me, 33, Y, false);
    const run = step(a, 4.6);
    const darts = ofType(run, 'projectile').filter((p) => p.ability === 'ulkro_run_up');
    const dmg = ofType(run, 'damage').filter((d) => d.ability === 'ulkro_run_up' && d.src === a.me.id && d.dtype === 'phys');
    check('Long Run: darts fly while she runs (one per 3 m)', darts.length >= 5, darts.length);
    check('Long Run: they hit enemy fighters for phys damage', dmg.length >= 4, dmg.length);
    step(a, 1);
    check('Long Run: ends after 5 s', a.me.form === null && near(a.me.stats.moveSpeed, ms0, 0.05), [a.me.form, a.me.stats.moveSpeed]);
    const idle = arena('ulkro', { foes: [5] });
    idle.me.res = 100;
    cast(idle, 'ult', {}, 6);
    check('Long Run: standing still sends no darts', ofType(idle.w.events, 'projectile').filter((p) => p.ability === 'ulkro_run_up').length === 0);
  }
});

// ── 14 · Tunlan (Caster, res_heat) ─────────────────────────────────────────────────────────────────
section('tunlan', () => {
  { // A1 Hound Shadow: pierces; magic damage + fear; passive Startle slows once per 8 s per enemy; Heat +20
    const a = arena('tunlan', { foes: [3, 6, 5], foeDy: [0, 0, 3.5] });
    const [f0, f1, off] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: 20, y: Y }, 0.35);
    check('Hound Shadow: casts', res === 'ok', res);
    check('Hound Shadow: +20 Heat', a.me.res >= 19 && a.me.res <= 21, a.me.res);
    const rest = step(a, 1.0);
    const all = [...evs, ...rest];
    check('Hound Shadow: magic damage and fear on every enemy it touches (pierce), none off the line', dmgOn(all, 'tunlan_hound_shadow', f0, 'magic').length === 1 && dmgOn(all, 'tunlan_hound_shadow', f1, 'magic').length === 1 &&
      statusOn(all, f0, 'fear') && statusOn(all, f1, 'fear') && dmgOn(all, 'tunlan_hound_shadow', off).length === 0);
    check('Hound Shadow: the projectile carries tunlan_a1_hound', ofType(all, 'projectile').some((p) => p.ability === 'tunlan_hound_shadow' && p.vfx === 'tunlan_a1_hound'));
    const startle = statusEvs(all, f0, 'slow').filter((s) => near(s.duration, 1, 0.05));
    check('Startle: the first ability hit slows each enemy fighter for 1 s', startle.length === 1 && statusEvs(all, f1, 'slow').some((s) => near(s.duration, 1, 0.05)));
    refresh(a); a.me.x = 10; a.me.y = Y;
    const again = cast(a, 'a1', { x: 20, y: Y }, 1.4);
    check('Startle: a second hit inside 8 s does not slow again', statusEvs(again.evs, f0, 'slow').filter((s) => near(s.duration, 1, 0.05)).length === 0, again.evs.length);
  }
  { // A2 Hand Shadow: damage + 60% fading slow; a feared enemy is stunned instead
    const a = arena('tunlan', { foes: [5] });
    const [foe] = a.foes;
    const c1 = cast(a, 'a2', { target: foe }, 0.4);
    check('Hand Shadow: casts at 5 m', c1.res === 'ok', c1.res);
    check('Hand Shadow: magic damage and a 1.5 s slow, no stun', dmgOn(c1.evs, 'tunlan_hand_shadow', foe, 'magic').length === 1 && statusEvs(c1.evs, foe, 'slow').some((s) => near(s.duration, 1.5, 0.05)) && !statusOn(c1.evs, foe, 'stun'));
    foe.statuses.length = 0; foe.marks.length = 0;
    refresh(a);
    applyStatus(a.w, a.me, foe, 'fear', 3);
    const c2 = cast(a, 'a2', { target: foe }, 0.4);
    check('Hand Shadow on a feared enemy: stunned (1.2 s at rank 5), the 1.5 s slow is not applied', statusEvs(c2.evs, foe, 'stun').some((s) => near(s.duration, 1.2, 0.05)) &&
      !statusEvs(c2.evs, foe, 'slow').some((s) => near(s.duration, 1.5, 0.05)), statusEvs(c2.evs, foe, 'stun').length);
  }
  { // A3 Lamp Flare: push back 1.5 m + slow 30%
    const a = arena('tunlan', { foes: [2] });
    const [foe] = a.foes;
    const x0 = foe.x;
    const { res, evs } = cast(a, 'a3', {}, 0.6);
    check('Lamp Flare: casts', res === 'ok', res);
    check('Lamp Flare: pushed back about 1.5 m and slowed', foe.x > x0 + 1.0 && statusOn(evs, foe, 'slow'), [x0, foe.x]);
    check('Lamp Flare: costs 20 Heat', a.me.res >= 19, a.me.res);
  }
  { // Ultimate Shadow Play: cone after 0.6 s: damage + fear; +30 Heat
    const a = arena('tunlan', { foes: [6, 6, -4], foeDy: [0, 5, 0] });
    const [foe, wide, behind] = a.foes;
    const { res, evs } = cast(a, 'ult', { x: 20, y: Y }, 1.5);
    check('Shadow Play: casts', res === 'ok', res);
    check('Shadow Play: magic damage and fear inside the 9 m, 50 degree cone', dmgOn(evs, 'tunlan_shadow_play', foe, 'magic').length === 1 && statusOn(evs, foe, 'fear'));
    check('Shadow Play: none outside the cone or behind her', dmgOn(evs, 'tunlan_shadow_play', wide).length === 0 && dmgOn(evs, 'tunlan_shadow_play', behind).length === 0);
    check('Shadow Play: the delay is telegraphed and carries tunlan_ult_play', ofType(evs, 'area').some((x) => x.ability === 'tunlan_shadow_play' && near(x.delay, 0.6) && x.vfx === 'tunlan_ult_play'));
    check('Shadow Play: +30 Heat', a.me.res >= 25, a.me.res);
  }
  { // Heat rhythm: all four abilities come to 95; the next cast overheats her and locks casting
    const a = arena('tunlan', { foes: [3] });
    a.me.res = 90;
    const c = cast(a, 'a1', { x: 20, y: Y }, 0.3);
    check('Heat: a cast that fills the bar overheats her', c.res === 'ok' && a.me.overheat > 0, [a.me.res, a.me.overheat]);
    check('Heat: casting is refused while overheated', tryCast(a.w, a.me, SLOT_INDEX.a3) === 'cost');
  }
});

// ── 15 · Vashil (Caster, res_light) ────────────────────────────────────────────────────────────────
section('vashil', () => {
  { // passive Hum: ability one hums an enemy fighter 3 s; ability two inside it stuns 0.75 s and ends the hum; lockout 8 s
    const a = arena('vashil', { foes: [5] });
    const [foe] = a.foes;
    const c1 = cast(a, 'a2', { x: 20, y: Y }, 0.8);
    check('Hum: Glass Chime hits and leaves the enemy humming', dmgOn(c1.evs, 'vashil_glass_chime', foe, 'magic').length === 1 && markStacks(foe, 'vashil_hum', a.me) === 1 && !statusOn(c1.evs, foe, 'stun'));
    refresh(a);
    const c2 = cast(a, 'a2', { x: 20, y: Y }, 0.8);
    const stun = statusEvs(c2.evs, foe, 'stun');
    check('Hum: a second ability hit stuns for 0.75 s and ends the hum', stun.length === 1 && near(stun[0].duration, 0.75, 0.05) && markStacks(foe, 'vashil_hum', a.me) === 0, stun.length);
    check('Hum: the stunned enemy is locked out of humming for 8 s', markStacks(foe, 'vashil_hushed', a.me) === 1);
    refresh(a);
    const c3 = cast(a, 'a2', { x: 20, y: Y }, 0.8);
    check('Hum: a third hit inside the lockout neither stuns nor hums', !statusOn(c3.evs, foe, 'stun') && markStacks(foe, 'vashil_hum', a.me) === 0);
    step(a, 8.2); refresh(a);
    const c4 = cast(a, 'a2', { x: 20, y: Y }, 0.8);
    check('Hum: after 8 s the enemy hums again', markStacks(foe, 'vashil_hum', a.me) === 1 && dmgOn(c4.evs, 'vashil_glass_chime', foe).length === 1);
  }
  { // A1 Peal: a ring from 1.5 m to 3.5 m around the point; the centre stays quiet
    const a = arena('vashil', { foes: [7, 9.5, 12], foeDy: [0, 0, 0] });
    const [centre, ringFoe, outside] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: 17, y: Y }, 1.2);
    check('Peal: casts at 7 m', res === 'ok', res);
    check('Peal: the area is telegraphed 0.4 s ahead with the bespoke preset', ofType(evs, 'area').some((x) => x.ability === 'vashil_peal' && near(x.delay, 0.4) && x.vfx === 'vashil_a1_peal'));
    check('Peal: magic damage and a slow on the enemy in the ring', dmgOn(evs, 'vashil_peal', ringFoe, 'magic').length === 1 && hasStatus(ringFoe, 'slow'));
    check('Peal: the quiet centre and the far enemy are not hit', dmgOn(evs, 'vashil_peal', centre).length === 0 && dmgOn(evs, 'vashil_peal', outside).length === 0);
  }
  { // A3 Ring Out: cone damage + 2 m knockback
    const a = arena('vashil', { foes: [2.5, -2.5] });
    const [foe, behind] = a.foes;
    const x0 = foe.x;
    const { res, evs } = cast(a, 'a3', { x: 20, y: Y }, 0.6);
    check('Ring Out: casts', res === 'ok', res);
    check('Ring Out: magic damage and a knockback of about 2 m in the cone, nothing behind', dmgOn(evs, 'vashil_ring_out', foe, 'magic').length === 1 && foe.x > x0 + 1.5 && dmgOn(evs, 'vashil_ring_out', behind).length === 0, [x0, foe.x]);
  }
  { // Ultimate Morning Toll: three tolls 0.75 s apart over 4.5 m; the second stuns through Hum
    const a = arena('vashil', { foes: [8, 14], foeDy: [0, 0] });
    const [foe, far] = a.foes;
    const { res, evs } = cast(a, 'ult', { x: 18, y: Y }, 3.4);
    check('Morning Toll: casts at 8 m', res === 'ok', res);
    const hits = dmgOn(evs, 'vashil_morning_toll', foe, 'magic');
    check('Morning Toll: three tolls of magic damage', hits.length === 3, hits.length);
    check('Morning Toll: the tolls are 0.75 s apart', hits.length === 3 && near(hits[1].t - hits[0].t, 0.75, 0.1) && near(hits[2].t - hits[1].t, 0.75, 0.1), hits.map((h) => h.t));
    const stuns = statusEvs(evs, foe, 'stun');
    check('Morning Toll: exactly one stun, on the second toll (through Hum)', stuns.length === 1 && stuns[0].t > hits[0].t && stuns[0].t <= hits[1].t + 0.1, stuns.map((s) => s.t));
    check('Morning Toll: each toll carries vashil_ult_toll', ofType(evs, 'area').filter((x) => x.ability === 'vashil_morning_toll' && x.vfx === 'vashil_ult_toll').length === 3);
    check('Morning Toll: the enemy outside 4.5 m is untouched', dmgOn(evs, 'vashil_morning_toll', far).length === 0);
  }
});

// ── 16 · Sukri (Tender, res_light) ─────────────────────────────────────────────────────────────────
section('sukri', () => {
  { // A1 Mote Toss: after 0.5 s allies in 2.5 m are healed and enemies take magic damage
    const a = arena('sukri', { foes: [6.8], allies: [6] });
    const [foe] = a.foes, [ally] = a.allies;
    ally.hp = ally.maxHp * 0.5;
    const { res, evs } = cast(a, 'a1', { x: 16, y: Y }, 1);
    check('Mote Toss: casts at 6 m', res === 'ok', res);
    check('Mote Toss: the ally is healed (>= 170 at rank 5)', healsOn(evs, ally).length === 1 && healsOn(evs, ally)[0].amount >= 169, healsOn(evs, ally)[0]?.amount);
    check('Mote Toss: the enemy takes magic damage, the ally does not', dmgOn(evs, 'sukri_mote_toss', foe, 'magic').length === 1 && dmgOn(evs, 'sukri_mote_toss', ally).length === 0);
  }
  { // A2 Draw Near: pull an ally up to 5 m and shield them; on himself only a shield
    const a = arena('sukri', { allies: [7] });
    const [ally] = a.allies;
    const { res, evs } = cast(a, 'a2', { target: ally }, 0.7);
    check('Draw Near: casts on an ally at 7 m', res === 'ok', res);
    check('Draw Near: the ally was drawn about 5 m toward him (airborne 0.25 s)', dist(ally, a.me) < 2.6 && dist(ally, a.me) > 1.4 && statusOn(evs, ally, 'airborne'), dist(ally, a.me));
    check('Draw Near: the ally is shielded (>= 180 at rank 5)', ofType(evs, 'shield').filter((s) => s.dst === ally.id).length === 1 && ofType(evs, 'shield').filter((s) => s.dst === ally.id)[0].amount >= 179);
    refresh(a);
    const x0 = a.me.x;
    const self = cast(a, 'a2', { target: a.me }, 0.7);
    check('Draw Near on himself: only a shield (no airborne, no move)', self.res === 'ok' && ofType(self.evs, 'shield').some((s) => s.dst === a.me.id) && !statusOn(self.evs, a.me, 'airborne') && near(a.me.x, x0, 0.01), self.res);
    const foeTry = arena('sukri', { foes: [3] });
    check('Draw Near: an enemy is not a valid target', tryCast(foeTry.w, foeTry.me, SLOT_INDEX.a2, undefined, undefined, foeTry.foes[0].id) === 'target');
  }
  { // A3 Wrap Cast: first enemy fighter rooted and damaged; passes a minion
    const a = arena('sukri', { foes: [5, 8] });
    const [foe, behind] = a.foes;
    const minion = addUnit(a.w, 'fx_minion', 1, 12.5, Y);
    const { res, evs } = cast(a, 'a3', { x: 20, y: Y }, 0.9);
    check('Wrap Cast: casts', res === 'ok', res);
    check('Wrap Cast: the first enemy fighter takes magic damage and is rooted', dmgOn(evs, 'sukri_wrap_cast', foe, 'magic').length === 1 && statusOn(evs, foe, 'root'));
    check('Wrap Cast: the minion in front and the fighter behind are untouched', dmgOn(evs, 'sukri_wrap_cast', minion).length === 0 && !hasStatus(behind, 'root'));
  }
  { // Ultimate Gather In: every ally within 10 m drawn up to 4 m and shielded; a 4 m dust ring slows enemies
    const a = arena('sukri', { allies: [6, 9], foes: [2.5, 14] });
    const [a1, a2] = a.allies, [foe, far] = a.foes;
    const x1 = a1.x, x2 = a2.x;
    const { res, evs } = cast(a, 'ult', {}, 1.1);
    check('Gather In: casts', res === 'ok', res);
    check('Gather In: allies within 10 m are drawn 4 m toward him', near(x1 - a1.x, 4, 0.7) && near(x2 - a2.x, 4, 0.7), [x1 - a1.x, x2 - a2.x]);
    const sh = ofType(evs, 'shield');
    check('Gather In: the allies and Sukri are shielded (>= 190 at rank 3)', [a1, a2, a.me].every((u) => sh.some((s) => s.dst === u.id && s.amount >= 189)));
    check('Gather In: the bespoke sukri_ult_gather preset reaches the presentation', ofType(evs, 'area').some((x) => x.vfx === 'sukri_ult_gather'));
    check('Gather In: the dust ring slows the enemy within 4 m, not the one at 14 m', statusOn(evs, foe, 'slow') && !statusOn(evs, far, 'slow'));
    step(a, 2.5);
    check('Gather In: the dust is gone after 2 s', !zoneUp(a, 'sukri_dust'));
  }
  { // passive Spare Hour: below 30% health, he and allies within 6 m cannot be targeted for 1 s, once per 90 s
    const a = arena('sukri', { allies: [3, 12], foes: [4] });
    const [near1, far1] = a.allies, [foe] = a.foes;
    a.me.hp = a.me.maxHp * 0.4;
    const n = a.w.events.length;
    dealDamage(a.w, foe, a.me, a.me.maxHp * 0.15, 'true');
    const evs = a.w.events.slice(n).concat(step(a, 0.1));
    check('Spare Hour: Sukri and an ally within 6 m become untargetable', hasStatus(a.me, 'untargetable') && hasStatus(near1, 'untargetable') && !a.me.targetable, [hasStatus(a.me, 'untargetable'), hasStatus(near1, 'untargetable')]);
    check('Spare Hour: an ally at 12 m does not, and the enemy does not', !hasStatus(far1, 'untargetable') && !hasStatus(foe, 'untargetable'));
    check('Spare Hour: the bespoke sukri_passive_spare preset reaches the presentation', ofType(evs, 'area').some((x) => x.vfx === 'sukri_passive_spare'));
    step(a, 1.2);
    check('Spare Hour: lasts 1 s', !hasStatus(a.me, 'untargetable') && a.me.targetable);
    a.me.hp = a.me.maxHp * 0.4;
    step(a, 0.2);
    const n2 = a.w.events.length;
    dealDamage(a.w, foe, a.me, a.me.maxHp * 0.15, 'true');
    const again = a.w.events.slice(n2).concat(step(a, 0.1));
    check('Spare Hour: a second dip inside 90 s does not trigger it again', !hasStatus(a.me, 'untargetable') && !statusOn(again, a.me, 'untargetable'));
  }
});

// ── 17 · cross-checks: every ability cast cleanly; cooldowns, costs, presentation ────────────────────
section('every ability: cast, cooldown started, cost paid', () => {
  for (const id of HALF_B) {
    const k = catalog.fighters.find((f) => f.id === id)!;
    for (const s of SLOTS) {
      const def = k.kit[s];
      const a = arena(id, { foes: [3.5], allies: [2] });
      const [foe] = a.foes, [ally] = a.allies;
      a.me.res = a.me.resource!.model === 'pool' ? a.me.maxRes : a.me.resource!.model === 'build' ? 100 : 0;
      const tk = def.targeting.kind;
      const f = def.targeting.filter;
      const wantAlly = tk === 'unit' && f?.allies === true && f?.enemies === false;
      const tgt = tk === 'unit' ? (wantAlly ? ally : foe) : undefined;
      const { res, evs } = cast(a, s, { x: foe.x, y: foe.y, target: tgt }, 1.2);
      check(`${id} ${s} ${def.id}: cast result ok (${res})`, res === 'ok' || res === 'moving');
      const slot = a.me.slots[SLOT_INDEX[s]]!;
      const started = slot.cooldown > 0 || (slot.charges !== undefined && slot.charges < (def.charges?.max ?? 99)) || slot.stash !== null;
      check(`${id} ${s} ${def.id}: cooldown started`, started, [slot.cooldown, slot.charges]);
      evs.push(...step(a, 4)); // let delayed zones, repeats and expiries play out
      const badNum = evs.filter((e) => Object.values(e).some((v) => typeof v === 'number' && !Number.isFinite(v)));
      check(`${id} ${s} ${def.id}: every event field is finite`, badNum.length === 0, badNum.slice(0, 2));
      const castEv = ofType(evs, 'cast').filter((c) => c.src === a.me.id && c.ability === def.id);
      check(`${id} ${s} ${def.id}: one cast event carrying the ability id and slot`, castEv.length === 1 && castEv[0].slot === s, castEv.length);
      const vfx = new Set<string>(), sfx = new Set<string>();
      for (const e of evs) {
        const v = (e as { vfx?: string }).vfx, f2 = (e as { sfx?: string }).sfx;
        if (v) vfx.add(v);
        if (f2) sfx.add(f2);
      }
      check(`${id} ${s} ${def.id}: echoed vfx ids are in content/vfx.json`, [...vfx].every((v) => vfxIds.has(v)), [...vfx].filter((v) => !vfxIds.has(v)));
      check(`${id} ${s} ${def.id}: echoed sfx ids are audio cues`, [...sfx].every((v) => audioCues.has(v)), [...sfx].filter((v) => !audioCues.has(v)));
      if (s === 'ult') {
        const bespoke = [...vfx].filter((v) => v.startsWith(`${id}_ult_`));
        check(`${id} ult: the bespoke ${id}_ult_* preset reaches the presentation`, bespoke.length >= 1, [...vfx]);
      }
    }
  }
});

section('every referenced vfx / sfx / anim in the kit exists', () => {
  for (const f of realFighters) {
    const id = f.id as string;
    const clips = new Set(Object.keys((f.art as Any).clips as Any));
    const bad: string[] = [];
    walk(f, '', (n, p) => {
      if (!p.endsWith('present') && !p.endsWith('present.hit')) return;
      for (const kk of ['vfx', 'hitVfx']) if (typeof n[kk] === 'string' && !vfxIds.has(n[kk] as string)) bad.push(`${p}.${kk}=${n[kk]}`);
      for (const kk of ['sfx', 'hitSfx']) if (typeof n[kk] === 'string' && !audioCues.has(n[kk] as string)) bad.push(`${p}.${kk}=${n[kk]}`);
      if (typeof n.anim === 'string' && !clips.has(n.anim as string)) bad.push(`${p}.anim=${n.anim}`);
    });
    check(`${id}: every present.vfx / sfx / anim exists`, bad.length === 0, bad);
  }
});

section('long run: all eight fight each other for 20 s without throwing', () => {
  const seats: SeatSpec[] = HALF_B.map((id, i) => ({ fighter: id, team: i < 4 ? 0 : 1, x: 8 + (i % 4) * 2.5, y: Y - (i < 4 ? 0 : 3) }));
  const w = makeWorld(catalog, seats);
  for (let i = 0; i < HALF_B.length; i++) {
    const e = fighterEnt(w, i);
    setLevel(w, e, 18);
    for (let r = 0; r < 5; r++) for (const s of SLOTS) levelUpAbility(w, e, s);
    e.hp = e.maxHp; e.res = e.resource?.model === 'pool' ? e.maxRes : e.resource?.model === 'build' ? 100 : 0;
    e.autoAttack = true;
  }
  w.hashDirty = true;
  w.vision.update(w.entities, w.tick);
  let nan = 0, casts = 0;
  for (let t = 0; t < 20 * TICK_HZ; t++) {
    if (t % 15 === 0) {
      for (let i = 0; i < HALF_B.length; i++) {
        const me = fighterEnt(w, i);
        const foe = fighterEnt(w, (i + 4) % 8);
        for (const s of SLOTS) if (tryCast(w, me, SLOT_INDEX[s], foe.x, foe.y, foe.id) === 'ok') casts++;
      }
    }
    for (const ev of w.step()) if ('amount' in ev && !Number.isFinite((ev as { amount: number }).amount)) nan++;
  }
  check('20 s of 4v4 half-B fighting: abilities cast', casts >= 16, casts);
  check('20 s of 4v4 half-B fighting: no NaN amounts', nan === 0, nan);
  check('20 s of 4v4 half-B fighting: every entity has finite hp and position', w.entities.every((e) => Number.isFinite(e.hp) && Number.isFinite(e.x) && Number.isFinite(e.y)));
});

finish('probe_kits_B');
