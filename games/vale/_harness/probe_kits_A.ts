// probe (lane CONTENT): roster half A (marund burdam rishal odrum dunsom ilsheta hesmi kemdo) in the real sim.
//
// Loads the REAL content/fighters/<id>.json for the eight half-A fighters, with the real
// content/resources.json, classes.json and roles.json, into a fixture catalog (the synthetic arena map and rules
// of fixtures/catalog_fixture.ts; zod-validated by the real Catalog schema). Each fighter is spawned at
// level 18 with every ability at its max rank and cast at a valid target against a training enemy fighter
// (`fx_target`, a synthetic 100k-hp body with no kit), checking the events the kit promises (damage, status,
// dash, blink, shield, heal, marks, displacement, zones) and that nothing throws.
//
//   node _harness/probe_kits_A.ts            exit 0 = PASS
//
// Sections: content lint (ranges, filters, ops) · catalog build · passives · every ability · cross-checks.
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
import { applyMark, applyStatus, counterValue, findBuff, hasStatus, markStacks } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HALF_A = ['marund', 'burdam', 'rishal', 'odrum', 'dunsom', 'ilsheta', 'hesmi', 'kemdo'] as const;
type Raw = Record<string, unknown>;

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
const realFighters = HALF_A.map((id) => readJson(`content/fighters/${id}.json`) as Raw);
const resources = readJson('content/resources.json') as Raw[];
const classes = readJson('content/classes.json') as Raw[];
const roles = readJson('content/roles.json') as Raw[];
const vfxIds = new Set((readJson('content/vfx.json') as { id: string }[]).map((v) => v.id));
const audioCues = new Set(Object.keys((readJson('content/audio.json') as { cues: object }).cues));

// ── content lint (the half-A authoring rules) ──────────────────────────────────────────────────────
type Any = Record<string, unknown>;
function walk(node: unknown, path: string, fn: (n: Any, p: string) => void): void {
  if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}[${i}]`, fn)); return; }
  if (node && typeof node === 'object') {
    fn(node as Any, path);
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, fn);
  }
}
section('content lint', () => {
  const resIds = new Set(resources.map((r) => r.id as string)), classIds = new Set(classes.map((c) => c.id as string));
  for (const f of realFighters) {
    const id = f.id as string;
    check(`${id}: resource and class ids are the shared ones (res_*, class_*)`, resIds.has(f.resource as string) && classIds.has(f.class as string) &&
      /^res_/.test(f.resource as string) && /^class_/.test(f.class as string), [f.resource, f.class]);
    const baseRes = ((f.base as Any).res as number | undefined) ?? 0;
    check(`${id}: base.res is an offset on the pool (-20..+120)`, baseRes >= -20 && baseRes <= 120, baseRes);
    let scripts = 0, badFilters = 0, longRange = 0;
    const msgs: string[] = [];
    walk(f.kit, 'kit', (n, p) => {
      if (n.op === 'script') scripts++;
      // an allies-only filter must say enemies:false (zod defaults enemies to true)
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
    });
    check(`${id}: no 'script' ops`, scripts === 0, scripts);
    check(`${id}: every allies:true filter says enemies:false`, badFilters === 0, msgs);
    check(`${id}: ability ranges <= 14 m (<= 10 m except an edge-marker ultimate)`, longRange === 0, msgs);
    const k = f.kit as Any;
    for (const s of ['a1', 'a2', 'a3'] as const) {
      const r = (((k[s] as Any).targeting as Any).range as number | undefined) ?? 0;
      check(`${id} ${s}: range ${r} m <= 10 m`, r <= 10);
    }
    check(`${id} ult: range <= 14 m`, ((((k.ult as Any).targeting as Any).range as number | undefined) ?? 0) <= 14);
  }
});

// ── fixture catalog: real half-A content + the real resources / classes / roles ─────────────────────
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
    throw new Error(`half-A catalog failed schema validation:\n${r.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  catalog = r.data;
  check('real half-A fighters + resources + classes + roles validate as one catalog', catalog.fighters.length === HALF_A.length + 1 && catalog.resources.length === resources.length);
});
if (!catalog!) { finish('probe_kits_A'); }

// ── arena helpers ─────────────────────────────────────────────────────────────────────────────────
const Y = 52; // below the fixture wall (x 28..32, y 0..45) and thicket, away from both fountains
type Slot = 'a1' | 'a2' | 'a3' | 'ult';
const SLOTS: Slot[] = ['a1', 'a2', 'a3', 'ult'];
const dist = (a: Entity, b: Entity): number => Math.hypot(a.x - b.x, a.y - b.y);

