// GENESIS — what a task DOES when its work ends (CONTRACT.md §8.3): eating, drinking and sleeping restore needs;
// gathering, fishing, hunting and farming bring goods (and wear the land); hauling and building raise houses; crafting
// runs recipes; teaching, study, experiment, accidents of the day and artifacts move knowledge; prayer, company and
// courtship feed the inner needs and make households. A few tasks chain straight into the next one (haul -> build).

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { DEATH, INV, MEMK, NS, NT, SKILL, TASK, TRAIT } from './defs.ts';
import { BELONG, FAITH, FOOD, NEED_N, REST, WATER, WET } from './needs.ts';
import { availability, itemIdx } from './resources.ts';
import { bestFood, storeAdd, storeHas, storeTake, storeTakeAny, storeAny } from './store.ts';
import { craft } from '../recipes/crafting.ts';
import { accident, learn, learnBoost, libraryEffect, resolveExperiment, reverseEngineer, talk, teachSession } from './knowledge.ts';
import { die, practise, insertSorted } from './lifecycle.ts';
import { leaveShelter, startTask } from './tasks.ts';
import { takeMaterial, workOn, materialItems } from './buildings.ts';
import { cellContexts } from './context.ts';
import { fireSourceNear, FUEL_TICKS } from './fire.ts';
import { animalDef, herdPos } from '../life/herds.ts';
import { distM, spotInCell } from './world.ts';
import { seedItems, FOOD_SESSION, waterHere, planDrinkNear } from './decide.ts';
import { emitAt, agentRef } from './util.ts';
import { missionTaskDone } from './missions.ts';
import { godHooks } from './hooks.ts';
import { addWorship, meet } from './culture.ts';
import { formCouple } from './social.ts';
import { breathable } from '../space/habitat.ts';
import { FOOD_YIELD, endTrip, foodSessionDone } from '../perf/pace.ts';
// LIVING LAND (LIVING.md §2): the hunt's encounters, herds, crops, fish stocks, children's days and gatherings, the
// books, and needs that can be met
import { huntEncounter } from './hunt.ts';
import { herdWork } from './herding.ts';
import { farmWork } from './crops.ts';
import { fishWork } from './fishing.ts';
import { choreDone, gatherDone, playDone, raiseDone } from './gatherings.ts';
import { noteCraft, noteGathered } from './ledger.ts';
import { craftOutlet, curiosityGain, statusGain, talkOutlet } from './outlets.ts';
import { rise } from '../god/regard.ts';

const _p = [0, 0, 0];
const _q = [0, 0, 0];
const _near: number[] = [];

/** base units a session at full availability yields, by item id */
const BASE_YIELD: Record<string, number> = {
  berries: 6, 'wild-grain': 6, roots: 5, nuts: 4, herbs: 2, honey: 1.5, fiber: 4, reeds: 4, stick: 4, wood: 3, bark: 2, resin: 1.2,
  stone: 3, flint: 2, obsidian: 1.5, clay: 4, sand: 4, salt: 2, 'ice-block': 3, tholin: 5, chitin: 2,
};

/** tool help for a task (1 = bare hands) */
function toolFactor(x: PCtx, s: number, kind: number): number {
  const t = x.A.tool[s];
  if (t < 0) return 1;
  const it = x.c.items.list[t];
  const q = it.quality ?? 1;
  const tags = it.tags;
  const fits =
    (kind === TASK.chop && tags.includes('chop')) || (kind === TASK.hunt && (tags.includes('hunt') || tags.includes('weapon'))) ||
    (kind === TASK.fish && tags.includes('fish')) || ((kind === TASK.dig || kind === TASK.farm) && (tags.includes('dig') || tags.includes('till') || tags.includes('reap'))) ||
    ((kind === TASK.quarry || kind === TASK.mine) && (tags.includes('pound') || tags.includes('dig'))) || (kind === TASK.forage && (tags.includes('container') || tags.includes('cut')));
  return fits ? 1 + 0.35 * q : 1;
}

function effect(x: PCtx, st: Settlement | undefined, key: string): number {
  if (!st) return 1;
  return libraryEffect(x, st, key);
}

