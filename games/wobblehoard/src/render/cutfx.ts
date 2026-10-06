// CUT visuals (_spec/CUT.md section 4, RENDER): what the stage draws BETWEEN bodies while a squishy is cut and put back together.
//   * the PARTING STRANDS (StageLike.partPieces): right after the swap at neck t = 1 up to three threads of the same jelly hang between the two
//     new pieces, anchored at different spots of the cut faces; they stretch as the pieces separate, thin (volume conserved) and flare where
//     they leave the faces, sag, and SNAP one after another, each half springing back into its piece. How many and how long is the family's
//     tack x stringiness (resolveMaterial(...).physics): three long threads for sticky stretch and slime, one short wisp for gel; a strand
//     also snaps by the clock (a thread thins as it ages) because the shell only holds the pieces a hand's width apart. Calm effects halve
//     it. Drawn with the tack-strand renderer (strands.ts StrandTube) between two moving anchors.
//   * the RECONNECT BRIDGE (StageLike.setBridge): a glowing neck of the jelly between two bodies, as thick as the smaller body's waist,
//     flaring where it joins each body, with a soft warm glow spot on each body where it joins (uSpot). It is there from the moment the
//     shell asks for it (the shell's own t eases in slowly, the pieces close within a fraction of a second: a neck that waited for t would
//     only show once the bodies already overlap), and sinks into the bodies as they merge.
//   * the CUT SEAM itself lives in the jelly shader (uSeam, BodyView.setSeam); this file only carries a seam over from a body that was cut
//     to the two pieces that replace it, so the glow fades out instead of vanishing in one frame.
// Every light here is a GLOW, never a flash: eased in and out (attack >= 0.12 s, release >= 0.2 s), capped, softer in calm mode, and held
// down further for a second after a granted ceremony flash (the FlashGovernor). Zero per-frame allocation once the pools exist.
import * as THREE from 'three';
import type { BodyView } from './bodyview.ts';
import type { EnvHub } from './env.ts';
import { StrandTube, type StrandEvent } from './strands.ts';

const SEG = 24;          // rings along a tube
const RAD = 12;           // vertices around
const SNAP_S = 0.16;     // a snapped strand's halves spring back over this long
/** Threads per parting (the tack decides how many are used) and where each hangs on the cut faces: [sideways, up] as a tilt of the facing direction. */
const PART_STRANDS = 3;
const TILT: readonly (readonly [number, number])[] = [[0, 0], [0.34, 0.22], [-0.34, 0]];
/** Most tubes alive at once: 3 partings of 3 threads + 5 bridges of a Reconnect all (CUT.md: at most 6 pieces). */
const MAX_TUBES = 16;

/** One pooled tube of the shared strand renderer (strands.ts StrandTube) with its own material: a thin piece of the same jelly. */
class Tube {
  readonly mat: THREE.MeshPhysicalMaterial;
  private readonly t: StrandTube;
  get mesh(): THREE.Mesh { return this.t.mesh; }
  get radii(): Float32Array { return this.t.radii; }

