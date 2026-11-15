// DYEFIELD — Rapier 0.20 collision + kinematic character controller (CONTRACT §4.8). THREE-free,
// DOM-free: the same module runs in the browser (Vite) and under plain `node` (probe_move.ts).
//
// Rapier 0.20 notes (verified in Node against @dimforge/rapier3d-compat 0.20.0):
//   * the compat build inlines its wasm; `import R from '@dimforge/rapier3d-compat'` gives the
//     namespace as the default export in both Node ESM and Vite, and `await R.init()` must run once.
//   * scene queries (castRay / castShape and the KCC's own obstacle search) go through the
//     broad-phase BVH, which is only rebuilt by `world.step()`. A world that was never stepped
//     answers every ray with null — so the constructor steps once after inserting the map, and
//     `refresh()` re-steps after colliders are added. There are no dynamic bodies, so a step is
//     just a BVH refresh.
//
// CHANGED(MAPSIM) (CONTRACT_P6_11 §19), additive — collision groups:
//   * MAP_SOLID (group 1): the `collision` soup (paint_/solid_/col_/conveyor_/spring_) — blocks everything;
//   * GRATE (group 3): `features.grates` (grate_*) in its own trimesh — runner capsules collide with it,
//     paint / projectile / visibility rays pass through it. raycast / sphereCast take an optional
//     `{ grates: true }` to see it (runner-side queries and the nav builder do; the default ignores it).
//   A map without grate_ nodes gets no second collider, so its world is exactly what it was before.

import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from './types.ts';
import type { MapGeometry } from './mapgeo.ts';
import { featuresOf } from './mapgeo.ts';
import { DEG } from './types.ts';
import { MOVE } from './config.ts';

export type Rapier = typeof import('@dimforge/rapier3d-compat').default;
type RWorld = InstanceType<Rapier['World']>;
type RCollider = ReturnType<RWorld['createCollider']>;
type RKcc = ReturnType<RWorld['createCharacterController']>;

let rapierPromise: Promise<Rapier> | null = null;

/** Initialise Rapier once per process / page (memoised). */
export function loadRapier(): Promise<Rapier> {
  if (!rapierPromise) {
    const R = RAPIER as unknown as Rapier;
    rapierPromise = R.init().then(() => R);
  }
  return rapierPromise;
}

export interface CastHit { toi: number; x: number; y: number; z: number; nx: number; ny: number; nz: number }

/** CHANGED(MAPSIM): scene-query options. grates: also hit grate_* (runner collision); default false (paint / projectiles / sight). */
export interface QueryOpts { grates?: boolean }

export interface CharacterBody {
  /** desired displacement this tick → applied displacement + grounded (Rapier KCC: autostep, snap, slope limit) */
  move(dx: number, dy: number, dz: number): { dx: number; dy: number; dz: number; grounded: boolean };
  setFeet(x: number, y: number, z: number): void;   // feet position (capsule bottom)
  feet(): Vec3;
  setShape(radius: number, halfHeight: number): void;
}

/** Collision membership: map geometry is group 1, characters group 2, grates group 3. Queries only see the map. */
const GROUP_MAP = 0x0001;
const GROUP_CHAR = 0x0002;
const GROUP_GRATE = 0x0004;
const groups = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff);
/** interaction groups for map colliders (collide with everything) */
const MAP_GROUPS = groups(GROUP_MAP, GROUP_MAP | GROUP_CHAR);
/** interaction groups for grate colliders (runner capsules only) */
const GRATE_GROUPS = groups(GROUP_GRATE, GROUP_CHAR);
/** interaction groups for character capsules (collide with the map + grates, not each other — phase 2) */
const CHAR_GROUPS = groups(GROUP_CHAR, GROUP_MAP | GROUP_GRATE);
/** filter used by raycast / sphereCast: see map colliders only (never a character, never a grate) */
const QUERY_MAP_ONLY = groups(0xffff, GROUP_MAP);
/** filter used by the KCC and runner-side queries: map + grates */
const QUERY_MAP_GRATES = groups(0xffff, GROUP_MAP | GROUP_GRATE);

