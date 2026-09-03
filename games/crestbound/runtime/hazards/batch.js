// runtime/hazards/batch.js
// CRESTBOUND — the hazard DRAW BATCHER.
//
// WHY THIS EXISTS
// ---------------
// three.js issues ONE DRAW PER GEOMETRY GROUP. A hazard that already merges its parts per
// material is therefore still one draw per material per hazard, and a course with eight hoops,
// five crates, two sinkers and a four-armed mill pays that toll once per object. Measured on
// verdant-1 (2026-09-03, `_harness/drawprobe.py`, spawn frame): 97 of the frame's 413 draws
// were hazards — rings 36, breakable 20, mill 18, sinker 12, jumppad 7, current 4.
//
// The fix is NOT "use fewer materials" (that is deleting art to win a number, which the
// CONTRACT forbids). It is to stop issuing one draw per object:
//
//   * `THREE.BatchedMesh` (r172) packs MANY DIFFERENT geometries that share ONE material into a
//     single buffer and draws them with `WEBGL_multi_draw` — verified present on this machine's
//     ANGLE/D3D11 context, so this is one real `multiDrawElementsWEBGL` call, not a loop.
//     Per-instance matrices, per-instance colour and per-instance visibility and frustum
//     culling all survive, and `materials.js` already mirrors `USE_BATCHING` in its world-space
//     box projection, so a batched part textures exactly as the loose mesh did.
//   * Every additive READABILITY overlay in the course — stripes, halos, warning rings, crack
//     lines, index bands, glow sprites — lands in ONE batch with a two-cell texture atlas
//     (white / radial glow). Additive blending is order independent, so the batch needs no
//     sort and `forceSinglePass` costs nothing (a transparent DoubleSide material is otherwise
//     drawn TWICE by three, which is where 7 of the ring hoops' 36 draws came from).
//
// WHAT IT DOES NOT CHANGE
// -----------------------
// Nothing here touches hazard STATE. Colliders, kill volumes, `onStand`/`onPound`, and the
// DETERMINISM LAW (state is a pure function of the course clock `t` and `def`; `reset(t)`
// places exactly where `update(t)` would) are untouched: a batch part is written from the same
// numbers that used to be written to `mesh.position`.
//
// LIFETIME
// --------
// One batch set per COURSE, keyed off `ctx.course` (every hazard of a course gets a fresh ctx
// literal but the same `course`/`group`). Hazards `retain()` on construction and `release()` on
// dispose; the last one out disposes the batches. A ctx with no course (a bare harness) still
// works — it just gets a batch set of its own.

import * as THREE from 'three';

/* ================================================================================================
   REGISTRY
   ================================================================================================ */

const _sets = new WeakMap();

/**
 * The batch set for this hazard's course. Returns null only if `ctx` is not an object, in which
 * case callers must keep their loose meshes.
 * @param {object} ctx hazard context (CONTRACT §21 / course.js `_hazardCtx`)
 * @returns {HazBatchSet|null}
 */
export function hazBatch(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const key = ctx.course || ctx.group || ctx;
  let s = _sets.get(key);
  if (!s || s.disposed) { s = new HazBatchSet(ctx, key); _sets.set(key, s); }
  return s;
}

/* ================================================================================================
   GEOMETRY NORMALISATION

   Every geometry in one BatchedMesh must carry the SAME attribute set (three validates it), so
   each part is rewritten to exactly {position, normal, uv[, color]} + an index. `mergeAll()`
   hands back NON-indexed geometry and the primitives hand back indexed ones, so both directions
   have to be covered.
   ================================================================================================ */


/**
 * A copy of `src` with exactly the batch attribute set and an index.
 * `src` is left untouched (the caller may still own it).
 */
