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
//   CHANGED(AI3D) (CONTRACT §35.17) - the 3D ring personas:
//   stepper  sidesteps a lot: inside the opponent's range it taps a READ sidestep most decisions (the side with room
//            behind it), else a quick poke; on reaction (18 f) it steps every attack a step can still evade (the same
//            sandbox check as the CPU) and blocks the rest 60 %; punishes every whiff it can reach (out of the step too).
//   circler  circle-walks all the time: holds STEP for 30-70 frames each way around the opponent, pokes when one
//            reaches; 18 f reactions, blocks 60 %.

import CPU_JSON from '../../../../data/cpu.json' with { type: 'json' };
import type { Brain, Decision } from './brain.ts';
import { cmReach } from './brain.ts';
import { createBrainCpu, levelProfile, resolveProfile } from './cpu.ts';
import type { Cpu, Profile } from './cpu.ts';
import { neutralPlan } from './plans.ts';
import { ST } from '../sim/layout.ts';
import { stepBitFor, stepOrder } from './ring3d.ts';

export type PersonaName = 'masher' | 'turtle' | 'jumper' | 'zoner' | 'novice' | 'optimal' | 'stepper' | 'circler';
export const PERSONAS: readonly PersonaName[] = ['masher', 'turtle', 'jumper', 'zoner', 'novice', 'optimal', 'stepper', 'circler'];

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

// CHANGED(AI3D): the ring personas
function pokesInReach(b: Brain): number[] {
  const kit = b.kit;
  const list = kit.lists.pokes.length > 0 ? kit.lists.pokes : kit.lights;
  return list.filter((k) => !kit.moves[k].inert && b.canUse(k) && b.inReach(k));
}

/** centre distance (U) inside which the opponent's longest LINEAR ground strike reaches me (its frame data) */
function opLinearReach(b: Brain): number {
  const s = b.seen;
  let r = 0;
  for (const cm of s.op.cf.moves) if (cm.linear && cm.isStrike && cm.nBox > 0 && !cm.inAir && cm.snapId >= 0) r = Math.max(r, cmReach(cm));
  return r + (s.me.cf.hurtStand[0] >> 1);
}

function stepperPlan(b: Brain): Decision {
  const cfg = PERS.stepper;
  const s = b.seen;
  const near = Math.max(b.opThreatU(), opLinearReach(b)) + Math.round(num(cfg, 'rangeM', 0.4) * 100000);
  if (s.dist > near) return { t: 'hold', d: 6, frames: 6 };
  if (b.rnd() < num(cfg, 'tapRate', 0.6)) {
    b.stats.stepGuesses++;
    const [bit] = stepOrder(b.m, s);
    return { t: 'circle', bit, frames: 1, atk: -1 };
  }
  const p = pokesInReach(b);
  if (p.length > 0) return { t: 'move', idx: p[Math.floor(b.rnd() * p.length)] };
  return { t: 'guard', crouch: false, frames: 8 };
}

function circlerPlan(b: Brain): Decision {
  const cfg = PERS.circler;
  const s = b.seen;
  const p = pokesInReach(b);
  if (p.length > 0 && b.rnd() < num(cfg, 'pokeRate', 0.35)) return { t: 'move', idx: p[Math.floor(b.rnd() * p.length)] };
  if (s.dist > b.opThreatU() + 100000) return { t: 'hold', d: 6, frames: 8 };
  const lo = num(cfg, 'circleMin', 30);
  const hi = num(cfg, 'circleMax', 70);
  const frames = lo + Math.floor(b.rnd() * (hi - lo + 1));
  return { t: 'circle', bit: stepBitFor(s, b.rnd() < 0.5 ? 1 : -1), frames, atk: -1 };
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
    case 'stepper':
      return createBrainCpu(resolveProfile(PERS.stepper ?? {}, TABLE, 'stepper', -1), fighter, seed, stepperPlan);
    case 'circler':
      return createBrainCpu(resolveProfile(PERS.circler ?? {}, TABLE, 'circler', -1), fighter, seed, circlerPlan);
    case 'optimal':
    default:
      return createBrainCpu(resolveProfile(PERS.optimal ?? {}, TABLE, 'optimal', -1), fighter, seed, neutralPlan);
  }
}
