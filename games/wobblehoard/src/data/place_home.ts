// Home (home, idx 0): its PlaceDef, both layouts and the channel of every reaction cell of PLACES 4.1 (D-80). Owned by PG_DATA.
// In the LIFE CHUNK (D-69): Home's spots are in SLOT UNITS (x bodyScale, unit: 'slot'); WIDE is the PlaceDef's own fields, TALL is `tall` (D-88).
// Positions: PLACES 4.1 as written (revision 4), except round 5's re-lay for the shipped camera (FIX5_DATA B5, VERDICT_PG B5 / D1; DT-01's model
// now carries SR2's band framing, the measured HUD rows and three rest shapes): the Felt Ball WIDE (0.85, -0.75) -> (0.7, -0.65) and TALL
// (0, 0.9) -> (0.76, 1.06) (beside the play squishy, covering none with two to five out); the Music Box TALL (0.75, 1.55) -> (1.25, 0) (it
// was 0.07 m from the ball's new spot); the Snooze Rug WIDE (0, -0.35) -> (0, -0.36) (its front edge under the bottom band at two out, small
// bodies); the Bounce Pad WIDE (-0.75, -1.25) -> (-0.79, -1.25), its use spot (-0.65, -1.45) -> (-0.69, -1.45) (its top behind a body at
// four out; the pad does not arrive at Home before S2).
// Round 14 (D-104) moved the Music Box, the Warm Lamp, the Keepsake Shelf and the Bounce Pad out to the rim of the bigger felt (x 3.7 to 4); the room camera,
// which frames the party, then showed none of them (VERDICT_R14 F2). Round 15 (R15_FIX F2) brings them in again, to spots the camera BY ITSELF shows with two
// and three out at every scale and rest shape (probe_pg_data's Home row, tightened; found with DT18SEARCH + DT18DEF): WIDE the Music Box front right (2.1, 1),
// the lamp back left (-2.35, -1.1), the shelf back right (2.65, -2.5), the pad front left (-2.2, 1.35); TALL the box (1.75, 0.9), the lamp (-2, 0.1), the shelf
// (-0.4, -3.6), the pad (-1.55, 3.3); every use spot and the lamp's glow moved with its thing.
// The cells' words do not ship (D-69): `reactions` is packed [target, family, tag, chan, arg] (target: a thing index, or 100 + a zone index;
// tag 0 P, 1 L, 2 S, 3 B; chan a CHANNEL id of life.ts), unpacked once at load by places.ts cells().
import type { PlaceDef } from './places.ts';
import { MECH, ZONE, MARK, PROP_SOUND as S, SIGNATURE, FINALE, cells } from './places.ts';
import { USE_VERB as V, EMOTE as E } from './life.ts';