class Character implements CharacterBody {
  private readonly R: Rapier;
  private readonly pw: PhysicsWorld;
  readonly collider: RCollider;
  readonly kcc: RKcc;
  radius: number;
  halfHeight: number;
  private readonly desired = { x: 0, y: 0, z: 0 };

  constructor(R: Rapier, pw: PhysicsWorld, world: RWorld, radius: number, halfHeight: number) {
    this.R = R;
    this.pw = pw;
    this.radius = radius;
    this.halfHeight = halfHeight;
    const desc = R.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(CHAR_GROUPS).setTranslation(0, halfHeight + radius, 0);
    this.collider = world.createCollider(desc);
    const kcc = world.createCharacterController(MOVE.skin);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.setSlideEnabled(true);
    kcc.enableAutostep(MOVE.stepHeight, 0.18, false);
    kcc.enableSnapToGround(0.3);
    kcc.setMaxSlopeClimbAngle(MOVE.maxSlopeDeg * DEG);
    kcc.setMinSlopeSlideAngle((MOVE.maxSlopeDeg + 4) * DEG);
    kcc.setApplyImpulsesToDynamicBodies(false);
    this.kcc = kcc;
  }

  move(dx: number, dy: number, dz: number): { dx: number; dy: number; dz: number; grounded: boolean } {
    const d = this.desired;
    d.x = dx; d.y = dy; d.z = dz;
    // obstacles = map colliders + grates (filterGroups), and never this capsule itself
    this.kcc.computeColliderMovement(this.collider, d, undefined, QUERY_MAP_GRATES);
    const m = this.kcc.computedMovement();
    const t = this.collider.translation();
    this.collider.setTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    return { dx: m.x, dy: m.y, dz: m.z, grounded: this.kcc.computedGrounded() };
  }

  setFeet(x: number, y: number, z: number): void {
    this.collider.setTranslation({ x, y: y + this.halfHeight + this.radius, z });
  }

  feet(): Vec3 {
    const t = this.collider.translation();
    return { x: t.x, y: t.y - this.halfHeight - this.radius, z: t.z };
  }

  setShape(radius: number, halfHeight: number): void {
    if (radius === this.radius && halfHeight === this.halfHeight) return;
    const f = this.feet();
    this.collider.setShape(this.pw.capsuleShape(radius, halfHeight));
    this.radius = radius;
    this.halfHeight = halfHeight;
    this.setFeet(f.x, f.y, f.z);
  }

  dispose(world: RWorld): void {
    world.removeCharacterController(this.kcc);
    world.removeCollider(this.collider, false);
    this.pw.forget(this);
  }
}

export class PhysicsWorld {
  readonly R: Rapier;
  readonly world: RWorld;
  readonly map: RCollider;
  /** CHANGED(MAPSIM): the grate_* trimesh (runner-only), or null when the map has none */
  readonly grate: RCollider | null;
  readonly triangles: number;
  private readonly chars: Character[] = [];
  private readonly ray: InstanceType<Rapier['Ray']>;
  private readonly ball = new Map<number, InstanceType<Rapier['Ball']>>();
  private readonly ident = { x: 0, y: 0, z: 0, w: 1 };

