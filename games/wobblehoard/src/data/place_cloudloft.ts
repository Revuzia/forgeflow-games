// Cloudloft (cloudloft, idx 9): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.10 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('cloudloft') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions (S3, PG_DATA round 2): WIDE is PLACES 4.10 with three moves (DT-01 0 problems: the updraft's Puff Pad 0.497 m, still wholly in the
// updraft; the Cloud Nest 0.283 m, inside the walls' rectangle; the Cloud Ball 0.328 m, clear of the Kite Swing's push spot) and new spawn
// spots; TALL is still a FIRST DRAFT: the three Puff Pads keep one triangle 4.4 m wide in both layouts (p.x1..z2), which the tall frame cannot
// hold, while PLACES 4.10 also says "in a triangle 1.6 m apart": back to the designer (report: _handoff/reports/PG_DATA.md, round 2).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'cloudloft', idx: 9, name: 'Cloudloft', coined: ['Cloudloft', 'Sunbow'], stampsToOpen: 45, shipped: false, night: false,
  ground: { grip: 0.8, glue: 0.6, peel: 0.6, drag: 1.15, mark: MARK.dent, markLifeS: 6 },
  patches: [

  ],
  zones: [
    { id: 'updraft', kind: ZONE.updraft, strength: 1, shape: 'disc', x: 2.2, z: -0.8, r: 1 },
    { id: 'breeze', kind: ZONE.wind, strength: 0.4, shape: 'box', x: 0, z: -1.825, hx: 3.4, hz: 0.575, gust: { everyS: [8, 16], forS: 2 } },
    { id: 'sun', kind: ZONE.warm, strength: 0.4, shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4 },
  ],
  things: [
    { id: 'puffpads', place: 'cloudloft', mech: MECH.pad, x: 2.61, z: -0.52, yaw: 0, size: [0.45, 0.05, 0], mu: 1, p: { n: 3, x1: -2.2, z1: -0.6, x2: 0, z2: -1.9, tx1: 0.2, tz1: -3.2, tx2: -1, tz2: -3.15, gain: 1.25, apex: 0.35, travel: 0.1, maxBounces: 5 }, ride: false, verb: V.BOUNCE, icon: E.star, look: 'puff', sound: S.boing },
    { id: 'updraft', place: 'cloudloft', mech: 0, x: 2.2, z: -0.8, yaw: 0, size: [1, 0, 0], mu: 1, p: {  }, ride: false, zone: 'updraft', verb: V.STEP, icon: E.swirl, look: 'updraft', sound: S.whoosh },
    { id: 'kiteswing', place: 'cloudloft', mech: MECH.swing, x: -2.4, z: 1.1, yaw: 0, size: [0.09, 0.9, 0], mu: 0.9, p: { rope: 1.4, pivotY: 1.62, limit: 30, seatY: 0.22, damping: 0.25 }, ride: true, push: [-0.4, 1.1], verb: V.SWING, icon: E.star, look: 'kite', sound: S.creak },
    { id: 'sunbowarch', place: 'cloudloft', mech: MECH.bar, x: -1.75, z: -1.95, yaw: 0, size: [0.16, 1.6, 1.3], mu: 0.8, p: { arch: 1, width: 1.6, height: 1.3 }, ride: false, verb: V.STEP, icon: E.sparkle, look: 'sunbow', sound: 0 },
    { id: 'cloudnest', place: 'cloudloft', mech: MECH.ring, x: 2.32, z: 1.26, yaw: -2.678, size: [0.95, 0.1, 115], mu: 0.9, p: { segments: 5, way: 0.6 }, ride: false, useSpot: [2.32, 1.26], verb: V.NAP, icon: E.zzz, look: 'cloudnest', sound: 0 },
    { id: 'cloudball', place: 'cloudloft', mech: MECH.ball, x: -0.97, z: 2.02, yaw: 0, size: [0.26, 0, 0], mu: 0.8, p: { mass: 0.12, rollDamp: 0.8, updraftCatch: 1 }, ride: false, verb: V.ROLL, icon: E.ball, look: 'cloudball', sound: S.ball },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 3.4, hz: 2.4, round: 0.8 }, walls: [],
  pad: [0, 0, 1.2], spawn: [[-0.575, 0.525], [1.725, -1.575], [1.275, 0.725], [0.525, -0.625], [-0.825, -0.775], [0.225, 1.575]],
  tall: { // (round 6, R6_DATA item 2; NOT FINISHED: DT-01 3 problems, all spawn spots, report) laid for P7 and the shipped place camera
    // (render/placeview.ts fitPlace, the phone's 618 px hint pill; that row 0), the bounds 1.4 x 3.0 (P7's 1.25 widened: the fit is
    // width-bound, report): the three Puff Pads across the back (parts 1 and 2 at p.tx1 / p.tz1, p.tx2 / p.tz2, where physics/props.ts builds
    // them in this layout), the first in the Updraft, the Kite Swing in the right strip swinging along z (pushed from its front end), the
    // Sunbow Arch in the left strip (walked through from the pad), the Cloud Nest in the front band with its gap toward the pad, the Cloud
    // Ball front left; the Breeze over the back band. The 2.1 m nest in front and the swing, arch and pads behind leave room for 2 spawn spots
    // of the 5 DT-01 asks (1.0 m apart, 0.9 m clear): an owner's call (report)
    bounds: { shape: 'box', x: 0, z: 0, hx: 1.4, hz: 3, round: 0.4 }, walls: [],
    spawn: [[-0.4, -0.6], [0.4, 0], [-0.4, 0.6], [0.4, 1.2], [-0.4, 1.8]],
    things: [
      { x: -0.35, z: -2.1, yaw: 0 },
      { x: -0.35, z: -2.2, yaw: 0 },
      { x: 1.3, z: -2, yaw: 1.571, push: [1.3, 0] },
      { x: -1.5, z: -1.4, yaw: 1.571 },
      { x: 0.45, z: 1.6, yaw: -1.844, use: [0.45, 1.6] },
      { x: -1.15, z: 1.2, yaw: 0 },
    ],
    zones: [{ shape: 'disc', x: -0.35, z: -2.2, r: 1 }, { shape: 'box', x: 0, z: -2.281, hx: 1.4, hz: 0.719 }, { shape: 'box', x: 0, z: 0, hx: 1.4, hz: 3 }],
    patches: [],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'cloud', sky: 'cloud', weather: 'wisps', ambience: 'cloud', music: 'cloud', ceremonyDim: 0.3,
  signature: SIGNATURE.updraft, finale: FINALE.sunrise,
  reactions: /* @__PURE__ */ cells([
    102,0,1,8,4,102,1,1,8,4,102,2,1,8,4,102,3,1,8,4,102,4,1,8,4,102,5,1,8,4,102,6,1,8,4,102,7,1,8,2,102,8,1,8,4,102,9,1,8,4,102,10,1,8,4,102,11,1,8,4,
    1,0,0,1,5,1,1,0,1,5,1,2,0,1,5,1,3,0,1,5,1,4,0,1,5,1,5,0,1,5,1,6,0,1,5,1,7,0,1,5,1,8,0,1,5,1,9,0,1,5,1,10,0,1,5,1,11,2,6,8,
    0,0,0,1,4,0,1,0,1,4,0,2,0,1,4,0,3,0,1,4,0,4,0,1,4,0,5,0,1,4,0,6,0,1,4,0,7,0,1,4,0,8,0,1,4,0,9,0,1,4,0,10,0,1,4,0,11,0,1,4,
    0,11,2,6,8,2,0,1,1,3,2,1,0,1,3,2,2,0,1,3,2,3,0,1,3,2,4,0,1,3,2,5,0,1,3,2,6,0,1,3,2,7,0,1,3,2,8,0,1,3,2,9,0,1,3,2,10,0,1,3,
    2,11,2,6,8,3,0,3,7,105,3,1,3,7,105,3,2,3,7,105,3,3,3,7,105,3,4,3,7,105,3,5,3,7,105,3,6,3,7,105,3,7,3,7,105,3,8,3,7,105,3,9,3,7,105,3,10,3,7,105,
    3,11,2,6,8,4,0,3,7,6,4,1,0,1,3,4,2,0,1,3,4,3,0,1,3,4,4,1,7,6,4,5,0,1,3,4,6,1,5,6,4,7,0,1,3,4,8,3,7,6,4,9,0,1,3,4,10,0,1,3,
    4,11,2,6,8,5,0,3,7,4,5,1,0,1,3,5,2,0,1,3,5,3,0,1,3,5,4,0,1,3,5,5,0,1,3,5,6,0,1,3,5,7,0,1,3,5,8,0,1,3,5,9,0,1,3,5,10,3,7,4,
    5,11,2,6,8,
  ]),
};
export default PLACE;
