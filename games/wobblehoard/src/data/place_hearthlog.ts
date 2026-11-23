// Hearthlog Cabin (hearthlog, idx 1): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.2 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('hearthlog') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions: PLACES 4.2 as written (revision 4), except round 5's re-lay for the camera that ships (FIX5_DATA B8, VERDICT_PG B8; DT-01's new
// 'in the shipped place camera' rows): TALL the Kettle (-1.98, -3.44) -> (-0.1, -3.5) (cut by the phone's left edge), the Snug Basket
// (1.05, -1.85) yaw 1.571 -> (0.8, -1.85) yaw 2.356 (cut by the right edge), the Yarn Ball (1.25, 2.15) -> (1.1, 2.1) (cut by the right edge);
// WIDE the Rocker Board (1.55, 2.05) -> (1.6, 1.8) (under the desktop's party row). The TALL Rocker Board stays at (0.03, 3) under the phone's
// hint pill: see FIX5_DATA.md B8 (no spot above the hint line keeps the layout's five spawn spots).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'hearthlog', idx: 1, name: 'Hearthlog Cabin', coined: ['Hearthlog'], stampsToOpen: 'firstWish', shipped: true, night: false,
  ground: { grip: 0.9, glue: 1, peel: 1, drag: 1, mark: 0, markLifeS: 0 },
  patches: [
    { id: 'rug', shape: 'disc', x: 1.3, z: 1.3, r: 2, mods: { grip: 1.25, glue: 1.1 }, nap: true },
  ],
  zones: [
    { id: 'firesidewarmth', kind: ZONE.warm, strength: 1, shape: 'disc', x: -3.9, z: -3.1, r: 2.6, falloff: [1.2, 0.4] },
    { id: 'windowchill', kind: ZONE.cold, strength: 0.3, shape: 'box', x: 3.4, z: -3.2, hx: 1.3, hz: 0.7 },
  ],
  things: [
    { id: 'hearth', place: 'hearthlog', mech: MECH.block, x: -3.9, z: -3.65, yaw: 0, size: [0.7, 0.45, 0.25], mu: 0.8, p: { puffS: 5, fireX: 0, fireZ: 0.55 }, ride: false, zone: 'firesidewarmth', switch: 'fire', verb: V.SWITCH, icon: E.flame, look: 'fireplace', sound: S.crackle },
    { id: 'rockerboard', place: 'hearthlog', mech: MECH.seesaw, x: 2.8, z: 2.6, yaw: 0, size: [1.1, 0.08, 0.3], mu: 0.9, p: { pivot: 0.24, limit: 8, inertia: 0.7, damping: 0.9, rider: 0.75 }, ride: true, verb: V.ROCK, icon: E.swirl, look: 'rocker', sound: S.creak },
    { id: 'yarnball', place: 'hearthlog', mech: MECH.ball, x: -2.4, z: 2.8, yaw: 0, size: [0.24, 0, 0], mu: 0.8, p: { mass: 0.2, rollDamp: 0.5 }, ride: false, verb: V.ROLL, icon: E.ball, look: 'yarn', sound: S.ball },
    { id: 'pillowswing', place: 'hearthlog', mech: MECH.swing, x: 0, z: -2.6, yaw: 0, size: [0.09, 0.7, 0], mu: 0.9, p: { rope: 1.4, pivotY: 1.62, limit: 30, seatY: 0.22, damping: 0.6 }, ride: true, push: [2, -2.6], verb: V.SWING, icon: E.star, look: 'pillow', sound: S.creak },
    { id: 'snugbasket', place: 'hearthlog', mech: MECH.ring, x: -4.2, z: -1.1, yaw: 0, size: [0.89, 0.09, 120], mu: 0.9, p: { segments: 6, way: 0.6 }, ride: false, useSpot: [-4.2, -1.1], verb: V.NAP, icon: E.zzz, look: 'basket', sound: 0 },
    { id: 'kettle', place: 'hearthlog', mech: MECH.block, x: 5.1, z: -3.5, yaw: 0, size: [0.25, 0.25, 0.2], mu: 0.8, p: { kettleR: 0.22, everyMin: 45, everyMax: 90, barS: 3.6, apartS: 60, steamWet: 0.2, steamR: 1.2, steamS: 4 }, ride: false, switch: 'tune', verb: V.LISTEN, icon: E.note, look: 'kettle', sound: S.kettle },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 5.5, hz: 3.9, round: 1.3 }, walls: [{ shape: 'box', x: 0, z: -4.05, hx: 5.8, hz: 0.15 }, { shape: 'box', x: -5.65, z: 0, hx: 0.15, hz: 4.2 }, { shape: 'box', x: 5.65, z: 0, hx: 0.15, hz: 4.2 }],
  pad: [0, 0, 1.2], spawn: [[-0.65, -0.5], [0.75, -0.25], [2.1, 0.5], [-0.2, 0.9], [1.9, -0.9], [-2, 1]],
  tall: {
    bounds: { shape: 'box', x: 0, z: 0, hx: 2.3, hz: 4.9, round: 0.65 }, walls: [{ shape: 'box', x: 0, z: -5.05, hx: 2.6, hz: 0.15 }, { shape: 'box', x: -2.45, z: 0, hx: 0.15, hz: 5.2 }, { shape: 'box', x: 2.45, z: 0, hx: 0.15, hz: 5.2 }],
    spawn: [[-0.4, -0.5], [0.5, 0.2], [-0.5, 0.8], [0.5, 1.4], [-0.6, 2]],
    things: [
      { x: 1.4, z: -4.65, yaw: 0},
      { x: 0, z: 4, yaw: 0},
      { x: 1.6, z: 3, yaw: 0},
      { x: -1.3, z: -2.2, yaw: 1.571, push: [-1.3, -0.2] },
      { x: 1.2, z: -1.6, yaw: 2.356, use: [1.2, -1.6] },
      { x: -1.9, z: -4.5, yaw: 0},
    ],
    zones: [{ shape: 'disc', x: 1.4, z: -4.1, r: 2.2 }, { shape: 'box', x: -0.6, z: -4, hx: 0.6, hz: 0.6 }],
    patches: [{ shape: 'disc', x: -0.3, z: 1.5, r: 1.5 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'cabin', sky: 'cabin', weather: 'embers', ambience: 'cabin', music: 'cabin', ceremonyDim: 0,
  signature: SIGNATURE.toast, finale: FINALE.firesong,
  reactions: /* @__PURE__ */ cells([
    100,0,0,2,96,100,0,3,7,6,100,1,1,4,560,100,1,3,7,5,100,2,0,2,106,100,3,0,2,92,100,4,1,5,1,100,4,3,3,2,100,5,0,2,97,100,6,0,2,95,100,7,0,2,82,100,8,3,3,5,
    100,9,3,3,5,100,10,0,2,92,100,10,1,4,130,100,11,2,6,8,1,0,0,1,3,1,1,0,1,3,1,2,0,1,3,1,3,0,1,3,1,4,0,1,3,1,5,0,1,3,1,6,0,1,3,1,7,0,1,3,
    1,8,0,1,3,1,9,0,1,3,1,10,0,1,3,1,11,2,6,8,2,0,3,7,4,2,1,0,1,3,2,2,0,1,3,2,3,0,1,3,2,4,0,1,3,2,5,0,1,3,2,6,0,1,3,2,7,0,1,3,
    2,8,0,1,3,2,9,0,1,3,2,10,3,7,4,2,11,2,6,8,3,0,0,1,3,3,1,0,2,104,3,2,0,1,3,3,3,0,1,3,3,4,0,1,3,3,5,0,1,3,3,6,0,1,3,3,7,0,1,3,
    3,8,0,1,3,3,9,0,1,3,3,10,0,1,3,3,11,2,6,8,4,0,3,7,6,4,1,0,1,3,4,2,0,1,3,4,3,0,1,3,4,4,0,1,3,4,4,3,7,6,4,5,0,1,3,4,6,1,5,6,
    4,7,0,1,3,4,8,3,7,6,4,9,0,1,3,4,10,0,1,3,4,11,2,6,8,5,0,1,4,120,5,1,1,4,120,5,2,2,6,1,5,3,2,6,1,5,4,2,6,1,5,5,2,6,1,5,6,2,6,1,
    5,7,2,6,1,5,8,2,6,1,5,9,2,6,1,5,10,2,6,1,5,11,2,6,1,101,0,0,2,96,101,0,3,7,6,101,1,1,4,50,101,1,0,2,104,101,2,3,7,21,101,3,3,3,4,101,4,3,3,4,
    101,4,1,4,50,101,5,3,7,21,101,6,3,3,4,101,7,3,7,21,101,8,3,7,21,101,9,3,7,21,101,10,3,3,4,101,11,2,6,8,
  ]),
};
export default PLACE;