export const PLACE: PlaceDef = {
  id: 'home', idx: 0, name: 'Home', stampsToOpen: 0, shipped: true, night: false,
  ground: { grip: 1, glue: 1, peel: 1, drag: 1, mark: 0, markLifeS: 0 },
  patches: [
    { id: 'snoozerug', shape: 'disc', x: 0, z: -0.36, r: 0.7, mods: { grip: 1.15 }, nap: true },
  ],
  zones: [
    { id: 'lampwarmth', kind: ZONE.warm, strength: 0.4, shape: 'disc', x: -2.35, z: -1.1, r: 1.6, switchable: true },
  ],
  things: [
    { id: 'feltball', place: 'home', mech: MECH.ball, x: 0.7, z: -0.65, yaw: 0, size: [0.22, 0, 0], mu: 0.6, p: { mass: 0.2, rollDamp: 0.6 }, ride: false, fromN: 1, verb: V.ROLL, icon: E.ball, look: 'felt', sound: S.ball, arrives: { after: 'start' } },
    { id: 'musicbox', place: 'home', mech: MECH.block, x: 2.1, z: 1, yaw: 0, size: [0.2, 0.15, 0.15], mu: 0.8, p: { tuneS: 29.1, gapS: 40 }, ride: false, switch: 'tune', fromN: 2, verb: V.LISTEN, icon: E.note, look: 'musicbox', sound: S.bell, arrives: { after: 'start' } },
    { id: 'snoozerug', place: 'home', mech: 0, x: 0, z: -0.36, yaw: 0, size: [0.7, 0, 0], mu: 1, p: {  }, ride: false, patch: 'snoozerug', useSpot: [-0.42, -0.91], fromN: 2, verb: V.NAP, icon: E.zzz, look: 'rug', sound: 0, arrives: { after: 'firstHello' } },
    { id: 'warmlamp', place: 'home', mech: MECH.block, x: -2.35, z: -1.1, yaw: 0, size: [0.18, 0.1, 0.18], mu: 0.8, p: { shadeH: 0.6, toastCap: 0.3 }, ride: false, zone: 'lampwarmth', switch: 'zone', useSpot: [-1.55, -1.6], fromN: 3, verb: V.SWITCH, icon: E.sun, look: 'lamp', sound: 0, arrives: { after: 'firstCapsule' } },
    { id: 'keepsakeshelf', place: 'home', mech: MECH.block, x: 2.65, z: -2.5, yaw: 0, size: [0.6, 0.225, 0.15], mu: 0.8, p: { rows: 2, perRow: 10 }, ride: false, fromN: 2, verb: V.RING, icon: E.sparkle, look: 'shelf', sound: S.bell, arrives: { after: 'finale:home' } },
    { id: 'bouncepad', place: 'home', mech: MECH.pad, x: -2.2, z: 1.35, yaw: 0, size: [0.4, 0.05, 0], mu: 1, p: { gain: 1.1, apex: 0.42, travel: 0.1, maxBounces: 5 }, ride: false, useSpot: [-2.1, 1.25], fromN: 3, verb: V.BOUNCE, icon: E.star, look: 'feltpad', sound: S.boing, arrives: { after: 'finale:hearthlog' } },
  ],
  bounds: { shape: 'disc', x: 0, z: 0, r: 5.5, round: 0 }, walls: [],
  pad: [0, 0, 1.2], spawn: 'matLayout', unit: 'slot',
  tall: {
    bounds: { shape: 'disc', x: 0, z: 0, r: 5.5, round: 0 }, walls: [],
    spawn: 'matLayout',
    things: [
      { x: 0.75, z: 1.2, yaw: 0, fromN: 1 },
      { x: 1.75, z: 0.9, yaw: 0, fromN: 2 },
      { x: 0.3, z: 0, yaw: 0, use: [0.25, -1], fromN: 2 },
      { x: -2, z: 0.1, yaw: 0, use: [-1.71, 0.85], fromN: 3 },
      { x: -0.4, z: -3.6, yaw: 0, fromN: 2 },
      { x: -1.55, z: 3.3, yaw: 0, use: [-1.45, 3.2], fromN: 3 },
    ],
    zones: [{ shape: 'disc', x: -2, z: 0.1, r: 1.6 }],
    patches: [{ shape: 'disc', x: 0.3, z: 0, r: 0.7 }],
  },
  camera: { yawRange: 60, pitch: [0.15, 0.9], zoom: [0.7, 1.6] },
  light: 'home', sky: 'home', weather: 'none', ambience: 'none', music: 'home', ceremonyDim: 0,
  signature: SIGNATURE.arrive, finale: FINALE.wishtrip,
  reactions: /* @__PURE__ */ cells([
    0,0,3,7,4,0,1,0,1,3,0,2,0,1,3,0,3,0,1,3,0,4,0,1,3,0,5,0,1,3,0,6,0,1,3,0,7,0,1,3,0,8,0,1,3,0,9,0,1,3,0,10,3,7,4,0,11,2,6,8,
    2,0,3,7,6,2,1,0,1,3,2,2,0,1,3,2,3,3,7,6,2,4,0,1,3,2,5,0,1,3,2,6,1,5,6,2,7,3,7,6,2,8,3,7,4,2,9,3,7,6,2,10,3,7,6,2,11,0,1,3,
    2,11,2,6,8,3,0,3,7,6,3,1,1,4,530,3,2,0,2,104,3,3,3,3,2,3,4,3,3,2,3,5,0,2,97,3,6,0,2,95,3,7,0,2,82,3,8,3,3,5,3,9,3,3,5,3,10,3,3,2,
    3,11,2,6,8,1,0,2,6,1,1,1,2,6,1,1,2,2,6,1,1,3,2,6,1,1,4,2,6,1,1,5,2,6,1,1,6,2,6,1,1,7,2,6,1,1,8,2,6,1,1,9,2,6,1,1,10,2,6,1,
    1,11,2,6,1,5,0,0,1,4,5,1,0,1,4,5,2,0,1,4,5,3,0,1,4,5,4,0,1,4,5,5,0,1,4,5,6,0,1,4,5,7,0,1,4,5,8,0,1,4,5,9,0,1,4,5,10,0,1,4,
    5,11,0,1,4,5,11,2,6,8,
  ]),
};
export default PLACE;
