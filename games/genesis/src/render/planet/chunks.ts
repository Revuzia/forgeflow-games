// GENESIS — chunked terrain LOD over the 20 icosahedron faces (CONTRACT.md §4.2, §15.4).
//
// Each base face is a level-0 triangular patch; a patch splits into 4 children by edge midpoints (the middle child is
// the inverted one). Every patch is a PATCH_RES × PATCH_RES triangular lattice in FLAT face coordinates (units of the
// sim grid), so a render vertex belongs to sim triangle grid.locateFaceCoords(face, fi, fj) — the same rule as the CPU.
//
// Geometry is static per patch (fields are textures): per vertex
//   position = dir (unit), aCells = (cellA, cellB, cellC, wB), aMisc = (wC, detail, skirt, dune), aGrad = ∇detail,
//   aGradD = ∇dune (the dune shape of noise.ts duneNoise, scaled in the shader by the cells' dune amplitude),
// plus a GEOMORPH TARGET: odd lattice vertices collapse onto the midpoint of the two even neighbours along the coarse
// edge they split ((i±1, j), (i, j±1) or (i−1, j+1)/(i+1, j−1)), whose own cells / weights / dirs / coarse-filtered
// detail are stored too (aN1*, aN2*). The midpoint rule is symmetric, so two patches sharing an edge morph it
// identically, and at morph = 1 a patch is exactly its parent's mesh: LOD transitions never pop.
//
// Selection is screen-space error with hysteresis: a level-L patch with vertex spacing s splits when the camera is
// closer than K·size_L (K from viewport height, FOV and the quality's pixel error); vertices morph over the last ~28 %
// of their parent's range, which by construction ends where the coarser neighbour begins. Skirts hide the remaining
// transient cracks (e.g. while children are still being built under the per-frame budget).
//
// Detail relief: detailNoise (src/sim/grid/noise.ts) with Noise3(planet seed) — the function the CPU ground uses —
// baked per vertex, band-limited per level so coarse patches do not alias, at full strength from ~1 m spacing down.

import {
  BatchedMesh, BufferAttribute, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Sphere, Vector3, Frustum, type Mesh, type Group,
  type Material, type Matrix4,
} from 'three';
import type { IcoGrid } from '../../sim/grid/icogrid.ts';
import { newHit } from '../../sim/grid/icogrid.ts';
import type { Noise3 } from '../../sim/grid/noise.ts';
import { curveMargin } from '../../sim/grid/surface.ts';
import {
  PATCH_RES, ICO_EDGE, NPTS, NSKIRT, NVERT, NINDEX, ptIndex, BOUNDARY, PATCH_ATTRS, PatchBuilder,
  type PatchArrays, type PatchReply, type PatchRequest,
} from './patchbuild.ts';
import { capGap, shadowReach } from './shadowreach.ts';
import { RING_N, ringFrame } from '../bufring.ts';
import { perfSwitch } from '../perfswitch.ts';
import { FREEZE, freezeLandTick } from '../freeze.ts';
import { earlyGeo } from '../uploadsched.ts';

export { PATCH_RES };

// ───────────────────────────── shared topology ─────────────────────────────

const R = PATCH_RES;

let sharedIndex: Uint16BufferAttribute | null = null;
function indexBuffer(): Uint16BufferAttribute {
  if (sharedIndex) return sharedIndex;
  const idx: number[] = [];
  for (let j = 0; j < R; j++) {
    for (let i = 0; i + j < R; i++) {
      idx.push(ptIndex(i, j), ptIndex(i + 1, j), ptIndex(i, j + 1));
      if (i + j < R - 1) idx.push(ptIndex(i + 1, j), ptIndex(i + 1, j + 1), ptIndex(i, j + 1));
    }
  }
  for (let k = 0; k < NSKIRT; k++) {
    const k1 = (k + 1) % NSKIRT;
    const p0 = ptIndex(BOUNDARY[k][0], BOUNDARY[k][1]);
    const p1 = ptIndex(BOUNDARY[k1][0], BOUNDARY[k1][1]);
    const s0 = NPTS + k, s1 = NPTS + k1;
    idx.push(p0, s0, p1, p1, s0, s1);
  }
  sharedIndex = new Uint16BufferAttribute(idx, 1);
  return sharedIndex;
}

/** a patch geometry viewing built arrays (no copy: PatchBatch.alloc copies them into the batch) */
function geometryOf(r: PatchArrays, sphere: Sphere): BufferGeometry {
  const geo = new BufferGeometry();
  for (let k = 0; k < PATCH_ATTRS.length; k++) {
    const [name, size] = PATCH_ATTRS[k];
    const attr = new BufferAttribute(r.attrs[k], size);
    geo.setAttribute(name, attr);
    // three r186 compiles a MeshStandardMaterial as FLAT_SHADED when the geometry has no `normal` attribute (one
    // face normal per render triangle from screen derivatives): the per-cell normals, the detail gradient and the
    // curved ground then never reach the lighting and the terrain shades as a triangle mosaic. The vertex shader
    // overrides objectNormal anyway (VERT_MAIN), so the unit `position` directions serve as the attribute — the
    // same buffer, no extra memory.
    if (name === 'position') geo.setAttribute('normal', attr);
  }
  geo.setIndex(indexBuffer());
  geo.boundingSphere = sphere.clone();
  return geo;
}

// ───────────────────────────── the patch building worker ─────────────────────────────

/** how a ChunkLOD reaches a patch building worker (the browser's shared pool; tests pass an in-process stand-in) */
export interface PatchPort {
  send(m: PatchRequest, transfer?: Transferable[]): void;
  listen(id: number, onReply: (r: PatchReply) => void, onFail: () => void): void;
  unlisten(id: number): void;
}

let sharedPatchPort: PatchPort | null | undefined;
/**
 * The shared patch workers, or null where there are none (made on first use; one that fails is not retried). Two
 * workers where the machine has the cores for them (a camera cut needs a few hundred patches: two halve the fill-in).
 */
function browserPatchPort(): PatchPort | null {
  if (sharedPatchPort !== undefined) return sharedPatchPort;
  sharedPatchPort = null;
  try {
    if (typeof Worker === 'undefined' || typeof location === 'undefined') return null;
    if (!perfSwitch('patchworker')) return null;
    const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    const nw = hc >= 6 ? 2 : 1;
    const ws: Worker[] = [];
    const subs = new Map<number, { reply: (r: PatchReply) => void; fail: () => void }>();
    let dead = false;
    const fail = (): void => {
      if (dead) return;
      dead = true;
      sharedPatchPort = null;
      for (const w of ws) { try { w.terminate(); } catch { /* gone */ } }
      for (const s of [...subs.values()]) s.fail();
      subs.clear();
    };
    const load = new Int32Array(nw);
    for (let i = 0; i < nw; i++) {
      const w = new Worker(new URL('./patchbuild.worker.ts', import.meta.url), { type: 'module', name: `genesis-patches-${i}` });
      w.onmessage = (e: MessageEvent<PatchReply>) => { load[i]--; subs.get(e.data.id)?.reply(e.data); };
      w.onerror = (e) => { console.warn('[genesis] patch building worker failed; building on the main thread', e.message ?? e); fail(); };
      w.onmessageerror = fail;
      ws.push(w);
    }
    sharedPatchPort = {
      send: (m, transfer) => {
        if (m.k !== 'build') { for (const w of ws) w.postMessage(m); return; }
        // the least loaded worker (each answers in order; the replies carry their own seq)
        let best = 0;
        for (let i = 1; i < nw; i++) if (load[i] < load[best]) best = i;
        load[best]++;
        ws[best].postMessage(m, transfer ?? []);
      },
      listen: (id, reply, onFail) => { subs.set(id, { reply, fail: onFail }); },
      unlisten: (id) => { subs.delete(id); },
    };
  } catch (e) {
    console.warn('[genesis] no patch building worker; building on the main thread', e);
    sharedPatchPort = null;
  }
  return sharedPatchPort;
}

let nextLodId = 1;
/** patch builds in flight per planet (a frame's requests beyond this wait for a later frame) */
const MAX_INFLIGHT = 192;
/** PERF s17: prefetched children stay in use and are asked for only into free cache room (no churn at rest) */
const PREFETCH_KEEP = perfSwitch('prefetchkeep', true);

// ───────────────────────────── patches ─────────────────────────────

export class Patch {
  readonly face: number;
  readonly level: number;
  /** flat face coordinates of the corners (units of the sim grid) */
  readonly a: [number, number];
  readonly b: [number, number];
  readonly c: [number, number];
  children: Patch[] | null = null;
  split = false;
  readonly centerDir = new Vector3();
  angRadius = 0;
  hMin = 0;
  hMax = 0;
  hasWater = false;
  boundsVersion = -1;
  cells: Int32Array | null = null;
  /** the cells the patch's vertices actually interpolate (set when its geometry is built): exact water presence */
  vcells: Int32Array | null = null;
  /** geometry built and stored in its level's batch (slot below) */
  built = false;
  /** its level's terrain batch (shared by every patch of the level: planetview swaps its material for the shadow
   * pass through this reference) */
  mesh: Mesh | null = null;
  /** slot in the level's terrain batch, and in its water batch (−1: none; a dry patch never takes a water slot) */
  tSlot = -1;
  wSlot = -1;
  lastUsed = 0;
  /** the worker build in flight for it (−1: none) */
  pendingSeq = -1;
  readonly sphere = new Sphere();

