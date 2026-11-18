// PLAYGROUND (PG_PHYS, _spec/PLAYGROUND_BUILD.md 8.3, 8.4; _spec/PLACES.md 2.1): one place's PROPS, the rigid things squishies meet, built from a PlaceDef for the
// layout in use. It ships in the LIFE CHUNK (D-69): only the shell's life host imports it; softbody.ts (first load) knows a world through PropWorldLike and the
// packed PropSolve it exposes as `solve`. Pure: no DOM, no three, no clock, no Math.random; zero allocation after construction (beginFrame, endFrame, raycast,
// poke, drainStrikes, stateHash); deterministic.
//
// THE PROP ORDER (PropWorldLike.count; D-64): every prop of things[0] (its parts in ThingDef order), then things[1], ..., and the layout's walls LAST. A thing of
// mechanism 0 (a patch or zone thing: the Snooze Rug) has no prop. propThing[k] = its PlaceDef.things index (-1 for a wall), propPart[k] = its part (the wall's
// index for a wall). Parts per mechanism (built now: S0 and S1, plus the chime for PH-23):
//   block   (M1)  1 box: size = half sizes [hx, hy, hz], standing on the floor (centre y = hy), turned by yaw. The Singing Kettle adds part 1: a static sphere
//                 of p.kettleR on its top (PLACES 4.2: "a block and a static sphere").
//   bar     (M2)  1 capsule: size [r, TOTAL length], lying along local x at y = r (p.standing: upright, centre y = length / 2).
//   mound   (M3)  1 sphere: size [r, top above ground]: centre y = top - r (below the floor).
//   ring    (M4)  p.segments capsules (default 6) on the circle size[0], segment radius size[1], gap size[2] degrees centred on yaw (yaw = the gap's direction):
//                 each segment the chord between its arc points with both caps (total length = chord + 2 r), lying on the floor (y = r).
//   seesaw  (M7)  1 box board (half sizes = size) on a HINGE about its local z axis through (x, p.pivot, z): the board's centre IS the pivot (the hinge at
//                 mid-thickness); I = p.inertia, damping p.damping /s, limit p.limit degrees. No floor contact (the floor rule keeps it clear, 8.4).
//   swing   (M8)  1 capsule seat (size [r, total length]) lying along local z, ACROSS its travel (as the render draws it), hung p.rope below a HINGE about local z
//                 through (x, p.pivotY, z): it swings along local x; the seat's own mass SWING_SEAT body masses (I = m rope^2, its gravity restores it).
//   chime   (M10) p.n parts (default 1) spaced over p.span along local x, each a capsule (r size[0], total length 2 size[1], hanging along y; p.box: a box of
//                 half sizes size) on its own HINGE about local x through the rail at CHIME_RAIL_Y (the render's 0.95 m), hanging p.hang below it; limit
//                 p.limit, damping p.damping. Strikable: a body or a poke strikes it (drainStrikes).
//   ball    (M13) 1 sphere, FREE (3 translations; the spin is a look: the pose's quaternion rolls without slipping): r size[0], mass p.mass body masses, roll
//                 damping p.rollDamp /s, at most BALL_VMAX m/s; it meets the floor (y = r), every other prop as a fixed obstacle, and its bounds (the layout's
//                 bounds shrunk by r; setBallBounds: Home's visible table, D-67).
//   walls          1 box each (the layout's walls: half sizes hx, WALL_H / 2, hz).
//   (S2, round 4: ramp, pad, floater and the Shake Pine's branch: see addThing. R6: a pad thing of p.n parts (Cloudloft's Puff Pads, part i at p.x<i>, p.z<i>), and
//   an ARCH bar (p.arch: Cloudloft's Sunbow Arch: part 0 the -x post, part 1 the +x post, part 2 the top bar).)
//   NOT BUILT (no prop, so they add nothing to the order): the turntable (M9; Lanternroof's Vane Disc is flush, top at y = 0, so it is floor until a motor or a gust
//   torque turns it: not built, D-96 names wind and the updraft as the only new physics). A flush pad or turntable touches nothing until it moves.
// THE POSE (8 floats per prop, `poses`, PG_RENDER's request): x, y, z of the PART'S CENTRE (the ball's centre, the board's centre on its pivot, the seat's centre,
// a chime's centre), its orientation quaternion (yaw, then the hinge angle), and the state (hinge angle in radians, ball speed in m/s, 0 static).
// THE PACKED DATA the bodies read (softbody.ts PropSolve, PS / PA): written by endFrame for the next frame; documented in softbody.ts next to PS.
// INTEGRATION (once per frame, endFrame, AFTER every body stepped; a one-frame lag, stable for damped 1-DOF hinges and one clamped ball): a hinge adds the
// bodies' angular impulse about its axis over (its own inertia + the riders' inertia the bodies reported), its own gravity torque (a swing seat or a chime),
// its damping, the clamp of its fastest point to MOVE_VMAX, then the limits (an inelastic stop: energy only decays); the ball adds the bodies' impulse / its
// mass, gravity and the floor, roll damping, the clamp, the obstacles and its bounds, and comes to rest under BALL_REST m/s.
import type { PropWorldLike } from '../contracts.ts';
import type { PlaceDef, ThingDef } from '../data/places.ts';
import { MECH, ZONE } from '../data/places.ts';
import { PA, PS, PG } from './softbody.ts';
import type { PropSolve, SoftBody } from './softbody.ts';
import { GRAVITY, H } from './params.ts';
import { FAMILY_REACT } from '../data/life.ts';

/** Tunables (PROBES may read them). */
export const PROPS = {
  WALL_H: 2.4,          // wall height (m; PLACES 4.2: 2.4 m log walls)
  SWING_SEAT: 0.5,      // a swing seat's own mass (body masses)
  CHIME_RAIL_Y: 0.95,   // a chime's rail (PG_RENDER: the chime and bell rails at y 0.95 m)
  CHIME_MASS: 0.15,     // a chime part's mass (body masses)
  MOVE_VMAX: 2.0,       // the fastest point of a hinge prop, and the ball (m/s; PLACES 2.1 M8 / M13)
  LIMIT_E: 0.1,         // restitution at a hinge limit
  BALL_E: 0.35,         // the ball's restitution against walls and props
  BALL_FLOOR_E: 0.3,    // ... and the floor
  BALL_REST: 0.03,      // the ball stops under this speed (m/s) when nothing pushed it this frame
  ROLL_FRICTION: 0.15,  // the ball's rolling friction on the floor (m/s^2)
  STRIKE_MIN: 0.004,    // a body's impulse on a strikable prop (body-mass m/s) that strikes it
  STRIKE_NORM: 0.08,    // ... and the impulse that maps to intensity 1
  STRIKE_GAP: 0.15,     // ... at most one strike per prop in this many seconds
  // D-95 (revised, the owner 2026-11-17): by default a pushed swing or rocker dies down by its own damping (round 5: a swing, empty or ridden, in about 2 to 3 swings: the data's 0.6 /s and RIDER_DRAG_BACK below). AUTO is the PLAYER'S toggle (setAuto): while
  // it is on the hinge keeps a gentle steady arc by itself, with or without riders; a hand on the prop (grabProp) or a held rider always wins
  AUTO_SWING_DEG: 10,   // the AUTO arc of a pendulum hinge (the swing), at its own pendulum frequency sqrt(m g l / I) (the seat's: sqrt(g / rope))
  AUTO_ROCK_DEG: 5,     // ... of a seesaw (no gravity of its own), at AUTO_ROCK_PERIOD
  AUTO_CHIME_DEG: 6,    // ... of a chime (a strikable hinge)
  AUTO_LIMIT_SHARE: 0.7, // ... never more than this share of the hinge's limit
  AUTO_ROCK_PERIOD: 2.8, // s: a seesaw's AUTO period
  AUTO_HELD_S: 0.25,    // s: a held body that touched the prop counts as holding it this long after its last touch
  AUTO_AMP_RATE: 6,     // deg/s: the arc grows (from rest) or shrinks (after a big push) to its size at this rate: AUTO's ease in (10 deg from rest in 1.7 s)
  AUTO_RIDER_S: 0.5,    // s: AUTO's pace follows the riders' pendulum smoothed over this
  AUTO_SEAT_W: 0.1,     // the empty seat's own pendulum weighs in at this share beside the riders' (so the pace is continuous as a rider gets on or off)
  // D-95 (revised, round 5: "a pushed swing, EMPTY OR RIDDEN, dies down in about 2 to 3 swings"). The empty seat does that by the data's damping (the
  // Pillow Swing's 0.6 /s; a pendulum seat's damping is a torque on its OWN inertia, so riders dilute it). A rider drained a FREE swing much faster: a soft
  // body's drag (params.ts `drag`, lerp(2.0, 1.0, bounce) /s on its WHOLE velocity, the damper of a body bobbing on its glued foot) brakes it in world space,
  // so 27 deg fell to 12 in one half swing and the swing was dead in one. While a pendulum seat swings free with riders (AUTO off, no hand, no held rider) it
  // gives back the drag of the least-damped body (1.0 /s, bounce 1) for the riders' share of its inertia: every rider keeps a net drag of 0 to 1 /s of its own
  // (never a gain), and the riders hold on (the ropes, S[34]) meanwhile.
  RIDER_DRAG_BACK: 1.0, // 1/s x (the riders' inertia / the whole inertia)
  // ... the riders' hold on the ropes fades with the swing: its share is (the seat's recent top angular speed - W0) / WR, clamped to 0..1, the top speed held with
  // a TAU s decay (the hold acts on the rider alone, so a hold kept on in a dying swing fed energy back into it: a jelly rider's seat rocked on at 5.5 deg for 7 s, another
  // still at 0.13 rad/s 9 s after AUTO went off; at 0.15 / 0.25 one jelly still plateaued; 0.25 / 0.15 keeps every family on its seat, scratch sw/score.sh)
  RIDER_HOLD_W0: 0.25, RIDER_HOLD_WR: 0.15, RIDER_HOLD_TAU: 1.5,   // rad/s, rad/s, s: full hold from about 8 deg of arc, none under about 5
  HAND_TAU: 0.08,       // s: a hand on a hinge prop (grabProp) turns it toward the hand's angle with this time constant
  HAND_SMOOTH: 0.05,    // s: ... and its angular velocity follows that wish over this (a heavy rider does not make the hand jerk)
  RIDER_TAU: 0.1,       // s: a seat or board a HELD rider sits on turns with the rider (its centre's angular velocity about the axis) with this time constant
  WATER_DRAG: 2.5,      // /s: a floating body's drag toward the water's velocity (PLACES 2.2); a sitter's horizontal drag is this x its submerged share
  PAD_LAND: 0.3,        // m/s: a landing on a pad this fast or faster is kicked
  PAD_LOOK_S: 0.2,      // s: a kicked pad's top rises and falls back over this (the pose's state: a look)
  PAD_SUBS: 45,         // substeps the glue and peel stay suspended after a kick (a hop's 10 left a sticky body, squashed flat by its 0.4 s hold, in the tack layer: it rose 1 cm)
  RAIL_R: 0.03,         // m: a ramp's side rails (the render's 0.03 cylinders)
  BRANCH_HZ: 2,         // a Shake Pine's branch springs back at this frequency (its 'gravity' term is a spring: -k sin(angle))
  // ---- R6 (round 6, D-96; R6_PHYS.md): the surface under each body, the surf's waves, wind gusts, the updraft and the bounds guard. All of it here, in the props
  // chunk, written into the bodies once a frame (zoneStep): softbody.ts's first-load cap is full, so the solver reads its own tableMu, glue, groundDamp and dragF
  // as before and this world sets them (a body leaving the world gets its own values back bit for bit)
  ICE_MU: 0.3,          // an ICE patch: a body's table friction there is ICE_MU x its family's ice grip (PLACES 2.4 ranks the glide by ice grip). PLACES 2.4's own arithmetic
                        // (tableMu x ice grip: firm silicone 0.18) glides at most 0.23 m from LIFE's 0.8 m/s nudge, under LIFE's GLIDE threshold of 0.5 m (R6_PHYS 1)
  WET_GRIP: 0.8,        // a wet zone (Rainleaf's rain in its shower, the Drip Leaf's drip): grip x this, but sticky stretch and slime keep theirs (PLACES 2.2)
  MODS_TAU: 0.1,        // s: the surface modifiers ease with this time constant (95 % of a change in 0.3 s; PLAYGROUND_BUILD 8.1)
  SURF_LIVE: false,     // the LIVE places (Home, Hearthlog Cabin) keep the published floor: their ground and patch modifiers and the bounds guard are not applied (true: they are)
  WIND_ACC: 1.2,        // m/s^2: a gust's push at catch 1 and strength 1 (PLACES 2.2), on an airborne or floating body only, never on a held one
  GUST_EASE: 0.3,       // s: a gust's push ramps in and out over this
  UPDRAFT_K: 0.4,       // an airborne body inside an updraft column falls with gravity x (1 - UPDRAFT_K x catch x strength) (PLACES 2.2: a marshmallow at 0.6 g)
  BALL_CATCH: 0.8,      // ... and a ball with it at this catch, or its data's p.updraftCatch (the Cloud Ball "falls slowly too", PLACES 4.10)
  WAVE_RISE: 1.6, WAVE_HOLD: 0.6, WAVE_FALL: 2.8,   // s: a wave's rise, its hold at the top, its fall (PLACES 4.3: the surf's 0.06 m rising to 0.12 m every 7 to 10 s)
  WAVE_V: 0.12,         // m/s: the wave's water runs toward the shore as it rises (back at 0.6 x as it falls): it carries floating bodies (their drag toward the water) only
  WEATHER_KICK: 0.5,    // rad/s at strength 1: a gust's sway of the chimes in its zone (and a wave's of one shell); one of them rings (a strike of cause 2: a sound, never USE)
  GUARD_E: 0.35,        // the bounds guard (R6 4): past the play area's limit an airborne body's outward speed is reflected with this restitution
  GUARD_REST_S: 1.0,    // ... and a body resting outside an UNWALLED play area this long is carried back in (carryTo, GUARD_CARRY_S)
  GUARD_CARRY_S: 1.2,
};
const JOINT_STATIC = 0, JOINT_HINGE = 1, JOINT_BALL = 2, JOINT_BOB = 3, JOINT_PAD = 4;   // (3: a floater's kinematic bob on slider1; 4: a flush pad, its kick a look)
/** S2 zones, packed per zone (ZS floats): [0] kind (ZONE id), [1] shape (0 disc, 1 box), [2] x, [3] z, [4] r or hx, [5] hz, [6] cos yaw, [7] sin yaw,
 *  [8] surfaceY (water), [9] the edge's depth ramp (m), [10] [11] flow (a disc: tangential, radial; a box: vx, vz; m/s), [12] strength. */
const ZS = 13;
/** Per tracked body (BS floats): [0] its centre's vertical speed last frame, [1] airborne last frame (0 / 1), [2] pad bounces in a row, [3] a pad kick's hold left (s),
 *  [4] that kick's speed, [5] the pad it is on (-1), [6] seconds at rest on a pad, [7] seconds since the landing that armed the kick. */
const BS = 10;   // ([8] [9]: its centre's x and z last frame: a LIFE scoot glides by translation, so the trunk bump of a Shake Pine is measured from the centre's travel)
const KIND_SPHERE = 1, KIND_CAPSULE = 2, KIND_BOX = 3;
const MAX_STRIKES = 32;
/** R6: per zone (ZX floats) the weather: [0] [1] a gust's every-s range, [2] its length (s), [3] the next gust's start, [4] the current gust's end (world time, s), [5] the
 *  gust's level 0..1 (eased), [6] 1 = driven by setGust (the shell, from LIFE's gust clock), [7] the driven state, [8] a wave's amplitude (m), [9] [10] its every-s range,
 *  [11] the next wave's start, [12] the wave's level 0..1, [13] the wave water's speed toward the shore now (m/s, signed), [14] waves so far, [15] [16] a shower envelope's
 *  on / off s, [17] [18] the wind's direction (x, z), [19] [20] the shore's direction (x, z), [21] gusts so far, [22] the current wave's start. */
