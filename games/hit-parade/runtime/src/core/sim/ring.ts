// HIT PARADE — the ring boundary (CHANGED(SIM3D), CONTRACT §35.2 / §35.11 / §35.12). Circle or flat-sided polygon
// around a centre (default the world origin). Integer geometry only (fx3d.ts); the ring numbers live in the state world
// block (W.ring*, written once at createMatch) and a per-match compiled copy (Match.ring) carries the side normals.
//
// Conventions: yaw units (fx3d.ts). circle: radius R; WALL_SPLAT index = one of 16 sectors, sector k centred on
// rot + k * 4096. poly: R = APOTHEM (centre -> each side's inner face), side k's OUTWARD normal at yaw rot + k * 65536 /
// sides; WALL_SPLAT index = k. The wall is infinitely tall (no ring-outs).

import type { GameData } from '../types.ts';
import { W } from './layout.ts';
import { mToU } from './units.ts';
import { Q, YAW_HALF, YAW_TURN, cosQ, degToYaw, dirToYaw, divRound, isqrt, sinQ } from './fx3d.ts';

export const RING_CIRCLE = 0;
export const RING_POLY = 1;
export const CIRCLE_SECTORS = 16;

export interface CRing {
  kind: number;
  r: number; // U (circle radius / poly apothem)
  sides: number; // poly sides (circle: 16 sectors)
  rot: number; // yaw
  cx: number; // centre (U)
  cz: number;
  nx: Int32Array; // poly outward side normals (Q14)
  nz: Int32Array;
}

/** The stage's 3D fields as the sim reads them (CONTRACT §35.12), already in integers (U / yaw). */
export interface StageRingDef {
  kind: number;
  r: number;
  sides: number;
  rot: number;
  cx: number;
  cz: number;
  spawnAxis: number; // yaw of the P1 -> P2 spawn line
  cameraSide: number; // yaw from the ring centre toward the initial camera side
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** Reads stages.json for `stageId` (compile time: floats -> integers here, never in the step). */
export function stageRingDef(data: GameData, stageId: string, defaultRadiusU: number, defaultAxisYaw: number): StageRingDef {
  const list = (data.stages as { stages?: unknown }).stages;
  let st: Record<string, unknown> | null = null;
  if (Array.isArray(list)) {
    for (const e of list) {
      if (e && typeof e === 'object' && (e as Record<string, unknown>).id === stageId) {
        st = e as Record<string, unknown>;
        break;
      }
    }
  }
  const ring = st && typeof st.ring === 'object' && st.ring !== null ? (st.ring as Record<string, unknown>) : null;
  const poly = ring !== null && ring.shape === 'poly';
  const sides = poly ? Math.max(3, Math.min(32, Math.trunc(num(ring?.sides, 8)))) : CIRCLE_SECTORS;
  const centre = ring && Array.isArray(ring.centre) && ring.centre.length === 2 ? (ring.centre as unknown[]) : null;
  const axis = st && typeof st.spawnAxisDeg === 'number' && Number.isFinite(st.spawnAxisDeg) ? degToYaw(st.spawnAxisDeg) : defaultAxisYaw;
  // default camera side = spawnAxis - 90 deg (P1 screen-left, the 2.5D layout for the default axis 90 -> camera on +Z)
  const cam = st && typeof st.cameraSideDeg === 'number' && Number.isFinite(st.cameraSideDeg) ? degToYaw(st.cameraSideDeg) : (axis - 16384) & (YAW_TURN - 1);
  const rM = ring ? num(ring.radiusM, 0) : 0;
  return {
    kind: poly ? RING_POLY : RING_CIRCLE,
    r: rM > 0.5 ? mToU(rM) : defaultRadiusU,
    sides,
    rot: ring ? degToYaw(num(ring.rotDeg, 0)) : 0,
    cx: centre ? mToU(num(centre[0], 0)) : 0,
    cz: centre ? mToU(num(centre[1], 0)) : 0,
    spawnAxis: axis,
    cameraSide: cam,
  };
}

/** Writes the ring into the world block (createMatch). */
export function writeRing(s: Int32Array, d: StageRingDef): void {
  s[W.ringKind] = d.kind;
  s[W.ringR] = d.r;
  s[W.ringSides] = d.sides;
  s[W.ringRot] = d.rot;
  s[W.ringCX] = d.cx;
  s[W.ringCZ] = d.cz;
  s[W.spawnYaw] = d.spawnAxis;
  s[W.camYaw] = d.cameraSide;
}

/** The compiled ring of the state (side normals from the integer sine table: deterministic). */
export function ringFromState(s: Int32Array): CRing {
  const kind = s[W.ringKind];
  const sides = Math.max(3, s[W.ringSides]);
  const nx = new Int32Array(sides);
  const nz = new Int32Array(sides);
  for (let k = 0; k < sides; k++) {
    const yaw = s[W.ringRot] + Math.trunc((k * YAW_TURN) / sides);
    nx[k] = sinQ(yaw);
    nz[k] = cosQ(yaw);
  }
  return { kind, r: s[W.ringR], sides, rot: s[W.ringRot], cx: s[W.ringCX], cz: s[W.ringCZ], nx, nz };
}

/**
 * Clearance of a body circle (centre px, pz, radius rad) to the boundary (U): > 0 inside with room, 0 touching,
 * < 0 overlapping the wall.
 */
export function ringGap(g: CRing, px: number, pz: number, rad: number): number {
  const rx = px - g.cx;
  const rz = pz - g.cz;
  if (g.kind === RING_CIRCLE) return g.r - isqrt(rx * rx + rz * rz) - rad;
  let best = 1 << 30;
  for (let k = 0; k < g.sides; k++) {
    const d = g.r - divRound(rx * g.nx[k] + rz * g.nz[k], Q);
    if (d < best) best = d;
  }
  return best - rad;
}

/**
 * Clamps a body circle inside the ring: out[0..1] = the corrected centre. Returns true when it moved (the body was
 * against / beyond the wall).
 */
export function ringClamp(g: CRing, px: number, pz: number, rad: number, out: Int32Array | number[]): boolean {
  let rx = px - g.cx;
  let rz = pz - g.cz;
  let moved = false;
  if (g.kind === RING_CIRCLE) {
    const lim = Math.max(0, g.r - rad);
    const d2 = rx * rx + rz * rz;
    if (d2 > lim * lim) {
      const d = isqrt(d2);
      if (d > lim) {
        rx = divRound(rx * lim, d);
        rz = divRound(rz * lim, d);
        // rounding may leave it 1 U out: pull in until inside
        while (rx * rx + rz * rz > lim * lim) {
          rx -= rx > 0 ? 1 : rx < 0 ? -1 : 0;
          rz -= rz > 0 ? 1 : rz < 0 ? -1 : 0;
        }
        moved = true;
      }
    }
  } else {
    const lim = Math.max(0, g.r - rad);
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      for (let k = 0; k < g.sides; k++) {
        const sd = divRound(rx * g.nx[k] + rz * g.nz[k], Q);
        if (sd > lim) {
          const ex = sd - lim;
          rx -= divRound(g.nx[k] * ex, Q);
          rz -= divRound(g.nz[k] * ex, Q);
          any = true;
          moved = true;
        }
      }
      if (!any) break;
    }
  }
  out[0] = g.cx + rx;
  out[1] = g.cz + rz;
  return moved;
}

