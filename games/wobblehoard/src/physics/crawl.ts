// R10 LOCOMOTION (owner, 2026-11-19, D-100): a squishy that travels by itself CRAWLS like a slug or a snail instead of gliding as a rigid blob.
// In the props chunk (later-props: softbody.ts's first load is at its cap); a prop world gives each body it tracks one Crawl (props.ts trk) and steps it once
// a frame in beginFrame, before the bodies step. The soft body itself does the crawling, so squishing, grabbing and collisions behave as before:
//   1. the GOAL: a travelling wave of axial strain along the travel direction, in the body's rest frame (SoftBody.crawlD, added to the goal shape in
//      frameUpdate while SoftBody.crawlOn; the rotation is fitted against the rest shape + the wave, SoftBody.crawlF): the front stretches forward and plants, the middle bunches up into an arch as the body shortens (and a little
//      bulge rides with each bunched part), the rear pulls in; the front's upper part lifts a little while it reaches; the body leans into a turn. The phase advances with the distance glided (one cycle per stride),
//      the front leads the rear by 2 kappa, and the field's mass-weighted mean is 0 (the goal stays centred: no drift).
//   2. the GRIP: scootTo's rigid glide stays as it was (its speed, ease, touch gate and target: WHERE and WHEN a squishy goes do not change); once a frame each
//      particle is moved by w x the frame's glide along the travel direction, w = the wave's speed share (-1 planted: the base stays where it is on the ground,
//      +1 reaching: twice the glide). It is a move of X before the frame's substeps (like the glide), so friction never sees it and nothing gains momentum; the
//      wave of the goal is its integral, so the shape matching agrees with it. Averaged over a cycle w is 0: the travel speed is the glide's. CRAWL.beta of the
//      wave's mean over the body at the moment is taken out of the move (the centre surges less; the planted base then slips at about a quarter of the glide).
//   3. the FADE: off under a touch (the touch gate), while held, carried, in a ceremony, floating, in the air for long, in Calm (the shell's world.calm: today's
//      glide) and once the glide stops: the wave eases out and the shape matching brings the body back to its rest shape.
// Per family (CRAWL_FAMILY): stride (body half-lengths per cycle), the phase lead, the grip's sharpness (a square wave plants hard), the bunch's height
// share, the head lift and the arch. Less grip (ice) scales the wave: the base slips. Zero allocation after construction.
// R15 FACING (owner 2026-11-23: "when squishies walk they aren't facing the direction they walk. they need to be able to turn."; R15_FACING.md): measured in the
// browser on the drawn eye beads, the turn of R10 did not do what a player sees: (1) in Calm and under prefers-reduced-motion (world.calm) the whole crawl, its
// turn included, was off, so every walk was a sideways or backward glide with the face to the camera; (2) the glide reached full speed in 0.12 s while the
// body still faced away, so each walk began with a slide sideways or backward; (3) the turn itself was a snap (up to 460 deg/s). Now the TURN is the body's
// own in every mode (Calm keeps no wave: only the turn), the glide is HELD (SoftBody.scootK) while the face is more than acos(CRAWL.holdLo) away from the way and
// eases in as it comes round (it turns, then goes), and the turn is a slug's: the yaw rate eases up and down (CRAWL.yawAcc) to at most CRAWL.yawMax.
import type { SoftBody } from './softbody.ts';

/** per family: stride (half-lengths per cycle), kappa (pi units: the front leads the rear by 2 kappa), sharpness of the grip, the local bunch's height share,
 *  the head lift (half-lengths), the hump (the middle rises as the body shortens: x the length deficit; 1.5 gives the deficit's volume back in height) */
// (R13_FIX 4, owner: "slug / snail movement", VERDICT_R12 (d): the firm and springy families pumped up and down at about 2 Hz, the body 30 % taller and thinner
// and back, more bobbing than a slug) every family but the slime, the jelly and the water-filled one (their look kept, by the owner's word) keeps its stride,
// lead and grip, and now puts the wave's volume into its WIDTH, not its height: the bunch's height share 0.08..0.12 (was 0.3..0.4), the hump 0.25..0.4 (was
// 1.6..1.9: the length deficit's volume went back as height), and the front reaching forward goes LOW (a negative head lift: its upper part dips while it
// reaches). The cycle is capped per family by CRAWL_FMAX (below).
export const CRAWL_FAMILY: Record<string, [number, number, number, number, number, number]> = {
  slowrise: [0.6, 0.6, 2, 0.1, -0.04, 0.3], marshmallow: [0.56, 0.6, 2, 0.12, -0.04, 0.35], mochidough: [0.68, 0.55, 3, 0.08, -0.04, 0.25],
  jellygel: [0.46, 0.65, 1.8, 0.4, 0.08, 1.5], waterfill: [0.48, 0.65, 1.8, 0.4, 0.06, 1.5], putty: [0.75, 0.55, 3, 0.08, -0.04, 0.25],
  stickystretch: [0.58, 0.6, 3.5, 0.1, -0.03, 0.3], slimegoo: [0.5, 0.7, 1.5, 0.4, 0.05, 1.4], firmsilicone: [0.72, 0.55, 2.5, 0.1, -0.05, 0.3],
  popdome: [0.66, 0.55, 2.5, 0.1, -0.05, 0.3], gummy: [0.66, 0.55, 2.5, 0.1, -0.05, 0.3], beadsqueeze: [0.66, 0.55, 3, 0.08, -0.04, 0.25],
};
/** (R13_FIX 4) the fastest crawl cycle per family (Hz): one cycle per stride OR per glide of fMax seconds, whichever is longer (a fast glide on a short body made
 *  the firm families cycle at 1.5 to 2.5 Hz). The firm ones are slow and heavy; the rest at most 1 Hz (the owner's bar: no faster than about 1.1 Hz). A longer
 *  stride grows the wave's travel along the body, so its grip share is taken down by sqrt(stride0 / stride): the strain grows only by the other sqrt. */