const ZX = 23;
/** R6: per ground patch (PT floats): [0] shape (0 disc, 1 box), [1] x, [2] z, [3] r or hx, [4] hz, [5] cos yaw, [6] sin yaw, [7..10] grip, glue, peel, drag (NaN = the
 *  ground's), [11] 1 = ice (grip = ICE_MU x the family's ice grip, absolute). */
const PT = 12;
/** R6: per tracked body (BF floats): [0] its own tableMu, [1] glue, [2] groundDamp, [3] dragF (as built; given back bit for bit), [4..7] the eased grip, glue, peel and drag
 *  multipliers, [8] 1 while this world has written them, [9] seconds at rest outside the play area (the guard), [10] its own drag (1/s), [11] the density last seen awake. */
const BF = 12;
/** R6: what buildPropWorld hands the world besides the props: the surface, the weather and the guard (all optional: a world built without it behaves as before). */
interface WorldExtras {
  ground: readonly [number, number, number, number];   // grip, glue, peel, drag (all 1: the published felt)
  patches: Float64Array; zx: Float64Array; surf: boolean;
  /** the guard: on, the play area's limits for a body's centre (+x, -x, +z, -z sides, world coordinates: the walls' inner faces where a side has a wall, else the
   *  bounds' edge + PG.boundsRim + 0.05), which sides have a wall (bits 1, 2, 4, 8), and the bounds (box: cx, cz, hx, hz, round; disc: cx, cz, r) */
  guard: boolean; lim: readonly [number, number, number, number]; walled: number;
}

/** One prop while the world is built (allocation is fine here: once per place and layout). */
interface PropBuild {
  thing: number; part: number; kind: number; joint: number; mu: number; capAxis: number; strike: boolean;
  c: [number, number, number]; yaw: number; h: [number, number, number];
  pivot?: [number, number, number]; axisLocal?: 0 | 2; inertia?: number; damping?: number; limitDeg?: number; mgl?: number; reach?: number;
  mass?: number; rollDamp?: number;
  tilt?: number;                       // a ramp: a turn about the part's local z after the yaw (rad; the render's rotZ(-angle))
  bob?: number; bobHz?: number;        // a floater (JOINT_BOB): its bob amplitude (m) and frequency
  pad?: [number, number, number, number, number];   // a pad (JOINT_PAD): gain, apex (m), max bounces, travel (m), r (m)
  shake?: number;                      // a Shake Pine's branch: the bump speed (m/s) of a body against its trunk (the previous prop) that shakes it
}

/** A place's props and zones (PropWorldLike) with the packed data the bodies solve against (`solve`). Build it with buildPropWorld. */
export class PropWorld implements PropWorldLike {
  readonly count: number;
  readonly propThing: Int16Array;
  readonly propPart: Uint8Array;
  readonly poses: Float32Array;
  readonly zoneCount: number;
  readonly zoneOn: Uint8Array;
  /** The packed shapes and accumulators (softbody.ts PropSolve): what SoftBody.setPropWorld reads. */
  readonly solve: PropSolve;
  // per prop configuration
  private readonly kind: Uint8Array; private readonly joint: Uint8Array; private readonly parked: Uint8Array; private readonly strikable: Uint8Array;
  private readonly base: Float64Array;   // per prop 16: rest centre (3), yaw quaternion (4: x y z w), pivot (3), local hinge axis in world (3), spare (3)
  private readonly jp: Float64Array;     // per prop 8: inertia, damping, limit (rad), m g l (own gravity torque), reach (m), mass (ball), roll damping (ball), radius (ball)
  // per prop state
  private readonly st: Float64Array;     // per prop 12: hinge angle, angular velocity | ball x y z, vx vy vz, quaternion (4), speed
  private readonly motorOn: Uint8Array;
  private readonly strikeT: Float64Array;   // per prop: seconds until it may strike again
  private readonly riderI: Float64Array;    // per prop: the riders' inertia about its hinge in the last frame (a poke of a loaded seat or board turns it less)
  private readonly autoOn: Uint8Array;      // per prop: the player's AUTO toggle (setAuto; hinges only)
  private readonly au: Float64Array;        // per prop 5: the AUTO drive's share now (0..1), its arc's amplitude (rad) and phase (rad), the riders' sum m d and sum m d^2 (smoothed)
  private readonly hand: Uint8Array;        // per prop: 1 while a hand holds it (grabProp .. releaseProp; hinges only)
  private readonly heldT: Float64Array;     // per prop: seconds left in which a held body touched it (AUTO yields meanwhile)
  private readonly freeRide: Float64Array;  // per prop: a pendulum seat swinging free with riders: its recent top angular speed (RIDER_HOLD_*; 0 = not free and ridden)
  private readonly rideHold: Float64Array;  // per prop: ... and its riders' hold share now (S[34])
  private readonly handP: Float64Array;     // per prop 6: the grabbed spot relative to the pivot at hinge angle 0, and the hand's point (world)
  // the ball's bounds: shape 0 disc (cx, cz, r), 1 rounded rectangle (cx, cz, hx, hz, round), shrunk by each ball's radius when used
  private readonly bounds = new Float64Array(6);
  /** Round 5 (FIX5_DATA, VERDICT_PG B5): per prop, 1 while a ball still rests where it was built (its Home spot, or that spot pushed into its bounds)
   *  and nothing but its bounds has moved it; a body's push, a poke or a speed of its own clear it. setBallBounds re-places such a ball at its spot
   *  pushed into the NEW bounds, so a party change that widens the visible table gives the untouched ball its spot back (it was held at the
   *  one-out bounds' edge); a ball anyone has played with stays where it rolled. */
  private readonly ballPin: Uint8Array;
  private boundsShape = 0;
  // strikes waiting for drainStrikes: quads [prop, intensity, cause, slot]
  private readonly strikes = new Float32Array(MAX_STRIKES * 4);
  private nStrikes = 0;
  // the last raycast (poke's lever point)
  private rayProp = -1; private readonly rayP = new Float64Array(3);
  private readonly sc = new Float64Array(16);   // scratch (no allocation per call)
  private readonly things: Int16Array;          // per thing: its first prop (-1 none) and its prop count (2 per thing; the count starts at 0)
  // ---- S2: zone physics and pads, applied once a frame (beginFrame) to the bodies bound to this world (SoftBody.setPropWorld tracks them: trk)
  private readonly zf: Float64Array;            // the zones, packed (ZS)
  private readonly phys: boolean;               // a water zone or a pad exists (otherwise beginFrame does nothing more than before)
  private bodies: SoftBody[] = [];              // tracked bodies (allocated only when one binds or unbinds)
  private bst = new Float64Array(0);           // per tracked body (BS)
  private readonly nv = { x: 0, y: 0, z: 0 };   // the impulse handed to SoftBody.nudge (one object, reused)
  // ---- R6: the surface (ground, patches, wet zones), the weather (gusts, the updraft, waves) and the bounds guard (WorldExtras)
  private readonly gnd = new Float64Array(4);
  private readonly pt: Float64Array; private readonly npt: number;
  private readonly zx: Float64Array;
  private readonly surf: boolean; private readonly guard: boolean; private readonly walled: number;
  private readonly lim = new Float64Array(4);
  private readonly weather: boolean;             // a wind or an updraft zone exists
  private readonly waves: boolean;               // a water zone with a wave exists
  private readonly gq = new Float64Array(4);    // the guard's scratch (no doubles passed or returned)
  private tw = 0;                               // the world's own clock (s: the sum of endFrame's steps from the build, i.e. from the arrival)
  private bsf = new Float64Array(0);            // per tracked body (BF)
  private bmods: Float64Array[] = [];           // per tracked body: the shell's 8 modifiers (mods())

  constructor(parts: readonly PropBuild[], nThings: number, zones: number, bounds: { shape: number; v: readonly number[] }, parkAll: boolean, zoneData?: Float64Array, ex?: WorldExtras) {
    const n = parts.length;
    this.count = n;
    this.propThing = new Int16Array(n); this.propPart = new Uint8Array(n);
    this.poses = new Float32Array(n * 8);
    this.zoneCount = zones; this.zoneOn = new Uint8Array(zones).fill(1);
    this.solve = { count: n, S: new Float64Array(n * PS), A: new Float64Array(n * PA) };
    this.kind = new Uint8Array(n); this.joint = new Uint8Array(n); this.parked = new Uint8Array(n); this.strikable = new Uint8Array(n);
    this.ballPin = new Uint8Array(n);
    this.base = new Float64Array(n * 16); this.jp = new Float64Array(n * 8); this.st = new Float64Array(n * 12); this.motorOn = new Uint8Array(n); this.strikeT = new Float64Array(n); this.riderI = new Float64Array(n);
    this.autoOn = new Uint8Array(n); this.au = new Float64Array(n * 5); this.hand = new Uint8Array(n); this.heldT = new Float64Array(n); this.handP = new Float64Array(n * 6); this.freeRide = new Float64Array(n); this.rideHold = new Float64Array(n);
    this.things = new Int16Array(nThings * 2);   // [first prop, prop count] per thing: first -1 until it has one, count from 0
    for (let t = 0; t < nThings; t++) this.things[t * 2] = -1;   // (round 3 filled BOTH with -1 and counted from -1: setParked missed a thing's last prop, so a one-part thing never changed)
    this.boundsShape = bounds.shape; for (let i = 0; i < bounds.v.length && i < 6; i++) this.bounds[i] = bounds.v[i];
    this.zf = zoneData && zoneData.length === zones * ZS ? zoneData : new Float64Array(zones * ZS);
    let ph = false;
    for (let z = 0; z < zones; z++) if (this.zf[z * ZS] === ZONE.water) ph = true;
    for (let k = 0; k < n; k++) if (parts[k].joint === JOINT_PAD || parts[k].shake) ph = true;
    // R6: the surface, the weather and the guard (absent: none of it, as before)
    this.gnd.fill(1);
    if (ex) for (let i = 0; i < 4; i++) this.gnd[i] = ex.ground[i] > 0 ? ex.ground[i] : 1;
    this.pt = ex ? ex.patches : new Float64Array(0); this.npt = (this.pt.length / PT) | 0;
    this.zx = ex && ex.zx.length === zones * ZX ? ex.zx : new Float64Array(zones * ZX);
    this.surf = !!ex && ex.surf; this.guard = !!ex && ex.guard; this.walled = ex ? ex.walled : 0;
    if (ex) for (let i = 0; i < 4; i++) this.lim[i] = ex.lim[i];
    let wz = false, wv = false;
    for (let z = 0; z < zones; z++) { const kd = this.zf[z * ZS]; if (kd === ZONE.wind || kd === ZONE.updraft) wz = true; if (kd === ZONE.water && this.zx[z * ZX + 8] > 0) wv = true; }
    this.weather = wz; this.waves = wv;
    if (this.surf || this.guard || wz) ph = true;
    this.phys = ph;
    const S = this.solve.S;
    for (let k = 0; k < n; k++) {
      const b = parts[k], o = k * PS, B = k * 16, J = k * 8, T = k * 12;
      this.propThing[k] = b.thing; this.propPart[k] = b.part;
      if (b.thing >= 0) { if (this.things[b.thing * 2] < 0) this.things[b.thing * 2] = k; this.things[b.thing * 2 + 1]++; }
      this.kind[k] = b.kind; this.joint[k] = b.joint; this.strikable[k] = b.strike ? 1 : 0;
      this.parked[k] = parkAll && b.thing >= 0 ? 1 : 0;
      const hy = -Math.sin(b.yaw / 2), hw = Math.cos(b.yaw / 2);   // the yaw: Ry(-yaw), local x -> (cos yaw, 0, sin yaw) (the render's rotation.y = -yaw)
      this.base[B] = b.c[0]; this.base[B + 1] = b.c[1]; this.base[B + 2] = b.c[2];
      this.base[B + 3] = 0; this.base[B + 4] = hy; this.base[B + 5] = 0; this.base[B + 6] = hw;
      if (b.tilt) {   // a ramp: the yaw, then a turn about the part's local z (q_yaw x q_z: x = hy sz, y = cz hy, z = hw sz, w = hw cz)
        const sz = Math.sin(b.tilt / 2), cz = Math.cos(b.tilt / 2);
        this.base[B + 3] = hy * sz; this.base[B + 4] = cz * hy; this.base[B + 5] = hw * sz; this.base[B + 6] = hw * cz;
      }
      S[o + 2] = b.mu; S[o + 3] = b.capAxis; S[o + 16] = b.h[0]; S[o + 17] = b.h[1]; S[o + 18] = b.h[2];
      S[o + 28] = b.kind === KIND_SPHERE ? b.h[0] : b.kind === KIND_CAPSULE ? b.h[0] + b.h[1] : Math.sqrt(b.h[0] * b.h[0] + b.h[1] * b.h[1] + b.h[2] * b.h[2]);
      S[o + 30] = b.joint === JOINT_STATIC ? 1 : 0;
      if (b.joint === JOINT_HINGE) {
        const pv = b.pivot!;
        this.base[B + 7] = pv[0]; this.base[B + 8] = pv[1]; this.base[B + 9] = pv[2];
        // the hinge axis: the part's local x or z turned by the yaw
        const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
        if (b.axisLocal === 0) { this.base[B + 10] = cy; this.base[B + 11] = 0; this.base[B + 12] = sy; } else { this.base[B + 10] = -sy; this.base[B + 11] = 0; this.base[B + 12] = cy; }
        this.jp[J] = b.inertia ?? 0.5; this.jp[J + 1] = b.damping ?? 0.5; this.jp[J + 2] = ((b.limitDeg ?? 10) * Math.PI) / 180; this.jp[J + 3] = b.mgl ?? 0; this.jp[J + 4] = b.reach ?? 1;
        this.jp[J + 5] = b.shake ?? 0;   // (a Shake Pine's branch: its trunk's bump speed)
      } else if (b.joint === JOINT_BALL) {
        this.jp[J + 5] = b.mass ?? 0.2; this.jp[J + 6] = b.rollDamp ?? 0.6; this.jp[J + 7] = b.h[0]; this.jp[J] = b.inertia ?? PROPS.BALL_CATCH;   // ([0]: R6, a ball's updraft catch: the data's p.updraftCatch)
        this.st[T] = b.c[0]; this.st[T + 1] = b.c[1]; this.st[T + 2] = b.c[2]; this.st[T + 9] = 1;   // (quaternion identity: x y z w at T+6..9)
        this.ballPin[k] = 1;
      } else if (b.joint === JOINT_BOB) {
        this.jp[J] = b.bob ?? 0; this.jp[J + 1] = b.bobHz ?? 0;
      } else if (b.joint === JOINT_PAD) {
        const pd = b.pad!; this.jp[J] = pd[0]; this.jp[J + 1] = pd[1]; this.jp[J + 2] = pd[2]; this.jp[J + 3] = pd[3]; this.jp[J + 4] = pd[4];
        this.st[T + 1] = 1e9;   // (seconds since its last kick)
        S[o + 30] = 1;
      }
    }
    for (let k = 0; k < n; k++) this.writePose(k);
  }

  // ------------------------------------------------------------------ PropWorldLike

  beginFrame(): void { this.solve.A.fill(0); if (this.phys && this.bodies.length > 0) this.zoneStep(); }

