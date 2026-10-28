// probe (lane W4, originality F5): the two kit hooks re-keyed away from famous single hooks, in the real sim.
//   Ervet · Whole Again: the payoff is the shards (a 4.5 m call-home that damages, drags and lodges a shard; her
//           attacks tear lodged shards out in a 1.75 m burst around the target). NO reach bonus: her reach stays
//           2.0 m whole and in the 6 s Whole Again form, and nothing reaches past it.
//   Vashil · Hum: the stun needs a CHORD (a struck humming enemy with another humming enemy within 3.5 m); a lone
//           humming enemy struck again is only slowed. Morning Toll stuns a pair on its second toll, never a lone target.
//   Run: node _harness/probe_sim_kit_hooks.ts
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog, type CatalogT } from '../src/contracts/catalog.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { fighter as fxFighter, rawCatalog } from './fixtures/catalog_fixture.ts';
import { check, fighterEnt, finish, makeWorld, near, ofType, section, stepSec, type SeatSpec } from './fixtures/sim_fixture.ts';
import { levelUpAbility, setLevel, tryCast, type CastResult } from '../src/sim/abilities.ts';
import type { Entity } from '../src/sim/entity.ts';
import { SLOT_INDEX } from '../src/sim/entity.ts';
import { issueAttack } from '../src/sim/movement.ts';
import { hasStatus, markStacks } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type Raw = Record<string, unknown>;
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
const IDS = ['ervet', 'vashil'];
const TARGET = 'fx_target';
let catalog!: CatalogT;
section('catalog', () => {
  const raw = rawCatalog({ fighters: [...IDS.map((id) => readJson(`content/fighters/${id}.json`) as Raw),
    fxFighter(TARGET, { resource: 'res_unlit', base: { hp: 100000, ad: 1, attackSpeed: 0.5, moveSpeed: 3.5 }, radius: 0.5 })],
  resources: readJson('content/resources.json') as Raw[] });
  raw.classes = readJson('content/classes.json') as Raw[];
  raw.roles = readJson('content/roles.json') as Raw[];
  const r = Catalog.safeParse(raw);
  if (!r.success) throw new Error(r.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  catalog = r.data;
  check('real Ervet + Vashil validate (markedNear condition included)', catalog.fighters.length === 3);
});
if (!catalog) finish('probe_sim_kit_hooks');

const Y = 52;
type Slot = 'a1' | 'a2' | 'a3' | 'ult';
const SLOTS: Slot[] = ['a1', 'a2', 'a3', 'ult'];
interface Arena { w: World; me: Entity; foes: Entity[] }
function arena(id: string, foes: [number, number][]): Arena {
  const seats: SeatSpec[] = [{ fighter: id, team: 0, x: 10, y: Y }];
  for (const [dx, dy] of foes) seats.push({ fighter: TARGET, team: 1, x: 10 + dx, y: Y + dy });
  const w = makeWorld(catalog, seats);
  const me = fighterEnt(w, 0);
  const fs = foes.map((_, i) => fighterEnt(w, 1 + i));
  setLevel(w, me, 18);
  for (let r = 0; r < 5; r++) for (const s of SLOTS) levelUpAbility(w, me, s);
  me.facing = 0; me.hp = me.maxHp; me.res = me.maxRes; me.autoAttack = false;
  for (const e of fs) { e.hp = e.maxHp; e.autoAttack = false; }
  w.hashDirty = true;
  w.vision.update(w.entities, w.tick);
  return { w, me, foes: fs };
}
function cast(a: Arena, slot: Slot, x: number, y: number, secs: number): { res: CastResult; evs: SimEvent[] } {
  const n = a.w.events.length;
  const res = tryCast(a.w, a.me, SLOT_INDEX[slot], x, y);
  const evs = a.w.events.slice(n);
  for (const e of stepSec(a.w, secs)) evs.push(e);
  return { res, evs };
}
const refresh = (a: Arena): void => { for (const s of SLOTS) a.me.slots[SLOT_INDEX[s]]!.cooldown = 0; a.me.res = a.me.maxRes; };
const dmgOn = (evs: SimEvent[], ability: string, dst: Entity, dtype?: string): Extract<SimEvent, { e: 'damage' }>[] =>
  ofType(evs, 'damage').filter((d) => d.ability === ability && d.dst === dst.id && d.amount > 0 && (dtype === undefined || d.dtype === dtype));
const stuns = (evs: SimEvent[], dst: Entity): Extract<SimEvent, { e: 'status' }>[] => ofType(evs, 'status').filter((s) => s.dst === dst.id && s.status === 'stun');
const clearCc = (es: Entity[]): void => { for (const e of es) e.statuses.length = 0; };

// ── Ervet ─────────────────────────────────────────────────────────────────────────────────────────
section('ervet: Whole Again pays off in shards, never in reach', () => {
  const def = catalog.fighters.find((f) => f.id === 'ervet')!;
  const forms = def.kit.passive.forms ?? {};
  check('no Ervet form changes attack reach upward (Hilt 1.7 m is shorter; Whole Again keeps the base 2.0 m)',
    Object.values(forms).every((f) => f.attackRange === undefined || f.attackRange <= def.attack.range), Object.fromEntries(Object.entries(forms).map(([k, f]) => [k, f.attackRange])));
  const json = JSON.stringify(def.kit);
  check('no empowerAttacks rangeBonus anywhere in the kit', !/rangeBonus/.test(json));
  check('the ult text names no reach gain', !/reach (?:\d|[a-z ]*farther)/i.test(def.kit.ult.desc), def.kit.ult.desc);

  // foes: near (2.5 m from the landing), mid (4 m from the landing), far (6.5 m), and a side foe 1.2 m from near
  const a = arena('ervet', [[8.5, 0], [10, 0], [12.5, 0], [8.5, 1.2]]);
  const [nearF, mid, far, side] = a.foes;
  const range0 = a.me.stats.range;
  const midX0 = mid.x;
  const { res, evs } = cast(a, 'ult', 16, Y, 0.3 + 6 / 14 + 0.9);
  check('Whole Again casts and lands near the point', res === 'ok' && near(a.me.x, 16, 0.7), [res, a.me.x]);
  check('the shards hit within 4.5 m (near and mid) and not at 6.5 m', dmgOn(evs, 'ervet_whole_again', nearF, 'magic').length === 1 &&
    dmgOn(evs, 'ervet_whole_again', mid, 'magic').length === 1 && dmgOn(evs, 'ervet_whole_again', far).length === 0);
  check('the shards drag enemies toward her (mid foe moved toward the landing by >= 1.5 m)', mid.x - midX0 >= 1.5 || Math.abs(mid.x - a.me.x) < Math.abs(midX0 - 16) - 1.5,
    [midX0, mid.x, a.me.x]);
  check('a shard is lodged in each enemy struck', markStacks(nearF, 'ervet_lodged', a.me) === 1 && markStacks(mid, 'ervet_lodged', a.me) === 1 && markStacks(far, 'ervet_lodged', a.me) === 0);
  check('the blade is whole again (form great) at its usual reach: no reach bonus', a.me.form === 'great' && near(a.me.stats.range, range0, 1e-6) && near(a.me.stats.range, 2, 1e-6),
    [a.me.form, range0, a.me.stats.range]);
  // tear a lodged shard out: place near foe and side foe in reach
  clearCc(a.foes);
  nearF.x = a.me.x + 2.2; nearF.y = Y; side.x = a.me.x + 2.2; side.y = Y + 1.2; mid.x = a.me.x - 6; mid.y = Y; a.w.hashDirty = true;
  markStacks(side, 'ervet_lodged', a.me);
  issueAttack(a.w, a.me, nearF);
  const hits = stepSec(a.w, 1.2);
  const tear = dmgOn(hits, 'ervet_dawnglass_edge', nearF, 'magic');
  check('her attack tears the lodged shard out: the 2% hit plus the burst (two magic hits on the target)', tear.length >= 2, tear.map((d) => d.amount));
  check('the burst also strikes and slows the enemy 1.2 m from the target', dmgOn(hits, 'ervet_dawnglass_edge', side, 'magic').length >= 1 && hasStatus(side, 'slow'));
  check('the torn shard is gone (consumed)', markStacks(nearF, 'ervet_lodged', a.me) === 0);
  stepSec(a.w, 6);
  check('Whole Again ends after 6 s; reach still 2.0 m', a.me.form === null && near(a.me.stats.range, 2, 1e-6), [a.me.form, a.me.stats.range]);
});

// ── Vashil ────────────────────────────────────────────────────────────────────────────────────────
section('vashil: the stun needs a chord', () => {
  { // a lone humming enemy: two, three Glass Chimes never stun; the second slows and keeps the hum
    const a = arena('vashil', [[5, 0]]);
    const [foe] = a.foes;
    const c1 = cast(a, 'a2', 20, Y, 0.8);
    check('lone: the first hit hums, no stun', markStacks(foe, 'vashil_hum', a.me) === 1 && stuns(c1.evs, foe).length === 0);
    refresh(a);
    const c2 = cast(a, 'a2', 20, Y, 0.8);
    check('lone: a second hit does NOT stun (no chord), slows by 35% and keeps the hum', stuns(c2.evs, foe).length === 0 &&
      ofType(c2.evs, 'status').some((s) => s.dst === foe.id && s.status === 'slow') && markStacks(foe, 'vashil_hum', a.me) === 1);
    refresh(a);
    const c3 = cast(a, 'a2', 20, Y, 0.8);
    check('lone: a third hit still does not stun', stuns(c3.evs, foe).length === 0);
  }
  { // a pair 3.4 m apart: Peal's ring hums both, the second ability chords and stuns both for 1 s
    const a = arena('vashil', [[7, 1.7], [7, -1.7]]);
    const [p, q] = a.foes;
    const c1 = cast(a, 'a1', 17, Y, 1.0);
    check('pair: Peal hums both, nobody stunned yet', markStacks(p, 'vashil_hum', a.me) === 1 && markStacks(q, 'vashil_hum', a.me) === 1 &&
      stuns(c1.evs, p).length + stuns(c1.evs, q).length === 0);
    refresh(a);
    clearCc(a.foes);
    const c2 = cast(a, 'a2', 17, Y + 1.7, 0.8);
    const sp = stuns(c2.evs, p), sq = stuns(c2.evs, q);
    check('pair: Glass Chime on one completes the chord and stuns BOTH for 1 s', sp.length === 1 && sq.length === 1 && near(sp[0].duration, 1, 0.05) && near(sq[0].duration, 1, 0.05),
      [sp.map((s) => s.duration), sq.map((s) => s.duration)]);
    check('pair: both stop humming and are hushed for 8 s', markStacks(p, 'vashil_hum', a.me) === 0 && markStacks(q, 'vashil_hum', a.me) === 0 &&
      markStacks(p, 'vashil_hushed', a.me) === 1 && markStacks(q, 'vashil_hushed', a.me) === 1);
  }
  { // a pair farther apart than 3.5 m (5 m): no chord
    const a = arena('vashil', [[7, 2.5], [7, -2.5]]);
    const [p, q] = a.foes;
    p.x = 17; p.y = Y + 2.5; q.x = 17; q.y = Y - 2.5; a.w.hashDirty = true;
    // hum both with two chimes aimed at each
    cast(a, 'a2', 17, Y + 2.5, 0.8); refresh(a);
    cast(a, 'a2', 17, Y - 2.5, 0.8); refresh(a);
    const both = markStacks(p, 'vashil_hum', a.me) === 1 && markStacks(q, 'vashil_hum', a.me) === 1;
    const c = cast(a, 'a2', 17, Y + 2.5, 0.8);
    check('apart (5 m): both humming, a third hit does not chord', both && stuns(c.evs, p).length === 0 && stuns(c.evs, q).length === 0, both);
  }
  { // Morning Toll: a lone target is never stunned; a pair is stunned once each, on the second toll
    const a = arena('vashil', [[8, 0]]);
    const [foe] = a.foes;
    const lone = cast(a, 'ult', 18, Y, 3.4);
    check('Morning Toll on a lone target: three tolls, no stun', dmgOn(lone.evs, 'vashil_morning_toll', foe, 'magic').length === 3 && stuns(lone.evs, foe).length === 0);
    const b = arena('vashil', [[8, 1.2], [8, -1.2]]);
    const [p, q] = b.foes;
    const pair = cast(b, 'ult', 18, Y, 3.4);
    const hp = dmgOn(pair.evs, 'vashil_morning_toll', p, 'magic');
    const sp = stuns(pair.evs, p), sq = stuns(pair.evs, q);
    check('Morning Toll on a pair: each stunned exactly once, on the second toll', sp.length === 1 && sq.length === 1 && hp.length === 3 &&
      sp[0].t > hp[0].t + 0.1 && sp[0].t <= hp[1].t + 0.1, [sp.map((s) => s.t), hp.map((h) => h.t)]);
  }
});

finish('probe_sim_kit_hooks');
