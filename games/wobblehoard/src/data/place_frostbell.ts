// Frostbell Ridge (frostbell, idx 3): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.4 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('frostbell') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions (S2 re-lay, PG_DATA round 2; DT-01 0 problems in each layout): WIDE is PLACES 4.4 with three moves (the Glide Ramp 0.49 m in from
// the corner and turned to slide toward the camera onto the ice; the Icicle Bells 0.447 m; the Snowdrift Nest 0.424 m, inside the walls'
// rectangle) and new spawn spots; TALL is laid under P7 (report: _handoff/reports/PG_DATA.md, round 2).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'frostbell', idx: 3, name: 'Frostbell Ridge', coined: ['Frostbell'], stampsToOpen: 20, shipped: false, night: false,
  ground: { grip: 1, glue: 0.9, peel: 1, drag: 1.05, mark: MARK.print, markLifeS: 90 },
  patches: [
    { id: 'icepond', shape: 'disc', x: 1.9, z: -0.9, r: 1.4, mods: { drag: 0.25 }, ice: true },
  ],
  zones: [
    { id: 'mountaincold', kind: ZONE.cold, strength: 0.6, shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4 },
    { id: 'steampool', kind: ZONE.water, strength: 1, shape: 'disc', x: -2.3, z: -1.2, r: 1, surfaceY: 0.26, ramp: 0.4 },
    { id: 'steampool.warm', kind: ZONE.warm, strength: 1, shape: 'disc', x: -2.3, z: -1.2, r: 1 },
    { id: 'windgap', kind: ZONE.wind, strength: 0.6, shape: 'box', x: 0, z: -1.825, hx: 3.4, hz: 0.575, gust: { everyS: [9, 14], forS: 2 } },
  ],
  things: [
    { id: 'icepond', place: 'frostbell', mech: 0, x: 1.9, z: -0.9, yaw: 0, size: [1.4, 0, 0], mu: 1, p: {  }, ride: false, patch: 'icepond', verb: V.STEP, icon: E.star, look: 'ice', sound: 0 },
    { id: 'glideramp', place: 'frostbell', mech: MECH.ramp, x: 2.88, z: -1.41, yaw: 1.571, size: [1, 0.08, 0.45], mu: 0.1, p: { angle: 14, top: 0.5, rails: 1 }, ride: true, verb: V.SLIDE, icon: E.star, look: 'iceramp', sound: S.whoosh },
    { id: 'steampool', place: 'frostbell', mech: MECH.pool, x: -2.3, z: -1.2, yaw: 0, size: [1, 0.26, 0], mu: 1, p: {  }, ride: false, zone: 'steampool', verb: V.WADE, icon: E.droplet, look: 'steampool', sound: S.splash },
    { id: 'iciclebells', place: 'frostbell', mech: MECH.chime, x: -3.1, z: 0.3, yaw: 1.571, size: [0.08, 0.25, 0], mu: 0.5, p: { n: 4, span: 1, hang: 0.5, limit: 25, damping: 0.8, railR: 0.08 }, ride: false, notes: [69, 74, 76, 81], verb: V.RING, icon: E.bell, look: 'icicles', sound: S.bell },
    { id: 'snowdriftnest', place: 'frostbell', mech: MECH.ring, x: -1.6, z: 1.4, yaw: -0.73, size: [0.9, 0.1, 125], mu: 0.9, p: { segments: 5, way: 0.6 }, ride: false, useSpot: [-1.6, 1.4], verb: V.NAP, icon: E.zzz, look: 'snowdrift', sound: 0 },
    { id: 'snowball', place: 'frostbell', mech: MECH.ball, x: 0.6, z: 1.6, yaw: 0, size: [0.25, 0, 0], mu: 0.8, p: { mass: 0.35, rollDamp: 0.6, snowLook: 0.3 }, ride: false, verb: V.ROLL, icon: E.ball, look: 'snowball', sound: S.crunch },
    { id: 'shakepine', place: 'frostbell', mech: MECH.bar, x: -0.6, z: -2, yaw: 0, size: [0.12, 1.2, 0], mu: 0.8, p: { standing: 1, branchR: 0.08, branchL: 0.5, pivotY: 0.95, limit: 20, damping: 2, bumpSpeed: 0.3, puffR: 0.7, puffSnow: 0.5 }, ride: false, verb: V.SHAKE, icon: E.wow, look: 'pine', sound: S.rustle },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [],
  pad: [0, 0, 1.2], spawn: [[0.375, -0.175], [2.575, 1.575], [-1.575, -0.475], [0.625, -1.575], [1.625, 0.525], [-0.775, 0.675]],
  tall: { // laid under P7 (S2): the Ice Pond back right with the Glide Ramp sliding toward the camera onto it, the Steam Pool back left, the
    // Icicle Bells across the very back (just behind the water's edge), the Shake Pine in the right strip, the low Snowdrift Nest in the front
    // band with its gap toward the pad, the Snowball front left; the Wind Gap over the whole back band; spawn spots off the ice and the water
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.4, hz: 3, round: 0.4 }, walls: [],
    spawn: [[-0.425, -0.425], [0.425, 1.325], [0.425, 0.225], [-0.325, -1.475], [-0.425, 0.775]],
    things: [
      { x: 1.083, z: -2.394, yaw: 0 },
      { x: 1.082, z: -2.154, yaw: 1.571 },
      { x: -1.2, z: -2, yaw: 0 },
      { x: -1.4, z: -3.4, yaw: 0 },
      { x: 0.433, z: 2.391, yaw: -1.571, use: [0.433, 2.391] },
      { x: -1.22, z: 2.378, yaw: 0 },
      { x: 1.673, z: -0.725, yaw: 0 },
    ],
    zones: [{ shape: 'box', x: 0, z: 0, hx: 1.4, hz: 3 }, { shape: 'disc', x: -1.2, z: -2, r: 1 }, { shape: 'disc', x: -1.2, z: -2, r: 1 }, { shape: 'box', x: 0, z: -2.5, hx: 2.3, hz: 1.2 }],
    patches: [{ shape: 'disc', x: 1.083, z: -2.394, r: 1.4 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'ridge', sky: 'ridge', weather: 'snow', ambience: 'ridge', music: 'ridge', ceremonyDim: 0.3,
  signature: SIGNATURE.glide, finale: FINALE.stars,
  reactions: /* @__PURE__ */ cells([
    100,0,1,4,50,100,0,0,2,96,100,0,3,7,6,100,1,1,4,50,100,2,1,4,50,100,2,3,7,21,100,3,1,4,50,100,3,3,3,4,100,4,1,4,50,100,4,2,6,1,100,5,1,4,50,100,5,3,7,21,
    100,6,1,4,50,100,7,1,4,50,100,7,3,7,21,100,8,3,7,21,100,9,3,7,21,100,10,3,3,4,100,11,2,6,9,0,0,0,1,2,0,1,0,1,2,0,2,0,1,2,0,3,0,1,2,0,4,0,1,2,
    0,5,0,1,2,0,6,0,1,2,0,7,0,1,2,0,8,0,1,2,0,8,2,6,13,0,9,0,1,2,0,10,0,1,2,0,11,0,1,2,0,11,2,6,8,2,0,0,1,1,2,1,0,1,1,2,1,1,4,1,
    2,2,0,2,106,2,3,1,4,130,2,4,1,5,1,2,5,0,1,1,2,6,1,4,130,2,7,0,1,1,2,8,2,6,3,2,9,0,1,1,2,10,1,4,130,2,11,2,6,8,6,0,1,4,450,6,0,3,7,2,
    6,1,1,4,450,6,2,1,4,450,6,3,1,4,450,6,3,3,3,3,6,4,1,4,450,6,5,0,1,3,6,6,1,4,450,6,7,1,4,450,6,8,1,4,450,6,9,1,4,450,6,10,1,4,450,6,11,2,6,8,
    5,0,3,7,4,5,1,0,1,3,5,2,0,1,3,5,3,0,1,3,5,4,0,1,3,5,5,0,1,3,5,6,0,1,3,5,7,0,1,3,5,8,0,1,3,5,9,0,1,3,5,10,0,7,4,5,11,0,1,3,
    3,0,2,6,2,3,1,2,6,2,3,2,2,6,2,3,3,2,6,2,3,4,2,6,2,3,5,2,6,2,3,6,1,1,3,3,7,2,6,2,3,8,2,6,2,3,9,2,6,2,3,10,2,6,2,3,11,2,6,2,
    4,0,3,7,6,4,1,0,1,3,4,2,0,1,3,4,3,0,1,3,4,4,1,7,6,4,5,0,1,3,4,6,1,5,6,4,7,0,1,3,4,8,3,7,6,4,9,0,1,3,4,10,0,1,3,4,11,2,6,8,
  ]),
};
export default PLACE;