  /** SoftBody.setPropWorld calls this as a body binds (on) or leaves (off): the bodies the zones and pads act on. Allocates (a bind is not per frame). */
  trk(b: SoftBody, on: boolean): void {
    const i = this.bodies.indexOf(b);
    if (on && i < 0) {
      this.bodies.push(b);
      const nb = new Float64Array(this.bodies.length * BS); nb.set(this.bst.subarray(0, Math.min(this.bst.length, nb.length)));
      const o = (this.bodies.length - 1) * BS; nb[o + 5] = -1; nb[o + 8] = NaN; this.bst = nb;
      // R6: the body's own surface values (given back when it leaves), the eased multipliers at 1, and the shell's modifiers (its family's dry density in [4])
      const nf = new Float64Array(this.bodies.length * BF); nf.set(this.bsf.subarray(0, Math.min(this.bsf.length, nf.length)));
      const f = (this.bodies.length - 1) * BF, bp = b as unknown as { p: { tableMu: number; glue: number; groundDamp: number; drag: number }; dragF: number };
      nf[f] = bp.p.tableMu; nf[f + 1] = bp.p.glue; nf[f + 2] = bp.p.groundDamp; nf[f + 3] = bp.dragF; nf[f + 4] = 1; nf[f + 5] = 1; nf[f + 6] = 1; nf[f + 7] = 1; nf[f + 10] = bp.p.drag;
      this.bsf = nf;
      const m = new Float64Array(8).fill(1); m[7] = 0;
      const fr = (FAMILY_REACT as Record<string, { density: number } | undefined>)[b.family], own = (b as unknown as { mods?: Float64Array }).mods;
      m[4] = own !== undefined && own.length > 4 ? own[4] : fr !== undefined ? fr.density : 1;
      nf[f + 11] = m[4];
      this.bmods.push(m);
    } else if (!on && i >= 0) {
      this.surfRestore(i);
      this.bodies.splice(i, 1);
      const nb = new Float64Array(this.bodies.length * BS);
      nb.set(this.bst.subarray(0, i * BS)); nb.set(this.bst.subarray((i + 1) * BS), i * BS); this.bst = nb;
      const nf = new Float64Array(this.bodies.length * BF);
      nf.set(this.bsf.subarray(0, i * BF)); nf.set(this.bsf.subarray((i + 1) * BF), i * BF); this.bsf = nf;
      this.bmods.splice(i, 1);
      b.metrics.submerged = 0;
    }
  }
  /** R6: give tracked body i its own surface values back (exactly as built), if this world wrote them. */
  private surfRestore(i: number): void {
    const f = i * BF, F = this.bsf;
    if (F[f + 8] !== 1) return;
    const bp = this.bodies[i] as unknown as { p: { tableMu: number; glue: number; groundDamp: number }; dragF: number };
    bp.p.tableMu = F[f]; bp.p.glue = F[f + 1]; bp.p.groundDamp = F[f + 2]; bp.dragF = F[f + 3];
    F[f + 4] = 1; F[f + 5] = 1; F[f + 6] = 1; F[f + 7] = 1; F[f + 8] = 0;
  }
  /**
   * R6: the shell's per-body modifiers (PLAYGROUND_BUILD 8.1, E2: the seam SoftBodyLike.mods names, served by the world because softbody.ts's first-load cap is full):
   * 8 floats for a body bound to this world (null for another). Write them in place, at most 10 Hz; physics reads them every frame:
   *   [4] the body's density relative to water: its family's DRY density at the bind (FAMILY_REACT); the shell writes it for a soaking or drying foam, lerping to the
   *       soaked density by the soak look (a soaked slow-rise sits on the pool floor; its field catch follows the same lerp to catchSoaked). A sleeping body in a water
   *       zone wakes when it changes by more than 0.02 (8.1); elsewhere it applies at the next wake.
   *   [5] x the family's field catch (wind and updraft), [6] x its pad bounce gain, [0..3] x the surface's grip, glue, peel and drag (physics applies the place's
   *       ground, its patches and its wet zones ITSELF, from the PlaceDef: the shell does not need to write these), [7] reserved (0).
   */
  mods(b: object): Float64Array | null {
    const i = this.bodies.indexOf(b as SoftBody);
    return i >= 0 ? this.bmods[i] : null;
  }
  /** R6 readout (probes): tracked body b's eased surface multipliers now (grip, glue, peel, drag x its own) into out[0..3]; false if b is not tracked. */
  surfaceOf(b: object, out: Float64Array): boolean {
    const i = this.bodies.indexOf(b as SoftBody);
    if (i < 0) return false;
    for (let k = 0; k < 4; k++) out[k] = this.bsf[i * BF + 4 + k];
    return true;
  }
  /** R6: drive wind zone `zone`'s gust (the shell, from LIFE's gust clock: lifeGustOn, so the push, LIFE's "hold on" and the gust sound agree). The first call hands
   *  that zone from the world's own clock (every-s range and length from its data, on sim time from the arrival) to the caller for good. */
  setGust(zone: number, on: boolean): void {
    const z = Math.floor(zone);
    if (!(z >= 0 && z < this.zoneCount) || this.zf[z * ZS] !== ZONE.wind) return;
    const o = z * ZX;
    if (on && this.zx[o + 7] !== 1) { this.zx[o + 21]++; this.weatherHit(z, false); }
    this.zx[o + 6] = 1; this.zx[o + 7] = on ? 1 : 0;
  }
  /** R6 readouts: a wind zone's gust level 0..1 now, a wave zone's wave level 0..1 now (0 for another zone): for the render's streaks and surf lines and the sound. */
  gustLevel(zone: number): number { const z = Math.floor(zone); return z >= 0 && z < this.zoneCount ? this.zx[z * ZX + 5] : 0; }
  waveLevel(zone: number): number { const z = Math.floor(zone); return z >= 0 && z < this.zoneCount ? this.zx[z * ZX + 12] : 0; }
  /** R6: the world's clock (s since it was built: the arrival), on which its gusts, waves and shower envelopes run. */
  get time(): number { return this.tw; }
  /** The bodies bound to this world (harness readout). */
  get tracked(): number { return this.bodies.length; }