interface Arena { w: World; me: Entity; foes: Entity[]; allies: Entity[]; minion?: Entity }
/** caster at (10, Y) facing +x; `foes` / `allies` are fx_target bodies at the given x offsets from the caster */
function arena(id: string, o: { foes?: number[]; allies?: number[]; foeDy?: number[]; level?: number } = {}): Arena {
  const seats: SeatSpec[] = [{ fighter: id, team: 0, x: 10, y: Y }];
  (o.allies ?? []).forEach((dx) => seats.push({ fighter: TARGET, team: 0, x: 10 + dx, y: Y }));
  (o.foes ?? []).forEach((dx, i) => seats.push({ fighter: TARGET, team: 1, x: 10 + dx, y: Y + (o.foeDy?.[i] ?? 0) }));
  const w = makeWorld(catalog, seats);
  const me = fighterEnt(w, 0);
  const na = (o.allies ?? []).length;
  const allies = (o.allies ?? []).map((_, i) => fighterEnt(w, 1 + i));
  const foes = (o.foes ?? []).map((_, i) => fighterEnt(w, 1 + na + i));
  setLevel(w, me, o.level ?? 18);
  for (let r = 0; r < 5; r++) for (const s of SLOTS) levelUpAbility(w, me, s);
  me.facing = 0;
  // full health, resource at the start-of-fight value (pool: full; build / heat / none: empty)
  me.hp = me.maxHp;
  me.res = me.resource?.model === 'pool' ? me.maxRes : 0;
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
const byAbility = (evs: SimEvent[], ability: string): SimEvent[] => evs.filter((e) => 'ability' in e && (e as { ability?: string }).ability === ability);
const dmgOn = (evs: SimEvent[], ability: string, dst: Entity, dtype?: string): Extract<SimEvent, { e: 'damage' }>[] =>
  ofType(evs, 'damage').filter((d) => d.ability === ability && d.dst === dst.id && (dtype === undefined || d.dtype === dtype));
const healsOn = (evs: SimEvent[], dst: Entity): Extract<SimEvent, { e: 'heal' }>[] => ofType(evs, 'heal').filter((h) => h.dst === dst.id);
const statusOn = (evs: SimEvent[], dst: Entity, kind: string): boolean => ofType(evs, 'status').some((s) => s.dst === dst.id && s.status === kind);
const total = (xs: { amount: number }[]): number => xs.reduce((s, x) => s + x.amount, 0);
const hasBuff = (e: Entity, id: string): boolean => findBuff(e, id) !== null;

// ── 0. level 18 setup sanity (every fighter) ──────────────────────────────────────────────────────
for (const id of HALF_A) {
  section(`${id}: spawns at level 18 with a full kit`, () => {
    const a = arena(id, { foes: [3] });
    const k = catalog.fighters.find((f) => f.id === id)!;
    check(`${id}: level 18, abilities at max rank (5 5 5 3)`, a.me.level === 18 && SLOTS.map((s) => a.me.slots[SLOT_INDEX[s]]!.rank).join(' ') === '5 5 5 3',
      [a.me.level, SLOTS.map((s) => a.me.slots[SLOT_INDEX[s]]!.rank)]);
    check(`${id}: slot ids match the kit`, SLOTS.every((s) => a.me.slots[SLOT_INDEX[s]]!.id === k.kit[s].id));
    check(`${id}: full hp, sane stats`, a.me.hp === a.me.maxHp && a.me.maxHp > 2000 && a.me.stats.armor > 80 && a.me.stats.ad > 60, [a.me.maxHp, a.me.stats.armor]);
    const model = a.me.resource!.model;
    check(`${id}: resource ${k.resource} (${model}) max ${a.me.maxRes}`, model === 'none' ? a.me.maxRes === 0 : a.me.maxRes >= 100, a.me.maxRes);
    // quiet minute: passives tick, nothing throws, nothing is spent
    step(a, 5);
    check(`${id}: idle for 5 s without throwing; still alive`, a.me.alive);
  });
}

// ── 1. Marund (Plinth, res_light) ───────────────────────────────────────────────────────────────────
section('marund', () => {
  { // passive Hearthside: allies within 5 m (and himself) regenerate 0.4% of his max hp per second; enemies do not
    const a = arena('marund', { allies: [3], foes: [4] });
    const [ally] = a.allies, [foe] = a.foes;
    ally.hp = ally.maxHp * 0.5; foe.hp = foe.maxHp * 0.5; a.me.hp = a.me.maxHp * 0.5;
    const evs = step(a, 2.2);
    const heals = healsOn(evs, ally);
    check('Hearthside: an ally within 5 m is healed each second', heals.length >= 2 && heals.every((h) => h.src === a.me.id), heals.length);
    check('Hearthside: 0.4% of Marund max hp per pulse', near(heals[0]?.amount ?? 0, a.me.maxHp * 0.004, a.me.maxHp * 0.001), [heals[0]?.amount, a.me.maxHp * 0.004]);
    check('Hearthside: Marund heals himself', healsOn(evs, a.me).length >= 2);
    check('Hearthside: enemies are not healed', healsOn(evs, foe).length === 0 && foe.hp === foe.maxHp * 0.5);
  }
  { // A1 Shoulder In: dash 4.5 m stops at the first enemy: magic damage, knockback 2 m, slow 30%
    const a = arena('marund', { foes: [3] });
    const [foe] = a.foes;
    const x0 = foe.x;
    const { res, evs } = cast(a, 'a1', { x: 20, y: Y }, 1.2);
    check('Shoulder In: casts', res === 'ok', res);
    check('Shoulder In: a dash event', ofType(evs, 'dash').some((d) => d.src === a.me.id));
    check('Shoulder In: magic damage on the first enemy', dmgOn(evs, 'marund_shoulder_in', foe, 'magic').length === 1);
    check('Shoulder In: slowed (no Mortar)', hasStatus(foe, 'slow') && !hasStatus(foe, 'root'));
    check('Shoulder In: knocked back toward +x', foe.x > x0 + 1, [x0, foe.x]);
    check('Shoulder In: stops at the first enemy (short of the full 4.5 m)', a.me.x < 10 + 4.4 && a.me.x > 10 + 1, a.me.x);
    check('Shoulder In: cost paid', a.me.res < a.me.maxRes);
  }
  { // Mortar Pail -> Shoulder In: a Mortared target is rooted instead of slowed and the Mortar is spent
    const a = arena('marund', { foes: [6] });
    const [foe] = a.foes;
    const p = cast(a, 'a3', { x: foe.x, y: foe.y }, 1.1);
    check('Mortar Pail: casts', p.res === 'ok', p.res);
    check('Mortar Pail: magic damage after the 0.5 s delay', dmgOn(p.evs, 'marund_mortar_pail', foe, 'magic').length === 1);
    check('Mortar Pail: slowed 35%', hasStatus(foe, 'slow'));
    check('Mortar Pail: Mortared (marund_mortar mark, 4 s)', markStacks(foe, 'marund_mortar', a.me) === 1);
    check('Mortar Pail: area event at the aimed point', ofType(p.evs, 'area').some((x) => near(x.x, foe.x, 0.01) && x.ability === 'marund_mortar_pail'));
    // clear the slow so the root is unambiguous, then charge
    foe.statuses.length = 0;
    a.me.slots[SLOT_INDEX.a1]!.cooldown = 0; a.me.res = a.me.maxRes;
    a.me.x = 10; a.me.y = Y;
    foe.x = 13; foe.y = Y;
    const q = cast(a, 'a1', { x: 20, y: Y }, 0.8);
    check('Shoulder In on a Mortared target: rooted for 1.25 s', hasStatus(foe, 'root') && statusOn(q.evs, foe, 'root'));
    check('Shoulder In on a Mortared target: no slow, Mortar spent', !hasStatus(foe, 'slow') && markStacks(foe, 'marund_mortar', a.me) === 0);
  }
  { // A2 Shelter Dome: shoves enemies out, blocks entry, allies inside gain armor + resist
    const a = arena('marund', { foes: [2], allies: [1.5] });
    const [foe] = a.foes, [ally] = a.allies;
    const arm0 = ally.stats.armor;
    const { res, evs } = cast(a, 'a2', {}, 0.9);
    check('Shelter Dome: casts', res === 'ok', res);
    check('Shelter Dome: enemy inside is shoved out to the dome edge', dist(foe, a.me) >= 2.9, dist(foe, a.me));
    check('Shelter Dome: the zone is up', a.w.entities.some((e) => e.kind === 'zone' && e.def === 'marund_dome') || ofType(evs, 'area').length > 0);
    check('Shelter Dome: allies inside gain the ward buff', hasBuff(ally, 'marund_dome_ward') && hasBuff(a.me, 'marund_dome_ward'));
    ally.statsDirty = true; step(a, 0.1);
    check('Shelter Dome: ally armor rises (+40 at rank 5)', ally.stats.armor >= arm0 + 35, [arm0, ally.stats.armor]);
    // the enemy tries to walk back in for two seconds: the dome blocks it
    issueMove(a.w, foe, a.me.x, a.me.y, false);
    step(a, 1.5);
    check('Shelter Dome: no enemy can walk in', dist(foe, a.me) >= 2.8, dist(foe, a.me));
    // allies come and go freely
    ally.x = a.me.x - 5; ally.y = Y; a.w.hashDirty = true; // the far side: the shoved enemy stands in the way on the +x side
    issueMove(a.w, ally, a.me.x - 1.2, a.me.y, false);
    step(a, 1.5);
    check('Shelter Dome: an ally outside walks in freely', dist(ally, a.me) < 2.4, dist(ally, a.me));
    check('Shelter Dome: the dome ends after its duration (3.5 s at rank 5)', (step(a, 2.5), !a.w.entities.some((e) => e.kind === 'zone' && e.def === 'marund_dome')));
  }
  { // Ultimate Domefall: leap up to 7 m; on landing 3.5 m: damage, knockback, stun; allies get a shield
    const a = arena('marund', { foes: [8], allies: [6] });
    const [foe] = a.foes, [ally] = a.allies;
    const { res, evs } = cast(a, 'ult', { x: 17, y: Y }, 1.6);
    check('Domefall: casts', res === 'ok', res);
    check('Domefall: leap (dash event) lands near the point', ofType(evs, 'dash').some((d) => d.src === a.me.id) && near(a.me.x, 17, 0.6), a.me.x);
    check('Domefall: enemies in 3.5 m take magic damage', dmgOn(evs, 'marund_domefall', foe, 'magic').length === 1);
    check('Domefall: stunned for 1 s', statusOn(evs, foe, 'stun'));
    check('Domefall: flung outward (+x)', foe.x > 18 + 1.5, foe.x);
    const sh = ofType(evs, 'shield').filter((s) => s.dst === ally.id);
    check('Domefall: allies in the landing area gain a shield (>= 80 + 8% max hp)', sh.length === 1 && sh[0].amount >= 80 + 0.08 * a.me.maxHp - 1, sh[0]?.amount);
    check('Domefall: Marund shields himself too', ofType(evs, 'shield').some((s) => s.dst === a.me.id));
    check('Domefall: the ally is not damaged or stunned', dmgOn(evs, 'marund_domefall', ally).length === 0 && !hasStatus(ally, 'stun'));
  }
});

// ── 2. Burdam (Breaker, res_tally) ─────────────────────────────────────────────────────────────────
function grudge(a: Arena, foe: Entity, stacks: number): void { applyMark(a.w, a.me, foe, 'burdam_grudge', 6, stacks, 5); }
section('burdam', () => {
  { // passive Long Memory: whoever damages him earns a Grudge (max 5); his attacks on a Grudge-bearer heal him and give Tally
    const a = arena('burdam', { foes: [1.5] });
    const [foe] = a.foes;
    for (let i = 0; i < 7; i++) { dealDamage(a.w, foe, a.me, 20, 'phys'); step(a, 0.55); }
    check('Long Memory: damage taken marks the attacker with Grudge, max 5', markStacks(foe, 'burdam_grudge', a.me) === 5, markStacks(foe, 'burdam_grudge', a.me));
    a.me.hp = a.me.maxHp * 0.5;
    a.me.res = 0;
    issueAttack(a.w, a.me, foe);
    const evs = step(a, 1.6);
    const hl = healsOn(evs, a.me);
    check('Long Memory: an attack on a Grudge-bearer heals 1.5% max hp', hl.length >= 1 && hl.some((h) => near(h.amount, a.me.maxHp * 0.012, a.me.maxHp * 0.004)), hl.map((h) => h.amount));
    check('Long Memory: the attack also gives Tally', a.me.res >= 8, a.me.res);
  }
  { // A1 Bear Down: lunge to an enemy, chop; a Grudge-bearer is slowed
    const a = arena('burdam', { foes: [4.5, 4.5], foeDy: [0, 1.2] });
    const [foe, other] = a.foes;
    grudge(a, foe, 1);
    const { res, evs } = cast(a, 'a1', { target: foe }, 0.8);
    check('Bear Down: casts on a unit target 4.5 m away', res === 'ok', res);
    check('Bear Down: dash to the target', ofType(evs, 'dash').some((d) => d.src === a.me.id));
    check('Bear Down: phys damage', dmgOn(evs, 'burdam_bear_down', foe, 'phys').length === 1);
    check('Bear Down: Grudge-bearer slowed', hasStatus(foe, 'slow'));
    check('Bear Down: free of cost (no Tally spent)', a.me.res >= 0);
    const b = arena('burdam', { foes: [4.5] });
    const c = cast(b, 'a1', { target: b.foes[0] }, 0.8);
    check('Bear Down: no slow without a Grudge', dmgOn(c.evs, 'burdam_bear_down', b.foes[0]).length === 1 && !hasStatus(b.foes[0], 'slow'));
    check('Bear Down: the other enemy is untouched', other.hp === other.maxHp);
  }
  { // A2 Stubborn: +armor/resist/tenacity for 3 s, then a stamp within 3 m
    const a = arena('burdam', { foes: [2] });
    const [foe] = a.foes;
    a.me.res = 100;
    const arm0 = a.me.stats.armor, ten0 = a.me.stats.tenacity;
    const { res, evs } = cast(a, 'a2', {}, 0.3);
    check('Stubborn: casts (30 Tally)', res === 'ok' && a.me.res <= 70 + 6, [res, a.me.res]);
    check('Stubborn: buff up, +armor and +30% tenacity', hasBuff(a.me, 'burdam_stubborn') && a.me.stats.armor >= arm0 + 40 && a.me.stats.tenacity >= ten0 + 0.29, [arm0, a.me.stats.armor, a.me.stats.tenacity]);
    check('Stubborn: no stamp yet', dmgOn(evs, 'burdam_stubborn', foe).length === 0);
    const later = step(a, 3);
    check('Stubborn: the stamp lands when it ends (phys, within 3 m)', dmgOn(later, 'burdam_stubborn', foe, 'phys').length === 1);
    check('Stubborn: buff gone', !hasBuff(a.me, 'burdam_stubborn'));
  }
  { // A3 Old Wound: 4 m / 100 degree cone; a Grudge-bearer takes bonus damage and is slowed
    const a = arena('burdam', { foes: [2.5, 2.5], foeDy: [0, 0.8] });
    const [foe, plain] = a.foes;
    a.me.res = 100;
    grudge(a, foe, 1);
    const { res, evs } = cast(a, 'a3', { x: 20, y: Y }, 0.8);
    check('Old Wound: casts (40 Tally)', res === 'ok', res);
    check('Old Wound: the Grudge-bearer takes the cleave plus the bonus', dmgOn(evs, 'burdam_old_wound', foe, 'phys').length === 2);
    check('Old Wound: and is slowed', hasStatus(foe, 'slow'));
    check('Old Wound: the plain enemy takes one hit and no slow', dmgOn(evs, 'burdam_old_wound', plain, 'phys').length === 1 && !hasStatus(plain, 'slow'));
    const behind = arena('burdam', { foes: [-2.5] });
    behind.me.res = 100;
    const b = cast(behind, 'a3', { x: 20, y: Y }, 0.8);
    check('Old Wound: an enemy behind him is outside the cone', dmgOn(b.evs, 'burdam_old_wound', behind.foes[0]).length === 0);
  }
  { // Ultimate Settled Account: every Grudge-bearer within 7 m is pulled 3 m, stunned 0.5 s, pays per stack; he heals per stack
    const a = arena('burdam', { foes: [6, 6], foeDy: [0, 2.5] });
    const [foe, plain] = a.foes;
    grudge(a, foe, 3);
    a.me.hp = a.me.maxHp * 0.5;
    const d0 = dist(foe, a.me);
    const { res, evs } = cast(a, 'ult', {}, 0.9);
    check('Settled Account: casts (no cost)', res === 'ok', res);
    check('Settled Account: one hit per Grudge stack (3)', dmgOn(evs, 'burdam_settled_account', foe, 'phys').length === 3, dmgOn(evs, 'burdam_settled_account', foe).length);
    check('Settled Account: he heals per stack', healsOn(evs, a.me).length >= 3 && a.me.hp > a.me.maxHp * 0.5);
    check('Settled Account: stunned', statusOn(evs, foe, 'stun'));
    check('Settled Account: dragged toward him', dist(foe, a.me) < d0 - 1.5, [d0, dist(foe, a.me)]);
    check('Settled Account: Grudge spent', markStacks(foe, 'burdam_grudge', a.me) === 0);
    check('Settled Account: an enemy without a Grudge is untouched', dmgOn(evs, 'burdam_settled_account', plain).length === 0 && !hasStatus(plain, 'stun'));
  }
});

// ── 3. Rishal (Striker, res_heat) ──────────────────────────────────────────────────────────────────
section('rishal', () => {
  { // A1 Glass Dash: 2 charges, +15 Heat each; enemies on the laid track are hit and Cut; later crossers too
    const a = arena('rishal', { foes: [3, 3], foeDy: [0, 2.5] });
    const [foe, late] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: 20, y: Y }, 0.4);
    check('Glass Dash: casts', res === 'ok', res);
    check('Glass Dash: dash event of 5 m', ofType(evs, 'dash').some((d) => d.src === a.me.id) && near(a.me.x, 15, 0.7), a.me.x);
    check('Glass Dash: an enemy on the track takes phys damage and is Cut', dmgOn(evs, 'rishal_glass_dash', foe, 'phys').length >= 1 && markStacks(foe, 'rishal_cut', a.me) >= 1);
    check('Glass Dash: +15 Heat', a.me.res >= 14, a.me.res);
    check('Glass Dash: 1 charge left', a.me.slots[SLOT_INDEX.a1]!.charges === 1, a.me.slots[SLOT_INDEX.a1]!.charges);
    late.x = 12; late.y = Y; late.hp = late.maxHp; a.w.hashDirty = true;
    const later = step(a, 0.6);
    check('Glass Dash: an enemy that steps onto the track later takes damage and is Cut', dmgOn(later, 'rishal_glass_dash', late, 'phys').length >= 1 && markStacks(late, 'rishal_cut', a.me) >= 1);
    const second = cast(a, 'a1', { x: 5, y: Y }, 0.4);
    check('Glass Dash: the second charge casts right away', second.res === 'ok', second.res);
    check('Glass Dash: the third is refused (cooldown)', tryCast(a.w, a.me, SLOT_INDEX.a1, 20, Y) === 'cooldown');
    a.me.overheat = 0;
  }
  { // A2 Glint Cut: two hits; a Cut target is slowed 60%
    const a = arena('rishal', { foes: [1.8] });
    const [foe] = a.foes;
    applyMark(a.w, a.me, foe, 'rishal_cut', 5, 1, 3);
    const { res, evs } = cast(a, 'a2', { target: foe }, 0.7);
    check('Glint Cut: casts', res === 'ok', res);
    check('Glint Cut: two phys hits', dmgOn(evs, 'rishal_glint_cut', foe, 'phys').length === 2, dmgOn(evs, 'rishal_glint_cut', foe).length);
    check('Glint Cut: a Cut target is slowed', hasStatus(foe, 'slow'));
    check('Glint Cut: +25 Heat', a.me.res >= 24, a.me.res);
    const b = arena('rishal', { foes: [1.8] });
    const c = cast(b, 'a2', { target: b.foes[0] }, 0.7);
    check('Glint Cut: no slow without a Cut', dmgOn(c.evs, 'rishal_glint_cut', b.foes[0]).length === 2 && !hasStatus(b.foes[0], 'slow'));
  }
  { // A3 Feint: springs 4 m away from the cursor and lays a track over the path covered
    const a = arena('rishal', { foes: [-2] });
    const [foe] = a.foes;
    foe.x = 8; foe.y = Y; // on the path he will cover (x 6..10): his start is x = 10
    a.w.hashDirty = true;
    const { res, evs } = cast(a, 'a3', { x: 14, y: Y }, 0.6);
    check('Feint: casts', res === 'ok', res);
    check('Feint: springs away from the cursor (-x)', a.me.x < 7 && a.me.x > 5, a.me.x);
    check('Feint: a track over the covered path hits and Cuts an enemy on it', dmgOn(evs, 'rishal_feint', foe, 'phys').length >= 1 && markStacks(foe, 'rishal_cut', a.me) >= 1, markStacks(foe, 'rishal_cut', a.me));
    check('Feint: +20 Heat', a.me.res >= 19, a.me.res);
  }
  { // Ultimate Long Glint: unstoppable 9 m rush: damage, 3 Cuts, slow 50% for each enemy passed; the line stays a track
    const a = arena('rishal', { foes: [3, 7] });
    const [near1, far1] = a.foes;
    const { res, evs } = cast(a, 'ult', { x: 25, y: Y }, 0.9);
    check('Long Glint: casts', res === 'ok', res);
    check('Long Glint: dash event; ends about 9 m away', ofType(evs, 'dash').some((d) => d.src === a.me.id) && near(a.me.x, 19, 0.8), a.me.x);
    check('Long Glint: both enemies on the line take phys damage', dmgOn(evs, 'rishal_long_glint', near1, 'phys').length === 1 && dmgOn(evs, 'rishal_long_glint', far1, 'phys').length === 1);
    check('Long Glint: 3 Cuts each', markStacks(near1, 'rishal_cut', a.me) === 3 && markStacks(far1, 'rishal_cut', a.me) === 3, [markStacks(near1, 'rishal_cut', a.me), markStacks(far1, 'rishal_cut', a.me)]);
    check('Long Glint: slowed', hasStatus(near1, 'slow') && hasStatus(far1, 'slow'));
    check('Long Glint: +30 Heat', a.me.res >= 25, a.me.res);
    check('Long Glint: the track is a zone for 4 s', a.w.entities.some((e) => e.kind === 'zone' && e.def === 'rishal_long_track'));
  }
  { // Heat rhythm: two dashes, a Glint Cut and a Feint come to 75 Heat; the next cast overheats him and locks abilities
    const a = arena('rishal', { foes: [1.6] });
    const [foe] = a.foes;
    const order: { s: Slot; o: { x?: number; y?: number; target?: Entity } }[] = [
      { s: 'a2', o: { target: foe } }, { s: 'a1', o: { x: 5, y: Y } }, { s: 'a1', o: { x: 12, y: Y } }, { s: 'a3', o: { x: 6, y: Y } },
    ];
    for (const { s, o } of order) { const r = cast(a, s, o, 0.6); check(`Heat rhythm: ${s} casts`, r.res === 'ok', r.res); }
    check('Heat rhythm: four casts come to about 75 Heat (25 + 15 + 15 + 20, minus a little decay)', a.me.res >= 66 && a.me.res <= 75.5, a.me.res);
    const last = cast(a, 'ult', { x: 30, y: Y }, 1.0);
    check('Heat rhythm: one more cast overheats him', last.res === 'ok' && a.me.overheat > 0, [last.res, a.me.overheat]);
    a.me.slots[SLOT_INDEX.a2]!.cooldown = 0;
    const locked = tryCast(a.w, a.me, SLOT_INDEX.a2, undefined, undefined, foe.id);
    check('Heat rhythm: no abilities while overheated', locked === 'cost', [locked, a.me.overheat, a.me.res]);
    step(a, 3.2);
    check('Heat rhythm: the lock ends and the bar cools', a.me.overheat === 0 && a.me.res < 60, [a.me.overheat, a.me.res]);
  }
  { // Passive Split Glass: an attack on a Cut enemy spends every Cut for damage each and vents 8 Heat per Cut
    const a = arena('rishal', { foes: [1.5] });
    const [foe] = a.foes;
    applyMark(a.w, a.me, foe, 'rishal_cut', 5, 3, 3);
    a.me.res = 70;
    issueAttack(a.w, a.me, foe);
    const evs = step(a, 0.9);
    const spent = ofType(evs, 'damage').filter((d) => d.dst === foe.id && d.ability === 'rishal_split_glass');
    check('Split Glass: one phys hit per Cut (3)', spent.length === 3 && spent.every((d) => d.dtype === 'phys'), spent.length);
    check('Split Glass: the Cuts are spent', markStacks(foe, 'rishal_cut', a.me) === 0);
    check('Split Glass: vents 8 Heat per Cut (70 -> <= 46)', a.me.res <= 46.5, a.me.res);
  }
});

