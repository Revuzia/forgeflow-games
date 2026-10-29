// VALE render — characters and units (CONTRACT §9 "Characters"; STYLE_BIBLE "Fighters").
//
//   * One template per GLB (assets.ts caches the load); every entity gets SkeletonUtils.clone of it.
//     Units pick their GLB by team (UnitDef.art.teamModels[team], else art.model; FFA → art.model),
//     so a structure is an Aubade spire on team 0 and a Serenade dome on team 1 (CONTRACT §12).
//     Skins carry mesh + skeleton only: their clips come from the fighter's BASE model and bind by
//     bone name (the rig standard VALE_BIPED_1 is shared), so a skin never needs its own clips.
//   * AnimationMixer per actor, driven by EntityView.state / anim / stateTime:
//       idle / run / recall / channel / stunned  loop; run at speed / FighterArt.runRefSpeed
//       attack1 / attack2 / crit / cast_*        one-shot, time = stateTime × k where k puts the
//                                                authored impact (40 % of the clip) on the sim's
//                                                release (attack: windup × period, cast: castTime)
//       dash                                     fitted to the dash duration
//       death                                    plays once and HOLDS the last frame
//     Crossfades are 100 ms (60 ms into an attack). Clips missing from a GLB fall back to a sibling.
//   * The accent material (FighterArt.accentMaterial) is cloned per actor and tinted with the
//     viewer-relative readability colour: emissive ≤ 0.8 at rest, ≥ 1.5 (and above the bloom
//     threshold) during wind-ups — "a glow is a warning".
//   * Positions/facing interpolate between the last two sim ticks with MatchClient.alpha; jumps
//     longer than 3 m in one tick (blink, respawn) snap.
//   * Sockets: FighterArt.sockets names a bone or empty; three's loader sanitizes node names, so
//     lookups go through PropertyBinding.sanitizeNodeName.
//   * Missing art: no mesh, overlays only. In DEV builds behind ?dev=1 a fighter falls back to the
//     proof mannequin GLB and other units to clearly-marked debug geometry (CONTRACT §0).
//   * Unit outline (inverted hull, screen-space px; tokens hud.unitOutline = UNIT_OUTLINE): built ONCE per
//     template (skinned parts that share a bind pose merged into one geometry with welded normals, so a
//     fighter or a wick costs one extra draw) and cloned onto every actor in attach() hidden. Rest: 1 px ink
//     at 60 %, tinted 18 % toward the relationship colour, on fighters / wicks / monsters / summons. Hover:
//     a clean silhouette rim in the overlay pass (overlay/hover.ts) from the same prebuilt meshes, 2.5 px HARM
//     (enemy and neutral: "this is what you attack"), 1.5 px ally colour on allies. Neither ever touches the
//     scene graph.
//   * Occluded silhouette (env F4; tokens hud.unitOutline.occluded = OCCLUDED): a fighter also carries a front-face
//     copy of the hull in the ink xray pass (ink.ts), hidden until the renderer finds cover between it and the camera
//     (terrain.coverToward); then the parts a cliff, a Dialwood crown or a landmark hides draw as a 42 % fill in its
//     readability colour with a lit edge (depth test GREATER against the cover, drawn before every unit).
//   * Victim reaction (tokens vfx.impact.victimFlash = VICTIM_FLASH): a rim-weighted flash copy of the same
//     hull geometry (front faces, premultiplied): chalkstone for physical, orchid-rose for magic, the
//     value-inverted Shade (ink body, noonwhite rim) for true damage, dawnglass when a shield took it all.
//     Peak on the impact frame, τ 70 ms, gone by 150 ms, with a small flinch + squash. It ends when the unit
//     leaves vision (hidden()). No hit-stop (simHitStop and presentationHitStop false).
//   * Veils (r12 M2, statuses on the body itself; the renderer decides per viewer): an INVISIBLE unit its allies
//     (or a reveal) still see draws at 35 % alpha with no ink outline, so the ground shows through it (the status
//     look adds the shimmer); an UNTARGETABLE unit draws at 60 % (40 % see-through) under a 2 px dawnglass rim.
//     Blended, not hashed (a hashed dither turned to dark noise under AO): per-actor transparent clones of the body
//     materials over a depth-only copy of the body (the hull geometry, drawn last among the opaque), so only the
//     nearest surface shows; made on first use (the renderer makes and compiles them once per template at attach)
//     and kept, the accent clone toggles in place. A veiled body throws no shadow.
//     Crowd wicks have no per-actor body and never veil.
//   * CPU (r12 B4): the renderer culls actors outside the frustum and their shadow reach (no draw, no matrix
//     work, the clip holds); body + accent share one Skeleton (shareSkeletons); UnitDef.art.instanced units
//     draw as the instanced, GPU-skinned crowd (crowd.ts) through a BakedMixer that takes this file's
//     animation logic unchanged; ModelLibrary.onReady lets the renderer upload a template's textures and
//     compile its programs when it is built.

import {
  type AnimationActionLoopStyles, type AnimationClip, AnimationMixer, BufferAttribute, BufferGeometry, CapsuleGeometry, Color,
  CylinderGeometry, Float32BufferAttribute, type Material, Matrix3, Matrix4, Group, LatheGeometry, LoopOnce,
  LoopRepeat, Mesh, MeshStandardMaterial, NoBlending, NormalBlending, type Object3D, OctahedronGeometry,
  PropertyBinding, SkinnedMesh, Uint16BufferAttribute, Uint32BufferAttribute, Vector2,
  Vector3,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CatalogT, FighterDefT, UnitDefT } from '../contracts/catalog.ts';
import type { EntityView, SimEvent, TeamId } from '../contracts/sim.ts';
import { TICK_DT } from '../contracts/sim.ts';
import type { Assets, LoadedModel } from './assets.ts';
import { INK, type Palette } from './palette.ts';
import { BakedMixer, bakeCrowd, type CrowdActor, type CrowdBake } from './crowd.ts';
import {
  flashMaterial, flashU, type FlashU, type InkPath, inkShadows, outlineMaterial, outlineU, type OutlineU, outlineUniforms, prepassMaterial,
  XRAY_ORDER, xrayMaterial, xrayU, type XrayU,
} from './ink.ts';
import type { FeelEvent } from './vfx/system.ts';
import { opaqueVeilable, patchWorldMaterial, veilOff, veilOn } from './world_material.ts';
import { composeIndex, dequantUnit, faceLockedLod, indexView, LOD, lodIndex, lodReady, lodSwitch, prepareShadowLod, shadowLods } from './lod.ts';
import { structureMaterial } from './structures.ts';

const DEV_MANNEQUIN_HEIGHT = 1.95;
/** baked rows a crowd texture may hold (WebGL2 guarantees 2048; every desktop GPU VALE targets has ≥ 8192) */
const CROWD_MAX_ROWS = 4096;
const IMPACT_AT = 0.4;
/** an instant cast's clip: played at the pace of a cast this long (s) …, reaching its impact this long after the event */
const INSTANT_PACE_S = 0.25;
const INSTANT_LEAD_S = 0.12;
const ACCENT_REST = 0.8;
/** veils (r12 M2): body coverage of an invisible unit its allies see, of an untargetable one; the glass rim */
const VEIL_GHOST = 0.35;
const VEIL_GLASS = 0.6;
const VEIL_RIM_PX = 2;
const VEIL_RIM_ALPHA = 0.9;
const VEIL_RIM = new Color().setStyle('#BFD3E6');
const ACCENT_WINDUP_MIN = 1.5;
const SNAP_DIST = 3;
/** tokens.json `hud.unitOutline` (r12 M10 rest ink, B1 hover): widths in CSS px, alpha 0..1, tint = sRGB share of
 *  the relationship colour mixed into the rest ink. Hover colours are the relationship's (HARM for enemies and
 *  neutrals, ally azure for allies), so colourblind modes follow the palette. */
export const UNIT_OUTLINE = {
  rest: { px: 1, color: INK.ink0, alpha: 0.6, relationTint: 0.18 },
  hoverEnemy: { px: 2.5, alpha: 1 },
  hoverAlly: { px: 1.5, alpha: 1 },
} as const;
/** tokens.json `hud.unitOutline.occluded` (env F4): a fighter's body where cover hides it, in its readability
 *  colour; `fill` alpha, `edgePx` the lit edge (screen px), `biasM` the depth the cover must lead by */
export const OCCLUDED = { fill: 0.42, edgePx: 1.5, biasM: 0.3 } as const;
/** tokens.json `vfx.impact.victimFlash` (victimRimMs 80: ≈ 80 ms visible, exponential τ 70 ms, cleared by 150 ms) */
export const VICTIM_FLASH = { k: { T1: 0.45, T2: 0.7, T4: 1.0 }, critMult: 1.3, tauMs: 70, endMs: 150 } as const;
const FLASH_TAU = VICTIM_FLASH.tauMs / 1000;
const FLASH_END = VICTIM_FLASH.endMs / 1000;
const WOB_DUR = 0.14;
/** wicks this far from the camera focus animate at 15 Hz */
export const ANIM_FAR_M = 12;
/** a clip role's fallback chain: the first role the model carries plays (a fighter with no crit clip crits with
 *  attack2); the director resolves a swing's clip the same way (vfx `clip` layers) */
export const CLIP_CHAIN: Readonly<Record<string, readonly string[]>> = {
  crit: ['crit', 'attack2', 'attack1'], attack2: ['attack2', 'attack1'], attack1: ['attack1', 'attack2'],
  cast_a1: ['cast_a1', 'cast_a2', 'attack1'], cast_a2: ['cast_a2', 'cast_a1', 'attack1'], cast_a3: ['cast_a3', 'cast_a1', 'attack1'],
  cast_ult: ['cast_ult', 'cast_a1', 'attack1'], channel: ['channel', 'cast_a1', 'idle'], dash: ['dash', 'run'],
  stunned: ['stunned', 'idle'], recall: ['recall', 'channel', 'idle'], death: ['death'], run: ['run', 'idle'], idle: ['idle'],
  idle_lobby: ['idle_lobby', 'idle'], victory: ['victory', 'idle_lobby', 'idle'], spawn: ['spawn', 'idle'], taunt: ['taunt', 'idle'],
};
const ANIM_FAR_DT = 1 / 15;