  /**
   * S2 ZONE PHYSICS AND PADS (PLACES 2.1 M6 / M11, 2.2; PLAYGROUND_BUILD 8.5), once a frame BEFORE the bodies step, from the life chunk (the physics first load is at
   * its 18 KB cap): for every awake body bound to the world, by its centre and rest radius:
   *   WATER: the deepest water zone at the centre (its surface ramped up over the zone's edge ramp), f = the submerged share of the body's sphere
   *   (share(h, R) = h^2 (3R - h) / (4R^3)); density = SoftBody.mods[4] when the shell writes it, else the family's dry density (FAMILY_REACT). The body FLOATS
   *   when the share at rest on the floor there exceeds its density (PLACES 2.5's generated table): it gets gravity x f / density back (an impulse of g f / rho x dt
   *   a frame: g_eff = g (1 - f / rho), so it rises until f = rho) and the water's drag (WATER_DRAG /s, all axes) toward the water's velocity (a zone's flow, at
   *   most 0.15 m/s): it drifts with the current and never sleeps. Otherwise it is a SITTER (today's supported fade: it wades and may sleep) and gets only a
   *   horizontal drag of WATER_DRAG x f. metrics.submerged = f (0 outside water).
   *   PADS: a body whose centre is over a pad and that lands on it (airborne last frame, falling faster than PAD_LAND m/s) is kicked up at gain x the family's
   *   bounce gain x its landing speed, capped by the apex (sqrt(2 g apex)), after the family's sticky hold (FAMILY_REACT.padHoldS: sticky stretch 0.4 s, slime
   *   0.6 s); at most maxBounces kicks in a row (then it rests; the count restarts when it leaves the pad or rests 0.4 s); the kick suspends the glue like a
   *   hop (hop's own cap does not apply); the pad strikes (cause 1, the body's contactSlot) and its top rises `travel` and back (the pose's state) as a look.
   * Every force is a SoftBody.nudge (a velocity change of the whole body: no deformation); nothing allocates.
   */
  private zoneStep(): void {
    const h = this.hNow, Z = this.zf, nz = this.zoneCount, st = this.st, nv = this.nv;
    const ZXa = this.zx;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i], q = i * BS, bs = this.bst, M = this.bmods[i], fq = i * BF;
      if (b.sleeping) {
        bs[q] = 0; bs[q + 1] = 0; bs[q + 8] = NaN;
        // (R6, PLAYGROUND_BUILD 8.1: a sleeper in water wakes when the shell's density for it changes by more than 0.02: a drying foam floats up again)
        const dd = M[4] - this.bsf[fq + 11];
        if ((b.metrics.submerged ?? 0) > 0 && (dd > 0.02 || dd < -0.02)) b.wake();
        continue;
      }
      const cx = b.center.x, cy = b.center.y, cz = b.center.z, R = b.restRadius, vc = b as unknown as { vcx: number; vcy: number; vcz: number; restCenterY: number; hopLeft: number; glueK: number; cyOn: boolean; moveOn: boolean };
      const vx = vc.vcx, vy = vc.vcy, vz = vc.vcz;
      let dvx = 0, dvy = 0, dvz = 0;
      const fr = (FAMILY_REACT as Record<string, { density: number; soakedDensity: number; catch: number; catchSoaked?: number } | undefined>)[b.family];
      const rho = Math.max(0.02, M[4] > 0 ? M[4] : fr !== undefined ? fr.density : 1);
      this.bsf[fq + 11] = M[4];
      // ---- water (R6: a wave lifts its zone's surface by amp x its level and runs its water toward the shore as it rises, back as it falls)
      let surf = 0, wvx = 0, wvz = 0;
      for (let z = 0; z < nz; z++) {
        const o = z * ZS;
        if (Z[o] !== ZONE.water || this.zoneOn[z] === 0) continue;
        const dx = cx - Z[o + 2], dz = cz - Z[o + 3];
        let din = 0;
        if (Z[o + 1] === 0) din = Z[o + 4] - Math.sqrt(dx * dx + dz * dz);
        else { const lx = dx * Z[o + 6] + dz * Z[o + 7], lz = -dx * Z[o + 7] + dz * Z[o + 6]; din = Math.min(Z[o + 4] - Math.abs(lx), Z[o + 5] - Math.abs(lz)); }
        if (!(din > 0)) continue;
        const x = z * ZX, rp = Z[o + 9] > 0 ? Math.min(1, din / Z[o + 9]) : 1, ramp = rp * rp * (3 - 2 * rp), sy = (Z[o + 8] + ZXa[x + 8] * ZXa[x + 12]) * ramp;
        if (sy <= surf) continue;
        surf = sy;
        if (Z[o + 1] === 0) {   // a disc's flow: [tangential, radial]
          const d = Math.sqrt(dx * dx + dz * dz) || 1, ux = dx / d, uz = dz / d;
          wvx = (-uz * Z[o + 10] + ux * Z[o + 11]) * ramp; wvz = (ux * Z[o + 10] + uz * Z[o + 11]) * ramp;
        } else { wvx = Z[o + 10] * ramp; wvz = Z[o + 11] * ramp; }
        wvx += ZXa[x + 19] * ZXa[x + 13] * ramp; wvz += ZXa[x + 20] * ZXa[x + 13] * ramp;
      }
      let f = 0, flo = false;
      if (surf > 0) {
        // (the sphere's bottom is where the body's own bottom is: its centre less its rest centre height, so a body resting on the floor has h = the depth, as in
        // PLACES 2.5's table; a dollop is wider than tall, so cy - R would put it deeper)
        const hh = Math.min(2 * R, Math.max(0, surf - (cy - vc.restCenterY))), hr = Math.min(2 * R, surf), r3 = 4 * R * R * R;
        f = (hh * hh * (3 * R - hh)) / r3;
        const fRest = (hr * hr * (3 * R - hr)) / r3;
        if (fRest > rho) {
          flo = true;
          const k = 1 - Math.exp(-PROPS.WATER_DRAG * h);
          vc.hopLeft = PG.hopSubs; vc.glueK = 0;   // (afloat: the table's tack and the support's fade of gravity let go, as for a hop: the water carries it)
          dvy += GRAVITY * (f / rho) * h;
          dvx -= (vx - wvx) * k; dvy -= vy * k; dvz -= (vz - wvz) * k;
        } else if (f > 0) {
          const k = 1 - Math.exp(-PROPS.WATER_DRAG * f * h);
          dvx -= vx * k; dvz -= vz * k;
        }
      }
      b.metrics.submerged = f;
      // ---- R6: the surface under it (the place's ground, the patch at its centre, a wet zone), eased into its own friction, tack, peel damping and air drag
      if (this.surf) this.surfStep(i);
      // ---- R6: wind gusts and the updraft push an AIRBORNE or FLOATING body only, never a held one (PLACES 2.2, PLAYGROUND_BUILD 8.5); by its field catch (the
      // family's, a soaking foam's lerped toward its soaked catch by its density, x the shell's mods[5])
      const mt = b.metrics, held = mt.fingers > 0 || mt.grabbed || mt.carried === true || (mt.locked ?? 0) > 0 || vc.cyOn || vc.moveOn;
      const air = mt.airborne === true;
      if (this.weather && (air || flo) && !held) {
        let cat = fr !== undefined ? fr.catch : 0.3;
        if (fr !== undefined && fr.catchSoaked !== undefined && fr.soakedDensity > fr.density) {
          const s = (rho - fr.density) / (fr.soakedDensity - fr.density);
          cat += (fr.catchSoaked - cat) * (s < 0 ? 0 : s > 1 ? 1 : s);
        }
        cat *= M[5];
        for (let z = 0; z < nz; z++) {
          const o = z * ZS, kd = Z[o];
          if ((kd !== ZONE.wind && kd !== ZONE.updraft) || this.zoneOn[z] === 0) continue;
          const lv = kd === ZONE.wind ? ZXa[z * ZX + 5] : 1;
          if (!(lv > 0)) continue;
          const dx = cx - Z[o + 2], dz = cz - Z[o + 3];
          const inside = Z[o + 1] === 0 ? dx * dx + dz * dz < Z[o + 4] * Z[o + 4]
            : Math.abs(dx * Z[o + 6] + dz * Z[o + 7]) < Z[o + 4] && Math.abs(-dx * Z[o + 7] + dz * Z[o + 6]) < Z[o + 5];
          if (!inside) continue;
          if (kd === ZONE.wind) { const a = PROPS.WIND_ACC * cat * Z[o + 12] * lv * lv * (3 - 2 * lv) * h; dvx += ZXa[z * ZX + 17] * a; dvz += ZXa[z * ZX + 18] * a; }
          else if (air) dvy += GRAVITY * PROPS.UPDRAFT_K * cat * Z[o + 12] * h;
        }
      }
      // ---- a Shake Pine (S2): a body that meets its trunk faster than the pine's bump speed (by its centre's travel, a scoot included) shakes the branch
      for (let k = 1; k < this.count; k++) {
        const sk = this.jp[k * 8 + 5];
        if (!(sk > 0) || this.joint[k] !== JOINT_HINGE || this.parked[k] || this.strikeT[k] > 0 || bs[q + 8] !== bs[q + 8]) continue;
        const Bt = (k - 1) * 16, dx = this.base[Bt] - cx, dz = this.base[Bt + 2] - cz, d = Math.sqrt(dx * dx + dz * dz) || 1;
        if (d - this.solve.S[(k - 1) * PS + 16] - R > 0.06) continue;
        const ap = ((cx - bs[q + 8]) * dx + (cz - bs[q + 9]) * dz) / (d * h);
        if (ap > sk) { st[k * 12 + 1] += Math.min(3, 2 * ap); this.pushStrike(k, Math.min(1, ap), 1, b.contactSlot); }
      }
      // ---- pads
      let onPad = -1;
      for (let k = 0; k < this.count; k++) {
        if (this.joint[k] !== JOINT_PAD || this.parked[k]) continue;
        const B = k * 16, J = k * 8, dx = cx - this.base[B], dz = cz - this.base[B + 2], pr = this.jp[J + 4];
        if (dx * dx + dz * dz < pr * pr && cy - R < 0.4) { onPad = k; break; }
      }
      if (onPad < 0) { bs[q + 2] = 0; bs[q + 3] = 0; bs[q + 4] = 0; bs[q + 6] = 0; }
      else {
        const J = onPad * 8;
        if (!air && Math.abs(vy) < 0.1) { bs[q + 6] += h; if (bs[q + 6] >= 0.4) bs[q + 2] = 0; } else bs[q + 6] = 0;
        const vLand = bs[q] < vy ? -bs[q] : -vy;   // (the fall speed at the touch: this frame's or the last one's, whichever is faster)
        if (bs[q + 1] === 1 && !air && vLand > PROPS.PAD_LAND && bs[q + 2] < this.jp[J + 2] && bs[q + 4] === 0) {
          const fp = (FAMILY_REACT as Record<string, { bounceGain: number; padHoldS: number } | undefined>)[b.family];
          const vk = Math.min(this.jp[J] * (fp !== undefined ? fp.bounceGain : 1) * M[6] * vLand, Math.sqrt(2 * GRAVITY * this.jp[J + 1]));
          bs[q + 2]++; bs[q + 4] = vk; bs[q + 5] = onPad;
          bs[q + 3] = fp !== undefined && fp.padHoldS > 0 ? fp.padHoldS : h * 0.5;   // (no hold: this frame)
          bs[q + 7] = 0;
        }
      }
      if (bs[q + 4] > 0) {   // a kick pending: at the touch (the frame the landing is seen), or after a sticky family's hold
        // (waiting for the landing's squash to bottom out was tried: the body's own rebound then took the kick's place, and the bounces were lower: 15 cm for 24)
        bs[q + 3] -= h; bs[q + 7] += h;
        if (bs[q + 3] <= 0) {
          bs[q + 3] = 0;
          const k = bs[q + 5] | 0;
          if (k >= 0 && k === onPad && !b.metrics.grabbed && b.metrics.fingers === 0 && b.metrics.carried !== true) {
            vc.hopLeft = PROPS.PAD_SUBS; vc.glueK = 0;   // (the glue and the peel suspended as for a hop, longer: a body squashed flat on the pad leaves the tack layer later)
            const up = bs[q + 4] - vy;
            vc.vcy += up;   // (as hop() does: the peel damping and the goal's float read the centre's velocity in the next substep)
            dvy += up;
            st[k * 12 + 1] = 0;
            this.pushStrike(k, bs[q + 4] / Math.sqrt(2 * GRAVITY * this.jp[k * 8 + 1]), 1, b.contactSlot);
          }
          bs[q + 4] = 0;
        }
      }
      bs[q] = vy; bs[q + 1] = air ? 1 : 0; bs[q + 8] = cx; bs[q + 9] = cz;
      // ---- R6 (4): the bounds guard (the guard's scratch carries the centre's velocity with this frame's changes in, and takes the guard's own back)
      if (this.guard && !held) {
        const g = this.gq; g[0] = vx + dvx; g[1] = vz + dvz; g[2] = 0; g[3] = 0;
        this.guardStep(i, air);
        dvx += g[2]; dvz += g[3];
      }
      if (dvx * dvx + dvy * dvy + dvz * dvz > 1e-10) { nv.x = dvx; nv.y = dvy; nv.z = dvz; b.nudge(nv); }
    }
  }

  /**
   * R6 (1): THE SURFACE under tracked body i (PLACES 2.2 "Ground patches", 2.4; PLAYGROUND_BUILD 8.1), from the PlaceDef: the place's ground modifiers, replaced field
   * by field by those of the first patch that holds the body's centre (an ICE patch: the grip is absolute, ICE_MU x the family's ice grip, so the glide ranks by ice
   * grip), the grip x WET_GRIP in a wet zone that is on (a shower envelope in its on phase; sticky stretch and slime keep theirs), x the shell's mods[0..3]; eased
   * with MODS_TAU and written into the body's own table friction, tack layer, peel damping and air drag (the solver reads them every substep). Back to exactly 1:
   * the body's own values, bit for bit.
   */
  private surfStep(i: number): void {
    const b = this.bodies[i], F = this.bsf, f = i * BF, P = this.pt, M = this.bmods[i], cx = b.center.x, cz = b.center.z;
    let g0 = this.gnd[0], g1 = this.gnd[1], g2 = this.gnd[2], g3 = this.gnd[3];
    for (let k = 0; k < this.npt; k++) {
      const o = k * PT, dx = cx - P[o + 1], dz = cz - P[o + 2];
      const inside = P[o] === 0 ? dx * dx + dz * dz <= P[o + 3] * P[o + 3] : Math.abs(dx * P[o + 5] + dz * P[o + 6]) <= P[o + 3] && Math.abs(-dx * P[o + 6] + dz * P[o + 5]) <= P[o + 4];
      if (!inside) continue;
      if (P[o + 11] === 1) { const fi = (FAMILY_REACT as Record<string, { iceGrip: number } | undefined>)[b.family]; g0 = (PROPS.ICE_MU * (fi !== undefined ? fi.iceGrip : 1)) / (F[f] > 1e-6 ? F[f] : 1e-6); }
      else if (P[o + 7] === P[o + 7]) g0 = P[o + 7];
      if (P[o + 8] === P[o + 8]) g1 = P[o + 8];
      if (P[o + 9] === P[o + 9]) g2 = P[o + 9];
      if (P[o + 10] === P[o + 10]) g3 = P[o + 10];
      break;
    }
    if (b.family !== 'stickystretch' && b.family !== 'slimegoo') {
      const Z = this.zf, X = this.zx;
      for (let z = 0; z < this.zoneCount; z++) {
        const o = z * ZS;
        if (Z[o] !== ZONE.wet || this.zoneOn[z] === 0) continue;
        const x = z * ZX, cyc = X[x + 15] + X[x + 16];
        if (cyc > 0 && this.tw % cyc >= X[x + 15]) continue;   // (a shower envelope's off phase: Rainleaf's rain, 40 s on and 30 s off from the arrival)
        const dx = cx - Z[o + 2], dz = cz - Z[o + 3];
        const inside = Z[o + 1] === 0 ? dx * dx + dz * dz < Z[o + 4] * Z[o + 4] : Math.abs(dx * Z[o + 6] + dz * Z[o + 7]) < Z[o + 4] && Math.abs(-dx * Z[o + 7] + dz * Z[o + 6]) < Z[o + 5];
        if (inside) { g0 *= PROPS.WET_GRIP; break; }
      }
    }
    g0 *= M[0]; g1 *= M[1]; g2 *= M[2]; g3 *= M[3];
    const k = 1 - Math.exp(-this.hNow / PROPS.MODS_TAU);
    let e0 = F[f + 4] + (g0 - F[f + 4]) * k, e1 = F[f + 5] + (g1 - F[f + 5]) * k, e2 = F[f + 6] + (g2 - F[f + 6]) * k, e3 = F[f + 7] + (g3 - F[f + 7]) * k;
    if (Math.abs(g0 - e0) < 1e-4) e0 = g0; if (Math.abs(g1 - e1) < 1e-4) e1 = g1; if (Math.abs(g2 - e2) < 1e-4) e2 = g2; if (Math.abs(g3 - e3) < 1e-4) e3 = g3;
    if (e0 === 1 && e1 === 1 && e2 === 1 && e3 === 1) { this.surfRestore(i); return; }
    if (e0 === F[f + 4] && e1 === F[f + 5] && e2 === F[f + 6] && e3 === F[f + 7] && F[f + 8] === 1) return;   // (unchanged: nothing to write)
    F[f + 4] = e0; F[f + 5] = e1; F[f + 6] = e2; F[f + 7] = e3; F[f + 8] = 1;
    const bp = b as unknown as { p: { tableMu: number; glue: number; groundDamp: number }; dragF: number };
    bp.p.tableMu = F[f] * e0; bp.p.glue = F[f + 1] * e1; bp.p.groundDamp = F[f + 2] * e2; bp.dragF = e3 === 1 ? F[f + 3] : 1 - Math.exp(-F[f + 10] * e3 * H);
  }

  /**
   * R6 (4): THE BOUNDS GUARD (a toss never leaves the play area). The centre of a body nobody holds stays inside the play area's limits: on a side with a wall
   * beyond the bounds (Lanternroof's parapet, the cabin's logs) the wall's inner face less the body's radius, for a body that reaches above the wall (below its top the
   * wall's own collider holds it: nothing changes there); on an open side the bounds' edge + the corral's rim + 5 cm, at any height (the corral's rim bounce acts
   * there first; this is its backstop, e.g. for a body the corral is off for). Past a limit its outward speed is reflected (GUARD_E); a body RESTING past an open
   * side for GUARD_REST_S is carried back in (carryTo, to the nearest spot inside the bounds less its radius and 0.2 m). Reads gq[0..1] (the centre's velocity
   * with this frame's changes), adds its change into gq[2..3].
   */
  private guardStep(i: number, air: boolean): void {
    const b = this.bodies[i], L = this.lim, g = this.gq, R = b.restRadius, cx = b.center.x, cz = b.center.z, top = b.center.y + R > PROPS.WALL_H;
    let out = 0;
    for (let s = 0; s < 4; s++) {
      const wall = (this.walled >> s) & 1;
      if (wall === 1 && !top) continue;
      const sg = (s & 1) === 0 ? 1 : -1, over = ((s < 2 ? cx : cz) - (L[s] - (wall === 1 ? sg * R : 0))) * sg;
      if (!(over > 0)) continue;
      const vo = (s < 2 ? g[0] : g[1]) * sg;
      if (vo > 0) { const d = -(1 + PROPS.GUARD_E) * vo * sg; if (s < 2) g[2] += d; else g[3] += d; }
      if (wall === 0 && over > out) out = over;
    }
    const F = this.bsf, f = i * BF;
    if (out > 0.1 && !air && g[0] * g[0] + g[1] * g[1] < 0.01) {
      F[f + 9] += this.hNow;
      if (F[f + 9] >= PROPS.GUARD_REST_S) {
        F[f + 9] = 0;
        const B = this.bounds, ix = Math.max(0.05, B[2] - R - 0.2), iz = Math.max(0.05, B[3] - R - 0.2);
        const tx = cx < B[0] - ix ? B[0] - ix : cx > B[0] + ix ? B[0] + ix : cx, tz = cz < B[1] - iz ? B[1] - iz : cz > B[1] + iz ? B[1] + iz : cz;
        b.carryTo(tx, 0, tz, PROPS.GUARD_CARRY_S);
      }
    } else F[f + 9] = 0;
  }

  /** R6 (2, 3): the weather on the world's clock, once a frame (endFrame): each wind zone's gust level (its own schedule from the data, or setGust's), each wave
   *  zone's wave (its level and its water's speed toward the shore); a gust's start and every second wave's crest sway chimes and ring one (weatherHit). */
  private weatherStep(): void {
    const h = this.hNow, t = this.tw, X = this.zx;
    for (let z = 0; z < this.zoneCount; z++) {
      const o = z * ZX, kd = this.zf[z * ZS];
      if (kd === ZONE.wind && (X[o + 2] > 0 || X[o + 6] === 1)) {
        let want = 0;
        if (X[o + 6] === 1) want = X[o + 7];
        else {
          if (!(X[o + 3] > 0)) X[o + 3] = X[o] + (X[o + 1] - X[o]) * hash01(z, -1);
          if (t >= X[o + 3]) {
            X[o + 4] = X[o + 3] + X[o + 2];
            X[o + 3] += Math.max(X[o + 2] + 0.5, X[o] + (X[o + 1] - X[o]) * hash01(z, X[o + 21]));
            X[o + 21]++;
            this.weatherHit(z, false);
          }
          want = t < X[o + 4] ? 1 : 0;
        }
        const st = h / PROPS.GUST_EASE, lv = X[o + 5];
        X[o + 5] = want > lv ? Math.min(want, lv + st) : Math.max(want, lv - st);
      }
      if (kd === ZONE.water && X[o + 8] > 0) {
        if (!(X[o + 11] > 0)) X[o + 11] = X[o + 9] + (X[o + 10] - X[o + 9]) * hash01(z + 50, -1);
        if (t >= X[o + 11]) { X[o + 22] = X[o + 11]; X[o + 11] += Math.max(PROPS.WAVE_RISE + PROPS.WAVE_HOLD + PROPS.WAVE_FALL, X[o + 9] + (X[o + 10] - X[o + 9]) * hash01(z + 50, X[o + 14])); X[o + 14]++; }
        const u = t - X[o + 22], r = PROPS.WAVE_RISE, hd = PROPS.WAVE_HOLD, fl = PROPS.WAVE_FALL;
        let lv = 0, vs = 0;
        if (X[o + 14] > 0 && u >= 0 && u < r + hd + fl) {
          if (u < r) { const a = u / r; lv = a * a * (3 - 2 * a); vs = PROPS.WAVE_V * Math.sin(Math.PI * a); }
          else if (u < r + hd) { lv = 1; if (u - h < r && (X[o + 14] & 1) === 1) this.weatherHit(z, true); }
          else { const a = (u - r - hd) / fl; lv = 1 - a * a * (3 - 2 * a); vs = -0.6 * PROPS.WAVE_V * Math.sin(Math.PI * a); }
        }
        X[o + 12] = lv; X[o + 13] = vs;
      }
    }
  }
  /** R6: the weather's touch on the chimes (PLACES 4.3 "a wave's breeze rings one now and then", 4.4 "a wind gust rings them too", 4.8 "the lanterns sway"): a gust
   *  sways every chime hanging inside its zone along the wind and rings one of them; a wave's crest sways and rings one chime of the place. The ring is a strike of
   *  cause 2 (the weather: a sound, never a USE event, D-64). A Shake Pine's branch is not a chime. */
  private weatherHit(z: number, wave: boolean): void {
    const X = this.zx, Z = this.zf, o = z * ZS, x = z * ZX, s = Z[o + 12] > 0 ? Z[o + 12] : 1;
    let n = 0;
    for (let k = 0; k < this.count; k++) if (this.weatherChime(k, z, wave)) n++;
    if (n === 0) return;
    const pick = (X[x + (wave ? 14 : 21)] | 0) % n, dx = wave ? X[x + 19] : X[x + 17], dz = wave ? X[x + 20] : X[x + 18];
    for (let k = 0, c = 0; k < this.count; k++) {
      if (!this.weatherChime(k, z, wave)) continue;
      if (!wave || c === pick) {
        const B = k * 16, sw = PROPS.WEATHER_KICK * s * (dx * this.base[B + 12] - dz * this.base[B + 10]);   // (a push along (dx, dz) on a part hanging below its pivot, about the hinge axis)
        this.st[k * 12 + 1] += sw;
        if (c === pick) this.pushStrike(k, (wave ? 0.25 : 0.35) * s, 2, -1);
      }
      c++;
    }
  }
  private weatherChime(k: number, z: number, wave: boolean): boolean {
    if (this.strikable[k] === 0 || this.joint[k] !== JOINT_HINGE || this.parked[k] === 1 || this.jp[k * 8 + 5] > 0 || !(this.jp[k * 8 + 3] > 0)) return false;
    if (wave) return true;
    const Z = this.zf, o = z * ZS, B = k * 16, dx = this.base[B + 7] - Z[o + 2], dz = this.base[B + 9] - Z[o + 3];
    return Z[o + 1] === 0 ? dx * dx + dz * dz < Z[o + 4] * Z[o + 4] : Math.abs(dx * Z[o + 6] + dz * Z[o + 7]) < Z[o + 4] && Math.abs(-dx * Z[o + 7] + dz * Z[o + 6]) < Z[o + 5];
  }

  endFrame(dt: number): void {
    if (!(dt > 0)) return;   // (NaN, 0, negative: nothing)
    const h = Math.min(0.05, dt);
    this.hNow = h;   // (the steps read it here: a double passed to a call that is not inlined is boxed, one HeapNumber a call)
    this.tw += h;
    if (this.weather || this.waves) this.weatherStep();
    const A = this.solve.A;
    for (let k = 0; k < this.count; k++) {
      if (this.parked[k]) continue;
      const j = this.joint[k], a = k * PA;
      if (j === JOINT_HINGE) this.stepHinge(k);
      else if (j === JOINT_BOB) {   // a floater: a kinematic bob (offset, its speed, the phase)
        const T = k * 12, J = k * 8, w = 2 * Math.PI * this.jp[J + 1];
        let ph = this.st[T + 2] + w * h; if (ph > Math.PI) ph -= 2 * Math.PI;
        this.st[T + 2] = ph; this.st[T] = this.jp[J] * Math.sin(ph); this.st[T + 1] = this.jp[J] * w * Math.cos(ph);
      } else if (j === JOINT_PAD) this.st[k * 12 + 1] += h;
      else if (j === JOINT_BALL) {
        // THE BALL, written out here (a once-a-frame function of its own stayed unoptimised for minutes: 2 KB of boxed doubles a frame; in this loop it is compiled with it)
        const J = k * 8, T = k * 12, st = this.st;
        const m = this.jp[J + 5], r = this.jp[J + 7];
        const pushed = A[a] * A[a] + A[a + 1] * A[a + 1] + A[a + 2] * A[a + 2] > 1e-12;
        if (pushed) this.ballPin[k] = 0;
        st[T + 3] += A[a] / m; st[T + 4] += A[a + 1] / m; st[T + 5] += A[a + 2] / m;
        st[T + 4] -= GRAVITY * h;
        // (R6: a ball off the floor inside an updraft column falls slower too, by BALL_CATCH: the Cloud Ball, PLACES 4.10)
        if (this.weather && st[T + 1] > r + 0.02) {
          const Z = this.zf;
          for (let z = 0; z < this.zoneCount; z++) {
            const o = z * ZS;
            if (Z[o] !== ZONE.updraft || this.zoneOn[z] === 0) continue;
            const dx = st[T] - Z[o + 2], dz = st[T + 2] - Z[o + 3];
            if (Z[o + 1] === 0 ? dx * dx + dz * dz < Z[o + 4] * Z[o + 4] : Math.abs(dx * Z[o + 6] + dz * Z[o + 7]) < Z[o + 4] && Math.abs(-dx * Z[o + 7] + dz * Z[o + 6]) < Z[o + 5]) {
              st[T + 4] += GRAVITY * PROPS.UPDRAFT_K * this.jp[J] * Z[o + 12] * h; break;
            }
          }
        }
        // roll damping on the horizontal speed, and a little rolling friction on the floor (a felt or yarn ball stops: with the 0.5 /s damping alone 2 m/s took 8 s)
        const rd = Math.exp(-this.jp[J + 6] * h);
        st[T + 3] *= rd; st[T + 5] *= rd;
        if (st[T + 1] <= r + 1e-6) {
          const hs = Math.sqrt(st[T + 3] * st[T + 3] + st[T + 5] * st[T + 5]), dec = PROPS.ROLL_FRICTION * h;
          const kf = Math.max(0, hs - dec) / Math.max(hs, 1e-12);
          st[T + 3] *= kf; st[T + 5] *= kf;
        }
        this.clampBall(k);
        st[T] += st[T + 3] * h; st[T + 1] += st[T + 4] * h; st[T + 2] += st[T + 5] * h;
        // the floor
        if (st[T + 1] < r) { st[T + 1] = r; if (st[T + 4] < 0) { st[T + 4] = -PROPS.BALL_FLOOR_E * st[T + 4]; if (st[T + 4] < 0.2) st[T + 4] = 0; } }
        // every other shown prop is a fixed obstacle; then the bounds
        this.ballObstacles(k);
        {   // the ball's centre inside its bounds shrunk by its radius (a disc, or a rounded rectangle): pushed back, its outward speed reflected with BALL_E
          const b = this.bounds;
          const px = st[T] - b[0], pz = st[T + 2] - b[1];
          let nx = 0, nz = 0, over = 0;
          if (this.boundsShape === 0) {
            const R = b[2] - r, d = Math.sqrt(px * px + pz * pz);
            if (d > R && d > 1e-9) { nx = px / d; nz = pz / d; over = d - R; }
          } else {
            const rd = Math.max(0, b[4] - r), hx = b[2] - r - rd, hz = b[3] - r - rd;   // the inner rectangle and the corner radius left after the shrink
            const qx = Math.abs(px) - hx, qz = Math.abs(pz) - hz;
            if (qx > 0 && qz > 0) {
              const d = Math.sqrt(qx * qx + qz * qz);
              if (d > rd && d > 1e-9) { nx = (px < 0 ? -qx : qx) / d; nz = (pz < 0 ? -qz : qz) / d; over = d - rd; }
            } else if (qx > rd) { nx = px < 0 ? -1 : 1; over = qx - rd; } else if (qz > rd) { nz = pz < 0 ? -1 : 1; over = qz - rd; }
          }
          if (over > 0) {
            st[T] -= nx * over; st[T + 2] -= nz * over;
            const vn = st[T + 3] * nx + st[T + 5] * nz;
            if (vn > 0) { const k2 = (1 + PROPS.BALL_E) * vn; st[T + 3] -= k2 * nx; st[T + 5] -= k2 * nz; }
          }
  
        }
        // rest
        const sp2 = st[T + 3] * st[T + 3] + st[T + 4] * st[T + 4] + st[T + 5] * st[T + 5];
        if (!pushed && sp2 < PROPS.BALL_REST * PROPS.BALL_REST && st[T + 1] <= r + 1e-6) { st[T + 3] = 0; st[T + 4] = 0; st[T + 5] = 0; }
        // the roll (a look): w = (up x v) / r, integrated into the orientation quaternion
        const vx = st[T + 3], vz = st[T + 5];
        if (vx !== 0 || vz !== 0) {
          const wx = vz / r, wz = -vx / r, wl = Math.sqrt(wx * wx + wz * wz), ang = wl * h;
          const s2 = Math.sin(ang / 2) / wl, c2 = Math.cos(ang / 2), qx = wx * s2, qz = wz * s2;   // dq = (wx s, 0, wz s, c)
          const x = st[T + 6], y = st[T + 7], z = st[T + 8], w = st[T + 9];
          // q' = dq x q
          st[T + 6] = c2 * x + qx * w + (0 * z - qz * y); st[T + 7] = c2 * y + 0 * w + (qz * x - qx * z); st[T + 8] = c2 * z + qz * w + (qx * y - 0 * x); st[T + 9] = c2 * w - (qx * x + 0 * y + qz * z);
          const ql = Math.max(1e-12, Math.sqrt(st[T + 6] * st[T + 6] + st[T + 7] * st[T + 7] + st[T + 8] * st[T + 8] + st[T + 9] * st[T + 9]));
          st[T + 6] /= ql; st[T + 7] /= ql; st[T + 8] /= ql; st[T + 9] /= ql;
        }
        st[T + 10] = Math.sqrt(st[T + 3] * st[T + 3] + st[T + 4] * st[T + 4] + st[T + 5] * st[T + 5]);
      }
      // a strikable prop a body hit hard enough this frame (at most one strike per prop per STRIKE_GAP s: a body leaning on a chime does not ring it every frame)
      if (this.strikeT[k] > 0) this.strikeT[k] -= h;
      if (this.strikable[k] && A[a + 7] > PROPS.STRIKE_MIN && this.strikeT[k] <= 0) this.pushStrike(k, A[a + 7] / PROPS.STRIKE_NORM, 1, A[a + 8]);
      this.writePose(k);
    }
  }

  setZoneOn(zone: number, on: boolean): void {
    const z = Math.floor(zone);
    if (z >= 0 && z < this.zoneCount) this.zoneOn[z] = on ? 1 : 0;
  }
  /** Recorded for the S3 motor turntable; nothing in S0 / S1 has a motor. */
  setMotor(prop: number, on: boolean): void {
    const p = Math.floor(prop);
    if (p >= 0 && p < this.count) this.motorOn[p] = on ? 1 : 0;
  }

  /** Ray against the shown props (parked ones are skipped): the nearest prop index or -1. Remembers the hit point as poke's lever. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (!Number.isFinite(ox + oy + oz + dx + dy + dz)) return -1;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dl > 1e-12)) return -1;
    const ux = dx / dl, uy = dy / dl, uz = dz / dl, S = this.solve.S, sc = this.sc;
    let best = -1, bt = Infinity;
    for (let k = 0; k < this.count; k++) {
      if (this.parked[k] || this.kind[k] === 0) continue;
      const o = k * PS, kd = this.kind[k];
      // the ray from the prop's centre (local coordinates for a box)
      const rx = ox - S[o + 4], ry = oy - S[o + 5], rz = oz - S[o + 6];
      let t = Infinity;
      if (kd === KIND_SPHERE) t = raySphere(rx, ry, rz, ux, uy, uz, S[o + 16]);
      else if (kd === KIND_CAPSULE) {
        const ax = S[o + 3] | 0, ax0 = S[o + 7 + ax], ay0 = S[o + 10 + ax], az0 = S[o + 13 + ax], hl = S[o + 17], r = S[o + 16];
        t = rayCapsule(rx, ry, rz, ux, uy, uz, ax0, ay0, az0, hl, r);
      } else {
        // box: the ray in the box's frame (columns of R are its axes), then the slab test
        const lx = rx * S[o + 7] + ry * S[o + 10] + rz * S[o + 13], ly = rx * S[o + 8] + ry * S[o + 11] + rz * S[o + 14], lz = rx * S[o + 9] + ry * S[o + 12] + rz * S[o + 15];
        const vx = ux * S[o + 7] + uy * S[o + 10] + uz * S[o + 13], vy = ux * S[o + 8] + uy * S[o + 11] + uz * S[o + 14], vz = ux * S[o + 9] + uy * S[o + 12] + uz * S[o + 15];
        t = rayBox(lx, ly, lz, vx, vy, vz, S[o + 16], S[o + 17], S[o + 18]);
      }
      if (t < bt) { bt = t; best = k; }
    }
    this.rayProp = best;
    if (best >= 0) { this.rayP[0] = ox + ux * bt; this.rayP[1] = oy + uy * bt; this.rayP[2] = oz + uz * bt; }
    return best;
  }

  /** A player's tap or flick: a velocity change (m/s) of the point it hits (the last raycast's point on this prop, else its lever: a board's +x end, a seat's
   *  centre). A ball rolls (clamped to MOVE_VMAX), a hinge turns, a strikable prop strikes (cause 0). A static prop does not move. */
  poke(prop: number, ix: number, iy: number, iz: number): void {
    const k = Math.floor(prop);
    if (!(k >= 0 && k < this.count) || this.parked[k] || !Number.isFinite(ix + iy + iz)) return;
    const j = this.joint[k], T = k * 12, J = k * 8, B = k * 16;
    if (j === JOINT_BALL) {
      this.st[T + 3] += ix; this.st[T + 4] += iy; this.st[T + 5] += iz;
      this.ballPin[k] = 0;
      this.clampBall(k);
    } else if (j === JOINT_HINGE) {
      const S = this.solve.S, o = k * PS;
      let px: number, py: number, pz: number;
      if (this.rayProp === k) { px = this.rayP[0]; py = this.rayP[1]; pz = this.rayP[2]; }
      else if (this.kind[k] === KIND_BOX) { px = S[o + 4] + S[o + 7] * S[o + 16]; py = S[o + 5] + S[o + 10] * S[o + 16]; pz = S[o + 6] + S[o + 13] * S[o + 16]; }
      else { px = S[o + 4]; py = S[o + 5]; pz = S[o + 6]; }
      const ax = this.base[B + 10], ay = this.base[B + 11], az = this.base[B + 12];
      const rx = px - this.base[B + 7], ry = py - this.base[B + 8], rz = pz - this.base[B + 9], ra = rx * ax + ry * ay + rz * az;
      const r2 = rx * rx + ry * ry + rz * rz - ra * ra;
      if (r2 > 1e-6) {
        // the point's tangential velocity changes by the impulse's part along the tangent: dw = axis . (r x i) / |r_perp|^2
        // (a loaded hinge turns less: the riders' inertia of the last frame shares the push, as a hand pushing a swing with a child on it)
        const cx = ry * iz - rz * iy, cy = rz * ix - rx * iz, cz = rx * iy - ry * ix;
        this.st[T + 1] += ((ax * cx + ay * cy + az * cz) / r2) * (this.jp[J] / (this.jp[J] + this.riderI[k]));
        const wmax = PROPS.MOVE_VMAX / Math.max(0.05, this.jp[J + 4]);
        if (this.st[T + 1] > wmax) this.st[T + 1] = wmax; else if (this.st[T + 1] < -wmax) this.st[T + 1] = -wmax;
      }
    }
    if (this.strikable[k]) this.pushStrike(k, Math.sqrt(ix * ix + iy * iy + iz * iz) / PROPS.MOVE_VMAX, 0, -1);
    this.writePose(k);
  }

  drainStrikes(out: Float32Array): number {
    const m = Math.min(this.nStrikes, Math.floor(out.length / 4));
    for (let i = 0; i < m * 4; i++) out[i] = this.strikes[i];
    this.nStrikes = 0;
    return m;
  }

  stateHash(): number {
    let h = 0x811c9dc5 | 0;
    const st = this.st;
    for (let i = 0; i < st.length; i++) { h ^= Math.round(st[i] * 8192) | 0; h = Math.imul(h, 0x01000193); }
    for (let k = 0; k < this.count; k++) { h ^= this.parked[k]; h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // ------------------------------------------------------------------ physics values beyond the contract (the shell's life host; documented in the report)

  /** Park or show a thing's props (Home's things arrive one by one: a parked prop has no collider and keeps its pose). `thing` = its PlaceDef.things index. */
  setParked(thing: number, parked: boolean): void {
    const t = Math.floor(thing);
    if (!(t >= 0 && t * 2 < this.things.length)) return;
    const k0 = this.things[t * 2], nk = this.things[t * 2 + 1];
    for (let k = k0; k >= 0 && k < k0 + nk; k++) { this.parked[k] = parked ? 1 : 0; if (parked) this.hand[k] = 0; this.writePose(k); }
  }
  isParked(prop: number): boolean { const k = Math.floor(prop); return k >= 0 && k < this.count && this.parked[k] === 1; }
  /** The free ball's bounds as a rectangle (Home: StageLike.visibleTable, D-67); each ball keeps its centre inside it shrunk by its radius. */
  setBallBounds(minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (!Number.isFinite(minX + minZ + maxX + maxZ) || maxX <= minX || maxZ <= minZ) return;
    this.boundsShape = 1;
    this.bounds[0] = (minX + maxX) / 2; this.bounds[1] = (minZ + maxZ) / 2; this.bounds[2] = (maxX - minX) / 2; this.bounds[3] = (maxZ - minZ) / 2; this.bounds[4] = 0;
    // (round 5) an untouched ball at rest goes to its spot pushed into the new bounds (ballPin)
    for (let k = 0; k < this.count; k++) {
      if (this.joint[k] !== JOINT_BALL || this.ballPin[k] === 0 || this.parked[k] === 1) continue;
      const T = k * 12, B = k * 16, st = this.st, r = this.jp[k * 8 + 7];
      if (st[T + 3] !== 0 || st[T + 4] !== 0 || st[T + 5] !== 0) { this.ballPin[k] = 0; continue; }
      if (maxX - minX < 2 * r || maxZ - minZ < 2 * r) continue;   // (bounds narrower than the ball: leave it to the step's push)
      st[T] = Math.min(maxX - r, Math.max(minX + r, this.base[B])); st[T + 2] = Math.min(maxZ - r, Math.max(minZ + r, this.base[B + 2]));
      this.writePose(k);
    }
  }
  /** A hinge's angle (rad) and angular velocity, or a ball's speed (harness readouts; NaN for a static prop). */
  angle(prop: number): number { const k = Math.floor(prop); return k >= 0 && k < this.count && this.joint[k] === JOINT_HINGE ? this.st[k * 12] : NaN; }
  omega(prop: number): number { const k = Math.floor(prop); return k >= 0 && k < this.count && this.joint[k] === JOINT_HINGE ? this.st[k * 12 + 1] : NaN; }
  /** The world-space velocity of a ball (into out[0..2]); false for another prop. */
  ballVelocity(prop: number, out: Float64Array): boolean {
    const k = Math.floor(prop);
    if (!(k >= 0 && k < this.count) || this.joint[k] !== JOINT_BALL) return false;
    out[0] = this.st[k * 12 + 3]; out[1] = this.st[k * 12 + 4]; out[2] = this.st[k * 12 + 5];
    return true;
  }

  // ---- D-95 (revised): AUTO and the hand on a hinge prop (the swing seat, the rocker board; a chime too). Physics values beyond the contract, for the shell.

  /** The player's AUTO toggle of a thing's hinge props (D-95 revised: off by default; never LIFE's or autonomy's). On: the hinge keeps a gentle steady arc by itself
   *  (PROPS.AUTO_SWING_DEG at the riders' own pendulum pace, AUTO_ROCK_DEG for a seesaw), with or without riders, a rider on a swing holding on. It takes the
   *  motion it finds (the arc starts at the angle and angular velocity of the moment: no jump) and eases its arc to its size at AUTO_AMP_RATE (from rest 10 deg in
   *  1.7 s; after a big push it shrinks back). A hand on the prop (grabProp) or a held body touching it (a finger, a grab, a carry or a lock: the rider) wins at
   *  once, and on release the arc takes up the motion the hand left and eases back. Off: the hinge carries on from the motion it has and dies down by its own
   *  damping, exactly as without AUTO. Returns false (nothing changes) for a thing with no hinge prop. */
  setAuto(thing: number, on: boolean): boolean {
    const t = Math.floor(thing);
    if (!(t >= 0 && t * 2 < this.things.length)) return false;
    const k0 = this.things[t * 2], nk = this.things[t * 2 + 1];
    let any = false;
    for (let k = k0; k >= 0 && k < k0 + nk; k++) if (this.joint[k] === JOINT_HINGE) { this.autoOn[k] = on ? 1 : 0; any = true; }
    return any;
  }
  /** AUTO is on for this thing (setAuto). */
  isAuto(thing: number): boolean {
    const t = Math.floor(thing);
    if (!(t >= 0 && t * 2 < this.things.length)) return false;
    const k0 = this.things[t * 2], nk = this.things[t * 2 + 1];
    for (let k = k0; k >= 0 && k < k0 + nk; k++) if (this.autoOn[k] === 1) return true;
    return false;
  }
  /** The AUTO drive's share of a prop's motion now: 1 while the arc drives it, 0 while AUTO is off or a hand or a held rider has it. */
  autoShare(prop: number): number { const k = Math.floor(prop); return k >= 0 && k < this.count ? this.au[k * 5] : 0; }

  /** A hand takes a hinge prop (the swing seat, the rocker board) at the world point (x, y, z) (NaN: the last raycast's hit on it, else its centre): from now the
   *  prop turns so that spot points at the hand (dragProp / dragPropRay), with time constant HAND_TAU, over its riders and over AUTO, inside its limits and the
   *  MOVE_VMAX clamp. A pull or a push therefore swings it, and releaseProp leaves it the hand's angular velocity (a flick swings it on). False for a parked, static
   *  or free (ball) prop. */
  grabProp(prop: number, x: number, y: number, z: number): boolean {
    const k = Math.floor(prop);
    if (!(k >= 0 && k < this.count) || this.parked[k] || this.joint[k] !== JOINT_HINGE) return false;
    const S = this.solve.S, o = k * PS, B = k * 16, P = this.handP, q = k * 6;
    let px = x, py = y, pz = z;
    if (!Number.isFinite(px + py + pz)) {
      if (this.rayProp === k) { px = this.rayP[0]; py = this.rayP[1]; pz = this.rayP[2]; } else { px = S[o + 4]; py = S[o + 5]; pz = S[o + 6]; }
    }
    // the spot relative to the pivot, turned back to hinge angle 0 (Rodrigues with -angle)
    const ax = this.base[B + 10], ay = this.base[B + 11], az = this.base[B + 12], th = -this.st[k * 12];
    const rx = px - this.base[B + 7], ry = py - this.base[B + 8], rz = pz - this.base[B + 9], cs = Math.cos(th), sn = Math.sin(th), dot = ax * rx + ay * ry + az * rz;
    P[q] = rx * cs + (ay * rz - az * ry) * sn + ax * dot * (1 - cs);
    P[q + 1] = ry * cs + (az * rx - ax * rz) * sn + ay * dot * (1 - cs);
    P[q + 2] = rz * cs + (ax * ry - ay * rx) * sn + az * dot * (1 - cs);
    P[q + 3] = px; P[q + 4] = py; P[q + 5] = pz;
    this.hand[k] = 1;
    return true;
  }
  /** The hand's point (world) for a prop it holds (grabProp): the prop turns toward it from the next endFrame. */
  dragProp(prop: number, x: number, y: number, z: number): void {
    const k = Math.floor(prop);
    if (!(k >= 0 && k < this.count) || this.hand[k] !== 1 || !Number.isFinite(x + y + z)) return;
    const q = k * 6; this.handP[q + 3] = x; this.handP[q + 4] = y; this.handP[q + 5] = z;
  }
  /** dragProp from a pointer ray (origin, direction): the hand's point is where the ray meets the plane the grabbed spot turns in (perpendicular to the hinge axis);
   *  when the ray runs nearly along that plane (a swing that travels toward the camera), the horizontal plane through the spot, else the plane facing the ray.
   *  False (nothing changes) when no hand holds the prop or the ray misses the plane. */
  dragPropRay(prop: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
    const k = Math.floor(prop);
    if (!(k >= 0 && k < this.count) || this.hand[k] !== 1 || !Number.isFinite(ox + oy + oz + dx + dy + dz)) return false;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dl > 1e-12)) return false;
    const ux = dx / dl, uy = dy / dl, uz = dz / dl, B = k * 16, P = this.handP, q = k * 6;
    const ax = this.base[B + 10], ay = this.base[B + 11], az = this.base[B + 12], th = this.st[k * 12];
    // the grabbed spot now (pivot + Rot(axis, angle) r0)
    const rx = P[q], ry = P[q + 1], rz = P[q + 2], cs = Math.cos(th), sn = Math.sin(th), dot = ax * rx + ay * ry + az * rz;
    const gx = this.base[B + 7] + rx * cs + (ay * rz - az * ry) * sn + ax * dot * (1 - cs);
    const gy = this.base[B + 8] + ry * cs + (az * rx - ax * rz) * sn + ay * dot * (1 - cs);
    const gz = this.base[B + 9] + rz * cs + (ax * ry - ay * rx) * sn + az * dot * (1 - cs);
    const da = ux * ax + uy * ay + uz * az;
    let nx = -ux, ny = -uy, nz = -uz;
    if (Math.abs(da) >= 0.35) { nx = ax; ny = ay; nz = az; } else if (Math.abs(uy) >= 0.2) { nx = 0; ny = 1; nz = 0; }
    const den = ux * nx + uy * ny + uz * nz;
    if (Math.abs(den) < 1e-6) return false;
    const t = ((gx - ox) * nx + (gy - oy) * ny + (gz - oz) * nz) / den;
    if (!(t >= 0) || !Number.isFinite(t)) return false;
    P[q + 3] = ox + ux * t; P[q + 4] = oy + uy * t; P[q + 5] = oz + uz * t;
    return true;
  }
  /** The hand lets go (prop < 0: every hand): the prop keeps its angular velocity and swings on (AUTO off: it dies down; AUTO on: it eases back to its arc). */
  releaseProp(prop: number): void {
    const k = Math.floor(prop);
    if (k < 0) { this.hand.fill(0); return; }
    if (k < this.count) this.hand[k] = 0;
  }
  /** A hand holds this prop (grabProp). */
  isHandHeld(prop: number): boolean { const k = Math.floor(prop); return k >= 0 && k < this.count && this.hand[k] === 1; }

  // ------------------------------------------------------------------ integration

  private hNow = 1 / 60;
  private stepHinge(k: number): void {
    const h = this.hNow, A = this.solve.A, a = k * PA, B = k * 16, J = k * 8, T = k * 12;
    const ax = this.base[B + 10], ay = this.base[B + 11], az = this.base[B + 12];
    this.riderI[k] = A[a + 6] / h;
    const I = this.jp[J] + this.riderI[k];                                 // own inertia + the riders' (supported mass x r_perp^2)
    const th0 = this.st[T], w0 = this.st[T + 1], lim = this.jp[J + 2];
    let w = w0 + (A[a + 3] * ax + A[a + 4] * ay + A[a + 5] * az) / I;
    w += (-this.jp[J + 3] * Math.sin(th0) / I) * h;                         // own gravity (a pendulum: the swing seat, a chime)
    w *= Math.exp(-this.jp[J + 1] * h * (this.jp[J + 3] > 0 ? this.jp[J] / I : 1));   // (a pendulum seat's damping acts on its own inertia: round 5, D-95)
    // D-95: a hand on the prop wins over its riders and over AUTO: its angular velocity follows the wish to point the grabbed spot at the hand
    const handOn = this.hand[k] === 1;
    if (handOn) { this.handAngle(k, th0); const wt = (this.sc[2] - th0) / PROPS.HAND_TAU; w += (wt - w) * Math.min(1, h / PROPS.HAND_SMOOTH); }
    // D-95: a HELD rider wins too: the seat or board turns with the rider the player pulls or pushes (its centre's angular velocity about the axis, mass-weighted)
    else if (A[a + 14] > 0) w += (A[a + 13] / A[a + 14] - w) * Math.min(1, h / PROPS.RIDER_TAU);
    // D-95 (round 5): a FREE pendulum seat with riders gives back the least drag a rider has (PROPS.RIDER_DRAG_BACK); its riders hold on while it swings (RIDER_HOLD_*, S[34])
    if (this.jp[J + 3] > 0 && this.strikable[k] === 0 && !handOn && !(A[a + 14] > 0) && this.autoOn[k] === 0 && this.au[k * 5] === 0 && this.riderI[k] > 0) {
      w *= Math.exp(PROPS.RIDER_DRAG_BACK * (this.riderI[k] / I) * h);
      const aw = w < 0 ? -w : w, pk = this.freeRide[k] * Math.exp(-h / PROPS.RIDER_HOLD_TAU), sh = ((aw > pk ? aw : pk) - PROPS.RIDER_HOLD_W0) / PROPS.RIDER_HOLD_WR;
      this.freeRide[k] = aw > pk ? aw : pk; this.rideHold[k] = sh < 0 ? 0 : sh > 1 ? 1 : sh;
    } else { this.freeRide[k] = 0; this.rideHold[k] = 0; }
    const wmax = PROPS.MOVE_VMAX / Math.max(0.05, this.jp[J + 4]);
    if (w > wmax) w = wmax; else if (w < -wmax) w = -wmax;
    let th = th0 + w * h;
    // D-95 AUTO: the player's steady arc carries the prop and its riders (u = 1) while nothing holds it; it engages from the motion it finds (the arc's amplitude and
    // phase from the angle and angular velocity at that moment, so neither jumps) and eases its amplitude to its size; a hand or a held rider wins at once (u = 0),
    // and the free motion above then starts from the arc's state (no jump either way). (A share eased over 0.6 s was tried: under it a rider's weight torque on the
    // rocker, held at its limit, built up a 0.09 rad/s jolt a frame against the blend; the arc that starts from the state needs no blend)
    if (this.autoOn[k] === 1 || this.au[k * 5] > 0) {
      if (A[a + 10] > 0) this.heldT[k] = PROPS.AUTO_HELD_S; else if (this.heldT[k] > 0) this.heldT[k] -= h;   // (a held rider counts this long after its last touch: no flicker)
      const U = k * 5, au = this.au, held = handOn || this.heldT[k] > 0, want = this.autoOn[k] === 1 && !held;
      // the riders' pendulum (their centres about the axis), smoothed over AUTO_RIDER_S so a rider's bounce or a hop on or off changes the pace gently
      const kr = Math.min(1, h / PROPS.AUTO_RIDER_S);
      au[U + 3] += (A[a + 11] / h - au[U + 3]) * kr; au[U + 4] += (A[a + 12] / h - au[U + 4]) * kr;
      if (!want) au[U] = 0;
      else {
        this.autoParams(k);
        const om = this.sc[0], tgt = this.sc[1];
        if (au[U] === 0) { const qv = w0 / om; au[U + 1] = Math.sqrt(th0 * th0 + qv * qv); au[U + 2] = Math.atan2(th0, qv); au[U] = 1; }
        // the arc grows to its size (from rest) or shrinks to it (after a big push) at AUTO_AMP_RATE
        const da = (PROPS.AUTO_AMP_RATE * Math.PI / 180) * h, am = au[U + 1];
        au[U + 1] = am < tgt ? Math.min(tgt, am + da) : Math.max(tgt, am - da);
        let ph = au[U + 2] + om * h;
        if (ph > Math.PI) ph -= 2 * Math.PI;
        au[U + 2] = ph;
        // (an arc wider than the limit, after a push to the stop, rests at the stop until it has shrunk inside it)
        const s0 = au[U + 1] * Math.sin(ph);
        if (s0 >= lim || s0 <= -lim) { th = s0 > 0 ? lim : -lim; w = 0; }
        else { th = s0; w = au[U + 1] * om * Math.cos(ph); }
      }
    }
    if (th > lim) { th = lim; if (w > 0) w = -PROPS.LIMIT_E * w; } else if (th < -lim) { th = -lim; if (w < 0) w = -PROPS.LIMIT_E * w; }
    this.st[T] = th; this.st[T + 1] = Math.abs(w) < 1e-7 ? 0 * w : w;
  }
  /** AUTO's pace and arc into sc[0] (rad/s) and sc[1] (rad) (written, not returned: a double returned by a call that is not inlined is boxed, one HeapNumber a
   *  frame). The pace: a pendulum (the swing, a chime) with riders swings at the riders' OWN pendulum (their centres sit above the seat, so they would swing faster
   *  than the seat: driven at the seat's sqrt(g / rope) a rider is pushed and held back by the seat every half swing), the empty seat's own sqrt(m g l / I) weighing
   *  in at AUTO_SEAT_W; a seesaw (no gravity of its own): AUTO_ROCK_PERIOD. The arc: the swing's, the rocker's or a chime's, at most AUTO_LIMIT_SHARE of the limit. */
  private autoParams(k: number): void {
    const J = k * 8, mgl = this.jp[J + 3], U = k * 5, sw = PROPS.AUTO_SEAT_W;
    this.sc[0] = mgl > 0 ? Math.sqrt((sw * mgl + GRAVITY * this.au[U + 3]) / Math.max(1e-6, sw * this.jp[J] + this.au[U + 4])) : (2 * Math.PI) / PROPS.AUTO_ROCK_PERIOD;
    const deg = this.strikable[k] ? PROPS.AUTO_CHIME_DEG : mgl > 0 ? PROPS.AUTO_SWING_DEG : PROPS.AUTO_ROCK_DEG;
    this.sc[1] = Math.min((deg * Math.PI) / 180, PROPS.AUTO_LIMIT_SHARE * this.jp[J + 2]);
  }
  /** The hinge angle at which the grabbed spot (grabProp) points at the hand's point, about the hinge axis, into sc[2]; `th` (unchanged) when the hand is on the
   *  axis. (Written, not returned: see autoParams.) */
  private handAngle(k: number, th: number): void {
    const B = k * 16, P = this.handP, q = k * 6, ax = this.base[B + 10], ay = this.base[B + 11], az = this.base[B + 12];
    const r0 = P[q] * ax + P[q + 1] * ay + P[q + 2] * az, sx = P[q] - ax * r0, sy = P[q + 1] - ay * r0, sz = P[q + 2] - az * r0;
    const tx0 = P[q + 3] - this.base[B + 7], ty0 = P[q + 4] - this.base[B + 8], tz0 = P[q + 5] - this.base[B + 9], t0 = tx0 * ax + ty0 * ay + tz0 * az;
    const tx = tx0 - ax * t0, ty = ty0 - ay * t0, tz = tz0 - az * t0;
    if (sx * sx + sy * sy + sz * sz < 1e-6 || tx * tx + ty * ty + tz * tz < 0.0025) { this.sc[2] = th; return; }
    const cx = sy * tz - sz * ty, cy = sz * tx - sx * tz, cz = sx * ty - sy * tx;
    this.sc[2] = Math.atan2(ax * cx + ay * cy + az * cz, sx * tx + sy * ty + sz * tz);
  }

  private clampBall(k: number): void {
    const T = k * 12, st = this.st, sp = Math.sqrt(st[T + 3] * st[T + 3] + st[T + 4] * st[T + 4] + st[T + 5] * st[T + 5]);
    if (sp > PROPS.MOVE_VMAX) { const s = PROPS.MOVE_VMAX / sp; st[T + 3] *= s; st[T + 4] *= s; st[T + 5] *= s; }
  }

  /** The ball against every other shown prop (as fixed shapes at their current pose): pushed out, its normal speed reflected with BALL_E. */
  private ballObstacles(k: number): void {
    const S = this.solve.S, st = this.st, T = k * 12, r = this.jp[k * 8 + 7], sc = this.sc;
    for (let q = 0; q < this.count; q++) {
      if (q === k || this.parked[q] || this.kind[q] === 0 || this.joint[q] === JOINT_BALL) continue;
      const o = q * PS, kd = this.kind[q];
      const dx = st[T] - S[o + 4], dy = st[T + 1] - S[o + 5], dz = st[T + 2] - S[o + 6];
      const br = S[o + 28] + r;
      if (dx * dx + dy * dy + dz * dz > br * br) continue;
      // the closest point of the shape to the ball's centre (sc 0..2), from which the normal follows
      if (kd === KIND_SPHERE) { const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; const rr = S[o + 16]; sc[0] = S[o + 4] + dx / d * rr; sc[1] = S[o + 5] + dy / d * rr; sc[2] = S[o + 6] + dz / d * rr; sc[3] = d < rr ? 1 : 0; }
      else if (kd === KIND_CAPSULE) {
        const ax = S[o + 3] | 0, ux = S[o + 7 + ax], uy = S[o + 10 + ax], uz = S[o + 13 + ax], hl = S[o + 17], rr = S[o + 16];
        const t0 = dx * ux + dy * uy + dz * uz, t = t0 < -hl ? -hl : t0 > hl ? hl : t0;
        const ex = dx - ux * t, ey = dy - uy * t, ez = dz - uz * t, d = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
        sc[0] = S[o + 4] + ux * t + ex / d * rr; sc[1] = S[o + 5] + uy * t + ey / d * rr; sc[2] = S[o + 6] + uz * t + ez / d * rr; sc[3] = d < rr ? 1 : 0;
      } else {
        const lx = dx * S[o + 7] + dy * S[o + 10] + dz * S[o + 13], ly = dx * S[o + 8] + dy * S[o + 11] + dz * S[o + 14], lz = dx * S[o + 9] + dy * S[o + 12] + dz * S[o + 15];
        const hx = S[o + 16], hy = S[o + 17], hz = S[o + 18];
        const inside = Math.abs(lx) < hx && Math.abs(ly) < hy && Math.abs(lz) < hz;
        let cx = lx < -hx ? -hx : lx > hx ? hx : lx, cy = ly < -hy ? -hy : ly > hy ? hy : ly, cz = lz < -hz ? -hz : lz > hz ? hz : lz;
        if (inside) {   // the centre inside the box: out through the nearest face
          const ex = hx - Math.abs(lx), ey = hy - Math.abs(ly), ez = hz - Math.abs(lz);
          if (ex <= ey && ex <= ez) cx = lx < 0 ? -hx : hx; else if (ey <= ez) cy = ly < 0 ? -hy : hy; else cz = lz < 0 ? -hz : hz;
        }
        sc[0] = S[o + 4] + S[o + 7] * cx + S[o + 8] * cy + S[o + 9] * cz; sc[1] = S[o + 5] + S[o + 10] * cx + S[o + 11] * cy + S[o + 12] * cz; sc[2] = S[o + 6] + S[o + 13] * cx + S[o + 14] * cy + S[o + 15] * cz;
        sc[3] = inside ? 1 : 0;
      }
      let nx = st[T] - sc[0], ny = st[T + 1] - sc[1], nz = st[T + 2] - sc[2];
      let d = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (sc[3] === 1) { nx = -nx; ny = -ny; nz = -nz; d = -d; }   // inside: the normal points out through the surface point
      if (d >= r) continue;
      const l = Math.abs(d) > 1e-9 ? Math.abs(d) : 1;
      nx /= l; ny /= l; nz /= l;
      if (Math.abs(d) <= 1e-9) { nx = 0; ny = 1; nz = 0; }
      const push = r - d;
      st[T] += nx * push; st[T + 1] += ny * push; st[T + 2] += nz * push;
      const vn = st[T + 3] * nx + st[T + 4] * ny + st[T + 5] * nz;
      if (vn < 0) { const k2 = (1 + PROPS.BALL_E) * vn; st[T + 3] -= k2 * nx; st[T + 4] -= k2 * ny; st[T + 5] -= k2 * nz; }
    }
  }

  private pushStrike(k: number, intensity: number, cause: number, slot: number): void {
    this.strikeT[k] = PROPS.STRIKE_GAP;
    if (this.nStrikes >= MAX_STRIKES) return;
    const i = this.nStrikes * 4;
    this.strikes[i] = k; this.strikes[i + 1] = intensity > 1 ? 1 : intensity < 0 ? 0 : intensity; this.strikes[i + 2] = cause; this.strikes[i + 3] = slot;
    this.nStrikes++;
  }

  /** The prop's pose from its state: the packed shape (S) for the bodies' next frame and the render pose (poses). */
  private writePose(k: number): void {
    const S = this.solve.S, o = k * PS, B = k * 16, T = k * 12, P = this.poses, p = k * 8, j = this.joint[k], st = this.st, base = this.base;
    let cx = base[B], cy = base[B + 1], cz = base[B + 2];
    let qx = base[B + 3], qy = base[B + 4], qz = base[B + 5], qw = base[B + 6];
    let state = 0;
    // velocities for the bodies' per-substep advance
    let vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
    if (j === JOINT_HINGE) {
      const th = st[T], w = st[T + 1], ax = base[B + 10], ay = base[B + 11], az = base[B + 12], px = base[B + 7], py = base[B + 8], pz = base[B + 9];
      // the hinge rotation Rot(axis, th) as a quaternion, composed before the yaw
      const s = Math.sin(th / 2), c = Math.cos(th / 2), hx = ax * s, hy = ay * s, hz = az * s;
      const nqx = c * qx + hx * qw + (hy * qz - hz * qy), nqy = c * qy + hy * qw + (hz * qx - hx * qz), nqz = c * qz + hz * qw + (hx * qy - hy * qx), nqw = c * qw - (hx * qx + hy * qy + hz * qz);
      qx = nqx; qy = nqy; qz = nqz; qw = nqw;
      // the centre turned about the pivot
      const rx = cx - px, ry = cy - py, rz = cz - pz, cs = Math.cos(th), sn = Math.sin(th), dot = ax * rx + ay * ry + az * rz;
      cx = px + rx * cs + (ay * rz - az * ry) * sn + ax * dot * (1 - cs);
      cy = py + ry * cs + (az * rx - ax * rz) * sn + ay * dot * (1 - cs);
      cz = pz + rz * cs + (ax * ry - ay * rx) * sn + az * dot * (1 - cs);
      wx = ax * w; wy = ay * w; wz = az * w; state = th;
      S[o + 25] = px; S[o + 26] = py; S[o + 27] = pz; S[o + 31] = ax; S[o + 32] = ay; S[o + 33] = az;
      S[o + 29] = w !== 0 ? 1 : 0;
      S[o + 34] = this.jp[k * 8 + 3] > 0 && this.strikable[k] === 0 ? (this.hand[k] === 1 ? 1 : this.rideHold[k] > this.au[k * 5] ? this.rideHold[k] : this.au[k * 5]) : 0;   // D-95: a pendulum seat AUTO or a hand drives, or it swings free with riders (round 5): its riders hold on
    } else if (j === JOINT_BALL) {
      cx = st[T]; cy = st[T + 1]; cz = st[T + 2];
      vx = st[T + 3]; vy = st[T + 4]; vz = st[T + 5];
      state = st[T + 10];
      S[o + 29] = vx !== 0 || vy !== 0 || vz !== 0 ? 1 : 0;
      S[o + 25] = cx; S[o + 26] = cy; S[o + 27] = cz;
    } else if (j === JOINT_BOB) {
      cy += st[T]; vy = st[T + 1]; state = st[T];
      S[o + 29] = vy !== 0 ? 1 : 0; S[o + 25] = cx; S[o + 26] = cy; S[o + 27] = cz;
    } else S[o + 29] = 0;
    S[o] = this.parked[k] ? 0 : this.kind[k];
    S[o + 1] = j;
    S[o + 4] = cx; S[o + 5] = cy; S[o + 6] = cz;
    S[o + 19] = vx; S[o + 20] = vy; S[o + 21] = vz; S[o + 22] = wx; S[o + 23] = wy; S[o + 24] = wz;
    // the rotation matrix (row-major) of the collision frame: the hinge rotation and the yaw (a ball's spin is a look: its shape frame stays the identity)
    const rq = j === JOINT_BALL ? 0 : 1;
    const ex = qx * rq, ey = qy * rq, ez = qz * rq, ew = qw * rq + (1 - rq);
    const xx = ex * ex, yy = ey * ey, zz = ez * ez, xy = ex * ey, xz = ex * ez, yz = ey * ez, wx2 = ew * ex, wy2 = ew * ey, wz2 = ew * ez;
    S[o + 7] = 1 - 2 * (yy + zz); S[o + 8] = 2 * (xy - wz2); S[o + 9] = 2 * (xz + wy2);
    S[o + 10] = 2 * (xy + wz2); S[o + 11] = 1 - 2 * (xx + zz); S[o + 12] = 2 * (yz - wx2);
    S[o + 13] = 2 * (xz - wy2); S[o + 14] = 2 * (yz + wx2); S[o + 15] = 1 - 2 * (xx + yy);
    // the render pose (a pad: its top rises `travel` and back over PAD_LOOK_S after a kick, a look only: its collider stays flush below the floor)
    P[p] = cx; P[p + 1] = cy; P[p + 2] = cz;
    if (j === JOINT_PAD) { const t = st[T + 1] / PROPS.PAD_LOOK_S; state = t < 1 ? this.jp[k * 8 + 3] * Math.sin(Math.PI * t) : 0; P[p + 1] = cy + state; }
    if (j === JOINT_BALL) { P[p + 3] = st[T + 6]; P[p + 4] = st[T + 7]; P[p + 5] = st[T + 8]; P[p + 6] = st[T + 9]; }
    else { P[p + 3] = qx; P[p + 4] = qy; P[p + 5] = qz; P[p + 6] = qw; }
    P[p + 7] = state;
  }
}

