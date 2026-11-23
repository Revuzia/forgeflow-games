// ROUND 14 (R14_ROOMS, D-104; the owner 2026-11-23: "Make sq footage of rooms wider and volume bigger to allow easier exploration for our squishies"): THE ROOM
// CAMERA. The rooms are 2.6 times the floor, so the camera can no longer show a whole place at a readable size: it frames WHERE THE PARTY IS, follows the squishy in
// hand, lets the player look around (pan) and zoom from the whole room to a close view, and scrolls when a squishy is carried to the frame's edge.
// Pure (no three, no DOM): the stage (render/stage.ts, first-load) keeps its two rigs and only reads this module's eased VIEW; node checks call it directly.
// Lazy: it ships in the later-lifelook chunk (render/lifelook.ts re-exports it), which the stage loads when the LIFE host first needs it.
//
// THE VIEW is a point on the floor and a factor: (x, z, u). u = 1 is the whole room; a view of factor u shows the part of the room u times its size around (x, z).
//   A PLACE (the stage's `play` rig): the whole-room framing is placeview.ts fitPlace of the room's bounds (aim A, distance D, its lens and pitch); the view is the
//     similar picture about its own centre: aim = (x, 0, z) + u (A - C0), distance = u D, so what was inside the HUD rows for the whole room is inside them for the
//     part. u = ROOM_K (0.62) is exactly the LIVE game's size (the live rooms were 0.62 of these on each side).
//   HOME with two or more out (the stage's own rig): the view is Home's framing scale: want = u x R / hwPer (R = the felt's radius in metres, hwPer = the half
//     width a framing of 1 shows), aimed at (x, z). One squishy alone at Home never comes here: the published camera, bit for bit.
// BY ITSELF (nobody touches the camera): the view holds the party's LIVE box (every visible body, pieces too, with ROOM_CAM.pad around it), never closer than `near`
//   (today's size) and never further than `far` (72 % of today's size: the owner's floor for a readable squishy is about 70 %). It widens quickly and narrows slowly (after
//   inWaitS of a smaller box), so a walk does not pump the zoom. When the party does not fit at `far`, the LEAD stays in view (the squishy the player touched last,
//   else the play squishy) and the others are hinted by the shell (shell/later-room.ts: a chip at the frame's edge; a tap = focus()).
// IN HAND (a finger on a body, a carry, a toss until it lies still): the view stops re-centring and follows the hand: while the held body is within `edge` of the
//   frame's safe band nothing moves; past it the view scrolls that way (up to edgeV m/s at the band's rim), so one carry reaches any spot of the room. `scroll` is
//   true on the frames the view moved under a hand: the shell then asks the hand's target again (the body stays under the finger).
// THE PLAYER: zoom() (wheel, pinch) sets the factor between `close` and the whole room and it STAYS (the centre still follows the party); pan() (two fingers, or
//   Shift + the right button) moves the centre and holds for panHoldS, then eases back; focus() (a chip) centres a squishy for focusS. A new room resets all three.
// No allocation per frame.
import { ROOM_K } from './placeview.ts';

/** Home's room: the felt's radius in metres (src/data/place_home.ts bounds.r; render/table.ts draws the mat 0.1 m wider; probe_pg_data pins the three). */
export const HOME_R = 5.5;