/** apply the effect of agent s's finished task; returns true if it chained into a new task (no decision needed) */
export function finishTask(x: PCtx, s: number): boolean {
  const A = x.A;
  const st = x.ps.settlement(A.settlement[s]);
  const kind = A.task[s];
  const nb = s * NEED_N;
  switch (kind) {
    case TASK.sleep: case TASK.camp: {
      A.needs[nb + REST] = Math.min(1, A.needs[nb + REST] + (A.tWork[s] / 480) * 1.05);
      A.dayWork[s] = 0; // (LIVING PACE: a new working day — perf/pace.ts)
      if (A.flags[s] & AgentFlag.sleepingIndoors) leaveShelter(x, s);
      return false;
    }
    case TASK.eat:
      eat(x, s, st, A.tData[s] === 1);
      // a meal by water is taken with a drink (parched people walked from the store to the river and back)
      if (A.needs[nb + WATER] < 0.85 && waterHere(x, s)) A.needs[nb + WATER] = 1;
      return false;
    case TASK.drink: {
      // only where there is water: a drink whose route was blocked ended wherever the walk stopped, and quenched them
      if (waterHere(x, s)) { A.needs[nb + WATER] = 1; return false; }
      // the spot was out of reach: the nearest other one, else home's best drinking spot (sorted by the way from home:
      // reachable from there), once (tData 1 = already a second try). (LIVING LAND §2.7: the settlement looks again for
      // where the water is — its list is refreshed at the next settlement step)
      if (st && !st.band) st.recent.waterStale = x.tick;
      if (A.tData[s] !== 1) {
        let t = planDrinkNear(x, s, A.gcell[s]);
        if (!t && st && !st.band && st.res) {
          const w = st.res.water.find((c) => c !== A.gcell[s]);
          if (w !== undefined) t = { kind: TASK.drink, goal: spotFor(x, s, w, 5), goalCell: w, work: 15, data: 1 };
        }
        if (t) { startTask(x, s, t); return true; }
      }
      return false;
    }
    case TASK.bathe:
      A.needs[nb + WET] = 1; A.needs[nb + BELONG] = Math.min(1, A.needs[nb + BELONG] + 0.05);
      // bathing in fresh water, one drinks too (coastal folk spent hours in a lake and then died of thirst on its shore)
      if (A.needs[nb + WATER] < 0.85 && waterHere(x, s)) A.needs[nb + WATER] = 1;
      return false;
    case TASK.forage: case TASK.chop: case TASK.quarry: case TASK.dig: case TASK.mine: case TASK.cutIce: case TASK.collectAir: case TASK.secrete:
      gather(x, s, st, kind); return false;
    // (LIVING LAND: the catch from a shoal or the water's own stock — people/fishing.ts; the hunting party's encounter —
    // people/hunt.ts)
    case TASK.fish: fishWork(x, s, st, toolFactor(x, s, TASK.fish), nearCell.bind(null, x)); return false;
    case TASK.hunt: huntEncounter(x, s, st); return false;
    case TASK.store:
      if (A.mission[s] && A.tData[s] === 4) { missionTaskDone(x, s); return false; }
      if (st) deposit(x, s, st);
      return false;
    case TASK.trade: case TASK.raid: case TASK.fight: case TASK.sail:
      if (A.mission[s]) missionTaskDone(x, s);
      return false;
    case TASK.guard: {
      A.needs[nb + 4] = Math.min(1, A.needs[nb + 4] + 0.1);
      practise(x, s, SKILL.fight, 0.004);
      return false;
    }
    case TASK.haul: return haul(x, s, st);
    case TASK.build: build(x, s, st); return false;
    case TASK.repair: repair(x, s, st); return false;
    case TASK.craft: {
      if (!st) return false;
      const res = craft(x, s, st, A.tData[s], A.cell[s]);
      // (a rocket made at the launchpad is a hull in the store: the first orbit is told when a ship reaches orbit —
      // space/flight.ts — not when it is made)
      if (res.ok) {
        equipFromStore(x, s, st);
        // (LIVING LAND: the books; those standing by watch the craft — people/ledger.ts, outlets.ts)
        noteCraft(x, st, A.tData[s]);
        craftOutlet(x, s, x.ps.agentsIn(A.cell[s], _near));
      }
      return false;
    }
    // (LIVING LAND: crops on the season's clock — people/crops.ts; herds kept and tamed — people/herding.ts)
    case TASK.farm: farmWork(x, s, st, toolFactor(x, s, TASK.farm)); return false;
    case TASK.herd: herdWork(x, s, st); return false;
    case TASK.tendFire: tendFire(x, s, st); return false;
    case TASK.teach: {
      const l = A.slotOf(A.tTarget[s]);
      if (l >= 0 && A.alive[l] && A.cell[l] !== undefined) {
        A.posAt(l, x.tick, _p);
        A.posAt(s, x.tick, _q);
        if (distM(x.p, _p, _q) < 3 * x.p.edgeM) {
          teachSession(x, s, l, A.tData[s]);
          // (LIVING LAND: being taught feeds curiosity; teaching is a thing to be known for — people/outlets.ts)
          curiosityGain(x, l, 0.2);
          statusGain(x, s, 0.03);
        }
      }
      practise(x, s, SKILL.lore, 0.01);
      return false;
    }
    case TASK.learn: {
      const k = A.tData[s];
      const r = x.rt.list[k];
      if (r && st && st.written.includes(k) && hashFloat(A.id[s], k, x.tick, 0xb00c) < (1 - r.teach * 0.6) * 0.45 * learnBoost(x, st)) learn(x, s, k, 'book');
      practise(x, s, SKILL.lore, 0.02);
      curiosityGain(x, s, 0.25); // (LIVING LAND: a book read)
      return false;
    }
    case TASK.experiment: experiment(x, s, st); return false;
    case TASK.explore: explore(x, s, st); return false;
    case TASK.reverse: reverse(x, s, st); return false;
    case TASK.pray: case TASK.worship: case TASK.preach: worship(x, s, st, kind); return false;
    case TASK.socialize: {
      A.needs[nb + BELONG] = Math.min(1, A.needs[nb + BELONG] + 0.45);
      talk(x, s, A.cell[s]);
      // (LIVING LAND: someone here knows what they do not — the news of the talk: people/outlets.ts)
      talkOutlet(x, s, x.ps.agentsIn(A.cell[s], _near));
      return false;
    }
    case TASK.court: court(x, s, st); return false;
    case TASK.mourn: {
      A.remember(s, MEMK.mourned, x.tick, 0);
      A.needs[nb + FAITH] = Math.min(1, A.needs[nb + FAITH] + 0.15);
      A.needs[nb + BELONG] = Math.min(1, A.needs[nb + BELONG] + 0.1);
      return false;
    }
    case TASK.bury: {
      A.needs[nb + FAITH] = Math.min(1, A.needs[nb + FAITH] + 0.2);
      if (st) accident(x, st, 'death', A.cell[s]);
      return false;
    }
    case TASK.heal: heal(x, s, st); return false;
    case TASK.warm: {
      if (A.flags[s] & AgentFlag.sleepingIndoors) leaveShelter(x, s);
      return false;
    }
    // (LIVING LAND: a child's play and chores, a gathering of the settlement, raising an infant — people/gatherings.ts)
    case TASK.play: playDone(x, s); return false;
    case TASK.chore: choreDone(x, s, st); return false;
    case TASK.gather: gatherDone(x, s, st); return false;
    case TASK.raiseChild: raiseDone(x, s, st, (m) => eat(x, m, st, true)); return false;
    default: return false;
  }
}