/** Ray (origin relative to the sphere's centre, unit direction) against a sphere: the entry distance, or Infinity. */
function raySphere(rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, r: number): number {
  const b = rx * ux + ry * uy + rz * uz, c = rx * rx + ry * ry + rz * rz - r * r, disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (c <= 0 ? 0 : Infinity);
}
/** Ray against a capsule (segment centre at the origin along unit (ax, ay, az), half length hl, radius r): the entry distance, or Infinity. */
function rayCapsule(rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, ax: number, ay: number, az: number, hl: number, r: number): number {
  // the infinite cylinder, clipped to the segment, then the two end spheres
  const da = ux * ax + uy * ay + uz * az, oa = rx * ax + ry * ay + rz * az;
  const dpx = ux - ax * da, dpy = uy - ay * da, dpz = uz - az * da, opx = rx - ax * oa, opy = ry - ay * oa, opz = rz - az * oa;
  const A = dpx * dpx + dpy * dpy + dpz * dpz, Bh = dpx * opx + dpy * opy + dpz * opz, C = opx * opx + opy * opy + opz * opz - r * r;
  let best = Infinity;
  if (A > 1e-12) {
    const disc = Bh * Bh - A * C;
    if (disc >= 0) {
      const t = (-Bh - Math.sqrt(disc)) / A, s = oa + da * t;
      if (t >= 0 && s >= -hl && s <= hl) best = t;
    }
  }
  const t1 = raySphere(rx - ax * hl, ry - ay * hl, rz - az * hl, ux, uy, uz, r), t2 = raySphere(rx + ax * hl, ry + ay * hl, rz + az * hl, ux, uy, uz, r);
  return Math.min(best, t1, t2);
}
/** Ray in a box's frame (origin, direction) against the box of half sizes h: the entry distance (slab test), or Infinity. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hx: number, hy: number, hz: number): number {
  SLAB[0] = 0; SLAB[1] = Infinity;
  if (!slab(ox, dx, hx) || !slab(oy, dy, hy) || !slab(oz, dz, hz)) return Infinity;
  return SLAB[0];
}
const SLAB = new Float64Array(2);   // [t entry, t exit] of rayBox (no allocation per ray)
function slab(o: number, d: number, h: number): boolean {
  if (Math.abs(d) < 1e-12) return o >= -h && o <= h;
  const a = (-h - o) / d, b = (h - o) / d, lo = a < b ? a : b, hi = a < b ? b : a;
  if (lo > SLAB[0]) SLAB[0] = lo;
  if (hi < SLAB[1]) SLAB[1] = hi;
  return SLAB[0] <= SLAB[1];
}

/**
 * Build the PropWorld of `place` for the layout in use ('wide': the PlaceDef's own fields; 'tall': `place.tall`, D-68). Home (`unit: 'slot'`) places its things
 * at spot x bodyScale (D-67) and builds them PARKED (Home's things arrive one by one: the shell calls setParked(thing, false) when one arrives; sizes stay in metres).
 * The ball's bounds are the layout's bounds (setBallBounds overrides them: Home's visible table).
 */