export type ActorKind = 'fighter' | 'minion' | 'monster' | 'structure' | 'summon' | 'ward' | 'pickup';
/** who takes the character light (world_material.ts): fighters all of it, wicks and monsters a share, the rest none;
 *  jungle monsters take the world's light and their own glow at their own share (CHAR_LIGHT.monsterLight) */
interface CharLight { fighter: boolean; unit: boolean; monster: boolean }
const charLight = (kind: string): CharLight => ({ fighter: kind === 'fighter', unit: kind === 'minion' || kind === 'monster', monster: kind === 'monster' });
const LOOPING = new Set(['idle', 'run', 'recall', 'channel', 'stunned', 'idle_lobby', 'victory', 'taunt']);

interface Template {
  scene: Object3D;
  clips: Map<string, AnimationClip>;
  /** clip role → clip name (FighterArt.clips / UnitDef.art.clips) */
  roles: Record<string, string | undefined>;
  /** extra scale (dev mannequin stand-in fitted to the authored height) */
  fit: number;
  dev: boolean;
  /** outline / hit-flash hull parts (built once per template scene) */
  hull: HullPart[];
  /** perf PERF-m5: a fighter's match body (lod.ts faceLockedLod) and its hull parts over it; null = full body */
  bodyLod?: BodyLod | null;
  /** the baked crowd form (UnitDef.art.instanced units that qualify; crowd.ts), else null */
  crowd?: CrowdBake | null;
  /** a patched accent clone that only holds the warm-up program (ModelLibrary.ready) */
  warmAccent?: MeshStandardMaterial;
}

/** the AnimationAction / AnimationMixer surface the Actor drives (three's, or crowd.ts' baked stand-ins) */
interface ActionLike {
  time: number; timeScale: number; enabled: boolean; clampWhenFinished: boolean;
  reset(): unknown; setLoop(mode: AnimationActionLoopStyles, n: number): unknown; setEffectiveWeight(w: number): unknown;
  crossFadeFrom(a: ActionLike, d: number, warp: boolean): unknown; fadeIn(d: number): unknown; play(): unknown; getClip(): AnimationClip;
}
interface MixerLike { clipAction(c: AnimationClip): ActionLike; update(dt: number): unknown; stopAllAction(): unknown; uncacheRoot(o: Object3D): void }

// ── hull plan: outline + hit-flash geometry, once per template ───────────────────────────────────
/** perf PERF-m5: the rest outline's hull through its sub-pixel LOD (lod.ts LOD.hull: half the triangles within 6 mm):
 *  a view sharing the hull's attributes, freed with it. In a match the hit flash and the x-ray silhouette draw it too
 *  (the flash slid FLASH_LOD_BIAS_M toward the camera, so it still covers the body); the veil's depth copy keeps the
 *  body's own triangles (the body's LOD1 in a match: bodyLodOf). */
const outlineLod = new WeakMap<BufferGeometry, BufferGeometry>();
function outlineGeometry(g: BufferGeometry): BufferGeometry {
  const hit = outlineLod.get(g);
  if (hit) return hit;
  const l = lodIndex(g, 'hull');
  if (!l) return g;
  const v = new BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) v.setAttribute(k, a);
  v.setIndex(l);
  if (!g.boundingSphere) g.computeBoundingSphere();
  v.boundingSphere = g.boundingSphere;
  v.name = 'vale_outline_lod';
  outlineLod.set(g, v);
  g.addEventListener('dispose', () => { v.dispose(); outlineLod.delete(g); });
  return v;
}

/** perf PERF-m5: in a match the victim flash and the x-ray draw over the outline's LOD (lod.ts LOD.hull: within 6 mm of the
 *  hull) instead of the whole hull; the flash slides this far toward the camera along its view ray (ink.ts) so the coarser
 *  shell still covers every pixel of the body it lights (the x-ray already slides OCCLUDED.biasM) */
const FLASH_LOD_BIAS_M = 0.025;

/** one hull draw: `lead` is the index (traverse order) of the mesh it binds to and hangs under. `members`: the meshes
 *  merged into it (traverse order), each one's first vertex, first index and index count in the merged geometry */
interface HullPart {
  lead: number; geometry: BufferGeometry; skinned: boolean; members: { mesh: number; vo: number; io: number; n: number }[];
  /** perf PERF-m5: a match fighter's ink copies (outline, flash, x-ray) draw this LOD of the part (lod.ts LOD.ink; bodyLodOf) */
  ink?: BufferGeometry;
}

/** perf PERF-m5: a fighter's match body. `mesh` (traverse order) draws `geometry` (its LOD1 over its own attributes);
 *  `hull` is the template's hull plan with that member's triangles swapped for the LOD1's, so the outline, flash, x-ray
 *  and veil copies keep lying on the surface the body draws */
interface BodyLod { mesh: number; geometry: BufferGeometry; hull: HullPart[]; tris: number; lodTris: number }

const FORM_RE = /^form_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:[._]\d+)?$/i;
const hullCache = new WeakMap<Object3D, HullPart[]>();
const _m1 = new Matrix4();
const _m2 = new Matrix4();
const _n3 = new Matrix3();
const _p = new Vector3();

function meshesOf(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
  return out;
}

/** nearest form node at or above `o` (form-swapped parts toggle visibility; a hull never spans two) */
function formKey(o: Object3D): string {
  for (let p: Object3D | null = o; p; p = p.parent) if (FORM_RE.test(p.name)) return p.uuid;
  return '';
}

/** glow cards, flames and other see-through parts get no ink outline */
function outlinable(m: Mesh): boolean {
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.some((x) => !x.transparent && (x.blending === NormalBlending || x.blending === NoBlending) && x.depthWrite !== false) && !!m.geometry.getAttribute('position');
}

/**
 * B can share A's hull when one rigid transform C carries B's bind space into A's for every bone they share
 * (C = (IBM_A · bind_A)⁻¹ · IBM_B · bind_B; a mesh exported with its own object offset differs by exactly
 * that). Returns C (B's vertices go through it), or null when B binds differently.
 */
const _c0 = new Matrix4();
function skinTransform(a: SkinnedMesh, b: SkinnedMesh): Matrix4 | null {
  const ia = new Map(a.skeleton.bones.map((bone, i) => [bone, i]));
  let first = true;
  for (let j = 0; j < b.skeleton.bones.length; j++) {
    const i = ia.get(b.skeleton.bones[j]);
    if (i === undefined) return null;
    _m1.multiplyMatrices(a.skeleton.boneInverses[i], a.bindMatrix).invert();
    _m2.multiplyMatrices(b.skeleton.boneInverses[j], b.bindMatrix);
    _m1.multiply(_m2);
    if (first) { _c0.copy(_m1); first = false; continue; }
    for (let k = 0; k < 16; k++) if (Math.abs(_m1.elements[k] - _c0.elements[k]) > 1e-3) return null;
  }
  return _c0.clone();
}

/** average the normals of coincident vertices (hard edges would crack a screen-space hull) */
function weldNormals(pos: Float32Array, nrm: Float32Array): void {
  const n = pos.length / 3;
  const slot = new Int32Array(n);
  const map = new Map<string, number>();
  const acc: number[] = [];
  for (let v = 0; v < n; v++) {
    const key = `${Math.round(pos[v * 3] * 1e4)},${Math.round(pos[v * 3 + 1] * 1e4)},${Math.round(pos[v * 3 + 2] * 1e4)}`;
    let s = map.get(key);
    if (s === undefined) { s = acc.length / 3; map.set(key, s); acc.push(0, 0, 0); }
    acc[s * 3] += nrm[v * 3]; acc[s * 3 + 1] += nrm[v * 3 + 1]; acc[s * 3 + 2] += nrm[v * 3 + 2];
    slot[v] = s;
  }
  for (let v = 0; v < n; v++) {
    const s = slot[v];
    const x = acc[s * 3], y = acc[s * 3 + 1], z = acc[s * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l > 1e-3) { nrm[v * 3] = x / l; nrm[v * 3 + 1] = y / l; nrm[v * 3 + 2] = z / l; }
  }
}

