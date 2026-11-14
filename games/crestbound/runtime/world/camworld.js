/**
 * CRESTBOUND — runtime/world/camworld.js
 * ---------------------------------------------------------------------------
 * A CAMERA-ONLY Rapier world: the course's STATIC collision mirrored so the
 * follow camera can sweep a real sphere (Rapier `castShape` with a ball) from
 * the focus to the lens, the way DYEFIELD's camera does
 * (dyefield/runtime/src/core/physics.ts `sphereCast`, view/camera.ts).
 *
 * WHAT IS MIRRORED, AND WHAT IS NOT
 *   - every SOLID broadphase box in group 'world' (course slabs, walls, stairs,
 *     props with colliders, race pads) — a Rapier cuboid with the same centre,
 *     orientation and half extents, collision group G_BOX;
 *   - every terrain Heightfield — a Rapier heightfield over the SAME samples
 *     (verified in Node against 0.20.0: nrows = nz-1, ncols = nx-1, heights
 *     column-major `h[ix * nz + iz]`, scale (sizeX, 1, sizeZ), translated to the
 *     footprint centre; castRay returns the exact bilinear value at every node
 *     and along every cell edge), group G_TERRAIN.
 *   - NOT hazards (movers, rotors, crushers, mills, vanish pads, breakables),
 *     critters, triggers, or the camera's own drawn-body occluders: those move
 *     or come and go, and stay on the camera's existing rays.
 *   The PLAYER'S collision is untouched — this world is read by the camera only.
 *
 * LIFECYCLE
 *   `loadRapier()` fetches the vendored compat build (assets/vendor/rapier/
 *   rapier.mjs, 0.20.0, the wasm inlined as base64 — no bundler, no second
 *   fetch) with a dynamic import and runs `init()` ONCE per page. It is never on
 *   the boot path: the camera asks for it only after gameplay has rendered.
 *   `CamWorld.sync(bp)` is called by the camera every frame. It notices a new
 *   broadphase (course change) and rebuilds INCREMENTALLY under a per-frame time
 *   budget, so a course with thousands of boxes never stalls a frame; until the
 *   build is complete `ready` is false and the camera keeps its whisker rays.
 *   Once ready it watches the mirrored set: a box added to or removed from the
 *   broadphase, switched off, or moved is mirrored within the frame (a box that
 *   keeps moving is demoted to the ray path), then the query BVH is refreshed.
 *
 * QUERIES are allocation-free on our side: the sweep calls the raw wasm
 * broadphase with persistent RawVector / RawRotation / RawShape objects and
 * reads the hit through one scratch Float32Array. (Rapier's public
 * `World.castShape` converts every argument and the shape on every call —
 * measured in Node: 5000 casts 307-884 ms public vs 43.5 ms raw.) The one
 * allocation left is inside the wasm binding: a hit is returned as one small
 * wrapper object, which we free immediately.
 */

const RAPIER_URL = new URL('../../assets/vendor/rapier/rapier.mjs', import.meta.url).href;

/** Collision groups: boxes and terrain, so a sweep can leave the terrain out. */
export const G_BOX = 1;
export const G_TERRAIN = 2;
const groups = (member, filter) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
const Q_GROUPS = [0, groups(0xffff, 1), groups(0xffff, 2), groups(0xffff, 3)];

// incremental build budget (ms of main-thread time per frame)
const BUILD_BUDGET_MS = 3.0;
// a mirrored box that changes pose on this many consecutive frames is a mover
// in disguise: demote it to the ray path instead of re-stepping every frame
const MOVE_DEMOTE_FRAMES = 3;
// heightfields bigger than this are skipped (they stay on the rays)
const HF_MAX_SAMPLES = 400000;

/* ───────────────────────────── the loader ───────────────────────────── */