/** (R13) the families whose look is kept (the slime, the jelly, the water-filled): when their cycle is capped the grip share is taken down by the WHOLE
 *  stride0 / stride, so the wave's strain (their look) is exactly as before and only slower */
const CRAWL_KEEP: Record<string, boolean> = { jellygel: true, waterfill: true, slimegoo: true };
export const CRAWL_FMAX: Record<string, number> = {
  slowrise: 0.9, marshmallow: 0.9, mochidough: 0.8, jellygel: 1.0, waterfill: 1.0, putty: 0.8, stickystretch: 0.9, slimegoo: 1.0, firmsilicone: 0.9,
  popdome: 0.8, gummy: 0.8, beadsqueeze: 0.8,
};
/** tuning shared by every family (PROBES may set them) */
// (R15 FACING) the turn: the yaw rate eases toward min(yawMax, sqrt(2 yawAcc e), e / yawTau) at most yawAcc rad/s^2 (it speeds up, cruises at 200 deg/s and
// slows to a stop on its heading: 90 deg in about 0.55 s, 180 in about 1.0 s; was a first-order snap at tau 0.12 s, up to 8 rad/s = 460 deg/s); the glide's
// share: 0 while the face is more than acos(holdLo) = 25 deg from the way, full within acos(holdHi) = 8 deg (smoothstep between); arc: the forward creep's share
// of the asked speed while the glide is held (along the face, so it arcs round instead of sliding sideways)
/** (round 15, R15_FIX F5) how long after a hand's let go the squishy may still start its turn back to its rest facing (frames: 5 s) */
const PUT_FRAMES = 300;
export const CRAWL = { vMin: 0.045, vFull: 0.09, tauIn: 0.25, tauOut: 0.15, tauHeld: 0.04, yawTau: 0.15, yawMax: 3.5, yawAcc: 15, holdLo: 0.9063, holdHi: 0.9903, arc: 0.5, arcTau: 0.25, friendGap: 0.02, friendOut: 0.12, friendBy: 0.1, friendIn: 0.25, friendOff: 0.03, friendFit: 0.9, yawGap: 0.03, yawTouch: 0.05, yawWalk: 0.4, bend: 0.14, leanK: 0.5, leanMax: 0.12, airS: 0.25, gripMin: 0.35, beta: 0.35, on: true };
const NT = 256, TAU = Math.PI * 2;

/** the private PropWorld state a crawl reads (props.ts: BF = 12 floats per tracked body, [4] the eased grip multiplier) */
interface World { hNow: number; bsf: Float64Array; bodies: readonly SoftBody[] }
/** the private SoftBody state a crawl reads and moves (as props.ts's zone physics does) */
interface Body {
  n: number; X: Float64Array; Q: Float64Array; M: Float64Array; Mtot: number; qr: Float64Array; cx: number; cz: number;
  scootOn: boolean; sV: number; stx: number; stz: number; heldF: boolean; moveOn: boolean; cyOn: boolean; carried: boolean; gravityOn: boolean; nearCount: number; propNearM: number;
  asleep: boolean; crawlOn: boolean; crawlD: Float64Array; crawlF: Float64Array; V: Float64Array; center: { x: number; y: number; z: number }; chunk: boolean; capFlat: boolean;
  scootK: number; sSpeed: number; bR: number; restRadius: number; meanEdge: number; metrics: { scootBlocks?: number; steering?: boolean };
}