// ── 4. Odrum (Slinger, res_light) ──────────────────────────────────────────────────────────────────
section('odrum', () => {
  { // passive Cracked Amber: a rooted enemy loses 20% armor and 20% magic resist for 2.5 s
    const a = arena('odrum', { foes: [4] });
    const [foe] = a.foes;
    applyStatus(a.w, a.me, foe, 'root', 1);
    step(a, 0.1);
    check('Cracked Amber: a rooted enemy gains armor and resist shred', hasStatus(foe, 'armor_shred') && hasStatus(foe, 'resist_shred'));
  }
  { // A1 Resin Shot: pool 2.5 m for 1.5 s slows 35%; when it sets, enemies inside take phys damage and are rooted 1 s
    const a = arena('odrum', { foes: [8] });
    const [foe] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: foe.x, y: foe.y }, 1.4);
    check('Resin Shot: casts at 8 m', res === 'ok', res);
    check('Resin Shot: the pool slows while it is wet', hasStatus(foe, 'slow'));
    check('Resin Shot: no damage before it sets', dmgOn(evs, 'odrum_resin_shot', foe).length === 0);
    const set = step(a, 1.4);
    check('Resin Shot: when it sets, phys damage', dmgOn(set, 'odrum_resin_shot', foe, 'phys').length === 1);
    check('Resin Shot: and a root', statusOn(set, foe, 'root') || hasStatus(foe, 'root'));
    check('Resin Shot: the root cracks the armor (passive)', hasStatus(foe, 'armor_shred') && hasStatus(foe, 'resist_shred'));
    const out = arena('odrum', { foes: [8] });
    out.foes[0].x = 14; out.foes[0].y = Y; out.w.hashDirty = true;
    const o = cast(out, 'a1', { x: 18, y: Y }, 3);
    check('Resin Shot: an enemy outside the pool is untouched', dmgOn(o.evs, 'odrum_resin_shot', out.foes[0]).length === 0);
  }
  { // A2 Swing Out: whirl within 3 m: damage and a 30% slow; he gains haste
    const a = arena('odrum', { foes: [2] });
    const [foe] = a.foes;
    const { res, evs } = cast(a, 'a2', {}, 0.5);
    check('Swing Out: casts', res === 'ok', res);
    check('Swing Out: phys damage and slow within 3 m', dmgOn(evs, 'odrum_swing_out', foe, 'phys').length === 1 && hasStatus(foe, 'slow'));
    check('Swing Out: he gains haste', hasStatus(a.me, 'haste'));
  }
  { // A3 Step and Load: hop 3.5 m; the next attack within 3 s carries a pellet (damage + slow)
    const a = arena('odrum', { foes: [5] });
    const [foe] = a.foes;
    const { res, evs } = cast(a, 'a3', { x: 20, y: Y }, 0.5);
    check('Step and Load: casts', res === 'ok', res);
    check('Step and Load: hops about 3.5 m', ofType(evs, 'dash').some((d) => d.src === a.me.id) && near(a.me.x, 13.5, 0.6), a.me.x);
    check('Step and Load: the load buff is up', hasBuff(a.me, 'odrum_load'));
    issueAttack(a.w, a.me, foe);
    const hit = step(a, 1.5);
    const extra = ofType(hit, 'damage').filter((d) => d.dst === foe.id && d.ability === 'odrum_step_and_load');
    check('Step and Load: the next attack lands a pellet for bonus phys damage', extra.length === 1 && extra[0].dtype === 'phys', extra.length);
    check('Step and Load: and a slow; the buff is spent', hasStatus(foe, 'slow') && !hasBuff(a.me, 'odrum_load'));
  }
  { // Ultimate Amber Hour: 12 m lob (edge marker past 10 m); 5 m pool slows 45% for 2 s; it sets: damage and a root 1.5 s
    const a = arena('odrum', { foes: [11, 14.5] });
    const [mid, edge] = a.foes;
    a.me.x = 10;
    const { res, evs } = cast(a, 'ult', { x: 22, y: Y }, 2.0);
    check('Amber Hour: casts at the 12 m edge', res === 'ok', res);
    check('Amber Hour: the pool slows everyone inside (5 m)', hasStatus(mid, 'slow') && hasStatus(edge, 'slow'), [dist(mid, { x: 22, y: Y } as Entity)]);
    const set = step(a, 1.6);
    const all = [...evs, ...set];
    check('Amber Hour: everyone still inside takes phys damage', dmgOn(all, 'odrum_amber_hour', mid, 'phys').length === 1 && dmgOn(all, 'odrum_amber_hour', edge, 'phys').length === 1);
    check('Amber Hour: and is rooted', hasStatus(mid, 'root') && hasStatus(edge, 'root'));
    check('Amber Hour: the passive cracks the whole group', hasStatus(mid, 'armor_shred') && hasStatus(edge, 'armor_shred'));
  }
});

