// CUT visuals (_spec/CUT.md section 4, RENDER): what the stage draws BETWEEN bodies while a squishy is cut and put back together.
//   * the PARTING STRAND (StageLike.partPieces): right after the swap at neck t = 1 a strand of the same jelly hangs between the two new
//     pieces, stretches as they separate, thins (its volume is conserved), necks and SNAPS, both halves springing back into their pieces.
//     How far it stretches is the family's tack x stringiness (resolveMaterial(...).physics): long for sticky stretch and slime, barely
//     there for gel; calm effects halve it. Drawn with the tack-strand renderer (strands.ts StrandTube) between two moving anchors.
//   * the RECONNECT BRIDGE (StageLike.setBridge): a glowing neck of the jelly between two bodies, thin at t = 0+, as thick as the smaller
//     body's waist at t = 1, flaring where it joins each body, with a soft warm glow spot on each body where it joins (uSpot).
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
/** A parting strand that never reaches its length (the pieces barely move apart) snaps anyway after this long. */
const PART_MAX_S = 1.1;
/** Most bridges / strands alive at once (CUT.md: at most 6 pieces, so 5 bridges in a Reconnect all). */
const MAX_TUBES = 8;

/** One pooled tube of the shared strand renderer (strands.ts StrandTube) with its own material: a thin piece of the same jelly. */
class Tube {
  readonly mat: THREE.MeshPhysicalMaterial;
  private readonly t: StrandTube;
  get mesh(): THREE.Mesh { return this.t.mesh; }
  get radii(): Float32Array { return this.t.radii; }

