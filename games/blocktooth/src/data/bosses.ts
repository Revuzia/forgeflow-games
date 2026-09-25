// BLOCKTOOTH — containment bosses (ai lane, CONTRACT §10, names per §1). THREE-free data.
// hp is the base; spawnBoss scales it by BOSS_HP_SCALE[titan.rank]. Attack ids are the ids
// the boss modules put in BossState.attack and in `bossAttack` events.

import type { BossDef, BossId } from '../core/types.ts';

export const BOSSES: Record<BossId, BossDef> = {
  caisson4: {
    id: 'caisson4',
    name: 'CAISSON-4',
    title: 'HALVARD HARBOUR CONTAINMENT RIG',
    meterName: 'STRAIN',
    hp: 190000,
    height: 75,
    attacks: [
      { id: 'hookLane', name: 'HOOK LANE', subtitle: 'HOOK LANE — STEP OUT OF THE PAINT', phase: 1 },
      { id: 'hookDrop', name: 'HOOK DROP', subtitle: 'HOOK DROP — STEP OFF THE SHADOW LINE', phase: 1 },
      { id: 'winchLeash', name: 'WINCH LEASH', subtitle: 'WINCH LEASH — DASH OUT WHEN IT LOCKS', phase: 2 },
      { id: 'boomSweep', name: 'BOOM SWEEP', subtitle: 'BOOM SWEEP — GET BEHIND THE CRANE', phase: 2 },
      { id: 'legStomp', name: 'LEG STOMP', subtitle: 'LEG STOMP — CLEAR THE RING', phase: 3 },
    ],
  },
  irongully: {
    id: 'irongully',
    name: 'IRON GULLY',
    title: 'THE PALE RIDGE OF THE STACKS',
    meterName: 'FRACTURE',
    hp: 215000,
    height: 70,
    attacks: [
      { id: 'coneBreath', name: 'CONE BREATH', subtitle: 'CONE BREATH — GET OUT OF ITS SIGHTLINE', phase: 1 },
      { id: 'pawSlam', name: 'PAW SLAM', subtitle: 'PAW SLAM — DASH THROUGH THE RING', phase: 1 },
      { id: 'plateVolley', name: 'SCRAP PLATES', subtitle: 'SCRAP PLATES — WATCH THE SHADOWS', phase: 2 },
      { id: 'ridgeCharge', name: 'RIDGE CHARGE', subtitle: 'RIDGE CHARGE — SIDESTEP THE LANE', phase: 2 },
      { id: 'breathSlam', name: 'WHITEOUT COMBO', subtitle: 'WHITEOUT — LEAVE THE SIGHTLINE, THEN DASH THE RING', phase: 3 },
    ],
  },
  // v2 (FEATURES_V2 §10.2) — GRID-EAST's boss: a walking multi-storey car park; weak point the TILL (ai/bosses/parkade6.ts)
  parkade6: {
    id: 'parkade6',
    name: 'PARKADE-6',
    title: 'HALVARD MOBILE PARKING STRUCTURE',
    meterName: 'JAM',
    hp: 180000,
    height: 64,
    attacks: [
      { id: 'rampLaunch', name: 'RAMP LAUNCH', subtitle: 'RAMP LAUNCH — WATCH FOR FALLING TRAFFIC', phase: 1 },
      { id: 'barrierSwing', name: 'BARRIER ARM', subtitle: 'BARRIER ARM — GET BEHIND THE BOOTH', phase: 1 },
      { id: 'towChain', name: 'TOW CHAIN', subtitle: 'TOW CHAIN — STEP OFF THE LINKS', phase: 2 },
      { id: 'deckDrop', name: 'DECK DROP', subtitle: 'DECK DROP — CLEAR THE FOOTPRINT', phase: 2 },
      { id: 'levelCollapse', name: 'LEVEL COLLAPSE', subtitle: 'LEVEL COLLAPSE — COUNT THE RINGS, DASH THE LAST', phase: 3 },
    ],
  },
};

/** Nameplate subtitle when no attack is active (the default mechanic hint, §10). */
export const BOSS_DEFAULT_SUBTITLE: Record<BossId, string> = {
  caisson4: 'BREAK THE LEGS — BUILD STRAIN',
  irongully: 'CRACK THE SAIL — BUILD FRACTURE',
  parkade6: 'HIT THE TILL WHEN THE DECK OPENS — BUILD JAM',
};

/** Subtitle for an attack id (falls back to the default hint). */
export function bossSubtitle(id: BossId, attack: string | null): string {
  if (attack) for (const a of BOSSES[id].attacks) if (a.id === attack) return a.subtitle;
  return BOSS_DEFAULT_SUBTITLE[id];
}
