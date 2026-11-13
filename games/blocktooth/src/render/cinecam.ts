// BLOCKTOOTH v2 — the WARD-7 STREET CAM opening: camera planner + driver (FEATURES_V2 §11). VIEW.
//
// plan()   pure maths over the titan's FaceAnchor and w.city (buildings + props as boxes): picks a
//          camera-safe S2 low-angle close-up (null when none exists → the app plays the legacy slate),
//          an S1 street-level pose (the per-biome foreground element preferred: a parked car, a
//          snowbank, a boat), and reads the gameplay pose back from the CameraRig (reset + apply).
// start()  takes the camera: clip planes from the plan (0.05 / 2000 m), fov / roll per shot.
// update() per frame, AFTER CameraRig.update (game.ts drawWorld): the rig has just written the live
//          gameplay pose into the camera, so the crane and the skip blend always land exactly on it —
//          when the cinematic hands back, the next frame is the rig's own frame (no pop).
// skip()   a 0.25 s blend to the live gameplay pose, then hand-back (the overlay hides it under its
//          cut veil). stop() is the abort path: restore fov / near / far at once and let go.
//
// Shot list (§11.2, data/cine.ts CINE_TIMING): FULL = signal 0.35 · street 2.0 · closeup 2.5 · crane 1.6 ·
// handoff 0.4 (6.85 s); SHORT = closeup 1.5 · crane 1.2 · handoff 0.3 (3.0 s); REDUCED (reduce motion) =
// closeup 2.0 (no handheld, no orbit) · handoff 0.4 (a veil cut, no crane).
//
// Camera safety (§11.2): a pose is accepted only when the segment face → camera crosses no standing
// building AABB and no solid prop box, and the camera keeps ≥ 0.5 m from every building AABB.
//
// S1 also stays in the carriageway (sidewalks are crowded and kerb-high at 0.2 H) and rejects frame
// clutter: a body ≥ 1.9 m within 4.5 m of the lens anywhere in frame, or a car-height one within 5 m
// inside the crash-zoomed ±26° (at a 0.24 m lens a parked car is a wall, not "the bottom fifth").
//
// Measured (_harness/scratch/l10/planprobe.ts, node, seeds 1 / 11 / 711 / 712 / 713 / 1337 × 4 titans ×
// 3 biomes = 72 openings): 72 / 72 planned (no legacy fallback); S2 at ±50° on the first try every
// time; S1 found for all 72 (69 at ±30°, 3 at −60°; scratch/l10/planprobe_full.log); plan() ≤ 4.5 ms.

