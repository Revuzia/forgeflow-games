/// <reference types="vite/client" />
// HIT PARADE - the sim's event-type table as the UI sees it (CONTRACT 4.5).
//
// The live table is `EV` exported by core/sim/events.ts (lane SIM). It is read through import.meta.glob so this module
// also builds before that file exists: until then the fallback numbers the types in CONTRACT 4.5 order (0..40), which is
// what the lab page's scripted events use. `EV_SOURCE` says which one is live; the HUD only ever compares
// `ev.type === EV.X`, never a literal number.

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
    else { table[n] = -1000 - i; missing.push(n); }        // a name the sim lacks never matches a real event
  });
  return { table, source: live ? 'sim' : 'fallback', missing };
}

const built = build();
export const EV: Readonly<Record<EvName, number>> = built.table;
export const EV_SOURCE: 'sim' | 'fallback' = built.source;
/** contract event names the live sim table does not define (read-back; should be empty) */
export const EV_MISSING: readonly string[] = built.missing;

/** reverse lookup for debug read-backs */
export function evName(type: number): string {
  for (const n of EV_NAMES) if (EV[n] === type) return n;
  return `EV${type}`;
}
