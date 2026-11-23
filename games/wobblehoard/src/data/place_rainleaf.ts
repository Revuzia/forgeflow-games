// Rainleaf Garden (rainleaf, idx 4): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.5 (D-80). Owned by PG_DATA.
// A LAZY module: loaded with its place through loadPlaceDef('rainleaf') (D-69); never imported statically by boot, places.ts, life.ts or quests.ts.
// Positions (S2 re-lay, PG_DATA round 2; DT-01 0 problems in each layout): WIDE is PLACES 4.5 with no thing moved; the third Splash Spot is
// r 0.6 (PLACES: r 0.6 to 0.9; the draft had 0.55), the Leaf Drip zone hangs 0.75 m in front of the stalk (under the leaf, so a body of R 0.625
// stands in its middle clear of the stalk) with the Drip Leaf's use spot there, new spawn spots; TALL is laid under P7 (report: PG_DATA.md R2).
// Round 6 (R6_DATA item 2, the shipped camera's party row at 664 px): WIDE moves the first Splash Spot 0.15 m back (r 0.6), the second to the
// back middle (it stood in front of the pad, under the party row) and the Stepping Stones 0.1 m back; TALL re-laid (below).
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'rainleaf', idx: 4, name: 'Rainleaf Garden', coined: ['Rainleaf'], stampsToOpen: 28, shipped: true, night: false,
  ground: { grip: 0.85, glue: 1, peel: 1, drag: 1, mark: MARK.trail, markLifeS: 20 },
  patches: [
    { id: 'steppingstones', shape: 'box', x: -2.6, z: 2.7, hx: 1.4, hz: 0.3, mods: { grip: 1.1 } },
  ],
  zones: [
    { id: 'rain', kind: ZONE.wet, strength: 1, shape: 'box', x: 0, z: 0, hx: 5.5, hz: 3.9, shower: { onS: 40, offS: 30 } },
    { id: 'splashspots.0', kind: ZONE.water, strength: 1, shape: 'disc', x: 2.6, z: 2.3, r: 0.8, surfaceY: 0.07 },
    { id: 'splashspots.1', kind: ZONE.water, strength: 1, shape: 'disc', x: 0.9, z: -2.85, r: 0.8, surfaceY: 0.06 },
    { id: 'splashspots.2', kind: ZONE.water, strength: 1, shape: 'disc', x: 4.5, z: -2.9, r: 0.8, surfaceY: 0.08 },
    { id: 'leafdrip', kind: ZONE.wet, strength: 1, shape: 'disc', x: -2.6, z: -2.55, r: 0.6, switchable: true },
  ],
  things: [
    { id: 'splashspots', place: 'rainleaf', mech: MECH.pool, x: 2.6, z: 2.3, yaw: 0, size: [0.85, 0.07, 0], mu: 1, p: { n: 3 }, ride: false, zone: 'splashspots', verb: V.WADE, icon: E.droplet, look: 'puddle', sound: S.splash },
    { id: 'leafteeter', place: 'rainleaf', mech: MECH.seesaw, x: 3.9, z: -0.9, yaw: 0, size: [0.9, 0.08, 0.4], mu: 0.9, p: { pivot: 0.24, limit: 10, inertia: 0.6, damping: 1, rider: 0.65 }, ride: true, verb: V.ROCK, icon: E.swirl, look: 'leaf', sound: S.creak },
    { id: 'mossbouncer', place: 'rainleaf', mech: MECH.pad, x: -3.9, z: -0.5, yaw: 0, size: [0.45, 0.05, 0], mu: 1, p: { gain: 1.2, apex: 0.42, travel: 0.1, maxBounces: 5 }, ride: false, verb: V.BOUNCE, icon: E.star, look: 'moss', sound: S.boing },
    { id: 'dripleaf', place: 'rainleaf', mech: MECH.block, x: -2.6, z: -3.3, yaw: 0, size: [0.1, 0.8, 0.1], mu: 0.8, p: {  }, ride: false, zone: 'leafdrip', switch: 'shower', useSpot: [-2.6, -2.55], verb: V.SWITCH, icon: E.droplet, look: 'dripleaf', sound: S.rustle },
    { id: 'steppingstones', place: 'rainleaf', mech: 0, x: -2.6, z: 2.7, yaw: 0, size: [1.4, 0, 0.3], mu: 1, p: { n: 6 }, ride: false, patch: 'steppingstones', verb: V.STEP, icon: E.leaf, look: 'stones', sound: 0 },
    { id: 'seedpod', place: 'rainleaf', mech: MECH.ball, x: 1.3, z: 2.6, yaw: 0, size: [0.2, 0, 0], mu: 0.8, p: { mass: 0.15, rollDamp: 0.8, rattle: 1 }, ride: false, verb: V.ROLL, icon: E.ball, look: 'seedpod', sound: S.ball },
  ],
  bounds: { shape: 'box', x: 0, z: 0, hx: 5.5, hz: 3.9, round: 1.3 }, walls: [],
  pad: [0, 0, 1.2], spawn: [[-0.9, -0.5], [0.5, 0.2], [-0.6, 1], [1.8, 0.9], [-2.2, 0.3], [0.3, -1.3]],
  tall: { // (round 6, R6_DATA item 2) re-laid for the shipped place camera (render/placeview.ts fitPlace, the phone's 618 px hint pill):
    // the bounds 1.4 x 3.0 (P7's 1.25 widened: the fit is width-bound, report); the Leaf Teeter across the very back (it rocks side to side
    // as the camera sees it), the third Splash Spot in front of it with the Stepping Stones across it, the Drip Leaf back right with its drip
    // in front of it, the Moss Bouncer in the left strip, two Splash Spots in the front band (front edges 2.4 m, under every fit's pill line;
    // every spot r 0.6, PLACES 4.5), the Seed Pod in the right strip. DT-01 0 in the frame and in the shipped camera, and still 0 with the
    // framed front moved -0.1..+0.2 m (the fit's near-tie, report)
    bounds: { shape: 'box', x: 0, z: 0, hx: 2.3, hz: 4.9, round: 0.65 }, walls: [],
    spawn: [[0.5, -1.1], [-0.4, -0.5], [0.4, 0.3], [-0.6, 1], [0.3, 1.7]],
    things: [
      { x: -1.3, z: 3.2, yaw: 0},
      { x: 0, z: -4.3, yaw: 0},
      { x: -1.8, z: -1.6, yaw: 0},
      { x: 1.9, z: -3.5, yaw: 0, use: [1.9, -2.75] },
      { x: 0.1, z: -2.9, yaw: 0},
      { x: 1.7, z: 1.2, yaw: 0},
    ],
    zones: [{ shape: 'box', x: 0, z: 0, hx: 2.3, hz: 4.9 }, { shape: 'disc', x: -1.3, z: 3.2, r: 0.8 }, { shape: 'disc', x: 1.3, z: 3.2, r: 0.8 }, { shape: 'disc', x: 0.1, z: -2.9, r: 0.8 }, { shape: 'disc', x: 1.9, z: -2.75, r: 0.6 }],
    patches: [{ shape: 'box', x: 0.1, z: -2.9, hx: 1.4, hz: 0.3 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'garden', sky: 'garden', weather: 'rain', ambience: 'garden', music: 'garden', ceremonyDim: 0,
  signature: SIGNATURE.splashjump, finale: FINALE.rainstop,
  reactions: /* @__PURE__ */ cells([
    100,0,1,4,250,100,1,1,4,250,100,2,1,4,130,100,3,1,4,130,100,4,1,4,130,100,5,1,5,4,100,6,1,4,130,100,7,1,5,4,100,7,2,6,4,100,8,1,4,130,100,9,1,4,130,100,10,1,4,130,
    100,11,2,6,4,0,0,1,4,250,0,1,2,6,5,0,2,2,6,6,0,3,2,6,3,0,4,2,6,3,0,5,1,8,1,0,6,2,6,7,0,7,1,8,2,0,8,2,6,3,0,9,2,6,3,0,10,2,6,3,
    0,11,2,6,3,1,0,0,1,3,1,1,0,1,3,1,2,0,1,3,1,3,0,1,3,1,4,0,1,3,1,5,0,1,3,1,6,0,1,3,1,7,0,1,3,1,8,0,1,3,1,9,0,1,3,1,10,0,1,3,
    1,11,2,6,8,2,0,0,1,4,2,1,0,1,4,2,2,0,1,4,2,3,0,1,4,2,4,0,1,4,2,5,0,1,4,2,6,0,1,4,2,7,0,1,4,2,8,0,1,4,2,9,0,1,4,2,10,0,1,4,
    2,11,0,1,4,2,11,2,6,8,4,0,1,8,1,4,1,1,8,1,4,2,1,8,1,4,3,1,8,1,4,4,1,8,1,4,5,1,8,1,4,6,1,8,1,4,7,1,8,2,4,8,1,8,1,4,9,1,8,1,
    4,10,1,8,1,4,11,1,8,1,5,0,3,7,4,5,1,0,1,3,5,2,0,1,3,5,3,0,1,3,5,4,0,1,3,5,5,0,1,3,5,6,0,1,3,5,7,0,1,3,5,8,0,1,3,5,9,0,1,3,
    5,10,3,7,4,5,11,2,6,8,
  ]),
};
export default PLACE;
