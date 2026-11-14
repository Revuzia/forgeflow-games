// BLOCKTOOTH — GATEKEEPERS copy (GATEKEEPERS.md §1, §6.6). THREE-free, DOM-free data. Lane K2b (GATE UI).
//
// The name register of §1 (use exactly these) plus every on-screen line the gate UI prints:
//   * the GROW-bar lock lines (ui/hud.ts): `SIZE LOCKED — <NAME> EN ROUTE`, `SIZE LOCKED — BEAT <NAME>`,
//     and the city boss's `SIZE LOCKED — <BOSS> EN ROUTE · 0:nn` countdown (§4.1);
//   * the WARD-7 WIRE ticker lines on gateSpawn / gateDefeated (§6.7): `<NAME> IS ENFORCING THE SIZE <n>
//     LIMIT`, `LIMIT LIFTED — SIZE <n+1>`;
//   * the GATEKEEPER nameplate variant (ui/bossbar.ts): the rematch kicker `REISSUED · SIZE V`, the gate
//     stagger / intro / kill lines;
//   * the marker labels (ui/markers.ts): the `gate` edge arrow (the gatekeeper's name) and the `weakPoint`
//     chips `HIT THE DRUM` / `HIT THE PACK` / `HIT THE DISH`;
//   * the tabloid sub-heads (ui/broadcast.ts): `HELD AT SIZE II BY CORDON-2` and the endless `REISSUED n`;
//   * the finale skip hint (`SKIP [ENTER]` / `SKIP [A]`; the app draws it, game.ts).
// The six full-width banners (gate1..3, gateEscalate, gateRematch, finale) live in data/strings.ts ALERTS
// (a Record<AlertKey, …>; K0 wrote them with the §6.6 copy).
// Templates use `{key}` placeholders (ui/dom.ts fmt).

import type { GateId } from '../core/types.ts';

