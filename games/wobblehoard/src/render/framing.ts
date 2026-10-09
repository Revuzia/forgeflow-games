// SR2 (CUT2 8.6, UI.md 4.2): BAND FRAMING. The shell reports the CSS px its HUD covers (StageLike.setSafeInsets: the top row, the dock tray and the info row); the squishy
// and its pieces are framed to stand BETWEEN them: pulled back until their extent fits the band (top .. H - bottom), and the picture's principal point shifted (a lens shift:
// the camera does not move or turn, so the table, the aim and every orbit gesture stay as they were) until the extent is centred in the band.
//
// What counts as a body's extent (all of it in the unshifted NDC of the camera): its silhouette (the topmost / lowest / leftmost / rightmost skin vertices) and its on-screen DISC
// (the centre of mass +- restRadius, the disc the shell's cover probes measure), and for the pieces of one squishy also the WHOLE's disc about their common mass centre (so a cut
// that swaps one body for two flush halves does not zoom the camera in: the union is the whole's). The extremes are HELD in world space: a body that moves (a toss, a slide, a
// finger on it, a carry) keeps the extremes it had when it was last calm, and a calm body follows its own live extremes (out quickly, back slowly), so a hop does not move the camera and
// a piece that comes to rest on its twin (a stack) or lands far away is framed once it lies still. No allocation per frame.
//
// Until the shell reports insets (setSafeInsets with a non-zero row), nothing here runs: the framing is exactly the pre-SR2 one.

/** Knobs (data, not code). */
export const FRAME_TUNING = {
  enabled: true,
  /** CSS px kept clear between an extent and the edges of the band: max(marginMin, marginFrac x the frame's height). */
  marginMin: 3, marginFrac: 0.02,
  /** The camera scale the band may ask for at most (x the rest framing of a unit body; a stack of two tall pieces on a 100 px band needs about 2.3). */
  maxScale: 3.2,
  /** The lens shift eases toward its goal at this rate (1 / s). */
  lensRate: 5,
  /** A body is calm (its extent is taken in) under `calmBelow` m/s of centre speed and not calm over `calmAbove`; a finger on it or a carry is never calm. */
  calmBelow: 0.3, calmAbove: 0.5,
  /** Time constants (s) of a calm body's held extremes: toward a bigger extent, toward a smaller one. */
  tauOut: 0.25, tauIn: 1.2,
  /** The band is never thinner than this share of the frame (insets that would leave less are scaled down together). */
  minBand: 0.35,
};

/** The held extent of one body: world points (top, bottom, left, right = the skin vertices that were extreme on screen, then the disc centre). */
export class FrameHold {
  readonly p = new Float64Array(15);
  /** the filtered centre speed (0) and the centre of the last frame (1..3): typed, so a frame allocates no boxed number */
  readonly s = new Float64Array(4);
  ready = false; calm = true; private hasPrev = false;
  /** One more frame: the filtered centre speed and the calm flag (hysteresis; a finger on the body or a carry = not calm). `dt` is in `cfg[4]` (see Framer). */
  gate(c: { x: number; y: number; z: number }, cfg: Float64Array, held: boolean): void {
    const s = this.s, dt = cfg[4];
    if (this.hasPrev && dt > 1e-4) {
      const dx = c.x - s[1], dy = c.y - s[2], dz = c.z - s[3];   // (not Math.hypot: it boxes its arguments, a garbage per body per frame)
      s[0] += (Math.sqrt(dx * dx + dy * dy + dz * dz) / dt - s[0]) * (1 - Math.exp(-dt / 0.12));
    }
    s[1] = c.x; s[2] = c.y; s[3] = c.z; this.hasPrev = true;
    if (held) this.calm = false;
    else if (this.calm) { if (s[0] > FRAME_TUNING.calmAbove) this.calm = false; }
    else if (s[0] < FRAME_TUNING.calmBelow) this.calm = true;
  }
}

/** What the framer reads of a stage view (BodyView satisfies it; structural so this file imports nothing). */
export interface FrameView {
  readonly visible: boolean;
  readonly hold: FrameHold;
  readonly growth: number;
  readonly isPiece: boolean;
  readonly proxy: {
    readonly positions: ArrayLike<number>; readonly vertexCount: number; readonly center: { x: number; y: number; z: number }; readonly restRadius: number;
    readonly frac?: number; readonly piece?: { readonly whole: { readonly restLocal: unknown; readonly radius: number } };
    readonly metrics: { readonly fingers?: number; readonly carried?: boolean };
  };
}