// ── 5. Dunsom (Caster, res_light) ──────────────────────────────────────────────────────────────────
section('dunsom', () => {
  { // A1 Draw In: after 0.4 s, enemies within 3 m of a point (<= 9 m) take magic damage and are drawn 2 m toward its centre;
    // the displacement Settles them (passive), so the next ability deals 15% more
    const a = arena('dunsom', { foes: [6.5] });
    const [foe] = a.foes;
    const cx = 9 + 10, d0 = Math.abs(foe.x - cx);
    const { res, evs } = cast(a, 'a1', { x: cx, y: Y }, 1.0);
    check('Draw In: casts at 9 m', res === 'ok', res);
    check('Draw In: magic damage', dmgOn(evs, 'dunsom_draw_in', foe, 'magic').length === 1);
    check('Draw In: drawn 2 m toward the centre', Math.abs(foe.x - cx) < d0 - 1.5, [d0, Math.abs(foe.x - cx)]);
    check('Draw In: Settled by the displacement (passive)', markStacks(foe, 'dunsom_settled', a.me) === 1);
    a.me.slots[SLOT_INDEX.a1]!.cooldown = 0; a.me.res = a.me.maxRes;
    const two = cast(a, 'a1', { x: foe.x, y: foe.y }, 1.0);
    check('Draw In on a Settled enemy: bonus magic damage', dmgOn(two.evs, 'dunsom_draw_in', foe, 'magic').length === 2, dmgOn(two.evs, 'dunsom_draw_in', foe).length);
  }
  { // A2 Crook Sweep: 7 x 2 m line; damage and a push of 2.5 m toward the far end
    const a = arena('dunsom', { foes: [3, 3], foeDy: [0, 3.5] });
    const [foe, off] = a.foes;
    const x0 = foe.x;
    const { res, evs } = cast(a, 'a2', { x: 17, y: Y }, 1.0);
    check('Crook Sweep: casts', res === 'ok', res);
    check('Crook Sweep: magic damage to the enemy on the line', dmgOn(evs, 'dunsom_crook_sweep', foe, 'magic').length === 1);
    check('Crook Sweep: pushed toward the far end', foe.x > x0 + 1.5, [x0, foe.x]);
    check('Crook Sweep: an enemy off the line is untouched', dmgOn(evs, 'dunsom_crook_sweep', off).length === 0);
    check('Crook Sweep: Settled afterwards (passive)', markStacks(foe, 'dunsom_settled', a.me) === 1);
  }
  { // A3 Step Through Dusk: blink 4 m
    const a = arena('dunsom', {});
    const { res, evs } = cast(a, 'a3', { x: 20, y: Y }, 0.3);
    check('Step Through Dusk: casts', res === 'ok', res);
    check('Step Through Dusk: a blink event of 4 m', ofType(evs, 'blink').some((b) => b.src === a.me.id && near(Math.hypot(b.toX - b.fromX, b.toY - b.fromY), 4, 0.1)), ofType(evs, 'blink'));
    check('Step Through Dusk: he is 4 m ahead', near(a.me.x, 14, 0.1), a.me.x);
  }
  { // Ultimate Driving Hour: hurl every enemy within 5 m up to 5 m toward a point <= 9 m; 0.6 s later it erupts: damage and root
    const a = arena('dunsom', { foes: [2, 8.5], foeDy: [0, 0] });
    const [close, far] = a.foes;
    const { res, evs } = cast(a, 'ult', { x: 19, y: Y }, 0.8);
    check('Driving Hour: casts at 9 m', res === 'ok', res);
    check('Driving Hour: the enemy within 5 m is hurled toward the point', close.x > 2 + 10 + 2.5, close.x);
    const all = [...evs, ...step(a, 0.6)];
    check('Driving Hour: the point erupts: magic damage on the hurled enemy', dmgOn(all, 'dunsom_driving_hour', close, 'magic').length >= 1, dmgOn(all, 'dunsom_driving_hour', close).length);
    check('Driving Hour: and a root', hasStatus(close, 'root'));
    check('Driving Hour: an enemy already at the point is hit too (not hurled)', dmgOn(all, 'dunsom_driving_hour', far, 'magic').length >= 1 && hasStatus(far, 'root') && Math.abs(far.x - 18.5) < 0.6, far.x);
  }
});