export function prepBatchGeometry(src, wantColor) {
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  if (!pos) return null;
  g.setAttribute('position', pos.clone());

  let nrm = src.getAttribute('normal');
  if (!nrm) {
    // computeVertexNormals needs the attributes in place first
    g.setIndex(src.getIndex() ? src.getIndex().clone() : null);
    g.computeVertexNormals();
    nrm = g.getAttribute('normal');
  } else {
    g.setAttribute('normal', nrm.clone());
  }

  const uv = src.getAttribute('uv');
  if (uv && uv.itemSize === 2) g.setAttribute('uv', uv.clone());
  else g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));

  if (wantColor) {
    const c = new Float32Array(pos.count * 3);
    c.fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }

  const idx = src.getIndex();
  if (idx) {
    g.setIndex(idx.clone());
  } else {
    const n = pos.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    g.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Split a geometry that carries material `groups` into one standalone geometry per group.
 * Used for builder output (a hoop is authored as one mesh with a copper group and an emissive
 * group) so each group can join the batch that owns its material.
 * @returns {Array<{geometry:THREE.BufferGeometry, materialIndex:number}>}
 */
export function splitGeometryGroups(src) {
  const out = [];
  const groups = src.groups;
  if (!groups || groups.length < 2) {
    out.push({ geometry: src, materialIndex: (groups && groups[0] ? groups[0].materialIndex : 0) | 0 });
    return out;
  }
  const idx = src.getIndex();
  const vcount = src.getAttribute('position') ? src.getAttribute('position').count : 0;
  for (let i = 0; i < groups.length; i++) {
    const gr = groups[i];
    const g = new THREE.BufferGeometry();
    if (idx) {
      // Indexed: keep the shared vertex pool, take only this group's slice of the index.
      for (const name in src.attributes) g.setAttribute(name, src.attributes[name]);   // read-only
      const count = gr.count === Infinity ? idx.count - gr.start : gr.count;
      g.setIndex(new THREE.BufferAttribute(idx.array.slice(gr.start, gr.start + count), 1));
    } else {
      /* NON-indexed (what `mergeAll` produces): the group is a VERTEX range, and a drawRange
         would be lost the moment the part is copied into a batch — so the range is
         materialised here. Getting this wrong silently draws every group's triangles for every
         group, which is exactly how the ring chain came back at 2x its triangle count. */
      const count = gr.count === Infinity ? vcount - gr.start : gr.count;
      for (const name in src.attributes) {
        const a = src.attributes[name];
        const n = a.itemSize;
        g.setAttribute(name, new THREE.BufferAttribute(
          a.array.slice(gr.start * n, (gr.start + count) * n), n, a.normalized));
      }
    }
    out.push({ geometry: g, materialIndex: gr.materialIndex | 0 });
  }
  return out;
}

/* ================================================================================================
   THE TRIM ATLAS

   Two cells in one 256x128 texture: the left half is flat white (every additive stripe, halo,
   crack and index band samples one texel of it) and the right half is the radial falloff the
   glow sprites used to carry as their own SpriteMaterial map. RGB carries the falloff and alpha
   stays 1, so an additive blend reproduces `additiveMaterial(color,{opacity})` exactly when the
   per-instance colour is `color * opacity`.
   ================================================================================================ */

let _atlas = null;

export const TRIM_UV = Object.freeze({
  whiteU: 0.22, whiteV: 0.5,      // safely inside the white cell
  glowU0: 0.52, glowU1: 0.98,
  glowV0: 0.02, glowV1: 0.98,
});

function trimAtlas() {
  if (_atlas) return _atlas;
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W * 0.5, H);
  // radial falloff, authored to match makeGlowSprite(power ~2.8)
  const cx = W * 0.75, cy = H * 0.5, R = Math.min(W * 0.25, H * 0.5);
  const img = g.getImageData(W * 0.5, 0, W * 0.5, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W * 0.5; x++) {
      const dx = (x + W * 0.5 - cx) / R, dy = (y - cy) / R;
      const r = Math.sqrt(dx * dx + dy * dy);
      const f = r >= 1 ? 0 : Math.pow(1 - r, 2.8);
      const o = (y * (W * 0.5) + x) * 4;
      const v = Math.round(Math.max(0, Math.min(1, f)) * 255);
      d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
    }
  }
  g.putImageData(img, W * 0.5, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _atlas = tex;
  return tex;
}

/** Point every vertex of `geo` at the white atlas cell (in place). */
export function trimWhiteUV(geo) {
  const uv = geo.getAttribute('uv');
  if (!uv) return geo;
  const a = uv.array;
  for (let i = 0; i < a.length; i += 2) { a[i] = TRIM_UV.whiteU; a[i + 1] = TRIM_UV.whiteV; }
  uv.needsUpdate = true;
  return geo;
}

/** A unit billboard quad (1x1, centred, in XY) UV-mapped onto the atlas glow cell. */
export function glowQuadGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 1, 1);
  const uv = g.getAttribute('uv');
  const a = uv.array;
  for (let i = 0; i < a.length; i += 2) {
    a[i] = TRIM_UV.glowU0 + a[i] * (TRIM_UV.glowU1 - TRIM_UV.glowU0);
    a[i + 1] = TRIM_UV.glowV0 + a[i + 1] * (TRIM_UV.glowV1 - TRIM_UV.glowV0);
  }
  uv.needsUpdate = true;
  return g;
}