export const ROOM_CAM = {
  /** by itself: the closest view (today's size) and the widest (72 % of today's size: the owner's floor is "about 70 %", kept with a little to spare); the
   *  player's closest */
  near: ROOM_K, far: ROOM_K / 0.72, close: 0.36, floor: 0.72,
  /** metres kept around every body in the party's box, on a view whose closest half width is padRef m or more (a narrower one, a phone's, keeps a
   *  proportional share, never under padMin of it: 0.8 m each side of a party is most of a phone's frame); the lead keeps leadPad of the view's edge clear */
  pad: 0.8, padRef: 2.4, padMin: 0.4, leadPad: 0.5,
  /** the factor widens with tauOut, narrows with tauIn once the box has been under inBand of it for inWaitS; the centre eases with tauC (tauHeld under a hand) */
  tauOut: 0.5, tauIn: 1.5, inWaitS: 2.5, inBand: 0.86, tauC: 0.55, tauHeld: 0.16, tauU: 0.35,
  /** in hand: the share of the safe band (from its middle) where nothing scrolls, where the scroll is at full speed, and that speed (m/s at the `far` view) */
  edge: 0.56, edgeFull: 0.94, edgeV: 3.2,
  /** ... and the same for the FINGER that holds the body (its share of the band from the middle): a squishy lifted high hangs well under the finger on screen (the
   *  hand's height at the pick-up is kept), so the finger reaches the frame's edge long before the body's middle does */
  edgeP: 0.72, edgePFull: 0.96,
  /** in hand the view may pass the room's BACK edge by overK x the held body's height / tan(pitch), overMax m at most: at that height the frame's top edge
   *  points that much nearer than it does on the floor, so without it a squishy lifted high (1.4 m when it is picked up at the front) stopped 2 m short of the
   *  back wall: the finger was on the frame's edge and the view at the room's */
  overK: 1.4, overMax: 3,
  /** a pan holds this long after the last pan input, then eases away; a chip's focus lasts focusS */
  panHoldS: 6, panTau: 0.7, focusS: 8,
  /** Home's rig: what a metre of depth costs against a metre of width (stage.ts framingFor: 0.35 on a wide frame, 0.12 on a portrait one) */
  homeDepthWide: 0.35, homeDepthTall: 0.12,
  /** Home's rig at the whole-room view, on a wide and on a portrait frame: the pitch added (rad), and how far the aim moves toward the camera (m). With them the
   *  whole felt (r 5.5 m) stands inside the frame between the HUD bands at 1280 x 800 and 390 x 844 (probe_pg_data's Home rows) */
  homeLiftWide: 0.25, homeLiftTall: 0.6, homeAheadWide: 2.75, homeAheadTall: 0.5,
  /** Home's rig: past this share of the way from the widest own view to the whole felt, the band framing measures nobody (no lens shift, no demand) */
  homeBandOff: 0.25, homeWholeFrom: 0.92,
};

/** What the director reads of a stage body view (bodyview.ts BodyView satisfies it). */
export interface RoomView {
  readonly visible: boolean; readonly chunk?: boolean; readonly isPiece?: boolean; readonly id: number; readonly growth: number; readonly playerMoving?: boolean; frameMode: number;
  readonly proxy: { readonly center: { readonly x: number; readonly y: number; readonly z: number }; readonly restRadius: number; readonly metrics: { readonly fingers?: number; readonly carried?: boolean; readonly grabbed?: boolean } };
}
/** ... and of the camera (a THREE.PerspectiveCamera satisfies it): the view and projection matrices of the last frame. */
export interface RoomLens { readonly matrixWorldInverse: { readonly elements: ArrayLike<number> }; readonly projectionMatrix: { readonly elements: ArrayLike<number> }; readonly fov: number; readonly aspect: number }

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const ease = (dt: number, tau: number): number => 1 - Math.exp(-dt / Math.max(1e-3, tau));
const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

export class RoomCam {
  /** The director drives the camera this frame (a place; Home with two or more out). */
  on = false;
  /** The eased view: its centre on the floor (m) and its factor (1 = the whole room). */
  x = 0; z = 0; u = 1;
  /** Home's rig: the framing scale of the view (stage.ts camScale's target), and how far the camera lifts (rad added to its pitch) as the player zooms out past
   *  the widest view the camera takes by itself: at Home's low rest pitch the whole felt is a thin ellipse (on a phone a 60 px strip in a tall frame), so the
   *  whole-room view looks down on it (up to homeLiftTall / homeLiftWide more). 0 inside the camera's own range: today's look. */
  want = 1; lift = 0;
  /** Home's rig: where the camera aims on the floor (m): the view's centre, moved toward the camera by up to homeAhead at the whole-room view (the felt's far half
   *  is the smaller one on screen, so the felt's middle must stand above the frame's middle for all of it to show between the HUD rows). */
  ax = 0; az = 0;
  /** The view moved under a hand this frame (the shell re-asks the hand's target so the body stays under the finger). */
  scroll = false;
  /** A body is in hand this frame (a finger on it, a carry, a toss until it lies still): the view does not re-centre (the probes read it). */
  hand = false;
  /** How many bodies stand outside the view (the shell's edge chips read the camera themselves; this is for the probes). */
  outside = 0;
  // the room: a rectangle (centre, half sizes) or Home's disc (hx = hz = its radius); depthK > 0 = Home's rig (a box costs |dx| + depthK |dz|)
  private cx = 0; private cz = 0; private hx = 1; private hz = 1; private depthK = 0;
  private near = ROOM_CAM.near; private far = ROOM_CAM.far; private close = ROOM_CAM.close;
  private fresh = true;
  // by itself: the factor's target and how long the box has been smaller; the centre's target
  private uT = 1; private inT = 0; private tx = 0; private tz = 0;
  // the player's: the zoom factor (0 = none), the pan and its age, the focus and its age, the lead
  private userU = 0; private panX = 0; private panZ = 0; private panAge = 1e9; private focusId = -1; private focusAge = 1e9; private leadId = -1;
  // the last frame's scale for pan(): metres per CSS px across and in depth at the aim, and the camera's yaw
  private mX = 0.01; private mZ = 0.01; private yaw = 0;
  private wasHeld = false;
  // the pointer this frame (NDC; NaN: none)
  private pnx = NaN; private pny = 0;

