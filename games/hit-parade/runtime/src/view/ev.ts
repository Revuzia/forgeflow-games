/// <reference types="vite/client" />
// HIT PARADE - the sim's event-type table as the VIEW sees it (CONTRACT §4.5, §17 rule 6).
//
// The live table is `EV` exported by core/sim/events.ts (lane SIM). It is read through import.meta.glob so this module
// also builds before that file exists (and in the view lab): until then the fallback numbers the types in CONTRACT
// §4.5 order, which is what the lab's scripted events use. Consumers compare `ev.type === EV.X`, never a literal.
// Node probes never import view code, so the Vite-only glob is fine here.

export const EV_NAMES = [
  'ROUND_INTRO', 'FIGHT', 'HIT', 'BLOCK', 'PARRY', 'PERFECT_PARRY', 'THROW', 'THROW_TECH', 'WHIFF', 'COUNTER', 'PUNISH',
  'KNOCKDOWN', 'WAKEUP', 'WALL_SPLAT', 'GROUND_BOUNCE', 'CRUMPLE', 'PROJ_SPAWN', 'PROJ_HIT', 'PROJ_CLASH', 'IMPACT_START',
  'IMPACT_ARMOR', 'IMPACT_CLASH', 'SHOVE', 'SUPER_FREEZE', 'SUPER_HIT', 'CINEMATIC_START', 'CINEMATIC_END',
  'STAGE_FRIGHT_ON', 'STAGE_FRIGHT_OFF', 'KO', 'TIMEOVER', 'ROUND_END', 'MATCH_END', 'METER_BAR', 'TAUNT', 'CAMERA_CUE',
  'SFX_CUE', 'GOON_SPAWN', 'GOON_DOWN', 'HECKLE_THROW', 'SCORE',
] as const;
export type EvName = typeof EV_NAMES[number];

const mods = import.meta.glob('../core/sim/events.ts', { eager: true }) as Record<string, { EV?: Record<string, unknown> }>;
const live = Object.values(mods)[0]?.EV;

function build(): { table: Record<EvName, number>; source: 'sim' | 'fallback'; missing: string[] } {
  const table = {} as Record<EvName, number>;
  const missing: string[] = [];
  EV_NAMES.forEach((n, i) => {
    if (!live) { table[n] = i; return; }
    const v = live[n];
    if (typeof v === 'number') table[n] = v;
    else { table[n] = -1000 - i; missing.push(n); }      // a name the sim lacks never matches a real event
  });
  return { table, source: live ? 'sim' : 'fallback', missing };
}

const built = build();
export const EV: Readonly<Record<EvName, number>> = built.table;
export const EV_SOURCE: 'sim' | 'fallback' = built.source;
export const EV_MISSING: readonly string[] = built.missing;

/** CONTRACT §19.8 CAMERA_CUE `b` values (CUE in events.ts). */
export const CUE = { SUPER_FREEZE: 1, PERFECT_PARRY: 2, KO: 3, CINEMATIC: 4, WALL_SPLAT: 5 } as const;

/** §17 rule 6 strength classes carried in `c` of hit-type events */
export const STRENGTH = { L: 0, M: 1, H: 2, SPECIAL: 3, SUPER: 4, IMPACT: 5, PROJECTILE: 6, THROW: 7 } as const;

export function evName(type: number): string {
  for (const n of EV_NAMES) if (EV[n] === type) return n;
  return `EV${type}`;
}