  constructor(face: number, level: number, a: [number, number], b: [number, number], c: [number, number]) {
    this.face = face; this.level = level; this.a = a; this.b = b; this.c = c;
  }

  makeChildren(): Patch[] {
    if (this.children) return this.children;
    const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const ab = mid(this.a, this.b), bc = mid(this.b, this.c), ca = mid(this.c, this.a);
    const L = this.level + 1;
    this.children = [
      new Patch(this.face, L, this.a, ab, ca),
      new Patch(this.face, L, ab, this.b, bc),
      new Patch(this.face, L, ca, bc, this.c),
      new Patch(this.face, L, bc, ca, ab),
    ];
    return this.children;
  }
}

export interface ChunkMaterials {
  terrain(level: number): Material;
  water(level: number): Material;
}

/**
 * One LOD level's patches in ONE draw (three's BatchedMesh: WEBGL_multi_draw where the browser has it, else a loop
 * of draws with no per-object cost). Every patch has the same vertex and index counts (the shared lattice), so the
 * batch is a pool of fixed-size slots: a new patch overwrites a freed slot in place (a sub-range upload) and the pool
 * adds a page of 16 slots when it runs out (ChunkLOD.shrinkPools gives the memory back after an eviction). The patches' positions
 * are already in the body frame, so every instance matrix stays the identity; visibility per slot is set by the LOD selection (and per shadow cascade), never by three's culling (the
 * unit-direction `position` attribute would give it wrong bounds).
 */
/** PERF F17 (session 8): slots per pool page — every page of every level has the same buffer sizes */
export const PATCH_PAGE = 16;

/** one page of a level's patch pool: a BatchedMesh of PATCH_PAGE slots that never grows */
class PatchPage {
  readonly mesh: BatchedMesh;
  /** slots ever added to the BatchedMesh */
  used = 0;
  free: number[] = [];
  geomId: number[] = [];
  instId: number[] = [];
  vis = new Uint8Array(PATCH_PAGE);
  visibleN = 0;
  /**
   * PERF s15 cut #9 (WATER_SHARE): the page's water sheet — a BatchedMesh drawing the SAME geometry (vertex buffers,
   * index, slot table) with the water material on the water layer; slot k's water is instance wInst[k] (made on the
   * first wet slot shown)
   */
  water: BatchedMesh | null = null;
  wInst: number[] = [];
  wvis = new Uint8Array(PATCH_PAGE);
  wVisibleN = 0;
  constructor(material: Material, layers: number, name: string) {
    this.mesh = new BatchedMesh(PATCH_PAGE, PATCH_PAGE * NVERT, PATCH_PAGE * NINDEX, material);
    this.mesh.name = name;
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.layers.mask = layers;
    // (perf 2026-11) the ground draws after the other opaque things — trees, houses, people — so the GPU's early depth
    // test (shaders/zcons.ts) skips its fragment shader, the costliest in the frame, wherever something stands on it.
    // Opaque and depth-tested: the image does not depend on the order
    this.mesh.renderOrder = 50;
    // PERF s7 (the owner's M5: 206 ms of main thread in the shadow pass): three's BatchedMesh re-uploads its
    // draw -> instance table (a DataTexture) at EVERY draw whose visibility changed — here every shadow cascade and
    // the scene pass, for every page: texture uploads issued in the middle of render passes, each one a render-pass
    // break on a tile GPU (ANGLE-Metal). A terrain patch's instance matrix is the identity for every slot and the
    // batch has no per-instance colour, so WHICH instance a draw reads changes nothing: the table is uploaded once,
    // the multi-draw lists (CPU arrays passed with the draw call) still change per pass. Same image.
    keepIndirectTable(this.mesh);
  }
  get live(): number { return this.used - this.free.length; }
  /** (PERF s16) the last frame this page's buffers were drawn (terrain or its water sheet; keepIndirectTable) */
  get drawnAt(): number {
    const a = (this.mesh.userData.drawn as number | undefined) ?? -1e9;
    const b = (this.water?.userData.drawn as number | undefined) ?? -1e9;
    return Math.max(a, b);
  }
  /** (PERF s16) not drawn in the last RING_N frames: a write into its buffers is in place on ANGLE-Metal */
  get cold(): boolean { return ringFrame() - this.drawnAt >= RING_N; }

  /** the water sheet over this page's slots (made on first use: shares the page's geometry, nothing is copied) */
  ensureWater(material: Material, name: string): BatchedMesh {
    if (this.water) return this.water;
    const w = new BatchedMesh(PATCH_PAGE, 1, 1, material) as BatchedMesh & Record<string, unknown>;
    const src = this.mesh as unknown as Record<string, unknown>;
    w.geometry.dispose();
    w.geometry = this.mesh.geometry;
    w._geometryInfo = src._geometryInfo;
    w._maxVertexCount = src._maxVertexCount;
    w._maxIndexCount = src._maxIndexCount;
    w._geometryInitialized = true;
    // (the slot count is the page's, live: three's getBoundingSphereAt — the renderer's sort calls it — and the
    // validation of setVisibleAt / addInstance read it)
    Object.defineProperty(w, '_geometryCount', { get: () => src._geometryCount, set: () => { /* the page's */ }, configurable: true });
    w.name = name;
    w.perObjectFrustumCulled = false;
    w.sortObjects = false;
    w.frustumCulled = false;
    w.matrixAutoUpdate = false;
    w.visible = false;
    w.layers.mask = 1 << 2;
    w.renderOrder = 50;
    keepIndirectTable(w);
    this.water = w;
    for (let k = 0; k < this.used; k++) this.addWaterSlot(k);
    this.mesh.parent?.add(w);
    return w;
  }

  /** slot k's water instance (hidden) */
  addWaterSlot(k: number): void {
    const w = this.water;
    if (!w) return;
    this.wInst[k] = w.addInstance(this.geomId[k]);
    w.setVisibleAt(this.wInst[k], false);
    this.wvis[k] = 0;
  }

  showWater(k: number, on: boolean): void {
    if (!this.water || (this.wvis[k] === 1) === on) return;
    this.wvis[k] = on ? 1 : 0;
    this.wVisibleN += on ? 1 : -1;
    this.water.setVisibleAt(this.wInst[k], on);
    this.water.visible = this.wVisibleN > 0;
  }

  /** the page and its water sheet leave / join a group */
  setParent(g: Group | null): void {
    for (const m of this.water ? [this.mesh, this.water] : [this.mesh]) {
      if (g) { if (m.parent !== g) g.add(m); } else m.parent?.remove(m);
    }
  }

  /** delete the GL buffers (the water sheet's own tables only: the geometry is the page's) */
  dispose(): void {
    if (this.water) {
      const w = this.water as BatchedMesh & Record<string, unknown>;
      w.parent?.remove(w);
      w.geometry = new BufferGeometry();
      w._geometryInfo = [];
      w.dispose();
      this.water = null;
    }
    this.mesh.dispose();
  }

  /** PERF F23: take this page into a pool (material, layers, name); every slot is free and hidden */
  reset(material: Material, layers: number, name: string): void {
    this.mesh.material = material;
    this.mesh.layers.mask = layers;
    this.mesh.name = name;
    for (let k = 0; k < this.used; k++) if (this.vis[k]) { this.vis[k] = 0; this.mesh.setVisibleAt(this.instId[k], false); }
    this.visibleN = 0;
    this.mesh.visible = false;
    for (let k = 0; k < this.used; k++) this.showWater(k, false);
    this.free = [];
    for (let k = this.used - 1; k >= 0; k--) this.free.push(k);
  }
}

/**
 * PERF s7 (the owner's M5: 206 ms of main thread in the shadow pass): three's BatchedMesh re-uploads its draw ->
 * instance table (a DataTexture) at EVERY draw whose visibility changed — here every shadow cascade and the scene
 * pass, for every page: texture uploads issued in the middle of render passes, each one a render-pass break on a tile
 * GPU (ANGLE-Metal). A patch's instance matrix is the identity for every slot and the batch has no per-instance
 * colour, so WHICH instance a draw reads changes nothing: the table is uploaded once, the multi-draw lists (CPU arrays
 * passed with the draw call) still change per pass. Same image.
 */
function keepIndirectTable(mesh: BatchedMesh): void {
  const m = mesh as BatchedMesh & { _indirectTexture: { version: number } | null };
  m.onBeforeRender = function (this: typeof m, ...a: Parameters<BatchedMesh['onBeforeRender']>) {
    const tex = this._indirectTexture;
    const v = tex ? tex.version : 0;
    this.userData.drawn = ringFrame();
    BatchedMesh.prototype.onBeforeRender.apply(this, a);
    if (tex && v > 0 && this._indirectTexture === tex) tex.version = v;
  };
}