  /** The pointer this frame (the stage's frame input: NDC, y up; null: none): a finger that holds a body at the frame's edge scrolls the view. */
  finger(n: { readonly x: number; readonly y: number } | null): void { if (n) { this.pnx = n.x; this.pny = n.y; } else this.pnx = NaN; }

  /** The room in use; a new one (another place, another layout, Home's frame turned) starts the view afresh. */
  private room(cx: number, cz: number, hx: number, hz: number, depthK: number, near: number, far: number, close: number): void {
    if (cx !== this.cx || cz !== this.cz || hx !== this.hx || hz !== this.hz || depthK !== this.depthK) {
      this.cx = cx; this.cz = cz; this.hx = hx; this.hz = hz; this.depthK = depthK;
      this.fresh = true; this.userU = 0; this.panX = 0; this.panZ = 0; this.panAge = 1e9; this.focusId = -1; this.leadId = -1;
    }
    this.near = near; this.far = far; this.close = close;
  }
  /** Leave (Home with one out, a ceremony): the next time it drives, the view starts afresh. */
  off(): void { this.on = false; this.scroll = false; this.hand = false; this.fresh = true; this.userU = 0; this.panX = 0; this.panZ = 0; this.focusId = -1; this.lift = 0; }

  /** One frame in a PLACE whose play bounds are (cx, cz, hx, hz). `dist`, `yaw`, `pitch`: the camera as it stood last frame; top / bottom: the HUD rows (CSS px). */
  place(dt: number, views: readonly RoomView[], primaryId: number | null, lens: RoomLens, dist: number, yaw: number, pitch: number, cssW: number, cssH: number, top: number, bottom: number,
    cx: number, cz: number, hx: number, hz: number): void {
    this.room(cx, cz, hx, hz, 0, ROOM_CAM.near, ROOM_CAM.far, ROOM_CAM.close);
    this.on = true;
    this.run(dt, views, primaryId, lens, dist, yaw, pitch, cssW, cssH, top, bottom, NaN, NaN, 0);
  }
  /**
   * One frame at HOME. R: the felt's radius (m); wantSlots: the published framing scale of the party at its mat slots (today's view); hwPer: the half width a
   * framing of 1 shows (m); (capX, capZ, capR): a capsule waiting on the mat (NaN: none): it counts as one more body. Drives only with two or more squishies out
   * (pieces of one cut squishy count as that one); otherwise `on` is false and the stage's own framing runs untouched.
   */
  home(dt: number, views: readonly RoomView[], primaryId: number | null, lens: RoomLens, dist: number, yaw: number, pitch: number, cssW: number, cssH: number, top: number, bottom: number,
    R: number, wantSlots: number, hwPer: number, capX: number, capZ: number, capR: number): void {
    let whole = 0, piece = 0;
    for (const v of views) { if (!v.visible || v.chunk) continue; if (v.isPiece) piece = 1; else whole++; }
    if (whole + piece < 2 || !(R > 0) || !(hwPer > 0)) { if (this.on) this.off(); return; }
    const wantRoom = (1.05 * R) / hwPer, near = Math.min(1, wantSlots / wantRoom);   // (5 % of air beside the felt's rim at the whole-room view)
    this.room(0, 0, 1.05 * R, 1.05 * R, lens.aspect < 0.9 ? ROOM_CAM.homeDepthTall : ROOM_CAM.homeDepthWide, near, Math.min(1, near / ROOM_CAM.floor), near * 0.5);
    this.on = true;
    this.run(dt, views, primaryId, lens, dist, yaw, pitch, cssW, cssH, top, bottom, capX, capZ, capR);
    this.want = this.u * wantRoom;
    // (the whole-felt look comes in over the last stretch of the zoom: from the widest own view, or from homeWholeFrom of the felt when a big party's own view
    // already reaches further: five large squishies in a row span nearly the whole felt by themselves)
    const f0 = Math.min(this.far, ROOM_CAM.homeWholeFrom), w = smooth((this.u - f0) / (1 - f0)), tall = lens.aspect < 0.9, ahead = w * (tall ? ROOM_CAM.homeAheadTall : ROOM_CAM.homeAheadWide);
    this.lift = w * (tall ? ROOM_CAM.homeLiftTall : ROOM_CAM.homeLiftWide);
    this.ax = this.x + ahead * Math.sin(yaw); this.az = this.z + ahead * Math.cos(yaw);
  }