  constructor(hub: EnvHub) {
    // glossy, see-through, its own colour plus a glow (the colours are set per use, no new material)
    this.mat = new THREE.MeshPhysicalMaterial({ roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
    hub.apply(this.mat, 1.2);
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

interface Parting {
  tube: Tube; a: BodyView; b: BodyView; ia: number; ib: number;
  age: number; maxLen: number; r0: number; L0: number; snapping: boolean; snapT: number; snapLen: number; done: boolean;
  /** The last anchor points (a body removed mid-strand: it springs back from there). */
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  /** The pull axis (a -> b, unit) and the length drawn last frame (0 = the cut faces still overlap: nothing to draw yet). */
  dx: number; dy: number; dz: number; drawnLen: number;
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

  /** partPieces(a, b): a strand between two freshly cut pieces (and the cut's seam carried over onto both, fading). */
  part(a: BodyView, b: BodyView): void {
    if (a === b) return;
    const s = this.lastSeam;
    if (s.age < 0.5 && s.amt > 0.02) for (const v of [a, b]) v.carrySeam(s.nx, s.ny, s.nz, s.d, s.amt);
    for (const p of this.partings) if (!p.done && ((p.a === a && p.b === b) || (p.a === b && p.b === a))) return;
    const tube = this.take();
    if (!tube) return;
    // the strand runs between the two CUT FACES: the skin of each piece that faces the other one
    const d = this.dir;
    axis(a, b, d);
    const ia = facingVertex(a, d[0], d[1], d[2]), ib = facingVertex(b, -d[0], -d[1], -d[2]);
    const R = Math.min(a.liveRadius, b.liveRadius);
    // tack x stringiness: sticky stretch 0.81, slime 0.75, mochi 0.13, gummy 0.12, gel 0.05, foam / dome / beads ~0
    const k = Math.min(1, Math.max(0, a.mats.tack * (0.35 + 0.65 * a.mats.stringiness)));
    const calmK = this.calm ? 0.5 : 1;
    const P = a.proxy.positions, Q = b.proxy.positions;
    const gap0 = Math.max(0, (Q[ib * 3] - P[ia * 3]) * d[0] + (Q[ib * 3 + 1] - P[ia * 3 + 1]) * d[1] + (Q[ib * 3 + 2] - P[ia * 3 + 2]) * d[2]);
    const L0 = Math.max(gap0, 0.06 * R);
    this.partings.push({
      tube, a, b, ia, ib, age: 0, maxLen: L0 + R * (0.1 + 1.5 * k) * calmK, r0: R * (0.05 + 0.1 * k), L0,
      snapping: false, snapT: 0, snapLen: 0, done: false, ax: P[ia * 3], ay: P[ia * 3 + 1], az: P[ia * 3 + 2], bx: Q[ib * 3], by: Q[ib * 3 + 1], bz: Q[ib * 3 + 2],
      dx: d[0], dy: d[1], dz: d[2], drawnLen: 0,
    });
    const c = a.palette.body, pl = a.palette.pale;
    // gel: a barely-there wisp (clear and thin); a tacky body: its own colour, glossy
    // see-through like the jelly it is pulled from, lit from inside a little by the body's own colour
    tube.paint(c[0] + (pl[0] - c[0]) * 0.35, c[1] + (pl[1] - c[1]) * 0.35, c[2] + (pl[2] - c[2]) * 0.35, 0.4 + 0.35 * Math.min(1, k / 0.5), c[0] * 0.55, c[1] * 0.55, c[2] * 0.55);
    tube.mesh.visible = false;   // shown once the cut faces have parted
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
    br.target = tt; br.fading = false;
  }

  /**
   * One frame, after the views updated (their render positions are current). `govK` 0..1 holds every glow down (the FlashGovernor:
   * lower for a second after a granted ceremony flash).
   */
  update(dt: number, govK: number): void {
    this.events.length = 0; this.eventBody.length = 0;
    this.lastSeam.age += dt;
    let ev = 0, glow = 0;
    // ---- parting strands ----
    const d = this.dir;
    for (let i = this.partings.length - 1; i >= 0; i--) {
      const p = this.partings[i];
      if (p.done) { this.give(p.tube); this.partings.splice(i, 1); continue; }   // (not per frame: once per strand)
      p.age += dt;
      const live = !p.snapping && p.a.visible && p.b.visible && !p.a.isDisposed && !p.b.isDisposed;
      if (live) {
        const P = p.a.proxy.positions, Q = p.b.proxy.positions;
        p.ax = P[p.ia * 3]; p.ay = P[p.ia * 3 + 1]; p.az = P[p.ia * 3 + 2];
        p.bx = Q[p.ib * 3]; p.by = Q[p.ib * 3 + 1]; p.bz = Q[p.ib * 3 + 2];
        axis(p.a, p.b, d); p.dx = d[0]; p.dy = d[1]; p.dz = d[2];
      }
      // its length: how far the two cut faces have parted along the pull axis (<= 0: they still overlap, nothing shows yet)
      const L = (p.bx - p.ax) * p.dx + (p.by - p.ay) * p.dy + (p.bz - p.az) * p.dz;
      if (!p.snapping && (!live || L >= p.maxLen || p.age >= PART_MAX_S)) {
        p.snapping = true; p.snapT = 0; p.snapLen = Math.max(0, L);
        if (ev < this.evPool.length) {
          const e = this.evPool[ev++]; e.finger = 0; e.tension = 0; e.snap = true; e.x = (p.ax + p.bx) / 2; e.y = (p.ay + p.by) / 2; e.z = (p.az + p.bz) / 2;
          this.events.push(e); this.eventBody.push(p.a.id);
        }
      }
      const r = p.tube.radii;
      // the tube is drawn from INSIDE one piece to inside the other (its open ends hide in the jelly)
      const e0 = Math.min(0.2 * p.a.liveRadius, p.r0 * 2.2);
      if (p.snapping) {
        p.snapT += dt;
        if (this.calm || p.snapT >= SNAP_S || p.snapLen <= 0) { p.done = true; p.tube.mesh.visible = false; continue; }
        // split in the middle: each half pulls back into its own piece, thinning to nothing
        const sp = p.snapT / SNAP_S, k = 1 - sp;
        const thin = Math.sqrt(Math.max(0.05, p.L0 / Math.max(p.snapLen, 1e-3)));
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG, half = u < 0.5 ? u / 0.5 : (1 - u) / 0.5;   // 0 at the ends .. 1 at the middle
          r[s] = p.r0 * thin * k * Math.max(0, 1 - half * (0.4 + 0.6 * sp) * 1.6) * (1 + 0.9 * Math.pow(1 - half, 6));
        }
        p.tube.build(p.ax - p.dx * e0, p.ay - p.dy * e0, p.az - p.dz * e0, p.ax + p.dx * (p.snapLen + e0), p.ay + p.dy * (p.snapLen + e0), p.az + p.dz * (p.snapLen + e0), 0.1 * k);
        continue;
      }
      if (L <= 0.01 * p.a.liveRadius) {   // the faces have not parted yet
        p.tube.mesh.visible = false; p.drawnLen = 0;
      } else {
        // stretching: volume conserved (n x the first length = 1 / sqrt(n) as thick), the neck deepens with the stretch, a blob at each face
        const thin = Math.min(1.6, Math.sqrt(Math.max(0.05, p.L0 / Math.max(L, 1e-3))));
        const stretch = Math.min(1, Math.max(0, (L - p.L0) / Math.max(1e-3, p.maxLen - p.L0)));
        const Ltot = L + 2 * e0;
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG, w = 4 * u * (1 - u);
          // never fatter than the parted gap allows (a short fresh strand is a stubby neck, not a ring)
          // a soft catenary-like thinning toward the middle (no hard collar where it leaves each face)
          const flare = Math.pow(1 - w, 2);
          r[s] = Math.min(p.r0 * thin * (1 - 0.7 * stretch * w) * (1 + 0.9 * flare), 0.18 * Ltot + 0.5 * p.r0);
        }
        capEnds(r, e0 / Ltot, 1 - e0 / Ltot);
        p.tube.build(p.ax - p.dx * e0, p.ay - p.dy * e0, p.az - p.dz * e0, p.ax + p.dx * (L + e0), p.ay + p.dy * (L + e0), p.az + p.dz * (L + e0), 0.12 * stretch);
        p.tube.mesh.visible = true; p.drawnLen = L;
        if (ev < this.evPool.length) {
          const e = this.evPool[ev++]; e.finger = 0; e.tension = 1 - 0.7 * stretch; e.snap = false; e.x = p.ax + p.dx * L * 0.5; e.y = p.ay + p.dy * L * 0.5; e.z = p.az + p.dz * L * 0.5;
          this.events.push(e); this.eventBody.push(p.a.id);
        }
      }
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
    this.live.strands = this.partings.length; this.live.bridges = this.bridges.length; this.live.glow = glow;
  }

  /** Everything off at once (clearBodies / setBody / dispose). */
  clear(): void {
    for (const p of this.partings) this.give(p.tube);
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