let _R = null;
let _promise = null;
let _state = 'idle';            // 'idle' | 'loading' | 'ready' | 'failed'
let _err = null;
const _times = { start: -1, ready: -1 };

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** Load + init Rapier once per page. Resolves to the namespace, or null on failure. */
export function loadRapier() {
  if (_promise) return _promise;
  _state = 'loading';
  _times.start = now();
  _promise = import(RAPIER_URL)
    .then(async (m) => {
      const R = (m && m.default && typeof m.default.init === 'function') ? m.default : m;
      await R.init();
      // Pre-grow the wasm heap once, here, so the per-course build never pays a
      // memory.grow + copy mid-game (measured in Node: single inserts of 200+ ms
      // when the heap grew during a 3000-box build).
      try { if (typeof R.reserveMemory === 'function') R.reserveMemory(16 * 1024 * 1024); } catch (e) { /* optional */ }
      _R = R;
      _state = 'ready';
      _times.ready = now();
      return R;
    })
    .catch((e) => {
      _state = 'failed';
      _err = String(e && e.message || e);
      console.warn('[camworld] Rapier did not load; the camera stays on its rays:', _err);
      return null;
    });
  return _promise;
}

/** Loader status, for the harnesses. */
export function rapierStatus() {
  return { state: _state, error: _err, startMs: _times.start, readyMs: _times.ready };
}

/* ───────────────────────────── the world ───────────────────────────── */

/** A box the camera may treat as static geometry. */
function staticBox(c) {
  if (!c || c.solid === false) return false;
  const g = c.group;
  if (g !== undefined && g !== 'world') return false;
  if (!c.half || !c.center || !c.quat) return false;
  if (typeof c.isMoving === 'function' && c.isMoving()) return false;
  return true;
}

export class CamWorld {
  constructor() {
    this.R = null;
    this.world = null;
    /** the broadphase this world mirrors */
    this.bp = null;
    /** true once the mirror is complete and queryable */
    this.ready = false;
    /** true after an unrecoverable query error: the camera must use its rays */
    this.failed = false;

    // mirrored boxes: parallel arrays indexed by record slot
    this._boxC = [];          // Collider
    this._boxR = [];          // Rapier collider wrapper
    this._boxSnap = new Float64Array(0);   // 11 doubles per slot: active, c(3), q(4), h(3)
    this._boxMove = new Uint8Array(0);     // consecutive frames with a pose change
    this._boxN = 0;
    // mirrored heightfields
    this._hfC = [];
    this._hfR = [];
    this._hfActive = [];
    /** rapier handle -> record: >= 0 box slot, < 0 -(hf index + 1) */
    this._byHandle = new Map();
    /** Collider.id -> 1 when mirrored (ids are monotonic ints) */
    this._mirror = new Uint8Array(0);
    /** Collider.id -> 1 when demoted to the rays (a 'world' box that keeps moving) */
    this._demoted = new Uint8Array(0);
    this._hfSkipped = 0;
    /** heightfields the build has taken from the broadphase (mirrored, skipped or unusable) */
    this._hfSeen = 0;

    // build queue
    this._queue = [];
    this._qi = 0;
    this._hfQueue = [];
    this._dirty = false;
    this._sigN = -1;
    this._sigSum = -1;

    // raw query objects (created with the world)
    this._rPos = null; this._rVel = null; this._rRot = null;
    this._shapes = new Map();          // radius mm -> RawShape
    this._sb = new Float32Array(16);
    this._bpr = null; this._npr = null; this._bor = null; this._cor = null;

    /** last sweep hit (valid when sweep() returned >= 0) */
    this.hit = { toi: 0, nx: 0, ny: 0, nz: 0, handle: 0, box: null, hf: null };

    /** harness read-back */
    this.stats = { builds: 0, boxes: 0, heightfields: 0, buildMs: 0, buildFrames: 0, worstBuildFrameMs: 0,
                   adds: 0, removes: 0, moves: 0, toggles: 0, demoted: 0, steps: 0, sweeps: 0, errors: 0,
                   readyAtMs: -1, lastSyncMs: 0 };
    this._buildT0 = 0;
  }

