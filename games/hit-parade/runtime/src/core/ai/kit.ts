// HIT PARADE - what the CPU knows about its OWN fighter (lane AI). THREE-free, DOM-free, clock-free.
//
// How to input every move is not guessed from notation: it is MEASURED. buildKit() runs a private
// sandbox Match (mode 'training', same GameData, same fighter, same control scheme), feeds each
// candidate input (normals by direction, SIMPLE S+direction / ASSIST+S / S+H, every motion of the
// kit's classic table with L/M/H/S, throws, IMPACT, air versions after a jump, charge motions after a
// held charge) and records which compiled move actually started and after how many frames. So motion
// priorities, shadowed motions, phase-2 moves the sim does not route yet, stance follow-ups, SIMPLE
// fallbacks - all of it is exactly what the real sim does. The sandbox never touches the real match
// (its own Int32Array); results are cached per (GameData, fighter, scheme).
//
// It also resolves the fighter JSON `cpu` block (style, rangeM, pokes, antiAir, punish, combo, zoning,
// approach, grab, armor, counter, mixup, setup, escape, air, phase2, meter) into compiled move indexes.

import type { FighterDef, GameData } from '../types.ts';
import type { CFighter, CMove } from '../sim/compile.ts';
import { K } from '../sim/compile.ts';
import { createMatch, load, save, step } from '../sim/match.ts';
import type { Match, Scheme } from '../sim/state.ts';
import { F, PH, ST, W, fighterBase } from '../sim/layout.ts';
import { B, MOTION, dirBits, motionSteps } from './pad.ts';
import type { Step } from './pad.ts';

export interface Recipe {
  steps: Step[];
  /** frames from the first step until the move's first frame (measured in the sandbox) */
  lag: number;
  air: boolean;
  /** 0 none, 1 back charge, 2 down charge must be stored first */
  charge: 0 | 1 | 2;
  simple: boolean;
  label: string;
}

export interface MoveInfo {
  idx: number;
  id: string;
  cm: CMove;
  recipe: Recipe | null;
  roles: string[];
  /** strike reach: box front + authored travel up to that box (U); 0 for non-strikes */
  reach: number;
  /** vertical coverage of the strike boxes (U, fighter-local) */
  yLo: number;
  yHi: number;
  firstActive: number;
  damage: number;
  /** blockstun - (active + recovery), SF6 convention */
  advBlock: number;
  advHit: number;
  proj: boolean;
  grab: boolean;
  /** grab reach, pushbox front to pushbox front (U) or -1 = centre reach */
  grabGap: number;
  grabReach: number;
  invStrike: boolean;
  invAir: boolean;
  super: number; // 0, 1, 3
  ex: boolean;
  special: boolean;
  normal: boolean;
  low: boolean;
  overhead: boolean;
  armored: boolean;
  kd: boolean;
  /**
   * does nothing by itself in the sim as built: no hitbox, no projectile, no grab, no cinematic (a stance
   * entry, a teleport / counter / ball move whose unique the sim does not implement yet, a guard stance).
   * The planner never throws one out as an attack.
   */
  inert: boolean;
}

export type ListName = 'pokes' | 'antiAir' | 'punish' | 'combo' | 'zoning' | 'approach' | 'grab' | 'armor' | 'counter'
  | 'mixup' | 'setup' | 'escape' | 'air' | 'phase2';
export const LIST_NAMES: readonly ListName[] = ['pokes', 'antiAir', 'punish', 'combo', 'zoning', 'approach', 'grab', 'armor', 'counter',
  'mixup', 'setup', 'escape', 'air', 'phase2'];

export interface Kit {
  id: string;
  scheme: Scheme;
  cf: CFighter;
  def: FighterDef;
  moves: MoveInfo[];
  byId: Record<string, number>;
  /** fighter JSON cpu lists as compiled indexes (moves with a measured recipe; combo keeps chain parts) */
  lists: Record<ListName, number[]>;
  /** role tag -> usable move indexes */
  roles: Record<string, number[]>;
  /** plan family (STYLE_ALIAS of the fighter's cpu.style) */
  style: string;
  /** the fighter JSON cpu.style as written (a cpu.json `styles` entry of that name wins over the family) */
  rawStyle: string;
  rangeLo: number; // U
  rangeHi: number; // U
  /** usable ground strikes sorted by startup (fastest first) */
  groundStrikes: number[];
  lights: number[];
  projMoves: number[];
  throwF: number;
  throwB: number;
  impact: number;
  sup1: number;
  sup3: number;
  meterMove: number;
  /** calibration report (probe) */
  report: { candidates: number; recipes: number; usable: number; unusable: string[] };
}