/** The camera numbers the framer needs: the view matrix (matrixWorldInverse.elements) and the projection's x / y scales (elements [0] and [5]; a lens shift does not touch them). */
export interface FrameCam { readonly e: ArrayLike<number>; readonly p0: number; readonly p5: number }

export class Framer {
  /** The rows the shell reported (CSS px); all zero until setInsets. */
  readonly ins = { top: 0, right: 0, bottom: 0, left: 0 };
  /** The lens shift in NDC (content moves up by lensY, right by lensX), eased. */
  lensX = 0; lensY = 0;
  goalX = 0; goalY = 0;
  /** The camera scale the band needs (the extent / band ratio x the scale it was measured at, > 0 only when the extent does not fit), for framingFor. 0 = no demand. */
  wantScale = 0;
  /** Diagnostics of the last measure: the extent in unshifted NDC and its ratio to the band. */
  top = 0; bottom = 0; left = 0; right = 0; fitY = 0; fitX = 0; bodies = 0;
  /** The next measure snaps the lens and the held extents (a body just appeared on an empty stage, or the first rows arrived). */
  fresh = true;
  private any = false;
  private readonly B = new Float64Array(4);
  // the working numbers of one measure live in typed arrays (a double in an object field or a call argument is boxed in code V8 has not optimised yet: garbage per body per frame)
  /** cfg: [0] projection x scale, [1] y scale, [2] fast rate, [3] slow rate, [4] dt */
  private readonly cfg = new Float64Array(5);
  /** acc: the running extent: top, bottom, left, right (NDC) */
  private readonly acc = new Float64Array(4);
  /** w: scratch: [0..2] a world point in, [3] its NDC x, [4] NDC y, [5] 1 / depth out, [6] a radius in */
  private readonly w = new Float64Array(8);
  private cam: ArrayLike<number> = [];
  private hp: Float64Array = new Float64Array(15);
  private vp: ArrayLike<number> = [];

  /** setSafeInsets: only the rows that are given. */
  setInsets(i: { top?: number; right?: number; bottom?: number; left?: number }): void {
    const was = this.any;
    for (const k of ['top', 'right', 'bottom', 'left'] as const) { const v = i[k]; if (typeof v === 'number' && Number.isFinite(v)) this.ins[k] = Math.max(0, v); }
    this.any = this.ins.top + this.ins.right + this.ins.bottom + this.ins.left > 0;
    if (!was && this.any) this.fresh = true;
  }
  /** Rows were reported (and the framing is on). */
  get on(): boolean { return FRAME_TUNING.enabled && this.any; }
  /** The stage was emptied: the next body snaps. */
  reset(): void { this.fresh = true; this.clear(); }

  /** The band's NDC edges for a frame of W x H CSS px (insets scaled down together when they would leave less than `minBand`): [top, bottom, left, right]. */
  private band(W: number, H: number): Float64Array {
    let t = this.ins.top, b = this.ins.bottom, l = this.ins.left, r = this.ins.right;
    const kv = (t + b) > (1 - FRAME_TUNING.minBand) * H ? (1 - FRAME_TUNING.minBand) * H / (t + b) : 1;
    const kh = (l + r) > (1 - FRAME_TUNING.minBand) * W ? (1 - FRAME_TUNING.minBand) * W / (l + r) : 1;
    t *= kv; b *= kv; l *= kh; r *= kh;
    const B = this.B;
    B[0] = 1 - 2 * t / H; B[1] = -1 + 2 * b / H; B[2] = -1 + 2 * l / W; B[3] = 1 - 2 * r / W;
    return B;
  }

  /** No demand, lens goal at the middle (a ceremony runs, nothing to frame, rows withdrawn). */
  clear(): void { this.wantScale = 0; this.goalX = 0; this.goalY = 0; this.bodies = 0; this.fitX = 0; this.fitY = 0; }

  /** NDC of the world point in `w[0..2]` in the UNSHIFTED view: `w[3]` x, `w[4]` y, `w[5]` 1 / depth; false when it is not in front of the camera. */
  private ndc(): boolean {
    const e = this.cam, w = this.w, cfg = this.cfg, x = w[0], y = w[1], z = w[2];
    const ze = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (!(ze < -0.01)) return false;
    const iw = 1 / -ze;
    w[3] = cfg[0] * (e[0] * x + e[4] * y + e[8] * z + e[12]) * iw; w[4] = cfg[1] * (e[1] * x + e[5] * y + e[9] * z + e[13]) * iw; w[5] = iw;
    return true;
  }
  /** Load vertex / point `i` of `a` into the scratch point. */
  private load(a: ArrayLike<number>, i: number): void { const w = this.w; w[0] = a[i]; w[1] = a[i + 1]; w[2] = a[i + 2]; }

