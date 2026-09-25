// BLOCKTOOTH v2 — per-titan UPROAR ultimates (FEATURES_V2 §3.3). THREE-free data (lane L1).
//
// Radii (r0, r1) are FRACTIONS of the blast radius R (meta/ultimate.ts ultRadius, latched at fire).
// dmg is a BASE number → titanDamage(w, dmg) × stat(w, 'ultPower'), one rollCrit per pulse.
// `t` = seconds after the ROAR ends (i.e. into the BLAST phase). `knock` is in titan heights per second
// (× H at the pulse, outward from the blast centre). `stun` in seconds.
// The per-titan extras (MOLO pull + heal/shield, VOLT-KITE live wires, HEARTHBACK shell boost + magma,
// BRIARWICK root-slow + bloom turrets + heal-over-time) are code in meta/ultimate.ts, switched on titan id.
//
// Every position inside R takes >= 190 base in total (FEATURES_V2 §3.3: a Size V STILT MORTAR has ~8 000 HP
// at 9 min and 190 × dmgMul 45 = 8 550), so every titan kills >= 90 % of the non-elite foes inside 0.9 R at
// every Size with the damage stat at 1 — asserted by _harness/probe_ult.ts.

import type { TitanId, UltDef } from '../core/types.ts';

export const ULTS: Record<TitanId, UltDef> = {
  // STREET SWALLOW — the street caves into a sinkhole mouth and MOLO gulps the block's crowd.
  // 0–0.9 s PULL (code: drag crushable foes toward the jaws at 0.4 R/s, 20 base/s at 5 Hz), then the SNAP.
  molo: {
    id: 'ult_street_swallow', name: 'STREET SWALLOW', burst: 'GLORRP!',
    desc: 'The street caves into a sinkhole mouth: every small foe on screen is dragged to the jaws, then SNAP — 200/190 bite. Heals 12 % and shields 10 %.',
    roarS: 0.55, blastS: 1.0,
    pulses: [
      { t: 0.9, r0: 0, r1: 0.55, dmg: 200, kind: 'bite', knock: 0.3 },
      { t: 0.9, r0: 0.55, r1: 1.0, dmg: 190, kind: 'bite', knock: 0.3 },
    ],
  },
  // GRIDLOCK SURGE — the static mane grounds into every streetlight at once; 6 radial LIVE WIRES.
  voltkite: {
    id: 'ult_gridlock_surge', name: 'GRIDLOCK SURGE', burst: 'KZZRAKK!',
    desc: 'Grounds the mane into every streetlight: 4 surges of 50 across the whole view (stun 0.3 s) and 6 LIVE WIRES radiating from you.',
    roarS: 0.4, blastS: 0.9,
    pulses: [
      { t: 0, r0: 0, r1: 1.0, dmg: 50, kind: 'arc', stun: 0.3 },
      { t: 0.25, r0: 0, r1: 1.0, dmg: 50, kind: 'arc', stun: 0.3 },
      { t: 0.5, r0: 0, r1: 1.0, dmg: 50, kind: 'arc', stun: 0.3 },
      { t: 0.75, r0: 0, r1: 1.0, dmg: 50, kind: 'arc', stun: 0.3 },
    ],
  },
  // CALDERA BLOWOUT — the dome shell erupts in three overlapping rings (× 1 + 0.6 × shell fill; shell kept).
  hearthback: {
    id: 'ult_caldera_blowout', name: 'CALDERA BLOWOUT', burst: 'FWOOMB!',
    desc: 'The dome erupts in three rings of 200/190/190 (up to +60 % with a full SHELL, which is kept) and leaves 6 magma pools.',
    roarS: 0.6, blastS: 0.8,
    pulses: [
      { t: 0, r0: 0, r1: 0.45, dmg: 200, kind: 'vent', knock: 0.6 },
      { t: 0.3, r0: 0.4, r1: 0.75, dmg: 190, kind: 'vent', knock: 0.6 },
      { t: 0.6, r0: 0.7, r1: 1.0, dmg: 190, kind: 'vent', knock: 0.6 },
    ],
  },
  // GREENBELT DECREE — a bramble wave rolls out 0 → R over 0.6 s and roots the block (stun 3 s, then slow).
  briarwick: {
    id: 'ult_greenbelt_decree', name: 'GREENBELT DECREE', burst: 'SKRRITCH!',
    desc: 'A bramble wave roots the whole view: 190 damage, rooted 3 s then slowed 3 s. Replants your bloom turrets and heals 20 % over 4 s.',
    roarS: 0.5, blastS: 0.6,
    pulses: [
      { t: 0.3, r0: 0, r1: 1.0, dmg: 190, kind: 'vine', stun: 3 },
    ],
  },
};