export class Crawl {
  on = false;
  /** after a walk the body turns back to face +Z (the camera's side: as it faces at rest, today) until it does, unless something holds it */
  private turn = false;
  /** (round 15, R15_FIX F5) the hand's put-down: 1 while a hand carries it; from the let go it counts frames (2, 3, ...) until the body has turned back to its
   *  rest facing, walks, or PUT_FRAMES have passed (see step) */
  private put = 0;
  /** (R15 FACING) the glide is held (SoftBody.scootK under 1) by this crawl's turn */
  private hold = false;
  /** (R15 FACING) a friend touches it ahead of its way: it steers round it (see step); side: which way round (+1 / -1 x the friend's left-hand tangent) */
  private blk = false;
  private side = 1;
  private was = false;   // (blk a frame ago)
  private gs = 0;        // (the gap to that friend, smoothed: the crawl's wave moves both skins by centimetres each cycle)
  private fr: Body | null = null;   // (that friend)
  private ext = 0;   // (frames since the extents were measured)
  readonly d: Float64Array;
  /** the rest shape + d (centred): what the body's rotation is fitted against while the crawl is on */
  private readonly f: Float64Array;
  private readonly w: Float64Array;
  /** the rest shape's volume gradient (3 per particle: dV/dq, from the skin's triangles) and 1 / (3 V0): the wave's first-order volume change is taken back
   *  by a uniform scale of the rest shape (the foams' and the beads' volume follows the goal: an uncorrected wave breathed them 10 % in and out) */
  private readonly vg: Float64Array;
  private readonly iv3: number;
  /** the grip wave g(theta) (-1 planted .. 1 reaching) and its integral G (zero mean), interleaved: [g0, G0, g1, G1, ...] over a cycle in NT steps */
  private readonly T = new Float64Array((NT + 1) * 2);
  /** [0] phase, [1] amplitude, [2] ux, [3] uz (the wave's axis: the facing), [4] lean, [5] time in the air, [6..9] the body's extent along the axis and up (rest
   *  frame, every 8th frame: s0, s1, y0, y1), [10] the yaw rate of the turn (rad/s, R15), [11] the forward creep while the glide is held (m/s, R15) */
  readonly s = new Float64Array(12);
  private readonly pf: [number, number, number, number, number, number];
  private readonly fMax: number;
  private readonly keep: boolean;
  private readonly body: SoftBody;
  constructor(body: SoftBody) {
    this.body = body;
    const b = body as unknown as Body;
    this.d = new Float64Array(b.n * 3); this.w = new Float64Array(b.n);
    this.f = Float64Array.from(b.Q);
    b.crawlD = this.d; b.crawlF = this.f; b.crawlOn = false;
    const vg = (this.vg = new Float64Array(b.n * 3)), I = body.indices, Q = b.Q;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = I[t] * 3, c = I[t + 1] * 3, e = I[t + 2] * 3;
      // dV/dqa = (qc x qe) / 6 for each triangle (a, c, e), and its turns
      vg[a] += (Q[c + 1] * Q[e + 2] - Q[c + 2] * Q[e + 1]) / 6; vg[a + 1] += (Q[c + 2] * Q[e] - Q[c] * Q[e + 2]) / 6; vg[a + 2] += (Q[c] * Q[e + 1] - Q[c + 1] * Q[e]) / 6;
      vg[c] += (Q[e + 1] * Q[a + 2] - Q[e + 2] * Q[a + 1]) / 6; vg[c + 1] += (Q[e + 2] * Q[a] - Q[e] * Q[a + 2]) / 6; vg[c + 2] += (Q[e] * Q[a + 1] - Q[e + 1] * Q[a]) / 6;
      vg[e] += (Q[a + 1] * Q[c + 2] - Q[a + 2] * Q[c + 1]) / 6; vg[e + 1] += (Q[a + 2] * Q[c] - Q[a] * Q[c + 2]) / 6; vg[e + 2] += (Q[a] * Q[c + 1] - Q[a + 1] * Q[c]) / 6;
    }
    let v3 = 0;
    for (let i = 0; i < b.n * 3; i++) v3 += vg[i] * Q[i];   // = 3 V0 (Euler: the volume is homogeneous of degree 3)
    this.iv3 = Math.abs(v3) > 1e-12 ? 1 / v3 : 0;
    this.pf = CRAWL_FAMILY[body.family] ?? CRAWL_FAMILY.jellygel;
    this.fMax = CRAWL_FMAX[body.family] ?? 1;
    this.keep = CRAWL_KEEP[body.family] === true;
    const k = this.pf[2], tk = Math.tanh(k), T = this.T;
    for (let i = 0; i <= NT; i++) T[i * 2] = Math.tanh(k * Math.sin((i / NT) * TAU)) / tk;
    let acc = 0, mean = 0;
    for (let i = 0; i <= NT; i++) { if (i > 0) acc += 0.5 * (T[i * 2 - 2] + T[i * 2]) * (TAU / NT); T[i * 2 + 1] = acc; if (i < NT) mean += acc / NT; }
    for (let i = 0; i <= NT; i++) T[i * 2 + 1] -= mean;
  }
  /** once a frame (props.ts beginFrame), before the body steps: w the world (its frame step hNow, and tracked body i's eased grip multiplier bsf[i x 12 + 4], 1 = the
   *  felt), calm = today's glide. (No double is passed in: doubles passed to a call that is not inlined are boxed, a HeapNumber a call; and an idle crawl returns
   *  before any arithmetic on doubles, so the call costs nothing while this method is not yet optimised: a body that does not walk calls it every frame.) */
  step(w: World, i: number, calm: boolean): void {
    const b = this.body as unknown as Body, S = this.s;
    // (R13_FIX 6, owner: "when Float starts each squishy slowly turns to face the camera so none floats edge-on with its face hidden") a FLOATING body, once its
    // crawl has let go (it fades under the gate below first), turns slowly back to face +Z, the camera's side, as a walk's end does on the floor
    if (this.hold && (b.asleep || !b.scootOn || b.heldF || !b.gravityOn)) { this.hold = false; b.scootK = 1; }   // (R15: a held glide is let go once nothing walks)
    if (this.blk && (b.asleep || !b.scootOn || b.heldF || !b.gravityOn)) { this.blk = false; this.fr = null; b.metrics.steering = false; }   // (and so is the way round a friend)
    // (round 15, R15_FIX F5; VERDICT_R14 F5 "a squishy set at the Glide Ramp's top stays there") a squishy the hand picked up while it was turned (in the middle
    // of a walk) was left as it was let go: turned across Frostbell's Glide Ramp (a 0.9 m channel between its rails) a long squishy wedged on the rails, set down
    // or dropped (crimpo at -116, -90 and 60 degrees: 0.1 m; at 0 and -45: 2.1 to 3.1 m; the live build never turns one, so its drop always glides). Once the hand
    // lets go it turns back to its rest facing (+Z), as a walk's end does: on the ground, or (this turn only) standing on a thing.
    // (The turn is asked again each frame until it is done: the frame after the let go the finger still counts as on it, which ends a turn.)
    // (Not a floater: it has its own slow turn, floatFace. And only while something bears it: turning in the air through Table's gentle descent kept a
    // party from coming to rest in time: probe_float F4, F8.)
    if (b.carried) this.put = 1; else if (this.put !== 0) { if (!b.gravityOn || ++this.put > PUT_FRAMES) this.put = 0; else this.turn = true; }
    if (!b.gravityOn && !this.on) { S[5] = 0; S[10] = 0; S[11] = 0; this.turn = false; if (!b.asleep) this.floatFace(b, w.hNow); return; }
    // (R15 FACING: Calm and CRAWL.on no longer stop the TURN; they stop the wave below)
    if (b.asleep || (!this.on && !this.turn && (!b.scootOn || b.heldF))) { S[5] = 0; S[10] = 0; S[11] = 0; return; }   // (`on` mirrors s[1] > 0: an element of a Float64Array read by code not yet optimised is a HeapNumber)
    const n = b.n, dt = w.hNow, grip = w.bsf[i * 12 + 4];
    if (!(dt > 0)) return;
    const tx = b.stx - b.cx, tz = b.stz - b.cz, tl = Math.sqrt(tx * tx + tz * tz);
    const go = b.scootOn && tl > 0.03;   // (a glide that has arrived keeps a creep of speed at its target: no crawl there)
    let v = go ? b.sV : 0;
    // free: nothing holds or drives it, so it turns to its way (in every mode); crawls: it may also crawl (not in Calm or reduced motion, not with the module off)
    const free = !b.heldF && !b.moveOn && !b.cyOn && !b.carried && b.gravityOn, crawls = free && CRAWL.on && !calm;
    S[5] = b.nearCount > 0 ? 0 : S[5] + dt;
    const ground = S[5] < CRAWL.airS;
    // ---- FACING: a slug leads with its head. The body's front is its rest +Z (where the face is: render/wholeRef.ts); while it walks it turns toward the
    // heading (the glide's target), after the walk back to +Z (as it faces at rest), by a smooth yaw of the whole body about its centre (a move of X and V
    // like the glide: no momentum; the rotation the shape matching fits turns with it). Its front bends toward the turn first (the goal's `bend`, below).
    // A cut piece (a cut face, or the legacy eyeless chunk) does not turn: its wave runs along a facing of its own that turns the same way (the piece keeps its
    // orientation, as it does today: a half turned 90 degrees put its cut face along the wave, and its foot creased past 120 degrees once a cycle).
    const q = b.qr, real = !b.chunk && !b.capFlat;
    let qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    let fx = real ? 2 * (qx * qz + qw * qy) : S[2], fz = real ? 1 - 2 * (qx * qx + qy * qy) : S[3];   // R (0, 0, 1) on the floor: the facing
    const hx = go ? tx / tl : 0, hz = go ? tz / tl : 1;
    // (R15 FACING / R15_CLOSE 1: Home with 3 out, the p90 of 158 deg) a walk into a FRIEND (another body this world tracks, often asleep) pressed on it: the
    // glide is a move of X with no momentum, the two soft bodies' contact answered each step, and the walker was thrown back or aside with its face ahead (1-7 cm
    // pulses, once a crawl cycle with the wave on). Measured in the browser (R15_CLOSE.md): pushing on slowly with no wave (CRAWL.pushV 0.12, the cut-off
    // edit) still went backward (Home desk self-powered p90 55 deg, a puddlo 9 s against a friend with 20 % of its samples backward); stopping there cost LIFE
    // its uses (probe_life_selfuse SU-04/05/06). So it STEERS ROUND: a friend touching it anywhere ahead of its way (not yet beside it: CRAWL.friendIn, so a friend it would only brush past is given room
    // too: a brush shoved it 5 cm aside with its face ahead; bounding spheres, then
    // both bodies' horizontal particle support + collide's skin + 2 frames of glide + friendGap) holds the glide (which runs straight at the target), and its
    // way becomes the tangent round the friend on its target's side, leaning out while it presses and in while it is clear (it follows the friend's side
    // at the gap), until the friend is beside it (CRAWL.friendBy) or left behind (the gap + CRAWL.friendOut); the forward creep along its face (at the walk's
    // own speed here, only once it faces within 45 deg of that way: it stops, turns, goes) carries it round. A target it cannot stand on (the friend is on it)
    // is gone round to its nearest point, where it stops (below). metrics.steering tells the host (LIFE does not count the way round as "no progress"). LIFE's contact approach (<= 0.05 m/s) still touches.
    // gmin: the nearest friend's skin gap on any side (raw), for the turn below.
    let blk = false, stuck = false, wx = hx, wz = hz, gmin = 1;
    // (Between WHOLE squishies only: a cut squishy's pieces walk into each other on purpose (they come back together, a carried piece is held against
    // another), and a piece has no face to lead with: probe_partycut M5 failed with pieces steered round.)
    if (real && free && (go || this.turn || this.put > 1)) {
      const OB = w.bodies, hd = b.center, walk = go && b.sSpeed > 0.05;
      // (the friend in its way: the one whose skin is nearest; the one it is already going round is kept unless another is 3 cm nearer)
      let fo: Body | null = null, fg = 1e9, fgap = 0, fnx = 0, fnz = 0, fdh = 0;
      for (let k = 0; k < OB.length; k++) {
        const o = OB[k] as unknown as Body;
        if (o === b || o.chunk || o.capFlat) continue;
        const mine = this.blk && o === this.fr;
        const dx = o.center.x - hd.x, dy = o.center.y - hd.y, dz = o.center.z - hd.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), dh = Math.sqrt(dx * dx + dz * dz);
        const gap = CRAWL.friendGap + 0.25 * (b.meanEdge + o.meanEdge) + 2 * b.sSpeed * dt;
        // (the bounding spheres: collide's bR, the farthest particle from the centre; a body no collide has measured yet (bR 0) is taken as 1.5 rest radii: a
        // resting body sags wider than its rest radius, and the rest radius alone let a friend 1 cm away pass as apart)
        const rr = (b.bR > 0 ? b.bR : 1.5 * b.restRadius) + (o.bR > 0 ? o.bR : 1.5 * o.restRadius) + gap + (mine ? CRAWL.friendOut : 0);
        if (!(d < rr) || dh < 0.3 * rr) continue;   // (apart; or one stands on the other: there is no side to go round)
        const nx = dx / dh, nz = dz / dh, ah = nx * hx + nz * hz;
        let sg = dh - support(b, nx, 0, nz) - support(o, -nx, 0, -nz);   // (the horizontal gap between the two skins along the line of centres)
        if (sg < gmin) gmin = sg;
        if (!walk || ah <= (mine ? CRAWL.friendBy : CRAWL.friendIn)) continue;   // (beside it or behind: its way is clear of this one)
        // (the friend it goes round: the gap is read smoothed over 0.3 s: the crawl's wave moves both skins 3-6 cm each cycle, and a way that followed the raw
        // gap wagged the face left and right at 2-3 rad/s (measured: 33 of a slime's 150 self-powered samples over 30 degrees off its travel))
        if (mine) { this.gs += (sg - this.gs) * (1 - Math.exp(-dt / 0.3)); sg = this.gs; }
        if (sg >= gap + (mine ? CRAWL.friendOut : 0)) continue;
        if (sg - (mine ? 0.03 : 0) < fg) { fg = sg - (mine ? 0.03 : 0); fo = o; fgap = gap; fnx = nx; fnz = nz; fdh = dh; }
      }
      if (fo !== null) {
        const o = fo, nx = fnx, nz = fnz, fresh = !(this.blk && o === this.fr);
        blk = true;
        if (fresh) { this.fr = o; this.gs = fg; }
        const sg = this.gs;
        const cr = hx * -nz + hz * nx;   // (the heading's share along the friend's left-hand tangent (-nz, nx))
        const ex = b.stx - o.center.x, ez = b.stz - o.center.z, sum = CRAWL.friendFit * (fdh - sg), far = ex * ex + ez * ez >= sum * sum;   // (far: it could stand on its target beside this friend: the target is at least friendFit (0.9) of the two bodies' reach from the friend's centre)
        if (fresh) this.side = cr >= 0 ? 1 : -1;
        // (a target it cannot stand on without moving the friend (see far): it goes round to the point nearest its target (the friend's side toward the
        // target, from whichever side that is) and STOPS there facing it; LIFE's blocked rule ends the walk (near enough still acts). The slow push that
        // was here (CRAWL.pushV 0.12 or 0.05, no wave) still went backward: browser, Home 3 out, 56 of 62 self-powered samples over 60 degrees were pushes.
        // LIFE no longer sends a walk to a spot a friend stands on (life/act.ts travelTo takes the free spot beside it), so this is the rare case of a
        // friend that came to the spot after the walk began.)
        if (!far) { if (cr < 0.26 && cr > -0.26) stuck = true; else if (!fresh) this.side = cr >= 0 ? 1 : -1; }
        if (stuck) { /* stopped: its way stays its heading */ }
        else {
          const tx2 = -nz * this.side, tz2 = nx * this.side;
          // (leans out while nearer than the gap + friendOff, in while farther: gently, 0.3 at 5 cm; out harder (35 deg) while it presses. TRIED AND TAKEN
          // BACK: a wider berth and hold (friendOff 0.07, friendOut 0.35, the lean in up to 39 deg) took a putty round in one arc in probe_crawl CR-17, but with
          // it probe_life_selfuse lost SU-06 (3 of 4) and SU-05: walkers held on to friends too long. With these values a long body goes round in a
          // staircase: it lets go when its turn along the friend opens the gap, turns back at its target and meets the friend again (the putty: 3 times).)
          let kn = (sg - fgap - CRAWL.friendOff) * 6; kn = kn > 0.35 ? 0.35 : kn < -0.7 ? -0.7 : kn;
          wx = tx2 + nx * kn; wz = tz2 + nz * kn;
          const wl = Math.sqrt(wx * wx + wz * wz); wx /= wl; wz /= wl;
        }
      }
    }
    if (!blk) this.fr = null;
    if (b.metrics.steering !== (blk && !stuck)) b.metrics.steering = blk && !stuck;
    this.was = this.blk; this.blk = blk;
    if (!real && fx * fx + fz * fz < 0.25) { fx = hx; fz = hz; }
    const fl = Math.sqrt(fx * fx + fz * fz);
    let e = 0, rate = 0;
    if (go && free && real) this.turn = true;
    if (fl > 0.5) {   // (upright enough to have a facing: a body on its side is not turned)
      fx /= fl; fz /= fl;
      e = Math.atan2(fx * wz - fz * wx, fx * wx + fz * wz);   // the way's angle from the facing (+: toward the facing's left, (-fz, fx)); the way is the heading, or the way round a friend in it
      // (R15: after the walk it turns back once the glide's last centimetres are done: turning while that creep ran carried it a few cm sideways)
      if (this.put > 1 && (go || (e < 0.03 && e > -0.03))) this.put = 0;
      if (free && (this.put > 1 ? b.nearCount > 0 || b.propNearM > 0 : ground) && (go || (this.turn && !(b.scootOn && b.sV > 0.03)))) {
        // (R15) the yaw rate wy eases (at most yawAcc) toward the rate that still stops on the heading: it speeds up, cruises at yawMax, slows down
        const ae = e < 0 ? -e : e, r1 = Math.sqrt(2 * CRAWL.yawAcc * ae), r2 = ae / CRAWL.yawTau;
        let wt = r1 < r2 ? r1 : r2;
        // (R15_CLOSE 1) a turn beside a friend gives way to it: the yaw is a move of X (nothing resists it), and a long body turning at full rate swept its end
        // 18 cm into the friend beside it in 0.2 s (measured, Home, 3 out: a walk's end turning back to its rest facing; both were thrown 0.3-0.4 m/s). The rate's
        // cap falls with the nearest friend's skin gap: full from CRAWL.yawGap (3 cm) clear, down to CRAWL.yawTouch of it (0.05: 10 deg/s, never held for good) at 1 cm
        // of overlap for a turn at rest, and to CRAWL.yawWalk (0.4: 80 deg/s) for a walker's turn to its way (at 10 deg/s a walker a friend pressed on took 7 s to
        // turn 100 degrees, and LIFE's next plan ended its walk short: probe_life_selfuse SU-06).
        const yf = go ? CRAWL.yawWalk : CRAWL.yawTouch, yk = (gmin + 0.01) / (CRAWL.yawGap + 0.01), ym = CRAWL.yawMax * (yk >= 1 ? 1 : yk <= yf ? yf : yk);
        if (wt > ym) wt = ym;
        if (e < 0) wt = -wt;
        const dw = CRAWL.yawAcc * dt;
        let wy = S[10];
        wy = wt > wy + dw ? wy + dw : wt < wy - dw ? wy - dw : wt;
        let dl = wy * dt;
        if ((e >= 0 && dl > e) || (e < 0 && dl < e)) { dl = e; wy = 0; }   // (never past its heading)
        S[10] = wy;
        if (!go && e < 0.03 && e > -0.03) this.turn = false;
        const c = Math.cos(dl), sn = Math.sin(dl);
        if (real && (e > 0.009 || e < -0.009)) {   // (within half a degree of its way it is not turned: a pass over the particles each frame for nothing)
          const ox = b.center.x, oz = b.center.z, X = b.X, V = b.V;
          for (let j = 0; j < n * 3; j += 3) {
            const x = X[j] - ox, z = X[j + 2] - oz, vx = V[j], vz = V[j + 2];
            X[j] = ox + x * c - z * sn; X[j + 2] = oz + x * sn + z * c; V[j] = vx * c - vz * sn; V[j + 2] = vx * sn + vz * c;
          }
          // (the fitted rotation turns by the same yaw, about -y in this sense: its next fit starts there)
          const c2 = Math.cos(0.5 * dl), s2 = Math.sin(0.5 * dl);
          const nx = c2 * qx - s2 * qz, ny = c2 * qy - s2 * qw, nz = c2 * qz + s2 * qx, nw = c2 * qw + s2 * qy;
          q[0] = nx; q[1] = ny; q[2] = nz; q[3] = nw; qx = nx; qy = ny; qz = nz; qw = nw;
        }
        const gx = fx * c - fz * sn, gz = fx * sn + fz * c;
        fx = gx; fz = gz; e -= dl; rate = dl / dt;
      } else { S[10] = 0; if (!free) this.turn = false; }   // (a hand took it: it stays as it is left)
    } else { S[10] = 0; if (!go) this.turn = false; }
    // (R15 FACING) the glide waits for the face: none while it faces more than 25 degrees from its way, full within 8 (a cut piece and a body on its side
    // have no face to lead with: their glide is as before; nor is a body off the ground, which cannot turn: a floater in a pool glides as before). The glide's speed now is capped at once (a walk retargeted 90 degrees on its way does not run
    // on sideways while it eases out: it stops, turns, goes)
    let kq = 1;
    if (blk) kq = 0;   // (the glide runs straight at the target, through the friend: held while it goes round, and where it has stopped at it)
    else if (go && free && real && fl > 0.5 && ground) { const ch = (Math.cos(e) - CRAWL.holdLo) / (CRAWL.holdHi - CRAWL.holdLo); kq = ch >= 1 ? 1 : ch <= 0 ? 0 : ch * ch * (3 - 2 * ch); }
    let lost = 0;
    if (kq < 1 || this.hold) { b.scootK = kq; this.hold = kq < 1; if (kq < 1 && b.sV > b.sSpeed * kq) { lost = b.sV - b.sSpeed * kq; b.sV = b.sSpeed * kq; } }
    // ... and while the glide is held it creeps FORWARD, along its face, as it turns (a slug turns on the move: it arcs round to its way and leans into it), from
    // nothing with its way 90 degrees or more off to CRAWL.arc of the asked speed within 30, handing over to the glide as it comes round; the speed the held glide
    // gives up (a walk retargeted on its way) carries on forward and eases into that (time constant CRAWL.arcTau): no stop dead, no slide sideways; a move of X
    // like the glide
    if ((kq < 1 || S[11] > 0) && ground && go && free) {
      // (round a friend: at the walk's own speed, and only once it faces within 45 degrees of the way round (full within 15): it does not creep into the friend
      // while it turns, and the speed the glide gave up is not carried on into it)
      const cf = blk ? (Math.cos(e) - 0.7071) * 3.866 : Math.cos(e) * 1.1547, sf = cf >= 1 ? 1 : cf <= 0 ? 0 : cf * cf * (3 - 2 * cf);
      const vt = stuck ? 0 : b.sSpeed * (1 - kq) * (blk ? 1 : CRAWL.arc) * sf;
      // (where it stops at a friend the glide's speed runs out forward over 0.1 s (2-3 cm, inside the gap it stopped at): stopped dead, the wave let go all at
      // once and the body's middle settled 3 cm back)
      let vf = blk && !stuck && !this.was ? 0 : S[11] + lost;
      vf += (vt - vf) * (1 - Math.exp(-dt / (stuck ? 0.1 : CRAWL.arcTau)));
      if (vf > b.sSpeed - b.sV) vf = b.sSpeed - b.sV;   // (with the glide, never faster than the asked speed)
      if (vf < 0.002) vf = 0;
      S[11] = vf;
      if (vf > 0) {
        const mx = fx * vf * dt, mz = fz * vf * dt, X = b.X;
        for (let j = 0; j < n * 3; j += 3) { X[j] += mx; X[j + 2] += mz; }
        b.cx += mx; b.cz += mz;
      }
      v = b.sV + vf;
    } else { S[11] = 0; v = go ? b.sV : 0; }
    // (no crawl under vMin: LIFE's contact approach, the last centimetres at 0.04 m/s, glides as before; full from vFull; and none while it still faces
    // more than 35 degrees away from its way, full within 12: it turns first (R15: was 53 and 18; the wave running on a body still coming round on its forward
    // creep bent it sideways: the firm families' centre drifted 40-50 degrees off the face))
    const u0 = (v - CRAWL.vMin) / (CRAWL.vFull - CRAWL.vMin), ce = (Math.cos(e) - 0.82) / 0.158, al = fl > 0.5 ? (ce >= 1 ? 1 : ce <= 0 ? 0 : ce * ce * (3 - 2 * ce)) : 1;
    const want = crawls && ground && !stuck && u0 > 0 ? (u0 >= 1 ? 1 : u0 * u0 * (3 - 2 * u0)) * al : 0;
    let a = S[1];
    const fresh = a === 0;
    a += (want - a) * (1 - Math.exp(-dt / (!free ? CRAWL.tauHeld : want > a ? CRAWL.tauIn : CRAWL.tauOut)));
    if (want === 0 && a < (free ? 0.03 : 0.08)) a = 0;   // (the last few per cent of the wave are millimetres: let go)
    S[1] = a;
    if (a === 0) { if (this.on) { this.on = false; b.crawlOn = false; this.d.fill(0); S[4] = 0; } return; }
    this.on = true; b.crawlOn = true;
    if (fresh) S[0] = 0;
    // ---- the wave's axis: the facing (the face end is the front that stretches and plants); the lean follows the yaw rate while it crawls (x a: the turn on the spot
    // at the start of a walk does not lean: leaning there rolled the body and drifted it 20 degrees off its way)
    const ux = fl > 0.5 ? fx : hx, uz = fl > 0.5 ? fz : hz;
    S[2] = ux; S[3] = uz;
    // (R15: x the glide's share kq: while it still comes round on its forward creep it does not lean (leaning there rolled the body and drifted it off its face))
    const lw = CRAWL.leanK * rate * v * a * kq, lt = lw > CRAWL.leanMax ? CRAWL.leanMax : lw < -CRAWL.leanMax ? -CRAWL.leanMax : lw;
    S[4] += (lt - S[4]) * (1 - Math.exp(-dt / 0.2));
    const bend = CRAWL.bend * (e > 1 ? 1 : e < -1 ? -1 : e);   // (the front swings toward the heading first: x the remaining yaw, saturating at a radian)
    // ---- the rest frame (the body's rotation from the last substep): travel u, up and lateral (u x up) in rest coordinates
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    const sux = r00 * ux + r20 * uz, suy = r01 * ux + r21 * uz, suz = r02 * ux + r22 * uz;     // R^T (ux, 0, uz)
    const yx = r10, yy = r11, yz = r12;                                                       // R^T (0, 1, 0)
    const lx = -r00 * uz + r20 * ux, ly = -r01 * uz + r21 * ux, lz = -r02 * uz + r22 * ux;   // R^T (-uz, 0, ux)
    const Q = b.Q, M = b.M, X = b.X, D = this.d, W = this.w, T = this.T;
    if (fresh || (++this.ext & 7) === 0) {   // (the body's extents along the axis and up: on the first frame and every 8th (they move only as it turns or bends))
      let s0 = 1e9, s1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (let i = 0; i < n * 3; i += 3) {
        const s = Q[i] * sux + Q[i + 1] * suy + Q[i + 2] * suz, y = Q[i] * yx + Q[i + 1] * yy + Q[i + 2] * yz;
        if (s < s0) s0 = s; if (s > s1) s1 = s; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      S[6] = s0; S[7] = s1; S[8] = y0; S[9] = y1;
    }
    const sh = 0.5 * (S[7] - S[6]) > 1e-4 ? 0.5 * (S[7] - S[6]) : 1e-4, sm = 0.5 * (S[6] + S[7]), y0 = S[8], ht = S[9] - y0 > 1e-4 ? S[9] - y0 : 1e-4;
    const pf = this.pf, stride0 = pf[0] * sh, sCap = v / this.fMax, stride = sCap > stride0 ? sCap : stride0, kap = pf[1] * Math.PI, bul = pf[3];
    const gr = grip >= 1 ? 1 : grip <= 0 ? CRAWL.gripMin : CRAWL.gripMin + (1 - CRAWL.gripMin) * grip;
    // ---- the phase: one cycle per stride of glide (frozen in the air: nothing is planted there)
    const ds = ground ? v * dt : 0;
    let th = S[0] + (TAU * ds) / stride;
    if (th > TAU) th -= TAU;
    S[0] = th;
    const amp = a * gr * (this.keep ? stride0 / stride : Math.sqrt(stride0 / stride)), aD = (amp * stride) / TAU, aE = (aD * kap) / sh;   // axial offset per unit of G; strain per unit of g (R13: the grip share x sqrt(stride0 / stride))
    const ti = NT / TAU, ish = 1 / sh, iht = 1 / ht, lift = a * pf[4] * sh, lean = S[4], pB = kap * ish * ti, pA = th * ti - pB * sm, bl = 1 - bul;
    // (the hump: the middle rises while the body is short, the inchworm's arch, and flattens while it reaches)
    const lenRel = (tab(T, (th + kap) * ti, 1) - tab(T, (th - kap) * ti, 1)) * aD * 0.5 * ish, hump = -pf[5] * lenRel;
    const VG = this.vg;
    let mx = 0, my = 0, mz = 0, wm = 0, dv = 0;
    for (let i = 0, j = 0; i < n * 3; i += 3, j++) {
      const qx_ = Q[i], qy_ = Q[i + 1], qz_ = Q[i + 2];
      const sr = qx_ * sux + qy_ * suy + qz_ * suz, yw = qx_ * yx + qy_ * yy + qz_ * yz, la = qx_ * lx + qy_ * ly + qz_ * lz;
      const sg = (sr - sm) * ish, yr = yw - y0;
      // (the wave tables at this particle's phase (th + kappa sg) in table steps, wrapped into one cycle: th is in [0, 2 pi) and kappa under pi)
      const p0 = pA + pB * sr, p = p0 < 0 ? p0 + NT : p0 >= NT ? p0 - NT : p0, k0 = p | 0, fk = p - k0, t2 = k0 * 2;
      const gi = T[t2] + (T[t2 + 2] - T[t2]) * fk, ax = aD * (T[t2 + 1] + (T[t2 + 3] - T[t2 + 1]) * fk), ep = aE * gi;
      let dy = (hump * (1 - sg * sg) - ep * bul) * yr;
      if (sg > 0.2 && gi > 0) { const fr = (sg - 0.2) * 1.25, hh = yr * iht; dy += lift * fr * fr * gi * hh * hh; }   // (the head lift: the front's upper part, while it reaches)
      const dl = lean * yr - ep * bl * la + (sg > 0 ? bend * sg * sg * sh : 0);
      const ox = ax * sux + dy * yx + dl * lx, oy = ax * suy + dy * yy + dl * ly, oz = ax * suz + dy * yz + dl * lz;
      D[i] = ox; D[i + 1] = oy; D[i + 2] = oz;
      dv += VG[i] * ox + VG[i + 1] * oy + VG[i + 2] * oz;
      const m = M[j], wi = amp * gi;
      mx += m * ox; my += m * oy; mz += m * oz;
      W[j] = wi; wm += m * wi;
    }
    const iM = 1 / b.Mtot;
    mx *= iM; my *= iM; mz *= iM; wm *= iM;
    // ---- the goal's wave about the centre (mean 0), and the grip: this frame's share of the wave, moved like the glide (before the substeps: friction never sees it)
    const ex = ux * ds, ez = uz * ds, wb = CRAWL.beta * wm;
    const vs = -dv * this.iv3;   // (the uniform scale that gives the wave's volume change back; the scaled rest shape has mean 0)
    const F = this.f;
    for (let i = 0, j = 0; i < n * 3; i += 3, j++) {
      D[i] += vs * Q[i] - mx; D[i + 1] += vs * Q[i + 1] - my; D[i + 2] += vs * Q[i + 2] - mz;
      F[i] = Q[i] + D[i]; F[i + 1] = Q[i + 1] + D[i + 1]; F[i + 2] = Q[i + 2] + D[i + 2];
      const k = W[j] - wb; X[i] += k * ex; X[i + 2] += k * ez;
    }
    b.cx += (wm - wb) * ex; b.cz += (wm - wb) * ez;
  }
  /** R13: while floating (and nothing holds or drives it) the whole body yaws about its centre toward facing +Z (a move of X and V, as the crawl's own turn,
   *  and the fitted rotation turns with it); a cut piece and a body on its side are not turned */
  private floatFace(b: Body, dt: number): void {
    if (!(dt > 0) || b.heldF || b.moveOn || b.cyOn || b.carried || b.chunk || b.capFlat) return;
    const q = b.qr;
    const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const fx = 2 * (qx * qz + qw * qy), fz = 1 - 2 * (qx * qx + qy * qy), fl = Math.sqrt(fx * fx + fz * fz);
    if (fl < 0.5) return;
    const e = Math.atan2(fx / fl, fz / fl);   // (the angle of +Z from the facing, as the crawl's e with the heading (0, 1))
    if (e < 0.02 && e > -0.02) return;
    const mx = FLOAT_FACE_MAX * dt, k = e * (1 - Math.exp(-dt / FLOAT_FACE_TAU)), dl = k > mx ? mx : k < -mx ? -mx : k;
    const c = Math.cos(dl), sn = Math.sin(dl), ox = b.center.x, oz = b.center.z, X = b.X, V = b.V, n = b.n;
    for (let j = 0; j < n * 3; j += 3) {
      const x = X[j] - ox, z = X[j + 2] - oz, vx = V[j], vz = V[j + 2];
      X[j] = ox + x * c - z * sn; X[j + 2] = oz + x * sn + z * c; V[j] = vx * c - vz * sn; V[j + 2] = vx * sn + vz * c;
    }
    const c2 = Math.cos(0.5 * dl), s2 = Math.sin(0.5 * dl);
    q[0] = c2 * qx - s2 * qz; q[1] = c2 * qy - s2 * qw; q[2] = c2 * qz + s2 * qx; q[3] = c2 * qw + s2 * qy;
  }
}
/** R13: a floater's slow turn back to face the camera's side (+Z): yaw time constant FLOAT_FACE_TAU s, at most FLOAT_FACE_MAX rad/s */
const FLOAT_FACE_TAU = 0.9, FLOAT_FACE_MAX = 1.2;
/** (R15) the farthest a body's particles reach from its centre along the unit (ux, uy, uz) */
function support(b: Body, ux: number, uy: number, uz: number): number {
  const X = b.X, cx = b.center.x, cy = b.center.y, cz = b.center.z, n3 = b.n * 3;
  let m = 0;
  for (let i = 0; i < n3; i += 3) { const s = (X[i] - cx) * ux + (X[i + 1] - cy) * uy + (X[i + 2] - cz) * uz; if (s > m) m = s; }
  return m;
}
/** table T at p (cycle steps, any real), column c (0 g, 1 G) */
function tab(T: Float64Array, p: number, c: number): number {
  let x = p % NT;
  if (x < 0) x += NT;
  const i = x | 0, f = x - i, o = i * 2 + c;
  return T[o] + (T[o + 2] - T[o]) * f;
}
