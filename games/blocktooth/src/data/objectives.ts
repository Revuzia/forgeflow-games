// BLOCKTOOTH v2 — map-objective data (FEATURES_V2 §1 / §5). THREE-free data. Lane L4 (MAP-SIM).
//
// Names come from the §1 register. Per-biome OVERLOAD respawn keeps the §5.3 shape (WHITE STACKS densest,
// LOCKWATER sparsest) at the §5.3 values + 15 s (GRID-EAST 35 → 50, WHITE STACKS 30 → 45, LOCKWATER 40 → 55):
// the §14 second knob. At the §5.3 values the gate bot shed 8–13 sites per run and each one's guaranteed
// power-up pushed tokens to 13–19 per run (§6.2 expects 5–10); at +10 s probe_map's WHITE STACKS token median
// sat exactly on its 12 ceiling; at +15 s the medians are 7–9 sites and 9–10 tokens (meta/objectives.ts table).
// Prop lists: `overloadPropsS1` are the
// static props a Size I OVERLOAD SITE may be bound to (tier 1 preferred ×2 by meta/objectives.ts: GRID-EAST
// parked bus / truck, WHITE STACKS container / truck, LOCKWATER container / truck; then tier-0 fallbacks);
// `reliefProps` anchor a RELIEF DEPOT's crate stack (§5.2). Static-prop census, seed 1337 (lane === -1):
// GRID-EAST bus 58 · truck 46 · vending 318 · kiosk 237 · lamp 1280 · bench 572; WHITE STACKS container 216 ·
// truck 144 · drum 1094 · forklift 172 · barrier 288; LOCKWATER container 631 · truck 42 · drum 898 ·
// forklift 195 (_harness/scratch/l4/census.ts).

import type { BiomeId, ObjectiveBiomeCfg, ObjectiveKind, PropKind } from '../core/types.ts';
import { OBJECTIVES } from '../core/config.ts';

export const OBJECTIVE_NAMES: Record<ObjectiveKind, string> = {
  overloadSite: 'OVERLOAD SITE',
  reliefDepot: 'RELIEF DEPOT',
  recordsAnnex: 'RECORDS ANNEX',
};

/** Done stamps (§5.4): burst on the marker when the objective pays out (views / HUD read it). */
export const OBJECTIVE_STAMP: Record<ObjectiveKind, string> = {
  overloadSite: 'LOAD SHED',
  reliefDepot: 'CRATES OPEN',
  recordsAnnex: 'FILES SEIZED',
};

export const OBJECTIVE_BIOME: Record<BiomeId, ObjectiveBiomeCfg> = {
  grideast: {
    overloadRespawnS: 50, reliefRespawnS: OBJECTIVES.relief.respawnS,
    overloadLabel: 'rooftop transformer', overloadLabelS1: 'utility truck',
    overloadPropsS1: ['bus', 'truck', 'vending', 'kiosk'],
    reliefLabel: 'municipal supply crates', annexLabel: 'the city keeps its paperwork here',
    reliefProps: ['kiosk', 'vending', 'bench'],
  },
  whitestacks: {
    overloadRespawnS: 45, reliefRespawnS: OBJECTIVES.relief.respawnS,
    overloadLabel: 'pump house', overloadLabelS1: 'generator container',
    overloadPropsS1: ['container', 'truck', 'forklift', 'drum'],
    reliefLabel: 'municipal supply crates', annexLabel: 'the city keeps its paperwork here',
    reliefProps: ['drum', 'container', 'barrier'],
  },
  lockwater: {
    overloadRespawnS: 55, reliefRespawnS: OBJECTIVES.relief.respawnS,
    overloadLabel: 'tide relay', overloadLabelS1: 'relay container',
    overloadPropsS1: ['container', 'truck', 'forklift', 'drum'],
    reliefLabel: 'municipal supply crates', annexLabel: 'the city keeps its paperwork here',
    reliefProps: ['container', 'drum', 'forklift'],
  },
};

/** Marker height anchor (m) of a prop-bound objective (Objective.h): approximate standing height of each
 *  prop kind (the view kit's proportions; only the marker/beacon uses it). */
export const PROP_HEIGHT_M: Readonly<Record<PropKind, number>> = {
  car: 1.5, taxi: 1.5, van: 2.2, bus: 3.2, truck: 3.4, kiosk: 2.6, hydrant: 0.8, lamp: 5.5, tree: 5,
  bench: 0.9, vending: 1.9, signpost: 3, barrier: 1.1, drum: 0.9, forklift: 2.2, container: 2.6,
  bollard: 0.9, boat: 1.6, pylon: 0.8, snowbank: 1.2,
};
