// BLOCKTOOTH — titan kit dispatcher (CONTRACT §5.3, §8). THREE-FREE, deterministic.
// Contract exports: stepKit, kitOnHurt, kitOnDash.
// Lane-internal extras (used only by titans/titansim.ts): initKit, kitMassMul.

import type { TitanId, World } from '../../core/types.ts';
import * as molo from './molo.ts';
import * as voltkite from './voltkite.ts';
import * as hearthback from './hearthback.ts';
import * as briarwick from './briarwick.ts';

interface KitModule {
  step(w: World): void;
  onHurt?(w: World, dmg: number): number;
  onDash?(w: World, x0: number, z0: number, x1: number, z1: number): void;
  /** initial numeric kit state (the view may read these keys from frame 1) */
  init?(): Record<string, number>;
  /** multiplier on mass gained right now (MOLO "raw mass" while vacuuming) */
  massMul?(w: World): number;
  /** the auto attack's current reach (m) */
  reach?(w: World): number;
}

const KITS: Record<TitanId, KitModule> = { molo, voltkite, hearthback, briarwick };

/** Tick the active titan's kit: cooldown timers, auto-attack, passives, hook. Called at the end of stepTitan. */
export function stepKit(w: World): void {
  const T = w.titan;
  if (!T.alive) return;
  T.abilityCd = Math.max(0, T.abilityCd - w.dt);
  // autoCd may dip slightly below 0 so the next interval carries the remainder (steady cadence);
  // kits clamp it back to 0 while idling so a fresh target is attacked immediately.
  T.autoCd -= w.dt;
  if (T.autoCd < -1) T.autoCd = -1;
  KITS[T.id].step(w);
}

/** Kit reaction to incoming damage (post-armor, pre-shield). Returns the damage that continues on. */
export function kitOnHurt(w: World, dmg: number): number {
  const k = KITS[w.titan.id];
  return k.onHurt ? k.onHurt(w, dmg) : dmg;
}

/** Called once when a dash finishes, with its actual start and end points. */
export function kitOnDash(w: World, x0: number, z0: number, x1: number, z1: number): void {
  const k = KITS[w.titan.id];
  if (k.onDash) k.onDash(w, x0, z0, x1, z1);
}

/** Initial kit record for a titan (lane-internal; used by createTitan). */
export function initKit(id: TitanId): Record<string, number> {
  const k = KITS[id];
  return k.init ? k.init() : {};
}

/** Mass multiplier from the kit (lane-internal; used by gainMass). */
export function kitMassMul(w: World): number {
  const k = KITS[w.titan.id];
  if (!k.massMul) return 1;
  const m = k.massMul(w);
  return m > 0 && Number.isFinite(m) ? m : 1;
}

/** Current auto-attack reach of the active kit (m; lane-internal, used by combat/pickups). */
export function kitReach(w: World): number {
  const k = KITS[w.titan.id];
  const r = k && k.reach ? k.reach(w) : 0;
  return r > 0 && Number.isFinite(r) ? r : 0;
}