  /** Is this broadphase box mirrored (i.e. answered by the sweep, not the rays)? */
  isMirrored(c) {
    const id = c.id;
    return id >= 0 && id < this._mirror.length && this._mirror[id] === 1;
  }

  /** Are the heightfields mirrored? (always, once ready — unless one was too big) */
  get terrainMirrored() { return this.ready && this._hfSkipped === 0; }

  /**
   * Track the live broadphase. Call once per camera update (cheap when nothing
   * changed). Starts the Rapier load the first time it is asked.
   */
  sync(bp) {
    if (this.failed) return;
    if (!_R) { if (_state === 'idle') loadRapier(); return; }
    const t0 = now();
    if (bp !== this.bp) this._reset(bp);
    if (!this.bp) return;
    if (!this.ready) this._buildStep(t0);
    else this._watch();
    if (this._dirty && this.world) {
      this.world.step();                 // Rapier 0.20 refreshes its query BVH on a step
      this._dirty = false;
      this.stats.steps++;
    }
    this.stats.lastSyncMs = now() - t0;
  }

  _reset(bp) {
    this._free();
    this.bp = bp || null;
    this.ready = false;
    if (!this.bp || !_R) return;
    const R = _R;
    this.R = R;
    this.world = new R.World({ x: 0, y: 0, z: 0 });
    this._bpr = this.world.broadPhase.raw;
    this._npr = this.world.narrowPhase.raw;
    this._bor = this.world.bodies.raw;
    this._cor = this.world.colliders.raw;
    const rv = R.VectorOps.intoRaw({ x: 0, y: 0, z: 0 });
    const RawVector = rv.constructor;
    this._rPos = rv;
    this._rVel = new RawVector(0, 0, -1);
    this._rRot = R.RotationOps.intoRaw({ x: 0, y: 0, z: 0, w: 1 });
    // queue every candidate now (one pass), build under the budget over frames
    const items = this.bp.items || [];
    this._queue.length = 0;
    for (let i = 0; i < items.length; i++) if (staticBox(items[i])) this._queue.push(items[i]);
    this._qi = 0;
    this._hfQueue.length = 0;
    const hfs = this.bp.heightfields || [];
    for (let i = 0; i < hfs.length; i++) this._hfQueue.push(hfs[i]);
    this._hfSkipped = 0;
    this._hfSeen = hfs.length;
    let maxId = 0;
    for (let i = 0; i < items.length; i++) if (items[i] && items[i].id > maxId) maxId = items[i].id;
    this._mirror = new Uint8Array(maxId + 1024);
    this._demoted = new Uint8Array(maxId + 1024);
    this._boxSnap = new Float64Array(Math.max(64, this._queue.length + 256) * 11);
    this._boxMove = new Uint8Array(Math.max(64, this._queue.length + 256));
    this.stats.builds++;
    this.stats.buildFrames = 0;
    this.stats.worstBuildFrameMs = 0;
    this.stats.buildMs = 0;
    this._buildT0 = now();
  }

  _free() {
    if (this.world) { try { this.world.free(); } catch (e) { /* already gone */ } }
    this.world = null;
    this._boxC.length = 0; this._boxR.length = 0; this._boxN = 0;
    this._hfC.length = 0; this._hfR.length = 0; this._hfActive.length = 0;
    this._byHandle.clear();
    // raw shapes belong to no world; keep the cache across courses
    if (this._rPos) { try { this._rPos.free(); this._rVel.free(); this._rRot.free(); } catch (e) { /* no-op */ } }
    this._rPos = this._rVel = this._rRot = null;
    this._bpr = this._npr = this._bor = this._cor = null;
    this.ready = false;
  }