/* ================================================================================================
   ONE BATCH  (one material, many geometries, one draw)
   ================================================================================================ */

const _m4 = new THREE.Matrix4();
const _col = new THREE.Color();

class Batch {
  constructor(set, material, opts) {
    this.set = set;
    this.material = material;
    this.castShadow = !!opts.castShadow;
    this.receiveShadow = !!opts.receiveShadow;
    this.renderOrder = opts.renderOrder | 0;
    this.wantColor = !!opts.color;
    this.mesh = null;
    this._vCap = 0;
    this._iCap = 0;
    this._nCap = 0;
    this._live = 0;
  }

  _ensure(vc, ic) {
    if (!this.mesh) {
      this._nCap = 32;
      this._vCap = Math.max(4096, vc * 2);
      this._iCap = Math.max(8192, ic * 2);
      const m = new THREE.BatchedMesh(this._nCap, this._vCap, this._iCap, this.material);
      m.name = 'hz_batch:' + (this.material.name || this.material.type);
      m.castShadow = this.castShadow;
      m.receiveShadow = this.receiveShadow;
      m.renderOrder = this.renderOrder;
      m.frustumCulled = false;          // per-INSTANCE culling below is the real cull
      m.perObjectFrustumCulled = true;
      m.sortObjects = false;            // additive is order-independent; opaque is depth-tested
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.mesh = m;
      this.set._attach(m);
      return;
    }
    const m = this.mesh;
    if (m.unusedVertexCount < vc || m.unusedIndexCount < ic) {
      const usedV = this._vCap - m.unusedVertexCount;
      const usedI = this._iCap - m.unusedIndexCount;
      while ((this._vCap - usedV < vc || this._iCap - usedI < ic) && this._vCap < (1 << 24)) {
        this._vCap *= 2; this._iCap *= 2;
      }
      m.setGeometrySize(this._vCap, this._iCap);
    }
    if (m.instanceCount >= this._nCap) {
      this._nCap *= 2;
      m.setInstanceCount(this._nCap);
    }
  }

  /**
   * Add one part. `geometry` is COPIED into the batch buffers (the caller keeps ownership of
   * its own geometry and may dispose it). Returns an opaque handle id, or -1 on failure.
   */
  add(geometry) {
    if (!geometry) return -1;
    const g = prepBatchGeometry(geometry, this.wantColor);
    if (!g) return -1;
    const vc = g.getAttribute('position').count;
    const ic = g.getIndex() ? g.getIndex().count : 0;
    try {
      this._ensure(vc, ic);
      const gid = this.mesh.addGeometry(g, vc, ic);
      const iid = this.mesh.addInstance(gid);
      this._live++;
      g.dispose();
      return iid;
    } catch (e) {
      console.warn('[hazards/batch] part rejected', e);
      try { g.dispose(); } catch (e2) { /* noop */ }
      return -1;
    }
  }

  setMatrix(id, m) { if (id >= 0 && this.mesh) this.mesh.setMatrixAt(id, m); }

  /** Position + quaternion + uniform/vector scale, composed allocation-free. */
  setTRS(id, pos, quat, scale) {
    if (id < 0 || !this.mesh) return;
    _m4.compose(pos, quat || IDENT_Q, scale || ONE_V);
    this.mesh.setMatrixAt(id, _m4);
  }

  /** Additive colour PRE-MULTIPLIED by the old material opacity. */
  setColor(id, color, mul) {
    if (id < 0 || !this.mesh) return;
    _col.copy(color);
    if (mul !== undefined) _col.multiplyScalar(mul);
    this.mesh.setColorAt(id, _col);
  }

  setVisible(id, v) { if (id >= 0 && this.mesh) this.mesh.setVisibleAt(id, !!v); }

  remove(id) {
    if (id < 0 || !this.mesh) return;
    try { this.mesh.deleteInstance(id); this._live--; } catch (e) { /* already gone */ }
  }

  dispose() {
    if (!this.mesh) return;
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    try { this.mesh.dispose(); } catch (e) { /* noop */ }
    try { this.mesh.geometry.dispose(); } catch (e) { /* noop */ }
    this.mesh = null;
  }
}

const IDENT_Q = new THREE.Quaternion();
const ONE_V = new THREE.Vector3(1, 1, 1);

/* ================================================================================================
   THE PER-COURSE SET
   ================================================================================================ */