/** merge members into one hull geometry in the lead's space (positions, welded normals, skin remapped to the lead's bones) */
function mergeHull(members: Mesh[], lead: Mesh, skinned: boolean, skinXf: (Matrix4 | null)[]): BufferGeometry {
  let nv = 0, ni = 0;
  for (const m of members) {
    const g = m.geometry;
    const c = g.getAttribute('position').count;
    nv += c; ni += g.index ? g.index.count : c;
  }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  const SI = skinned ? new Uint16Array(nv * 4) : null, SW = skinned ? new Float32Array(nv * 4) : null;
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const leadBones = skinned ? new Map((lead as SkinnedMesh).skeleton.bones.map((b, i) => [b, i])) : null;
  _m1.copy(lead.matrix).invert();
  let vo = 0, io = 0, missingNormals = false;
  members.forEach((m, mi) => {
    const g = m.geometry;
    const pa = g.getAttribute('position'), na = g.getAttribute('normal');
    // rigid siblings: into the lead's local frame; skinned members: into the lead's bind space (skinTransform)
    const xf = skinned ? skinXf[mi] : m !== lead ? _m2.multiplyMatrices(_m1, m.matrix) : null;
    if (xf) _n3.getNormalMatrix(xf);
    for (let v = 0; v < pa.count; v++) {
      _p.fromBufferAttribute(pa, v);
      if (xf) _p.applyMatrix4(xf);
      P[(vo + v) * 3] = _p.x; P[(vo + v) * 3 + 1] = _p.y; P[(vo + v) * 3 + 2] = _p.z;
      if (na) {
        _p.fromBufferAttribute(na, v);
        if (xf) _p.applyMatrix3(_n3).normalize();
        N[(vo + v) * 3] = _p.x; N[(vo + v) * 3 + 1] = _p.y; N[(vo + v) * 3 + 2] = _p.z;
      } else missingNormals = true;
    }
    if (SI && SW && leadBones) {
      const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      const bones = (m as SkinnedMesh).skeleton.bones;
      for (let v = 0; v < pa.count; v++) {
        for (let k = 0; k < 4; k++) {
          const j = si ? si.getComponent(v, k) : 0;
          SI[(vo + v) * 4 + k] = leadBones.get(bones[j]) ?? 0;
          SW[(vo + v) * 4 + k] = sw ? sw.getComponent(v, k) : k === 0 ? 1 : 0;
        }
      }
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) I[io + k] = g.index.getX(k) + vo;
    else for (let k = 0; k < pa.count; k++) I[io + k] = k + vo;
    vo += pa.count; io += g.index ? g.index.count : pa.count;
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(P, 3));
  out.setIndex(I instanceof Uint32Array ? new Uint32BufferAttribute(I, 1) : new Uint16BufferAttribute(I, 1));
  if (missingNormals) { out.computeVertexNormals(); N.set((out.getAttribute('normal') as BufferAttribute).array as Float32Array); }
  weldNormals(P, N);
  out.setAttribute('normal', new Float32BufferAttribute(N, 3));
  if (SI && SW) { out.setAttribute('skinIndex', new Uint16BufferAttribute(SI, 4)); out.setAttribute('skinWeight', new Float32BufferAttribute(SW, 4)); }
  out.computeBoundingSphere();
  return out;
}

/** the hull parts of a template scene (cached per scene object) */
function hullPlan(scene: Object3D): HullPart[] {
  const hit = hullCache.get(scene);
  if (hit) return hit;
  scene.updateMatrixWorld(true);
  const meshes = meshesOf(scene);
  const groups: { lead: number; members: number[]; xf: (Matrix4 | null)[]; skinned: boolean; key: string }[] = [];
  meshes.forEach((m, i) => {
    if (!outlinable(m)) return;
    const sk = (m as SkinnedMesh).isSkinnedMesh === true;
    const key = sk ? `s|${formKey(m)}` : `r|${m.parent?.uuid ?? ''}|${FORM_RE.test(m.name) ? m.uuid : formKey(m)}`;
    for (const g of groups) {
      if (g.key !== key) continue;
      if (!sk) { g.members.push(i); g.xf.push(null); return; }
      const c = skinTransform(meshes[g.lead] as SkinnedMesh, m as SkinnedMesh);
      if (c) { g.members.push(i); g.xf.push(c); return; }
    }
    groups.push({ lead: i, members: [i], xf: [null], skinned: sk, key });
  });
  const parts = groups.map((g) => {
    let vo = 0, io = 0;
    const members = g.members.map((i) => {
      const geo = meshes[i].geometry, c = geo.getAttribute('position').count, n = geo.index ? geo.index.count : c;
      const r = { mesh: i, vo, io, n };
      vo += c; io += n;
      return r;
    });
    return { lead: g.lead, skinned: g.skinned, members, geometry: mergeHull(g.members.map((i) => meshes[i]), meshes[g.lead], g.skinned, g.xf) };
  });
  hullCache.set(scene, parts);
  return parts;
}

const bodyLodCache = new WeakMap<Object3D, BodyLod | null>();
/**
 * perf PERF-m5: the face-locked LOD1 of a fighter template's textured body (the largest indexed skinned mesh with UVs)
 * and the hull plan rebuilt over it; null when it has none (simplifier not ready, no head bone, nothing gained). Run on
 * the template at rest (hullPlan made its world matrices current; templates are never posed, their clones are).
 */
function bodyLodOf(scene: Object3D, hull: HullPart[]): BodyLod | null {
  if (bodyLodCache.has(scene)) return bodyLodCache.get(scene) ?? null;
  const meshes = meshesOf(scene);
  let best = -1;
  meshes.forEach((m, i) => {
    const g = m.geometry;
    if (!(m as SkinnedMesh).isSkinnedMesh || !g.index || !g.getAttribute('uv')) return;
    if (best < 0 || g.index.count > meshes[best].geometry.index!.count) best = i;
  });
  const r = best >= 0 ? faceLockedLod(meshes[best] as SkinnedMesh) : null;
  if (!r) { bodyLodCache.set(scene, null); return null; }
  const geometry = indexView(meshes[best].geometry, r.index, 'vale_body_lod1');
  prepareShadowLod(geometry);                                          // its shadow LOD now, not over the sweeps
  const lod = r.index.array as ArrayLike<number>;
  const parts = hull.map((p): HullPart => {
    const I = composeIndex(p.geometry, p.members, (mesh) => (mesh === best ? lod : null));
    const geometry = I ? indexView(p.geometry, I, 'vale_hull_lod1') : p.geometry;
    // the ink copies' LOD over it (lod.ts LOD.ink, the bound in metres through the lead's dequantization)
    const lead = meshes[p.lead] as SkinnedMesh;
    const ink = lodIndex(geometry, 'ink', LOD.minTris, lead?.isSkinnedMesh ? dequantUnit(lead) : 1);
    return { ...p, geometry, ink: ink ? indexView(geometry, ink, 'vale_hull_ink') : undefined };
  });
  const out: BodyLod = { mesh: best, geometry, hull: parts, tris: r.tris, lodTris: r.lodTris };
  bodyLodCache.set(scene, out);
  return out;
}

/** CSS-pixel viewport the outline widths are measured in (ink.ts; the renderer keeps it current) */
export { outlineUniforms };

export interface ActorOptions {
  dev: boolean;
  /** URL of the proof mannequin GLB (dev fallback for fighters) */
  devModelUrl: string | null;
  /** draw UnitDef.art.instanced units as the instanced crowd (crowd.ts); default on */
  crowd?: boolean;
}

// ── template library ─────────────────────────────────────────────────────────────────────────────
export class ModelLibrary {
  private readonly fighters = new Map<string, FighterDefT>();
  private readonly units = new Map<string, UnitDefT>();
  private readonly skins = new Map<string, string>(); // skin id → model ref
  private readonly templates = new Map<string, Promise<Template | null>>();
  private readonly patched = new WeakSet<Material>();
  private readonly assets: Assets;
  private readonly opts: ActorOptions;
  /** called once per template when it is built (the renderer uploads its textures and compiles its programs
   *  then, at load, instead of on the frame the unit first walks into view) */
  onReady: ((scene: Object3D, crowd: CrowdBake | null, again: boolean) => void) | null = null;
  private readonly built: { t: Template; accentName: string; char: CharLight; structure: boolean }[] = [];

  constructor(catalog: CatalogT, assets: Assets, opts: ActorOptions) {
    this.assets = assets;
    this.opts = opts;
    for (const f of catalog.fighters) this.fighters.set(f.id, f);
    for (const u of catalog.units) this.units.set(u.id, u);
    for (const s of catalog.skins) this.skins.set(s.id, s.model);
  }

  fighter(id: string): FighterDefT | undefined { return this.fighters.get(id); }
  unit(id: string): UnitDefT | undefined { return this.units.get(id); }

  /**
   * Every model ref a match needs (loading screen preload). `teams`: the sides on the field (seats and
   * structure placements); null in FFA modes, where every unit shows `art.model` (CONTRACT §12 teamModels).
   */
  refsFor(fighters: { fighter: string; skin: string }[], unitIds: Iterable<string>, teams: Iterable<TeamId> | null = null): string[] {
    const out = new Set<string>();
    for (const s of fighters) {
      const f = this.fighters.get(s.fighter);
      if (f) out.add(f.art.model);
      const sk = this.skins.get(s.skin);
      if (sk) out.add(sk);
    }
    const ts = teams ? [...new Set(teams)] : [];
    for (const u of unitIds) {
      const d = this.units.get(u);
      if (!d) continue;
      if (!d.art.teamModels?.length || ts.length === 0) out.add(d.art.model);
      else for (const t of ts) out.add(this.unitModelRef(d, t));
    }
    return [...out];
  }

  /** the model a unit of `team` shows: art.teamModels[team], else art.model (null team = FFA / no fixed sides) */
  unitModelRef(def: UnitDefT, team: TeamId | null): string {
    const tm = def.art.teamModels;
    return team !== null && team >= 0 && tm && team < tm.length ? tm[team] : def.art.model;
  }

  private patchMaterials(root: Object3D, char: CharLight, accentName: string): void {
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (this.patched.has(mat)) continue;
        this.patched.add(mat);
        // opaque without the OPAQUE define: a veil or the structure fade then keys the same program (world_material.ts)
        opaqueVeilable(mat);
        if (mat.name === accentName) continue; // patched per actor clone
        patchWorldMaterial(mat, char);
      }
    });
  }

  fighterTemplate(fighterId: string, skinId: string | undefined): Promise<Template | null> {
    const key = `f:${fighterId}:${skinId ?? ''}`;
    let p = this.templates.get(key);
    if (p) return p;
    const def = this.fighters.get(fighterId);
    if (!def) return Promise.resolve(null);
    const skinRef = skinId ? this.skins.get(skinId) : undefined;
    p = (async (): Promise<Template | null> => {
      const base = await this.assets.model(def.art.model);
      const skin = skinRef && skinRef !== def.art.model ? await this.assets.model(skinRef) : null;
      const body: LoadedModel | null = skin?.renderable ? skin : base?.renderable ? base : null;
      if (body) {
        const clips = new Map<string, AnimationClip>();
        for (const c of base?.gltf.animations ?? []) clips.set(c.name, c);
        for (const c of body.gltf.animations) if (!clips.has(c.name)) clips.set(c.name, c);
        this.patchMaterials(body.gltf.scene, charLight('fighter'), def.art.accentMaterial);
        const hull = hullPlan(body.gltf.scene);
        await lodReady;                                                    // perf PERF-m5: the match body's LOD1
        return { scene: body.gltf.scene, clips, roles: def.art.clips as Record<string, string | undefined>, fit: 1, dev: false, hull, bodyLod: bodyLodOf(body.gltf.scene, hull) };
      }
      if (this.opts.dev && this.opts.devModelUrl) {
        const m = await this.assets.modelUrl(this.opts.devModelUrl);
        if (m?.renderable) {
          const clips = new Map<string, AnimationClip>();
          for (const c of m.gltf.animations) clips.set(c.name, c);
          this.patchMaterials(m.gltf.scene, charLight('fighter'), def.art.accentMaterial);
          const roles: Record<string, string> = {};
          for (const c of clips.keys()) roles[c] = c;
          return { scene: m.gltf.scene, clips, roles, fit: def.art.height / DEV_MANNEQUIN_HEIGHT, dev: true, hull: hullPlan(m.gltf.scene) };
        }
      }
      return null;
    })().then((t) => this.ready(t, def.art.accentMaterial, charLight('fighter')));
    this.templates.set(key, p);
    return p;
  }

  private ready(t: Template | null, accentName: string, char: CharLight, structure = false): Template | null {
    if (t && !this.built.some((b) => b.t === t)) {
      // skinned parts: a bind-pose bounding sphere per clone (three would otherwise skin every vertex on the CPU
      // to compute it the first time the part is sorted; the actor cull and the hover pick never use it)
      t.scene.traverse((o) => { const m = o as SkinnedMesh; if (m.isSkinnedMesh && !m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); });
      const b = { t, accentName, char, structure };
      // a structure's materials carry the occlusion fade's code from the start (structures.ts): the warm-up builds the
      // program the structure draws with, faded or not
      if (structure) t.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) for (const x of Array.isArray(m.material) ? m.material : [m.material]) if (x.name !== accentName) structureMaterial(x); });
      this.built.push(b);
      this.warm(b, false);
    }
    return t;
  }

  /** every template built so far, warmed again (the match's lighting and environment are part of a program's key) */
  warmAll(): void { for (const b of this.built) this.warm(b, true); }

  private warm(b: { t: Template; accentName: string; char: CharLight; structure: boolean }, again: boolean): void {
    const t = b.t;
    // actors draw a per-actor PATCHED clone of the accent, never the template's own: the warm-up compiles that
    // variant (one clone kept per template so its program stays alive), not the unpatched one
    const swaps: [Mesh, Material][] = [];
    t.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.material.name !== b.accentName) return;
      if (!t.warmAccent) { const c = (m.material as MeshStandardMaterial).clone(); patchWorldMaterial(c, b.char); if (b.structure) structureMaterial(c); t.warmAccent = c; }
      swaps.push([m, m.material]);
      m.material = t.warmAccent;
    });
    try { this.onReady?.(t.scene, t.crowd ?? null, again); } finally { for (const [m, mat] of swaps) m.material = mat; }
  }

  /** one template per (unit, model): `team` picks art.teamModels[team] (null = FFA → art.model); a team model
   *  that fails to load falls back to art.model */
  unitTemplate(unitId: string, team: TeamId | null = null): Promise<Template | null> {
    const def = this.units.get(unitId);
    if (!def) return Promise.resolve(null);
    const ref = this.unitModelRef(def, team);
    const key = `u:${unitId}:${ref}`;
    let p = this.templates.get(key);
    if (p) return p;
    p = (async (): Promise<Template | null> => {
      const m = await this.assets.model(ref);
      if (!m?.renderable && ref !== def.art.model) return this.unitTemplate(unitId, null);
      if (m?.renderable) {
        const clips = new Map<string, AnimationClip>();
        for (const c of m.gltf.animations) clips.set(c.name, c);
        this.patchMaterials(m.gltf.scene, charLight(def.kind), 'accent');
        const roles: Record<string, string | undefined> = { ...def.art.clips };
        for (const c of clips.keys()) if (!(c in roles)) roles[c] = c;
        const hull = hullPlan(m.gltf.scene);
        if (def.art.instanced) await lodReady;                             // perf PERF-m5: the crowd's LODs (crowd.ts)
        const crowd = def.art.instanced && this.opts.crowd !== false ? bakeCrowd(m.gltf.scene, clips, hull, 'accent', CROWD_MAX_ROWS, def.kind === 'monster') : null;
        return { scene: m.gltf.scene, clips, roles, fit: 1, dev: false, hull, crowd };
      }
      if (this.opts.dev) return devUnitTemplate(def);
      return null;
    })().then((t) => this.ready(t, 'accent', charLight(def.kind), def.kind === 'structure'));
    this.templates.set(key, p);
    return p;
  }
}

