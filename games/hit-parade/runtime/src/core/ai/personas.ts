// HIT PARADE - harness personas (lane AI, CONTRACT §11; FIGHTING_DESIGN §12 "persona playtests").
// Harness only (probe_personas.ts); the game never imports this file. THREE-free.
//
// Every persona is the same honest brain (sense.ts perception, latched reactions, the Pad output stage)
// with its own profile and neutral planner, so a persona can never cheat where the CPU could not:
//   masher   lights only: walks in and presses L / 2L every 2-4 frames; never blocks, never punishes.
//   turtle   always blocks: holds down-back, stands up for overheads it sees (10 f reactions); never attacks.
//   jumper   jump-in spam: jumps forward from jump range, air normal on the way down, a light on landing.
//   zoner    projectile spam: fires whenever its projectile is available, walks back to keep range.
//   novice   a normal player whose every input arrives 400 ms (24 f) late (data/cpu.json personas.novice).
//   optimal  fast human reactions (10 f), blocks everything it can see, punishes everything punishable
//            with the best route, perfect execution, and respects a presser (personas.optimal respect 0.9:
//            inside the range of the buttons a masher keeps pressing it swings a longer normal into the
//            walk-in or holds a guard, instead of walking / dashing / pressing a slower button into it).

import CPU_JSON from '../../../../data/cpu.json' with { type: 'json' };
import type { Brain, Decision } from './brain.ts';
import { createBrainCpu, levelProfile, resolveProfile } from './cpu.ts';
import type { Cpu, Profile } from './cpu.ts';
import { neutralPlan } from './plans.ts';
import { ST } from '../sim/layout.ts';

export type PersonaName = 'masher' | 'turtle' | 'jumper' | 'zoner' | 'novice' | 'optimal';
export const PERSONAS: readonly PersonaName[] = ['masher', 'turtle', 'jumper', 'zoner', 'novice', 'optimal'];

type Obj = Record<string, unknown>;
const TABLE = CPU_JSON as unknown as Obj;
const PERS = (TABLE.personas ?? {}) as Record<string, Obj>;

function num(o: Obj | undefined, k: string, d: number): number {
  const v = o ? o[k] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** a profile that never reacts, never punishes (the pure spam personas) */
function blind(name: string, thinkF: number): Profile {
  const p = levelProfile(0);
  return {
    ...p, name, level: -1, reactF: 100000, block: 0, guessAdapt: 0, antiAir: 0, punish: 0, route: 1, tech: 0, parry: 0, meter: 0,
    nerve: 0, drop: 0, aggression: 1, adaptAggro: false, guard: 0, thinkF, delayF: 0, antiZone: 0, backRise: 0, wakeReversal: 0,
  };
}

// ------------------------------------------------------------------ planners
function masherPlan(b: Brain): Decision {
  const cfg = PERS.masher;
  const range = Math.round(num(cfg, 'rangeM', 1.4) * 100000);
  const s = b.seen;
  if (s.dist > range) return { t: 'hold', d: 6, frames: 4 };
  const lights = b.kit.lights.filter((k) => b.canUse(k) && b.inReach(k));
  if (lights.length === 0) return { t: 'hold', d: 6, frames: 2 };
  const k = lights[Math.floor(b.rnd() * lights.length)];
  const lo = num(cfg, 'pressMin', 2);
  const hi = num(cfg, 'pressMax', 4);
  b.nextThink = s.frame + lo + Math.floor(b.rnd() * (hi - lo + 1));
  return { t: 'move', idx: k };
}

function turtlePlan(b: Brain): Decision {
  return { t: 'guard', crouch: true, frames: 2 };
}

function jumperPlan(b: Brain): Decision {
  const s = b.seen;
  const jm = Math.round(num(PERS.jumper, 'jumpM', 2.4) * 100000);
  if (s.op.st === ST.HITSTUN || s.op.st === ST.BLOCKSTUN) {
    const l = b.kit.lights.find((k) => b.canUse(k) && b.inReach(k));
    if (l !== undefined) return { t: 'move', idx: l };
  }
  if (s.dist <= jm && s.dist >= 90000) {
    b.stats.jumps++;
    return { t: 'steps', steps: [{ d: 9, b: 0 }, { d: 9, b: 0 }] };
  }
  if (s.dist < 90000) return { t: 'steps', steps: [{ d: 4, b: 0 }, { d: 5, b: 0 }, { d: 4, b: 0 }] };
  return { t: 'hold', d: 6, frames: 6 };
}

function zonerPlan(b: Brain): Decision {
  const s = b.seen;
  const keep = Math.round(num(PERS.zoner, 'keepM', 3.2) * 100000);
  const z = (b.kit.lists.zoning.length > 0 ? b.kit.lists.zoning : b.kit.projMoves).concat(b.kit.projMoves).find((k) => b.canUse(k));
  if (z !== undefined) return { t: 'move', idx: z };
  const cornered = Math.abs(s.me.x) > s.wall - 100000 && s.me.x * s.dx < 0;
  if (s.dist < keep && !cornered) return { t: 'hold', d: 4, frames: 6 };
  if (s.dist < 120000) {
    const l = b.kit.lights.find((k) => b.canUse(k) && b.inReach(k));
    if (l !== undefined) return { t: 'move', idx: l };
  }
  return { t: 'hold', d: 5, frames: 4 };
}

/** A harness persona playing `fighter`, seeded. */
export function createPersona(name: PersonaName, fighter: string, seed: number): Cpu {
  switch (name) {
    case 'masher':
      return createBrainCpu(blind('masher', 2), fighter, seed, masherPlan);
    case 'turtle': {
      const p = { ...blind('turtle', 2), reactF: Math.max(1, Math.round(num(PERS.turtle, 'reactF', 10))), block: 1, aggression: 0, guard: 1 };
      return createBrainCpu(p, fighter, seed, turtlePlan);
    }
    case 'jumper': {
      const p = { ...blind('jumper', 6), route: 2 };
      return createBrainCpu(p, fighter, seed, jumperPlan);
    }
    case 'zoner':
      return createBrainCpu(blind('zoner', 4), fighter, seed, zonerPlan);
    case 'novice':
      return createBrainCpu(resolveProfile(PERS.novice ?? {}, TABLE, 'novice', -1), fighter, seed, neutralPlan);
    case 'optimal':
    default:
      return createBrainCpu(resolveProfile(PERS.optimal ?? {}, TABLE, 'optimal', -1), fighter, seed, neutralPlan);
  }
}