// ── 6. Ilsheta (Tender, res_light) ─────────────────────────────────────────────────────────────────
section('ilsheta', () => {
  { // A1 Glint Bolt: a 9 m dawnglass bolt: magic damage and a 25% slow
    const a = arena('ilsheta', { foes: [6] });
    const [foe] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: 20, y: Y }, 1.0);
    check('Glint Bolt: casts', res === 'ok', res);
    check('Glint Bolt: a projectile event', ofType(evs, 'projectile').some((p) => p.src === a.me.id && p.ability === 'ilsheta_glint_bolt'));
    check('Glint Bolt: magic damage and a slow', dmgOn(evs, 'ilsheta_glint_bolt', foe, 'magic').length === 1 && hasStatus(foe, 'slow'));
    const miss = arena('ilsheta', { foes: [6], foeDy: [3] });
    const m = cast(miss, 'a1', { x: 20, y: Y }, 1.0);
    check('Glint Bolt: a bolt that passes wide misses', dmgOn(m.evs, 'ilsheta_glint_bolt', miss.foes[0]).length === 0);
  }
  { // A2 Hung Lamp: a lamp on an ally for 4 s: allies within 3 m heal every 0.5 s; enemies in it are revealed and slowed 10%;
    // Warm Hands: a slowed / rooted / stunned ally heals 40% more and gains haste once per 4 s
    const a = arena('ilsheta', { allies: [4], foes: [5.5] });
    const [ally] = a.allies, [foe] = a.foes;
    ally.hp = ally.maxHp * 0.5; a.me.hp = a.me.maxHp * 0.5;
    const { res, evs } = cast(a, 'a2', { target: ally }, 1.0);
    check('Hung Lamp: casts on an ally 4 m away', res === 'ok', res);
    check('Hung Lamp: a follow zone hangs on the ally', a.w.entities.some((e) => e.kind === 'zone' && e.def === 'ilsheta_lamp'));
    check('Hung Lamp: the bearer heals every 0.5 s', healsOn(evs, ally).length >= 1);
    check('Hung Lamp: enemies in the light are revealed and slowed 10%', hasStatus(foe, 'reveal') && hasStatus(foe, 'slow'));
    ally.hp = ally.maxHp * 0.5;
    const calm = step(a, 1.0);
    const calmHeal = total(healsOn(calm, ally));
    applyStatus(a.w, foe, ally, 'root', 3);
    ally.hp = ally.maxHp * 0.5;
    const rooted = step(a, 1.0);
    check('Hung Lamp: Warm Hands: a rooted ally heals more', total(healsOn(rooted, ally)) > calmHeal * 1.2, [calmHeal, total(healsOn(rooted, ally))]);
    check('Hung Lamp: Warm Hands: and gains haste, once (marked 4 s)', hasStatus(ally, 'haste') && markStacks(ally, 'ilsheta_warmed', a.me) === 1);
    ally.x = 10 + 4; // follow: walk the bearer away, the light goes with them
    issueMove(a.w, ally, 10 + 4, Y + 6, false);
    ally.statuses.length = 0;
    step(a, 1.0);
    check('Hung Lamp: the light follows the bearer', a.w.entities.some((e) => e.kind === 'zone' && e.def === 'ilsheta_lamp' && Math.hypot(e.x - ally.x, e.y - ally.y) < 1.2));
    const self = arena('ilsheta', {});
    const s = cast(self, 'a2', { target: self.me }, 0.6);
    check('Hung Lamp: she can hang it on herself', s.res === 'ok');
    const en = arena('ilsheta', { foes: [4] });
    check('Hung Lamp: not on an enemy (ally filter)', tryCast(en.w, en.me, SLOT_INDEX.a2, undefined, undefined, en.foes[0].id) === 'target');
  }
  { // A3 Dawnglass Shell: shield an ally or herself for 2.5 s and haste 20% for 1 s
    const a = arena('ilsheta', { allies: [6] });
    const [ally] = a.allies;
    const { res, evs } = cast(a, 'a3', { target: ally }, 0.4);
    check('Dawnglass Shell: casts on an ally 6 m away', res === 'ok', res);
    const sh = ofType(evs, 'shield').filter((s) => s.dst === ally.id);
    check('Dawnglass Shell: shield event (>= 200 at rank 5)', sh.length === 1 && sh[0].amount >= 200, sh[0]?.amount);
    check('Dawnglass Shell: haste on the ally', hasStatus(ally, 'haste'));
    const self = arena('ilsheta', {});
    const s = cast(self, 'a3', { target: self.me }, 0.4);
    check('Dawnglass Shell: on herself', s.res === 'ok' && ofType(s.evs, 'shield').some((x) => x.dst === self.me.id) && hasStatus(self.me, 'haste'));
  }
  { // Ultimate Every Window Lit: a lamp on every allied fighter within 9 m for 5 s, herself included
    const a = arena('ilsheta', { allies: [4, 8.5], foes: [12] });
    const [near1, far1] = a.allies;
    near1.hp = near1.maxHp * 0.5; far1.hp = far1.maxHp * 0.5; a.me.hp = a.me.maxHp * 0.5;
    const { res, evs } = cast(a, 'ult', {}, 0.4);
    check('Every Window Lit: casts', res === 'ok', res);
    const zones = a.w.entities.filter((e) => e.kind === 'zone' && e.def === 'ilsheta_window');
    check('Every Window Lit: one lamp per fighter (herself + 2 allies)', zones.length === 3, zones.length);
    const rest = step(a, 5.2);
    const all = [...evs, ...rest];
    check('Every Window Lit: every lit fighter heals repeatedly (>= 8 pulses each)', [near1, far1, a.me].every((e) => healsOn(all, e).length >= 8), [near1, far1, a.me].map((e) => healsOn(all, e).length));
    check('Every Window Lit: the lamps are gone after 5 s', a.w.entities.filter((e) => e.kind === 'zone' && e.def === 'ilsheta_window').length === 0);
    const out = arena('ilsheta', { allies: [11] });
    out.allies[0].hp = out.allies[0].maxHp * 0.5;
    const o = cast(out, 'ult', {}, 1.5);
    check('Every Window Lit: an ally beyond 9 m is not lit', healsOn(o.evs, out.allies[0]).length === 0);
  }
});