export const STR_GATE = {
  /** on-screen kicker for the system (never the word "gatekeeper" in lower case on screen) */
  kicker: 'GATEKEEPER',
  /** the idea on screen */
  idea: 'HEIGHT LIMIT',
  /** fx word stamped over the wreck before the MASS BREACH banner */
  killStamp: 'LIMIT LIFTED',
  /** the WET PAINT hazard */
  hazard: 'WET PAINT',
  /** the finale banner (also ALERTS.finale.title) */
  finale: 'THE CITY GOT SMALLER.',
  names: {
    stencil1: { name: 'STENCIL-1', title: 'HALVARD ROAD-MARKING UNIT', meter: 'SPILL', stagger: 'TIPPED OVER', weak: 'the DRUM' },
    cordon2: { name: 'CORDON-2', title: 'HALVARD CROWD-BARRIER UNIT', meter: 'STALL', stagger: 'STALLED', weak: 'the PACK' },
    switchboard5: { name: 'SWITCHBOARD-5', title: 'HALVARD MOBILE SWITCHBOARD', meter: 'FEEDBACK', stagger: 'LINES DOWN', weak: 'the DISHES' },
  } as Readonly<Record<GateId, { name: string; title: string; meter: string; stagger: string; weak: string }>>,
  attacks: {
    stencil1: ['STRIPE RUN', 'PAINT BUCKETS', 'DOUBLE LINE', 'U-TURN'],
    cordon2: ['SHIELD SHOVE', 'SAWHORSE TOSS', 'BACKFIRE', 'SQUAD BEHIND THE LINE'],
    switchboard5: ['CALL-IN', 'PUT THROUGH', 'HOLD MUSIC', 'RELOCATE'],
  } as Readonly<Record<GateId, readonly string[]>>,
  goals: ['TIPPED OFF', 'LINE CROSSED', 'HANG UP', 'WITHOUT A DENT', 'OVER THE LIMIT', 'REISSUED'] as readonly string[],
  cards: ['Fresh Coat', 'Sawhorse Stack', 'Call Waiting', 'Blanket Exemption', 'Carbon Copy'] as readonly string[],
  perk: 'DEFERRED MAINTENANCE',

  // ─────────────────────────────── the GROW bar (ui/hud.ts, §6.6 / §4.1) ───────────────────────────────
  grow: {
    /** a Size gate is pending (the lock tick → the spawn) */
    enRoute: 'SIZE LOCKED — {name} EN ROUTE',
    /** the city boss waits for GATES.mainEarliestS: a whole-second countdown ({t} = m:ss) */
    enRouteT: 'SIZE LOCKED — {name} EN ROUTE · {t}',
    /** the fight is alive */
    beat: 'SIZE LOCKED — BEAT {name}',
    /** the padlock chip on the status card's SIZE box */
    chip: 'LOCKED',
  },

  // ─────────────────────────────── WARD-7 WIRE ticker (ui/hud.ts, §6.7) ───────────────────────────────
  wire: {
    /** gateSpawn (home): {n} = the Size it holds the titan at */
    spawn: '{name} IS ENFORCING THE SIZE {n} LIMIT',
    /** gateDefeated (home): {n} = the Size the breach reaches */
    defeated: 'LIMIT LIFTED — SIZE {n}',
    /** gateSpawn (EXTENDED COVERAGE rematch) */
    rematchSpawn: 'HEIGHT LIMIT REISSUED — {name} RE-ENLARGED FOR SIZE {n} DUTY',
    /** gateDefeated (rematch: no breach) */
    rematchDefeated: 'REISSUED LIMIT LIFTED — {name} RETURNED TO THE DEPOT',
    /** gateEscalate (containment pressure rose) */
    escalate: 'HALVARD STEPS UP HEIGHT-LIMIT ENFORCEMENT — "EVERY UNIT, EVERY STREET"',
  },

  // ─────────────────────────────── the GATEKEEPER nameplate (ui/bossbar.ts, §6.6) ───────────────────────────────
  plate: {
    /** kicker for an EXTENDED COVERAGE rematch (slot 0); home gatekeepers use BossDef.kicker */
    rematchKicker: 'REISSUED · SIZE V',
    /** the subtitle during the invulnerable walk-in */
    approaching: 'EN ROUTE — THE HEIGHT LIMIT IS IN FORCE',
    /** the walk-in subtitle of an EXTENDED COVERAGE rematch */
    rematchApproaching: 'EN ROUTE — THE HEIGHT LIMIT HAS BEEN REISSUED',
    /** the meter line while staggered ({word} = TIPPED OVER / STALLED / LINES DOWN) */
    staggered: '{word} — DOUBLE DAMAGE',
    /** the subtitle once it is down (the plate hides 1.5 s later) */
    defeated: 'LIMIT LIFTED',
  },

  // ─────────────────────────────── markers (ui/markers.ts, §6.6) ───────────────────────────────
  marker: {
    /** the edge arrow's label when the sub carries no resolvable gatekeeper */
    gate: 'GATEKEEPER',
    /** weak-point chips, by gatekeeper */
    weak: { stencil1: 'HIT THE DRUM', cordon2: 'HIT THE PACK', switchboard5: 'HIT THE DISH' } as Readonly<Record<GateId, string>>,
    /** a weak-point chip whose gatekeeper cannot be resolved */
    weakAny: 'HIT THE WEAK POINT',
  },

  // ─────────────────────────────── tabloid (ui/broadcast.ts, §6.6 / §4.4) ───────────────────────────────
  tabloid: {
    /** the dead front page's sub-head when a gatekeeper held the titan ({size} = the held Size) */
    heldBy: 'HELD AT SIZE {size} BY {name}',
    /** appended to the EXTENDED COVERAGE sub-head: gatekeeper rematches won */
    reissued: 'REISSUED {n}',
  },

  // ─────────────────────────────── the finale (§4.3; drawn by the app) ───────────────────────────────
  finaleSkip: { key: 'SKIP [ENTER]', pad: 'SKIP [A]' },
} as const;

const GATE_ID_LIST: readonly GateId[] = ['stencil1', 'cordon2', 'switchboard5'];

/** A GateId from a marker `sub` / free text: the id itself ('cordon2'), its on-screen name ('CORDON-2'), or
 *  any label that contains the name. null when nothing matches. Pure. */
export function gateIdOf(sub: string): GateId | null {
  if (!sub) return null;
  for (const id of GATE_ID_LIST) if (sub === id) return id;
  const s = sub.toUpperCase();
  for (const id of GATE_ID_LIST) if (s.includes(STR_GATE.names[id].name)) return id;
  return null;
}

/** On-screen name of a gatekeeper ('STENCIL-1'). */
export function gateName(id: GateId): string { return STR_GATE.names[id].name; }

/** The weak-point chip for a gatekeeper ('HIT THE DRUM'). */
export function weakPointLabel(id: GateId): string { return STR_GATE.marker.weak[id]; }