export function buildPropWorld(place: PlaceDef, layout: 'wide' | 'tall', bodyScale: number): PropWorld {
  const tall = layout === 'tall';
  const lay = tall ? place.tall : null;
  const home = place.unit === 'slot';
  const sc = home && Number.isFinite(bodyScale) && bodyScale > 0 ? bodyScale : 1;
  const parts: PropBuild[] = [];
  const things = place.things;
  // the zones packed (ZS), the layout's areas over the place's own: a floater floats on the water zone it is in
  const nz = place.zones.length, zf = new Float64Array(nz * ZS);
  for (let z = 0; z < nz; z++) {
    const d = place.zones[z], a = lay && lay.zones[z] ? lay.zones[z] : d, o = z * ZS, zy = a.yaw ?? 0;
    zf[o] = d.kind; zf[o + 1] = a.shape === 'disc' ? 0 : 1; zf[o + 2] = a.x * sc; zf[o + 3] = a.z * sc;
    zf[o + 4] = a.shape === 'disc' ? a.r ?? 0 : a.hx ?? 0; zf[o + 5] = a.hz ?? 0; zf[o + 6] = Math.cos(zy); zf[o + 7] = Math.sin(zy);
    zf[o + 8] = d.surfaceY ?? 0; zf[o + 9] = d.ramp ?? 0; zf[o + 10] = d.flow ? d.flow[0] : 0; zf[o + 11] = d.flow ? d.flow[1] : 0; zf[o + 12] = d.strength;
  }
  for (let t = 0; t < things.length; t++) {
    const d = things[t];
    const spot = lay ? lay.things[t] : null;
    const x = (spot ? spot.x : d.x) * sc, z = (spot ? spot.z : d.z) * sc, yaw = spot ? spot.yaw : d.yaw;
    addThing(parts, t, d, x, z, yaw, d.mech === MECH.floater ? waterAt(zf, nz, x, z) : 0, tall);
  }
  const walls = lay ? lay.walls : place.walls;
  for (let w = 0; w < walls.length; w++) {
    const a = walls[w];
    if (a.shape !== 'box') continue;
    const hw = PROPS.WALL_H / 2;
    parts.push({ thing: -1, part: w, kind: KIND_BOX, joint: JOINT_STATIC, mu: 0.8, capAxis: 0, strike: false, c: [a.x, hw, a.z], yaw: a.yaw ?? 0, h: [a.hx ?? 0.15, hw, a.hz ?? 0.15] });
  }
  const bd = lay ? lay.bounds : place.bounds;
  const bounds = bd.shape === 'disc'
    ? { shape: 0, v: [bd.x * sc, bd.z * sc, (bd.r ?? 3.4) * (home ? 1 : 1)] }
    : { shape: 1, v: [bd.x, bd.z, bd.hx ?? 3.4, bd.hz ?? 2.4, bd.round ?? 0] };
  return new PropWorld(parts, things.length, place.zones.length, bounds, home, zf, worldExtras(place, lay, sc, zf, walls, bd));
}
/** R6: the surface, the weather and the guard of a place for the layout in use (PropWorld's WorldExtras). The live places (Home, Hearthlog Cabin) keep the published
 *  floor and no guard (PROPS.SURF_LIVE); their zones have no wind, updraft or wave, so their weather is nothing either. */