  _buildStep(t0) {
    const q = this._queue;
    // heightfields first (few, each one call)
    while (this._hfQueue.length) {
      this._addHeightfield(this._hfQueue.pop());
      if (now() - t0 > BUILD_BUDGET_MS) break;
    }
    while (this._qi < q.length && now() - t0 <= BUILD_BUDGET_MS) {
      const c = q[this._qi++];
      if (c && c._bp === this.bp) this._addBox(c);
    }
    const dt = now() - t0;
    this.stats.buildFrames++;
    if (dt > this.stats.worstBuildFrameMs) this.stats.worstBuildFrameMs = dt;
    if (this._qi >= q.length && !this._hfQueue.length) {
      q.length = 0; this._qi = 0;
      this.world.step();
      this._dirty = false;
      this.stats.steps++;
      this._signature();
      this.ready = true;
      this.stats.buildMs = now() - this._buildT0;
      this.stats.readyAtMs = now();
      this.stats.boxes = this._boxN;
      this.stats.heightfields = this._hfC.length;
    }
  }

  _ensureSlots(n) {
    if (n * 11 > this._boxSnap.length) {
      const s = new Float64Array(n * 22); s.set(this._boxSnap); this._boxSnap = s;
      const m = new Uint8Array(n * 2); m.set(this._boxMove); this._boxMove = m;
    }
  }

  _ensureMirror(id) {
    if (id < this._mirror.length) return;
    const m = new Uint8Array(id * 2 + 1024); m.set(this._mirror); this._mirror = m;
    const d = new Uint8Array(id * 2 + 1024); d.set(this._demoted); this._demoted = d;
  }

  _snapBox(slot, c) {
    const s = this._boxSnap, k = slot * 11;
    s[k] = c.active === false ? 0 : 1;
    s[k + 1] = c.center.x; s[k + 2] = c.center.y; s[k + 3] = c.center.z;
    s[k + 4] = c.quat.x; s[k + 5] = c.quat.y; s[k + 6] = c.quat.z; s[k + 7] = c.quat.w;
    s[k + 8] = c.half.x; s[k + 9] = c.half.y; s[k + 10] = c.half.z;
  }

  _addBox(c) {
    const R = this.R;
    const h = c.half;
    const desc = R.ColliderDesc.cuboid(Math.max(1e-3, h.x), Math.max(1e-3, h.y), Math.max(1e-3, h.z))
      .setTranslation(c.center.x, c.center.y, c.center.z)
      .setRotation({ x: c.quat.x, y: c.quat.y, z: c.quat.z, w: c.quat.w })
      .setCollisionGroups(groups(G_BOX, 0xffff))
      .setEnabled(c.active !== false);
    const rc = this.world.createCollider(desc);
    const slot = this._boxN++;
    this._ensureSlots(this._boxN);
    this._boxC[slot] = c;
    this._boxR[slot] = rc;
    this._snapBox(slot, c);
    this._boxMove[slot] = 0;
    this._byHandle.set(rc.handle, slot);
    this._ensureMirror(c.id);
    this._mirror[c.id] = 1;
    this._dirty = true;
  }

  _removeSlot(slot) {
    const c = this._boxC[slot], rc = this._boxR[slot];
    if (rc) { this._byHandle.delete(rc.handle); try { this.world.removeCollider(rc, false); } catch (e) { /* gone */ } }
    if (c && c.id < this._mirror.length) this._mirror[c.id] = 0;
    // swap-remove, keeping the snapshot rows in step
    const last = this._boxN - 1;
    if (slot !== last) {
      this._boxC[slot] = this._boxC[last];
      this._boxR[slot] = this._boxR[last];
      this._boxSnap.copyWithin(slot * 11, last * 11, last * 11 + 11);
      this._boxMove[slot] = this._boxMove[last];
      this._byHandle.set(this._boxR[slot].handle, slot);
    }
    this._boxC.length = last; this._boxR.length = last;
    this._boxN = last;
    this._dirty = true;
  }