/** Style aliases: fighter JSON styles -> the plan families plans.ts implements. */
export const STYLE_ALIAS: Readonly<Record<string, string>> = {
  balanced: 'shoto', shoto: 'shoto', allrounder: 'shoto', rushdown: 'rushdown', grappler: 'grappler', zoner: 'zoner',
  charge: 'charge', stance: 'stance', bigbody: 'bigbody', aerial: 'aerial', setplay: 'setplay', counter: 'counter',
  boss_armor: 'bigbody', boss_showman: 'zoner',
};

const cache = new WeakMap<GameData, Map<string, Kit>>();

function rolesOf(def: FighterDef, id: string): string[] {
  const r = def.moves[id]?.role;
  if (!r) return [];
  return Array.isArray(r) ? r.slice() : [r];
}

interface Cand {
  steps: Step[];
  air: boolean;
  charge: 0 | 1 | 2;
  simple: boolean;
  label: string;
}

const BTN = [B.L, B.M, B.H];
const BTN_NAME = ['L', 'M', 'H'];

function candidates(cf: CFighter, scheme: Scheme): Cand[] {
  const out: Cand[] = [];
  const add = (steps: Step[], label: string, air = false, charge: 0 | 1 | 2 = 0, simple = false): void => {
    out.push({ steps, air, charge, simple, label });
  };
  // ground normals / command normals (direction + button on one frame)
  for (const d of [5, 2, 6, 4, 3, 1]) for (let b = 0; b < 3; b++) add([{ d, b: BTN[b] }], `${d}${BTN_NAME[b]}`);
  // air normals (after a neutral jump)
  for (const d of [5, 2, 6, 4]) for (let b = 0; b < 3; b++) add([{ d, b: BTN[b] }], `j.${d}${BTN_NAME[b]}`, true);
  // throws, IMPACT
  add([{ d: 5, b: B.THROW }], 'THROW');
  add([{ d: 4, b: B.THROW }], '4THROW');
  add([{ d: 5, b: B.IMPACT }], 'IMPACT');
  if (scheme === 0) {
    for (const d of [5, 6, 2, 4]) {
      add([{ d, b: B.S }], `${d}S`, false, 0, true);
      add([{ d, b: B.S | B.ASSIST }], `A${d}S`, false, 0, true);
    }
    add([{ d: 5, b: B.S | B.H }], 'S+H', false, 0, true);
    add([{ d: 2, b: B.S | B.H }], '2S+H', false, 0, true);
    add([{ d: 5, b: B.S }], 'j.S', true, 0, true);
  }
  // every motion the kit's classic table (and the automatic supers) uses
  const motions: number[] = [];
  for (const sp of cf.specials) if (motions.indexOf(sp.motion) < 0) motions.push(sp.motion);
  for (const code of motions) {
    const charge: 0 | 1 | 2 = code === MOTION.CHG_BF ? 1 : code === MOTION.CHG_DU ? 2 : 0;
    const btns = scheme === 1 ? [B.L, B.M, B.H, B.S] : [B.L, B.M, B.H];
    const names = ['L', 'M', 'H', 'S'];
    btns.forEach((bt, k) => {
      add(motionSteps(code, bt), `m${code}${names[k]}`, false, charge);
      add(motionSteps(code, bt), `j.m${code}${names[k]}`, true, charge);
    });
  }
  return out;
}

function sandbox(data: GameData, id: string, scheme: Scheme): Match {
  const m = createMatch({
    mode: 'training', stage: 'rust_theater', seed: 1, timer: 0,
    p: [{ fighter: id, color: 0, scheme, cpu: -1 }, { fighter: id, color: 1, scheme: 1, cpu: -1 }],
  }, data);
  let n = 0;
  while (m.s[W.phase] !== PH.FIGHT && n++ < 2000) step(m, 0, 0);
  for (let k = 0; k < 4; k++) step(m, 0, 0);
  return m;
}