/**
 * PERF s15 (GPU-MEMORY-PLAN cut #9): the water sheet of a wet patch was drawn from a COPY of its vertices in its
 * level's water batch (extract(): a second set of pages, ~2.2 MB each, CPU + GPU, and whole-page uploads as patches
 * turned wet). Now each terrain page carries a companion BatchedMesh with the water material on the water layer that
 * draws the page's own geometry (same buffers, same slot table): water slot k = terrain slot k, shown when the patch is
 * wet. The same vertices are drawn by the same shaders: the same image. `?watershare=0` = the separate water batches.
 */
const WATER_SHARE = perfSwitch('watershare');

/**
 * PERF s15 (GPU-MEMORY-PLAN cut #3): a patch's 'normal' attribute IS its 'position' (geometryOf), but three's
 * BatchedMesh._initializeGeometry gives every page attribute its own array and GL buffer, so each page held a second
 * copy of the positions (3 of its 48 floats a vertex: ~0.13 MB CPU + 0.13 MB GPU a page). Right after a page's first
 * addGeometry (before its first draw, so no GL buffer exists yet) the page's 'normal' becomes its 'position': one
 * array, one buffer, bound to both vertex attributes. setGeometryAt then copies the same data into it twice (the
 * update ranges coincide and three merges them: one upload). Pages never resize (setGeometrySize would split them
 * again). Same vertex data, same image. `?pagenormal=0` keeps the copy. (three r186)
 */
const NORMAL_ALIAS = perfSwitch('pagenormal');
function aliasNormal(mesh: BatchedMesh): void {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (pos && g.getAttribute('normal') && g.getAttribute('normal') !== pos) g.setAttribute('normal', pos);
}

/** PERF F23: `?pagepool=0` = F17's pages dropped (GL buffers deleted) and patches moved between pages to free them */
const PAGE_POOL = perfSwitch('pagepool');
/**
 * PERF s16 (the owner's M5: 15-19 MB a frame of ANGLE whole-buffer copies): a patch landing in a page the GPU drew in
 * the last 3 frames made ANGLE copy all 13 of the page's attribute buffers (168 kB each). Landings now go to a page
 * not drawn in the last RING_N frames (a hidden / idle page, else a new one from the page pool), up to FRESH_EXTRA
 * (or half the live pages) more pages than the live patches need; past that, the fullest page as before. The
 * patches and their draws are the same: the same image. `?freshland=0` = the fullest page with room, drawn or not.
 */
const FRESH_LAND = perfSwitch('freshland');
const FRESH_EXTRA = 6;
/** (probes) landings by where they went: a cold page, a new page, the fullest page past the allowance, compaction */
export const FRESH_STATS = { cold: 0, fresh: 0, capHot: 0, packHot: 0, packCold: 0 };
try { (globalThis as Record<string, unknown>).__GENESIS_FRESH__ = FRESH_STATS; } catch { /* no global */ }
/** frames an idle page is kept beyond the reserve before its GL buffers are deleted */
const IDLE_FRAMES = 900;
/** idle pages always kept */
const IDLE_RESERVE = 6;
/** frames a pool's slack (>= 2 pages free) must persist before its patches are moved to give pages back */
const SLACK_FRAMES = 600;

/**
 * PERF F23 (session 9; the owner's M5 trace: shadows|bufferData x43 and post|bufferData x36 a frame, ~140 kB each =
 * one patch page's attribute): F17's pools dropped an emptied page (deleting its GL buffers) and moved patches out of
 * sparse pages, and the next landing made a NEW page — every frame while panning, the terrain pages created in the
 * shadow pass (their first draw) and the water pages in the water pass ('post'): new GL buffers = new Metal buffers.
 * Every page of every level, terrain and water, has the same layout, so a page a pool gives up waits here, buffers and
 * all, for the next pool that needs one (any level, terrain or water): reset() re-materials it, its slots are reused
 * in place. Pages idle for IDLE_FRAMES beyond IDLE_RESERVE are deleted (memory after a tour through the LOD depths).
 */
export class PagePool {
  private idle: { p: PatchPage; since: number }[] = [];
  frame = 0;
  take(material: Material, layers: number, name: string, group: Group): PatchPage | null {
    // (PERF s16 FRESH_LAND) the most recently idle page the GPU no longer reads
    let at = this.idle.length - 1;
    if (FRESH_LAND) for (let i = this.idle.length - 1; i >= 0; i--) if (this.idle[i].p.cold) { at = i; break; }
    const e = at >= 0 ? this.idle.splice(at, 1)[0] : undefined;
    if (!e) return null;
    e.p.reset(material, layers, name);
    e.p.setParent(group);
    return e.p;
  }
  give(p: PatchPage, group: Group): void {
    p.setParent(null);
    p.reset(p.mesh.material as Material, p.mesh.layers.mask, p.mesh.name);
    this.idle.push({ p, since: this.frame });
  }
  /**
   * delete the GL buffers of pages idle too long, and of the oldest idle pages beyond half the pages in use (the
   * memory bound after a tour through the LOD depths: in use + 12 %, about the one reserve page per pool F17 kept); the most recently idle are kept
   */
  trim(inUse: number): void {
    const cap = Math.max(IDLE_RESERVE, Math.ceil(inUse / 8));
    while (this.idle.length > cap || (this.idle.length > IDLE_RESERVE && this.frame - this.idle[0].since > IDLE_FRAMES)) this.idle.shift()!.p.dispose();
  }
  get count(): number { return this.idle.length; }
  /** (PERF s16) an idle page the GPU no longer reads */
  hasCold(): boolean { for (const e of this.idle) if (e.p.cold) return true; return false; }
  dispose(): void { for (const e of this.idle) e.p.dispose(); this.idle = []; }
}

/**
 * A level's terrain (or water) patch pool. PERF F17 (session 8): made of fixed-size PAGES instead of one BatchedMesh
 * that grew x1.5 and was rebuilt smaller after evictions. On ANGLE-Metal (Chrome / Safari on a Mac) a patch landing in
 * a pool the GPU still reads re-allocates the WHOLE pool attribute (BufferMtl putDataInNewBuffer…; see upload.ts F16)
 * and every 64 MB of fresh allocations makes ANGLE wait for the whole GPU queue — a pool of 100+ slots (14 MB) took
 * that hit for every patch while panning (the M5's 200-500 ms 'shadows' stalls: terrain uploads happen at its first
 * draw, in the shadow pass). A page is 16 slots (~2.2 MB in all attributes), never grows (a grow or a rebuild was a
 * new set of buffers of a never-seen size), and every page of every level has the same buffer sizes, so ANGLE's free
 * lists recycle them. Slot ids are page * PATCH_PAGE + index. Same vertices, same draws (one multi-draw per page).
 */
class PatchBatch {
  private pages: (PatchPage | null)[] = [];
  private material: Material;
  private layers: number;
  private readonly name: string;
  readonly group: Group;

  private readonly pool: PagePool | null;
  private slackSince = -1;

  /** WATER_SHARE: the level's water material, drawn by each page's companion sheet (null: a separate water batch) */
  private readonly waterMat: Material | null;

  constructor(material: Material, layer: number, name: string, group: Group, pool: PagePool | null = null, waterMat: Material | null = null) {
    this.waterMat = waterMat;
    this.pool = PAGE_POOL ? pool : null;
    this.material = material;
    this.layers = 1 << layer;
    this.name = name;
    this.group = group;
  }

  /** slot capacity (pages x PATCH_PAGE) */
  get cap(): number { let n = 0; for (const p of this.pages) if (p) n += PATCH_PAGE; return n; }
  /** pages held */
  get pageCount(): number { let n = 0; for (const p of this.pages) if (p) n++; return n; }
  /** any slot shown */
  get visible(): boolean { for (const p of this.pages) if (p && p.visibleN > 0) return true; return false; }

  /** the page meshes (tests, materials) */
  meshes(): BatchedMesh[] { const out: BatchedMesh[] = []; for (const p of this.pages) if (p) out.push(p.mesh); return out; }

  /** the mesh drawing slot `s` */
  meshOf(s: number): BatchedMesh { return this.pages[Math.floor(s / PATCH_PAGE)]!.mesh; }

  setMaterial(m: Material): void { this.material = m; for (const p of this.pages) if (p) p.mesh.material = m; }

  /** add or remove the shadow casters' layer (1) on every page */
  setLayer(layer: number, on: boolean): void {
    if (on) this.layers |= 1 << layer; else this.layers &= ~(1 << layer);
    for (const p of this.pages) if (p) p.mesh.layers.mask = this.layers;
  }

