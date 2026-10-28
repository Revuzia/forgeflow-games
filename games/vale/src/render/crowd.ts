// VALE render — the crowd: instanced, GPU-skinned units (r12 B4 "LOD or instance the wicks"; CONTRACT §9
// "Characters"). Opt-in per unit by data: UnitDef.art.instanced (every Wick sets it).
//
// A per-actor wick costs a SkeletonUtils clone (24 bones of matrix work every frame), an AnimationMixer, a bone
// texture upload and five draws (body, accent, outline hull, two shadow casters). A crowd unit costs none of that:
//   * bake   once per template: every clip sampled at BAKE_HZ into one float texture (row = frame, 3 texels =
//            the 3×4 of bone i: boneWorld × inverseBind, in the model's own space). Templates qualify when every
//            mesh is skinned over one bone set (body + accent fold into one skeleton, actors.ts shareSkeletons),
//            with no form nodes and single materials; anything else stays a per-actor model.
//   * draw   one instanced draw per part per (template, accent colour) set, for every live, visible, on-screen
//            unit of it: body, accent, the rest-outline hull, the victim flash (only while one flashes) and the
//            shadow casters. Per instance: the actor's affine (flinch and squash included), two clip rows and
//            their crossfade weight, the accent glow, the outline width and the flash.
//   * drive  the Actor keeps its own animation logic (roles, scrubbed attacks, crossfades, held casts): a
//            BakedMixer stands in for AnimationMixer and turns its actions into (rowA, rowB, weight).
// The hovered unit's rim draws from a one-instance copy (overlay/hover.ts). Presentation only.

import {
  type AnimationClip, AnimationMixer, BackSide, type BufferGeometry, Color, DataTexture, DynamicDrawUsage,
  FloatType, FrontSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, LoopOnce, LoopRepeat, type Material, Matrix4,
  Mesh, type MeshStandardMaterial, NearestFilter, type Object3D,
  Quaternion, type RawShaderMaterial, RGBAFormat, type Skeleton, type SkinnedMesh, type Vector2, Vector3, type WebGLProgramParametersWithUniforms,
  type Camera, type Scene, type WebGLRenderer,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CROWD_VERT_PARS, crowdDepth, flashU, hoverMaterials, INK, inkMaterial, type RimU, VICTIM_FLASH_GLSL } from './ink.ts';
import { patchWorldMaterial } from './world_material.ts';

/** bake rate: one row per 1/60 s, so a 60 Hz display never needs an in-between frame */
export const BAKE_HZ = 60;
const FORM_RE = /^form_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:[._]\d+)?$/i;

export interface CrowdPart {
  geometry: BufferGeometry;
  /** the template's material (patched for the world by actors.ts); cloned per crowd set */
  material: MeshStandardMaterial;
  /** bind matrix into the bake's bone space (folded, see actors.ts shareSkeletons) */
  bind: Matrix4;
  accent: boolean;
}

export interface CrowdBake {
  readonly id: number;
  readonly texture: DataTexture;
  readonly bones: number;
  readonly clips: Map<AnimationClip, { row0: number; frames: number }>;
  readonly parts: CrowdPart[];
  /** outline / flash hull geometry (template hull plan) and its bind matrix */
  readonly hull: { geometry: BufferGeometry; bind: Matrix4 }[];
  /** the template root's placement: the per-actor clone keeps it, so the crowd does too */
  readonly rootPos: Vector3;
  readonly rootQuat: Quaternion;
}

let bakeSeq = 0;
const _a = new Matrix4();
const _b = new Matrix4();

/** X with IBM_ref,i · X = IBM_m,i · bind_m for every bone (one constant), or null when `m` binds differently */
function foldBind(ref: Skeleton, m: SkinnedMesh): Matrix4 | null {
  const s = m.skeleton;
  if (s.bones.length !== ref.bones.length) return null;
  const x = new Matrix4();
  for (let i = 0; i < s.bones.length; i++) {
    if (s.bones[i].name !== ref.bones[i].name) return null;
    _a.copy(ref.boneInverses[i]).invert().multiply(s.boneInverses[i]).multiply(m.bindMatrix);
    if (i === 0) { x.copy(_a); continue; }
    for (let j = 0; j < 16; j++) if (Math.abs(_a.elements[j] - x.elements[j]) > 1e-4) return null;
  }
  return x;
}