/** Runs one candidate in the sandbox; returns [started move idx, lag] or null. */
function tryCand(m: Match, base: Int32Array, c: Cand, cf: CFighter): [number, number] | null {
  const s = m.s;
  const b = fighterBase(0);
  load(m, base);
  s[b + F.showtime] = m.sys.raw.showtime.bar * m.sys.raw.showtime.bars;
  s[b + F.nerve] = m.sys.raw.nerve.bar * m.sys.raw.nerve.bars;
  const feed = (w: number): void => step(m, w, 0);
  if (c.charge !== 0) {
    const d = c.charge === 1 ? 4 : 2;
    for (let k = 0; k < m.sys.raw.motion.chargeFrames + 3; k++) feed(dirBits(d, s[b + F.facing]));
  }
  if (c.air) {
    for (let k = 0; k < cf.prejump + 1; k++) feed(dirBits(8, s[b + F.facing]));
    for (let k = 0; k < 4; k++) feed(0);
    if (s[b + F.st] !== ST.AIR) return null;
  }
  let lag = 0;
  const steps = c.steps;
  for (let k = 0; k < steps.length + 4; k++) {
    const st = k < steps.length ? steps[k] : null;
    const w = st ? dirBits(st.d, s[b + F.facing]) | st.b : 0;
    feed(w);
    lag++;
    if (s[b + F.st] === ST.ATTACK && s[b + F.mvF] === 1 && s[b + F.mv] >= 0) return [s[b + F.mv], lag];
  }
  return null;
}

function strikeGeometry(cm: CMove): { reach: number; yLo: number; yHi: number; first: number } {
  let reach = 0;
  let yLo = 1 << 30;
  let yHi = -(1 << 30);
  let first = cm.nBox > 0 ? 1 << 30 : cm.startup;
  for (let k = 0; k < cm.nBox; k++) {
    const o = k * 7;
    const f0 = cm.boxes[o];
    const x = cm.boxes[o + 2];
    const y = cm.boxes[o + 3];
    const w = cm.boxes[o + 4];
    const h = cm.boxes[o + 5];
    const travel = cm.curve[Math.max(0, Math.min(f0, cm.curve.length - 1))];
    reach = Math.max(reach, x + (w >> 1) + travel);
    yLo = Math.min(yLo, y - (h >> 1));
    yHi = Math.max(yHi, y + (h >> 1));
    first = Math.min(first, f0);
  }
  if (cm.nBox === 0) {
    yLo = 0;
    yHi = 0;
  }
  return { reach, yLo, yHi, first };
}

function moveDamage(cm: CMove): number {
  if (cm.cin) {
    let t = 0;
    for (let k = 0; k < cm.cin.hitD.length; k++) t += cm.cin.hitD[k];
    return t;
  }
  if (cm.nHid > 1) {
    let t = 0;
    for (let k = 0; k < cm.nHid; k++) t += cm.hidDmg[k];
    return t;
  }
  return cm.damage;
}