  constructor(hub: EnvHub) {
    // glossy, see-through, its own colour plus a glow (the colours are set per use, no new material)
    this.mat = new THREE.MeshPhysicalMaterial({ roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    hub.apply(this.mat, 1.4);
    this.t = new StrandTube(this.mat, SEG, RAD);
  }

  build(ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number): void { this.t.build(ax, ay, az, bx, by, bz, sag); }

  /** The jelly colour (linear), its opacity, and a glow (linear rgb x strength). */
  paint(r: number, g: number, b: number, opacity: number, er: number, eg: number, eb: number): void {
    this.mat.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    this.mat.emissive.setRGB(er, eg, eb, THREE.LinearSRGBColorSpace);
    this.mat.opacity = opacity;
  }

  dispose(hub: EnvHub): void { hub.release(this.mat); this.mat.dispose(); this.t.dispose(); }
}

/** The vertex of `v` furthest along (dx, dy, dz) from its centre (its render positions): the skin facing that way. */
function facingVertex(v: BodyView, dx: number, dy: number, dz: number): number {
  const P = v.proxy.positions, n = v.proxy.vertexCount, c = v.proxy.center;
  let best = 0, bd = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = (P[i * 3] - c.x) * dx + (P[i * 3 + 1] - c.y) * dy + (P[i * 3 + 2] - c.z) * dz;
    if (d > bd) { bd = d; best = i; }
  }
  return best;
}

/** A unit direction from body a's centre to body b's (x if they coincide), into `out`. */
function axis(a: BodyView, b: BodyView, out: Float32Array): void {
  const ca = a.proxy.center, cb = b.proxy.center;
  let x = cb.x - ca.x, y = cb.y - ca.y, z = cb.z - ca.z;
  const l = Math.hypot(x, y, z);
  if (l < 1e-6) { x = 1; y = 0; z = 0; } else { x /= l; y /= l; z /= l; }
  out[0] = x; out[1] = y; out[2] = z;
}

/**
 * Round the tube's ends off where they reach inside the bodies (ring u < ua and u > ub): the jelly is see-through and drawn first, so a
 * flat open end inside it would show through as a glass bar's cut face; a rounded tip reads as the neck growing out of the jelly.
 */
function capEnds(r: Float32Array, ua: number, ub: number): void {
  const n = r.length - 1;
  for (let s = 0; s <= n; s++) {
    const u = s / n;
    if (u < ua && ua > 1e-4) { const t = u / ua; r[s] *= Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))); }
    else if (u > ub && ub < 1 - 1e-4) { const t = (1 - u) / (1 - ub); r[s] *= Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))); }
  }
}

const smooth01 = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** One thread of a parting. */
interface Thread {
  tube: Tube; ia: number; ib: number;
  /** The last anchor points (a body removed mid-strand: it springs back from there). */
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  /** Thickness, the length it started with, the length it snaps at, the age it snaps at, a wobble phase. */
  r0: number; L0: number; Lref: number; maxLen: number; T: number; phase: number;
  snapping: boolean; snapT: number; snapLen: number; done: boolean;
  /** The unit direction a -> b of the last frame (the snapped halves retract along it) and how far along the thread has thinned (0..1). */
  dx: number; dy: number; dz: number; prog: number;
}
interface Parting {
  threads: Thread[]; a: BodyView; b: BodyView; age: number; done: boolean;
  /** The pull axis (a -> b, unit), last frame. */
  px: number; py: number; pz: number;
  /** The snap event of this parting went out. */
  announced: boolean; seen: boolean;
}
interface Bridge {
  tube: Tube; a: BodyView; b: BodyView; target: number; amt: number; fading: boolean;
  /** Tube ends (inside each body), the skin points where it joins each body, the gap between them along the axis, the live radii. */
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  sx: number; sy: number; sz: number; tx: number; ty: number; tz: number; gap: number; ra: number; rb: number;
}

export class CutFx {
  readonly group = new THREE.Group();
  /** Parting-strand events this frame (the stage forwards them through onStrand with bodyId = the first piece). */
  readonly events: StrandEvent[] = [];
  readonly eventBody: number[] = [];
  private readonly hub: EnvHub;
  private readonly pool: Tube[] = [];
  private readonly free: Tube[] = [];
  private readonly partings: Parting[] = [];
  private readonly bridges: Bridge[] = [];
  private readonly dir = new Float32Array(3);
  private readonly evPool: StrandEvent[] = Array.from({ length: MAX_TUBES }, () => ({ finger: 0 as 0 | 1, tension: 0, snap: false, x: 0, y: 0, z: 0 }));
  /** A cut body's seam, kept for a moment after the body is removed so the pieces can carry it on (see header). */
  private readonly lastSeam = { nx: 0, ny: 1, nz: 0, d: 0, amt: 0, age: 1e9 };
  calm = false;
  /** Readout for the probe: live strands / bridges, the brightest glow this frame (0..1). */
  readonly live = { strands: 0, bridges: 0, glow: 0 };

  constructor(hub: EnvHub) { this.hub = hub; this.group.frustumCulled = false; }

  private take(): Tube | null {
    const t = this.free.pop();
    if (t) return t;
    if (this.pool.length >= MAX_TUBES) return null;
    const n = new Tube(this.hub);
    this.pool.push(n); this.group.add(n.mesh);
    return n;
  }
  private give(t: Tube): void { t.mesh.visible = false; this.free.push(t); }