import type { PerspectiveCamera } from 'three';
import type { PropKind, World } from '../core/types.ts';
import type { CameraRig } from './camera.ts';
import type { CineCamApi, CineChannels, CinePlan, CineShot, CineShotId, CineVariant, CamPose, FaceAnchor } from '../v2types.ts';
import { CINE, CINE_BEATS, CINE_CAM, CINE_TIMING } from '../data/cine.ts';
import type { CineBiome } from '../data/cine.ts';
import { PROP_INFO } from '../city/citygen.ts';

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const sat = (v: number): number => clamp(v, 0, 1);
const smooth = (v: number): number => { const u = sat(v); return u * u * (3 - 2 * u); };
const easeInOutCubic = (v: number): number => { const u = sat(v); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const easeOutCubic = (v: number): number => { const u = sat(v); return 1 - Math.pow(1 - u, 3); };

/** Solid prop heights (m) for the sight-line test; thin poles (lamps, sign posts) never block a face. */
const PROP_H: Partial<Record<PropKind, number>> = {
  car: 1.45, taxi: 1.5, van: 2.1, bus: 3.2, truck: 3.3, kiosk: 2.6, hydrant: 0.8, bench: 0.9, vending: 1.9,
  barrier: 1.0, drum: 0.9, forklift: 2.2, container: 2.6, bollard: 1.0, boat: 1.1, pylon: 0.7, snowbank: 1.1,
};
/** the prop kinds that count as each biome's S1 foreground element */
const FOREGROUND: Record<CineBiome['foreground'], ReadonlySet<PropKind>> = {
  parkedCar: new Set<PropKind>(['car', 'taxi', 'van']),
  snowbank: new Set<PropKind>(['snowbank']),
  hull: new Set<PropKind>(['boat']),
};

/** an obstacle: an XZ box (centre, half extents along its own axes, heading) over a y range */
interface Box { cx: number; cz: number; hx: number; hz: number; c: number; s: number; y0: number; y1: number; bld: boolean; kind: PropKind | null }

/** 3D segment vs an oriented (in XZ) box: true when they intersect (slab test in the box frame). */
function segHitsBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, B: Box, pad = 0): boolean {
  // into the box frame: local x along (c, -s), local z along (s, c)
  const lax = (ax - B.cx) * B.c - (az - B.cz) * B.s, laz = (ax - B.cx) * B.s + (az - B.cz) * B.c;
  const lbx = (bx - B.cx) * B.c - (bz - B.cz) * B.s, lbz = (bx - B.cx) * B.s + (bz - B.cz) * B.c;
  let t0 = 0, t1 = 1;
  const slab = (a: number, b: number, lo: number, hi: number): boolean => {
    const d = b - a;
    if (Math.abs(d) < 1e-9) return a >= lo && a <= hi;
    let u0 = (lo - a) / d, u1 = (hi - a) / d;
    if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
    if (u0 > t0) t0 = u0;
    if (u1 < t1) t1 = u1;
    return t0 <= t1;
  };
  return slab(lax, lbx, -B.hx - pad, B.hx + pad) && slab(laz, lbz, -B.hz - pad, B.hz + pad) && slab(ay, by, B.y0 - pad, B.y1 + pad);
}
/** point inside a box grown by `pad` */
function inBox(x: number, y: number, z: number, B: Box, pad: number): boolean {
  const lx = (x - B.cx) * B.c - (z - B.cz) * B.s, lz = (x - B.cx) * B.s + (z - B.cz) * B.c;
  return Math.abs(lx) <= B.hx + pad && Math.abs(lz) <= B.hz + pad && y >= B.y0 - pad && y <= B.y1 + pad;
}
/** XZ distance from a point to a box's footprint (0 inside) */
function boxDistXZ(x: number, z: number, B: Box): number {
  const lx = (x - B.cx) * B.c - (z - B.cz) * B.s, lz = (x - B.cx) * B.s + (z - B.cz) * B.c;
  const dx = Math.max(0, Math.abs(lx) - B.hx), dz = Math.max(0, Math.abs(lz) - B.hz);
  return Math.hypot(dx, dz);
}

/** the largest cos(angle) between the unit view axis (vx, vz) from (x, z) and any corner / the centre of B */
function boxCosToAxis(x: number, z: number, vx: number, vz: number, B: Box): number {
  let best = -1;
  for (let i = 0; i < 5; i++) {
    const lx = i === 4 ? 0 : (i & 1 ? B.hx : -B.hx), lz = i === 4 ? 0 : (i & 2 ? B.hz : -B.hz);
    // box frame → world: x = cx + lx·c + lz·s, z = cz − lx·s + lz·c
    const px = B.cx + lx * B.c + lz * B.s - x, pz = B.cz - lx * B.s + lz * B.c - z;
    const pl = Math.hypot(px, pz);
    if (pl < 1e-6) return 1;
    const cs = (px * vx + pz * vz) / pl;
    if (cs > best) best = cs;
  }
  return best;
}

function copyPose(o: CamPose, p: CamPose): CamPose {
  o.x = p.x; o.y = p.y; o.z = p.z; o.tx = p.tx; o.ty = p.ty; o.tz = p.tz; o.fov = p.fov; o.roll = p.roll;
  return o;
}
function lerpPoseInto(o: CamPose, a: CamPose, b: CamPose, u: number): CamPose {
  o.x = a.x + (b.x - a.x) * u; o.y = a.y + (b.y - a.y) * u; o.z = a.z + (b.z - a.z) * u;
  o.tx = a.tx + (b.tx - a.tx) * u; o.ty = a.ty + (b.ty - a.ty) * u; o.tz = a.tz + (b.tz - a.tz) * u;
  o.fov = a.fov + (b.fov - a.fov) * u; o.roll = a.roll + (b.roll - a.roll) * u;
  return o;
}
const newPose = (): CamPose => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 30, roll: 0 });

/** Deterministic smooth noise in [-1, 1] (sum of incommensurate sines): the handheld wobble. */
function wob(t: number, seed: number): number {
  return 0.55 * Math.sin(t * 2.1 + seed) + 0.3 * Math.sin(t * 4.7 + seed * 1.7) + 0.15 * Math.sin(t * 9.3 + seed * 2.9);
}