function worldExtras(place: PlaceDef, lay: PlaceDef['tall'] | null, sc: number, zf: Float64Array, walls: readonly { shape: string; x: number; z: number; hx?: number; hz?: number }[],
  bd: { shape: string; x: number; z: number; r?: number; hx?: number; hz?: number }): WorldExtras {
  const live = (place.id === 'home' || place.id === 'hearthlog') && !PROPS.SURF_LIVE;
  const g = place.ground;
  const ground: [number, number, number, number] = live ? [1, 1, 1, 1] : [g.grip, g.glue, g.peel, g.drag];
  const np = live ? 0 : place.patches.length, patches = new Float64Array(np * PT);
  for (let k = 0; k < np; k++) {
    const d = place.patches[k], a = lay && lay.patches[k] ? lay.patches[k] : d, o = k * PT, y = a.yaw ?? 0, m = d.mods;
    patches[o] = a.shape === 'disc' ? 0 : 1; patches[o + 1] = a.x * sc; patches[o + 2] = a.z * sc;
    patches[o + 3] = a.shape === 'disc' ? a.r ?? 0 : a.hx ?? 0; patches[o + 4] = a.hz ?? 0; patches[o + 5] = Math.cos(y); patches[o + 6] = Math.sin(y);
    patches[o + 7] = m.grip ?? NaN; patches[o + 8] = m.glue ?? NaN; patches[o + 9] = m.peel ?? NaN; patches[o + 10] = m.drag ?? NaN; patches[o + 11] = d.ice ? 1 : 0;
  }
  // the play area's centre: the wind blows along a wind zone's flow when the data gives one, else from the zone's centre toward it (+x for a zone centred on it);
  // a wave runs toward it (the shore; +z for a zone centred on it)
  const nz = place.zones.length, zx = new Float64Array(nz * ZX), bx = bd.x * sc, bz = bd.z * sc;
  for (let z = 0; z < nz; z++) {
    const d = place.zones[z], o = z * ZX, tx = bx - zf[z * ZS + 2], tz = bz - zf[z * ZS + 3], tl = Math.sqrt(tx * tx + tz * tz);
    if (d.gust) { zx[o] = d.gust.everyS[0]; zx[o + 1] = d.gust.everyS[1]; zx[o + 2] = d.gust.forS; }
    if (d.wave) { zx[o + 8] = d.wave.amp; zx[o + 9] = d.wave.everyS[0]; zx[o + 10] = d.wave.everyS[1]; }
    if (d.shower) { zx[o + 15] = d.shower.onS; zx[o + 16] = d.shower.offS; }
    let dx = 1, dz = 0;
    const fl = d.flow && d.kind === ZONE.wind && zf[z * ZS + 1] === 1 ? Math.sqrt(d.flow[0] * d.flow[0] + d.flow[1] * d.flow[1]) : 0;
    if (fl > 1e-9) { dx = d.flow![0] / fl; dz = d.flow![1] / fl; } else if (tl > 0.5) { dx = tx / tl; dz = tz / tl; }
    zx[o + 17] = dx; zx[o + 18] = dz;
    if (tl > 0.5) { zx[o + 19] = tx / tl; zx[o + 20] = tz / tl; } else zx[o + 20] = 1;
  }
  // the guard's limits (a box area only): a side with a wall beyond the bounds' edge (a parapet, a log wall) stops at the wall's inner face; another side at the
  // edge + the corral's rim + 5 cm (where the corral's rim bounce already acts: the guard is its backstop for a body the corral does not hold)
  const box = bd.shape === 'box', hx = bd.hx ?? 3.4, hz = bd.hz ?? 2.4, rim = PG.boundsRim + 0.05;
  const lim: [number, number, number, number] = [bx + hx + rim, bx - hx - rim, bz + hz + rim, bz - hz - rim];
  let walled = 0;
  for (const w of walls) {
    if (w.shape !== 'box') continue;
    const wx = w.x * sc, wz = w.z * sc, whx = w.hx ?? 0.15, whz = w.hz ?? 0.15;
    if (wx - whx >= bx + hx - 0.05 && Math.abs(wz - bz) < whz) { if (!(walled & 1) || wx - whx < lim[0]) lim[0] = wx - whx; walled |= 1; }
    else if (wx + whx <= bx - hx + 0.05 && Math.abs(wz - bz) < whz) { if (!(walled & 2) || wx + whx > lim[1]) lim[1] = wx + whx; walled |= 2; }
    else if (wz - whz >= bz + hz - 0.05 && Math.abs(wx - bx) < whx) { if (!(walled & 4) || wz - whz < lim[2]) lim[2] = wz - whz; walled |= 4; }
    else if (wz + whz <= bz - hz + 0.05 && Math.abs(wx - bx) < whx) { if (!(walled & 8) || wz + whz > lim[3]) lim[3] = wz + whz; walled |= 8; }
  }
  return { ground, patches, zx, surf: !live, guard: !live && box, lim, walled };
}
/** A deterministic draw in [0, 1) from two small integers (the weather's schedule: no Math.random). */
function hash01(a: number, b: number): number {
  let x = Math.imul((a | 0) + 1, 0x9e3779b1) ^ Math.imul((b | 0) + 7, 0x85ebca6b);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}