// ───────────────────────────── eating ─────────────────────────────

/** (exported for the meal in passing of the peoples' time-lapse: perf/plapse.ts, SIM perf push 3) */
export function eat(x: PCtx, s: number, st: Settlement | undefined, fromStore: boolean): void {
  const A = x.A;
  const sp = x.info[A.species[s]];
  const nb = s * NEED_N;
  const perDay = Math.max(0.05, sp.decay[FOOD]);
  let need = 1 - A.needs[nb + FOOD];
  // from the hand first
  for (const it of sp.foods) {
    if (need <= 0.02) break;
    const have = A.carried(s, it);
    if (have <= 0) continue;
    const per = sp.edible[it] * perDay;
    const units = Math.min(have, need / per);
    A.take(s, it, units);
    need -= units * per;
  }
  if (fromStore && st && need > 0.02) {
    for (let guard = 0; guard < 6 && need > 0.02; guard++) {
      const it = bestFood(x, st);
      if (it < 0) break;
      const per = sp.edible[it] * perDay;
      const units = storeTake(st, it, Math.min(need / per, storeHas(st, it)));
      if (units <= 0) break;
      need -= units * per;
    }
  }
  A.needs[nb + FOOD] = Math.min(1, 1 - Math.max(0, need));
}

// ───────────────────────────── gathering ─────────────────────────────