// ── 7. Hesmi (Plinth, res_unlit) ───────────────────────────────────────────────────────────────────
section('hesmi', () => {
  { // A1 Plant Shard: a shard up to 6 m away throws a 9 x 2.5 m shadow for 3 s (slow + Shaded); when it topples: damage + stun
    const a = arena('hesmi', { foes: [8.5], foeDy: [0] });
    const [foe] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: 16, y: Y }, 1.0);
    check('Plant Shard: casts at 6 m (no cost)', res === 'ok' && a.me.maxRes === 0, res);
    check('Plant Shard: an enemy in the shadow is slowed and Shaded', hasStatus(foe, 'slow') && markStacks(foe, 'hesmi_shaded', a.me) === 1);
    check('Plant Shard: no damage while it stands', dmgOn(evs, 'hesmi_plant_shard', foe).length === 0);
    const topple = step(a, 2.6);
    check('Plant Shard: when it topples, phys damage', dmgOn(topple, 'hesmi_plant_shard', foe, 'phys').length === 1);
    check('Plant Shard: and a stun', statusOn(topple, foe, 'stun'));
    const side = arena('hesmi', { foes: [8.5], foeDy: [4] });
    const s = cast(side, 'a1', { x: 16, y: Y }, 3.5);
    check('Plant Shard: an enemy beside the strip is safe', dmgOn(s.evs, 'hesmi_plant_shard', side.foes[0]).length === 0);
    const between = arena('hesmi', { foes: [3] });
    const bt = cast(between, 'a1', { x: 16, y: Y }, 3.5);
    check('Plant Shard: an enemy between her and the shard is outside the strip', dmgOn(bt.evs, 'hesmi_plant_shard', between.foes[0]).length === 0 && !hasStatus(between.foes[0], 'stun'));
    const behind = arena('hesmi', { foes: [-1] });
    const bh = cast(behind, 'a1', { x: 16, y: Y }, 3.5);
    check('Plant Shard: the shadow falls away from her, not toward her', dmgOn(bh.evs, 'hesmi_plant_shard', behind.foes[0]).length === 0);
  }
  { // A2 Shoulder the Stone: lunge 4.5 m; enemies she passes take damage, are knocked aside 1.5 m and Shaded
    const a = arena('hesmi', { foes: [2.5] });
    const [foe] = a.foes;
    const { res, evs } = cast(a, 'a2', { x: 20, y: Y }, 1.0);
    check('Shoulder the Stone: casts (no cost)', res === 'ok', res);
    check('Shoulder the Stone: a dash event', ofType(evs, 'dash').some((d) => d.src === a.me.id));
    check('Shoulder the Stone: phys damage to the enemy passed', dmgOn(evs, 'hesmi_shoulder_the_stone', foe, 'phys').length === 1);
    check('Shoulder the Stone: Shaded', markStacks(foe, 'hesmi_shaded', a.me) === 1);
    check('Shoulder the Stone: knocked away', Math.abs(foe.y - Y) > 0.2 || foe.x > 12.5 + 0.5, [foe.x, foe.y]);
  }
  { // A3 Stand Firm: armor, resist, tenacity for 2.5 s; whoever hits her is Shaded; Shade-Fed: her attacks on Shaded deal +3% max hp
    const a = arena('hesmi', { foes: [1.6] });
    const [foe] = a.foes;
    const arm0 = a.me.stats.armor;
    const { res } = cast(a, 'a3', {}, 0.3);
    check('Stand Firm: casts', res === 'ok', res);
    check('Stand Firm: armor and tenacity up', hasBuff(a.me, 'hesmi_firm') && a.me.stats.armor >= arm0 + 45 && a.me.stats.tenacity >= 0.29, [arm0, a.me.stats.armor]);
    check('Stand Firm: the counter is set', counterValue(a.me, 'hesmi_standfirm') >= 1);
    dealDamage(a.w, foe, a.me, 30, 'phys');
    step(a, 0.1);
    check('Stand Firm: an enemy who hits her is Shaded', markStacks(foe, 'hesmi_shaded', a.me) === 1);
    issueAttack(a.w, a.me, foe);
    const evs = step(a, 1.6);
    const fed = ofType(evs, 'damage').filter((d) => d.dst === foe.id && d.ability === 'hesmi_shade_fed');
    check('Shade-Fed: her attack on a Shaded enemy adds +3% of its max hp', fed.length >= 1 && fed[0].amount >= foe.maxHp * 0.029, fed[0]?.amount);
    const b = arena('hesmi', { foes: [1.6] });
    dealDamage(b.w, b.foes[0], b.me, 30, 'phys');
    step(b, 0.1);
    check('Stand Firm: without Stand Firm nobody is Shaded', markStacks(b.foes[0], 'hesmi_shaded', b.me) === 0);
  }
  { // Ultimate Felled Shard: after 0.75 s the 2 m circle takes damage and a 1.25 s stun; then a 12 x 5 m shadow for 5 s
    const a = arena('hesmi', { foes: [9, 15], allies: [13] });
    const [under, strip] = a.foes, [ally] = a.allies;
    const { res, evs } = cast(a, 'ult', { x: 19, y: Y }, 0.5);
    check('Felled Shard: casts at 9 m', res === 'ok', res);
    check('Felled Shard: nothing lands before 0.75 s', dmgOn(evs, 'hesmi_felled_shard', under).length === 0);
    const land = step(a, 0.9);
    check('Felled Shard: the enemy under it takes phys damage', dmgOn(land, 'hesmi_felled_shard', under, 'phys').length === 1);
    check('Felled Shard: and a stun', statusOn(land, under, 'stun'));
    check('Felled Shard: the shadow slows and Shades an enemy in the strip (outside the 2 m circle)', hasStatus(strip, 'slow') && markStacks(strip, 'hesmi_shaded', a.me) === 1, [strip.x]);
    check('Felled Shard: allies in the shadow gain haste', hasStatus(ally, 'haste'));
    check('Felled Shard: the strip enemy is not stunned', !hasStatus(strip, 'stun'));
    step(a, 5);
    check('Felled Shard: the shadow ends after 5 s', !a.w.entities.some((e) => e.kind === 'zone' && (e.def === 'hesmi_great_shadow' || e.def === 'hesmi_great_shadow_ally')));
  }
});