  /**
   * store a patch geometry, returning its slot (hidden until shown); `avoid` = a page not to use (compaction);
   * `packed` = the fullest page with room whether the GPU reads it or not (compaction)
   */
  alloc(geo: BufferGeometry, avoid = -1, packed = false): number {
    // the fullest page with room (keeps pages dense, so evictions empty whole pages)
    let pi = -1, best = -1;
    // PERF s16 FRESH_LAND: first among the pages the GPU no longer reads (no ANGLE whole-page copy); else a new page
    // while the level holds fewer than its live pages + its allowance; else the fullest (a drawn page: one copy)
    if (FRESH_LAND) {
      for (let i = 0; i < this.pages.length; i++) {
        const p = this.pages[i];
        if (!p || i === avoid || !p.cold) continue;
        if (p.free.length === 0 && p.used >= PATCH_PAGE) continue;
        if (p.live > best) { best = p.live; pi = i; }
      }
      // (compaction never opens a page: it falls back to the fullest)
      if (pi < 0 && packed) pi = -2;
      if (pi < 0) {
        const need = Math.ceil((this.liveSlots + 1) / PATCH_PAGE);
        // (past the allowance a page the pool already holds still serves: no new memory)
        if (this.pageCount >= need + Math.max(FRESH_EXTRA, Math.ceil(need * 0.75)) && !this.pool?.hasCold()) pi = -2;
      }
    }
    if (pi === -2 || !FRESH_LAND) {
      pi = -1; best = -1;
      for (let i = 0; i < this.pages.length; i++) {
        const p = this.pages[i];
        if (!p || i === avoid) continue;
        if (p.free.length === 0 && p.used >= PATCH_PAGE) continue;
        if (p.live > best) { best = p.live; pi = i; }
      }
    }
    if (FRESH_LAND) {
      const p = pi >= 0 ? this.pages[pi] : null;
      if (!p) FRESH_STATS.fresh++;
      else if (packed) { if (p.cold) FRESH_STATS.packCold++; else FRESH_STATS.packHot++; }
      else if (p.cold) FRESH_STATS.cold++;
      else FRESH_STATS.capHot++;
    }
    if (pi < 0) {
      pi = this.pages.indexOf(null);
      if (pi < 0) pi = this.pages.length;
      const name = `${this.name}-p${pi}`;
      const p = this.pool?.take(this.material, this.layers, name, this.group) ?? new PatchPage(this.material, this.layers, name);
      p.setParent(this.group);
      if (p.water && this.waterMat) { p.water.material = this.waterMat; p.water.name = `${name}-water`; }
      this.pages[pi] = p;
    }
    const p = this.pages[pi]!;
    let k = p.free.pop();
    if (k === undefined) {
      k = p.used++;
      p.geomId[k] = p.mesh.addGeometry(geo, NVERT, NINDEX);
      if (k === 0 && NORMAL_ALIAS) aliasNormal(p.mesh);
      // (ROADMAP step 4) the page's later landings go up in the renderer's uploads slot, not inside a shadow / scene pass
      if (k === 0) earlyGeo(p.mesh.geometry);
      p.instId[k] = p.mesh.addInstance(p.geomId[k]);
      p.addWaterSlot(k);
      // (a new instance starts visible: count it, then hide it)
      p.vis[k] = 1;
      p.visibleN++;
      this.showIn(p, k, false);
    } else {
      // (a freed slot is already hidden)
      p.mesh.setGeometryAt(p.geomId[k], geo);
    }
    return pi * PATCH_PAGE + k;
  }

  release(s: number): void {
    if (s < 0) return;
    const p = this.pages[Math.floor(s / PATCH_PAGE)];
    if (!p) return;
    const k = s % PATCH_PAGE;
    this.showIn(p, k, false);
    p.showWater(k, false);
    p.free.push(k);
  }

  /** WATER_SHARE: show / hide slot `s`'s water sheet (the page's companion, made on the first wet slot) */
  showWater(s: number, on: boolean): void {
    if (s < 0 || !this.waterMat) return;
    const p = this.pages[Math.floor(s / PATCH_PAGE)];
    if (!p) return;
    if (on) p.ensureWater(this.waterMat, `${p.mesh.name}-water`);
    p.showWater(s % PATCH_PAGE, on);
  }

  /** any water sheet shown */
  get waterVisible(): boolean { for (const p of this.pages) if (p && p.wVisibleN > 0) return true; return false; }

  show(s: number, on: boolean): void {
    if (s < 0) return;
    const p = this.pages[Math.floor(s / PATCH_PAGE)];
    if (p) this.showIn(p, s % PATCH_PAGE, on);
  }

  private showIn(p: PatchPage, k: number, on: boolean): void {
    if ((p.vis[k] === 1) === on) return;
    p.vis[k] = on ? 1 : 0;
    p.visibleN += on ? 1 : -1;
    p.mesh.setVisibleAt(p.instId[k], on);
    p.mesh.visible = p.visibleN > 0;
  }

  isShown(s: number): boolean {
    if (s < 0) return false;
    const p = this.pages[Math.floor(s / PATCH_PAGE)];
    return !!p && p.vis[s % PATCH_PAGE] === 1;
  }

  /** slots holding a patch */
  get liveSlots(): number { let n = 0; for (const p of this.pages) if (p) n += p.live; return n; }

  /** a copy of a slot's vertex data as a stand-alone geometry (a patch that turns wet takes a water slot from it) */
  extract(s: number): BufferGeometry {
    const p = this.pages[Math.floor(s / PATCH_PAGE)]!;
    const src = p.mesh.geometry;
    const r = p.mesh.getGeometryRangeAt(p.geomId[s % PATCH_PAGE]) as { vertexStart: number };
    const vs = r.vertexStart;
    const geo = new BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.getAttribute(name);
      if (name === 'normal' && a === src.getAttribute('position')) continue;
      geo.setAttribute(name, new Float32BufferAttribute((a.array as Float32Array).slice(vs * a.itemSize, (vs + NVERT) * a.itemSize), a.itemSize));
    }
    // (the batch's 'normal' is its 'position': the copy's too)
    if (src.getAttribute('normal') === src.getAttribute('position')) geo.setAttribute('normal', geo.getAttribute('position'));
    geo.setIndex(indexBuffer());
    return geo;
  }

  /**
   * Give back memory after evictions: empty pages are dropped (one kept as a reserve), and while two or more pages'
   * worth of slots stand free, the emptiest page's patches move into the others and it is dropped. `moved(old, new)`
   * re-points the patch that held `old`. A page stays 16 slots, so nothing is re-allocated at a new size.
   */
  compact(moved: (from: number, to: number) => void, frame = 0): void {
    // F23: with the page pool, a pool keeps its pages through the eviction's saw-tooth (64 patches dropped at once,
    // landed again over the next frames) and gives pages back only when its slack has lasted SLACK_FRAMES (not while
    // streaming) or it is half empty (the view is leaving this level); moving patches re-uploads them
    if (this.pool) {
      const slack = this.cap - this.liveSlots;
      if (slack < 2 * PATCH_PAGE) { this.slackSince = -1; return; }
      if (this.slackSince < 0) this.slackSince = frame;
      if (slack < Math.max(3 * PATCH_PAGE, this.liveSlots) && frame - this.slackSince < SLACK_FRAMES) return;
      this.slackSince = -1;
    }
    let reserve = !!this.pool;
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i];
      if (!p || p.live > 0) continue;
      if (!reserve) { reserve = true; continue; }
      this.dropPage(i);
    }
    for (;;) {
      const free = this.cap - this.liveSlots;
      if (free < 2 * PATCH_PAGE) break;
      let pi = -1, least = PATCH_PAGE + 1;
      for (let i = 0; i < this.pages.length; i++) { const p = this.pages[i]; if (p && p.live > 0 && p.live < least) { least = p.live; pi = i; } }
      if (pi < 0) break;
      const p = this.pages[pi]!;
      // (PERF s16 FRESH_LAND) move patches only into pages the GPU no longer reads (no whole-page copies): while the
      // others are all drawn the slack waits (bounded by alloc's page allowance)
      if (FRESH_LAND) {
        let room = 0;
        for (let i = 0; i < this.pages.length; i++) { const q = this.pages[i]; if (q && i !== pi && q.cold) room += PATCH_PAGE - q.live; }
        if (room < p.live) break;
      }
      const freeSet = new Set(p.free);
      for (let k = 0; k < p.used; k++) {
        if (freeSet.has(k)) continue;
        const from = pi * PATCH_PAGE + k;
        const geo = this.extract(from);
        const to = this.alloc(geo, pi, true);
        geo.dispose();
        this.show(to, p.vis[k] === 1);
        if (p.wvis[k] === 1) this.showWater(to, true);
        moved(from, to);
      }
      this.dropPage(pi);
    }
    while (this.pages.length && this.pages[this.pages.length - 1] === null) this.pages.pop();
  }

  private dropPage(i: number): void {
    const p = this.pages[i];
    if (!p) return;
    if (this.pool) this.pool.give(p, this.group);
    else { p.setParent(null); p.dispose(); }
    this.pages[i] = null;
  }

  dispose(): void {
    for (let i = 0; i < this.pages.length; i++) this.dropPage(i);
    this.pages = [];
  }
}

export interface ChunkSelectContext {
  /** camera position in the planet BODY frame (m) */
  camBody: Vector3;
  /** camera frustum in world (camera-relative) space */
  frustum: Frustum;
  /** body → world (camera-relative) transform of the planet group */
  bodyToWorld: Matrix4;
  /** split distance factor: a level-L patch splits when closer than K · size_L */
  K: number;
  frame: number;
  /** max patches built this frame */
  buildBudget: number;
  /**
   * and a time cap on top (ms of building this frame, macfix/smooth.md): once BUILD_MIN patches are in, no more starts
   * after this — a camera sweep spreads its builds over a few frames instead of one long one (16 patches were tens of
   * ms of main thread in one frame: a visible hitch). Unset (a camera cut) = the count alone. The converged image is
   * the same; only when it is reached changes.
   */
  buildMs?: number;
}