function gather(x: PCtx, s: number, st: Settlement | undefined, kind: number): void {
  const A = x.A;
  const it = A.tData[s];
  if (it < 0) return;
  const c = A.cell[s];
  const av = availability(x, it, c);
  if (av <= 0.02) return;
  const item = x.c.items.list[it];
  const perFood = FOOD_SESSION[item.id];
  const base = perFood !== undefined && item.food ? perFood / item.food : BASE_YIELD[item.id] ?? 2.5;
  let units = base * Math.min(1, av) * (0.6 + 1.1 * A.skills[s * NS + SKILL.gather]) * toolFactor(x, s, kind);
  // (LIVING PACE: a day's food work is a few sessions — perf/pace.ts)
  if (item.food) { units *= FOOD_YIELD; foodSessionDone(x, s); }
  if (kind === TASK.forage) units *= effect(x, st, 'yield.forage');
  if (kind === TASK.mine) {
    const known = st && st.library.includes(x.rt.byId.get('mining') ?? -1);
    units *= known ? (st && x.ps.of(st.id).some((b) => b.progress >= 1 && x.c.buildings.list[b.type].function === 'mine') ? 2 : 1.2) : 0.35;
  }
  units = Math.round(units * 100) / 100;
  if (units <= 0) return;
  const left = A.give(s, it, units);
  if (left > 0 && st && !st.band) storeAdd(x, st, it, left);
  if (st) noteGathered(x, st, it, units, !!item.food); // (LIVING LAND: the books — people/ledger.ts)
  practise(x, s, SKILL.gather, 0.012);
  // the land gives it up
  const f = x.p.f;
  const id = item.id;
  if (id === 'berries' || id === 'herbs') f.shrub[c] = Math.max(0, f.shrub[c] - 0.0025 * units);
  else if (id === 'wild-grain' || id === 'roots' || id === 'fiber') f.grass[c] = Math.max(0, f.grass[c] - 0.002 * units);
  else if (id === 'wood' || id === 'bark') f.tree[c] = Math.max(0, f.tree[c] - 0.0035 * units);
  else if (id === 'reeds') f.grass[c] = Math.max(0, f.grass[c] - 0.003 * units);
  else if (f.oreType[c] > 0 && (kind === TASK.mine || kind === TASK.quarry || kind === TASK.dig)) f.ore[c] = Math.max(0, f.ore[c] - 0.0015 * units);
  // seeds spilled around a camp may come up again (agriculture's accident), wood near fire...
  if (st && !st.band && (id === 'wild-grain') && hashFloat(A.id[s], x.tick, 0x5eed) < 0.02) st.recent['spilled-seed'] = x.tick;
}

function nearCell(x: PCtx, a: number, b: number): boolean {
  const g = x.p.grid;
  for (let e = g.nbrStart[a]; e < g.nbrStart[a + 1]; e++) if (g.nbr[e] === b) return true;
  return a === b;
}

// ───────────────────────────── store, haul, build ─────────────────────────────

function deposit(x: PCtx, s: number, st: Settlement): void {
  const A = x.A;
  // (LIVING PACE: home from a trip — perf/pace.ts)
  if (A.camp[s] >= 0) endTrip(x, s);
  for (let k = 0; k < INV; k++) {
    const it = A.invItem[s * INV + k];
    if (it < 0) continue;
    storeAdd(x, st, it, A.invQty[s * INV + k]);
    A.invItem[s * INV + k] = -1;
    A.invQty[s * INV + k] = 0;
  }
  equipFromStore(x, s, st);
}

