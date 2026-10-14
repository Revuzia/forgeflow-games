// GENESIS — wrath: survivable by default (LIVING.md §0.1 decision 3, §3.7).
//
// "wrath slider, but survivable by default. Although they scare and kill, they build FEAR, trust, loyalty."
//
// `god.wrath` is a law, 0..1, default 0.3 (`set god.wrath <v>`, logged; "be gentle with them" → 0.1, "set the wrath to
// 0.8"). It scales every harm the GOD sends — a disaster it called down, a sigil, a thing it hurled — by a lethality
// L(w) and a reach R(w): piecewise linear through L(0) = 0.1, R(0) = 0.6, the calibrated point at the default 0.3
// (WRATH_CAL below: what meets the §3.7 survivable table, measured with relationship.ts lethality), and L(1) = R(1) = 1
// (the full harm the game had before). Buildings take a third factor, B(w) (ruination: 0.03 → B03 → 1): walls break
// before people in this model. A cast may carry its own `wrath` (size words: gentle / small 0.1, great / big 0.6, huge
// 0.85, apocalyptic / total / armageddon 1.0 — total destruction is opt-in). Natural disasters keep their own law
// (`disasters.harm`) and are not scaled here.
//
// The wrath of the act in progress is a stack (a command's handler, a disaster's effectors, a landing): god/harm.ts
// reads it in hurtPeople / wreckBuildings, people/people.ts in harmArea / damageArea (through people/hooks.ts), god/
// disasters.ts in impact (crater, fire, ejecta) and area (the land: water drained, crops, lava, fires); a disaster
// keeps the wrath it was sent with (`d.st.Wr`).

import type { Universe } from '../world/universe.ts';

/**
 * the calibrated lethality, reach and ruination at the default wrath 0.3 (§3.7 table; relationship.ts lethality, n = 64,
 * 30-person bronze towns: at L 0.42 / R 0.78 no cast killed anyone and a meteor still ruined 60–68 % of the town; at
 * L 0.6 / R 0.7 / B 0.35 a tornado kills 13–17 %, every other cast under its bound, and a meteor leaves 65 % standing —
 * LIVING.md §3.9). The game never writes it; the calibration probe (`_harness/scratch/living/relationship/rel.ts
 * lethality`, env REL_CAL=L,R,B) sets its fields before it builds a world, to try other points.
 */
export const WRATH_CAL = { L03: 0.6, R03: 0.7, B03: 0.35 };

/** the default wrath (defaultLaws in god/state.ts holds the same number) */
export const WRATH_DEFAULT = 0.3;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** lethality multiplier of harm at wrath w (0.1 at 0 → L03 at 0.3 → 1 at 1) */
export function lethality(w: number): number {
  const x = Math.max(0, Math.min(1, w));
  return x <= 0.3 ? lerp(0.1, WRATH_CAL.L03, x / 0.3) : lerp(WRATH_CAL.L03, 1, (x - 0.3) / 0.7);
}

/** reach multiplier of harm at wrath w (0.6 at 0 → R03 at 0.3 → 1 at 1) */
export function reach(w: number): number {
  const x = Math.max(0, Math.min(1, w));
  return x <= 0.3 ? lerp(0.6, WRATH_CAL.R03, x / 0.3) : lerp(WRATH_CAL.R03, 1, (x - 0.3) / 0.7);
}

/**
 * how hard harm falls on BUILDINGS at wrath w (0.03 at 0 → B03 at 0.3 → 1 at 1). Walls are weaker than people to the
 * same blast in this model (a meteor at L(0.3) ruined 60–68 % of a town while it killed nobody; the 30-person bronze
 * towns stand 19 of 20 buildings within 45 m of their centre, inside any meteor), so a town left standing — the §3.7
 * table's "≥ 60 % of buildings standing, never fallen" — needs its own, lower factor.
 */
export function ruination(w: number): number {
  const x = Math.max(0, Math.min(1, w));
  return x <= 0.3 ? lerp(0.03, WRATH_CAL.B03, x / 0.3) : lerp(WRATH_CAL.B03, 1, (x - 0.3) / 0.7);
}

/** the world's wrath law (0..1) */
export function wrathLaw(u: Universe): number {
  const v = u.god.laws['god.wrath'];
  return v === undefined ? WRATH_DEFAULT : Math.max(0, Math.min(1, v));
}

/** the wrath a cast asks for: its own `wrath`, else the law */
export function wrathOf(u: Universe, a: Record<string, unknown>): number {
  return typeof a.wrath === 'number' && Number.isFinite(a.wrath) ? Math.max(0, Math.min(1, a.wrath)) : wrathLaw(u);
}

// ───────────────────────────── the wrath of the act in progress ─────────────────────────────

/** null: not the god's (nature) — harm keeps its own law */
const stack: (number | null)[] = [];

export function pushWrath(w: number | null): void {
  stack.push(w);
}

export function popWrath(): void {
  stack.pop();
}

/** the wrath of the god-sent harm in progress, or null (nature's, or no act) */
export function currentWrath(): number | null {
  return stack.length ? stack[stack.length - 1] : null;
}

/** a cast's own warning phase (`disaster.spawn { warning }`: ticks, 0 none) — read by god/disasters.ts spawnDisaster */
export const castWarning: (number | undefined)[] = [];

export function currentWarning(): number | undefined {
  return castWarning.length ? castWarning[castWarning.length - 1] : undefined;
}

/** run f under a wrath (and pop it whatever happens) */
export function withWrath<T>(w: number | null, f: () => T): T {
  stack.push(w);
  try { return f(); } finally { stack.pop(); }
}

/** the harm multipliers now: severity × L, radius × R (1, 1 when the harm is nature's) */
export function harmScale(): { L: number; R: number; B: number; w: number | null } {
  const w = currentWrath();
  if (w === null) return { L: 1, R: 1, B: 1, w: null };
  return { L: lethality(w), R: reach(w), B: ruination(w), w };
}

// ───────────────────────────── size words (free text) ─────────────────────────────

/**
 * The wrath a sentence's size words ask for (LIVING §3.7), or undefined: gentle / small / little 0.1, great / big 0.6,
 * huge 0.85, apocalyptic / total / armageddon 1.0.
 */
export function wrathWords(text: string): number | undefined {
  const s = ` ${text.toLowerCase()} `;
  if (/\b(apocalyptic|apocalypse|total|armageddon|annihilat\w*|world-ending|utter)\b/.test(s)) return 1;
  if (/\b(huge|enormous|colossal|massive|devastating|catastrophic)\b/.test(s)) return 0.85;
  if (/\b(great|big|large|terrible|mighty|fierce|violent|furious)\b/.test(s)) return 0.6;
  if (/\b(gentle|gently|small|little|tiny|mild|light|soft|merciful|kind)\b/.test(s)) return 0.1;
  return undefined;
}

/**
 * commands whose harm wrath scales (they take a `wrath` parameter: god/relationship.ts wraps them). A deliberate,
 * targeted act — smiting one named person, razing a town, a rebuke — is the god's choice and is not softened.
 */
export const WRATHFUL = ['disaster.spawn', 'miracle.lightning', 'miracle.fireball', 'miracle.storm', 'miracle.meteor', 'miracle.cast', 'fire.firestorm', 'water.flood', 'water.tsunami'];
