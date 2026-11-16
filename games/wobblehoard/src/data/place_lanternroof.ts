// Lanternroof (lanternroof, idx 7): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.8 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('lanternroof') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions: the WIDE layout as PLACES 4.8 writes it (design intent; DT-01 not yet clean); the TALL layout is a FIRST DRAFT (the wide arrangement squeezed into the
// tall frame), NOT yet laid under P7: its slice (S2 / S3) re-lays both with DT-01 and reports every move (PG_DATA brief).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'lanternroof', idx: 7, name: 'Lanternroof', coined: ['Lanternroof'], stampsToOpen: 54, shipped: false, night: true,
  ground: { grip: 1.1, glue: 1, peel: 1, drag: 1, mark: 0, markLifeS: 0 },
  patches: [
    { id: 'chimneycorner', shape: 'disc', x: -2.3, z: 0.6, r: 0.9, mods: {  }, nap: true },
  ],
  zones: [
    { id: 'nightbreeze', kind: ZONE.wind, strength: 0.8, shape: 'box', x: 2.325, z: 0, hx: 1.075, hz: 2.4, gust: { everyS: [6, 10], forS: 2.5 } },
    { id: 'chimneywarmth', kind: ZONE.warm, strength: 0.8, shape: 'disc', x: -2.6, z: 0.6, r: 1 },
    { id: 'moondish', kind: ZONE.water, strength: 1, shape: 'disc', x: 0.9, z: 1.7, r: 0.6, surfaceY: 0.06 },
  ],
  things: [
    { id: 'lanternline', place: 'lanternroof', mech: MECH.chime, x: -1.6, z: -1.9, yaw: -0.197, size: [0.11, 0.14, 0.11], mu: 0.6, p: { n: 5, span: 2, hang: 0.55, limit: 25, damping: 0.8, box: 1, glowS: 3 }, ride: false, verb: V.RING, icon: E.bell, look: 'lantern', sound: S.rustle },
    { id: 'vanedisc', place: 'lanternroof', mech: MECH.turntable, x: 2.3, z: -0.7, yaw: 0, size: [0.6, 0.05, 0], mu: 0.9, p: { gustTorque: 1 }, ride: false, verb: V.SPIN, icon: E.swirl, look: 'vane', sound: S.whoosh },
    { id: 'hammock', place: 'lanternroof', mech: MECH.swing, x: 2.4, z: 1, yaw: 0, size: [0.1, 1, 0], mu: 0.9, p: { rope: 1.3, pivotY: 1.52, limit: 28, seatY: 0.22, damping: 0.25 }, ride: true, push: [0.49, 1], verb: V.SWING, icon: E.star, look: 'hammock', sound: S.creak },
    { id: 'chimneycorner', place: 'lanternroof', mech: MECH.block, x: -2.6, z: 0.6, yaw: 0, size: [0.3, 0.7, 0.3], mu: 0.8, p: {  }, ride: false, zone: 'chimneywarmth', patch: 'chimneycorner', verb: V.NAP, icon: E.flame, look: 'chimney', sound: 0 },
    { id: 'moondish', place: 'lanternroof', mech: MECH.pool, x: 0.9, z: 1.7, yaw: 0, size: [0.6, 0.06, 0], mu: 1, p: { sky: 1 }, ride: false, zone: 'moondish', verb: V.WADE, icon: E.moon, look: 'moondish', sound: S.splash },
    { id: 'starscope', place: 'lanternroof', mech: MECH.block, x: -0.9, z: 1.7, yaw: 0, size: [0.15, 0.2, 0.15], mu: 0.8, p: { cometS: 6 }, ride: false, switch: 'comet', verb: V.SWITCH, icon: E.star, look: 'scope', sound: S.whoosh },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [{ shape: 'box', x: 0, z: -2.55, hx: 3.7, hz: 0.15 }, { shape: 'box', x: -3.55, z: 0, hx: 0.15, hz: 2.7 }, { shape: 'box', x: 3.55, z: 0, hx: 0.15, hz: 2.7 }, { shape: 'box', x: 0, z: 2.55, hx: 3.7, hz: 0.15 }],
  pad: [0, 0, 1.2], spawn: [[-0.45, 0.7], [0.75, 0.3], [-1.2, -0.45], [0.4, -1], [-1.35, 1.25], [1.75, -0.05]],
  tall: { // FIRST DRAFT (S2 / S3 re-lay)
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3, round: 0.4 }, walls: [{ shape: 'box', x: 0, z: -3.9, hx: 2.6, hz: 0.15 }, { shape: 'box', x: -2.45, z: 0, hx: 0.15, hz: 3.9 }, { shape: 'box', x: 2.45, z: 0, hx: 0.15, hz: 3.9 }],
    spawn: [[-0.4, -0.6], [0.4, 0], [-0.4, 0.6], [0.4, 1.2], [-0.4, 1.8]],
    things: [
      { x: -0.592, z: -2.375, yaw: -0.197 },
      { x: 0.851, z: -0.875, yaw: 0 },
      { x: 0.888, z: 1.25, yaw: 0, push: [-1.022, 1.25] },
      { x: -0.962, z: 0.75, yaw: 0 },
      { x: 0.333, z: 2.125, yaw: 0 },
      { x: -0.333, z: 2.125, yaw: 0 },
    ],
    zones: [{ shape: 'box', x: 0.86, z: 0, hx: 1.075, hz: 3 }, { shape: 'disc', x: -0.962, z: 0.75, r: 1 }, { shape: 'disc', x: 0.333, z: 2.125, r: 0.6 }],
    patches: [{ shape: 'disc', x: -0.851, z: 0.75, r: 0.9 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'roof', sky: 'roof', weather: 'none', ambience: 'roof', music: 'roof', ceremonyDim: 0,
  signature: SIGNATURE.moongaze, finale: FINALE.lanternsong,
  reactions: /* @__PURE__ */ cells([
    100,0,3,3,1,100,1,1,3,3,100,1,3,3,1,100,2,1,3,3,100,3,3,3,2,100,4,1,3,2,100,6,0,1,5,100,7,0,1,5,100,8,3,3,1,100,9,3,3,1,100,10,3,3,3,100,11,2,6,8,
    0,0,1,5,7,0,1,1,5,7,0,3,1,5,7,0,4,2,6,2,0,6,1,3,2,0,7,1,4,130,0,8,1,5,7,0,9,1,5,7,0,10,1,5,7,0,11,2,6,8,1,0,0,1,3,1,1,0,1,3,
    1,2,0,1,3,1,3,0,1,3,1,4,0,1,3,1,5,0,1,3,1,6,0,1,3,1,7,0,1,3,1,8,0,1,3,1,9,0,1,3,1,10,0,1,3,1,11,2,6,8,2,0,1,1,3,2,1,0,1,3,
    2,2,0,1,3,2,3,0,1,3,2,4,0,1,3,2,5,0,1,3,2,6,0,1,3,2,7,0,1,3,2,8,0,1,3,2,9,0,1,3,2,10,0,1,3,2,11,2,6,8,3,0,3,7,6,3,1,1,4,560,
    3,2,0,2,106,3,3,0,2,92,3,4,1,5,1,3,5,0,2,97,3,6,0,2,95,3,7,0,2,82,3,8,3,7,5,3,9,3,7,5,3,10,1,4,130,3,11,2,6,8,4,0,3,7,6,4,2,3,7,13,
    4,4,1,4,130,4,5,3,7,13,4,6,3,7,13,4,7,3,7,13,4,8,3,7,13,4,9,3,7,13,4,10,3,7,13,4,11,3,7,13,
  ]),
};
export default PLACE;