/** The surface height of the deepest water zone over (x, z) (0: none): where a floater floats. */
function waterAt(zf: Float64Array, nz: number, x: number, z: number): number {
  let best = 0;
  for (let k = 0; k < nz; k++) {
    const o = k * ZS;
    if (zf[o] !== ZONE.water) continue;
    const dx = x - zf[o + 2], dz = z - zf[o + 3];
    const inside = zf[o + 1] === 0 ? dx * dx + dz * dz < zf[o + 4] * zf[o + 4] : Math.abs(dx * zf[o + 6] + dz * zf[o + 7]) < zf[o + 4] && Math.abs(-dx * zf[o + 7] + dz * zf[o + 6]) < zf[o + 5];
    if (inside && zf[o + 8] > best) best = zf[o + 8];
  }
  return best;
}

function addThing(out: PropBuild[], t: number, d: ThingDef, x: number, z: number, yaw: number, water: number, tall = false): void {
  const p = d.p, s = d.size, mu = d.mu;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  switch (d.mech) {
    case MECH.block: {
      out.push({ thing: t, part: 0, kind: KIND_BOX, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, s[1], z], yaw, h: [s[0], s[1], s[2]] });
      if (p.kettleR) out.push({ thing: t, part: 1, kind: KIND_SPHERE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, 2 * s[1] + p.kettleR, z], yaw, h: [p.kettleR, 0, 0] });
      return;
    }
    case MECH.bar: {
      if (p.arch) {
        // (R6) an ARCH (Cloudloft's Sunbow Arch, PLACES 4.10: M2 x3, r size[0], p.width wide and p.height high): part 0 the post at local -x, part 1 the post at +x
        // (standing capsules from the floor to the top bar's centre line), part 2 the top bar lying along local x at height - r, both caps inside the width. Static.
        const r = s[0], wd = p.width ?? s[1], ht = p.height ?? s[2], hw = Math.max(r, wd / 2 - r), top = Math.max(2 * r, ht - r);
        for (const sg of [-1, 1]) out.push({ thing: t, part: sg < 0 ? 0 : 1, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 1, strike: false, c: [x + cy * hw * sg, top / 2, z + sy * hw * sg], yaw, h: [r, Math.max(0, top / 2 - r), 0] });
        out.push({ thing: t, part: 2, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, top, z], yaw, h: [r, Math.max(0, hw - r), 0] });
        return;
      }
      const r = s[0], half = Math.max(0, s[1] / 2 - r);
      if (p.standing) out.push({ thing: t, part: 0, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 1, strike: false, c: [x, s[1] / 2, z], yaw, h: [r, half, 0] });
      else out.push({ thing: t, part: 0, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, r, z], yaw, h: [r, half, 0] });
      if (p.standing && p.branchL) {
        // (S2) the Shake Pine's low branch, part 1: a capsule (r branchR, length branchL plus its caps) from the trunk's side along local x at pivotY (as the render
        // draws it), on a springy HINGE about its local z at the trunk's surface: a body brushing it, or bumping the trunk faster than p.bumpSpeed, shakes it (a strike:
        // its rustle and the snow puff); limit p.limit, damping p.damping, a 2 Hz spring (PROPS.BRANCH_HZ)
        const bl = p.branchL, br = p.branchR ?? 0.08, py = p.pivotY ?? 0.95, m = PROPS.CHIME_MASS, L = bl / 2, I = m * L * L;
        out.push({ thing: t, part: 1, kind: KIND_CAPSULE, joint: JOINT_HINGE, mu, capAxis: 0, strike: true, c: [x + cy * (r + L), py, z + sy * (r + L)], yaw, h: [br, L, 0],
          pivot: [x + cy * r, py, z + sy * r], axisLocal: 2, inertia: I, damping: p.damping ?? 2, limitDeg: p.limit ?? 20,
          mgl: I * (2 * Math.PI * PROPS.BRANCH_HZ) * (2 * Math.PI * PROPS.BRANCH_HZ), reach: r + bl, shake: p.bumpSpeed ?? 0.3 });
      }
      return;
    }
    case MECH.mound:
      out.push({ thing: t, part: 0, kind: KIND_SPHERE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, s[1] - s[0], z], yaw, h: [s[0], 0, 0] });
      return;
    case MECH.ring: {
      const R = s[0], r = s[1], gap = (s[2] * Math.PI) / 180, nseg = Math.max(1, Math.round(p.segments ?? 6));
      // the arc runs from the gap's edge at yaw + gap / 2 round to yaw + 2 pi - gap / 2 (yaw = the gap's direction, atan2(z, x))
      const a0 = yaw + gap / 2, span = 2 * Math.PI - gap;
      for (let i = 0; i < nseg; i++) {
        const u0 = a0 + (span * i) / nseg, u1 = a0 + (span * (i + 1)) / nseg;
        const x0 = x + R * Math.cos(u0), z0 = z + R * Math.sin(u0), x1 = x + R * Math.cos(u1), z1 = z + R * Math.sin(u1);
        const chord = Math.hypot(x1 - x0, z1 - z0), segYaw = Math.atan2(z1 - z0, x1 - x0);
        out.push({ thing: t, part: i, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [(x0 + x1) / 2, r, (z0 + z1) / 2], yaw: segYaw, h: [r, chord / 2, 0] });
      }
      return;
    }
    case MECH.seesaw: {
      const piv = p.pivot ?? 0.24;
      out.push({ thing: t, part: 0, kind: KIND_BOX, joint: JOINT_HINGE, mu, capAxis: 0, strike: false, c: [x, piv, z], yaw, h: [s[0], s[1], s[2]],
        pivot: [x, piv, z], axisLocal: 2, inertia: p.inertia ?? 0.5, damping: p.damping ?? 1, limitDeg: p.limit ?? 8, mgl: 0, reach: s[0] });
      return;
    }
    case MECH.swing: {
      // (p.box: a box seat of half sizes `size` [along its travel, up, across] instead of the capsule: PG_PHYS's fallback for a rider that slides off the capsule, PH-04)
      const rope = p.rope ?? 1.4, pivY = p.pivotY ?? 1.62, r = s[0], half = Math.max(0, s[1] / 2 - r), m = PROPS.SWING_SEAT, box = !!p.box;
      out.push({ thing: t, part: 0, kind: box ? KIND_BOX : KIND_CAPSULE, joint: JOINT_HINGE, mu, capAxis: 2, strike: false, c: [x, pivY - rope, z], yaw, h: box ? [s[0], s[1], s[2]] : [r, half, 0],
        pivot: [x, pivY, z], axisLocal: 2, inertia: m * rope * rope, damping: p.damping ?? 0.25, limitDeg: p.limit ?? 30, mgl: m * GRAVITY * rope, reach: rope });
      return;
    }
    case MECH.chime: {
      const nP = Math.max(1, Math.round(p.n ?? 1)), span = p.span ?? 0, hang = p.hang ?? 0.5, rail = PROPS.CHIME_RAIL_Y, m = PROPS.CHIME_MASS;
      for (let i = 0; i < nP; i++) {
        const off = nP > 1 ? -span / 2 + (span * i) / (nP - 1) : 0, px = x + cy * off, pz = z + sy * off;
        const box = !!p.box;
        out.push({ thing: t, part: i, kind: box ? KIND_BOX : KIND_CAPSULE, joint: JOINT_HINGE, mu, capAxis: 1, strike: true, c: [px, rail - hang, pz], yaw,
          h: box ? [s[0], s[1], s[2]] : [s[0], Math.max(0, s[1] - s[0]), 0], pivot: [px, rail, pz], axisLocal: 0, inertia: m * hang * hang, damping: p.damping ?? 0.8,
          limitDeg: p.limit ?? 25, mgl: m * GRAVITY * hang, reach: hang });
      }
      return;
    }
    case MECH.ball:
      out.push({ thing: t, part: 0, kind: KIND_SPHERE, joint: JOINT_BALL, mu, capAxis: 0, strike: false, c: [x, s[0], z], yaw: 0, h: [s[0], 0, 0], mass: p.mass ?? 0.2, rollDamp: p.rollDamp ?? 0.6, inertia: p.updraftCatch });
      return;
    case MECH.ramp: {
      // (S2) a box slab sloping DOWN toward its local +x (its top, where a rider is set, at local -x): half sizes size, turned by -angle about its local z after the
      // yaw, its high top edge at p.top (the render's frostbell.ts: centre y = top - hl sin a - ht cos a); p.rails: two capsules RAIL_R along its sides, ht + 0.07 m
      // over its centre line (as drawn). Static: a body on it keeps gravity's part along the slope (D-11) and slides down at the slab's mu.
      const ang = ((p.angle ?? 14) * Math.PI) / 180, top = p.top ?? 0.5, hl = s[0], ht = s[1], hw = s[2];
      const yc = top - hl * Math.sin(ang) - ht * Math.cos(ang);
      out.push({ thing: t, part: 0, kind: KIND_BOX, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x, yc, z], yaw, h: [hl, ht, hw], tilt: -ang });
      if (p.rails) for (const sg of [-1, 1]) out.push({ thing: t, part: sg < 0 ? 1 : 2, kind: KIND_CAPSULE, joint: JOINT_STATIC, mu, capAxis: 0, strike: false, c: [x - sy * hw * sg, yc + ht + 0.07, z + cy * hw * sg], yaw, h: [PROPS.RAIL_R, hl, 0], tilt: -ang });
      return;
    }
    case MECH.pad: {
      // (S2) a flush disc pad (top at y 0 at rest): its collider a box just under the floor (bodies land on the table there); its kick is the world's (zoneStep).
      // (R6) a thing of p.n pads (Cloudloft's three Puff Pads): part i >= 1 at (p.x<i>, p.z<i>) in the wide layout; in the tall layout at (p.tx<i>, p.tz<i>) when the
      // data gives them, else at its wide offset from part 0 (R6_PHYS: a request to PG_DATA)
      const r = s[0], ht = Math.max(0.01, s[1]), np = Math.max(1, Math.min(8, Math.round(p.n ?? 1)));
      for (let i = 0; i < np; i++) {
        let px = x, pz = z;
        if (i > 0) {
          const wx = p['x' + i], wz = p['z' + i], tx = p['tx' + i], tz = p['tz' + i];
          if (tall && tx !== undefined && tz !== undefined) { px = tx; pz = tz; }
          else if (wx !== undefined && wz !== undefined) { px = tall ? x + (wx - d.x) : wx; pz = tall ? z + (wz - d.z) : wz; }
          else continue;
        }
        out.push({ thing: t, part: i, kind: KIND_BOX, joint: JOINT_PAD, mu, capAxis: 0, strike: false, c: [px, -ht - 0.002, pz], yaw, h: [r, ht, r],
          pad: [p.gain ?? 1.1, p.apex ?? 0.3, p.maxBounces ?? 5, p.travel ?? 0.1, r] });
      }
      return;
    }
    case MECH.floater: {
      // (S2) a ring of p.segments capsules (closed) floating on the water it is in (centre at the surface), on a kinematic vertical bob (p.bob m at p.bobHz),
      // anchored in x and z; a body on it rides (a moving support: never corralled, never asleep)
      const R = s[0], r = s[1], nseg = Math.max(3, Math.round(p.segments ?? 6)), y0 = water > 0 ? water : r;
      for (let i = 0; i < nseg; i++) {
        const u0 = yaw + (2 * Math.PI * i) / nseg, u1 = yaw + (2 * Math.PI * (i + 1)) / nseg;
        const x0 = x + R * Math.cos(u0), z0 = z + R * Math.sin(u0), x1 = x + R * Math.cos(u1), z1 = z + R * Math.sin(u1);
        out.push({ thing: t, part: i, kind: KIND_CAPSULE, joint: JOINT_BOB, mu, capAxis: 0, strike: false, c: [(x0 + x1) / 2, y0, (z0 + z1) / 2], yaw: Math.atan2(z1 - z0, x1 - x0),
          h: [r, Math.hypot(x1 - x0, z1 - z0) / 2, 0], bob: p.bob ?? 0, bobHz: p.bobHz ?? 0 });
      }
      return;
    }
    default:
      return;   // patch and zone things (mech 0), ramp, pool, turntable, pad, floater, switch: no collider in this build (see the header)
  }
}