  /** How far (m, along x) the point (px, pz) with a margin m lies outside a view of factor u centred (vx, vz); <= 0 = inside. */
  private outOf(px: number, pz: number, m: number, vx: number, vz: number, u: number): number {
    const dx = Math.abs(px - vx), dz = Math.abs(pz - vz);
    if (this.depthK > 0) return dx + this.depthK * dz + m - u * this.hx;
    return Math.max(dx + m - u * this.hx, (dz + m - u * this.hz) * (this.hx / this.hz));
  }

  private run(dt: number, views: readonly RoomView[], primaryId: number | null, lens: RoomLens, dist: number, yaw: number, pitch: number, cssW: number, cssH: number, top: number, bottom: number,
    capX: number, capZ: number, capR: number): void {
    // (a frame of no time: the shell presents a paused frame with dt 0; nothing eases, and `scroll` / `hand` keep what the last real frame found)
    if (!(dt > 0) && !this.fresh) return;
    const T = ROOM_CAM, pad = T.pad * clamp((this.near * this.hx) / T.padRef, T.padMin, 1);
    // ---- the party's box, the body in hand, the lead, the focus ----
    let n = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    let hx = 0, hy = 0, hz = 0, held = false, carry = false, grab = false, lx = 0, lz = 0, lr = 0, lead = false, px = 0, pz = 0, pr = 0, prim = false, fx = 0, fz = 0, foc = false;
    for (const v of views) {
      if (!v.visible || v.chunk) continue;
      const c = v.proxy.center, m = v.proxy.metrics, r = v.proxy.restRadius * v.growth;
      n++;
      if (c.x - r - pad < x0) x0 = c.x - r - pad; if (c.x + r + pad > x1) x1 = c.x + r + pad;
      if (c.z - r - pad < z0) z0 = c.z - r - pad; if (c.z + r + pad > z1) z1 = c.z + r + pad;
      // in hand: a finger on it, a carry, or (playerMoving) a toss or a shove until it lies still. Only a CARRY or a body let go and still moving scrolls the
      // view at the frame's edge: a finger that presses or squeezes a squishy standing near the edge must not slide the picture from under itself
      if (!held && ((m.fingers ?? 0) > 0 || m.carried === true || v.playerMoving === true)) { held = true; carry = m.carried === true || !((m.fingers ?? 0) > 0); grab = m.carried === true || m.grabbed === true; hx = c.x; hy = c.y; hz = c.z; this.leadId = v.id; }
      if (v.id === this.leadId) { lead = true; lx = c.x; lz = c.z; lr = r; }
      if (v.id === primaryId) { prim = true; px = c.x; pz = c.z; pr = r; }
      if (v.id === this.focusId) { foc = true; fx = c.x; fz = c.z; }
    }
    if (capX === capX) { n++; if (capX - capR < x0) x0 = capX - capR; if (capX + capR > x1) x1 = capX + capR; if (capZ - capR < z0) z0 = capZ - capR; if (capZ + capR > z1) z1 = capZ + capR; }
    if (n === 0) { this.scroll = false; return; }
    if (!lead && prim) { lead = true; lx = px; lz = pz; lr = pr; }
    // ---- the factor: by itself between near and far, out quickly and in slowly; the player's zoom stays ----
    const bx = (x0 + x1) / 2, bz = (z0 + z1) / 2, hX = (x1 - x0) / 2, hZ = (z1 - z0) / 2;
    const need = this.depthK > 0 ? (hX + this.depthK * hZ) / this.hx : Math.max(hX / this.hx, hZ / this.hz);
    const uA = clamp(need, this.near, this.far);
    if (this.fresh) { this.uT = uA; this.inT = 0; }
    else if (uA > this.uT) { this.uT += (uA - this.uT) * ease(dt, T.tauOut); this.inT = 0; }
    else if (uA < this.uT * T.inBand && !held) { this.inT += dt; if (this.inT > T.inWaitS) this.uT += (uA - this.uT) * ease(dt, T.tauIn); }
    else if (!held) this.inT = 0;
    const uG = this.userU > 0 ? this.userU : this.uT;
    // ---- the scale of a CSS px on the floor at the aim (pan(), the edge scroll) ----
    const th = Math.tan((lens.fov * Math.PI) / 360), sp = Math.max(0.2, Math.sin(pitch + this.lift));
    this.mX = (2 * dist * th) / Math.max(1, cssH); this.mZ = this.mX / sp; this.yaw = yaw;
    // ---- the centre ----
    this.focusAge += dt; this.panAge += dt;
    if (this.focusAge > T.focusS || held) this.focusId = -1;
    let gx: number, gz: number, vsx = 0, vsz = 0;
    if (held) {
      // in hand: no re-centring; the pan is taken into the target (the view stays where the player looks); at the band's edges the view scrolls
      if (!this.wasHeld) { this.tx = this.x; this.tz = this.z; this.panX = 0; this.panZ = 0; this.panAge = 1e9; }
      gx = this.tx; gz = this.tz;
      const e = lens.matrixWorldInverse.elements, p = lens.projectionMatrix.elements;
      const ex = e[0] * hx + e[4] * hy + e[8] * hz + e[12], ey = e[1] * hx + e[5] * hy + e[9] * hz + e[13], ez = e[2] * hx + e[6] * hy + e[10] * hz + e[14];
      if (carry && ez < -0.01) {
        const nx = (p[0] * ex + p[8] * ez) / -ez, ny = (p[5] * ey + p[9] * ez) / -ez;
        const bT = 1 - (2 * top) / Math.max(1, cssH), bB = -1 + (2 * bottom) / Math.max(1, cssH), by = (2 * ny - bT - bB) / Math.max(0.2, bT - bB);
        let ox = Math.sign(nx) * smooth((Math.abs(nx) - T.edge) / (T.edgeFull - T.edge)), oy = Math.sign(by) * smooth((Math.abs(by) - T.edge) / (T.edgeFull - T.edge));
        // the finger that holds it (a pull or a carry): at the frame's edge it scrolls too, whichever asks for more
        if (grab && this.pnx === this.pnx) {
          const pby = (2 * this.pny - bT - bB) / Math.max(0.2, bT - bB);
          const fx = Math.sign(this.pnx) * smooth((Math.abs(this.pnx) - T.edgeP) / (T.edgePFull - T.edgeP)), fy = Math.sign(pby) * smooth((Math.abs(pby) - T.edgeP) / (T.edgePFull - T.edgeP));
          if (Math.abs(fx) > Math.abs(ox)) ox = fx;
          if (Math.abs(fy) > Math.abs(oy)) oy = fy;
        }
        if (ox !== 0 || oy !== 0) {
          const v = T.edgeV * (0.4 + 0.6 * Math.min(1, uG / this.far)) * dt, cy = Math.cos(yaw), sy = Math.sin(yaw);
          // screen right = (cos yaw, -sin yaw) on the floor; screen up = away from the camera = (-sin yaw, -cos yaw)
          vsx = (ox * cy - oy * sy) * v; vsz = (-ox * sy - oy * cy) * v;
          gx += vsx; gz += vsz;
        }
      }
    } else {
      if (foc) { gx = fx; gz = fz; }
      else {
        gx = bx; gz = bz;
        // the party does not fit: the lead stays inside the view (the others are hinted at the frame's edge)
        if (need > uG + 1e-6 && lead) {
          const m = lr + T.leadPad;
          if (this.depthK > 0) {
            const dx = gx - lx, dz = gz - lz, cost = Math.abs(dx) + this.depthK * Math.abs(dz), lim = Math.max(0, uG * this.hx - m);
            if (cost > lim) { const k = cost > 1e-9 ? lim / cost : 0; gx = lx + dx * k; gz = lz + dz * k; }
          } else {
            const ix = Math.max(0, uG * this.hx - m), iz = Math.max(0, uG * this.hz - m);
            gx = clamp(gx, lx - ix, lx + ix); gz = clamp(gz, lz - iz, lz + iz);
          }
        }
      }
      if (this.panAge > T.panHoldS) { const k = Math.exp(-dt / T.panTau); this.panX *= k; this.panZ *= k; if (Math.abs(this.panX) + Math.abs(this.panZ) < 1e-3) { this.panX = 0; this.panZ = 0; } }
      gx += this.panX; gz += this.panZ;
    }
    // inside the room: the view never looks past the walls (a disc: the centre stays inside the room's radius less the view's)
    const k1 = Math.max(0, 1 - Math.min(1, uG));
    let qx: number, qz: number;
    if (this.depthK > 0) { const d = Math.hypot(gx - this.cx, gz - this.cz), lim = this.hx * k1; qx = gx; qz = gz; if (d > lim) { const k = d > 1e-9 ? lim / d : 0; qx = this.cx + (gx - this.cx) * k; qz = this.cz + (gz - this.cz) * k; } }
    else { qx = clamp(gx, this.cx - this.hx * k1, this.cx + this.hx * k1); qz = clamp(gz, this.cz - this.hz * k1, this.cz + this.hz * k1); }
    if (!held && (qx !== gx || qz !== gz) && (this.panX !== 0 || this.panZ !== 0)) { this.panX -= gx - qx; this.panZ -= gz - qz; }   // (a pan never piles up past the wall)
    if (held && grab && hy > 0) {
      const over = Math.min(T.overMax, (T.overK * hy) / Math.max(0.3, Math.tan(pitch + this.lift))), ux = -Math.sin(yaw), uz = -Math.cos(yaw);
      const e = Math.min(over, Math.max(0, (gx - qx) * ux + (gz - qz) * uz));
      qx += ux * e; qz += uz * e;
    }
    this.tx = qx; this.tz = qz;
    // ---- ease ----
    const xWas = this.x, zWas = this.z, uWas = this.u;
    if (this.fresh) { this.x = qx; this.z = qz; this.u = uG; this.fresh = false; }
    else {
      const kc = ease(dt, held ? T.tauHeld : T.tauC);
      this.x += (qx - this.x) * kc; this.z += (qz - this.z) * kc; this.u += (uG - this.u) * ease(dt, T.tauU);
    }
    this.scroll = held && (Math.abs(this.x - xWas) + Math.abs(this.z - zWas) > 1e-5 || Math.abs(this.u - uWas) > 1e-6);
    this.wasHeld = held; this.hand = held;
    // ---- who stands outside the view (Home: the band framing leaves them out, frameMode 2; zoomed out past the camera's own range it leaves everybody out:
    //      the whole-felt view is aimed by this module (lift, ahead), and a lens shift that centred the party would push the felt's front under the HUD) ----
    let out = 0;
    const f0 = Math.min(this.far, ROOM_CAM.homeWholeFrom), wide = this.depthK > 0 && this.u > f0 + ROOM_CAM.homeBandOff * (1 - f0);
    for (const v of views) {
      if (!v.visible || v.chunk) continue;
      const c = v.proxy.center, o = this.outOf(c.x, c.z, 0, this.x, this.z, this.u) > 0;
      if (o) out++;
      if (this.depthK > 0 && (o || wide)) v.frameMode = 2;
    }
    this.outside = out;
  }

