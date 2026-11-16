// Echo Hollow (echohollow, idx 8): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.9 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('echohollow') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions: the WIDE layout as PLACES 4.9 writes it (design intent; DT-01 not yet clean); the TALL layout is a FIRST DRAFT (the wide arrangement squeezed into the
// tall frame), NOT yet laid under P7: its slice (S2 / S3) re-lays both with DT-01 and reports every move (PG_DATA brief).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'echohollow', idx: 8, name: 'Echo Hollow', stampsToOpen: 63, shipped: false, night: false,
  ground: { grip: 0.8, glue: 1, peel: 1, drag: 0.95, mark: MARK.trail, markLifeS: 25 },
  patches: [
    { id: 'mossbed', shape: 'disc', x: -2.2, z: 1, r: 1, mods: { grip: 1.2 }, nap: true, mark: MARK.glow, markLifeS: 10 },
  ],
  zones: [
    { id: 'echo', kind: ZONE.echo, strength: 1, shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4 },
    { id: 'cavecool', kind: ZONE.cold, strength: 0.3, shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4 },
    { id: 'glowpool', kind: ZONE.water, strength: 1, shape: 'disc', x: 2.2, z: -1, r: 1.1, surfaceY: 0.26, ramp: 0.4, glow: true },
    { id: 'drips.0', kind: ZONE.wet, strength: 1, shape: 'disc', x: -0.5, z: -1.75, r: 0.4 },
    { id: 'drips.1', kind: ZONE.wet, strength: 1, shape: 'disc', x: 1.3, z: 1.35, r: 0.4 },
    { id: 'drips.2', kind: ZONE.wet, strength: 1, shape: 'disc', x: -2.9, z: -0.2, r: 0.4 },
  ],
  things: [
    { id: 'crystals', place: 'echohollow', mech: MECH.block, x: -1.8, z: -1.85, yaw: -0.245, size: [0.15, 0.3, 0.15], mu: 0.7, p: { n: 5, span: 2, curve: 0.15, tuned: 1 }, ride: false, notes: [74, 76, 78, 81, 83], verb: V.RING, icon: E.bell, look: 'crystal', sound: S.chime },
    { id: 'glowpool', place: 'echohollow', mech: MECH.pool, x: 2.2, z: -1, yaw: 0, size: [1.1, 0.26, 0], mu: 1, p: {  }, ride: false, zone: 'glowpool', verb: V.WADE, icon: E.droplet, look: 'glowpool', sound: S.splash },
    { id: 'stoneslide', place: 'echohollow', mech: MECH.ramp, x: 2.9, z: 1.2, yaw: 1.571, size: [1, 0.08, 0.45], mu: 0.15, p: { angle: 14, top: 0.5, rails: 1 }, ride: true, verb: V.SLIDE, icon: E.star, look: 'stone', sound: S.whoosh },
    { id: 'mossbed', place: 'echohollow', mech: 0, x: -2.2, z: 1, yaw: 0, size: [1, 0, 0], mu: 1, p: {  }, ride: false, patch: 'mossbed', verb: V.NAP, icon: E.zzz, look: 'moss', sound: 0 },
    { id: 'echostone', place: 'echohollow', mech: MECH.block, x: 0.8, z: 1.7, yaw: 0, size: [0.25, 0.2, 0.25], mu: 0.8, p: { boostS: 20 }, ride: false, switch: 'echo', verb: V.SWITCH, icon: E.hello, look: 'echostone', sound: 0 },
    { id: 'humrock', place: 'echohollow', mech: MECH.mound, x: -0.6, z: -2, yaw: 0, size: [0.9, 0.25, 0], mu: 0.7, p: {  }, ride: false, peek: [-1.922, -2, 0.722, -2], verb: V.LEAN, icon: E.question, look: 'rock', sound: 0 },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [],
  pad: [0, 0, 1.2], spawn: [[-0.55, 0.6], [0.8, 0.55], [-1.1, -0.7], [0.45, -1], [-0.2, 1.85], [1.75, 1]],
  tall: { // FIRST DRAFT (S2 / S3 re-lay)
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3, round: 0.4 }, walls: [],
    spawn: [[-0.4, -0.6], [0.4, 0], [-0.4, 0.6], [0.4, 1.2], [-0.4, 1.8]],
    things: [
      { x: -0.666, z: -2.312, yaw: -0.245 },
      { x: 0.814, z: -1.25, yaw: 0 },
      { x: 1.073, z: 1.5, yaw: 1.571 },
      { x: -0.814, z: 1.25, yaw: 0 },
      { x: 0.296, z: 2.125, yaw: 0 },
      { x: -0.222, z: -2.5, yaw: 0, peek: [-1.544, -2.5, 1.1, -2.5] },
    ],
    zones: [{ shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3 }, { shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3 }, { shape: 'disc', x: 0.814, z: -1.25, r: 1.1 }, { shape: 'disc', x: -0.185, z: -2.187, r: 0.4 }, { shape: 'disc', x: 0.481, z: 1.688, r: 0.4 }, { shape: 'disc', x: -1.073, z: -0.25, r: 0.4 }],
    patches: [{ shape: 'disc', x: -0.814, z: 1.25, r: 1 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'hollow', sky: 'hollow', weather: 'motes', ambience: 'hollow', music: 'hollow', ceremonyDim: 0,
  signature: SIGNATURE.echotalk, finale: FINALE.crystalscale,
  reactions: /* @__PURE__ */ cells([
    100,0,2,6,1,100,1,2,6,1,100,2,2,6,1,100,3,2,6,1,100,4,2,6,1,100,5,2,6,1,100,6,2,6,1,100,7,2,6,1,100,8,2,6,1,100,9,2,6,1,100,10,2,6,1,100,11,2,6,1,
    0,0,2,6,2,0,1,2,6,2,0,2,2,6,2,0,3,2,6,2,0,4,2,6,2,0,5,2,6,2,0,6,1,5,6,0,7,2,6,2,0,8,2,6,2,0,9,2,6,2,0,10,2,6,2,0,11,2,6,2,
    1,0,0,1,1,1,0,1,5,7,1,1,0,1,1,1,1,1,5,7,1,2,1,5,7,1,3,1,5,7,1,4,1,4,130,1,5,1,5,7,1,6,1,5,7,1,7,1,5,8,1,8,2,6,3,1,9,0,1,1,
    1,9,1,5,7,1,10,1,4,130,1,11,2,6,8,2,0,0,1,3,2,1,0,1,3,2,2,0,1,3,2,3,0,1,3,2,4,0,1,3,2,5,0,1,3,2,6,0,1,3,2,7,1,8,5,2,8,0,1,3,
    2,9,0,1,3,2,10,0,1,3,2,11,2,6,9,3,0,1,8,5,3,0,3,7,6,3,1,1,8,5,3,2,1,8,5,3,3,1,8,5,3,4,1,8,5,3,5,1,8,5,3,6,1,8,1,3,7,1,8,5,
    3,8,1,8,1,3,9,1,8,1,3,10,1,8,1,3,11,1,8,5,5,0,3,3,1,5,1,3,7,113,5,2,3,3,1,5,3,3,7,113,5,4,3,7,113,5,5,0,1,3,5,6,3,7,12,5,7,0,1,3,
    5,8,3,7,113,5,9,3,7,113,5,10,3,7,113,5,11,2,6,8,
  ]),
};
export default PLACE;