/** patches always built in a frame under the time cap (ChunkSelectContext.buildMs) */
const BUILD_MIN = 4;
const _v = new Vector3();
const _pc = new Vector3();
const _hit = newHit();
/**
 * extra split reach for patches seen edge-on (factor 1 + k·(1 − |cos|)³, k up to this). It is for the LIMB seen from
 * altitude: from near the ground nearly every distant patch is edge-on, and the full boost there tripled the patch and
 * draw counts of surface views for detail nobody sees, so k fades out below ~a third of a radius of altitude
 * (ChunkLOD.silK; the vertex shader reads the same k from uMorph.w).
 */
export const SILHOUETTE_SPLIT = 2.5;
/** reach of the local horizon occluder profile (rad from the camera) and its number of radial bins */
const LOCAL_OCC = 1.2;
const OCC_BINS = 96;

/** Water and ground arrays the chunk system reads for bounds (kept by FieldTextures). */
export interface ChunkFieldSource {
  surface: ArrayLike<number> | null;
  /** per-cell curvature gradients (4 floats per cell, surface.ts): the curved ground can bulge past its cells */
  grad: ArrayLike<number> | null;
  waterLevel: Float32Array;
  waterDepth: Float32Array;
  /** molten lava depth per cell (m): the terrain mesh stands on it (terrainmat VERT_MAIN), so the bounds do too */
  lava?: ArrayLike<number> | null;
  geomVersion: number;
}

export class ChunkLOD {
  readonly grid: IcoGrid;
  readonly noise: Noise3;
  readonly radius: number;
  readonly roots: Patch[] = [];
  readonly maxLevel: number;
  /** metres per lattice step at level 0 */
  readonly spacing0: number;
  selected: Patch[] = [];
  /** meshes become children of this group (the planet's body-frame group) */
  private group: Group;
  private mats: ChunkMaterials;
  private fields: ChunkFieldSource;
  private live = new Set<Patch>();
  private built = 0;
  private builtThisFrame = 0;
  /** the frame select() is running for (a patch built or visited in it is in use, never evicted at its end) */
  private curFrame = 0;
  /** per LOD level: the terrain batch and the water batch (created on first use) */
  private tBatch: (PatchBatch | null)[] = [];
  /** PERF F23: idle patch pages shared by every pool of this planet */
  private readonly pagePool = new PagePool();
  private wBatch: (PatchBatch | null)[] = [];
  /**
   * built patches kept for reuse (the view in use always stays, see evict). Each costs ~140 kB of CPU attribute copies
   * in its terrain slot (and as much again in a water slot when wet) plus their GPU mirrors: at 1,400 a 100x camera
   * tour filled 3,300 slots, ~0.5 GB of page memory, for views drawing ~450 patches. 800 still holds the ~450 of one
   * low-quality surface view plus the way back to it; a view needing more raises the budget to 1.5x what it draws.
   */
  maxCached = 800;
  terrainLayerMask = 0;
  castShadows = false;
  waterEnabled = true;
  stats = { patches: 0, waterPatches: 0, builtTotal: 0, horizonCulled: 0 };
  /** this frame's silhouette split boost (see SILHOUETTE_SPLIT), set by select() */
  silK = SILHOUETTE_SPLIT;

  private builder: PatchBuilder;
  /**
   * PERF (session 5): patches beyond the first two levels are built by a helper worker (patchbuild.ts) when there is
   * one: select() asks for a patch the view needs and draws its parent until it arrives (as when the per-frame build
   * budget ran out before), so a camera move or cut never stalls the main thread on terrain. Same bytes either way.
   */
  private port: PatchPort | null = null;
  private readonly lodId = nextLodId++;
  private seq = 0;
  private pending = new Map<number, Patch>();
  private ready: PatchReply[] = [];
  /** the worker's output buffers, handed back with the next request once their contents are in a batch */
  private recycle: ArrayBuffer[][] = [];
  /** patches landed from the worker (stats / tests) */
  landedTotal = 0;

  /** `opts.seed`: the planet's noise seed (lets a worker rebuild the same Noise3); `opts.port`: a worker port (null =
   * always this thread; default: the browser's shared one when a seed is given) */
  constructor(grid: IcoGrid, noise: Noise3, radius: number, group: Group, mats: ChunkMaterials, fields: ChunkFieldSource,
    opts?: { seed?: number | string; port?: PatchPort | null }) {
    this.grid = grid; this.noise = noise; this.radius = radius; this.group = group; this.mats = mats; this.fields = fields;
    const n = grid.n;
    for (let f = 0; f < 20; f++) this.roots.push(new Patch(f, 0, [0, 0], [n, 0], [0, n]));
    this.spacing0 = (ICO_EDGE * radius) / R;
    this.builder = new PatchBuilder(grid, noise, radius);
    const port = opts?.port !== undefined ? opts.port : (opts?.seed !== undefined ? browserPatchPort() : null);
    if (port && opts?.seed !== undefined) {
      this.port = port;
      port.send({ k: 'init', id: this.lodId, gridN: grid.n, seed: opts.seed, radius });
      port.listen(this.lodId, (r) => this.ready.push(r), () => this.portFailed());
    }
    // deepest level: lattice spacing ≈ 0.8 m (the 3.2 m detail octave is then fully resolved)
    this.maxLevel = Math.max(0, Math.ceil(Math.log2(this.spacing0 / 0.8)));
  }

  /** metres per lattice step at a level */
  spacing(level: number): number { return this.spacing0 / (1 << level); }
  /** approximate patch edge length (m) */
  size(level: number): number { return this.spacing(level) * R; }

  // ── bounds ──

  private flatDir(face: number, fi: number, fj: number, out: Vector3): Vector3 {
    const fc = this.grid.faceCorners;
    const n = this.grid.n;
    const u = fi / n, v = fj / n;
    const o = face * 9;
    out.set(
      fc[o] + (fc[o + 3] - fc[o]) * u + (fc[o + 6] - fc[o]) * v,
      fc[o + 1] + (fc[o + 4] - fc[o + 1]) * u + (fc[o + 7] - fc[o + 1]) * v,
      fc[o + 2] + (fc[o + 5] - fc[o + 2]) * u + (fc[o + 8] - fc[o + 2]) * v,
    );
    return out.normalize();
  }