/** take clothing and a tool for the role from the store */
export function equipFromStore(x: PCtx, s: number, st: Settlement): void {
  const A = x.A;
  if (A.gear[s] < 0) {
    let best = -1, bw = 0;
    // (a pressure suit is clothing too, the warmest — but it is kept for a world whose air would kill, not worn to the
    // fields: a town that wore its suits had none left for the settlers it sent to such a world)
    const sealOnly = breathable(x.c.species.list[A.species[s]], x.p.st.atmosphere);
    for (const it of x.c.itemsByTag.get('clothing') ?? []) {
      const w = x.c.items.list[it].warmth ?? 0;
      if (sealOnly && x.c.items.list[it].tags.includes('suit')) continue;
      if (storeHas(st, it) >= 1 && w > bw) { bw = w; best = it; }
    }
    if (best >= 0 && storeTake(st, best, 1) >= 1) A.gear[s] = best;
  }
  if (A.tool[s] < 0) {
    const want = ROLE_TOOL[A.role[s]] ?? 'cut';
    let best = -1, bq = 0;
    for (const it of x.c.itemsByTag.get(want) ?? []) {
      const q = x.c.items.list[it].quality ?? 1;
      const tags = x.c.items.list[it].tags;
      if (storeHas(st, it) >= 1 && q > bq && (tags.includes('tool') || tags.includes('weapon'))) { bq = q; best = it; }
    }
    if (best >= 0 && storeTake(st, best, 1) >= 1) A.tool[s] = best;
  }
}

const ROLE_TOOL: Record<number, string> = { 1: 'cut', 2: 'hunt', 3: 'fish', 4: 'till', 5: 'cut', 6: 'cut', 7: 'chop', 12: 'weapon' };

function haul(x: PCtx, s: number, st: Settlement | undefined): boolean {
  const A = x.A;
  if (!st) return false;
  const b = x.ps.building(A.tTarget[s]);
  if (!b || b.progress >= 1) return false;
  const def = x.c.buildings.list[b.type];
  const room = def.cost - b.delivered;
  if (room <= 0) return false;
  const units = takeMaterial(x, st, b, Math.min(room, 2 + Math.floor(A.skills[s * NS + SKILL.build] * 3)));
  if (units <= 0) return false;
  // show what is carried
  const items = materialItems(x, b.material);
  if (items.length) A.give(s, items[0][0], items[0][1] * units);
  const out = [0, 0, 0];
  const a = hashFloat(A.id[s], x.tick, 0xb17) * Math.PI * 2;
  const r = def.footprint + 0.8;
  let ex = b.pos[2], ez = -b.pos[0];
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = b.pos[1] * ez, ny = b.pos[2] * ex - b.pos[0] * ez, nz = -b.pos[1] * ex;
  const k = r / x.p.st.radius;
  out[0] = b.pos[0] + (Math.cos(a) * ex + Math.sin(a) * nx) * k;
  out[1] = b.pos[1] + Math.sin(a) * ny * k;
  out[2] = b.pos[2] + (Math.cos(a) * ez + Math.sin(a) * nz) * k;
  const l = Math.hypot(out[0], out[1], out[2]);
  out[0] /= l; out[1] /= l; out[2] /= l;
  startTask(x, s, { kind: TASK.build, goal: out, goalCell: b.cell, work: 100, target: b.id, data2: units });
  return true;
}

function build(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const b = x.ps.building(A.tTarget[s]);
  const carried = Math.max(0, A.tData2[s]);
  // put down the carried material
  if (b && carried > 0) {
    const items = materialItems(x, b.material);
    if (items.length) A.take(s, items[0][0], items[0][1] * carried);
  }
  if (!b || !st) return;
  if (b.progress >= 1) {
    if (carried > 0) for (const [it, q] of materialItems(x, b.material)) storeAdd(x, st, it, q * carried);
    return;
  }
  const def = x.c.buildings.list[b.type];
  b.delivered = Math.min(def.cost, b.delivered + carried);
  workOn(x, st, b, A.tWork[s], A.skills[s * NS + SKILL.build]);
  practise(x, s, SKILL.build, 0.015);
}

