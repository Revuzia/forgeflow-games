// runtime/hazards/batchkit.js
// CRESTBOUND — the batch RIG: draw batching for the factory-style hazards.
//
// WHY
// ---
// `hazards/batch.js` gives every course ONE BatchedMesh per material (plus one additive
// "trim" batch for every readability overlay), and the class-style hazards (rings, breakable,
// mill, sinker, jumppad, current, sandboard) already draw through it. The factory-style hazards
// — mover, vanish, rotor, crusher, pendulum — were still built the Ascendant way: a tree of
// Groups posed every frame, with a loose `partMesh` per material hanging off each Group. That is
// one draw per material PER HAZARD, three times over once the shadow cascades render it again.
// Measured (2026-09-04, `_harness/drawprobe.py`, spawn frame): ember-2's twelve crushers alone
// cost 265 of the frame's 552 draws.
//
// WHAT THIS IS
// ------------
// A `BatchRig` sits between a hazard's Group tree and the course batches. The hazard keeps
// posing its Groups exactly as before (that is where the DETERMINISM LAW lives, and nothing here
// touches it); instead of `group.add(partMesh(geoms, material))` it says
// `rig.solid(material, geoms, group)`, and once per frame `rig.sync()` writes every part's
// instance matrix from the Group it was authored under. A part is therefore drawn exactly where
// the loose mesh would have been drawn — same numbers, one shared draw per material.
//
//   solid(material, geoms, node, cast, recv)  -> part in the course batch for `material`
//   trim(geoms, node)                         -> part in the additive trim batch (stripes, glows,
//                                                lamps, warn bands — everything a `glowMat` used
//                                                to be; its animated emissive becomes a per-part
//                                                COLOUR, see `trimK`)
//   glow(node)                                -> a camera-facing glow quad (the old sprite)
//   adopt(object3d, node)                     -> every Mesh in a builder subtree (a platform deck)
//                                                joins the batch for its material, posed relative
//                                                to `node`
//   sync()                                    -> once per frame after the Groups are posed
//
// Every batch part is disposed with the rig; the last rig out of a course disposes the batches
// (batch.js retain/release).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hazBatch, splitGeometryGroups, trimWhiteUV } from './batch.js';

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _bbScale = new THREE.Vector3();
const _white = new THREE.Color(1, 1, 1);

/**
 * Additive-trim intensity for the `emissiveIntensity` a loose glow material used to carry.
 * The trim batch is un-tonemapped additive colour, so the mapping is the one hazards/batch.js
 * and the already-batched hazards settled on: ~0.2 per unit of emissive intensity, clamped so a
 * strobe peak never becomes a white slab (the emissive-glare bar).
 */
export function trimK(ei, lo = 0, hi = 1.4) {
  const k = ei * 0.2;
  return k < lo ? lo : (k > hi ? hi : k);
}