  /** Add the disc about the scratch point (radius `w[6]`) to the running extent. */
  private addDisc(): void {
    if (!this.ndc()) return;
    const w = this.w, cfg = this.cfg, acc = this.acc, ry = cfg[1] * w[6] * w[5], rx = cfg[0] * w[6] * w[5];
    if (w[4] + ry > acc[0]) acc[0] = w[4] + ry; if (w[4] - ry < acc[1]) acc[1] = w[4] - ry;
    if (w[3] - rx < acc[2]) acc[2] = w[3] - rx; if (w[3] + rx > acc[3]) acc[3] = w[3] + rx;
  }

  /** Move the held point in `slot` toward vertex `i` of the body's positions: quickly when the vertex lies further out on screen than the held point (`sign` +1: larger is further out), slowly when it lies inside. `axis` 0 = x, 1 = y. */
  private pull(i: number, slot: number, sign: number, axis: number, fresh: boolean): void {
    const p = this.hp, P = this.vp, o = slot * 3, w = this.w, cfg = this.cfg;
    let k = 1;
    if (!fresh) {
      this.load(P, i);
      const mine = this.ndc() ? w[3 + axis] : NaN;
      w[0] = p[o]; w[1] = p[o + 1]; w[2] = p[o + 2];
      const held = this.ndc() ? w[3 + axis] : -sign * Infinity;
      k = sign * mine >= sign * held ? cfg[2] : cfg[3];
    }
    p[o] += (P[i] - p[o]) * k; p[o + 1] += (P[i + 1] - p[o + 1]) * k; p[o + 2] += (P[i + 2] - p[o + 2]) * k;
  }

