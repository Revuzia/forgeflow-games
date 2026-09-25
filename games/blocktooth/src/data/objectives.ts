// BLOCKTOOTH v2 — map-objective data (FEATURES_V2 §5). THREE-free data.
//
// ── L0 SKELETON STUB ── labels and prop lists from §1 / §5.1 / §5.2; respawn delays = the OBJECTIVES
// defaults. Lane L4 owns and tunes this file (the stub meta/objectives.ts places nothing).

import type { BiomeId, ObjectiveBiomeCfg, ObjectiveKind } from '../core/types.ts';
import { OBJECTIVES } from '../core/config.ts';

export const OBJECTIVE_NAMES: Record<ObjectiveKind, string> = {
  overloadSite: 'OVERLOAD SITE',
  reliefDepot: 'RELIEF DEPOT',
  recordsAnnex: 'RECORDS ANNEX',
};

export const OBJECTIVE_BIOME: Record<BiomeId, ObjectiveBiomeCfg> = {
  grideast: {
    overloadRespawnS: OBJECTIVES.overload.respawnS, reliefRespawnS: OBJECTIVES.relief.respawnS,
    overloadLabel: 'rooftop transformer', overloadLabelS1: 'utility truck',
    overloadPropsS1: ['bus', 'truck', 'vending', 'kiosk', 'lamp'],
    reliefLabel: 'municipal supply crates', annexLabel: 'the city keeps its paperwork here',
    reliefProps: ['kiosk', 'vending', 'bench'],
  },
  whitestacks: {
    overloadRespawnS: OBJECTIVES.overload.respawnS, reliefRespawnS: OBJECTIVES.relief.respawnS,
    overloadLabel: 'pump house', overloadLabelS1: 'generator container',
    overloadPropsS1: ['container', 'truck', 'drum', 'forklift'],
    reliefLabel: 'municipal supply crates', annexLabel: 'the city keeps its paperwork here',
    reliefProps: ['drum', 'container', 'barrier'],
  },
  lockwater: {
    overloadRespawnS: OBJECTIVES.overload.respawnS, reliefRespawnS: OBJECTIVES.relief.respawnS,
    overloadLabel: 'tide relay', overloadLabelS1: 'relay container',
    overloadPropsS1: ['container', 'truck', 'drum', 'forklift'],
    reliefLabel: 'municipal supply crates', annexLabel: 'the city keeps its paperwork here',
    reliefProps: ['container', 'drum', 'forklift'],
  },
};