/**
 * Bake a template for the crowd, or null when it does not qualify. `hull`: the template's hull plan (lead mesh
 * index in traverse order + merged geometry). `accentName`: the material whose colour is the readability accent.
 */
export function bakeCrowd(scene: Object3D, clips: Map<string, AnimationClip>, hull: readonly { lead: number; geometry: BufferGeometry; skinned: boolean }[], accentName: string, maxRows: number): CrowdBake | null {
  const meshes: SkinnedMesh[] = [];
  let ok = clips.size > 0;
  scene.traverse((o) => {
    if (FORM_RE.test(o.name)) ok = false;
    const m = o as SkinnedMesh;
    if (!m.isMesh) return;
    if (!m.isSkinnedMesh || Array.isArray(m.material) || !(m.material as MeshStandardMaterial).isMeshStandardMaterial) ok = false;
    else meshes.push(m);
  });
  if (!ok || !meshes.length || hull.some((h) => !h.skinned)) return null;
  const ref = meshes[0].skeleton;
  const binds: Matrix4[] = [];
  for (const m of meshes) { const x = foldBind(ref, m); if (!x) return null; binds.push(x); }

  // sample every clip on a private clone (root at the template's placement, unit scale)
  const clone = cloneSkinned(scene);
  clone.scale.set(1, 1, 1);
  clone.updateMatrixWorld(true);
  const rootInv = new Matrix4().copy(clone.matrixWorld).invert();
  let bones: Object3D[] = [];
  clone.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh && !bones.length) bones = (o as SkinnedMesh).skeleton.bones; });
  const list = [...new Set(clips.values())];
  const table = new Map<AnimationClip, { row0: number; frames: number }>();
  let rows = 0;
  for (const c of list) { const n = Math.max(1, Math.ceil(c.duration * BAKE_HZ) + 1); table.set(c, { row0: rows, frames: n }); rows += n; }
  const W = ref.bones.length * 3;
  if (rows > maxRows || W > maxRows) return null;
  const data = new Float32Array(W * rows * 4);
  const mixer = new AnimationMixer(clone);
  for (const c of list) {
    mixer.stopAllAction();
    const act = mixer.clipAction(c);
    act.reset(); act.setLoop(LoopOnce, 1); act.clampWhenFinished = true; act.setEffectiveWeight(1); act.play();
    const { row0, frames } = table.get(c)!;
    for (let f = 0; f < frames; f++) {
      act.time = Math.min(c.duration, f / BAKE_HZ);
      mixer.update(0);
      clone.updateMatrixWorld(true);
      for (let i = 0; i < bones.length; i++) {
        // in the model's own frame (the instance matrix carries the root): rootInv · boneWorld · IBM_ref
        _b.multiplyMatrices(rootInv, bones[i].matrixWorld).multiply(ref.boneInverses[i]);
        const e = _b.elements, o = ((row0 + f) * W + i * 3) * 4;
        for (let r = 0; r < 3; r++) { data[o + r * 4] = e[r]; data[o + r * 4 + 1] = e[r + 4]; data[o + r * 4 + 2] = e[r + 8]; data[o + r * 4 + 3] = e[r + 12]; }
      }
    }
    act.stop();
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(clone);
  const texture = new DataTexture(data, W, rows, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  // the per-actor clone multiplies the root's own placement in front of the bones; bake space starts after it
  // (rootInv above), so the instance matrix is actorRoot · compose(rootPos, rootQuat, scale)
  return {
    id: ++bakeSeq, texture, bones: ref.bones.length, clips: table,
    parts: meshes.map((m, i) => ({ geometry: m.geometry, material: m.material as MeshStandardMaterial, bind: binds[i], accent: (m.material as Material).name === accentName })),
    hull: hull.map((h) => ({ geometry: h.geometry, bind: binds[h.lead] ?? binds[0] })),
    rootPos: scene.position.clone(), rootQuat: scene.quaternion.clone(),
  };
}

// ── BakedMixer: the AnimationMixer API the Actor drives, over baked rows ─────────────────────────────
/** the AnimationAction surface actors.ts uses */
export class BakedAction {
  time = 0;
  timeScale = 1;
  enabled = true;
  clampWhenFinished = false;
  private loop: number = LoopRepeat;
  weight = 0;
  private fadeFrom = 0;
  private fadeTo = 1;
  private fadeT = 0;
  private fadeDur = 0;
  active = false;
  /** activation order (the newest playing action is the pose's A) */
  order = 0;
  private readonly mixer: BakedMixer;
  private readonly clip: AnimationClip;
  readonly row0: number;
  readonly frames: number;

  constructor(mixer: BakedMixer, clip: AnimationClip, row0: number, frames: number) {
    this.mixer = mixer; this.clip = clip; this.row0 = row0; this.frames = frames;
  }
  getClip(): AnimationClip { return this.clip; }
  setLoop(mode: number, _n: number): this { this.loop = mode; return this; }
  reset(): this { this.time = 0; this.enabled = true; this.fadeDur = 0; return this; }
  setEffectiveWeight(w: number): this { this.weight = w; this.fadeDur = 0; return this; }
  fadeIn(d: number): this { return this.fade(0, 1, d); }
  /** three's fadeOut runs 1 → 0 whatever the weight was (an action caught mid-fade-in jumps back to full) */
  fadeOut(d: number): this { return this.fade(1, 0, d); }
  crossFadeFrom(prev: BakedAction, d: number, _warp: boolean): this { prev.fadeOut(d); return this.fadeIn(d); }
  play(): this { this.mixer.activate(this); return this; }
  stop(): this { this.active = false; this.weight = 0; return this; }
  private fade(from: number, to: number, d: number): this {
    if (d <= 0) { this.weight = to; this.fadeDur = 0; return this; }
    this.fadeFrom = from; this.fadeTo = to; this.fadeT = 0; this.fadeDur = d; this.weight = from;
    return this;
  }
  /** advance one frame (the AnimationMixer semantics actors.ts relies on) */
  tick(dt: number): void {
    if (this.fadeDur > 0) {
      this.fadeT += dt;
      const k = Math.min(1, this.fadeT / this.fadeDur);
      this.weight = this.fadeFrom + (this.fadeTo - this.fadeFrom) * k;
      if (k >= 1) { this.fadeDur = 0; if (this.fadeTo <= 0) { this.stop(); return; } }
    }
    if (!this.enabled || this.timeScale === 0) return;
    const dur = this.clip.duration || 1e-3;
    this.time += dt * this.timeScale;
    if (this.loop === LoopOnce) {
      if (this.time >= dur) { this.time = dur; if (!this.clampWhenFinished) this.stop(); }
      else if (this.time < 0) this.time = 0;
    } else if (this.time >= dur || this.time < 0) this.time = ((this.time % dur) + dur) % dur;
  }
  /** the baked row for the current time */
  row(): number {
    const dur = this.clip.duration || 1e-3;
    const t = this.loop === LoopOnce ? Math.max(0, Math.min(dur, this.time)) : ((this.time % dur) + dur) % dur;
    return this.row0 + Math.min(this.frames - 1, Math.max(0, Math.round(t * BAKE_HZ)));
  }
}

export class BakedMixer {
  readonly bake: CrowdBake;
  private readonly actions = new Map<AnimationClip, BakedAction>();
  private readonly playing: BakedAction[] = [];
  private seq = 0;

  constructor(bake: CrowdBake) { this.bake = bake; }

  clipAction(clip: AnimationClip): BakedAction {
    let a = this.actions.get(clip);
    if (!a) {
      const r = this.bake.clips.get(clip) ?? { row0: 0, frames: 1 };
      a = new BakedAction(this, clip, r.row0, r.frames);
      this.actions.set(clip, a);
    }
    return a;
  }
  activate(a: BakedAction): void {
    a.active = true; a.order = ++this.seq;
    if (!this.playing.includes(a)) this.playing.push(a);
  }
  update(dt: number): void {
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const a = this.playing[i];
      if (a.active) a.tick(dt);
      if (!a.active) this.playing.splice(i, 1);
    }
  }
  stopAllAction(): void { for (const a of this.playing) a.stop(); this.playing.length = 0; }
  uncacheRoot(_o: Object3D): void { this.actions.clear(); }

  /** (rowA, rowB, weight of A): the newest action and the one it fades from */
  pose(out: { a: number; b: number; w: number }): void {
    let A: BakedAction | null = null, Bx: BakedAction | null = null;
    for (const p of this.playing) {
      if (p.weight <= 1e-4) continue;
      if (!A || p.order > A.order) { Bx = A; A = p; } else if (!Bx || p.order > Bx.order) Bx = p;
    }
    if (!A) { out.a = out.b = 0; out.w = 1; return; }
    out.a = A.row();
    if (!Bx) { out.b = out.a; out.w = 1; return; }
    out.b = Bx.row();
    out.w = A.weight / Math.max(1e-4, A.weight + Bx.weight);
  }
}