function repair(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const b = x.ps.building(A.tTarget[s]);
  if (!b || !st || b.flags & BuildingFlag.ruined) return;
  const got = takeMaterial(x, st, b, 1);
  b.damage = Math.max(0, Math.round((b.damage - (got > 0 ? 0.35 : 0.1) * (0.5 + A.skills[s * NS + SKILL.build])) * 10000) / 10000);
  practise(x, s, SKILL.build, 0.01);
  x.ps.version++;
}

// ───────────────────────────── farming & herding ─────────────────────────────

// (LIVING LAND: farming and herding are people/crops.ts farmWork and people/herding.ts herdWork)

function tendFire(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const b = x.ps.building(A.tTarget[s]);
  if (!b || !st) return;
  if (b.fuel <= 0 && !fireSourceNear(x, st)) return;
  // the best fuel at hand
  let fuel = 0;
  const fuels = x.c.itemsByTag.get('fuel') ?? [];
  for (const it of fuels) {
    if (storeHas(st, it) < 1) continue;
    if (storeTake(st, it, 1) >= 1) { fuel = x.c.items.list[it].fuel ?? 1; break; }
  }
  // (LIVING integration 2026-10-27: scraps make a unit. planTendFire sends a tender when the fuels TOGETHER make a unit
  // (decide.ts storeAny); taking only a whole unit of one, a town down to 0.34 wood and 0.77 bark sent everyone, night and
  // day, to a hearth that never caught: seed 3's 50-year world, 39 % of its adults' time at year 50, no work, no wood cut —
  // _harness/scratch/living/integrate/r6/tendfire.ts)
  if (fuel <= 0 && storeAny(st, fuels) >= 1) {
    let q = 0;
    for (const it of fuels) {
      const t = storeTake(st, it, Math.min(storeHas(st, it), 1 - q));
      fuel += t * (x.c.items.list[it].fuel ?? 1);
      q += t;
      if (q >= 0.999) break;
    }
  }
  if (fuel <= 0) return;
  const was = b.fuel > 0;
  b.fuel = Math.min(FUEL_TICKS * 6, b.fuel + Math.round(FUEL_TICKS * 2 * fuel));
  b.flags |= BuildingFlag.lit;
  if (!was) { x.ps.version++; emitAt(x, s, { t: 'fire.lit', ref: { kind: 'building', id: b.id, planet: x.p.id } }); }
  practise(x, s, SKILL.cook, 0.005);
}

// ───────────────────────────── knowledge tasks ─────────────────────────────

function experiment(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const k = A.tData[s];
  const r = x.rt.list[k];
  if (!r || !st) return;
  // the attempt uses some of the inputs, if the store has them
  for (const io of r.inputs) if (storeAny(st, io.items) >= io.qty) storeTakeAny(st, io.items, Math.max(0.5, io.qty * 0.5));
  // a place with a trigger present (or one that happened here lately) helps
  const ok = resolveExperiment(x, s, k, A.tData2[s] === 1);
  if (ok && r.outItems.length) for (const [it, q] of r.outItems) storeAdd(x, st, it, q);
  if (ok) statusGain(x, s, 0.3); // (LIVING LAND: a discovery — people/outlets.ts)
  A.needs[s * NEED_N + 7] = Math.min(1, A.needs[s * NEED_N + 7] + 0.25);
}

const _ctx = new Set<string>();

function explore(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const c = A.tTarget[s] >= 0 ? A.tTarget[s] : A.cell[s];
  A.needs[s * NEED_N + 7] = Math.min(1, A.needs[s * NEED_N + 7] + 0.3);
  if (!st) return;
  cellContexts(x, c, null, _ctx);
  for (const k of _ctx) {
    if (!st.seen.includes(k)) {
      st.seen.push(k);
      if (st.seen.length > 32) st.seen.shift();
    }
  }
  // the land of another settlement: they have met
  const tid = x.p.f.territory[c];
  if (tid >= 0 && tid !== st.id) meet(x, st, x.ps.settlement(tid));
  // strange things lying about are brought home
  const ids = x.ps.iByCell.get(c);
  for (const id of ids) {
    const i = x.ps.items.findIndex((g) => g.id === id);
    if (i < 0) continue;
    const gi = x.ps.items[i];
    const got = Math.min(gi.qty, 4);
    if (A.give(s, gi.item, got) > 0) continue;
    gi.qty -= got;
    if (gi.qty <= 0.001) { x.ps.items.splice(i, 1); x.ps.iByCell.remove(c, id); }
    x.ps.version++;
    break;
  }
}