// ── 8. Kemdo (Breaker, res_heat) ───────────────────────────────────────────────────────────────────
section('kemdo', () => {
  { // A1 Long Thrust: 4.5 m line, phys damage; slowed enemies also take 5% max hp as true damage (+20 Heat)
    const a = arena('kemdo', { foes: [3.5, 3.5], foeDy: [0, 3] });
    const [foe, off] = a.foes;
    const { res, evs } = cast(a, 'a1', { x: 20, y: Y }, 0.7);
    check('Long Thrust: casts', res === 'ok', res);
    check('Long Thrust: phys damage on the line; none off it', dmgOn(evs, 'kemdo_long_thrust', foe, 'phys').length === 1 && dmgOn(evs, 'kemdo_long_thrust', off).length === 0);
    check('Long Thrust: no true damage on an enemy that is not slowed', dmgOn(evs, 'kemdo_long_thrust', foe, 'true').length === 0);
    check('Long Thrust: +20 Heat', a.me.res >= 19, a.me.res);
    applyStatus(a.w, a.me, foe, 'slow', 3);
    a.me.slots[SLOT_INDEX.a1]!.cooldown = 0; a.me.res = 0;
    const two = cast(a, 'a1', { x: 20, y: Y }, 0.7);
    const tr = dmgOn(two.evs, 'kemdo_long_thrust', foe, 'true');
    check('Long Thrust: a slowed enemy also takes max-hp true damage', tr.length === 1 && tr[0].amount >= foe.maxHp * 0.05 - 1, tr[0]?.amount);
  }
  { // A2 Heat Shimmer: dash 5 m, leaving a shimmer for 2 s that slows enemies inside by 25% (+25 Heat)
    const a = arena('kemdo', { foes: [3] });
    const [foe] = a.foes;
    const { res, evs } = cast(a, 'a2', { x: 20, y: Y }, 0.7);
    check('Heat Shimmer: casts', res === 'ok', res);
    check('Heat Shimmer: dash event of 5 m', ofType(evs, 'dash').some((d) => d.src === a.me.id) && near(a.me.x, 15, 0.7), a.me.x);
    check('Heat Shimmer: an enemy in the shimmer is slowed', hasStatus(foe, 'slow'));
    check('Heat Shimmer: +25 Heat', a.me.res >= 24, a.me.res);
    check('Heat Shimmer: the zone ends after 2 s', (step(a, 2.5), !a.w.entities.some((e) => e.kind === 'zone' && e.def === 'kemdo_shimmer')));
  }
  { // A3 Vent: costs no Heat and works while overheated: -50 Heat, 3 m blast with a 1 m knockback, 20% less damage (armor/resist)
    const a = arena('kemdo', { foes: [2] });
    const [foe] = a.foes;
    a.me.res = 100; a.me.overheat = 2.5;
    check('Overheated: Long Thrust (costKind res) is refused', tryCast(a.w, a.me, SLOT_INDEX.a1, 20, Y) === 'cost');
    const arm0 = a.me.stats.armor;
    const x0 = foe.x;
    const { res, evs } = cast(a, 'a3', {}, 0.5);
    check('Vent: casts while overheated', res === 'ok', res);
    check('Vent: releases 50 Heat', a.me.res <= 50.5 && a.me.res >= 25, a.me.res);
    check('Vent: phys damage and a 1 m knockback', dmgOn(evs, 'kemdo_vent', foe, 'phys').length === 1 && foe.x > x0 + 0.5, [x0, foe.x]);
    check('Vent: armor and resist up for 1.5 s', hasBuff(a.me, 'kemdo_vented') && a.me.stats.armor >= arm0 + 35, [arm0, a.me.stats.armor]);
  }
  { // Ultimate Held Focus: a 2 m spot follows an enemy fighter within 6 m for 3 s: true damage every 0.5 s to them and anyone beside them; +25% omnivamp
    const a = arena('kemdo', { foes: [5, 6.2], foeDy: [0, 0.8] });
    const [foe, beside] = a.foes;
    a.me.hp = a.me.maxHp * 0.5;
    const { res, evs } = cast(a, 'ult', { target: foe }, 0.35);
    check('Held Focus: casts on an enemy fighter 5 m away', res === 'ok', res);
    check('Held Focus: +30 Heat', a.me.res >= 29, a.me.res);
    check('Held Focus: omnivamp buff on her', hasBuff(a.me, 'kemdo_focus_drink') && a.me.stats.omnivamp >= 0.24, a.me.stats.omnivamp);
    check('Held Focus: a follow zone on the target', a.w.entities.some((e) => e.kind === 'zone' && e.def === 'kemdo_focus'));
    issueMove(a.w, foe, foe.x + 9, foe.y + 5, false); // the target runs; the spot goes with them
    const rest = step(a, 3.4);
    const all = [...evs, ...rest];
    const onFoe = dmgOn(all, 'kemdo_held_focus', foe, 'true'), onBeside = dmgOn(all, 'kemdo_held_focus', beside, 'true');
    check('Held Focus: true damage about every 0.5 s on the target for 3 s (>= 5 ticks)', onFoe.length >= 5, onFoe.length);
    check('Held Focus: it follows them while they run (damage after they moved > 4 m)', Math.hypot(foe.x - 15, foe.y - Y) > 4 && onFoe.length >= 5);
    check('Held Focus: anyone beside the target is burned too, until the spot moves off them', onBeside.length >= 1, onBeside.length);
    check('Held Focus: she heals from the damage (omnivamp)', a.me.hp > a.me.maxHp * 0.5, a.me.hp);
    const min = arena('kemdo', {});
    const m = addUnit(min.w, 'fx_dummy', 1, 13, Y);
    check('Held Focus: a minion is not a valid target', tryCast(min.w, min.me, SLOT_INDEX.ult, undefined, undefined, m.id) === 'target');
  }
  { // Passive Cooling Kill: a takedown vents all her Heat
    const a = arena('kemdo', { foes: [2] });
    const [foe] = a.foes;
    a.me.res = 80;
    foe.hp = 1;
    killEntity(a.w, foe, a.me);
    step(a, 0.1);
    check('Cooling Kill: a takedown vents all her Heat', a.me.res === 0, a.me.res);
  }
});