// ── shaders ───────────────────────────────────────────────────────────────────────────────────────────
// The crowd's vertex prelude (CROWD_VERT_PARS) and the victim flash live with the ink programs (ink.ts): the outline,
// flash, hover mask and rim and the shadow of every crowd set are ink materials of its `crowd` path (one program).
export { CROWD_VERT_PARS, VICTIM_FLASH_GLSL };

/** patch a built-in material (standard / depth) so a plain Mesh draws as the crowd (world space out) */
function patchCrowd(mat: Material, bake: CrowdBake, bind: Matrix4, glow: boolean): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uCrowdBake = { value: bake.texture };
    sh.uniforms.uCrowdBind = { value: bind };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${CROWD_VERT_PARS}\nvarying float vCrowdGlow;`)
      .replace('void main() {', 'void main() {\n\tmat4 valeK = valeCrowdMatrix();\n\tvCrowdGlow = aCrowdAnim.w;')
      .replace('#include <defaultnormal_vertex>', 'objectNormal = normalize( mat3( valeK ) * objectNormal );\n#include <defaultnormal_vertex>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed = ( valeK * vec4( transformed, 1.0 ) ).xyz;');
    if (glow) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCrowdGlow;')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vCrowdGlow;');
    }
  };
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => `${prevKey.call(mat)}|vale_crowd${glow ? 'g' : ''}`;
  mat.needsUpdate = true;
}

// ── the per-frame instance writer ───────────────────────────────────────────────────────────────────
/** what the crowd reads from an actor (render/actors.ts Actor) */
export interface CrowdActor {
  readonly root: Object3D;
  readonly model: Object3D | null;
  readonly crowdBake: CrowdBake | null;
  readonly accentKey: string;
  readonly accentTint: Color;
  readonly glowLevel: number;
  readonly restOutline: { px: number; color: Color; opacity: number };
  readonly flashState: { k: number; color: Color; rim: Color | null };
  crowdPose(out: { a: number; b: number; w: number }): void;
}

const ATTRS = ['aCrowdM0', 'aCrowdM1', 'aCrowdM2', 'aCrowdAnim', 'aCrowdStyle', 'aCrowdFlash', 'aCrowdFlashRim'] as const;
type AttrName = (typeof ATTRS)[number];
const SIZE: Record<AttrName, number> = { aCrowdM0: 4, aCrowdM1: 4, aCrowdM2: 4, aCrowdAnim: 4, aCrowdStyle: 4, aCrowdFlash: 3, aCrowdFlashRim: 3 };

class InstanceBuffer {
  cap = 0;
  count = 0;
  attrs = {} as Record<AttrName, InstancedBufferAttribute>;
  readonly geos: InstancedBufferGeometry[] = [];
  constructor(cap: number) { this.grow(cap); }
  grow(cap: number): void {
    const old = this.attrs;
    this.cap = cap;
    const next = {} as Record<AttrName, InstancedBufferAttribute>;
    for (const n of ATTRS) {
      const a = new InstancedBufferAttribute(new Float32Array(cap * SIZE[n]), SIZE[n]);
      a.setUsage(DynamicDrawUsage);
      if (old[n]) (a.array as Float32Array).set(old[n].array as Float32Array);
      next[n] = a;
    }
    this.attrs = next;
    for (const g of this.geos) for (const n of ATTRS) g.setAttribute(n, next[n]);
  }
  /** an instanced view of a template geometry (attributes shared with the template, instances with this buffer) */
  view(src: BufferGeometry): InstancedBufferGeometry {
    const g = new InstancedBufferGeometry();
    g.index = src.index;
    for (const [k, v] of Object.entries(src.attributes)) g.setAttribute(k, v);
    for (const n of ATTRS) g.setAttribute(n, this.attrs[n]);
    g.instanceCount = 0;
    if (!src.boundingSphere) src.computeBoundingSphere();
    g.boundingSphere = src.boundingSphere;
    this.geos.push(g);
    return g;
  }
  commit(): void {
    for (const n of ATTRS) {
      const a = this.attrs[n];
      a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, this.count) * SIZE[n]); a.needsUpdate = true;
    }
    for (const g of this.geos) g.instanceCount = this.count;
  }
}

const _inst = new Matrix4();
const _mdl = new Matrix4();
const _s = new Vector3();
const _pose = { a: 0, b: 0, w: 1 };

/** write one actor into slot i of a buffer */
function writeInstance(buf: InstanceBuffer, i: number, a: CrowdActor, bake: CrowdBake, outlinePx: number, flash: boolean): void {
  const at = buf.attrs;
  const r = a.root, m = a.model!;
  _inst.compose(r.position, r.quaternion, r.scale);
  _mdl.compose(bake.rootPos, bake.rootQuat, _s.copy(m.scale));
  _inst.multiply(_mdl);
  const e = _inst.elements;
  at.aCrowdM0.setXYZW(i, e[0], e[4], e[8], e[12]);
  at.aCrowdM1.setXYZW(i, e[1], e[5], e[9], e[13]);
  at.aCrowdM2.setXYZW(i, e[2], e[6], e[10], e[14]);
  a.crowdPose(_pose);
  at.aCrowdAnim.setXYZW(i, _pose.a, _pose.b, _pose.w, a.glowLevel);
  const f = a.flashState;
  at.aCrowdStyle.setXYZW(i, outlinePx, flash ? f.k : 0, f.rim ? 1 : 0, 0);
  at.aCrowdFlash.setXYZ(i, f.color.r, f.color.g, f.color.b);
  const rim = f.rim ?? f.color;
  at.aCrowdFlashRim.setXYZ(i, rim.r, rim.g, rim.b);
}

/** one (template, accent colour) set: its instance buffer and its instanced meshes */
class CrowdSet {
  readonly group = new Group();
  readonly bake: CrowdBake;
  readonly buf = new InstanceBuffer(32);
  /** the rest ink's colour and alpha (one per set: every hull part's outline shares them) */
  private readonly outlineU = { uColor: { value: new Color() }, uAlpha: { value: 0.6 } };
  private readonly flashMeshes: Mesh[] = [];
  private readonly accentMats: MeshStandardMaterial[] = [];
  private anyFlash = false;
  private colorSet = false;

  constructor(bake: CrowdBake, tint: Color, outlineRes: { value: Vector2 }) {
    this.bake = bake;
    this.group.name = `crowd_${bake.id}`;
    for (const p of bake.parts) {
      const mat = p.material.clone();
      if (p.accent) {
        // the per-actor accent: colour × 0.3, emissive = the readability colour × glow (actors.ts setAccentColor)
        mat.color.copy(tint).multiplyScalar(0.3);
        mat.emissive.copy(tint);
        mat.emissiveIntensity = 1;
        // crowd units are wicks and small monsters (UnitDef.art.instanced): their share of the character light
        patchWorldMaterial(mat, { unit: true });
        this.accentMats.push(mat);
      } else {
        // the template material's world patch (fog of war, grade hooks) does not survive clone(): carry its hook
        mat.onBeforeCompile = p.material.onBeforeCompile;
        mat.customProgramCacheKey = p.material.customProgramCacheKey;
      }
      patchCrowd(mat, bake, p.bind, p.accent);
      const mesh = new Mesh(this.buf.view(p.geometry), mat);
      mesh.customDepthMaterial = crowdDepth(bake.texture, p.bind);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      mesh.name = `crowd_part_${p.accent ? 'accent' : 'body'}`;
      this.group.add(mesh);
    }
    for (const h of bake.hull) {
      // the rest ink (per-instance width, collapsed when 0) and the victim flash (per-instance, while one flashes)
      const bk = { uCrowdBake: { value: bake.texture }, uCrowdBind: { value: h.bind } };
      const om = inkMaterial('crowd', INK.outline, { side: BackSide, blend: 'normal', depthWrite: false, offset: [1, 2], uniforms: { ...bk, ...this.outlineU, uOutlineRes: outlineRes } });
      const o = new Mesh(this.buf.view(h.geometry), om);
      o.frustumCulled = false; o.matrixAutoUpdate = false; o.renderOrder = 1; o.name = 'crowd_outline';
      this.group.add(o);
      const fm = inkMaterial('crowd', INK.flash, { side: FrontSide, blend: 'premul', depthWrite: false, offset: [-1, -2], uniforms: { ...bk, ...flashU() } });
      const f = new Mesh(this.buf.view(h.geometry), fm);
      f.frustumCulled = false; f.matrixAutoUpdate = false; f.renderOrder = 2; f.name = 'crowd_flash';
      this.flashMeshes.push(f);
      this.group.add(f);
    }
  }

  begin(): void { this.buf.count = 0; this.anyFlash = false; this.colorSet = false; }

  push(a: CrowdActor): void {
    const b = this.buf;
    if (b.count >= b.cap) b.grow(b.cap * 2);
    const o = a.restOutline, f = a.flashState;
    if (!this.colorSet && o.px > 0) {
      this.outlineU.uColor.value.copy(o.color);
      this.outlineU.uAlpha.value = o.opacity;
      this.colorSet = true;
    }
    const flash = f.k > 0.002;
    if (flash) this.anyFlash = true;
    writeInstance(b, b.count++, a, this.bake, o.px, flash);
  }

  end(): void {
    this.buf.commit();
    this.group.visible = this.buf.count > 0;
    for (const f of this.flashMeshes) f.visible = this.anyFlash;
  }

  dispose(): void {
    // the instanced views share the template's attributes: only the materials and instance buffers are ours
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      (m.material as Material).dispose();
      m.customDepthMaterial?.dispose();
    });
    this.group.removeFromParent();
  }
}

/** the hovered crowd unit as a one-instance copy (overlay/hover.ts draws its mask and rim) */
class CrowdSolo {
  readonly group = new Group();
  readonly buf = new InstanceBuffer(1);
  readonly mask: Mesh[] = [];
  readonly hull: Mesh[] = [];
  readonly maskMat: RawShaderMaterial;
  readonly rimMat: RawShaderMaterial;
  constructor(bake: CrowdBake, rimUniforms: Record<string, { value: unknown }>) {
    // the crowd path's ink mask and rim (overlay/hover.ts sets the rim's width, colour and mask)
    const { uPx, uMask, uColor, uAlpha, ...depth } = rimUniforms;
    const h = hoverMaterials('crowd', { uPx, uMask, uColor, uAlpha } as RimU, depth, { uCrowdBake: { value: bake.texture }, uCrowdBind: { value: bake.hull[0].bind } });
    this.maskMat = h.mask;
    this.rimMat = h.rim;
    for (const h of bake.hull) {
      const m = new Mesh(this.buf.view(h.geometry), this.maskMat);
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
      const r = new Mesh(this.buf.view(h.geometry), this.rimMat);
      r.frustumCulled = false; r.matrixAutoUpdate = false; r.visible = false;
      this.mask.push(m); this.hull.push(r);
      this.group.add(m, r);
    }
  }
  dispose(): void { this.maskMat.dispose(); this.rimMat.dispose(); }
}

export interface CrowdHoverTarget {
  model: Object3D; mask: readonly Mesh[]; hull: readonly Mesh[]; px: number; color: Color;
  maskMat: Material; rimMat: RawShaderMaterial;
}

/** every crowd set of a match (renderer-owned; its group lives in the match scene) */
export class CrowdLayer {
  readonly group = new Group();
  private readonly sets = new Map<string, CrowdSet>();
  private readonly solos = new Map<number, CrowdSolo>();
  /** never-drawn sets that hold each bake's compiled programs across matches (warm()) */
  private readonly warmSets = new Map<number, CrowdSet>();
  private readonly outlineRes: { value: Vector2 };
  private readonly hover: { rimUniforms: () => Record<string, { value: unknown }> };

  constructor(outlineRes: { value: Vector2 }, hover: { rimUniforms: () => Record<string, { value: unknown }> }) {
    this.outlineRes = outlineRes;
    this.hover = hover;
    this.group.name = 'vale_crowd';
    this.group.matrixAutoUpdate = false;
  }

  begin(): void { for (const s of this.sets.values()) s.begin(); }

  /** one live, visible, on-screen crowd actor this frame */
  push(a: CrowdActor): void {
    const bake = a.crowdBake;
    if (!bake || !a.model) return;
    const key = `${bake.id}|${a.accentKey}`;
    let s = this.sets.get(key);
    if (!s) {
      s = new CrowdSet(bake, a.accentTint, this.outlineRes);
      this.sets.set(key, s);
      this.group.add(s.group);
    }
    s.push(a);
  }

  end(): void { for (const s of this.sets.values()) s.end(); }

  /** units drawn this frame (harness) */
  get instances(): number { let n = 0; for (const s of this.sets.values()) n += s.buf.count; return n; }
  get setCount(): number { return this.sets.size; }

  private solo(bake: CrowdBake): CrowdSolo {
    let s = this.solos.get(bake.id);
    if (!s) { s = new CrowdSolo(bake, this.hover.rimUniforms()); this.solos.set(bake.id, s); }
    return s;
  }

  /**
   * Compile a bake's programs (body, accent, outline, flash, hover mask and rim) in parallel
   * (KHR_parallel_shader_compile) ahead of the first wave, instead of on the frame the first unit appears
   * or is first hovered. A never-drawn set keeps them alive (programs are shared by cache key).
   */
  warm(bake: CrowdBake, r: WebGLRenderer, cam: Camera, scene: Scene, bare: Scene, again = false): void {
    let s = this.warmSets.get(bake.id);
    if (s && !again) return;
    if (!s) { s = new CrowdSet(bake, new Color(1, 1, 1), this.outlineRes); this.warmSets.set(bake.id, s); }
    void r.compileAsync(s.group, cam, scene).catch(() => undefined);
    // the hover copy draws as its own root (no lights, no fog): `bare` is an empty scene
    void r.compileAsync(this.solo(bake).group, cam, bare).catch(() => undefined);
  }

  hoverTarget(a: CrowdActor, px: number, color: Color): CrowdHoverTarget | null {
    const bake = a.crowdBake;
    if (!bake || !a.model || px <= 0 || !bake.hull.length) return null;
    const s = this.solo(bake);
    s.buf.count = 0;
    writeInstance(s.buf, 0, a, bake, 0, false);
    s.buf.count = 1;
    s.buf.commit();
    return { model: s.group, mask: s.mask, hull: s.hull, px, color, maskMat: s.maskMat, rimMat: s.rimMat };
  }

  /** a new match: drop every drawn set (the bakes, their hover copies and warm sets stay with their templates) */
  clear(): void {
    for (const s of this.sets.values()) s.dispose();
    this.sets.clear();
  }

  dispose(): void {
    this.clear();
    for (const s of this.solos.values()) s.dispose();
    this.solos.clear();
    for (const s of this.warmSets.values()) s.dispose();
    this.warmSets.clear();
    this.group.removeFromParent();
  }
}