  /**
   * One frame: update every visible view's held extent, then the extent of the lot in unshifted NDC against the band, the camera scale it needs and the lens goal.
   * `S` = the camera's scale x zoom x cameraFx.dist now (the extent is inversely proportional to it).
   */
  measure(views: readonly FrameView[], cam: FrameCam, W: number, H: number, S: number, dt: number): void {
    const T = FRAME_TUNING, snap = this.fresh, cfg = this.cfg, acc = this.acc, w = this.w;
    this.cam = cam.e;
    cfg[0] = cam.p0; cfg[1] = cam.p5; cfg[2] = 1 - Math.exp(-dt / T.tauOut); cfg[3] = 1 - Math.exp(-dt / T.tauIn); cfg[4] = dt;
    acc[0] = -Infinity; acc[1] = Infinity; acc[2] = Infinity; acc[3] = -Infinity;
    let n = 0;
    // the pieces of ONE squishy (same whole, at least two): their union is framed with the whole's own disc about their mass centre
    let grpWhole: unknown = null, grpN = 0, grpR = 0, same = true;
    for (const v of views) {
      if (!v.visible) continue;
      const pc = v.proxy.piece;
      if (!v.isPiece || !pc || (grpWhole !== null && pc.whole.restLocal !== grpWhole)) { same = false; break; }
      grpWhole = pc.whole.restLocal; grpR = pc.whole.radius; grpN++;
    }
    const grp = same && grpN >= 2;
    // the weighted mass centre of the group in w[7..] is kept in `gc` (reused)
    const gc = this.gc; gc[0] = 0; gc[1] = 0; gc[2] = 0; gc[3] = 0;
    for (const v of views) {
      if (!v.visible) continue;
      const h = v.hold, p = h.p, P = v.proxy.positions, cnt = v.proxy.vertexCount * 3, c = v.proxy.center, m = v.proxy.metrics;
      n++;
      if (snap) h.ready = false;
      h.gate(c, cfg, (m.fingers ?? 0) > 0 || m.carried === true);
      if (!h.ready || h.calm) {
        // the live extremes of the skin on screen
        const e = this.cam, k0 = cfg[0], k5 = cfg[1];
        let iT = -1, iB = -1, iL = -1, iR = -1, mT = -Infinity, mB = Infinity, mL = Infinity, mR = -Infinity;
        for (let i = 0; i < cnt; i += 3) {
          const x = P[i], y = P[i + 1], z = P[i + 2];
          const ze = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (!(ze < -0.01)) continue;
          const iw = 1 / -ze, ny = k5 * (e[1] * x + e[5] * y + e[9] * z + e[13]) * iw, nx = k0 * (e[0] * x + e[4] * y + e[8] * z + e[12]) * iw;
          if (ny > mT) { mT = ny; iT = i; } if (ny < mB) { mB = ny; iB = i; }
          if (nx < mL) { mL = nx; iL = i; } if (nx > mR) { mR = nx; iR = i; }
        }
        const fresh = !h.ready;
        if (iT >= 0) {
          // (the NDC of the held point is compared on the same axis as the extreme: top / right = larger is further out, bottom / left = smaller)
          this.hp = p; this.vp = P;
          this.pull(iT, 0, 1, 1, fresh); this.pull(iB, 1, -1, 1, fresh); this.pull(iL, 2, -1, 0, fresh); this.pull(iR, 3, 1, 0, fresh);
        }
        const kd = fresh ? 1 : cfg[2];
        p[12] += (c.x - p[12]) * kd; p[13] += (c.y - p[13]) * kd; p[14] += (c.z - p[14]) * kd;
        h.ready = true;
      }
      // the held extremes now
      w[0] = p[0]; w[1] = p[1]; w[2] = p[2]; if (this.ndc() && w[4] > acc[0]) acc[0] = w[4];
      w[0] = p[3]; w[1] = p[4]; w[2] = p[5]; if (this.ndc() && w[4] < acc[1]) acc[1] = w[4];
      w[0] = p[6]; w[1] = p[7]; w[2] = p[8]; if (this.ndc() && w[3] < acc[2]) acc[2] = w[3];
      w[0] = p[9]; w[1] = p[10]; w[2] = p[11]; if (this.ndc() && w[3] > acc[3]) acc[3] = w[3];
      // the disc about the (held) centre of mass
      w[0] = p[12]; w[1] = p[13]; w[2] = p[14]; w[6] = v.proxy.restRadius * v.growth; this.addDisc();
      if (grp) {
        const fw = typeof v.proxy.frac === 'number' && v.proxy.frac > 0 ? v.proxy.frac : 1;
        gc[0] += p[12] * fw; gc[1] += p[13] * fw; gc[2] += p[14] * fw; gc[3] += fw;
        if (n === grpN && grpR > 0 && gc[3] > 0) { w[0] = gc[0] / gc[3]; w[1] = gc[1] / gc[3]; w[2] = gc[2] / gc[3]; w[6] = grpR; this.addDisc(); }
      }
    }
    this.bodies = n;
    const top = acc[0], bot = acc[1], lef = acc[2], rig = acc[3];
    if (n === 0 || !(top > bot)) { this.clear(); return; }
    this.top = top; this.bottom = bot; this.left = lef; this.right = rig;
    const B = this.band(W, H);
    const my = 2 * Math.max(T.marginMin, T.marginFrac * H) / H, mx = 2 * Math.max(T.marginMin, T.marginFrac * W) / W;
    const horiz = this.ins.left + this.ins.right > 0;
    this.fitY = (top - bot) / Math.max(0.05, B[0] - B[1] - 2 * my);
    this.fitX = horiz ? (rig - lef) / Math.max(0.05, B[3] - B[2] - 2 * mx) : 0;
    const f = Math.max(this.fitY, this.fitX);
    this.wantScale = f > 1 ? Math.min(T.maxScale, f * S) : 0;
    this.goalY = Math.max(-0.7, Math.min(0.7, (B[0] + B[1]) / 2 - (top + bot) / 2));
    this.goalX = horiz ? Math.max(-0.7, Math.min(0.7, (B[2] + B[3]) / 2 - (lef + rig) / 2)) : 0;
  }
  private readonly gc = new Float64Array(4);

  /** Ease the lens toward its goal (snap on `fresh` when there are bodies); true when it moved. */
  ease(dt: number): boolean {
    if (this.lensX === 0 && this.lensY === 0 && this.goalX === 0 && this.goalY === 0 && !(this.fresh && this.bodies > 0)) return false;   // (nothing to ease: the common case before the shell reports rows)
    // (released slowly when there is nothing to frame, e.g. a ceremony runs: the picture does not jump at its start)
    const k = this.fresh && this.bodies > 0 ? 1 : 1 - Math.exp(-dt * FRAME_TUNING.lensRate * (this.bodies > 0 ? 1 : 0.35));
    if (this.bodies > 0) this.fresh = false;
    const x = this.lensX, y = this.lensY;
    this.lensX += (this.goalX - this.lensX) * k; this.lensY += (this.goalY - this.lensY) * k;
    if (Math.abs(this.lensX) < 1e-5) this.lensX = 0;
    if (Math.abs(this.lensY) < 1e-5) this.lensY = 0;
    return this.lensX !== x || this.lensY !== y;
  }
}
