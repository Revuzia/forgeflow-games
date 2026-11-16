// Ripple Shore (ripple, idx 2): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.3 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('ripple') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions (S2 re-lay, PG_DATA round 2; DT-01 0 problems in each layout): WIDE is PLACES 4.3 with three moves (the log 0.05 m left and laid
// along z, so both peek spots lie inside the bounds; the Shell Chimes 0.25 m forward; the Sand Mound 0.474 m forward-right, off the log and
// inside the walls' rectangle) and new spawn spots; TALL is laid under P7 (report: _handoff/reports/PG_DATA.md, round 2).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'ripple', idx: 2, name: 'Ripple Shore', stampsToOpen: 12, shipped: false, night: false,
  ground: { grip: 1.35, glue: 0.8, peel: 0.9, drag: 1.1, mark: MARK.print, markLifeS: 40 },
  patches: [
    { id: 'wetsand', shape: 'box', x: 0, z: -1.75, hx: 3.4, hz: 0.35, mods: { grip: 1.1 }, mark: MARK.print, markLifeS: 60 },
  ],
  zones: [
    { id: 'rockpool', kind: ZONE.water, strength: 1, shape: 'disc', x: 2.3, z: -1.1, r: 1.3, surfaceY: 0.28, ramp: 0.4, flow: [0.08, 0] },
    { id: 'surfedge', kind: ZONE.water, strength: 1, shape: 'box', x: 0, z: -2.15, hx: 3.4, hz: 0.25, surfaceY: 0.06, wave: { amp: 0.06, everyS: [7, 10] } },
    { id: 'sun', kind: ZONE.warm, strength: 0.4, shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4 },
  ],
  things: [
    { id: 'rockpool', place: 'ripple', mech: MECH.pool, x: 2.3, z: -1.1, yaw: 0, size: [1.3, 0.28, 0], mu: 1, p: {  }, ride: false, zone: 'rockpool', verb: V.WADE, icon: E.droplet, look: 'rockpool', sound: S.splash },
    { id: 'bobring', place: 'ripple', mech: MECH.floater, x: 2.3, z: -1.1, yaw: 0, size: [0.45, 0.08, 0], mu: 0.6, p: { segments: 6, bob: 0.03, bobHz: 0.3 }, ride: true, verb: V.FLOAT_ON, icon: E.bubbles, look: 'bobring', sound: S.splash },
    { id: 'driftlog', place: 'ripple', mech: MECH.bar, x: -2.45, z: -1.4, yaw: 1.571, size: [0.18, 2, 0], mu: 0.9, p: {  }, ride: false, peek: [-3.33, -0.8, -1.57, -0.8], verb: V.LEAN, icon: E.question, look: 'driftwood', sound: 0 },
    { id: 'shellchimes', place: 'ripple', mech: MECH.chime, x: -2.8, z: 0.85, yaw: 1.571, size: [0.08, 0.2, 0], mu: 0.6, p: { n: 5, span: 1.2, hang: 0.5, limit: 25, damping: 0.8, postR: 0.08 }, ride: false, notes: [74, 76, 78, 81, 83], verb: V.RING, icon: E.bell, look: 'shells', sound: S.chime },
    { id: 'pebbleball', place: 'ripple', mech: MECH.ball, x: 0.9, z: 1.6, yaw: 0, size: [0.22, 0, 0], mu: 0.8, p: { mass: 0.3, rollDamp: 1.2 }, ride: false, verb: V.ROLL, icon: E.ball, look: 'pebble', sound: S.ball },
    { id: 'sandmound', place: 'ripple', mech: MECH.mound, x: -0.75, z: -1.75, yaw: 0, size: [0.9, 0.25, 0], mu: 0.7, p: {  }, ride: true, verb: V.SLIDE, icon: E.swirl, look: 'sand', sound: S.crunch },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [],
  pad: [0, 0, 1.2], spawn: [[-0.025, 0.825], [2.575, 1.575], [0.925, -1.575], [-1.375, -0.325], [-1.575, 1.575], [1.575, 0.175]],
  tall: { // laid under P7 (S2): the log at the back of the middle (its peek spots at its back end), the pool and the Bob Ring back right (the
    // ring at the pool's full depth, its rider inside the bounds), the chimes in the left strip, the mound and the ball in the front band
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3, round: 0.4 }, walls: [],
    spawn: [[0.375, 0.975], [-0.425, 0.375], [-0.425, 1.575], [0.425, -0.175], [-0.375, -0.775]],
    things: [
      { x: 1.403, z: -2.07, yaw: 0 },
      { x: 1.2, z: -1.77, yaw: 0 },
      { x: -0.3, z: -2.7, yaw: 1.571, peek: [-1.18, -2.76, 0.58, -2.76] },
      { x: -1.62, z: -1.34, yaw: 1.571 },
      { x: -1, z: 2.6, yaw: 0 },
      { x: 0.8, z: 2.75, yaw: 0 },
    ],
    zones: [{ shape: 'disc', x: 1.403, z: -2.07, r: 1.3 }, { shape: 'box', x: 0, z: -3.25, hx: 2.3, hz: 0.45 }, { shape: 'box', x: 0, z: 0, hx: 1.25, hz: 3 }],
    patches: [{ shape: 'box', x: 0, z: -2.45, hx: 2.3, hz: 0.35 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'shore', sky: 'shore', weather: 'spray', ambience: 'shore', music: 'shore', ceremonyDim: 0.3,
  signature: SIGNATURE.squirt, finale: FINALE.sunset,
  reactions: /* @__PURE__ */ cells([
    0,0,0,1,1,0,0,1,4,250,0,1,0,1,1,0,2,1,4,350,0,3,1,4,130,0,4,0,1,1,0,5,0,1,1,0,6,1,4,350,0,7,1,5,8,0,8,2,6,3,0,9,0,1,1,0,10,1,4,130,
    0,11,2,6,8,101,0,1,4,250,101,1,2,6,5,101,2,2,6,6,101,3,2,6,3,101,4,2,6,3,101,5,1,8,1,101,6,2,6,7,101,7,1,8,2,101,8,2,6,3,101,9,2,6,3,101,10,2,6,3,
    101,11,2,6,3,102,0,1,4,201,102,1,1,4,350,102,2,1,8,1,102,3,1,4,350,102,3,3,7,5,102,4,1,4,101,102,5,1,8,1,102,6,1,4,350,102,7,1,4,350,102,8,1,4,301,102,9,1,4,301,
    102,10,1,4,350,102,11,2,6,9,1,0,0,1,3,1,1,0,1,3,1,2,0,1,3,1,3,0,1,3,1,4,0,1,3,1,5,0,1,3,1,6,0,1,3,1,7,0,1,3,1,8,0,1,3,1,9,0,1,3,
    1,10,0,1,3,1,11,2,6,8,3,0,2,6,2,3,1,2,6,2,3,2,2,6,2,3,3,2,6,2,3,3,2,6,1,3,4,2,6,1,3,5,2,6,2,3,6,1,1,3,3,7,2,6,2,3,8,2,6,2,
    3,9,2,6,2,3,10,2,6,1,3,11,2,6,2,4,0,3,7,4,4,1,0,1,3,4,2,0,1,3,4,3,0,1,3,4,4,0,1,3,4,5,0,1,3,4,6,0,1,3,4,7,0,1,3,4,8,0,1,3,
    4,9,0,1,3,4,10,3,7,4,4,11,2,6,8,5,0,0,1,3,5,1,0,1,3,5,2,1,4,350,5,3,0,1,3,5,4,0,1,3,5,5,0,1,3,5,6,0,1,3,5,7,0,1,3,5,8,0,1,3,
    5,9,0,1,3,5,10,0,1,3,5,11,0,1,3,5,11,2,6,9,
  ]),
};
export default PLACE;
