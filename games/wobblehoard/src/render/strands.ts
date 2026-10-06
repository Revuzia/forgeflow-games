// Tack strands (stage B item B6; SQUISHY_SCIENCE P6; REFERENCES "pull. pop."): a tacky body (sticky stretch, slime, mochi) strings when a
// fingertip that held its skin pulls away. The physics reports how much it strings (SoftMetrics.strands, optional: feature-detected; it
// rises to the family's tack x stringiness when a held fingertip lifts and thins out with a time constant of 0.08..0.28 s); this draws
// the string: a translucent tube from the skin where the finger was to the receding fingertip, that STRETCHES, THINS (its volume is
// conserved), NECKS in the middle and SNAPS, both halves springing back with a few tiny bubbles. One tube per finger, built lazily the first
// time a body strings (non-tacky families never allocate anything). Zero per-frame allocation; deterministic.
//
// Hook points for the shell's strand voice (_spec/SOUND.md round 3, `audio.strand`): `events` lists, after each update, every finger whose
// strand stretched this frame ({ tension }, call audio.strand({ tension }) every frame while it does) and the frame it snapped
// ({ snap: true }, call audio.strand({ tension: 0, snap: true }) once). The stage forwards them through its `onStrand` hook.
import * as THREE from 'three';
import type { EnvHub } from './env.ts';
import type { Rgb } from './oklch.ts';

const SEG = 14;          // rings along the strand
const RAD = 6;           // vertices around
/** Fingertip pull-away speed after the lift (m/s), and how long a strand may get before it snaps whatever the physics says (x restRadius). */
const PULL_SPEED = 1.3, MAX_LEN = 1.4;
/** It snaps when the physics' strands signal has thinned to this fraction of its peak. */
const SNAP_AT = 0.22;
const SNAP_S = 0.16;     // the two halves spring back over this long

export interface StrandEvent { finger: 0 | 1; tension: number; snap: boolean; x: number; y: number; z: number }

export interface StrandBody {
  readonly positions: Float32Array;
  readonly vertexCount: number;
  readonly center: { x: number; y: number; z: number };
  readonly restRadius: number;
}

/**
 * The strand renderer: a tube of the jelly from A to B, one radius per ring and an optional per-ring position along it (0..1; a snapping
 * strand's halves bunch toward their ends), sagging a little in the middle. Positions and normals are rebuilt in place (no allocation).
 * The tack strands below and the CUT parting strand / reconnect bridge (cutfx.ts) all draw with it.
 */
export class StrandTube {
  readonly mesh: THREE.Mesh;
  /** Radius per ring (seg + 1), world units. */
  readonly radii: Float32Array;
  /** Where each ring sits along A..B (0..1), or null: evenly spaced. */
  along: Float32Array | null = null;
  private readonly seg: number;
  private readonly rad: number;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;

  constructor(mat: THREE.Material, seg = SEG, rad = RAD) {
    this.seg = seg; this.rad = rad;
    this.radii = new Float32Array(seg + 1);
    this.pos = new Float32Array((seg + 1) * rad * 3);
    this.nrm = new Float32Array((seg + 1) * rad * 3);
    const idx: number[] = [];
    for (let s = 0; s < seg; s++) for (let k = 0; k < rad; k++) {
      const a = s * rad + k, b = s * rad + ((k + 1) % rad), c = (s + 1) * rad + k, d = (s + 1) * rad + ((k + 1) % rad);
      idx.push(a, b, c, b, d, c);   // counter-clockwise seen from outside (the ring runs from u toward v = dir x u)
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;            // just after the jellies (10.xx): it hangs in front of the skin
    this.mesh.visible = false;
  }

  /** Rebuild from A to B; `sag` x length x 4u(1 - u) pulls the middle down. */
  build(ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number): void {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 1e-4;
    dx /= L; dy /= L; dz /= L;
    // an orthonormal frame around the direction
    let ux = -dz, uy = 0, uz = dx;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4) { ux = 1; uy = 0; uz = 0; ul = 1; }
    ux /= ul; uy /= ul; uz /= ul;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const P = this.pos, N = this.nrm, r = this.radii, al = this.along, seg = this.seg, rad = this.rad;
    for (let s = 0; s <= seg; s++) {
      const u = s / seg, f = al ? al[s] : u, sg = sag * L * 4 * u * (1 - u);
      const cx = ax + dx * f * L, cy = ay + dy * f * L - sg, cz = az + dz * f * L;
      for (let k = 0; k < rad; k++) {
        const a = (k / rad) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
        const o = (s * rad + k) * 3;
        P[o] = cx + nx * r[s]; P[o + 1] = cy + ny * r[s]; P[o + 2] = cz + nz * r[s];
        N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
      }
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); }
}

class Strand {
  readonly tube: StrandTube;
  get mesh(): THREE.Mesh { return this.tube.mesh; }
  active = false;
  snapping = false;
  anchor = -1;                  // the sim vertex the strand hangs from (it rides the body)
  dx = 0; dy = 0; dz = 1;       // pull direction (unit)
  len = 0;                      // current length (world units)
  peak = 0;                     // the strands signal's peak while this strand lives
  snapT = 0;
  r0 = 0.02;
  // the snapped length the halves retract from
  private snapLen = 0;
  private readonly alongBuf = new Float32Array(SEG + 1);