  _addHeightfield(hf) {
    if (!hf || !(hf.nx >= 2) || !(hf.nz >= 2) || !hf.heights) { this._hfSkipped++; return; }
    const nx = hf.nx, nz = hf.nz;
    if (nx * nz > HF_MAX_SAMPLES) { this._hfSkipped++; return; }
    const src = hf.heights;
    const col = new Float32Array(nx * nz);          // build-time allocation (once per course)
    for (let iz = 0; iz < nz; iz++) {
      const row = iz * nx;
      for (let ix = 0; ix < nx; ix++) { const v = src[row + ix]; col[ix * nz + iz] = v === v ? v : -1000; }
    }
    const R = this.R;
    const desc = R.ColliderDesc.heightfield(nz - 1, nx - 1, col, { x: hf.sizeX, y: 1, z: hf.sizeZ })
      .setTranslation(hf.originX + hf.sizeX * 0.5, 0, hf.originZ + hf.sizeZ * 0.5)
      .setCollisionGroups(groups(G_TERRAIN, 0xffff))
      .setEnabled(hf.active !== false);
    const rc = this.world.createCollider(desc);
    const i = this._hfC.length;
    this._hfC.push(hf);
    this._hfR.push(rc);
    this._hfActive.push(hf.active !== false);
    this._byHandle.set(rc.handle, -(i + 1));
    this._dirty = true;
  }

  /** count + id sum of the broadphase: changes on any add / remove / swap. */
  _signature() {
    const items = this.bp.items || [];
    let s = 0;
    for (let i = 0; i < items.length; i++) s += items[i].id;
    const changed = items.length !== this._sigN || s !== this._sigSum;
    this._sigN = items.length; this._sigSum = s;
    return changed;
  }

  _watch() {
    // 0. a heightfield added to (or dropped from) the broadphase after the build
    //    is not something the incremental watch can patch: rebuild. Until the
    //    rebuild completes the camera is on its rays, which read the live set.
    const hfs = this.bp.heightfields;
    if ((hfs ? hfs.length : 0) !== this._hfSeen) { this._reset(this.bp); return; }
    // 1. membership: new static boxes in, departed ones out
    if (this._signature()) {
      for (let slot = this._boxN - 1; slot >= 0; slot--) {
        if (this._boxC[slot]._bp !== this.bp) { this._removeSlot(slot); this.stats.removes++; }
      }
      const items = this.bp.items || [];
      for (let i = 0; i < items.length; i++) {
        const c = items[i];
        if (!this.isMirrored(c) && !(c.id < this._demoted.length && this._demoted[c.id] === 1) && staticBox(c)) {
          this._addBox(c); this.stats.adds++;
        }
      }
    }
    // 2. mirrored boxes that changed: active flag, pose, size
    const s = this._boxSnap;
    for (let slot = this._boxN - 1; slot >= 0; slot--) {
      const c = this._boxC[slot], k = slot * 11;
      const act = c.active === false ? 0 : 1;
      if (act !== s[k]) {
        s[k] = act;
        this._boxR[slot].setEnabled(act === 1);
        this._dirty = true;
        this.stats.toggles++;
      }
      const ce = c.center, qu = c.quat, ha = c.half;
      if (ce.x !== s[k + 1] || ce.y !== s[k + 2] || ce.z !== s[k + 3] ||
          qu.x !== s[k + 4] || qu.y !== s[k + 5] || qu.z !== s[k + 6] || qu.w !== s[k + 7] ||
          ha.x !== s[k + 8] || ha.y !== s[k + 9] || ha.z !== s[k + 10]) {
        if (++this._boxMove[slot] >= MOVE_DEMOTE_FRAMES) {
          // a box that keeps moving belongs to the rays (they read it live)
          if (c.id < this._demoted.length) this._demoted[c.id] = 1;
          this._removeSlot(slot);
          this.stats.demoted++;
          continue;
        }
        const rc = this._boxR[slot];
        rc.setTranslation({ x: ce.x, y: ce.y, z: ce.z });
        rc.setRotation({ x: qu.x, y: qu.y, z: qu.z, w: qu.w });
        if (ha.x !== s[k + 8] || ha.y !== s[k + 9] || ha.z !== s[k + 10]) {
          rc.setHalfExtents({ x: Math.max(1e-3, ha.x), y: Math.max(1e-3, ha.y), z: Math.max(1e-3, ha.z) });
        }
        this._snapBox(slot, c);
        this._dirty = true;
        this.stats.moves++;
      } else if (this._boxMove[slot]) this._boxMove[slot] = 0;
    }
    // 3. heightfields switched on/off
    for (let i = 0; i < this._hfC.length; i++) {
      const a = this._hfC[i].active !== false;
      if (a !== this._hfActive[i]) { this._hfActive[i] = a; this._hfR[i].setEnabled(a); this._dirty = true; this.stats.toggles++; }
    }
  }