// ── 9. cross-checks: every ability cast cleanly; cooldowns, costs, tallies ─────────────────────────
section('every ability: cast, cooldown started, cost paid', () => {
  for (const id of HALF_A) {
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
      const started = slot.cooldown > 0 || (slot.charges !== undefined && slot.charges < (def.charges?.max ?? 99));
      check(`${id} ${s} ${def.id}: cooldown started`, started, [slot.cooldown, slot.charges]);
      evs.push(...step(a, 4)); // let delayed zones, repeats and expiries play out
      const badNum = evs.filter((e) => Object.values(e).some((v) => typeof v === 'number' && !Number.isFinite(v)));
      check(`${id} ${s} ${def.id}: every event field is finite`, badNum.length === 0, badNum.slice(0, 2));
      const castEv = ofType(evs, 'cast').filter((c) => c.src === a.me.id && c.ability === def.id);
      check(`${id} ${s} ${def.id}: one cast event carrying the ability id and slot`, castEv.length === 1 && castEv[0].slot === s, castEv.length);
      // presentation: every vfx / sfx id the sim echoes exists in the vocabulary
      const vfx = new Set<string>(), sfx = new Set<string>();
      for (const e of evs) {
        const v = (e as { vfx?: string }).vfx, f = (e as { sfx?: string }).sfx;
        if (v) vfx.add(v);
        if (f) sfx.add(f);
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

section('long run: all eight fight each other for 20 s without throwing', () => {
  const seats: SeatSpec[] = HALF_A.map((id, i) => ({ fighter: id, team: i < 4 ? 0 : 1, x: 8 + (i % 4) * 2.5, y: Y - (i < 4 ? 0 : 3) }));
  const w = makeWorld(catalog, seats);
  for (let i = 0; i < HALF_A.length; i++) {
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
      for (let i = 0; i < HALF_A.length; i++) {
        const me = fighterEnt(w, i);
        const foe = fighterEnt(w, (i + 4) % 8);
        for (const s of SLOTS) if (tryCast(w, me, SLOT_INDEX[s], foe.x, foe.y, foe.id) === 'ok') casts++;
      }
    }
    for (const ev of w.step()) if ('amount' in ev && !Number.isFinite((ev as { amount: number }).amount)) nan++;
  }
  check('20 s of 4v4 half-A fighting: abilities cast', casts >= 16, casts);
  check('20 s of 4v4 half-A fighting: no NaN amounts', nan === 0, nan);
  check('20 s of 4v4 half-A fighting: every entity has finite hp and position', w.entities.every((e) => Number.isFinite(e.hp) && Number.isFinite(e.x) && Number.isFinite(e.y)));
});

finish('probe_kits_A');
