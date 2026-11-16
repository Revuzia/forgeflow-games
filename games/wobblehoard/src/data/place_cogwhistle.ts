// Cogwhistle Bench (cogwhistle, idx 6): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.7 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('cogwhistle') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions (S3 re-lay, PG_DATA round 2; DT-01 0 problems in each layout): WIDE is PLACES 4.7 with no thing moved (the Tick Clock 0.16 m deep,
// not 0.15: P2's thinnest part) and new spawn spots; TALL is laid under P7 (report: _handoff/reports/PG_DATA.md, round 2).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'cogwhistle', idx: 6, name: 'Cogwhistle Bench', coined: ['Cogwhistle'], stampsToOpen: 45, shipped: false, night: true,
  ground: { grip: 1, glue: 1, peel: 1, drag: 1, mark: MARK.dust, markLifeS: 15 },
  patches: [
    { id: 'feltpad', shape: 'disc', x: 0, z: 0.2, r: 1.2, mods: { grip: 1.3 } },
  ],
  zones: [
    { id: 'magnetfield', kind: ZONE.magnet, strength: 0.8, shape: 'disc', x: 2.6, z: 0.6, r: 1.2, switchable: true },
    { id: 'lampwarm', kind: ZONE.warm, strength: 0.5, shape: 'disc', x: -1.6, z: -1.2, r: 1 },
  ],
  things: [
    { id: 'spinningcog', place: 'cogwhistle', mech: MECH.turntable, x: -2.3, z: -0.8, yaw: 0, size: [0.7, 0.05, 0], mu: 0.9, p: { motor: 0.25 }, ride: false, verb: V.SPIN, icon: E.swirl, look: 'cog', sound: S.tick },
    { id: 'windupkey', place: 'cogwhistle', mech: MECH.block, x: -2.4, z: -2, yaw: 0, size: [0.15, 0.15, 0.15], mu: 0.8, p: { forS: 30 }, ride: false, switch: 'motor', verb: V.SWITCH, icon: E.star, look: 'key', sound: S.tick },
    { id: 'springplate', place: 'cogwhistle', mech: MECH.pad, x: 2.2, z: -1.4, yaw: 0, size: [0.4, 0.05, 0], mu: 1, p: { gain: 1.1, apex: 0.25, travel: 0.1, maxBounces: 5 }, ride: false, verb: V.BOUNCE, icon: E.star, look: 'spring', sound: S.boing },
    { id: 'magnet', place: 'cogwhistle', mech: MECH.block, x: 2.6, z: 0.6, yaw: 0, size: [0.25, 0.2, 0.15], mu: 0.8, p: { pull: 0.8 }, ride: false, zone: 'magnetfield', switch: 'zone', verb: V.SWITCH, icon: E.question, look: 'magnet', sound: 0 },
    { id: 'steelmarble', place: 'cogwhistle', mech: MECH.ball, x: 0.6, z: 1.6, yaw: 0, size: [0.2, 0, 0], mu: 0.8, p: { mass: 0.25, rollDamp: 0.5, steel: 1 }, ride: false, verb: V.ROLL, icon: E.ball, look: 'steel', sound: S.ball },
    { id: 'tickclock', place: 'cogwhistle', mech: MECH.block, x: 0.9, z: -2.2, yaw: 0, size: [0.125, 0.35, 0.08], mu: 0.8, p: {  }, ride: false, switch: 'tune', verb: V.LISTEN, icon: E.note, look: 'clock', sound: S.tick },
    { id: 'littlebell', place: 'cogwhistle', mech: MECH.chime, x: -0.9, z: -2, yaw: 0, size: [0.1, 0.125, 0.1], mu: 0.6, p: { n: 1, hang: 0.5, limit: 25, damping: 0.8, box: 1 }, ride: false, notes: [74], verb: V.RING, icon: E.bell, look: 'bell', sound: S.bell },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [],
  pad: [0, 0, 1.2], spawn: [[1.575, -0.225], [-2.575, 1.575], [-0.825, -0.075], [1.925, 1.575], [-0.525, 1.575], [0.225, -1.375]],
  tall: { // laid under P7 (S3): the Spinning Cog back right with its Wind-up Key behind it, the Horseshoe Magnet back left (its field 1.2 m
    // clear of the pad), the Little Bell and the Tick Clock in the right strip, the Steel Marble front left, the Spring Plate front right
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3, round: 0.4 }, walls: [],
    spawn: [[-0.425, 0.375], [-0.325, 2.175], [-0.425, -1.325], [0.425, -0.475], [0.425, 1.225]],
    things: [
      { x: 0.9, z: -2.286, yaw: 0 },
      { x: 0.623, z: -3.5, yaw: 0 },
      { x: 0.858, z: 2.85, yaw: 0 },
      { x: -1.6, z: -2.186, yaw: 0 },
      { x: -1.066, z: 1.305, yaw: 0 },
      { x: 1.368, z: 0.354, yaw: 0 },
      { x: 1.62, z: -1.1, yaw: 0 },
    ],
    zones: [{ shape: 'disc', x: -1.6, z: -2.186, r: 1.2 }, { shape: 'disc', x: -0.6, z: -1.8, r: 1 }],
    patches: [{ shape: 'disc', x: 0, z: 0.25, r: 1.2 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'bench', sky: 'bench', weather: 'dust', ambience: 'bench', music: 'bench', ceremonyDim: 0,
  signature: SIGNATURE.cogride, finale: FINALE.machinetune,
  reactions: /* @__PURE__ */ cells([
    0,0,0,1,3,0,1,0,1,3,0,2,0,1,3,0,3,0,1,3,0,4,0,1,3,0,5,0,1,3,0,6,0,1,3,0,7,0,1,3,0,8,0,1,3,0,9,0,1,3,0,10,0,1,3,0,11,2,6,8,
    2,0,0,1,4,2,1,0,1,4,2,2,0,1,4,2,3,0,1,4,2,4,0,1,4,2,5,0,1,4,2,6,0,1,4,2,7,0,1,4,2,8,0,1,4,2,9,0,1,4,2,10,0,1,4,2,11,0,1,4,
    2,11,2,6,8,3,0,3,7,13,3,1,3,7,13,3,2,3,7,13,3,3,0,1,3,3,4,0,1,3,3,5,0,1,3,3,6,0,1,3,3,7,0,1,3,3,8,0,1,3,3,9,0,1,3,3,10,3,7,4,
    3,11,3,7,4,3,11,2,6,8,5,0,3,3,2,5,1,3,3,2,5,2,3,3,2,5,3,3,3,2,5,4,3,3,2,5,5,3,3,1,5,6,3,3,2,5,7,3,3,2,5,8,3,7,18,5,9,3,7,18,
    5,10,3,3,2,5,11,2,6,8,6,0,2,6,2,6,1,2,6,2,6,2,2,6,2,6,3,2,6,2,6,4,2,6,2,6,5,2,6,2,6,6,1,1,3,6,7,2,6,2,6,8,2,6,2,6,9,2,6,2,
    6,10,2,6,2,6,11,2,6,2,101,0,3,7,6,101,1,1,4,530,101,2,0,2,106,101,3,1,4,130,101,4,1,5,1,101,5,0,2,97,101,6,0,2,95,101,7,0,2,82,101,8,3,7,5,101,9,3,7,5,
    101,10,1,4,130,101,11,3,7,5,
  ]),
};
export default PLACE;