/** Builds (or returns the cached) kit knowledge for fighter `id` under control scheme `scheme`. */
export function buildKit(data: GameData, cf: CFighter, scheme: Scheme): Kit {
  let per = cache.get(data);
  if (!per) {
    per = new Map();
    cache.set(data, per);
  }
  const key = `${cf.id}:${scheme}`;
  const hit = per.get(key);
  if (hit) return hit;
  const def = cf.def;
  const m = sandbox(data, cf.id, scheme);
  const base = new Int32Array(m.s.length);
  save(m, base);
  const cands = candidates(cf, scheme);
  const best: (Recipe | null)[] = cf.moves.map(() => null);
  for (const c of cands) {
    const r = tryCand(m, base, c, cf);
    if (!r) continue;
    const [idx, lag] = r;
    const cm = cf.moves[idx];
    if (!cm) continue;
    // a garbled motion that produced a plain normal is not a recipe for that normal
    if (c.steps.length > 1 && cm.isNormalCat) continue;
    const prev = best[idx];
    const better = !prev || lag < prev.lag || (lag === prev.lag && prev.simple && !c.simple) || (lag === prev.lag && prev.charge !== 0 && c.charge === 0);
    if (better) best[idx] = { steps: c.steps, lag, air: c.air, charge: c.charge, simple: c.simple, label: c.label };
  }
  const moves: MoveInfo[] = cf.moves.map((cm, idx) => {
    const g = strikeGeometry(cm);
    const roles = cm.snapId >= 0 ? rolesOf(def, cm.id) : [];
    let recipe = best[idx];
    if (!recipe && cm.chainOnly && cm.inBtn >= 0) {
      // target-combo / chain part: only valid inside the parent's window (the route executor knows)
      recipe = { steps: [{ d: cm.inDir, b: BTN[cm.inBtn] }], lag: 1, air: cm.inAir, charge: 0, simple: false, label: `chain ${cm.id}` };
    }
    return {
      idx, id: cm.id, cm, recipe, roles,
      reach: g.reach, yLo: g.yLo, yHi: g.yHi, firstActive: g.first,
      damage: moveDamage(cm),
      advBlock: cm.blockstun - (cm.active + cm.recovery),
      advHit: cm.hitstun - (cm.active + cm.recovery),
      proj: cm.proj !== null,
      grab: cm.isGrab,
      grabGap: cm.grabGap,
      grabReach: cm.grabReach,
      invStrike: cm.inv[0] > 0 && cm.inv[0] <= cm.startup && cm.inv[1] >= cm.startup,
      invAir: cm.inv[4] > 0 && cm.inv[4] <= cm.startup && cm.inv[5] >= cm.startup,
      super: cm.level,
      ex: cm.isEx,
      special: cm.isSpecialCat,
      normal: cm.isNormalCat,
      low: cm.guard === 2,
      overhead: cm.guard === 1,
      armored: cm.armorHits > 0,
      kd: cm.kd > 0,
      inert: cm.nBox === 0 && cm.proj === null && !cm.isGrab && cm.cin === null,
    };
  });
  const byId: Record<string, number> = {};
  for (const mi of moves) byId[mi.id] = mi.idx;
  const usable = (idx: number): boolean => idx >= 0 && idx < moves.length && moves[idx].recipe !== null;
  const cpu = (def.cpu ?? {}) as Record<string, unknown>;
  const lists = {} as Record<ListName, number[]>;
  for (const ln of LIST_NAMES) {
    const raw = cpu[ln];
    const names = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    const idxs = names.map((n) => (byId[n] !== undefined ? byId[n] : -1));
    lists[ln] = ln === 'combo' ? idxs.filter((x) => x >= 0) : idxs.filter(usable);
  }
  const roles: Record<string, number[]> = {};
  for (const mi of moves) {
    if (!mi.recipe) continue;
    for (const r of mi.roles) (roles[r] ??= []).push(mi.idx);
  }
  const groundStrikes = moves
    .filter((mi) => mi.recipe && !mi.recipe.air && mi.recipe.charge === 0 && mi.cm.isStrike && mi.cm.snapId >= 0 && mi.super === 0 && !mi.ex && !mi.cm.chainOnly && mi.cm.costShow === 0)
    .sort((a, b) => a.cm.startup + a.recipe!.lag - (b.cm.startup + b.recipe!.lag))
    .map((mi) => mi.idx);
  const lights = groundStrikes.filter((k) => moves[k].normal && moves[k].cm.str === 0);
  const projMoves = moves.filter((mi) => mi.recipe && mi.proj && !mi.recipe.air && mi.super === 0 && !mi.ex).map((mi) => mi.idx);
  const style = STYLE_ALIAS[String(cpu.style ?? '')] ?? STYLE_ALIAS[String(def.archetype ?? '')] ?? 'shoto';
  const rng = Array.isArray(cpu.rangeM) && cpu.rangeM.length === 2 ? (cpu.rangeM as number[]) : [1.2, 2.4];
  const meterName = typeof cpu.meter === 'string' ? cpu.meter : '';
  const unusable = moves.filter((mi) => mi.cm.snapId >= 0 && !mi.recipe).map((mi) => mi.id);
  const kit: Kit = {
    id: cf.id, scheme, cf, def, moves, byId, lists, roles, style, rawStyle: String(cpu.style ?? style),
    rangeLo: Math.round(rng[0] * 100000), rangeHi: Math.round(rng[1] * 100000),
    groundStrikes, lights, projMoves,
    throwF: usable(cf.throwF) ? cf.throwF : -1,
    throwB: usable(cf.throwB) ? cf.throwB : -1,
    impact: usable(cf.impact) ? cf.impact : -1,
    sup1: usable(cf.sup1) ? cf.sup1 : -1,
    sup3: usable(cf.sup3) ? cf.sup3 : -1,
    meterMove: byId[meterName] !== undefined && usable(byId[meterName]) ? byId[meterName] : usable(cf.sup1) ? cf.sup1 : -1,
    report: { candidates: cands.length, recipes: best.filter((r) => r !== null).length, usable: moves.filter((mi) => mi.recipe).length, unusable },
  };
  per.set(key, kit);
  return kit;
}

/** Is `idx` a legal cancel / chain target from the running move `cur` (on contact)? */
export function cancelsInto(cur: CMove, next: CMove): boolean {
  if (cur.chains.indexOf(next.idx) >= 0) return true;
  if (next.isSpecialCat && cur.cSpecial) return true;
  if (next.isSuper && cur.cSuper) return true;
  return false;
}

export { K };