class HazBatchSet {
  constructor(ctx, key) {
    this.key = key || null;
    this.disposed = false;
    this.parent = (ctx && (ctx.group || ctx.scene)) || null;
    this.camera = (ctx && ctx.camera) || null;
    this.root = new THREE.Group();
    this.root.name = 'hz_batches';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();
    if (this.parent) this.parent.add(this.root);
    this._solids = new Map();
    this._trim = null;
    this._trimMat = null;
    this._refs = 0;
    this._glowGeo = null;
    this._mats = new Map();        // source material uuid -> per-course batch clone
    this._ownedMats = [];
  }

  /**
   * The batch-side copy of a shared Mats material. A `Mats` material is used by loose course
   * meshes too, and three re-resolves the program whenever the same material instance alternates
   * between batched and un-batched objects — so the batch gets its own hook-preserving clone
   * (materials.js installs a clone() that carries onBeforeCompile / customProgramCacheKey).
   */
  materialFor(mat) {
    if (!mat) return null;
    let c = this._mats.get(mat.uuid);
    if (!c) {
      try { c = (typeof mat.clone === 'function') ? mat.clone() : mat; } catch (e) { c = mat; }
      if (c !== mat) {
        c.name = (mat.name || mat.type || 'mat') + '#batched';
        this._ownedMats.push(c);
      }
      this._mats.set(mat.uuid, c);
    }
    return c;
  }

  /** `solid()` keyed off a source material instance. */
  solidFor(mat, castShadow, receiveShadow) {
    if (!mat) return null;
    return this.solid(mat.uuid, this.materialFor(mat), castShadow, receiveShadow);
  }

  retain() { this._refs++; return this; }

  release() {
    this._refs--;
    if (this._refs > 0) return;
    for (const b of this._solids.values()) b.dispose();
    this._solids.clear();
    if (this._trim) { this._trim.dispose(); this._trim = null; }
    if (this._trimMat) { try { this._trimMat.dispose(); } catch (e) { /* noop */ } this._trimMat = null; }
    if (this._glowGeo) { try { this._glowGeo.dispose(); } catch (e) { /* noop */ } this._glowGeo = null; }
    for (const m of this._ownedMats) { try { m.dispose(); } catch (e) { /* noop */ } }
    this._ownedMats.length = 0;
    this._mats.clear();
    if (this.root.parent) this.root.parent.remove(this.root);
    this.disposed = true;
    if (this.key) { try { _sets.delete(this.key); } catch (e) { /* noop */ } }
  }

  _attach(mesh) {
    if (!this.root.parent && !this.parent) return;      // orphan set: caller parents it
    this.root.add(mesh);
  }

  /** Parent the batch root under `fallback` when the ctx carried no course group. */
  ensureParent(fallback) {
    if (!this.root.parent && fallback) fallback.add(this.root);
  }

  /**
   * The opaque batch for one material. `material` MUST be stable for the key — pass the same
   * shared/cloned instance every time. Shadow casting is a property of the batch, so a part that
   * must not cast picks a key with `cast:false`.
   */
  solid(key, material, castShadow, receiveShadow) {
    const k = key + (castShadow ? '#s' : '#n');
    let b = this._solids.get(k);
    if (!b) {
      b = new Batch(this, material, {
        castShadow: !!castShadow,
        receiveShadow: receiveShadow !== false,
        renderOrder: 0, color: false,
      });
      this._solids.set(k, b);
    }
    return b;
  }

  /** The single additive overlay batch: every stripe, halo, crack, index band and glow. */
  trim() {
    if (this._trim) return this._trim;
    this._trimMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: trimAtlas(),
      transparent: true,
      opacity: 1,
      vertexColors: true,               // required for BatchedMesh per-instance colour
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,            // additive is commutative: never draw it twice
      toneMapped: false,
      fog: false,
    });
    this._trimMat.name = 'hz.trim';
    this._trim = new Batch(this, this._trimMat, {
      castShadow: false, receiveShadow: false, renderOrder: 6, color: true,
    });
    return this._trim;
  }

  /** The shared unit billboard quad for glow parts (atlas-mapped). */
  glowGeometry() {
    if (!this._glowGeo) this._glowGeo = glowQuadGeometry();
    return this._glowGeo;
  }

  /** The camera quaternion billboards face, or identity before the first frame. */
  billboardQuat() {
    const c = this.camera;
    return c && c.quaternion ? c.quaternion : IDENT_Q;
  }
}

export { Batch, HazBatchSet };
export default hazBatch;