// ── dev-only debug geometry (behind ?dev=1; never shipped as art) ─────────────────────────────────
let devClay: MeshStandardMaterial | null = null;
function devUnitTemplate(def: UnitDefT): Template {
  devClay ??= (() => { const m = new MeshStandardMaterial({ color: new Color().setStyle('#8C877C'), roughness: 0.8 }); m.name = 'dev_clay'; patchWorldMaterial(m); return m; })();
  const accent = new MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  accent.name = 'accent';
  const g = new Group();
  g.name = 'dev_placeholder';
  const h = Math.max(0.4, def.art.height);
  const r = Math.max(0.2, def.collisionRadius || 0.4);
  if (def.kind === 'structure') {
    const pts = [new Vector2(r * 1.05, 0), new Vector2(r * 1.05, 0.5), new Vector2(r * 0.8, 0.7), new Vector2(r * 0.55, h * 0.75), new Vector2(r * 0.38, h * 0.92), new Vector2(0.02, h)];
    const body = new Mesh(new LatheGeometry(pts, 10), devClay);
    const band = new Mesh(new CylinderGeometry(r * 0.6, r * 0.62, 0.3, 10, 1, true), accent);
    band.position.y = h * 0.62;
    g.add(body, band);
  } else if (def.kind === 'pickup' || def.kind === 'ward') {
    const body = new Mesh(new OctahedronGeometry(Math.min(0.35, h * 0.35), 0), accent);
    body.position.y = h * 0.6;
    g.add(body);
  } else {
    const body = new Mesh(new CapsuleGeometry(r * 0.75, Math.max(0.05, h - r * 1.5), 3, 8), devClay);
    body.position.y = h / 2;
    const band = new Mesh(new CylinderGeometry(r * 0.78, r * 0.78, 0.12, 8, 1, true), accent);
    band.position.y = h * 0.78;
    g.add(body, band);
  }
  g.traverse((o) => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { scene: g, clips: new Map(), roles: {}, fit: 1, dev: true, hull: hullPlan(g) };
}

// ── actor ────────────────────────────────────────────────────────────────────────────────────────
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function luma(c: Color): number { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

export class Actor implements CrowdActor {
  readonly id: number;
  readonly kind: ActorKind;
  readonly def: string;
  team: TeamId;
  owner: number;
  readonly root = new Group();
  model: Object3D | null = null;
  dev = false;
  /** bar anchor height above the ground (art height × scale + 0.35 m) */
  barHeight = 2.2;
  artHeight = 1.9;
  radius = 0.5;
  runRef = 3.6;
  attackWindup = 0.3;
  /** interpolation state */
  px = 0; py = 0; ph = 0; pf = 0;
  cx = 0; cy = 0; ch = 0; cf = 0;
  x = 0; y = 0; h = 0; facing = 0;
  seenTick = -1;
  view: EntityView | null = null;
  visible = true;
  /** fades out after the entity left the view (corpse removal) */
  leaving = -1;
  // bars
  trail = 1;
  trailFrom = 1;
  trailHoldUntil = -1;
  lastHpFrac = 1;
  // animation
  private mixer: MixerLike | null = null;
  private template: Template | null = null;
  private readonly actions = new Map<string, ActionLike>();
  private current: ActionLike | null = null;
  private currentKey = '';
  private lastStateTime = 0;
  private accent: MeshStandardMaterial[] = [];
  private accentColor = new Color();
  private accentHex = '';
  private glow = ACCENT_REST;
  private sockets = new Map<string, Object3D>();
  private socketNames: Record<string, string> = {};
  // outline hull + hit flash (prebuilt hidden in attach; style changes never touch the scene graph). The ink programs
  // (ink.ts): one material per vertex path the hull parts take, every one driven by the same uniforms
  private outlineU: OutlineU | null = null;
  private flashU: FlashU | null = null;
  private readonly inkMats: Material[] = [];
  private readonly hullMeshes: Mesh[] = [];
  private readonly flashMeshes: Mesh[] = [];
  /** the hull parts this actor's copies are built from: the template's, or its body LOD1's (attach) */
  private hullParts: HullPart[] = [];
  /** env F4: the occluded silhouette (fighters only; ink.ts xray): hidden unless the renderer finds cover between the
   *  body and the camera */
  private xrayU: XrayU | null = null;
  private readonly xrayMeshes: Mesh[] = [];
  private xrayOn = false;
  private outlinePx = -1;
  private readonly outlineColor = new Color();
  private outlineOpacity = -1;
  /** frames left of the one-frame shader warm-up (programs compile at spawn, never on the first hover or hit) */
  private warm = 0;
  // victim reaction envelopes (presentation only)
  private flashT = -1;
  private flashK0 = 0;
  private wobT = -1;
  private wobK = 0;
  private wobSquash = 0;
  private readonly wobDir = new Vector2();
  private baseScale = 1;
  /** animation LOD: dt held back while the mixer is skipped (off-frustum) or throttled (distant wicks) */
  private animAcc = 0;
  disposed = false;

  constructor(v: EntityView) {
    this.id = v.id;
    this.kind = v.kind as ActorKind;
    this.def = v.def;
    this.team = v.team;
    this.owner = v.owner;
    this.root.name = `actor_${v.kind}_${v.id}`;
    this.px = this.cx = this.x = v.x;
    this.py = this.cy = this.y = v.y;
    this.ph = this.ch = this.h = v.height;
    this.pf = this.cf = this.facing = v.facing;
    this.radius = v.radius;
    // a culled actor (outside the view and its shadow reach) is neither drawn nor matrix-updated: three
    // re-multiplies every node's world matrix every frame, and a fighter or wick carries 40-90 bone nodes
    const root = this.root;
    root.updateMatrixWorld = (force?: boolean): void => { if (!this.culled) Group.prototype.updateMatrixWorld.call(root, force); };
  }

  /** not drawn this frame (outside the view frustum and its shadow reach, or out of vision; renderer.updateActors):
   *  root hidden, no matrix work */
  culled = false;

  configureFighter(def: FighterDefT): void {
    this.artHeight = def.art.height * def.art.scale;
    this.barHeight = this.artHeight + 0.35;
    this.runRef = def.art.runRefSpeed;
    this.attackWindup = def.attack.windup;
    this.socketNames = def.art.sockets;
  }
  configureUnit(def: UnitDefT): void {
    this.artHeight = def.art.height * def.art.scale;
    this.barHeight = this.artHeight + 0.35;
    this.runRef = Math.max(0.5, def.base.moveSpeed ?? 3);
    this.attackWindup = def.attack?.windup ?? 0.3;
    // a unit ability whose blow lands as a delayed area (a boss's telegraphed slam): its cast clip keeps playing
    // through the delay and its impact lands on release + delay, not on release
    this.castHold.clear();
    def.abilities.forEach((a, i) => {
      const area = (a.effects as { op?: string; delay?: number }[] | undefined)?.find((e) => e.op === 'area' && (e.delay ?? 0) > 0);
      if (area) this.castHold.set(`cast_a${i + 1}`, area.delay ?? 0);
    });
  }

  /** attach the loaded template (async); safe after dispose */
  attach(t: Template | null, scale: number, accentName: string): void {
    if (this.disposed || !t) return;
    this.template = t;
    this.dev = t.dev;
    if (t.crowd) {
      // the crowd draws this unit (crowd.ts): an empty body node carries the root placement and the scale/squash
      const body = new Group();
      body.name = 'crowd_body';
      body.position.copy(t.crowd.rootPos); body.quaternion.copy(t.crowd.rootQuat); body.scale.setScalar(scale * t.fit);
      this.crowdBake = t.crowd;
      this.accent = [];
      this.formNodes = new Map();
      this.shownForm = undefined;
      this.model = body;
      this.baseScale = scale * t.fit;
      this.root.add(body);
      this.mixer = new BakedMixer(t.crowd);
      this.accentHex = '';
      return;
    }
    const model = t.clips.size > 0 || hasSkin(t.scene) ? cloneSkinned(t.scene) : t.scene.clone(true);
    // perf PERF-m5: a fighter in the match draws its face-locked LOD1 (lod.ts LOD.body; the menu showcase keeps the
    // full body) and its hull copies over it
    const lod = this.kind === 'fighter' && lodSwitch.body ? t.bodyLod ?? null : null;
    this.hullParts = lod ? lod.hull : t.hull;
    if (lod) { const b = meshesOf(model)[lod.mesh]; if (b) b.geometry = lod.geometry; }
    const s = scale * t.fit;
    model.scale.setScalar(s);
    this.accent = [];
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if ((m as SkinnedMesh).isSkinnedMesh) {
        // the actor cull (renderer.updateActors) stands in for three's: a skinned part's bounds move with the clip
        m.frustumCulled = false;
        const bs = m.geometry.boundingSphere;
        if (bs) (m as SkinnedMesh).boundingSphere = bs.clone();
      }
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const next = mats.map((mat) => {
        if (mat.name !== accentName) return mat;
        const c = (mat as MeshStandardMaterial).clone();
        patchWorldMaterial(c, charLight(this.kind));
        this.accent.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? next : next[0];
    });
    // form-swapped parts (CONTRACT §12): nodes named form_<id> show in that form, form_base when in none
    this.formNodes = new Map();
    model.traverse((o) => {
      const m = /^form_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:[._]\d+)?$/i.exec(o.name);
      if (!m) return;
      const k = m[1].toLowerCase();
      (this.formNodes.get(k) ?? this.formNodes.set(k, []).get(k)!).push(o);
    });
    this.shownForm = undefined;
    shareSkeletons(model);
    this.model = model;
    this.baseScale = s;
    this.buildHull(model, t);
    // the clone's shadow casters draw their depth through the ink programs (customDepthMaterial does not survive a clone)
    inkShadows(model);
    // perf PERF-m5: and their shadow LODs now (the template's and the body LOD1's are built: hooking is instant), not
    // whenever the renderer's per-second sweep reaches them
    shadowLods(model);
    this.root.add(model);
    if (t.clips.size > 0) this.mixer = new AnimationMixer(model);
    for (const [k, bone] of Object.entries(this.socketNames)) {
      const o = model.getObjectByName(PropertyBinding.sanitizeNodeName(bone)) ?? model.getObjectByName(bone);
      if (o) this.sockets.set(k, o);
    }
    this.accentHex = '';
  }

  /** form id → model nodes shown only in that form ('base' = no form) */
  private formNodes = new Map<string, Object3D[]>();
  private shownForm: string | null | undefined = undefined;

  /** show the nodes of the current form (a form without its own nodes keeps the base ones) */
  private applyForm(form: string | null): void {
    if (form === this.shownForm || this.formNodes.size === 0) return;
    this.shownForm = form;
    const want = form && this.formNodes.has(form) ? form : 'base';
    for (const [k, nodes] of this.formNodes) for (const n of nodes) n.visible = k === want;
  }

  /** world position of a socket (falls back to the body centre) */
  socket(name: string, out: Vector3): Vector3 {
    const o = this.sockets.get(name);
    if (o) { o.updateWorldMatrix(true, false); return out.setFromMatrixPosition(o.matrixWorld); }
    return out.set(this.x, this.h + this.artHeight * 0.55, this.y);
  }

  /** a new sim tick arrived */
  pushTick(v: EntityView, tick: number): void {
    this.view = v;
    this.applyForm(v.form ?? null);
    this.team = v.team;
    this.owner = v.owner;
    this.radius = v.radius;
    if (this.seenTick < 0) {
      this.px = this.cx = v.x; this.py = this.cy = v.y; this.ph = this.ch = v.height; this.pf = this.cf = v.facing;
    } else {
      const jump = Math.hypot(v.x - this.cx, v.y - this.cy) > SNAP_DIST;
      if (jump) { this.px = v.x; this.py = v.y; this.ph = v.height; this.pf = v.facing; } else { this.px = this.cx; this.py = this.cy; this.ph = this.ch; this.pf = this.cf; }
      this.cx = v.x; this.cy = v.y; this.ch = v.height; this.cf = v.facing;
    }
    this.seenTick = tick;
  }

  setAccentColor(hex: string, c: Color): void {
    if (hex === this.accentHex) return;
    this.accentHex = hex;
    this.accentColor.copy(c);
    for (const m of this.accent) {
      m.color.copy(c).multiplyScalar(0.3);
      m.emissive.copy(c);
      m.emissiveIntensity = this.glow;
    }
  }

  /**
   * interpolate + animate; dt real seconds, alpha the sim interpolation fraction. `lod`: 0 animate every
   * frame · 1 animate at 15 Hz (distant wicks) · 2 hold the clip (outside the frustum + margin); held time
   * is replayed when the actor animates again, so loops and one-shots stay in phase.
   */
  update(dt: number, alpha: number, lod: 0 | 1 | 2 = 0): void {
    const a = Math.max(0, Math.min(1, alpha));
    this.x = this.px + (this.cx - this.px) * a;
    this.y = this.py + (this.cy - this.py) * a;
    this.h = this.ph + (this.ch - this.ph) * a;
    this.facing = lerpAngle(this.pf, this.cf, a);
    this.root.position.set(this.x, this.h, this.y);
    this.root.rotation.y = Math.PI / 2 - this.facing;
    if (this.leaving >= 0) {
      this.leaving += dt;
      const k = Math.min(1, this.leaving / 0.6);
      this.root.position.y -= k * k * 0.5;
    }
    const v = this.view;
    if (!v) return;

    // accent: rest ≤ 0.8; wind-ups (cast before release) ramp above the bloom threshold
    const windup = v.state === 'cast' && v.stateDuration > 0 ? Math.min(1, (v.stateTime + a * TICK_DT) / Math.max(0.05, v.stateDuration)) : 0;
    const peak = Math.max(ACCENT_WINDUP_MIN, 1.35 / Math.max(0.05, luma(this.accentColor)));
    const target = v.alive && windup > 0 ? ACCENT_REST + (peak - ACCENT_REST) * Math.min(1, windup * 1.6) : ACCENT_REST;
    this.glow += (target - this.glow) * Math.min(1, dt * 18);
    for (const m of this.accent) m.emissiveIntensity = this.glow;
    this.tickReactions(dt);

    if (this.mixer && this.template) {
      this.animAcc = Math.min(1, this.animAcc + dt);
      if (lod === 2 || (lod === 1 && this.animAcc < ANIM_FAR_DT - 1e-4)) return;
      const step = this.animAcc;
      this.animAcc = 0;
      this.animate(v, step, a);
    }
  }

  private clipFor(role: string): AnimationClip | null {
    const t = this.template!;
    const tryRole = (r: string): AnimationClip | null => {
      const name = t.roles[r];
      return (name && t.clips.get(name)) || t.clips.get(r) || null;
    };
    for (const r of CLIP_CHAIN[role] ?? [role, 'idle']) { const c = tryRole(r); if (c) return c; }
    return null;
  }

  private action(role: string): ActionLike | null {
    let act = this.actions.get(role);
    if (act) return act;
    const clip = this.clipFor(role);
    if (!clip || !this.mixer) return null;
    act = this.mixer.clipAction(clip);
    if (LOOPING.has(role) || role === 'run' || role === 'idle') act.setLoop(LoopRepeat, Infinity);
    else { act.setLoop(LoopOnce, 1); act.clampWhenFinished = true; }
    this.actions.set(role, act);
    return act;
  }

  private roleOf(v: EntityView): string {
    switch (v.state) {
      case 'idle': return 'idle';
      case 'move': return 'run';
      case 'attack': return v.anim === 'crit' || v.anim === 'attack2' ? v.anim : 'attack1';
      case 'cast': return v.anim && v.anim !== 'cast' ? v.anim : 'cast_a1';
      case 'channel': return 'channel';
      case 'dash': return v.anim === 'stunned' ? 'stunned' : v.anim || 'dash';
      case 'stunned': return 'stunned';
      case 'dead': return 'death';
      case 'recall': return 'recall';
      default: return 'idle';
    }
  }

  /** unit cast role -> its delayed area's delay (s) */
  private readonly castHold = new Map<string, number>();
  /** a held cast clip playing on after its cast state: role, seconds since the cast began, impact time;
   *  `still`: only while the unit stands (a step cancels it into the run) — follow-throughs and instant casts */
  private hold: { role: string; t: number; impact: number; still?: boolean } | null = null;
  /** the cast clip of the current cast state (its follow-through continues when the cast releases) */
  private castTrack: { role: string; t: number; impact: number } | null = null;

  /** an instant cast (castTime 0: the sim releases it in the tick it starts, so the unit never shows a
   *  'cast' state): play the slot's cast clip at the pace of a short cast, entered part-way through its
   *  wind-up so the impact frame lands INSTANT_LEAD_S after the event, then follow through */
  instantCast(role: string): void {
    if (!this.mixer || !this.action(role)) return;
    this.hold = { role, t: INSTANT_PACE_S - INSTANT_LEAD_S, impact: INSTANT_PACE_S, still: true };
    this.castTrack = null;
  }

  /** drive the clip for one frame */
  private animate(v: EntityView, dt: number, alpha: number): void {
    let role = this.roleOf(v);
    // held casts: entering a held cast starts the hold; afterwards idle/run keep the cast clip until it ends
    const delay = this.castHold.get(role);
    if (v.state === 'cast' && delay !== undefined) {
      if (!this.hold || this.hold.role !== role || v.stateTime < this.hold.t - 0.25) {
        this.hold = { role, t: v.stateTime, impact: Math.max(0.05, v.stateDuration) + delay };
      } else this.hold.t = v.stateTime;
      this.castTrack = null;
    } else if (v.state === 'cast' && role.startsWith('cast_')) {
      // remember where the cast clip is, so its follow-through can continue past the release
      this.castTrack = { role, t: v.stateTime, impact: v.stateDuration > 0.02 ? v.stateDuration : 0.25 };
      this.hold = null;
    } else {
      // the cast just released into a stand: keep its follow-through (60 % of the clip after the impact)
      if (this.castTrack && !this.hold && v.state === 'idle') this.hold = { ...this.castTrack, still: true };
      this.castTrack = null;
      if (this.hold) {
        this.hold.t += dt;
        const clip = this.action(this.hold.role)?.getClip();
        const end = this.hold.impact / IMPACT_AT * (clip ? 1 : 0);
        const standing = v.state === 'idle' || (!this.hold.still && v.state === 'move');
        if (standing && this.hold.t < end) role = this.hold.role;
        else this.hold = null;
      }
    }
    const restarted = v.stateTime + 1e-6 < this.lastStateTime;
    this.lastStateTime = v.stateTime;
    const key = role;
    let act = this.current;
    const held = !!this.hold && v.state !== 'cast' && role === this.hold.role;     // a held cast must not restart
    if (key !== this.currentKey || (restarted && !held && !LOOPING.has(role) && role !== 'run' && role !== 'death')) {
      const next = this.action(role);
      if (next) {
        const fade = role.startsWith('attack') || role === 'crit' ? 0.06 : 0.1;
        next.reset();
        next.enabled = true;
        next.setEffectiveWeight(1);
        if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
        else next.fadeIn(fade);
        next.play();
        act = next;
      }
      this.current = act;
      this.currentKey = key;
    }
    if (act) {
      const clipDur = act.getClip().duration || 1;
      const st = Math.max(0, v.stateTime + (v.state === 'dead' ? 0 : alpha * TICK_DT));
      if (role === 'run') {
        const speed = Math.hypot(v.vx, v.vy);
        act.timeScale = Math.max(0.35, Math.min(2.2, speed / Math.max(0.1, this.runRef)));
      } else if (role.startsWith('attack') || role === 'crit') {
        const impact = Math.max(0.05, this.attackWindup * (v.stateDuration || 1));
        act.timeScale = 0;
        act.time = Math.min(clipDur - 1e-3, st * (IMPACT_AT * clipDur) / impact);
      } else if (this.hold && role === this.hold.role) {
        // a held cast: the clip's impact (40 %) lands on release + the area's delay, then follows through
        act.timeScale = 0;
        act.time = Math.min(clipDur - 1e-3, this.hold.t * (IMPACT_AT * clipDur) / this.hold.impact);
      } else if (role.startsWith('cast_') && v.state === 'cast') {
        const impact = v.stateDuration > 0.02 ? v.stateDuration : 0.25;
        act.timeScale = 0;
        // past the release (stateDuration), keep playing the follow-through at the same rate
        act.time = Math.min(clipDur - 1e-3, st * (IMPACT_AT * clipDur) / impact);
      } else if (role === 'dash' && v.stateDuration > 0) {
        act.timeScale = 0;
        act.time = Math.min(clipDur - 1e-3, (st / v.stateDuration) * clipDur);
      } else if (role === 'death') {
        act.timeScale = 1; // plays once, clampWhenFinished holds the last frame
      } else {
        act.timeScale = 1;
      }
    }
    this.mixer!.update(dt);
  }

  /** showcase (menu plinth): loop one role regardless of any view */
  pose(role: string, dt: number): void {
    if (!this.mixer || !this.template) return;
    if (this.currentKey !== role) {
      const next = this.action(role);
      if (next) {
        next.reset(); next.setLoop(LoopRepeat, Infinity); next.enabled = true; next.setEffectiveWeight(1);
        if (this.current && this.current !== next) next.crossFadeFrom(this.current, 0.2, false); else next.fadeIn(0.2);
        next.play();
        this.current = next;
      }
      this.currentKey = role;
    }
    this.tickReactions(dt);
    this.mixer.update(dt);
  }

  // ── outline hull + hit flash ────────────────────────────────────────────────────────────────────
  /** clone the template's hull parts onto this actor's model, hidden (one warm-up frame compiles the programs) */
  private buildHull(model: Object3D, t: Template): void {
    if (!this.hullParts.length) return;
    const cm = meshesOf(model);
    const ou = (this.outlineU = outlineU()), fu = (this.flashU = flashU());
    if (lodSwitch.outline) fu.uBias.value = FLASH_LOD_BIAS_M;
    const mats: Partial<Record<InkPath, [Material, Material]>> = {};
    const inkFor = (path: InkPath): [Material, Material] => {
      let m = mats[path];
      if (!m) { m = mats[path] = [outlineMaterial(path, ou), flashMaterial(path, fu)]; this.inkMats.push(...m); }
      return m;
    };
    for (const part of this.hullParts) {
      const lead = cm[part.lead];
      if (!lead) continue;
      const pair = inkFor(part.skinned && (lead as SkinnedMesh).isSkinnedMesh ? 'skin' : 'rigid');
      for (const flash of [false, true]) {
        const mat = flash ? pair[1] : pair[0];
        const geo = part.ink ?? (lodSwitch.outline ? outlineGeometry(part.geometry) : part.geometry);
        let copy: Mesh;
        if (part.skinned && (lead as SkinnedMesh).isSkinnedMesh) {
          const sm = lead as SkinnedMesh;
          const c = new SkinnedMesh(geo, mat);
          c.bind(sm.skeleton, sm.bindMatrix);
          c.frustumCulled = false;
          if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
          c.boundingSphere = part.geometry.boundingSphere!.clone();
          copy = c;
        } else copy = new Mesh(geo, mat);
        copy.name = flash ? 'vale_flash' : 'vale_outline';
        copy.userData.valeOutline = true;
        copy.castShadow = false; copy.receiveShadow = false;
        copy.renderOrder = flash ? 2 : 1;
        copy.matrixAutoUpdate = false;
        lead.add(copy);
        (flash ? this.flashMeshes : this.hullMeshes).push(copy);
      }
    }
    this.warm = 2;
    this.outlinePx = -1;
    this.applyOutline();
    for (const m of this.flashMeshes) m.visible = true;
    if (this.kind === 'fighter') this.buildXray(cm);
  }

  /** env F4: one silhouette copy per hull part (the flash's front faces, same program), hidden; tokens.json
   *  `hud.unitOutline.occluded` (OCCLUDED) sets its fill, edge and bias */
  private buildXray(cm: Mesh[]): void {
    const u = (this.xrayU = xrayU());
    u.uAlpha.value = OCCLUDED.fill; u.uPx.value = OCCLUDED.edgePx; u.uBias.value = OCCLUDED.biasM;
    const mats: Partial<Record<InkPath, Material>> = {};
    for (const part of this.hullParts) {
      const lead = cm[part.lead];
      if (!lead) continue;
      const path: InkPath = part.skinned && (lead as SkinnedMesh).isSkinnedMesh ? 'skin' : 'rigid';
      let mat = mats[path];
      if (!mat) { mat = mats[path] = xrayMaterial(path, u); this.inkMats.push(mat); }
      const geo = part.ink ?? (lodSwitch.outline ? outlineGeometry(part.geometry) : part.geometry);   // perf PERF-m5 (FLASH_LOD_BIAS_M)
      let copy: Mesh;
      if (path === 'skin') {
        const sm = lead as SkinnedMesh;
        const c = new SkinnedMesh(geo, mat);
        c.bind(sm.skeleton, sm.bindMatrix);
        c.frustumCulled = false;
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
        c.boundingSphere = part.geometry.boundingSphere!.clone();
        copy = c;
      } else copy = new Mesh(geo, mat);
      copy.name = 'vale_xray';
      copy.userData.valeOutline = true;
      copy.userData.valeXray = true;
      copy.castShadow = false; copy.receiveShadow = false;
      copy.renderOrder = XRAY_ORDER;
      copy.matrixAutoUpdate = false;
      copy.visible = false;
      lead.add(copy);
      this.xrayMeshes.push(copy);
    }
  }

  /** env F4: show the occluded silhouette in `color` (linear; the unit's readability colour) or hide it. Cheap to
   *  call every frame. */
  setXray(on: boolean, color: Color | null = null): void {
    const want = on && this.xrayMeshes.length > 0;
    if (want && color) this.xrayU!.uColor.value.copy(color);
    if (want === this.xrayOn) return;
    this.xrayOn = want;
    for (const m of this.xrayMeshes) m.visible = want;
  }
  /** is the occluded silhouette drawn this frame (harness) */
  get xray(): boolean { return this.xrayOn; }

  // ── crowd surface (crowd.ts CrowdActor) ────────────────────────────────────────────────────────
  /** the baked crowd form this actor draws through, or null (a per-actor model) */
  crowdBake: CrowdBake | null = null;
  get accentKey(): string { return this.accentHex; }
  get accentTint(): Color { return this.accentColor; }
  get glowLevel(): number { return this.glow; }
  get restOutline(): { px: number; color: Color; opacity: number } { this.restOut.px = Math.max(0, this.outlinePx); this.restOut.opacity = this.outlineOpacity; return this.restOut; }
  private readonly restOut = { px: 0, color: this.outlineColor, opacity: 0 };
  get flashState(): { k: number; color: Color; rim: Color | null } { this.flashOut.k = this.flashK; this.flashOut.rim = this.flashInk ? this.flashRim : null; return this.flashOut; }
  private readonly flashOut: { k: number; color: Color; rim: Color | null } = { k: 0, color: new Color(), rim: null };
  crowdPose(out: { a: number; b: number; w: number }): void {
    if (this.mixer instanceof BakedMixer) this.mixer.pose(out); else { out.a = out.b = 0; out.w = 1; }
  }

  /** outline style: `px` ≤ 0 hides it; colour linear; opacity 0..1. Cheap to call every frame. */
  setOutline(px: number, color: Color, opacity = 1): void {
    if (!this.outlineU && !this.crowdBake) return;
    if (px === this.outlinePx && opacity === this.outlineOpacity && color.equals(this.outlineColor)) return;
    this.outlinePx = px; this.outlineOpacity = opacity; this.outlineColor.copy(color);
    this.applyOutline();
  }
  hideOutline(): void { this.setOutline(0, this.outlineColor, 0); }

  // ── veils (invisible / untargetable: see the header) ──────────────────────────────────────────────
  private veilMode: 0 | 1 | 2 = 0;
  /** shared body material → this actor's see-through clone */
  private readonly veilMats = new Map<Material, MeshStandardMaterial>();
  /** body meshes and the material(s) they wore before the veil */
  private readonly veilBase = new Map<Mesh, Material | Material[]>();
  /** depth-only copies of the body (the hull geometry), drawn last among the opaque: the see-through body then
   *  shows only its nearest surface (no inner layers, no sorting artefacts) */
  private readonly veilDepth: Mesh[] = [];
  private readonly veilDepthMats: Material[] = [];
  /** 0 none · 1 invisible (seen by allies: 35 % body, no ink outline) · 2 untargetable (60 % body, dawnglass rim) */
  get veil(): 0 | 1 | 2 { return this.veilMode; }
  setVeil(mode: 0 | 1 | 2): void {
    if (mode === this.veilMode || !this.model || this.crowdBake) return;
    this.veilMode = mode;
    const on = mode !== 0;
    const k = mode === 1 ? VEIL_GHOST : VEIL_GLASS;
    if (on && !this.veilDepth.length && this.hullParts.length) this.buildVeilDepth(this.model);
    const prepass = this.veilDepth.length > 0;
    for (const m of this.veilDepth) m.visible = on;
    const accent = new Set<Material>(this.accent);
    // see-through on the very program the body draws with (world_material.ts veilOn: the body is opaqueVeilable)
    const see = (c: Material, base: number): void => veilOn(c, base * k, !prepass);
    this.model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.userData.valeOutline) return;
      if (!on) {
        const base = this.veilBase.get(m);
        if (base) { m.material = base; m.castShadow = true; }
        return;
      }
      const base = this.veilBase.get(m) ?? m.material;
      this.veilBase.set(m, base);
      // a veiled body throws no shadow (an unseen unit leaves no dark print; no see-through shadow programs either)
      m.castShadow = false;
      const swap = (mat: Material): Material => {
        if (accent.has(mat)) return mat;     // per-actor already: set below
        let c = this.veilMats.get(mat);
        if (!c) {
          c = (mat as MeshStandardMaterial).clone();
          patchWorldMaterial(c, charLight(this.kind));
          this.veilMats.set(mat, c);
        }
        see(c, mat.transparent ? mat.opacity : 1);
        return c;
      };
      m.material = Array.isArray(base) ? base.map(swap) : swap(base);
    });
    for (const a of this.accent) {
      if (on) see(a, 1); else veilOff(a);
    }
    this.applyOutline();
  }

  /** the depth prepass of the veil: one depth-only copy per hull part, bound to the body's skeleton */
  private buildVeilDepth(model: Object3D): void {
    const cm = meshesOf(model).filter((m) => !m.userData.valeOutline);
    const mats: Partial<Record<InkPath, Material>> = {};
    for (const part of this.hullParts) {
      const lead = cm[part.lead];
      if (!lead) continue;
      const path: InkPath = part.skinned && (lead as SkinnedMesh).isSkinnedMesh ? 'skin' : 'rigid';
      let mat = mats[path];
      if (!mat) { mat = mats[path] = prepassMaterial(path); this.veilDepthMats.push(mat); }
      let copy: Mesh;
      if (path === 'skin') {
        const sm = lead as SkinnedMesh;
        const c = new SkinnedMesh(part.geometry, mat);
        c.bind(sm.skeleton, sm.bindMatrix);
        c.frustumCulled = false;
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
        c.boundingSphere = part.geometry.boundingSphere!.clone();
        copy = c;
      } else copy = new Mesh(part.geometry, mat);
      copy.name = 'vale_veil_depth';
      copy.userData.valeOutline = true;
      copy.castShadow = false; copy.receiveShadow = false;
      copy.renderOrder = 50;                 // after every opaque draw (the ground behind must already be there)
      copy.matrixAutoUpdate = false;
      lead.add(copy);
      this.veilDepth.push(copy);
    }
  }
  /** the outline width in px the viewer sees: the hover rim's while hovered, else the rest ink's (0 = none; harness) */
  get outlineWidth(): number { return this.hoverPx > 0 ? this.hoverPx : Math.max(0, this.outlinePx); }

  /** hover rim (drawn by overlay/hover.ts in the overlay pass, on top of the rest ink): px ≤ 0 = none; colour linear */
  setHover(px: number, color: Color | null): void {
    this.hoverPx = this.outlineU || this.crowdBake ? Math.max(0, px) : 0;
    if (color) this.hoverColor.copy(color);
  }
  private hoverPx = 0;
  private readonly hoverColor = new Color();
  /** what the overlay hover pass draws: the body silhouette (hull geometry) and the hull, or null (no rim) */
  hoverTarget(): { model: Object3D; mask: readonly Mesh[]; hull: readonly Mesh[]; px: number; color: Color } | null {
    if (this.hoverPx <= 0 || !this.model || !this.root.visible || this.disposed || this.crowdBake) return null;
    return { model: this.model, mask: this.flashMeshes, hull: this.hullMeshes, px: this.hoverPx, color: this.hoverColor };
  }
  /** the hover rim's width (px, 0 = none) and colour (the crowd draws a crowd unit's rim itself) */
  get hoverWidth(): number { return this.hoverPx; }
  get hoverTint(): Color { return this.hoverColor; }

  private applyOutline(): void {
    const u = this.outlineU;
    if (!u) return;
    // veils: an unseen unit has no ink edge (the ground shows through it); an untargetable one a dawnglass rim
    const veil = this.veilMode;
    const px = veil === 1 ? 0 : veil === 2 && this.outlinePx > 0 ? Math.max(VEIL_RIM_PX, this.outlinePx) : this.outlinePx;
    const on = px > 0;
    u.uPx.value = Math.max(0, px);
    if (veil === 2) u.uColor.value.copy(VEIL_RIM); else u.uColor.value.copy(this.outlineColor);
    u.uAlpha.value = on ? (veil === 2 ? VEIL_RIM_ALPHA : this.outlineOpacity) : 0;
    const vis = on || this.warm > 0;
    for (const m of this.hullMeshes) m.visible = vis;
  }

  /** victim flash at strength k (≈ 0.45 basic … 1.0 ultimate): `rim` set = the Shade treatment (ink body, rim colour) */
  flash(k: number, color: Color, rim: Color | null = null): void {
    const fm = this.flashU;
    if ((!fm && !this.crowdBake) || !(k > 0)) return;
    // a weaker hit never cuts a stronger flash short
    const cur = this.flashT >= 0 ? this.flashK0 * Math.exp(-this.flashT / FLASH_TAU) : 0;
    if (k < cur) return;
    this.flashT = 0; this.flashFresh = true; this.flashK0 = k;
    this.flashOut.color.copy(color);
    this.flashInk = !!rim;
    if (rim) this.flashRim.copy(rim);
    this.setFlashK(k);
    if (fm) {
      fm.uFlashColor.value.copy(color);
      fm.uFlashInk.value = rim ? 1 : 0;
      if (rim) fm.uFlashRim.value.copy(rim);
      for (const m of this.flashMeshes) m.visible = true;
    }
  }
  private flashFresh = false;
  private flashK = 0;
  private flashInk = false;
  private readonly flashRim = new Color();
  private setFlashK(k: number): void {
    this.flashK = k;
    if (this.flashU) this.flashU.uFlashK.value = k;
  }
  /** a flash that started this frame or the last few: scale it (FeelL.hitFlash); false when none is live */
  boostFlash(mult: number): boolean {
    if (this.flashT < 0 || this.flashT > 0.05 || (!this.flashU && !this.crowdBake)) return false;
    this.flashK0 = Math.min(1.2, this.flashK0 * mult);
    this.setFlashK(this.flashK0 * Math.exp(-this.flashT / FLASH_TAU));
    return true;
  }
  /** current flash strength (harness) */
  get flashLevel(): number { return this.flashK; }

  /** flinch away from (dx, dz) by k metres with a squash of `squash` (0..0.3) */
  flinch(dx: number, dz: number, k: number, squash: number): void {
    const l = Math.hypot(dx, dz);
    if (l > 1e-4) this.wobDir.set(dx / l, dz / l); else this.wobDir.set(0, 0);
    this.wobT = 0; this.wobK = Math.min(0.15, k); this.wobSquash = Math.min(0.3, squash);
  }

  /**
   * the entity left the viewer's vision this frame: its reaction ends now. Envelopes only tick while the actor
   * updates, so a flash or squash left running would replay as a false "just hit" when the unit reappears.
   */
  hidden(): void {
    if (this.flashT >= 0) {
      this.flashT = -1;
      this.setFlashK(0);
      if (this.warm <= 0) for (const m of this.flashMeshes) m.visible = false;
    }
    if (this.wobT >= 0) {
      this.wobT = -1;
      this.model?.scale.setScalar(this.baseScale);
    }
  }

  /** per-frame envelopes: warm-up, flash decay, flinch/squash */
  private tickReactions(dt: number): void {
    if (this.warm > 0 && --this.warm === 0) {
      this.applyOutline();
      if (this.flashT < 0) for (const m of this.flashMeshes) m.visible = false;
    }
    if (this.flashT >= 0) {
      if (this.flashFresh) this.flashFresh = false; else this.flashT += dt;
      if (this.flashT > FLASH_END) {
        this.flashT = -1;
        this.setFlashK(0);
        if (this.warm <= 0) for (const m of this.flashMeshes) m.visible = false;
      } else this.setFlashK(this.flashK0 * Math.exp(-this.flashT / FLASH_TAU));
    }
    if (this.wobT >= 0) {
      this.wobT += dt;
      const u = this.wobT / WOB_DUR;
      const e = u >= 1 ? 0 : Math.sin(Math.PI * Math.sqrt(u));   // fast out, eased back
      if (u >= 1) this.wobT = -1;
      this.root.position.x += this.wobDir.x * this.wobK * e;
      this.root.position.z += this.wobDir.y * this.wobK * e;
      if (this.model) {
        const q = this.wobSquash * e, s = this.baseScale;
        this.model.scale.set(s * (1 + q * 0.5), s * (1 - q), s * (1 + q * 0.5));
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.mixer?.stopAllAction();
    if (this.mixer && this.model) this.mixer.uncacheRoot(this.model);
    this.mixer = null;
    // each clone owns its Skeleton, whose bone texture lives on the GPU until disposed (geometry and the
    // shared materials belong to the cached template and stay)
    this.model?.traverse((o) => { const sm = o as SkinnedMesh; if (sm.isSkinnedMesh) sm.skeleton.dispose(); });
    for (const m of this.accent) m.dispose();
    for (const m of this.veilMats.values()) m.dispose();
    for (const m of this.veilDepthMats) m.dispose();
    for (const m of this.inkMats) m.dispose();   // hull geometry belongs to the template's plan and stays
    this.root.removeFromParent();
  }
}

function hasSkin(o: Object3D): boolean {
  let s = false;
  o.traverse((x) => { if ((x as SkinnedMesh).isSkinnedMesh) s = true; });
  return s;
}

/**
 * One Skeleton per bone set. GLTFLoader and SkeletonUtils.clone give every skinned primitive its own Skeleton,
 * and three updates and uploads a bone texture per Skeleton per frame. A body and its accent are separate
 * skins over the same bones whose inverse bind matrices differ by the accent node's offset: when
 * IBM_A,i⁻¹ · IBM_B,i · bind_B is one matrix X for every bone, B binds A's skeleton with bindMatrix X (exactly
 * the same skinned positions; three re-derives bindMatrixInverse from matrixWorld in attached mode). A wick
 * then uploads one bone texture instead of two.
 */
function shareSkeletons(model: Object3D): void {
  const kept: SkinnedMesh[] = [];
  model.traverse((o) => {
    const sm = o as SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const s = sm.skeleton;
    for (const k of kept) {
      const ks = k.skeleton;
      if (ks === s) return;
      if (ks.bones.length !== s.bones.length || !ks.bones.every((b, i) => b === s.bones[i])) continue;
      let ok = true;
      for (let i = 0; i < s.bones.length && ok; i++) {
        _m1.copy(ks.boneInverses[i]).invert().multiply(s.boneInverses[i]).multiply(sm.bindMatrix);
        if (i === 0) _m2.copy(_m1);
        else for (let j = 0; j < 16 && ok; j++) ok = Math.abs(_m1.elements[j] - _m2.elements[j]) < 1e-4;
      }
      if (!ok) continue;
      s.dispose();
      sm.skeleton = ks;
      sm.bindMatrix.copy(_m2);
      sm.bindMatrixInverse.copy(_m2).invert();
      return;
    }
    kept.push(sm);
  });
}

/** relationship-coloured accents for every actor (called when the palette or a team changes) */
export function accentHexFor(palette: Palette, v: { team: TeamId; owner: number; kind: string }): string {
  return palette.unitHex(v.team, v.owner, v.kind === 'fighter');
}

// ── victim reactions: damage events → flash / flinch on the struck actor (presentation only) ─────────
// No hit-stop anywhere (tokens vfx.impact.simHitStop false; r12 M6 "keep hitStop at 0"): the sim never waits
// and no clip clock pauses. A VFX `feel` layer's hitStop is parsed for the schema and ignored here.
/** flash strength by tier class: T1 basic attacks and passives, T2/T3 abilities, T4 ultimates (tokens vfx.impact.victimFlash) */
const FLASH_K: Record<1 | 2 | 4, number> = { 1: VICTIM_FLASH.k.T1, 2: VICTIM_FLASH.k.T2, 4: VICTIM_FLASH.k.T4 };
const FLINCH_KINDS = new Set(['fighter', 'minion', 'monster', 'summon']);
/** a feel layer (hitFlash / squash) lands on a unit struck this recently (s), never on a bystander or the caster */
const FEEL_VICTIM_S = 0.25;

export class HitReactions {
  /** ability id → tier class (fighter kits incl. forms and recasts; anything else is an ability, T2) */
  private readonly tier = new Map<string, 1 | 2 | 4>();
  /** Settings.access.reduceMotion: no flinch or squash (the flash stays: it is information, not motion) */
  reduceMotion = false;
  private readonly cPhysical = new Color().setStyle(INK.physical);
  private readonly cMagic = new Color().setStyle(INK.magic);
  private readonly cShade = new Color().setStyle(INK.trueDmg);
  private readonly cShadeRim = new Color().setStyle(INK.noonwhite);
  private readonly cShield = new Color().setStyle(INK.shield);
  private readonly hits = new Map<number, { k: number; color: Color; rim: Color | null; src: number; cls: 1 | 2 | 4; crit: boolean }>();
  /** recent victims: actor id → presentation time and look of its last hit (feel layers resolve against these) */
  private readonly struck = new Map<number, { t: number; color: Color; rim: Color | null }>();
  private now = 0;
  /** ability id → the cast clip an INSTANT cast plays (castTime 0; its present.anim when that is a cast clip,
   *  else its slot's); abilities whose present names another clip (a dash) are driven by their own state */
  private readonly instantRole = new Map<string, string>();

  constructor(catalog: CatalogT) {
    for (const f of catalog.fighters) {
      const kits = [f.kit, ...Object.values(f.kit.passive.forms ?? {}).map((fm) => fm.kit ?? {})] as Record<string, unknown>[];
      for (const kit of kits) for (const slot of ['a1', 'a2', 'a3', 'ult'] as const) {
        const a = kit[slot] as { id: string; castTime?: number; present?: { anim?: string }; recast?: { ability: { id: string; castTime?: number; present?: { anim?: string } } } } | undefined;
        if (!a) continue;
        const t = slot === 'ult' ? 4 : 2;
        this.tier.set(a.id, t);
        if (a.recast) this.tier.set(a.recast.ability.id, t);
        const slotRole = slot === 'ult' ? 'cast_ult' : `cast_${slot}`;
        for (const ab of a.recast ? [a, a.recast.ability] : [a]) {
          if ((ab.castTime ?? 0) > 0.02) continue;
          const anim = ab.present?.anim;
          if (!anim || anim.startsWith('cast_')) this.instantRole.set(ab.id, anim ?? slotRole);
        }
      }
      this.tier.set(f.kit.passive.id, 1);
    }
  }

  /** this frame's sim events (call before the director spawns their VFX); `now` the presentation clock (s) */
  handle(events: readonly SimEvent[], actors: Map<number, Actor>, now = this.now): void {
    this.now = now;
    const hits = this.hits;
    hits.clear();
    for (const ev of events) {
      if (ev.e === 'cast' && ev.castTime <= 0.02) {
        const role = this.instantRole.get(ev.ability);
        const a = role ? actors.get(ev.src) : undefined;
        if (a && role && a.visible && a.leaving < 0) a.instantCast(role);
        continue;
      }
      if (ev.e !== 'damage') continue;
      const dst = actors.get(ev.dst);
      if (!dst || !dst.visible || dst.leaving >= 0 || !dst.model) continue;
      const cls: 1 | 2 | 4 = ev.ability ? (this.tier.get(ev.ability) ?? 2) : 1;
      let k = FLASH_K[cls] * (ev.crit ? VICTIM_FLASH.critMult : 1);
      const maxHp = dst.view?.maxHp ?? 0;
      if (ev.ability && maxHp > 0 && ev.amount < maxHp * 0.02) k *= 0.7;               // zone and DoT ticks read lighter
      const src = ev.src >= 0 ? actors.get(ev.src) : undefined;
      if (dst.kind === 'minion' && src?.kind === 'minion') k *= 0.75;                    // wave-on-wave stays quiet
      const prev = hits.get(ev.dst);
      if (prev && prev.k >= k) continue;
      const absorbed = ev.shielded > 0 && ev.amount - ev.shielded <= 1e-6;
      const color = absorbed ? this.cShield : ev.dtype === 'true' ? this.cShade : ev.dtype === 'magic' ? this.cMagic : this.cPhysical;
      hits.set(ev.dst, { k, color, rim: !absorbed && ev.dtype === 'true' ? this.cShadeRim : null, src: ev.src, cls, crit: ev.crit });
    }
    for (const [id, h] of hits) {
      const a = actors.get(id)!;
      a.flash(Math.min(1.2, h.k), h.color, h.rim);
      this.struck.set(id, { t: now, color: h.color, rim: h.rim });
      const src = h.src >= 0 ? actors.get(h.src) : undefined;
      if (!this.reduceMotion && FLINCH_KINDS.has(a.kind)) {
        const dx = src ? a.x - src.x : 0, dz = src ? a.y - src.y : 0;
        a.flinch(dx, dz, 0.03 + 0.05 * h.k, 0.02 + 0.04 * h.k);
      }
    }
  }

  /**
   * a VFX `feel` layer fired at e.at: hitFlash multiplies the flash of the unit struck there, squash squashes it.
   * Only a unit damaged within FEEL_VICTIM_S and within 1.5 m qualifies (never the caster beside it); hitStop
   * is ignored (see above).
   */
  feel(e: FeelEvent, actors: Map<number, Actor>, now = this.now): void {
    this.now = Math.max(this.now, now);
    if (!(e.hitFlash > 0 || e.squash > 0)) return;
    let best: Actor | null = null, hit: { color: Color; rim: Color | null } | null = null, bd = 1.5 * 1.5;
    for (const [id, s] of this.struck) {
      if (this.now - s.t > FEEL_VICTIM_S) { this.struck.delete(id); continue; }
      const a = actors.get(id);
      if (!a || !a.visible || a.leaving >= 0 || !a.model) continue;
      const d = (a.x - e.at.x) ** 2 + (a.y - e.at.z) ** 2;
      if (d < bd) { bd = d; best = a; hit = s; }
    }
    if (!best || !hit) return;
    if (e.hitFlash > 0 && !best.boostFlash(e.hitFlash)) best.flash(Math.min(1.2, FLASH_K[2] * e.hitFlash), hit.color, hit.rim);
    if (e.squash > 0 && !this.reduceMotion && FLINCH_KINDS.has(best.kind)) best.flinch(0, 0, 0, e.squash);
  }
}

export const _vec = new Vector3();