  constructor(mat: THREE.Material) {
    this.tube = new StrandTube(mat, SEG, RAD);
  }

  start(anchor: number, dx: number, dy: number, dz: number, len0: number, r0: number): void {
    this.active = true; this.snapping = false; this.anchor = anchor;
    const l = Math.hypot(dx, dy, dz) || 1;
    this.dx = dx / l; this.dy = dy / l; this.dz = dz / l;
    this.len = len0; this.peak = 0; this.snapT = 0; this.r0 = r0;
    this.tube.mesh.visible = true;
  }

  snap(): void { this.snapping = true; this.snapT = 0; this.snapLen = this.len; }

  stop(): void { this.active = false; this.snapping = false; this.tube.mesh.visible = false; }

  /**
   * Rebuild the tube from anchor point A along the pull direction. `tension` 0..1 thins it; necking narrows the middle as it stretches.
   * While snapping, the two halves (A side and tip side) shrink back toward their ends.
   */
  build(ax: number, ay: number, az: number, tension: number, maxLen: number): void {
    const L = this.snapping ? this.snapLen : this.len;
    // volume conservation: a strand pulled to n x its first length is 1 / sqrt(n) as thick; the physics' tension thins it further
    const thin = Math.sqrt(Math.max(0.05, (this.r0 * 4) / Math.max(L, 1e-3))) * (0.45 + 0.55 * tension);
    const stretch = Math.min(1, L / Math.max(1e-3, maxLen));
    const sp = this.snapping ? this.snapT / SNAP_S : 0;   // 0..1 while the halves retract
    const r = this.tube.radii, al = this.alongBuf;
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG;
      let along = u;
      let rr = this.r0 * thin * (1 - 0.82 * stretch * 4 * u * (1 - u));       // the neck deepens as it stretches
      rr *= 1 + 0.9 * Math.pow(1 - u, 6) + 0.6 * Math.pow(u, 8);             // a blob where it leaves the skin, a bead at the tip
      if (this.snapping) {
        // split at the middle: the A half pulls back toward the skin, the tip half toward the tip, both thinning to nothing
        const half = u < 0.5 ? u / 0.5 : (u - 0.5) / 0.5;
        const k = 1 - sp;
        along = u < 0.5 ? half * 0.5 * k : 1 - (1 - half) * 0.5 * k;
        rr *= k * (u < 0.5 ? 1 - 0.9 * half : 0.1 + 0.9 * half);
      }
      r[s] = rr; al[s] = along;
    }
    this.tube.along = al;
    this.tube.build(ax, ay, az, ax + this.dx * L, ay + this.dy * L, az + this.dz * L, 0.18 * (this.snapping ? 1 - sp : 1));
  }

  dispose(): void { this.tube.dispose(); }
}

/** The strands of ONE body view (the stage keeps one per view; nothing is built until the body first strings). */
export class TackStrands {
  readonly group = new THREE.Group();
  /** Filled by update(): what the shell's strand voice needs this frame (see the header). Reused array. */
  readonly events: StrandEvent[] = [];
  private strands: Strand[] | null = null;
  private mat: THREE.MeshPhysicalMaterial | null = null;
  private readonly hub: EnvHub;
  private readonly colour: Rgb;
  // fingertip tracking (from SoftBodyLike.tip, feature-detected): last position while the finger held the skin, how long it held
  private readonly tipX = new Float32Array(2); private readonly tipY = new Float32Array(2); private readonly tipZ = new Float32Array(2);
  private readonly tipR = new Float32Array(2); private readonly held = new Float32Array(2);
  private readonly hadTip = [false, false];
  private readonly evPool: StrandEvent[] = [
    { finger: 0, tension: 0, snap: false, x: 0, y: 0, z: 0 }, { finger: 1, tension: 0, snap: false, x: 0, y: 0, z: 0 },
    { finger: 0, tension: 0, snap: false, x: 0, y: 0, z: 0 }, { finger: 1, tension: 0, snap: false, x: 0, y: 0, z: 0 },
  ];
  /** Snapped this frame at (x, y, z) (the view spawns the bubbles). */
  readonly snapsAt: number[] = [];

  constructor(hub: EnvHub, bodyColour: Rgb, paleColour: Rgb) {
    this.hub = hub;
    // a pulled thread is thin, so it reads paler and clearer than the body (the jelly's "stretched goes pale"), and it has to read
    // against the body behind it
    this.colour = [bodyColour[0] + (paleColour[0] - bodyColour[0]) * 0.45, bodyColour[1] + (paleColour[1] - bodyColour[1]) * 0.45, bodyColour[2] + (paleColour[2] - bodyColour[2]) * 0.45];
    this.group.frustumCulled = false;
  }

