// Fizzwell Tub (fizzwell, idx 5): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.6 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('fizzwell') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions: the WIDE layout as PLACES 4.6 writes it (design intent; DT-01 not yet clean); the TALL layout is a FIRST DRAFT (the wide arrangement squeezed into the
// tall frame), NOT yet laid under P7: its slice (S2 / S3) re-lays both with DT-01 and reports every move (PG_DATA brief).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'fizzwell', idx: 5, name: 'Fizzwell Tub', coined: ['Fizzwell'], stampsToOpen: 36, shipped: false, night: false,
  ground: { grip: 0.7, glue: 0.8, peel: 1, drag: 1, mark: 0, markLifeS: 0 },
  patches: [
    { id: 'bathmat', shape: 'box', x: 0, z: 0.575, hx: 3.4, hz: 1.825, mods: { grip: 1.3 } },
  ],
  zones: [
    { id: 'bathwater', kind: ZONE.water, strength: 1, shape: 'box', x: 0, z: -1.825, hx: 3.4, hz: 0.575, surfaceY: 0.28, ramp: 0.4 },
    { id: 'tapswirl', kind: ZONE.current, strength: 1, shape: 'disc', x: 0, z: -2.2, r: 0.9, flow: [0.12, 0], switchable: true },
    { id: 'bathwater.warm', kind: ZONE.warm, strength: 0.6, shape: 'box', x: 0, z: -1.825, hx: 3.4, hz: 0.575 },
    { id: 'bubblepatch', kind: ZONE.wet, strength: 1, shape: 'disc', x: -0.9, z: -1.95, r: 0.6 },
  ],
  things: [
    { id: 'bathwater', place: 'fizzwell', mech: MECH.pool, x: 0, z: -1.825, yaw: 0, size: [3.4, 0.28, 0.575], mu: 1, p: {  }, ride: false, zone: 'bathwater', verb: V.WADE, icon: E.droplet, look: 'bath', sound: S.splash },
    { id: 'tap', place: 'fizzwell', mech: MECH.block, x: 0, z: -2.2, yaw: 0, size: [0.2, 0.25, 0.15], mu: 0.8, p: {  }, ride: false, zone: 'tapswirl', switch: 'zone', verb: V.SWITCH, icon: E.droplet, look: 'tap', sound: S.splash },
    { id: 'swirlride', place: 'fizzwell', mech: MECH.turntable, x: -2.2, z: -1.85, yaw: 0, size: [0.5, 0.05, 0], mu: 0.9, p: { motor: 0.2 }, ride: false, verb: V.SPIN, icon: E.swirl, look: 'swirl', sound: S.whoosh },
    { id: 'soapslide', place: 'fizzwell', mech: MECH.ramp, x: 2.6, z: -0.75, yaw: 1.571, size: [1.05, 0.08, 0.45], mu: 0.05, p: { angle: 12, top: 0.45, rails: 1 }, ride: true, verb: V.SLIDE, icon: E.star, look: 'soap', sound: S.whoosh },
    { id: 'spongeraft', place: 'fizzwell', mech: MECH.floater, x: 1.2, z: -1.95, yaw: 0, size: [0.5, 0.1, 0.35], mu: 0.9, p: { bob: 0.03, bobHz: 0.25 }, ride: true, verb: V.FLOAT_ON, icon: E.bubbles, look: 'sponge', sound: S.splash },
    { id: 'bubblepatch', place: 'fizzwell', mech: 0, x: -0.9, z: -1.95, yaw: 0, size: [0.6, 0, 0], mu: 1, p: {  }, ride: false, zone: 'bubblepatch', verb: V.STEP, icon: E.bubbles, look: 'bubbles', sound: 0 },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [{ shape: 'box', x: 0, z: -2.55, hx: 3.7, hz: 0.15 }, { shape: 'box', x: -3.55, z: 0, hx: 0.15, hz: 2.7 }, { shape: 'box', x: 3.55, z: 0, hx: 0.15, hz: 2.7 }],
  pad: [0, 0, 1.2], spawn: [[-0.8, 0.6], [0.65, 0.75], [-1.95, 0.25], [1.65, -0.2], [-0.35, 1.85], [1, 1.95]],
  tall: { // FIRST DRAFT (S2 / S3 re-lay)
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3, round: 0.4 }, walls: [{ shape: 'box', x: 0, z: -3.9, hx: 2.6, hz: 0.15 }, { shape: 'box', x: -2.45, z: 0, hx: 0.15, hz: 3.9 }, { shape: 'box', x: 2.45, z: 0, hx: 0.15, hz: 3.9 }],
    spawn: [[-0.4, -0.6], [0.4, 0], [-0.4, 0.6], [0.4, 1.2], [-0.4, 1.8]],
    things: [
      { x: 0, z: -2.281, yaw: 0 },
      { x: 0, z: -2.75, yaw: 0 },
      { x: -0.814, z: -2.312, yaw: 0 },
      { x: 0.962, z: -0.937, yaw: 1.571 },
      { x: 0.444, z: -2.437, yaw: 0 },
      { x: -0.333, z: -2.437, yaw: 0 },
    ],
    zones: [{ shape: 'box', x: 0, z: -2.281, hx: 1.25, hz: 0.719 }, { shape: 'disc', x: 0, z: -2.75, r: 0.9 }, { shape: 'box', x: 0, z: -2.281, hx: 1.25, hz: 0.719 }, { shape: 'disc', x: -0.333, z: -2.437, r: 0.6 }],
    patches: [{ shape: 'box', x: 0, z: 0.719, hx: 1.25, hz: 1.825 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'bath', sky: 'bath', weather: 'bubbles', ambience: 'bath', music: 'bath', ceremonyDim: 0,
  signature: SIGNATURE.floatsit, finale: FINALE.bubblecolumn,
  reactions: /* @__PURE__ */ cells([
    0,0,0,1,1,0,0,1,4,250,0,1,0,1,1,0,2,1,4,130,0,4,1,4,130,0,5,0,1,1,0,6,1,4,130,0,7,1,5,8,0,8,2,6,3,0,9,0,1,1,0,10,1,4,130,0,11,2,6,8,
    1,0,0,1,1,1,1,0,1,1,1,2,3,7,1,1,3,1,3,3,1,4,1,3,2,1,5,3,7,1,1,6,3,7,1,1,7,3,7,1,1,8,3,7,1,1,9,0,1,1,1,10,3,7,1,1,11,3,7,1,
    2,0,0,1,3,2,1,0,1,3,2,2,0,1,3,2,3,0,1,3,2,4,0,1,3,2,5,0,1,3,2,6,0,1,3,2,7,0,1,3,2,8,0,1,3,2,9,0,1,3,2,10,0,1,3,2,11,2,6,8,
    4,0,1,4,250,4,1,1,4,201,4,2,0,1,3,4,3,0,1,3,4,4,0,1,3,4,5,0,1,3,4,6,0,1,3,4,7,0,1,3,4,8,0,1,3,4,9,0,1,3,4,10,0,1,3,4,11,2,6,8,
    5,0,1,4,250,5,1,2,6,5,5,2,1,5,5,5,3,1,5,5,5,4,2,6,1,5,5,1,5,5,5,6,1,5,5,5,7,1,4,130,5,8,2,6,12,5,9,1,5,5,5,10,2,6,1,5,11,2,6,8,
    3,0,0,1,3,3,1,0,1,3,3,2,0,1,3,3,3,2,6,3,3,4,0,1,3,3,5,0,1,3,3,6,0,1,3,3,7,1,8,2,3,8,0,1,3,3,8,2,6,3,3,9,0,1,3,3,10,0,1,3,
    3,11,2,6,9,
  ]),
};
export default PLACE;