export class CineCam implements CineCamApi {
  private readonly cam: PerspectiveCamera;
  private P: CinePlan | null = null;
  private rig: CameraRig | null = null;
  private bio: CineBiome = CINE.grideast;
  private on = false;
  private t = 0;
  private skipT = -1;
  private readonly skipFrom = newPose();
  private readonly cur = newPose();
  private readonly live = newPose();
  private readonly tmp = newPose();
  private readonly closeEnd = newPose();
  private saved = { fov: 30, near: 0.1, far: 1000 };
  private shotV: CineShot | null = null;
  private readonly shotObj: CineShot = { id: 'signal', t: 0, dur: 0, k: 0 };
  private readonly ch: CineChannels = { look: 0, blink: 0, snarl: 0 };
  /** +1 = the S2 camera stands on the titan's left (+X model side): the head turns that way */
  private lookSign = 1;
  /** the S2 orbit: camera azimuth (rad, world) at k = 0 and its sweep (rad); face point + horizontal distance */
  private closeAz = 0;
  private closeSweep = 0;
  private closeDist = 3;
  private readonly face = { x: 0, y: 0, z: 0, h: 1 };
  private boxes: Box[] = [];
  /** crane control points (computed at the first crane frame from the live gameplay pose) */
  private crane: number[] | null = null;

  constructor(camera: PerspectiveCamera) { this.cam = camera; }

  get active(): boolean { return this.on; }
  get shot(): CineShot | null { return this.on ? this.shotV : null; }