/** Distance (U, >= 0) from the point (px, pz) along the Q14 unit vector (ux, uz) to the boundary. */
export function ringRay(g: CRing, px: number, pz: number, ux: number, uz: number): number {
  const rx = px - g.cx;
  const rz = pz - g.cz;
  if (g.kind === RING_CIRCLE) {
    const pu = divRound(rx * ux + rz * uz, Q);
    const disc = pu * pu - (rx * rx + rz * rz) + g.r * g.r;
    if (disc <= 0) return 0;
    return Math.max(0, isqrt(disc) - pu);
  }
  let best = 1 << 30;
  for (let k = 0; k < g.sides; k++) {
    const un = ux * g.nx[k] + uz * g.nz[k]; // Q14^2
    if (un <= 0) continue;
    const room = g.r - divRound(rx * g.nx[k] + rz * g.nz[k], Q); // U
    const t = room <= 0 ? 0 : Math.floor((room * Q * Q) / un);
    if (t < best) best = t;
  }
  return best === 1 << 30 ? 0 : best;
}

/**
 * The wall a body at (px, pz) is against: out[0] = WALL_SPLAT index (circle sector / poly side), out[1] = the INWARD
 * normal yaw, out[2] / out[3] = the boundary contact point (x, z, U) nearest to the body.
 */
export function ringWall(g: CRing, px: number, pz: number, out: Int32Array | number[]): void {
  const rx = px - g.cx;
  const rz = pz - g.cz;
  if (g.kind === RING_CIRCLE) {
    const yaw = rx === 0 && rz === 0 ? g.rot : dirToYaw(rx, rz);
    const sec = (((Math.floor((((yaw - g.rot) & (YAW_TURN - 1)) + 2048) / 4096)) % CIRCLE_SECTORS) + CIRCLE_SECTORS) % CIRCLE_SECTORS;
    out[0] = sec;
    out[1] = (yaw + YAW_HALF) & (YAW_TURN - 1);
    out[2] = g.cx + divRound(sinQ(yaw) * g.r, Q);
    out[3] = g.cz + divRound(cosQ(yaw) * g.r, Q);
    return;
  }
  let bk = 0;
  let bd = -(1 << 30);
  for (let k = 0; k < g.sides; k++) {
    const d = rx * g.nx[k] + rz * g.nz[k];
    if (d > bd) {
      bd = d;
      bk = k;
    }
  }
  const sd = divRound(bd, Q);
  const ex = g.r - sd;
  out[0] = bk;
  out[1] = (g.rot + Math.trunc((bk * YAW_TURN) / g.sides) + YAW_HALF) & (YAW_TURN - 1);
  out[2] = px + divRound(g.nx[bk] * ex, Q);
  out[3] = pz + divRound(g.nz[bk] * ex, Q);
}

/** The inward normal (Q14) at the wall nearest to (px, pz) -> out[0..1]. */
export function ringNormal(g: CRing, px: number, pz: number, out: Int32Array | number[]): void {
  const w = WN;
  ringWall(g, px, pz, w);
  out[0] = sinQ(w[1]);
  out[1] = cosQ(w[1]);
}
const WN = new Int32Array(4);