  _shape(radius) {
    const key = Math.round(radius * 1000);
    let s = this._shapes.get(key);
    if (!s) {
      const ball = new this.R.Ball(key / 1000);
      s = ball.intoRaw();
      this._shapes.set(key, s);
    }
    return s;
  }

  /**
   * Sweep a ball of `radius` from (ox,oy,oz) along the UNIT direction (dx,dy,dz)
   * for at most `maxD` metres against the mirrored static set.
   * `mask` = G_BOX | G_TERRAIN (default both); `exclude` = a Rapier handle to skip.
   * Returns the distance the CENTRE travels before contact (>= 0), or -1 when
   * nothing is hit. A start that already penetrates something and does not
   * leave it along this direction returns 0 (Rapier `stopAtPenetration=false`).
   * On a hit, `this.hit` holds the surface normal (world), the handle and the
   * mirrored source (`box` Collider or `hf` Heightfield).
   */
  sweep(ox, oy, oz, dx, dy, dz, radius, maxD, mask, exclude) {
    if (!this.ready || this.failed || !(maxD > 0) || !(radius > 0)) return -1;
    const p = this._rPos, v = this._rVel;
    p.x = ox; p.y = oy; p.z = oz;
    v.x = dx; v.y = dy; v.z = dz;
    const g = Q_GROUPS[(mask === undefined ? 3 : mask) & 3] || Q_GROUPS[3];
    let h;
    try {
      h = this._bpr.castShape(this._npr, this._bor, this._cor, p, this._rRot, v, this._shape(radius),
        0, maxD, false, 0, g, exclude === undefined || exclude === null ? undefined : exclude, undefined, undefined);
    } catch (e) {
      this.stats.errors++;
      if (this.stats.errors > 3) { this.failed = true; console.warn('[camworld] sweep failed; the camera falls back to rays:', e); }
      return -1;
    }
    this.stats.sweeps++;
    if (!h) return -1;
    const sb = this._sb;
    h.getComponents(sb);
    const handle = h.colliderHandle();
    h.free();
    const hit = this.hit;
    hit.toi = sb[0];
    hit.nx = sb[7]; hit.ny = sb[8]; hit.nz = sb[9];
    hit.handle = handle;
    const r = this._byHandle.get(handle);
    hit.box = r !== undefined && r >= 0 ? this._boxC[r] : null;
    hit.hf = r !== undefined && r < 0 ? this._hfC[-r - 1] : null;
    return sb[0];
  }

  /** Harness read-back. */
  info() {
    return Object.assign({ ready: this.ready, failed: this.failed, boxes: this._boxN, heightfields: this._hfC.length,
                           hfSkipped: this._hfSkipped || 0, loader: rapierStatus() }, this.stats);
  }

  dispose() {
    this._free();
    for (const s of this._shapes.values()) { try { s.free(); } catch (e) { /* no-op */ } }
    this._shapes.clear();
    this.bp = null;
  }
}

export default CamWorld;
