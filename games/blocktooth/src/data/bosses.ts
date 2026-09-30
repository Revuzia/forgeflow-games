// BLOCKTOOTH — containment bosses (ai lane, CONTRACT §10, names per §1). THREE-free data.
// hp is the base; spawnBoss scales it by BOSS_HP_SCALE[titan.rank]. Attack ids are the ids
// the boss modules put in BossState.attack and in `bossAttack` events.
// GATEKEEPERS (§7.2): every def carries role / slot / kicker. The city bosses are role 'main', slot 4,
// kicker ''. The three gatekeeper defs (§1, §3.1–§3.3, lane K1b) list their real attacks (the ids the modules
// put in BossState.attack and in `bossAttack` events). Gatekeeper HP comes from meta/gates.ts gateHpFor, not
// from `hp` (kept at GATE_HP_AT_RANK of the home Size for reference). Module BEATS (REFILL, OVERHEATED, …) set
// BossState.attack WITHOUT a `bossAttack` event; their subtitles are BOSS_BEAT_SUBTITLE below.

import type { BossDef, BossId } from '../core/types.ts';

export const BOSSES: Record<BossId, BossDef> = {
  caisson4: {
    id: 'caisson4',
    name: 'CAISSON-4',
    title: 'HALVARD HARBOUR CONTAINMENT RIG',
    meterName: 'STRAIN',
    role: 'main', slot: 4, kicker: '',
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
  // WHITE STACKS' boss: HALVARD's road gritter + V-plough on four hydraulic stamp legs (a machine — owner rule
  // 2026-09-29); weak point the spreader SPINNER on the plate magazine (sim: ai/bosses/irongully.ts, part 'sail')
  irongully: {
    id: 'irongully',
    name: 'IRON GULLY',
    title: 'HALVARD SNOW-CLEARANCE WALKER',
    meterName: 'FRACTURE',
    role: 'main', slot: 4, kicker: '',
    hp: 215000,
    height: 70,
    attacks: [
      { id: 'coneBreath', name: 'AUGER BLAST', subtitle: 'AUGER BLAST — GET OUT OF ITS SIGHTLINE', phase: 1 },
      { id: 'pawSlam', name: 'DOUBLE STAMP', subtitle: 'DOUBLE STAMP — DASH THROUGH THE RING', phase: 1 },
      { id: 'plateVolley', name: 'PLATE SPREADER', subtitle: 'PLATE SPREADER — WATCH THE SHADOWS', phase: 2 },
      { id: 'ridgeCharge', name: 'PLOUGH RUN', subtitle: 'PLOUGH RUN — SIDESTEP THE LANE', phase: 2 },
      { id: 'breathSlam', name: 'WHITEOUT', subtitle: 'WHITEOUT — LEAVE THE SIGHTLINE, THEN DASH THE RING', phase: 3 },
    ],
  },
  // v2 (FEATURES_V2 §10.2) — GRID-EAST's boss: a walking multi-storey car park; weak point the TILL (ai/bosses/parkade6.ts)
  parkade6: {
    id: 'parkade6',
    name: 'PARKADE-6',
    title: 'HALVARD MOBILE PARKING STRUCTURE',
    meterName: 'JAM',
    role: 'main', slot: 4, kicker: '',
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
  // ── GATEKEEPERS (§1, §3.1–§3.3; lane K1b) ──
  stencil1: {
    id: 'stencil1',
    name: 'STENCIL-1',
    title: 'HALVARD ROAD-MARKING UNIT',
    meterName: 'SPILL',
    role: 'gate', slot: 1, kicker: 'GATEKEEPER · SIZE I HEIGHT LIMIT',
    hp: 1000,
    height: 7.2,
    attacks: [
      { id: 'stripeRun', name: 'STRIPE RUN', subtitle: 'STRIPE RUN — STEP OFF THE LINE', phase: 1 },
      { id: 'paintBuckets', name: 'PAINT BUCKETS', subtitle: 'PAINT BUCKETS — WATCH THE SPLASH', phase: 1 },
      { id: 'doubleLine', name: 'DOUBLE LINE', subtitle: 'DOUBLE LINE — STAY BETWEEN THE LINES', phase: 2 },
      { id: 'uTurn', name: 'U-TURN', subtitle: "U-TURN — IT'S COMING BACK", phase: 3 },
    ],
  },
  cordon2: {
    id: 'cordon2',
    name: 'CORDON-2',
    title: 'HALVARD CROWD-BARRIER UNIT',
    meterName: 'STALL',
    role: 'gate', slot: 2, kicker: 'GATEKEEPER · SIZE II HEIGHT LIMIT',
    hp: 4500,
    height: 21.5,
    attacks: [
      { id: 'shieldShove', name: 'SHIELD SHOVE', subtitle: 'SHIELD SHOVE — GET OUT OF ITS WAY', phase: 1 },
      { id: 'sawhorseToss', name: 'SAWHORSE TOSS', subtitle: 'SAWHORSE TOSS — MIND THE BARRICADES', phase: 1 },
      { id: 'backfire', name: 'BACKFIRE', subtitle: 'BACKFIRE — STEP OFF THE EXHAUST', phase: 2 },
      { id: 'squadBehind', name: 'SQUAD BEHIND THE LINE', subtitle: 'SQUAD BEHIND THE LINE', phase: 3 },
    ],
  },
  switchboard5: {
    id: 'switchboard5',
    name: 'SWITCHBOARD-5',
    title: 'HALVARD MOBILE SWITCHBOARD',
    meterName: 'FEEDBACK',
    role: 'gate', slot: 3, kicker: 'GATEKEEPER · SIZE III HEIGHT LIMIT',
    hp: 20000,
    height: 69,
    attacks: [
      { id: 'callIn', name: 'CALL-IN', subtitle: 'CALL-IN — CLEAR THE MARKED SPOTS', phase: 1 },
      { id: 'putThrough', name: 'PUT THROUGH', subtitle: 'PUTTING YOU THROUGH TO A CREW', phase: 1 },
      { id: 'relocate', name: 'RELOCATE', subtitle: 'RELOCATING — CATCH IT', phase: 1 },
      { id: 'holdMusic', name: 'HOLD MUSIC', subtitle: 'HOLD MUSIC — CLEAR THE RING', phase: 2 },
    ],
  },
};

/** Nameplate subtitle when no attack is active (the default mechanic hint, §10). */
export const BOSS_DEFAULT_SUBTITLE: Record<BossId, string> = {
  caisson4: 'BREAK THE LEGS — BUILD STRAIN',
  irongully: 'CRACK THE SPINNER — BUILD FRACTURE',
  parkade6: 'HIT THE TILL WHEN THE DECK OPENS — BUILD JAM',
  // GATEKEEPERS (§3.1–§3.3)
  stencil1: 'WAIT FOR THE REFILL — HIT THE DRUM',
  cordon2: 'GET BEHIND THE WALL — HIT THE PACK',
  switchboard5: 'HIT THE DISHES AS THEY COME ROUND — BUILD FEEDBACK',
};

/**
 * GATEKEEPERS: subtitles of the module BEATS (BossState.attack ids a gatekeeper sets without a `bossAttack`
 * event, §2.4 / §3.0–§3.3). Shared by all three gatekeepers; a beat id is never a real attack id.
 */
export const BOSS_BEAT_SUBTITLE: Readonly<Record<string, string>> = {
  refill: 'REFILLING — HIT THE DRUM',                  // STENCIL-1 after a STRIPE RUN / U-TURN
  // the staggers (fx2 lane B: the default "wait for the window" hint stayed up while the window was wide open)
  tippedOver: 'TIPPED OVER — HIT THE DRUM NOW',         // STENCIL-1 SPILL full (the drum forced open)
  stalled: 'STALLED — HIT THE PACK NOW',                // CORDON-2 STALL full (the tracks stop)
  linesDown: 'LINES DOWN — HIT THE DISHES NOW',         // SWITCHBOARD-5 FEEDBACK full (the dishes droop, still out)
  overheated: 'OVERHEATED — GET BEHIND IT',            // CORDON-2 after a SHIELD SHOVE
  packUp: 'PACKING UP',                                // SWITCHBOARD-5 folds before it drives (hunt)
  planting: 'PLANTING',                                // SWITCHBOARD-5 outriggers down
  caught: 'CAUGHT — HIT THE DISHES',                   // SWITCHBOARD-5 stopped mid-RELOCATE
  reconfiguring: 'RECONFIGURING',                      // 1.2 s after a phase change
  ramming: 'RAMMING THROUGH',                          // the stuck rule (§3.0)
  cutOff: 'CUTTING YOU OFF',                           // the §2.4 cut-off re-entry
};

/** Subtitle for an attack id or a gatekeeper beat id (falls back to the default hint). */
export function bossSubtitle(id: BossId, attack: string | null): string {
  if (attack) {
    for (const a of BOSSES[id].attacks) if (a.id === attack) return a.subtitle;
    const beat = BOSS_BEAT_SUBTITLE[attack];
    if (beat !== undefined && BOSSES[id].role === 'gate') return beat;
  }
  return BOSS_DEFAULT_SUBTITLE[id];
}