function reverse(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const it = A.tData[s];
  if (it < 0 || !st) return;
  const gid = A.tTarget[s];
  if (gid >= 0) {
    const i = x.ps.items.findIndex((g) => g.id === gid);
    if (i < 0) return;
    const gi = x.ps.items[i];
    reverseEngineer(x, s, gi.item);
    // carry it home
    if (A.give(s, gi.item, Math.min(gi.qty, 2)) === 0) {
      gi.qty -= Math.min(gi.qty, 2);
      if (gi.qty <= 0.001) { x.ps.items.splice(i, 1); x.ps.iByCell.remove(gi.cell, gi.id); }
      x.ps.version++;
    }
  } else if (storeHas(st, it) >= 1) reverseEngineer(x, s, it);
  A.needs[s * NEED_N + 7] = Math.min(1, A.needs[s * NEED_N + 7] + 0.2);
}

function worship(x: PCtx, s: number, st: Settlement | undefined, kind: number): void {
  const A = x.A;
  const nb = s * NEED_N;
  const piety = A.traits[s * NT + TRAIT.piety];
  A.needs[nb + FAITH] = Math.min(1, A.needs[nb + FAITH] + (kind === TASK.worship ? 0.7 : 0.45));
  // devotion turns toward the god they know
  if (A.love[s * 4] > 0.02) A.love[s * 4] = rise(A.love[s * 4], 0.003 * piety); // (tapering near the top: god/regard.ts)
  // worship flows to the god they believe in (none: to no one)
  // (LIVING RELATIONSHIP: worship by faith and fear and the place; a prophet's sermon by credibility — god/relationship.ts)
  if (st) addWorship(x, st, s, godHooks.worship ? godHooks.worship(x, s, st, kind) : (kind === TASK.worship ? 2 : 1) * (0.5 + piety));
  if (kind === TASK.preach && st) {
    const others: number[] = [];
    x.ps.agentsIn(A.cell[s], others);
    for (const o of others) if (o !== s) A.needs[o * NEED_N + FAITH] = Math.min(1, A.needs[o * NEED_N + FAITH] + 0.2);
  }
}

function court(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const o = A.slotOf(A.tTarget[s]);
  if (!st || o < 0 || !A.alive[o] || A.partner[s] || A.partner[o]) return;
  if (((A.flags[s] ^ A.flags[o]) & AgentFlag.female) === 0) return;
  // a match by mood and sociability
  const p = 0.35 + 0.4 * A.traits[o * NT + TRAIT.sociability];
  if (hashFloat(A.id[s], A.id[o], x.tick, 0xc0e8) >= p) return;
  formCouple(x, st, s, o);
}

function heal(x: PCtx, s: number, st: Settlement | undefined): void {
  const A = x.A;
  const o = A.slotOf(A.tTarget[s]);
  if (!st || o < 0 || !A.alive[o]) return;
  const med = itemIdx(x, 'medicine');
  const hasMed = storeTake(st, med, 0.5) > 0;
  const skill = A.skills[s * NS + SKILL.heal];
  A.health[o] = Math.min(1, A.health[o] + (hasMed ? 0.3 : 0.12) * (0.6 + skill));
  if (A.disease[o] >= 0 && hasMed && hashFloat(A.id[s], A.id[o], x.tick, 0x4ea1) < 0.35 + skill * 0.4) {
    A.disease[o] = -1;
    A.flags[o] &= ~AgentFlag.sick;
    A.remember(o, MEMK.healed, x.tick, A.id[s]);
  }
  practise(x, s, SKILL.heal, 0.02);
  emitAt(x, o, { t: 'healed', ref: agentRef(x, o) });
}

/** spot helper for chained tasks */
export function spotFor(x: PCtx, s: number, c: number, salt: number): number[] {
  return spotInCell(x.p, c, x.A.id[s], salt, [0, 0, 0]);
}