  constructor(R: Rapier, geo: MapGeometry) {
    this.R = R;
    this.world = new R.World({ x: 0, y: 0, z: 0 });     // gravity is the player's job (kinematic)
    const pos = geo.collision.positions;
    const idx = geo.collision.indices;
    if (!pos || !idx || idx.length < 3) throw new Error(`PhysicsWorld: map '${geo.id}' has no collision triangles`);
    this.triangles = (idx.length / 3) | 0;
    // Rapier keeps its own copy; pass typed arrays of the exact element types it expects
    const verts = pos instanceof Float32Array ? pos : new Float32Array(pos);
    const inds = idx instanceof Uint32Array ? idx : new Uint32Array(idx);
    // FIX_INTERNAL_EDGES (implies MERGE_DUPLICATE_VERTICES): contact normals on the internal edges of
    // the Blender-triangulated faces are corrected from the adjacent triangles. Without it a capsule
    // pressed against a fan-triangulated wall got a ghost "ground" normal from a diagonal edge and hung
    // mid-wall with grounded = true (measured: a dropped wall-slicker stuck at y 0.624 on the x = −20
    // side-deck wall of Pier 18; with the flag it falls). G2 is unchanged either way.
    this.map = this.world.createCollider(R.ColliderDesc.trimesh(verts, inds, R.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setCollisionGroups(MAP_GROUPS).setFriction(0));
    const gr = featuresOf(geo).grates;
    this.grate = gr.indices.length >= 3
      ? this.world.createCollider(R.ColliderDesc.trimesh(new Float32Array(gr.positions), new Uint32Array(gr.indices), R.TriMeshFlags.FIX_INTERNAL_EDGES)
        .setCollisionGroups(GRATE_GROUPS).setFriction(0))
      : null;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.refresh();
  }

  /** Rebuild the broad-phase so scene queries see every collider (Rapier 0.20 queries need a step). */
  refresh(): void {
    this.world.step();
  }

  createCharacter(radius: number, halfHeight: number): CharacterBody {
    const c = new Character(this.R, this, this.world, radius, halfHeight);
    this.chars.push(c);
    this.refresh();
    return c;
  }

  private readonly capsules = new Map<number, InstanceType<Rapier['Capsule']>>();

  /** @internal cached capsule shape descriptors (SLICK toggles the shape often; no per-toggle allocation) */
  capsuleShape(radius: number, halfHeight: number): InstanceType<Rapier['Capsule']> {
    const key = Math.round(radius * 1000) * 100000 + Math.round(halfHeight * 1000);
    let s = this.capsules.get(key);
    if (!s) { s = new this.R.Capsule(halfHeight, radius); this.capsules.set(key, s); }
    return s;
  }

  /** @internal */
  forget(c: Character): void {
    const i = this.chars.indexOf(c);
    if (i >= 0) this.chars.splice(i, 1);
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, opts?: QueryOpts): CastHit | null {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9 || !(maxDist > 0)) return null;
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz;
    r.dir.x = dx / len; r.dir.y = dy / len; r.dir.z = dz / len;
    const hit = this.world.castRayAndGetNormal(r, maxDist, true, undefined, opts?.grates ? QUERY_MAP_GRATES : QUERY_MAP_ONLY);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      toi: t,
      x: ox + r.dir.x * t, y: oy + r.dir.y * t, z: oz + r.dir.z * t,
      nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z,
    };
  }

  /**
   * Sweep a sphere from o along d. toi = distance travelled by the centre before first contact;
   * (x, y, z) = the sphere centre at impact; (nx, ny, nz) = the surface normal at the contact.
   */
  sphereCast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, radius: number, maxDist: number, opts?: QueryOpts): CastHit | null {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9 || !(maxDist > 0) || !(radius > 0)) return null;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    const key = Math.round(radius * 1000);
    let ball = this.ball.get(key);
    if (!ball) { ball = new this.R.Ball(radius); this.ball.set(key, ball); }
    const hit = this.world.castShape({ x: ox, y: oy, z: oz }, this.ident, { x: ux, y: uy, z: uz }, ball, 0, maxDist, true,
      undefined, opts?.grates ? QUERY_MAP_GRATES : QUERY_MAP_ONLY);
    if (!hit) return null;
    const t = hit.time_of_impact;
    // normal1 = outward normal on the hit collider (the map colliders are identity-transformed, so local = world)
    let nx = hit.normal1.x, ny = hit.normal1.y, nz = hit.normal1.z;
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-9) { nx /= nl; ny /= nl; nz /= nl; } else { nx = -ux; ny = -uy; nz = -uz; }
    return { toi: t, x: ox + ux * t, y: oy + uy * t, z: oz + uz * t, nx, ny, nz };
  }

  dispose(): void {
    for (const c of this.chars.slice()) c.dispose(this.world);
    this.world.free();
  }
}
