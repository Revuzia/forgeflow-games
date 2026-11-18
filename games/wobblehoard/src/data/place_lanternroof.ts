// Lanternroof (lanternroof, idx 7): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.8 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('lanternroof') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions (S3 re-lay, PG_DATA round 2; DT-01 0 problems in each layout): WIDE is PLACES 4.8 with two moves (the Lantern Line 0.05 m forward,
// off the back parapet; the Clothesline Hammock 0.24 m left, its rider clear of the side parapet; its seat 0.9 m long, M8's top, not 1.0) and
// new spawn spots; TALL is laid under P7 (report: _handoff/reports/PG_DATA.md, round 2). Round 6 (R6_DATA item 2): WIDE moves the Moon Dish
// 0.2 m right and 0.25 m back (it reached under the shipped camera's party row); TALL below.
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'lanternroof', idx: 7, name: 'Lanternroof', coined: ['Lanternroof'], stampsToOpen: 36, shipped: false, night: true,
  ground: { grip: 1.1, glue: 1, peel: 1, drag: 1, mark: 0, markLifeS: 0 },
  patches: [
    { id: 'chimneycorner', shape: 'disc', x: -2.3, z: 0.6, r: 0.9, mods: {  }, nap: true },
  ],
  zones: [
    { id: 'nightbreeze', kind: ZONE.wind, strength: 0.8, shape: 'box', x: 2.325, z: 0, hx: 1.075, hz: 2.4, gust: { everyS: [6, 10], forS: 2.5 } },
    { id: 'chimneywarmth', kind: ZONE.warm, strength: 0.8, shape: 'disc', x: -2.6, z: 0.6, r: 1 },
    { id: 'moondish', kind: ZONE.water, strength: 1, shape: 'disc', x: 1.1, z: 1.45, r: 0.6, surfaceY: 0.06 },
  ],
  things: [
    { id: 'lanternline', place: 'lanternroof', mech: MECH.chime, x: -1.6, z: -1.85, yaw: -0.197, size: [0.11, 0.14, 0.11], mu: 0.6, p: { n: 5, span: 2, hang: 0.55, limit: 25, damping: 0.8, box: 1, glowS: 3 }, ride: false, verb: V.RING, icon: E.bell, look: 'lantern', sound: S.rustle },
    { id: 'vanedisc', place: 'lanternroof', mech: MECH.turntable, x: 2.3, z: -0.7, yaw: 0, size: [0.6, 0.05, 0], mu: 0.9, p: { gustTorque: 1 }, ride: false, verb: V.SPIN, icon: E.swirl, look: 'vane', sound: S.whoosh },
    { id: 'hammock', place: 'lanternroof', mech: MECH.swing, x: 2.16, z: 1, yaw: 0, size: [0.1, 0.9, 0], mu: 0.9, p: { rope: 1.3, pivotY: 1.52, limit: 28, seatY: 0.22, damping: 0.25 }, ride: true, push: [0.25, 1], verb: V.SWING, icon: E.star, look: 'hammock', sound: S.creak },
    { id: 'chimneycorner', place: 'lanternroof', mech: MECH.block, x: -2.6, z: 0.6, yaw: 0, size: [0.3, 0.7, 0.3], mu: 0.8, p: {  }, ride: false, zone: 'chimneywarmth', patch: 'chimneycorner', verb: V.NAP, icon: E.flame, look: 'chimney', sound: 0 },
    { id: 'moondish', place: 'lanternroof', mech: MECH.pool, x: 1.1, z: 1.45, yaw: 0, size: [0.6, 0.06, 0], mu: 1, p: { sky: 1 }, ride: false, zone: 'moondish', verb: V.WADE, icon: E.moon, look: 'moondish', sound: S.splash },
    { id: 'starscope', place: 'lanternroof', mech: MECH.block, x: -0.9, z: 1.7, yaw: 0, size: [0.15, 0.2, 0.15], mu: 0.8, p: { cometS: 6 }, ride: false, switch: 'comet', verb: V.SWITCH, icon: E.star, look: 'scope', sound: S.whoosh },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [{ shape: 'box', x: 0, z: -2.55, hx: 3.7, hz: 0.15 }, { shape: 'box', x: -3.55, z: 0, hx: 0.15, hz: 2.7 }, { shape: 'box', x: 3.55, z: 0, hx: 0.15, hz: 2.7 }, { shape: 'box', x: 0, z: 2.55, hx: 3.7, hz: 0.15 }],
  pad: [0, 0, 1.2], spawn: [[0.575, 0.225], [-1.775, -0.525], [1.025, -1.575], [-0.875, 0.625], [0.175, 1.575], [-0.375, -0.775]],
  tall: { // laid under P7 (S3): the parapet's back at the tall frame's edge (inner face z -3.7) and a low one just past the bounds' front (z
    // 3.1), the Lantern Line across the very back, the Clothesline Hammock swinging along z at the left of the back band (pushed from its front
    // end), the Moon Dish beside it, the Vane Disc back right, the Chimney Corner in the right strip with its nap spot toward the room, the Star
    // Scope (0.4 m) in the front band; the Night Breeze over the back band (the lanterns, the vane and the hammock in it; 1.25 m from the pad).
    // Round 6 (R6_DATA item 2, the shipped place camera): the Chimney Corner 0.39 m back and 0.11 m in (it was cut by the phone's right edge),
    // the Star Scope 0.4 m in from the front (its floor under every fit's pill line), new spawn spots; DT-01 0 in the frame and the shipped
    // camera, and still 0 with the framed front moved -0.1..+0.2 m (the fit's near-tie, report)
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.4, hz: 3, round: 0.4 }, walls: [{ shape: 'box', x: 0, z: -3.85, hx: 2.6, hz: 0.15 }, { shape: 'box', x: -2.45, z: 0, hx: 0.15, hz: 3.9 }, { shape: 'box', x: 2.45, z: 0, hx: 0.15, hz: 3.9 }, { shape: 'box', x: 0, z: 3.25, hx: 2.6, hz: 0.15 }],
    spawn: [[0.169, -1.075], [-0.362, -0.175], [0.488, 0.375], [-0.575, 0.825], [0.275, 1.375]],
    things: [
      { x: -0.8, z: -3.35, yaw: 0 },
      { x: 1, z: -2.341, yaw: 0 },
      { x: -1.245, z: -1.708, yaw: 1.571, push: [-1.245, 0.202] },
      { x: 1.42, z: -0.9, yaw: 0 },
      { x: -0.868, z: -2.2, yaw: 0 },
      { x: -0.5, z: 2.5, yaw: 0 },
    ],
    zones: [{ shape: 'box', x: 0, z: -2.475, hx: 2.3, hz: 1.225 }, { shape: 'disc', x: 1.42, z: -0.9, r: 1 }, { shape: 'disc', x: -0.868, z: -2.2, r: 0.6 }],
    patches: [{ shape: 'disc', x: 1.12, z: -0.9, r: 0.9 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'roof', sky: 'roof', weather: 'none', ambience: 'roof', music: 'roof', ceremonyDim: 0,
  signature: SIGNATURE.moongaze, finale: FINALE.lanternsong,
  reactions: /* @__PURE__ */ cells([
    100,0,3,3,1,100,1,1,3,3,100,1,3,3,1,100,2,1,3,3,100,3,3,3,2,100,4,1,3,2,100,5,1,1,5,100,6,0,1,2,100,7,0,1,2,100,8,3,3,1,100,9,3,3,1,100,10,3,3,3,
    100,11,2,6,8,0,0,1,5,7,0,1,1,5,7,0,2,1,1,3,0,3,1,5,7,0,4,2,6,2,0,5,1,1,3,0,6,1,1,3,0,7,1,1,3,0,8,1,5,7,0,9,1,5,7,0,10,1,5,7,
    0,11,2,6,8,1,0,0,1,3,1,1,0,1,3,1,2,0,1,3,1,3,0,1,3,1,4,0,1,3,1,5,0,1,3,1,6,0,1,3,1,7,0,1,3,1,8,0,1,3,1,9,0,1,3,1,10,0,1,3,
    1,11,2,6,8,2,0,1,1,3,2,1,0,1,3,2,2,0,1,3,2,3,0,1,3,2,4,0,1,3,2,5,0,1,3,2,6,0,1,3,2,7,0,1,3,2,8,0,1,3,2,9,0,1,3,2,10,0,1,3,
    2,11,2,6,8,3,0,3,7,6,3,1,1,4,530,3,2,0,2,106,3,3,0,2,92,3,4,1,5,1,3,5,0,2,97,3,6,0,2,95,3,7,0,2,82,3,8,3,7,5,3,9,3,7,5,3,10,1,4,130,
    3,11,2,6,8,4,0,3,7,13,4,0,3,7,6,4,1,1,7,13,4,2,3,7,13,4,3,1,4,130,4,4,1,4,130,4,5,3,7,13,4,6,3,7,13,4,7,3,7,13,4,8,3,7,13,4,9,3,7,13,
    4,10,3,7,13,4,11,3,7,13,
  ]),
};
export default PLACE;