  get active(): boolean { return !!this.strands && (this.strands[0].active || this.strands[1].active); }

  private ensure(): Strand[] {
    if (this.strands) return this.strands;
    const c = this.colour;
    // the body's own colour, glossy and see-through: a thin pulled thread of the same jelly
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace), roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
      transparent: true, opacity: 0.9, depthWrite: false, fog: false,
    });
    m.emissive.setRGB(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, THREE.LinearSRGBColorSpace);
    this.hub.apply(m, 1.2);
    this.mat = m;
    this.strands = [new Strand(m), new Strand(m)];
    this.group.add(this.strands[0].mesh, this.strands[1].mesh);
    return this.strands;
  }

  /**
   * One frame. `strands` = SoftMetrics.strands (undefined = the physics does not report it: nothing is drawn), `tips` the fingertip
   * spheres this frame (null when that finger has none), `calm` = calm effects (the strand still forms; it snaps without the spring-back).
   */
  update(dt: number, body: StrandBody, strands: number | undefined, tip0: { x: number; y: number; z: number; r: number } | null,
    tip1: { x: number; y: number; z: number; r: number } | null, calm: boolean): void {
    this.events.length = 0; this.snapsAt.length = 0;
    const sig = typeof strands === 'number' && Number.isFinite(strands) ? Math.min(1, Math.max(0, strands)) : 0;
    for (let f = 0; f < 2; f++) {
      const tp = f === 0 ? tip0 : tip1;
      if (tp) {
        this.tipX[f] = tp.x; this.tipY[f] = tp.y; this.tipZ[f] = tp.z; this.tipR[f] = tp.r;
        this.held[f] += dt; this.hadTip[f] = true;
        continue;
      }
      // the tip is gone (the finger lifted): if the body strings, a strand starts where it held the skin
      const st = this.strands ? this.strands[f] : null;
      if (this.hadTip[f] && sig > 0.02 && !(st && st.active)) {
        const s = this.ensure()[f];
        const a = nearestVertex(body, this.tipX[f], this.tipY[f], this.tipZ[f]);
        const P = body.positions;
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
        let dx = this.tipX[f] - ax, dy = this.tipY[f] - ay, dz = this.tipZ[f] - az;
        if (Math.hypot(dx, dy, dz) < 1e-4) { dx = ax - body.center.x; dy = ay - body.center.y; dz = az - body.center.z; }
        // the finger lifts up and away: a press made from the camera pulls straight back at it, which would show the strand end-on, so the
        // pull leans upward (it reads as a string rising off the skin from any orbit)
        const pl = Math.hypot(dx, dy, dz) || 1;
        s.start(a, 0.45 * dx / pl, 0.45 * dy / pl + 1, 0.45 * dz / pl, Math.max(this.tipR[f], 0.01) * 0.6, Math.max(0.012, this.tipR[f] * 0.4));
      }
      this.hadTip[f] = false; this.held[f] = 0;
    }
    if (!this.strands) return;
    let ev = 0;
    for (let f = 0; f < 2; f++) {
      const s = this.strands[f];
      if (!s.active) continue;
      const P = body.positions, a = s.anchor;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      if (s.snapping) {
        s.snapT += dt;
        if (calm || s.snapT >= SNAP_S) { s.stop(); continue; }
        s.build(ax, ay, az, 0, MAX_LEN * body.restRadius);
        continue;
      }
      s.peak = Math.max(s.peak, sig);
      s.len = Math.min(s.len + PULL_SPEED * dt * (1 - 0.5 * s.len / (MAX_LEN * body.restRadius)), MAX_LEN * body.restRadius * 1.05);
      const tension = s.peak > 0 ? sig / s.peak : 0;
      const tipX = ax + s.dx * s.len, tipY = ay + s.dy * s.len, tipZ = az + s.dz * s.len;
      if (sig < SNAP_AT * s.peak || s.len >= MAX_LEN * body.restRadius) {
        s.snap();
        const e = this.evPool[ev++]; e.finger = f as 0 | 1; e.tension = 0; e.snap = true; e.x = ax + s.dx * s.len * 0.5; e.y = ay + s.dy * s.len * 0.5; e.z = az + s.dz * s.len * 0.5;
        this.events.push(e);
        this.snapsAt.push(e.x, e.y, e.z);
        s.build(ax, ay, az, 0, MAX_LEN * body.restRadius);
        continue;
      }
      s.build(ax, ay, az, tension, MAX_LEN * body.restRadius);
      const e = this.evPool[ev++]; e.finger = f as 0 | 1; e.tension = tension * sig; e.snap = false; e.x = tipX; e.y = tipY; e.z = tipZ;
      this.events.push(e);
    }
  }

  dispose(): void {
    if (this.strands) for (const s of this.strands) s.dispose();
    if (this.mat) { this.hub.release(this.mat); this.mat.dispose(); }
    this.group.removeFromParent();
  }
}

function nearestVertex(body: StrandBody, x: number, y: number, z: number): number {
  const P = body.positions, n = body.vertexCount;
  let best = 0, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