  /** A body is being removed: remember its seam (the pieces carry it on), let its bridges / strands spring back toward the survivor. */
  bodyRemoved(v: BodyView): void {
    if (v.seamAmount > 0.02) {
      const s = this.lastSeam, u = v.mats.uniforms.uSeam.value;
      s.nx = u.x; s.ny = u.y; s.nz = u.z; s.d = u.w; s.amt = v.seamAmount; s.age = 0;
    }
    // (a strand on it snaps on the next update, from its last anchors, with its snap event: the body is no longer live)
    for (const b of this.bridges) if (b.a === v || b.b === v) { b.fading = true; b.target = 0; }
  }

  /** partPieces(a, b): threads between two freshly cut pieces (and the cut's seam carried over onto both, fading). */
  part(a: BodyView, b: BodyView): void {
    if (a === b) return;
    const s = this.lastSeam;
    if (s.age < 0.5 && s.amt > 0.02) for (const v of [a, b]) v.carrySeam(s.nx, s.ny, s.nz, s.d, s.amt);
    for (const p of this.partings) if (!p.done && ((p.a === a && p.b === b) || (p.a === b && p.b === a))) return;
    // tack x stringiness: sticky stretch 0.81, slime 0.75, mochi 0.13, gummy 0.12, gel 0.05, foam / dome / beads ~0
    const k = Math.min(1, Math.max(0, a.mats.tack * (0.35 + 0.65 * a.mats.stringiness)));
    const calmK = this.calm ? 0.5 : 1;
    const n = k >= 0.5 ? PART_STRANDS : k >= 0.12 ? 2 : 1;
    if (this.free.length + (MAX_TUBES - this.pool.length) < n) return;   // (the pool is spoken for: no strand this time, the cut still parts)
    const d = this.dir;
    axis(a, b, d);
    // sideways (horizontal, across the pull axis): where the second and third thread hang on the faces
    let lx = -d[2], lz = d[0];
    const ll = Math.hypot(lx, lz);
    if (ll < 1e-4) { lx = 1; lz = 0; } else { lx /= ll; lz /= ll; }
    const R = Math.min(a.liveRadius, b.liveRadius);
    const P = a.proxy.positions, Q = b.proxy.positions;
    const c = a.palette.body, pl = a.palette.pale;
    const threads: Thread[] = [];
    for (let j = 0; j < n; j++) {
      const tube = this.take();
      if (!tube) break;
      const t = TILT[j];
      // the strand runs between the two CUT FACES: the skin of each piece that faces the other one, off to a side for the later threads
      const ia = facingVertex(a, d[0] + lx * t[0], d[1] + t[1], d[2] + lz * t[0]), ib = facingVertex(b, -d[0] + lx * t[0], -d[1] + t[1], -d[2] + lz * t[0]);
      const gap0 = Math.max(0, (Q[ib * 3] - P[ia * 3]) * d[0] + (Q[ib * 3 + 1] - P[ia * 3 + 1]) * d[1] + (Q[ib * 3 + 2] - P[ia * 3 + 2]) * d[2]);
      const L0 = Math.max(gap0, 0.06 * R);
      const side = j === 0 ? 1 : 0.7;
      threads.push({
        tube, ia, ib, L0, Lref: Math.max(gap0, 0.4 * R), maxLen: L0 + R * (0.1 + 1.5 * k) * calmK * (1 - 0.12 * j), r0: R * (0.032 + 0.06 * k) * side,
        T: (0.24 + 0.85 * k) * (1 + 0.22 * j) * (this.calm ? 0.7 : 1), phase: j * 2.1,
        ax: P[ia * 3], ay: P[ia * 3 + 1], az: P[ia * 3 + 2], bx: Q[ib * 3], by: Q[ib * 3 + 1], bz: Q[ib * 3 + 2],
        snapping: false, snapT: 0, snapLen: 0, done: false, dx: d[0], dy: d[1], dz: d[2], prog: 0,
      });
      // gel: a barely-there wisp (clear and thin); a tacky body: its own colour, glossy, see-through like the jelly it is pulled from, lit
      // from inside a little by the body's own colour
      tube.paint(c[0] + (pl[0] - c[0]) * 0.12, c[1] + (pl[1] - c[1]) * 0.12, c[2] + (pl[2] - c[2]) * 0.12, 0.35 + 0.4 * Math.min(1, k / 0.5), c[0] * 0.3, c[1] * 0.3, c[2] * 0.3);
      tube.mesh.visible = false;   // shown once the cut faces have parted
    }
    if (!threads.length) return;
    this.partings.push({ threads, a, b, age: 0, done: false, px: d[0], py: d[1], pz: d[2], announced: false, seen: false });
  }