  // ─────────────────────────────── planning ───────────────────────────────
  plan(w: World, rig: CameraRig, face: FaceAnchor, variant: CineVariant): CinePlan | null {
    const H = face.h;
    if (!(H > 0.05) || !Number.isFinite(face.x + face.y + face.z)) return null;
    const bio = CINE[w.biomeId] ?? CINE.grideast;
    this.bio = bio;
    this.rig = rig;
    const C = CINE_CAM;
    // the head's forward in XZ (fallback: the titan's heading)
    let fx = face.fx, fz = face.fz;
    let fl = Math.hypot(fx, fz);
    if (!(fl > 1e-4)) { fx = Math.sin(w.titan.heading); fz = Math.cos(w.titan.heading); fl = 1; }
    fx /= fl; fz /= fl;
    const lx = fz, lz = -fx;                                    // the titan's left (model +X) in XZ
    const boxes = this.boxes = this.collect(w, face, H * 12 + 30);
    const B = w.city.bounds;
    const inBounds = (x: number, z: number): boolean => x > B.minX - 8 && x < B.maxX + 8 && z > B.minZ - 8 && z < B.maxZ + 8;
    /** camera-safe: clear sight lines to the face point AND to the body's middle, ≥ clearM from every
     *  building (a prop may not hide the body either: a lorry's wheel box in front of the torso reads as
     *  a black wall at street level) */
    const bx = w.titan.x, bz = w.titan.z, by = 0.3 * H;
    const safe = (x: number, y: number, z: number, ty: number): boolean => {
      if (!inBounds(x, z)) return false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.bld ? inBox(x, y, z, b, C.clearM) : inBox(x, y, z, b, 0.12)) return false;
        if (segHitsBox(face.x, ty, face.z, x, y, z, b)) return false;
        if (segHitsBox(bx, by, bz, x, y, z, b)) return false;
      }
      return true;
    };
    const dirAt = (a: number): [number, number] => [fx * Math.cos(a) + lx * Math.sin(a), fz * Math.cos(a) + lz * Math.sin(a)];

    // ── gameplay pose: rig.reset(w) writes it into the camera; read it back ──
    rig.reset(w);
    const cam = this.cam;
    const tg = rig.target;
    const game: CamPose = { x: cam.position.x, y: cam.position.y, z: cam.position.z, tx: tg.x, ty: tg.y, tz: tg.z, fov: cam.fov, roll: 0 };

    // ── S2 close-up: low three-quarter, the side nearer the gameplay camera first ──
    const aimY = face.y - 0.18 * H;        // the face sits in the upper-middle, clear of the lower third
    // camera at 0.35 H, but always under the face (HEARTHBACK carries its head at 0.3 H): it looks UP
    const camY = Math.max(0.12 * H, Math.min(C.closeCamH * H, face.y - 0.2 * H));
    const gdx = game.x - face.x, gdz = game.z - face.z;
    const leftFirst = gdx * lx + gdz * lz >= 0;
    let close: CamPose | null = null;
    for (const side of leftFirst ? [1, -1] : [-1, 1]) {
      for (const yawDeg of C.closeYawAlt) {
        for (const dH of C.closeDistAlt) {
          const d3 = dH * H;
          const dy = aimY - camY;
          const dh = Math.sqrt(Math.max(0.25 * d3 * d3, d3 * d3 - dy * dy));
          const a0 = side * yawDeg * DEG;
          const a1 = side * Math.max(8, yawDeg - C.closeOrbitDeg) * DEG;
          const [ux0, uz0] = dirAt(a0), [ux1, uz1] = dirAt(a1);
          const x0 = face.x + ux0 * dh, z0 = face.z + uz0 * dh, x1 = face.x + ux1 * dh, z1 = face.z + uz1 * dh;
          if (!safe(x0, camY, z0, aimY) || !safe(x1, camY, z1, aimY)) continue;
          close = { x: x0, y: camY, z: z0, tx: face.x + fx * C.closeLeadH * H, ty: aimY, tz: face.z + fz * C.closeLeadH * H, fov: C.closeFov, roll: 0 };
          this.lookSign = side;
          this.closeAz = Math.atan2(ux0, uz0);
          const az1 = Math.atan2(ux1, uz1);
          let sw = az1 - this.closeAz;
          while (sw > Math.PI) sw -= 2 * Math.PI;
          while (sw < -Math.PI) sw += 2 * Math.PI;
          this.closeSweep = variant === 'reduced' ? 0 : sw;
          this.closeDist = dh;
          break;
        }
        if (close) break;
      }
      if (close) break;
    }
    if (!close) return null;                                    // no camera-safe S2 → legacy slate
    this.face.x = face.x; this.face.y = face.y; this.face.z = face.z; this.face.h = H;

    // ── S1 street cam (FULL only): the per-biome foreground element preferred ──
    let street: CamPose | null = null;
    if (variant === 'full') street = this.planStreet(w, face, H, fx, fz, lx, lz, safe);

    // ── shots + beats ──
    const shots: { id: CineShotId; start: number; dur: number }[] = [];
    let tt = 0;
    const push = (id: CineShotId, dur: number): void => { shots.push({ id, start: tt, dur }); tt += dur; };
    let closeStart = 0;
    if (variant === 'full') {
      const T = CINE_TIMING.full;
      push('signal', T.signal);
      if (street) push('street', T.street);
      closeStart = tt;
      push('closeup', T.closeup);
      push('crane', T.crane);
      push('handoff', T.handoff);
    } else if (variant === 'short') {
      const T = CINE_TIMING.short;
      push('closeup', T.closeup);
      push('crane', T.crane);
      push('handoff', T.handoff);
    } else {
      const T = CINE_TIMING.reduced;
      push('closeup', T.closeup);
      push('handoff', T.handoff);
    }
    const bt = CINE_BEATS[variant];
    const crane = shots.find((s) => s.id === 'crane');
    const hand = shots.find((s) => s.id === 'handoff')!;
    return {
      variant, total: tt, shots, street, close, game,
      beats: {
        look: closeStart + bt.look, blink: closeStart + bt.blink, snarl: closeStart + bt.snarl,
        lowerThird: closeStart + bt.lowerThird,
        hudIn: crane ? crane.start + crane.dur : hand.start,
      },
      near: C.near, far: C.far,
    };
  }

  /** obstacle boxes near the titan: standing buildings + solid props */
  private collect(w: World, face: FaceAnchor, r: number): Box[] {
    const out: Box[] = [];
    const r2 = r * r;
    for (const b of w.city.buildings) {
      if (b.collapsed || b.alive <= 0) continue;
      const dx = b.x - face.x, dz = b.z - face.z;
      const rr = r + 0.5 * Math.hypot(b.w, b.d);
      if (dx * dx + dz * dz > rr * rr) continue;
      out.push({ cx: b.x, cz: b.z, hx: b.w * 0.5, hz: b.d * 0.5, c: 1, s: 0, y0: -1, y1: b.alive * b.floorH, bld: true, kind: null });
    }
    for (const p of w.city.props) {
      if (!p.alive) continue;
      const dx = p.x - face.x, dz = p.z - face.z;
      if (dx * dx + dz * dz > r2) continue;
      const info = PROP_INFO[p.kind];
      if (!info) continue;
      // prop local +Z = its heading (len), local X = across (wid): box frame x along (cos h, −sin h)
      const c = Math.cos(p.heading), s = Math.sin(p.heading);
      if (p.kind === 'tree') {
        out.push({ cx: p.x, cz: p.z, hx: 0.22, hz: 0.22, c, s, y0: 0, y1: 2, bld: false, kind: p.kind });
        out.push({ cx: p.x, cz: p.z, hx: info.wid * 0.5, hz: info.len * 0.5, c, s, y0: 1.9, y1: 5.5, bld: false, kind: p.kind });
        continue;
      }
      const h = PROP_H[p.kind];
      if (!h) continue;
      out.push({ cx: p.x, cz: p.z, hx: info.wid * 0.5, hz: info.len * 0.5, c, s, y0: 0, y1: h, bld: false, kind: p.kind });
    }
    return out;
  }

  /**
   * S1: candidates at the spec distance (7 H) on the biome's yaw tries, plus poses built FROM each
   * foreground prop near the titan (just past its end, looking back past it). Score: yaw preference,
   * distance to 7 H, and a bonus when a foreground prop sits 0.8–4 m from the lens inside the frame
   * without blocking the face. The best camera-safe one wins; null → the plan skips S1.
   */
  private planStreet(
    w: World, face: FaceAnchor, H: number, fx: number, fz: number, lx: number, lz: number,
    safe: (x: number, y: number, z: number, ty: number) => boolean,
  ): CamPose | null {
    const bio = this.bio, C = CINE_CAM;
    const camY = Math.max(0.12, bio.streetCamH * H);
    // the street cam stands IN the carriageway (sidewalks are crowded with civilians and hug the
    // buildings: a lens there sees a kerb-high wall of paving)
    const L = w.city, pitch = L.pitch, half = L.roadW * 0.5 - 0.6;
    const offRoad = (v: number, o: number): number => { const u = (((v - o) % pitch) + pitch) % pitch; return Math.min(u, pitch - u); };
    const onRoad = (x: number, z: number): boolean => offRoad(x, L.originX) <= half || offRoad(z, L.originZ) <= half;
    const aimY = face.y - 0.04 * H;
    const fg = FOREGROUND[bio.foreground];
    const fgBoxes = this.boxes.filter((b) => b.kind !== null && fg.has(b.kind));
    const cands: { x: number; z: number; pref: number }[] = [];
    bio.yawTriesDeg.forEach((deg, i) => {
      const a = deg * DEG;
      const ux = fx * Math.cos(a) + lx * Math.sin(a), uz = fz * Math.cos(a) + lz * Math.sin(a);
      for (const k of [1, 0.85, 1.2, 0.7]) {
        const d = bio.streetDistH * H * k;
        cands.push({ x: face.x + ux * d, z: face.z + uz * d, pref: -0.12 * i - 0.25 * Math.abs(1 - k) });
      }
    });
    for (const b of fgBoxes) {
      const dx = b.cx - face.x, dz = b.cz - face.z;
      const dl = Math.hypot(dx, dz);
      if (dl < 1.5 || dl > 10 * H + 4) continue;
      const ux = dx / dl, uz = dz / dl;
      const vx = -uz, vz = ux;                                 // across the sight line
      const reach = Math.max(b.hx, b.hz) + 1.1;
      for (const lat of [1, -1]) {
        const off = (Math.min(b.hx, b.hz) + 0.35) * lat;
        cands.push({ x: b.cx + ux * reach + vx * off, z: b.cz + uz * reach + vz * off, pref: 0.1 });
      }
    }
    let best: { x: number; z: number; score: number } | null = null;
    for (const c of cands) {
      if (!onRoad(c.x, c.z) || !safe(c.x, camY, c.z, aimY)) continue;
      const dist = Math.hypot(c.x - face.x, c.z - face.z);
      if (dist < 3.2 * H || dist < 2.5) continue;
      let score = c.pref - 0.08 * Math.abs(dist / H - bio.streetDistH);
      const vx = (face.x - c.x) / dist, vz = (face.z - c.z) / dist;
      // frame clutter: a lorry / bus / van / container right in front of a bumper-height lens fills half
      // the frame even when it hides neither the face nor the body — reject it; a car very close costs
      let clutter = false;
      for (const b of this.boxes) {
        if (b.bld || b.kind === null) continue;
        const bd = boxDistXZ(c.x, c.z, b);
        if (bd > 5) continue;
        const cosA = boxCosToAxis(c.x, c.z, vx, vz, b);                    // its point nearest the view axis
        if (cosA < Math.cos(38 * DEG)) continue;                            // outside the frame
        if (b.y1 >= 1.9 && bd < 4.5) { clutter = true; break; }
        // a car-height body inside the crash-zoomed frame (±26°) within 5 m towers over a 0.2 H lens
        if (b.y1 >= 1.3 && bd < 5 && cosA > Math.cos(26 * DEG)) { clutter = true; break; }
        if (bd < 1.6) score -= 0.5;
      }
      if (clutter) continue;
      // foreground bonus: a biome prop near the lens, inside the horizontal frame, not blocking the face
      for (const b of fgBoxes) {
        const bd = boxDistXZ(c.x, c.z, b);
        if (bd < 1.6 || bd > 5) continue;                      // a framing element, not a wall over the lens
        const ox = b.cx - c.x, oz = b.cz - c.z;
        const ol = Math.hypot(ox, oz) || 1;
        const cosA = (ox * vx + oz * vz) / ol;
        if (cosA < Math.cos(42 * DEG) || cosA > Math.cos(14 * DEG)) continue;   // at a side of the frame
        score += 1;
        break;
      }
      if (!best || score > best.score) best = { x: c.x, z: c.z, score };
    }
    if (!best) return null;
    void C;
    return { x: best.x, y: camY, z: best.z, tx: face.x, ty: aimY, tz: face.z, fov: C.streetFov, roll: 0 };
  }

  // ─────────────────────────────── driving ───────────────────────────────
  start(plan: CinePlan): void {
    const cam = this.cam;
    if (!this.on) this.saved = { fov: cam.fov, near: cam.near, far: cam.far };
    this.P = plan;
    this.on = true;
    this.t = 0;
    this.skipT = -1;
    this.crane = null;
    // the first frame is already the opening pose
    const first = plan.shots[0];
    this.poseAt(0, first ? first.id : 'closeup', 0);
    this.apply(this.cur);
    this.setShot(first ? first.id : 'closeup', 0, first ? first.dur : 0);
    this.computeChannels();
  }

  update(dt: number): boolean {
    const P = this.P;
    if (!this.on || !P) return false;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.readLive();
    if (this.skipT >= 0) {
      this.skipT += dt;
      const u = easeOutCubic(this.skipT / CINE_CAM.skipS);
      if (this.skipT >= CINE_CAM.skipS) { this.handBack(); return false; }
      lerpPoseInto(this.cur, this.skipFrom, this.live, u);
      this.apply(this.cur);
      this.setShot('handoff', this.skipT, CINE_CAM.skipS);
      return true;
    }
    this.t += dt;
    if (this.t >= P.total) { this.handBack(); return false; }
    let sh = P.shots[P.shots.length - 1];
    for (let i = 0; i < P.shots.length; i++) {
      const s = P.shots[i];
      if (this.t < s.start + s.dur) { sh = s; break; }
    }
    const st = this.t - sh.start;
    this.poseAt(this.t, sh.id, st / Math.max(1e-4, sh.dur));
    this.apply(this.cur);
    this.setShot(sh.id, st, sh.dur);
    this.computeChannels();
    return true;
  }

  skip(): void {
    if (!this.on || this.skipT >= 0) return;
    copyPose(this.skipFrom, this.cur);
    this.skipT = 0;
    this.shotV = null;
  }

  stop(): void {
    if (!this.on) return;
    this.restoreClip();
    this.cam.up.set(0, 1, 0);
    this.on = false;
    this.P = null;
    this.shotV = null;
    this.skipT = -1;
  }

  channels(): CineChannels | null {
    if (!this.on || this.skipT >= 0) return null;
    return this.ch;
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private setShot(id: CineShotId, t: number, dur: number): void {
    const s = this.shotObj;
    s.id = id; s.t = t; s.dur = dur; s.k = dur > 0 ? sat(t / dur) : 1;
    this.shotV = s;
  }

  /** the live gameplay pose (the rig wrote it into the camera this frame, before us) */
  private readLive(): void {
    const c = this.cam, L = this.live;
    L.x = c.position.x; L.y = c.position.y; L.z = c.position.z;
    const tg = this.rig ? this.rig.target : null;
    if (tg) { L.tx = tg.x; L.ty = tg.y; L.tz = tg.z; }
    else if (this.P) { L.tx = this.P.game.tx; L.ty = this.P.game.ty; L.tz = this.P.game.tz; }
    L.fov = this.saved.fov; L.roll = 0;
  }

  /** the S2 pose at orbit progress k (0..1) into `o` */
  private closePose(o: CamPose, k: number, t: number): CamPose {
    const P = this.P!;
    const F = this.face;
    const a = this.closeAz + this.closeSweep * smooth(k);
    o.x = F.x + Math.sin(a) * this.closeDist;
    o.z = F.z + Math.cos(a) * this.closeDist;
    o.y = P.close.y;
    o.tx = P.close.tx; o.ty = P.close.ty; o.tz = P.close.tz;
    o.fov = P.close.fov; o.roll = 0;
    if (P.variant !== 'reduced') this.handheld(o, t, 0.35, 0.4);
    return o;
  }

  /** handheld: rotational wobble (deg, as a look-target offset) + position jitter (m) */
  private handheld(o: CamPose, t: number, deg: number, jitterK: number): void {
    const C = CINE_CAM;
    const w = C.handheldHz / 1.1;
    const dx = o.tx - o.x, dy = o.ty - o.y, dz = o.tz - o.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const rx = dz / (Math.hypot(dx, dz) || 1), rz = -dx / (Math.hypot(dx, dz) || 1);
    const yaw = Math.tan(deg * DEG * wob(t * w, 0.3)) * dist, pitch = Math.tan(deg * DEG * 0.8 * wob(t * w, 2.1)) * dist;
    o.tx += rx * yaw; o.tz += rz * yaw; o.ty += pitch;
    const j = C.jitterM * jitterK;
    o.x += j * wob(t * 7.3, 5.1); o.y += j * wob(t * 6.1, 1.7); o.z += j * wob(t * 8.2, 3.3);
    o.roll += deg * 0.5 * wob(t * w * 0.8, 4.4);
  }

  private poseAt(t: number, id: CineShotId, k: number): void {
    const P = this.P!, C = CINE_CAM, o = this.cur;
    switch (id) {
      case 'signal':
      case 'street': {
        if (!P.street) { this.closePose(o, 0, t); break; }
        copyPose(o, P.street);
        if (id === 'street') {
          const st = t - (P.shots.find((s) => s.id === 'street')?.start ?? 0);
          const z = easeOutCubic((st - C.crashZoomAt) / C.crashZoomS);
          o.fov = C.streetFov + (C.streetZoomFov - C.streetFov) * z;
          this.handheld(o, t, C.handheldDeg, 1);
          const bob = this.bio.bob;
          if (bob) {
            const ph = t * bob.hz * Math.PI * 2;
            o.roll += bob.rollDeg * Math.sin(ph);
            o.y += bob.yH * this.face.h * Math.sin(ph + 0.9);
          }
        }
        break;
      }
      case 'closeup':
        this.closePose(o, k, t);
        break;
      case 'crane': {
        this.closePose(this.closeEnd, 1, t);
        const E = this.closeEnd, L = this.live;
        if (!this.crane) this.crane = this.craneCtrl(E, L);
        const u = easeInOutCubic(k), v = 1 - u;
        const c = this.crane;
        const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
        o.x = b0 * E.x + b1 * c[0] + b2 * c[3] + b3 * L.x;
        o.y = b0 * E.y + b1 * c[1] + b2 * c[4] + b3 * L.y;
        o.z = b0 * E.z + b1 * c[2] + b2 * c[5] + b3 * L.z;
        const s = smooth(k);
        o.tx = E.tx + (L.tx - E.tx) * s; o.ty = E.ty + (L.ty - E.ty) * s; o.tz = E.tz + (L.tz - E.tz) * s;
        o.fov = E.fov + (L.fov - E.fov) * s;
        o.roll = E.roll * (1 - s);
        break;
      }
      case 'handoff':
        if (P.variant === 'reduced') {
          // a cut under the overlay's veil (reduce motion: no camera move at all)
          if (k < 0.5) this.closePose(o, 1, t); else copyPose(o, this.live);
        } else copyPose(o, this.live);
        break;
    }
  }

  /**
   * Crane control points [P1, P2] (flat xyz ×2): back 3 H and up 2 H from the S2 end pose, then above
   * the gameplay target. If the sampled curve would pass through a standing building, the fallbacks
   * go straight up first (then over).
   */
  private craneCtrl(E: CamPose, L: CamPose): number[] {
    const C = CINE_CAM, H = this.face.h;
    let bx = E.x - this.face.x, bz = E.z - this.face.z;
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl; bz /= bl;
    const gd = Math.hypot(L.x - L.tx, L.y - L.ty, L.z - L.tz);
    const mx = L.tx + (L.x - L.tx) * 0.5, mz = L.tz + (L.z - L.tz) * 0.5;
    const variants: number[][] = [
      [E.x + bx * C.craneBackH * H, E.y + C.craneUpH * H, E.z + bz * C.craneBackH * H, mx, L.ty + (L.y - L.ty) * 0.5 + 0.25 * gd, mz],
      [E.x, E.y + (C.craneUpH + 2) * H, E.z, mx, L.y + 0.2 * gd, mz],
      [E.x, Math.max(E.y + 3 * H, L.y), E.z, L.x, L.y + 0.1 * gd, L.z],
    ];
    for (const c of variants) {
      let ok = true;
      for (let i = 1; i < 12 && ok; i++) {
        const u = i / 12, v = 1 - u;
        const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
        const x = b0 * E.x + b1 * c[0] + b2 * c[3] + b3 * L.x;
        const y = b0 * E.y + b1 * c[1] + b2 * c[4] + b3 * L.y;
        const z = b0 * E.z + b1 * c[2] + b2 * c[5] + b3 * L.z;
        for (const b of this.boxes) if (b.bld && inBox(x, y, z, b, 0.3)) { ok = false; break; }
      }
      if (ok) return c;
    }
    return variants[0];
  }

  private apply(p: CamPose): void {
    const c = this.cam, P = this.P;
    c.position.set(p.x, p.y, p.z);
    c.up.set(0, 1, 0);
    c.lookAt(p.tx, p.ty, p.tz);
    if (p.roll !== 0) c.rotateZ(p.roll * DEG);
    const near = P ? P.near : this.saved.near, far = P ? P.far : this.saved.far;
    if (c.fov !== p.fov || c.near !== near || c.far !== far) {
      c.fov = p.fov; c.near = near; c.far = far;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }

  private restoreClip(): void {
    const c = this.cam, s = this.saved;
    if (c.fov !== s.fov || c.near !== s.near || c.far !== s.far) {
      c.fov = s.fov; c.near = s.near; c.far = s.far;
      c.updateProjectionMatrix();
    }
  }

  /** hand the camera back: the rig's pose of this frame stays; fov / near / far restored */
  private handBack(): void {
    this.restoreClip();
    this.cam.up.set(0, 1, 0);
    this.cam.updateMatrixWorld();
    this.on = false;
    this.P = null;
    this.shotV = null;
    this.skipT = -1;
  }

  /** look / blink / snarl envelopes (0..1; look is signed: + = toward the titan's left, where the lens is) */
  private computeChannels(): void {
    const P = this.P!, t = this.t, B = P.beats;
    const crane = P.shots.find((s) => s.id === 'crane');
    const hand = P.shots.find((s) => s.id === 'handoff');
    const relax = crane ? crane.start : hand ? hand.start : P.total;
    let look = smooth((t - B.look) / 0.4);
    if (t > relax) look *= 1 - smooth((t - relax) / 0.6);
    this.ch.look = this.lookSign * look;
    const b = t - B.blink;
    this.ch.blink = b < 0 ? 0 : b < 0.08 ? smooth(b / 0.08) : b < 0.14 ? 1 : b < 0.26 ? 1 - smooth((b - 0.14) / 0.12) : 0;
    const s = t - B.snarl;
    this.ch.snarl = s < 0 ? 0 : s < 0.12 ? smooth(s / 0.12) : s < 0.34 ? 1 : s < 0.5 ? 1 - smooth((s - 0.34) / 0.16) : 0;
  }
}