  /** The player's zoom: `delta` > 0 = away (wheel-like, already scaled: the factor is multiplied by e^delta), between the closest view and the whole room. It stays. */
  zoom(delta: number): void {
    if (!this.on || !Number.isFinite(delta)) return;
    this.userU = clamp((this.userU > 0 ? this.userU : this.uT) * Math.exp(delta), this.close, 1);
  }
  /** The player's pan: the picture follows the fingers by (dx, dy) CSS px (dy down the frame). It holds for panHoldS after the last call. */
  pan(dxPx: number, dyPx: number): void {
    if (!this.on || !Number.isFinite(dxPx) || !Number.isFinite(dyPx)) return;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.panX += -dxPx * this.mX * cy - dyPx * this.mZ * sy; this.panZ += dxPx * this.mX * sy - dyPx * this.mZ * cy;
    this.panAge = 0; this.focusId = -1;
  }
  /** Bring the camera to a body (a party chip): it is centred for focusS and becomes the lead. */
  focus(id: number): void {
    if (!this.on) return;
    this.focusId = id; this.focusAge = 0; this.leadId = id; this.panX = 0; this.panZ = 0; this.panAge = 1e9;
  }
  /** The player's zoom factor (0 = none): the probes read it. */
  get zoomed(): number { return this.userU; }
}