  /** setBridge(a, b, t): t 0..1 (0 = let it go). */
  bridge(a: BodyView, b: BodyView, t: number): void {
    const tt = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
    let br: Bridge | null = null;
    for (const x of this.bridges) if ((x.a === a && x.b === b) || (x.a === b && x.b === a)) { br = x; break; }
    if (!br) {
      if (tt <= 0 || a === b) return;
      const tube = this.take();
      if (!tube) return;
      br = { tube, a, b, target: 0, amt: 0, fading: false, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, gap: 0, ra: a.liveRadius, rb: b.liveRadius };
      this.bridges.push(br);
      const c = a.palette.body;
      tube.paint(c[0], c[1], c[2], 0.88, 0, 0, 0);
    }
    // present at once (see the header): the shell's t only decides how it ends
    br.target = tt > 0 ? Math.max(tt, 0.72) : 0; br.fading = false;
  }

  /**
   * One frame, after the views updated (their render positions are current). `govK` 0..1 holds every glow down (the FlashGovernor:
   * lower for a second after a granted ceremony flash).
   */
  update(dt: number, govK: number): void {
    this.events.length = 0; this.eventBody.length = 0;
    this.lastSeam.age += dt;
    let ev = 0, glow = 0, strands = 0;
    // ---- parting threads ----
    const d = this.dir;
    for (let i = this.partings.length - 1; i >= 0; i--) {
      const p = this.partings[i];
      if (p.done) { for (const th of p.threads) this.give(th.tube); this.partings.splice(i, 1); continue; }
      p.age += dt;
      const live = p.a.visible && p.b.visible && !p.a.isDisposed && !p.b.isDisposed;
      if (live) { axis(p.a, p.b, d); p.px = d[0]; p.py = d[1]; p.pz = d[2]; }
      let allDone = true;
      for (let j = 0; j < p.threads.length; j++) {
        const th = p.threads[j];
        if (th.done) continue;
        allDone = false;
        if (live && !th.snapping) {
          const P = p.a.proxy.positions, Q = p.b.proxy.positions;
          th.ax = P[th.ia * 3]; th.ay = P[th.ia * 3 + 1]; th.az = P[th.ia * 3 + 2];
          th.bx = Q[th.ib * 3]; th.by = Q[th.ib * 3 + 1]; th.bz = Q[th.ib * 3 + 2];
        }
        // its length: how far the two anchors have parted along the pull axis (<= 0: the cut faces still overlap, nothing shows yet)
        const L = (th.bx - th.ax) * p.px + (th.by - th.ay) * p.py + (th.bz - th.az) * p.pz;
        const r = th.tube.radii;
        if (!th.snapping) {
          // thinning: by how far it has stretched or how long it has hung, whichever is more (a thread thins as it ages)
          const stretch = Math.min(1, Math.max(0, (L - th.L0) / Math.max(1e-3, th.maxLen - th.L0)));
          th.prog = Math.max(stretch, Math.min(1, p.age / th.T));
          if (!live || L >= th.maxLen || p.age >= th.T) {
            th.snapping = true; th.snapT = 0; th.snapLen = Math.max(0, Math.hypot(th.bx - th.ax, th.by - th.ay, th.bz - th.az));
            th.dx = th.bx - th.ax; th.dy = th.by - th.ay; th.dz = th.bz - th.az;
            const l = Math.hypot(th.dx, th.dy, th.dz);
            if (l > 1e-5) { th.dx /= l; th.dy /= l; th.dz /= l; } else { th.dx = p.px; th.dy = p.py; th.dz = p.pz; }
            if (!p.announced && ev < this.evPool.length) {   // (one snap event per parting, whatever it looked like: the shell's strand voice owns the sound)
              p.announced = true;
              const e = this.evPool[ev++]; e.finger = 0; e.tension = 0; e.snap = true; e.x = (th.ax + th.bx) / 2; e.y = (th.ay + th.by) / 2; e.z = (th.az + th.bz) / 2;
              this.events.push(e); this.eventBody.push(p.a.id);
            }
          }
        }
        // the tube is drawn from INSIDE one piece to inside the other (its open ends hide in the jelly)
        const e0 = Math.min(0.2 * p.a.liveRadius, th.r0 * 2.4);
        if (th.snapping) {
          th.snapT += dt;
          if (this.calm || th.snapT >= SNAP_S || th.snapLen <= 0) { th.done = true; th.tube.mesh.visible = false; continue; }
          // split in the middle: each half pulls back into its own piece, thinning to nothing
          const sp = th.snapT / SNAP_S, k = 1 - sp;
          const thin = Math.sqrt(Math.max(0.05, th.Lref / Math.max(th.snapLen, 1e-3)));
          for (let s = 0; s <= SEG; s++) {
            const u = s / SEG, half = u < 0.5 ? u / 0.5 : (1 - u) / 0.5;   // 0 at the ends .. 1 at the middle
            r[s] = th.r0 * Math.min(1, thin) * 0.5 * k * Math.max(0, 1 - half * (0.4 + 0.6 * sp) * 1.6) * (1 + 1.0 * Math.pow(1 - half, 5));
          }
          th.tube.build(th.ax - th.dx * e0, th.ay - th.dy * e0, th.az - th.dz * e0, th.ax + th.dx * (th.snapLen + e0), th.ay + th.dy * (th.snapLen + e0), th.az + th.dz * (th.snapLen + e0), 0.14 * k * th.snapLen);
          strands++;
          continue;
        }
        if (L <= 0.01 * p.a.liveRadius) {   // the faces have not parted yet
          th.tube.mesh.visible = false;
        } else {
          p.seen = true;
          // anchor to anchor (a thread leans: the faces slide past each other as they part), reaching e0 into each piece
          let ux = th.bx - th.ax, uy = th.by - th.ay, uz = th.bz - th.az;
          const len = Math.hypot(ux, uy, uz) || 1e-4;
          ux /= len; uy /= len; uz /= len;
          const Ltot = len + 2 * e0, prog = th.prog;
          // volume conserved (n x the first length = 1 / sqrt(n) as thick), a deep thin neck as it ages, a soft skirt where it leaves each face,
          // a slow swelling along it (gooey strings are never a ruled cylinder)
          const volK = Math.min(1.15, Math.sqrt(Math.max(0.1, th.Lref / Math.max(len, 1e-3))));
          const neck = 1 - 0.86 * Math.pow(prog, 1.2);
          for (let s = 0; s <= SEG; s++) {
            const u = s / SEG, w = 4 * u * (1 - u);
            const skirt = Math.pow(1 - w, 2.4);
            const swell = 1 + 0.16 * Math.sin(u * 9.4 + th.phase) * w;
            r[s] = th.r0 * volK * (1 + 1.2 * skirt) * (1 - (1 - neck) * Math.pow(w, 1.1)) * swell;
          }
          capEnds(r, e0 / Ltot, 1 - e0 / Ltot);
          th.tube.build(th.ax - ux * e0, th.ay - uy * e0, th.az - uz * e0, th.bx + ux * e0, th.by + uy * e0, th.bz + uz * e0, 0.12 + 0.1 * prog);
          th.tube.mesh.visible = true;
          strands++;
          if (j === 0 && ev < this.evPool.length) {
            const e = this.evPool[ev++]; e.finger = 0; e.tension = 1 - 0.7 * prog; e.snap = false; e.x = (th.ax + th.bx) / 2; e.y = (th.ay + th.by) / 2; e.z = (th.az + th.bz) / 2;
            this.events.push(e); this.eventBody.push(p.a.id);
          }
        }
      }
      if (allDone) p.done = true;
    }
    // ---- reconnect bridges ----
    const calmK = this.calm ? 0.55 : 1;
    for (let i = this.bridges.length - 1; i >= 0; i--) {
      const b = this.bridges[i];
      // eased: in over ~0.15 s, out over ~0.25 s (a removed body: out over 0.18 s from where it was)
      const rate = b.target > b.amt ? 7 : b.fading ? 12 : 4.5;
      b.amt += (b.target - b.amt) * (1 - Math.exp(-dt * rate));
      if (b.amt < 0.01 && b.target <= 0) {
        if (!b.a.isDisposed) b.a.setSpot(0, 0, 0, 0);
        if (!b.b.isDisposed) b.b.setSpot(0, 0, 0, 0);
        this.give(b.tube); this.bridges.splice(i, 1); continue;
      }
      const live = !b.fading && b.a.visible && b.b.visible && !b.a.isDisposed && !b.b.isDisposed;
      // the bodies' CURRENT sizes (a giver shrinks into the receiver while they reconnect)
      if (live) { b.ra = b.a.liveRadius; b.rb = b.b.liveRadius; }
      const R = Math.min(b.ra, b.rb), a = b.amt;
      const rEnd = R * (0.22 + 0.33 * a), rMid = Math.min(rEnd, R * (0.12 + 0.4 * a));
      if (live) {
        // between the two facing skins, reaching into each body (the neck grows OUT of the jelly)
        axis(b.a, b.b, d);
        const ia = facingVertex(b.a, d[0], d[1], d[2]), ib = facingVertex(b.b, -d[0], -d[1], -d[2]);
        const P = b.a.proxy.positions, Q = b.b.proxy.positions;
        const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2], bx = Q[ib * 3], by = Q[ib * 3 + 1], bz = Q[ib * 3 + 2];
        b.gap = (bx - ax) * d[0] + (by - ay) * d[1] + (bz - az) * d[2];
        const ea = Math.min(0.6 * b.ra, rEnd * 1.1), eb = Math.min(0.6 * b.rb, rEnd * 1.1);
        b.ax = ax - d[0] * ea; b.ay = ay - d[1] * ea; b.az = az - d[2] * ea;
        b.bx = ax + d[0] * (Math.max(0, b.gap) + eb); b.by = ay + d[1] * (Math.max(0, b.gap) + eb); b.bz = az + d[2] * (Math.max(0, b.gap) + eb);
        b.sx = ax; b.sy = ay; b.sz = az; b.tx = bx; b.ty = by; b.tz = bz;
      }
      // overlapping bodies are already joined: the neck sinks into them (no tube poking out of a merged blob)
      const vis = smooth01(-0.25 * R, 0.02 * R, b.gap) * Math.min(1, a * 6);
      const r = b.tube.radii;
      for (let s = 0; s <= SEG; s++) {
        const u = s / SEG, w = Math.pow(Math.sin(Math.PI * u), 1.4);
        r[s] = (rEnd + (rMid - rEnd) * w) * vis;
      }
      { const lt = Math.hypot(b.bx - b.ax, b.by - b.ay, b.bz - b.az) || 1, ea = Math.min(0.6 * b.ra, rEnd * 1.1), eb = Math.min(0.6 * b.rb, rEnd * 1.1); capEnds(r, Math.min(0.45, ea / lt), Math.max(0.55, 1 - eb / lt)); }
      b.tube.build(b.ax, b.ay, b.az, b.bx, b.by, b.bz, 0);
      b.tube.mesh.visible = vis > 0.01;
      // the glow: warm light inside the neck, and a soft spot on each body where it joins; capped, eased, governed
      const g = 0.55 * a * calmK * govK;
      const sc = b.a.mats.uniforms.uSeamCol.value;
      b.tube.mat.emissive.setRGB(sc.r * g * 0.9, sc.g * g * 0.9, sc.b * g * 0.9, THREE.LinearSRGBColorSpace);
      // (a fading bridge dims its spots with it: a surviving body's spot never drops out in one frame)
      if (!b.a.isDisposed) b.a.setSpot(b.sx, b.sy, b.sz, g * 0.8);
      if (!b.b.isDisposed) b.b.setSpot(b.tx, b.ty, b.tz, g * 0.8);
      glow = Math.max(glow, g);
    }
    this.live.strands = strands; this.live.bridges = this.bridges.length; this.live.glow = glow;
  }

  /** Everything off at once (clearBodies / dispose). */
  clear(): void {
    for (const p of this.partings) for (const th of p.threads) this.give(th.tube);
    for (const b of this.bridges) this.give(b.tube);
    this.partings.length = 0; this.bridges.length = 0; this.lastSeam.age = 1e9;
    this.live.strands = 0; this.live.bridges = 0; this.live.glow = 0;
  }

  dispose(): void {
    this.clear();
    for (const t of this.pool) t.dispose(this.hub);
    this.pool.length = 0; this.free.length = 0;
    this.group.removeFromParent();
  }
}