  private patchCells(p: Patch): Int32Array {
    if (p.cells) return p.cells;
    const g = this.grid;
    const n = g.n;
    const xs = [p.a[0], p.b[0], p.c[0]], ys = [p.a[1], p.b[1], p.c[1]];
    const i0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), i1 = Math.min(n, Math.ceil(Math.max(...xs)) + 1);
    const j0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), j1 = Math.min(n, Math.ceil(Math.max(...ys)) + 1);
    const out: number[] = [];
    const st = g.gridStride, row = n + 1, base = p.face * st;
    // barycentric inside test with a one-cell margin (so shore cells across the border count)
    const ax = p.a[0], ay = p.a[1];
    const e1x = p.b[0] - ax, e1y = p.b[1] - ay, e2x = p.c[0] - ax, e2y = p.c[1] - ay;
    const det = e1x * e2y - e1y * e2x;
    const size = Math.sqrt(Math.abs(det));
    const margin = 1.6 / Math.max(size, 1e-6);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1 && i + j <= n; i++) {
        const dx = i - ax, dy = j - ay;
        const u = (dx * e2y - dy * e2x) / det;
        const v = (e1x * dy - e1y * dx) / det;
        if (u < -margin || v < -margin || u + v > 1 + margin) continue;
        out.push(g.faceGrid[base + j * row + i]);
      }
    }
    // tiny patches may contain no lattice point: use the cells of the sim triangle under the centroid
    if (out.length === 0) {
      g.locateFaceCoords(p.face, (p.a[0] + p.b[0] + p.c[0]) / 3, (p.a[1] + p.b[1] + p.c[1]) / 3, _hit);
      out.push(_hit.a, _hit.b, _hit.c);
    }
    p.cells = Int32Array.from(out);
    return p.cells;
  }

  private updateBounds(p: Patch): void {
    if (p.boundsVersion === this.fields.geomVersion && p.boundsVersion >= 0) return;
    p.boundsVersion = this.fields.geomVersion;
    const da = this.flatDir(p.face, p.a[0], p.a[1], new Vector3());
    const db = this.flatDir(p.face, p.b[0], p.b[1], new Vector3());
    const dc = this.flatDir(p.face, p.c[0], p.c[1], new Vector3());
    p.centerDir.copy(da).add(db).add(dc).normalize();
    p.angRadius = Math.max(p.centerDir.angleTo(da), p.centerDir.angleTo(db), p.centerDir.angleTo(dc)) * 1.04 + 1e-5;
    const cells = this.patchCells(p);
    const s = this.fields.surface;
    const wl = this.fields.waterLevel, wd = this.fields.waterDepth;
    const G = this.fields.grad;
    const lv = this.fields.lava ?? null;
    let lo = Infinity, hi = -Infinity, water = false, g2 = 0;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const h = s ? s[c] : 0;
      if (G) { const m = G[c * 4] * G[c * 4] + G[c * 4 + 1] * G[c * 4 + 1] + G[c * 4 + 2] * G[c * 4 + 2]; if (m > g2) g2 = m; }
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      // (a flow stands on the ground: its top bounds the patch too)
      if (lv && lv[c] > 0 && h + lv[c] > hi) hi = h + lv[c];
      if (wd[c] > 0.02 || wl[c] > h - 0.5) {
        water = true;
        if (wl[c] > hi) hi = wl[c];
      }
    }
    // the bounds keep the 1.6-cell margin (shore cells across the border), but whether the patch draws a water sheet
    // at all is decided by the cells its vertices interpolate: the margin flagged every patch within ~80 m of a pond
    // (501 water patches over the mostly dry lookdev city, each a full 2 000-triangle draw of discarded fragments)
    if (water && p.vcells) water = this.vertexWater(p.vcells, s, wl, wd);
    // detail relief (±~2 m), the coarse lattice cutting inside a sim triangle's plane, and the curved ground's bulge
    const bulge = curveMargin(this.grid, this.radius, Math.sqrt(g2));
    p.hMin = lo - 2.5 - bulge;
    p.hMax = hi + 2.5 + bulge;
    p.hasWater = water;
    const rMid = this.radius + 0.5 * (p.hMin + p.hMax);
    const chord = 2 * Math.sin(p.angRadius / 2) * (this.radius + p.hMax);
    p.sphere.center.copy(p.centerDir).multiplyScalar(rMid);
    p.sphere.radius = Math.hypot(chord, 0.5 * (p.hMax - p.hMin)) + this.skirtDepth(p.level);
  }

  /** any of these cells wet, or a shore cell whose extrapolated level is within reach of its ground (same rule as bounds) */
  private vertexWater(cells: Int32Array, s: ArrayLike<number> | null, wl: Float32Array, wd: Float32Array): boolean {
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (wd[c] > 0.02 || wl[c] > (s ? s[c] : 0) - 0.5) return true;
    }
    return false;
  }

  skirtDepth(level: number): number {
    return Math.max(1.5, this.spacing(level) * 1.5);
  }

  /** closest distance from the camera (body frame) to the patch's shell sector */
  private boundDistance(p: Patch, cam: Vector3, rc: number): number {
    const cosT = rc > 0 ? Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc)) : 1;
    const th = Math.max(0, Math.acos(cosT) - p.angRadius);
    const r0 = this.radius + p.hMin, r1 = this.radius + p.hMax;
    const rho = Math.min(r1, Math.max(r0, rc * Math.cos(th)));
    return Math.sqrt(Math.max(0, rc * rc + rho * rho - 2 * rc * rho * Math.cos(th)));
  }

  /** false if the planet itself hides the whole patch (two tangent cones to the occluding sphere) */
  private aboveHorizon(p: Patch, cam: Vector3, rc: number, rOcc: number): boolean {
    if (rc <= rOcc) return true;
    const cosT = Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc));
    const th = Math.max(0, Math.acos(cosT) - p.angRadius);
    const rTop = this.radius + p.hMax;
    if (rTop <= rOcc) return th < 1e-3;
    const aCam = Math.acos(rOcc / rc);
    const aPt = Math.acos(rOcc / rTop);
    return th < aCam + aPt;
  }

  // ── geometry ──

  /** build a patch's geometry on this thread (its attributes view the builder's reused arrays: copy before the next) */
  private buildGeometry(p: Patch): BufferGeometry {
    const r = this.builder.build(p.face, p.level, p.a, p.b, p.c);
    p.vcells = r.vcells;
    return geometryOf(r, p.sphere);
  }

  /** the level's terrain (water = false) or water batch, made on first use */
  private batch(level: number, water: boolean): PatchBatch {
    const list = water ? this.wBatch : this.tBatch;
    let b = list[level];
    if (!b) {
      b = new PatchBatch(water ? this.mats.water(level) : this.mats.terrain(level), water ? 2 : 0, `${water ? 'water' : 'terrain'}-L${level}`, this.group, this.pagePool,
        !water && WATER_SHARE ? this.mats.water(level) : null);
      if (!water && this.castShadows) b.setLayer(1, true);
      list[level] = b;
    }
    return b;
  }

  /**
   * Give back the memory of pools the eviction emptied (a camera tour through the LOD depths once grew the page by
   * ~1 GB in 30 minutes). PERF F17: pools are pages of 16 slots; an emptied page is dropped (one kept per pool as a
   * reserve), and a pool with two pages' worth of free slots moves its emptiest page's patches into the others (with
   * their visibility) and drops it: capacity stays within live + 31 slots per pool; an empty pool is dropped.
   */
  private shrinkPools(): void {
    for (const water of [false, true]) {
      const list = water ? this.wBatch : this.tBatch;
      for (let level = 0; level < list.length; level++) {
        const b = list[level];
        if (!b) continue;
        if (b.liveSlots === 0) {
          b.dispose();
          list[level] = null;
          continue;
        }
        if (b.cap - b.liveSlots < 2 * PATCH_PAGE) continue;
        const bySlot = new Map<number, Patch>();
        for (const p of this.live) if (p.level === level) { const s = water ? p.wSlot : p.tSlot; if (s >= 0) bySlot.set(s, p); }
        b.compact((from, to) => {
          const p = bySlot.get(from);
          if (!p) return;
          if (water) p.wSlot = to;
          else { p.tSlot = to; p.mesh = b.meshOf(to); }
        }, this.curFrame);
      }
    }
    this.pagePool.frame = this.curFrame;
    let inUse = 0;
    for (const b of [...this.tBatch, ...this.wBatch]) if (b) inUse += b.pageCount;
    this.pagePool.trim(inUse);
  }

  /** slot capacity of every terrain + water pool (memory regression tests) */
  poolCapacity(): { slots: number; live: number; pools: number } {
    let slots = 0, live = 0, pools = 0;
    for (const b of [...this.tBatch, ...this.wBatch]) {
      if (!b) continue;
      slots += b.cap; live += b.liveSlots; pools++;
    }
    slots += this.pagePool.count * PATCH_PAGE;
    return { slots, live, pools };
  }

  private ensureGeometry(p: Patch, budget: boolean): boolean {
    if (p.built) return true;
    if (budget && this.port) {
      // (asked already: its parent draws until it lands)
      // (a camera cut's budget, 320, asks for the whole new view at once: the workers fill it in a few frames)
      if (p.pendingSeq >= 0 || this.pending.size >= Math.max(MAX_INFLIGHT, this.buildBudgetNow * 2)) return false;
      const seq = ++this.seq;
      p.pendingSeq = seq;
      this.pending.set(seq, p);
      const recycle = this.recycle.pop() ?? [];
      this.port.send({ k: 'build', id: this.lodId, seq, face: p.face, level: p.level, a: p.a, b: p.b, c: p.c, recycle }, recycle);
      return false;
    }
    if (budget && this.builtThisFrame >= this.buildBudgetNow) return false;
    if (budget && this.buildMsNow > 0 && this.builtThisFrame >= BUILD_MIN && performance.now() - this.buildT0 > this.buildMsNow) return false;
    this.updateBounds(p);
    const geo = this.buildGeometry(p);
    this.builtThisFrame++;
    this.store(p, geo);
    return true;
  }

  /** put a built patch into its level's batches */
  private store(p: Patch, geo: BufferGeometry): void {
    // now that the vertex cells are known, the exact water test (bounds were derived before the build)
    if (p.hasWater && p.vcells) p.hasWater = this.vertexWater(p.vcells, this.fields.surface, this.fields.waterLevel, this.fields.waterDepth);
    p.lastUsed = this.curFrame;
    this.built++;
    this.stats.builtTotal++;
    const tb = this.batch(p.level, false);
    p.tSlot = tb.alloc(geo);
    p.mesh = tb.meshOf(p.tSlot);
    // the water sheet is drawn from a copy of the same vertices in the level's water batch (water pass, layer 2)
    if (p.hasWater && !WATER_SHARE) p.wSlot = this.batch(p.level, true).alloc(geo);
    p.built = true;
    p.pendingSeq = -1;
    this.live.add(p);
  }

  /**
   * Put the patches the worker finished into their batches (a copy each; under the frame's time cap, BUILD_MIN at
   * least — what is left lands next frame). A patch built here meanwhile drops its reply.
   */
  private landReady(): void {
    let n = 0;
    while (this.ready.length > 0) {
      // (a cut's frames have no time cap for building; landing keeps one: a few hundred copies in one frame is a hitch)
      if (n >= BUILD_MIN * 2 && performance.now() - this.buildT0 > (this.buildMsNow > 0 ? this.buildMsNow : 8)) break;
      const r = this.ready.shift()!;
      const p = this.pending.get(r.seq);
      this.pending.delete(r.seq);
      if (p && !p.built && p.pendingSeq === r.seq) {
        p.pendingSeq = -1;
        this.updateBounds(p);
        p.vcells = r.vcells;
        const geo = geometryOf(r, p.sphere);
        this.store(p, geo);
        this.landedTotal++;
        n++;
      } else if (p) p.pendingSeq = -1;
      if (this.recycle.length < MAX_INFLIGHT) this.recycle.push(r.attrs.map((x) => x.buffer as ArrayBuffer));
    }
  }

  /** the worker died: forget what was asked (those patches build here from now on) */
  private portFailed(): void {
    this.port = null;
    for (const p of this.pending.values()) p.pendingSeq = -1;
    this.pending.clear();
    this.ready = [];
    this.recycle = [];
  }

  private buildBudgetNow = 16;
  private buildMsNow = 0;
  private buildT0 = 0;

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.tBatch) {
      if (!b) continue;
      b.setLayer(1, on);
    }
  }

  // ── selection ──

  /** radial occluder profile around the camera: prof[i] = the radius of the lowest VISIBLE surface within angle
   * (i + 1)·LOCAL_OCC/OCC_BINS of the camera — the ground, or the water over it (the water sheet is opaque and
   * depth-tested: whatever lies under the sea's horizon is hidden by the sea) — minus what the detail relief, dunes and
   * the curved ground can dig below the cells. A sight line from the camera to a point θ away never leaves the disc of
   * radius θ, so a sphere of radius prof(θ) is a valid occluder for everything within θ: each patch is tested against
   * the tightest sphere its own sight lines allow (recomputed as the camera moves ~25 m or the ground changes) */
  private occ = { prof: new Float64Array(OCC_BINS), x: 0, y: 0, z: 0, version: -1, valid: false };

  private updateLocalOccluder(cam: Vector3, rc: number): void {
    const L = this.occ;
    const s = this.fields.surface;
    if (!s || rc <= 0) { L.valid = false; return; }
    const ux = cam.x / rc, uy = cam.y / rc, uz = cam.z / rc;
    const moved = Math.hypot(ux - L.x, uy - L.y, uz - L.z) * this.radius;
    if (L.valid && L.version === this.fields.geomVersion && moved < 25) return;
    L.x = ux; L.y = uy; L.z = uz; L.version = this.fields.geomVersion;
    const G = this.fields.grad;
    const wl = this.fields.waterLevel, wd = this.fields.waterDepth;
    const P = this.grid.pos;
    const lo = L.prof;
    lo.fill(Infinity);
    let g2 = 0;
    // the cell's own extent: a cell a bin away may still reach into the nearer bin
    const half = this.grid.meanEdgeAngle * 0.6;
    for (const c of this.grid.cellsWithin(ux, uy, uz, LOCAL_OCC + 0.03)) {
      // (a wet cell's surface is its water level; the shore sheet thins out within a metre or so of its edge)
      const top = wd[c] > 0.5 ? Math.max(s[c], wl[c] - 1) : s[c];
      const th = Math.acos(Math.min(1, Math.max(-1, P[c * 3] * ux + P[c * 3 + 1] * uy + P[c * 3 + 2] * uz)));
      const b = Math.max(0, Math.min(OCC_BINS - 1, Math.floor(((th - half) / LOCAL_OCC) * OCC_BINS)));
      if (top < lo[b]) lo[b] = top;
      if (G) { const m = G[c * 4] * G[c * 4] + G[c * 4 + 1] * G[c * 4 + 1] + G[c * 4 + 2] * G[c * 4 + 2]; if (m > g2) g2 = m; }
    }
    const margin = 3 + curveMargin(this.grid, this.radius, Math.sqrt(g2));
    let run = Infinity;
    for (let i = 0; i < OCC_BINS; i++) { run = Math.min(run, lo[i]); lo[i] = run; }
    for (let i = 0; i < OCC_BINS; i++) lo[i] = Number.isFinite(lo[i]) ? this.radius + lo[i] - margin : 0;
    L.valid = true;
  }

  /** the occluder radius valid for sight lines that stay within angle th of the camera (0: none) */
  private occluderWithin(th: number): number {
    const L = this.occ;
    if (!L.valid || th > LOCAL_OCC) return 0;
    return L.prof[Math.min(OCC_BINS - 1, Math.max(0, Math.ceil((th / LOCAL_OCC) * OCC_BINS) - 1))];
  }

  select(ctx: ChunkSelectContext): Patch[] {
    // (`?freeze=1`, ROADMAP step 2) landing has converged once nothing landed, queued or built for a while: then it stops
    freezeLandTick(this.lodId, this.ready.length > 0 || this.pending.size > 0 || this.builtThisFrame > 0, ctx.camBody.x, ctx.camBody.y, ctx.camBody.z);
    this.builtThisFrame = 0;
    this.curFrame = ctx.frame;
    this.buildBudgetNow = ctx.buildBudget;
    this.buildMsNow = ctx.buildMs ?? 0;
    this.buildT0 = performance.now();
    this.stats.horizonCulled = 0;
    if (!FREEZE.active && (this.port || this.ready.length > 0)) this.landReady();
    const out: Patch[] = [];
    const cam = ctx.camBody;
    const rc = cam.length();
    {
      const a = Math.min(1, Math.max(0, ((rc - this.radius) / this.radius - 0.08) / (0.35 - 0.08)));
      this.silK = SILHOUETTE_SPLIT * a * a * (3 - 2 * a);
    }
    // occluder: the lowest ground anywhere (conservative)
    let rOcc = this.radius;
    for (const r of this.roots) { this.updateBounds(r); rOcc = Math.min(rOcc, this.radius + r.hMin); }
    rOcc -= 5;
    // near the ground the planet's lowest point (the sea floor) makes a useless occluder: from 60 m up it leaves
    // ~1.5 km of ground beyond the true horizon "visible". The local occluder profile (updateLocalOccluder) gives each
    // patch the tightest valid sphere for its own sight lines and culls the far side of the horizon
    this.updateLocalOccluder(cam, rc);
    const visit = (p: Patch): boolean => {
      this.updateBounds(p);
      if (!this.aboveHorizon(p, cam, rc, rOcc)) { p.split = false; return true; }
      // in use: the split ancestors of what is drawn too (only drawn leaves were stamped, so once the cache was full
      // every interior patch — and every child built for a split that had to wait a frame — was evicted at the end of
      // the frame it was built in and rebuilt the next: the whole build budget went to that churn, and after a dozen
      // camera jumps the terrain stayed stuck at its coarse levels, ~40 patches for a view needing ~700)
      p.lastUsed = ctx.frame;
      {
        const cosT = Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc));
        const rLoc = this.occluderWithin(Math.acos(cosT) + p.angRadius);
        if (rLoc > rOcc && rc > rLoc && !this.aboveHorizon(p, cam, rc, rLoc)) { p.split = false; this.stats.horizonCulled++; return true; }
      }
      _sphere.copy(p.sphere).applyMatrix4(ctx.bodyToWorld);
      if (!ctx.frustum.intersectsSphere(_sphere)) { p.split = false; return true; }
      const d = this.boundDistance(p, cam, rc);
      // silhouette-aware: a patch seen edge-on (the limb from orbit, the horizon from the ground) shows its geometric
      // error as a straight-segmented outline, so it splits up to 3.5× earlier (cubic in the grazing: only patches
      // near the silhouette pay for it, not the whole disc). The vertex shader scales the morph
      // distance by the same factor per vertex (TERRAIN_VERT_CORE), so the geomorph still lands where the coarser
      // neighbour begins
      _pc.copy(p.centerDir).multiplyScalar(this.radius + 0.5 * (p.hMin + p.hMax)).sub(cam);
      const pcl = _pc.length();
      const facing = pcl > 1e-3 ? Math.abs(p.centerDir.dot(_pc) / pcl) : 1;
      const graze = 1 - facing;
      const sil = 1 + this.silK * graze * graze * graze;
      const rSplit = ctx.K * this.size(p.level) * (p.split ? 1.12 : 1.0) * sil;
      let split = p.level < this.maxLevel && d < rSplit;
      if (this.port) {
        // WORKER PATH: the split decisions need only the bounds, so the whole tree the view wants is walked (and its
        // missing leaves asked for) in this frame; a subtree draws when every part of it is covered by built patches,
        // else the nearest built ancestor draws in its place (never a parent with partial children). Converges to
        // the selection the main-thread path makes, in the few frames the workers take.
        if (split) {
          const kids = p.makeChildren();
          const mark = out.length;
          let all = true;
          for (const k of kids) if (!visit(k)) all = false;
          if (all) { p.split = true; return true; }
          out.length = mark;
        }
        p.split = false;
        // PREFETCH (no pop-in): a leaf the camera is closing in on (within 1.35x its split distance) has its children
        // built ahead, so the split finds them ready instead of drawing the coarse patch until they land
        // (PERF s17, `?prefetchkeep=0` off) a prefetched child already built is IN USE (stamped: the eviction keeps it),
        // and a new one is asked for only while the cache has room for it. Unstamped, the prefetched children were the
        // eviction's first victims once the cache was full and the next frame asked for them again: at rest, with the
        // camera still, 40-100 patches a frame built, landed and evicted forever (the babel town on the low preset)
        if (!split && p.built && p.level < this.maxLevel && d < rSplit * 1.35) {
          if (PREFETCH_KEEP) {
            for (const k of p.makeChildren()) {
              if (k.built) { k.lastUsed = ctx.frame; continue; }
              if (this.pending.size < MAX_INFLIGHT / 2 && this.live.size + this.pending.size < this.cacheBudget()) this.ensureGeometry(k, true);
            }
          } else if (this.pending.size < MAX_INFLIGHT / 2) for (const k of p.makeChildren()) this.ensureGeometry(k, true);
        }
        if (p.built) { out.push(p); return true; }
        if (p.level <= 1) { this.ensureGeometry(p, false); out.push(p); return true; }
        if (!split) this.ensureGeometry(p, true);
        return false;
      }
      if (split) {
        const kids = p.makeChildren();
        // split only when every child can be drawn this frame (never mix a parent with partial children)
        for (const k of kids) if (!this.ensureGeometry(k, true)) { split = false; break; }
      }
      if (split) {
        p.split = true;
        for (const k of p.children!) visit(k);
      } else {
        p.split = false;
        if (this.ensureGeometry(p, p.level > 1)) out.push(p);
        else if (p.level <= 1) out.push(p);
      }
      return true;
    };
    for (const r of this.roots) visit(r);
    // visibility per batch slot: last frame's patches off, this frame's on (a patch that turned wet since it was
    // built takes a water slot now, copied from its terrain slot; one that dried keeps its slot, hidden)
    for (const p of this.selected) this.showPatch(p, false, false);
    let water = 0;
    for (const p of out) {
      p.lastUsed = ctx.frame;
      if (!p.built) continue;
      const wet = this.waterEnabled && p.hasWater;
      if (wet && p.wSlot < 0 && !WATER_SHARE) {
        const geo = this.batch(p.level, false).extract(p.tSlot);
        p.wSlot = this.batch(p.level, true).alloc(geo);
      }
      this.showPatch(p, true, wet);
      if (wet) water++;
    }
    this.selected = out;
    this.stats.patches = out.length;
    this.stats.waterPatches = water;
    this.evict(ctx.frame);
    return out;
  }

  /**
   * The lowest ground (m relative to the radius: min hMin) of the selected patches meeting a sphere (body frame) —
   * the lowest receiver of a shadow cascade (shadowreach.ts). +Infinity when none meets it.
   */
  groundFloorNear(cx: number, cy: number, cz: number, r: number, camBody?: Vector3, viewDirBody?: Vector3, nearSplit = 0): number {
    let lo = Infinity;
    for (const p of this.selected) {
      const c = p.sphere.center;
      // (only ground at least partly beyond the previous split can hold a pixel that reads this cascade)
      if (nearSplit > 0 && camBody && viewDirBody
        && (c.x - camBody.x) * viewDirBody.x + (c.y - camBody.y) * viewDirBody.y + (c.z - camBody.z) * viewDirBody.z + p.sphere.radius < nearSplit) continue;
      const rr = p.sphere.radius + r;
      const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
      if (dx * dx + dy * dy + dz * dz <= rr * rr && p.hMin < lo) lo = p.hMin;
    }
    return lo;
  }

  /**
   * Shadow cascade k (lights.ts perCascade): draw only the selected patches that can throw a shadow onto a pixel
   * reading this cascade. k < 0 restores every selected patch.
   *  - in the cascade's light box (the batch is drawn whole: three's per-object culling did this for separate meshes);
   *  - PERF F11: within shadow REACH of the cascade's sphere (`reach`: centre / radius in the body frame, the sun's
   *    elevation at the camera, the planet radius): the patch's top above the lowest ground near the cascade
   *    (`floor`, groundFloorNear) sets how far its shadow can run (shadowreach.ts; a low sun: everything, so a
   *    mountain's evening shadow stays);
   *  - not wholly nearer (view depth) than `nearSplit` less that reach and its height: those shadows fall on pixels
   *    that read a finer cascade. (Was a fixed 40 m-relief margin capped at 450 m: a taller ridge at a low sun lost
   *    the part of its shadow beyond it in the far cascades.)
   */
  shadowCascade(k: number, camBody: Vector3, viewDirBody: Vector3, nearSplit: number, cascade?: Frustum, bodyToWorld?: Matrix4,
    reach?: { cx: number; cy: number; cz: number; r: number; el0: number; floor: number; legacy?: boolean }): number {
    let drawn = 0;
    const margin = reach ? 4 + 0.02 * reach.r : 0;
    for (const p of this.selected) {
      if (!p.built) continue;
      const tb = this.tBatch[p.level]!;
      if (k < 0) { tb.show(p.tSlot, true); drawn++; continue; }
      let on = true;
      let run = Infinity;
      const c = p.sphere.center;
      if (reach && Number.isFinite(reach.floor)) {
        const e = p.hMax - reach.floor;
        const d0 = (Math.hypot(c.x - camBody.x, c.y - camBody.y, c.z - camBody.z) + p.sphere.radius) * 1.05;
        run = shadowReach(e, reach.el0, d0, this.radius, margin);
        if (Number.isFinite(run)) {
          on = capGap(p.centerDir.x, p.centerDir.y, p.centerDir.z, p.angRadius, reach.cx, reach.cy, reach.cz, reach.r, this.radius + reach.floor) <= run;
          run += Math.max(0, e) + margin;
        }
      }
      if (reach?.legacy) run = 0;
      if (on && nearSplit > 0 && Number.isFinite(run)) {
        const depthMax = (c.x - camBody.x) * viewDirBody.x + (c.y - camBody.y) * viewDirBody.y + (c.z - camBody.z) * viewDirBody.z + p.sphere.radius;
        on = depthMax >= nearSplit - run;
      }
      if (on && cascade && bodyToWorld) on = cascade.intersectsSphere(_sphere.copy(p.sphere).applyMatrix4(bodyToWorld));
      tb.show(p.tSlot, on);
      if (on) drawn++;
    }
    return drawn;
  }

  private showPatch(p: Patch, on: boolean, water: boolean): void {
    if (!p.built) return;
    this.tBatch[p.level]?.show(p.tSlot, on);
    if (WATER_SHARE) this.tBatch[p.level]?.showWater(p.tSlot, on && water);
    else if (p.wSlot >= 0) this.wBatch[p.level]?.show(p.wSlot, on && water);
  }

  /** draw counts of the batches (logical draws: one per non-empty level batch per pass) */
  batchStats(): { terrain: number; water: number } {
    let t = 0, w = 0;
    for (const b of this.tBatch) if (b && b.visible) t++;
    for (const b of this.wBatch) if (b && b.visible) w++;
    if (WATER_SHARE) for (const b of this.tBatch) if (b && b.waterVisible) w++;
    return { terrain: t, water: w };
  }

  /** drop geometry of long-unused patches when over the cache budget */
  /** the patch cache's soft budget: what the eviction trims to (patches in use this frame always stay) */
  private cacheBudget(): number { return Math.max(this.maxCached, Math.ceil(this.selected.length * 1.5)); }

  private evict(frame: number): void {
    const budget = this.cacheBudget();
    if (this.live.size <= budget) return;
    // least recently used first, anything not in use this frame. (It once also had to be 120 frames old: at the few
    // frames a minute of a starved software renderer nothing ever qualified, and the cache grew past its budget for
    // the whole session — 2,000+ patches, ~250 MB of CPU attribute copies plus their GPU mirrors, in 9 minutes.)
    const cands = [...this.live].filter((p) => p.lastUsed < frame && p.level > 1).sort((a, b) => a.lastUsed - b.lastUsed);
    const drop = this.live.size - budget + 64;
    for (let i = 0; i < Math.min(drop, cands.length); i++) {
      const p = cands[i];
      this.tBatch[p.level]?.release(p.tSlot);
      if (p.wSlot >= 0) this.wBatch[p.level]?.release(p.wSlot);
      p.tSlot = -1; p.wSlot = -1; p.built = false; p.mesh = null;
      this.live.delete(p);
    }
    this.shrinkPools();
  }

  /** morph distances for a level: (full-morph distance, morph start) — infinity for level 0 */
  morphRange(level: number, K: number): [number, number] {
    if (level === 0) return [1e30, 1e30];
    const r = K * this.size(level - 1);
    return [r, r * 0.72];
  }

  dispose(): void {
    if (this.port) { this.port.unlisten(this.lodId); this.port.send({ k: 'drop', id: this.lodId }); this.port = null; }
    for (const p of this.pending.values()) p.pendingSeq = -1;
    this.pending.clear();
    this.ready = [];
    for (const p of this.live) { p.built = false; p.mesh = null; p.tSlot = -1; p.wSlot = -1; }
    for (const b of [...this.tBatch, ...this.wBatch]) {
      if (!b) continue;
      b.dispose();
    }
    this.tBatch = [];
    this.wBatch = [];
    this.pagePool.dispose();
    this.live.clear();
  }
}

const _sphere = new Sphere();