/** Merge a geometry list (or pass a single geometry through). Inputs are consumed. */
export function mergeList(list) {
  if (!list) return null;
  if (!Array.isArray(list)) return list;
  const src = list.filter(Boolean);
  if (src.length === 0) return null;
  if (src.length === 1) return src[0];
  const flat = src.map((g) => (g.index ? g.toNonIndexed() : g));
  let merged = null;
  try { merged = mergeGeometries(flat, false); } catch (e) { merged = null; }
  for (let i = 0; i < flat.length; i++) if (flat[i] !== src[i]) flat[i].dispose();
  if (!merged) return null;
  for (const g of src) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Local matrix of `o` expressed in the frame `top` is a direct child of (chain product). */
function chainMatrix(o, top, out) {
  out.identity();
  let n = o;
  while (n) {
    if (n.matrixAutoUpdate) n.updateMatrix();
    out.premultiply(n.matrix);
    if (n === top) break;
    n = n.parent;
  }
  return out;
}

export class BatchRig {
  /**
   * @param {object} ctx hazard ctx (CONTRACT §21)
   * @param {THREE.Object3D} root the hazard's mesh root — its subtree is re-posed by `sync()`
   */
  constructor(ctx, root) {
    this.root = root;
    this.set = hazBatch(ctx) || null;
    if (this.set) {
      this.set.retain();
      this.set.ensureParent(root);
    }
    /** @type {Array<{b:object,id:number,node:THREE.Object3D|null,local:THREE.Matrix4|null}>} */
    this.parts = [];
    this._disposed = false;
  }

  /** False when the ctx carries no batch set — callers then keep their loose meshes. */
  get ok() { return !!this.set; }

  _push(b, geo, node) {
    if (!b || !geo) return null;
    const id = b.add(geo);
    if (id < 0) return null;
    const p = { b, id, node: node || null, local: null };
    this.parts.push(p);
    return p;
  }

  /**
   * A solid part in the course batch for `material`, authored in `node`'s frame.
   * `geoms` (array or single geometry) is CONSUMED.
   */
  solid(material, geoms, node, castShadow = true, receiveShadow = true) {
    if (!this.set || !material) return null;
    const geo = mergeList(geoms);
    if (!geo) return null;
    const b = this.set.solidFor(material, !!castShadow, receiveShadow !== false);
    const p = this._push(b, geo, node);
    geo.dispose();
    if (p) this._write(p);
    return p;
  }

  /** An additive readability overlay in the trim batch, authored in `node`'s frame. Consumes `geoms`. */
  trim(geoms, node) {
    if (!this.set) return null;
    const geo = mergeList(geoms);
    if (!geo) return null;
    const p = this._push(this.set.trim(), trimWhiteUV(geo), node);
    geo.dispose();
    if (p) this._write(p);
    return p;
  }

  /** A camera-facing glow quad (the old `makeGlowSprite`). Posed with `glowAt`. */
  glow() {
    if (!this.set) return null;
    const p = this._push(this.set.trim(), this.set.glowGeometry(), null);
    if (p) { p.local = new THREE.Matrix4(); p.b.setMatrix(p.id, p.local); }
    return p;
  }

  /**
   * Fold every Mesh under `obj` into the course batches, posed as if `obj` were a direct child
   * of `node`. Material-array meshes (builder output) split per group. `obj` is detached from
   * its parent — it is no longer drawn. Source geometries are NOT disposed (builders cache them).
   * @returns {Array} the parts, in traversal order
   */
  adopt(obj, node, castShadow, receiveShadow) {
    const out = [];
    if (!this.set || !obj) return out;
    const meshes = [];
    obj.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh && o.geometry) meshes.push(o);
    });
    for (const o of meshes) {
      chainMatrix(o, obj, _m);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const pieces = splitGeometryGroups(o.geometry);
      for (const pc of pieces) {
        const mat = mats[Math.min(pc.materialIndex, mats.length - 1)];
        if (!mat || !pc.geometry) continue;
        // a private copy: the source may be a cached builder geometry shared by the whole course
        const baked = pc.geometry.clone();
        baked.applyMatrix4(_m);
        const cast = castShadow === undefined ? !!o.castShadow : !!castShadow;
        const recv = receiveShadow === undefined ? o.receiveShadow !== false : !!receiveShadow;
        const b = this.set.solidFor(mat, cast, recv);
        const p = this._push(b, baked, node);
        baked.dispose();
        if (p) { this._write(p); out.push(p); }
      }
    }
    if (obj.parent) obj.parent.remove(obj);
    return out;
  }

  /** Write one part from its node (and optional local matrix) — allocation free. */
  _write(p) {
    if (!p.node) return;
    if (p.node.matrixAutoUpdate) p.node.updateMatrix();
    p.node.updateWorldMatrix(true, false);
    if (p.local) { _m2.multiplyMatrices(p.node.matrixWorld, p.local); p.b.setMatrix(p.id, _m2); }
    else p.b.setMatrix(p.id, p.node.matrixWorld);
  }

  /**
   * Re-pose every part from its Group. Call ONCE per frame after the Groups are posed (and
   * from reset(), which the hazards route through update()).
   */
  sync() {
    if (!this.set) return;
    this.root.updateMatrixWorld(true);
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.node) continue;
      if (p.local) { _m2.multiplyMatrices(p.node.matrixWorld, p.local); p.b.setMatrix(p.id, _m2); }
      else p.b.setMatrix(p.id, p.node.matrixWorld);
    }
  }

  /** Give `part` a per-frame LOCAL matrix under its node (chain links, collars, flakes). */
  setLocal(part, m) {
    if (!part) return;
    if (!part.local) part.local = new THREE.Matrix4();
    part.local.copy(m);
  }

  /** Detach `part` from its node and write an explicit world matrix. */
  setMatrix(part, m) {
    if (!part) return;
    part.node = null;
    part.b.setMatrix(part.id, m);
  }

  /** Pose a glow quad at `pos` (world), `size` metres, facing the camera. */
  glowAt(part, pos, size) {
    if (!part || !this.set) return;
    _bbScale.setScalar(size);
    part.b.setTRS(part.id, pos, this.set.billboardQuat(), _bbScale);
  }

  /** Per-part colour: trim parts take `color * k` (additive), solid parts a diffuse tint. */
  setColor(part, color, k) { if (part) part.b.setColor(part.id, color || _white, k); }

  setVisible(part, v) { if (part) part.b.setVisible(part.id, !!v); }

  /** Visibility of a whole list of parts at once (a slab that scales away, a debris burst). */
  setVisibleAll(parts, v) {
    if (!parts) return;
    for (let i = 0; i < parts.length; i++) if (parts[i]) parts[i].b.setVisible(parts[i].id, !!v);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const p of this.parts) { try { p.b.remove(p.id); } catch (e) { /* noop */ } }
    this.parts.length = 0;
    if (this.set) { try { this.set.release(); } catch (e) { /* noop */ } }
    this.set = null;
  }
}

export default BatchRig;
