// VALE render — structures (r12 M9): damage states, the collapse and the ruin, the occlusion fade, the protected shell.
//
// Presentation only: this reads EntityView (hp, alive, targetable) and the UnitDef's art; the sim never waits on it
// and never learns of it. A structure GLB carries named nodes (art/blender/units/structure_kit.py):
//   _base (the plinth) · _glow_base (its hour-ticks) · _upper (the tower) > _chip1 _chip2 _dmg1 _dmg2 _glow _core · _ruin
//   * damage (UnitDef.art.damage): past `at[k]` of max hp the `_dmg<k+1>` cracks show (dark ink with a live accent
//     seam), `_chip<k+1>` breaks off (each of its stones tumbles to the ground under gravity in ~0.5 s, then is gone)
//     and `vfx` plays once where it broke; the accent light flares (≤ 1.25 × rest for ~3 frames), then flickers,
//     deeper at the second stage, never above its rest glow (a glow is a warning). Healing 6 % past a threshold mends
//     that stage (the Hourbell regenerates).
//   * death (UnitDef.art.ruin): `collapse` s. The tower shudders with every crack lit; its top then tips over its foot
//     (away from the killer) with an accelerating fall, `breakVfx` at the break; where it lands `landVfx`; it sinks
//     through the ground and fades. The `_ruin` (≤ ruin.height m) stays for the match and the accent light dies.
//     A structure seen first already dead is a ruin at once; a gate that respawns rises out of its plinth (0.9 s).
//   * occlusion: while your fighter, the hovered or the targeted unit stands behind a live structure from the camera,
//     the structure's upper part (from 0.5 m above its plinth) fades to 35 % (in 0.15 s, back in 0.35 s): per-actor
//     see-through clones over a depth prepass, so only the nearest surface shows (the actors.ts veils use the same idea).
//     "Behind" is a world-space ray test, not a screen box: rays from the camera to 12 points on the unit's body
//     against an occluder proxy built once per template from the upper's triangles (stacked 0.5 m bands, each a set
//     of box ∩ cylinder volumes, one per connected footprint, so a gate's two piers and the open arch between them
//     are told apart; each volume's box and cylinder fitted to the real triangles, the grid only links them).
//     A ray counts only when its crossing of the proxy ends ≥ 0.3 m before the body point (a unit beside the
//     tower, or touching its proxy, is not behind it). On when ≥ 25 % of the rays are blocked, off below 12 %.
//     While it collapses, the falling top fades whole the same way whenever it covers or buries one of them
//     (its proxy rides along with it; a ray then counts from the moment it enters the top).
//   * shell: while protected (untargetable) a dawnglass glaze hugs the tower's own silhouette (its surface pushed out
//     7 cm along smoothed normals: a fresnel rim, the shield's 45° hatch, a slow rising band) over a low foot ring of
//     twelve hour-ticks on the plinth, so the protected tower stands no larger on screen than the bare one; the glaze
//     fades with the occlusion fade. It bursts outward in 0.45 s when the protection drops.

import {
  Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LatheGeometry, type Material, Matrix4, Mesh,
  MeshBasicMaterial, type MeshStandardMaterial, NormalBlending, type Object3D, type PerspectiveCamera, Quaternion,
  ShaderMaterial, Vector2, Vector3, type WebGLProgramParametersWithUniforms,
} from 'three';
import type { UnitDefT } from '../contracts/catalog.ts';
import type { EntityView, SimEvent, WorldView } from '../contracts/sim.ts';
import type { Actor } from './actors.ts';
import type { VfxSystem } from './vfx/system.ts';
import { patchWorldMaterial } from './world_material.ts';

/** occlusion fade: alpha of the faded part, its band above the plinth (m), fade in / out (s), share of the unit's
 *  body rays the fade-able part must block to turn the fade on / keep it on */
export const STRUCT_FADE = { alpha: 0.35, from: 0.5, band: 0.7, inS: 0.15, outS: 0.35, on: 0.25, keep: 0.12 } as const;
const MEND = 0.06;
const RISE_S = 0.9;
const SHELL_BREAK_S = 0.45;
const SHELL_COLOR = new Color().setStyle('#BFD3E6');      // dawnglass (tokens: the untargetable rim, the shield)
/** the glaze's offset off the tower's surface (m), and how far it bursts out when the protection drops */
const SKIN_INFLATE = 0.07;
const SKIN_BURST = 0.55;
const FALL_MAX = (80 * Math.PI) / 180;
/** a broken-off chip: time to the ground (s), the shrink once it lands (s) */
const CHIP_FALL_S = 0.5;
const CHIP_GONE_S = 0.12;
/** the accent flare as a threshold breaks (× rest, s) */
const FLARE = { k: 1.25, s: 0.066 } as const;
/** occluder proxy: band height and footprint cell (m) */
const OCC_BAND = 0.5;
const OCC_CELL = 0.2;
/** the clearance (m, along the ray) the proxy must leave before a body point for that ray to count as blocked */
const OCC_CLEAR = 0.3;
/** the unit's body rays: heights (× art height) and sideways offsets (× the flank offset, see blocked()) */
const RAY_ROWS = [0.25, 0.5, 0.72, 0.92] as const;
const RAY_COLS = [-1, 0, 1] as const;
/** a broken-off chip draws nothing but keeps its node: the outline / hover / hit-flash hull of its siblings hangs
 *  under the first of them (actors.ts hullPlan), which is often a chip */
const GONE = new MeshBasicMaterial({ visible: false });
GONE.name = 'vale_struct_gone';

export interface StructHost {
  vfx: VfxSystem;
  /** the relationship colour a structure's own effects take (its accent hex) */
  tint(v: EntityView): Color;
  /** compile these programs now (the renderer's warm-up; false = not yet: the match environment is not final) */
  compile(root: Object3D): boolean;
}

interface Uniforms {
  uSfY0: { value: number }; uSfY1: { value: number }; uSfA: { value: number }; uSfAlpha: { value: number }; uSfClip: { value: number };
}

/** one occluder volume (root-local, y up): a band's slab ∩ a footprint box ∩ its bounding cylinder */
interface OccVol { y0: number; y1: number; x0: number; x1: number; z0: number; z1: number; cx: number; cz: number; r2: number }
interface OccProxy { vols: OccVol[]; foot: number }

/** a stone of a broken-off chip on its way down (a group in the actor root, pivot at the stone's centre) */
interface Falling { g: Group; t: number; p0: Vector3; v: Vector3; acc: number; land: number; axis: Vector3; spin: number; landed: number }

interface Struct {
  a: Actor;
  def: UnitDefT;
  upper: Object3D | null;
  ruin: Object3D | null;
  chips: (Object3D | null)[];
  dmg: (Object3D | null)[];
  accents: MeshStandardMaterial[];
  /** see-through clones (this actor's) and the meshes of the upper that wear them */
  u: Uniforms;
  clones: Material[];
  upperMats: Material[];
  depth: Mesh[];
  depthMat: MeshBasicMaterial | null;
  trans: boolean;
  /** the upper's rest matrix in the root's space (the occluder proxy's frame; the falling top's proxy rides on it) */
  upRest: Matrix4;
  /** model-space bounds (root-local, y up): plinth top, tower top, tower radius */
  plinth: number;
  top: number;
  radius: number;
  stage: number;
  seen: boolean;
  dieT: number;
  fallDir: Vector3;
  broke: boolean;
  landed: boolean;
  dead: boolean;
  riseT: number;
  fade: number;
  /** the occluder proxy (null: not built yet) and whether the fade is wanted (hysteresis) */
  occ: OccProxy | null;
  occWant: boolean;
  /** the protected shell: the foot ring, the glaze over the upper's meshes, their shared material */
  shell: Mesh | null;
  skins: Mesh[];
  skinMat: ShaderMaterial | null;
  /** meshes the glaze leaves out (cracks, the animated core) */
  noSkin: Set<Object3D>;
  shellK: number;
  shellBreak: number;
  seed: number;
  dipUntil: number;
  nextDip: number;
  flareT: number;
  falling: Falling[];
  warmed: boolean;
}

const NODE_RE = /_(glow_base|base|upper|chip1|chip2|dmg1|dmg2|glow|core|ruin)$/;
const _m = new Matrix4();
const _m2 = new Matrix4();
const _box = new Box3();
const _b2 = new Box3();
const _q = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _p = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _rc = new Vector3();
const _rp = new Vector3();
const _inv = new Matrix4();
/** occluder proxies per template (the upper's first geometry + model scale) */
const occCache = new Map<string, OccProxy>();
/** smoothed normals (the glaze's push direction) per source geometry; the glaze geometry shares the rest */
const skinCache = new WeakMap<BufferGeometry, BufferGeometry>();
/** a chip geometry's stones (connected pieces), each sharing the source's attributes */
const pieceCache = new WeakMap<BufferGeometry, { geo: BufferGeometry; c: Vector3 }[]>();

/** o's matrix relative to `ref` (one of its ancestors) */
function relMatrix(o: Object3D, ref: Object3D, out: Matrix4): Matrix4 {
  out.identity();
  for (let p: Object3D | null = o; p && p !== ref; p = p.parent) { p.updateMatrix(); out.premultiply(p.matrix); }
  return out;
}

/** bounds of a node's meshes in `ref`'s space (outline / flash / prepass copies excluded) */
function boundsIn(node: Object3D, ref: Object3D, out: Box3): Box3 {
  out.makeEmpty();
  node.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || m.userData.valeOutline) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    _b2.copy(m.geometry.boundingBox!).applyMatrix4(relMatrix(m, ref, _m));
    out.union(_b2);
  });
  return out;
}

function meshes(node: Object3D): Mesh[] {
  const out: Mesh[] = [];
  node.traverse((o) => { const m = o as Mesh; if (m.isMesh && !m.userData.valeOutline) out.push(m); });
  return out;
}

/** see-through by height on top of the world patch: alpha × (1 → uSfA across [uSfY0, uSfY1]) × uSfAlpha; below uSfClip discarded */
function patchStructure(mat: Material, u: Uniforms): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSfY0;\nuniform float uSfY1;\nuniform float uSfA;\nuniform float uSfAlpha;\nuniform float uSfClip;')
      .replace('#include <opaque_fragment>', `if ( vValeWorld.y < uSfClip ) discard;
diffuseColor.a *= mix( 1.0, uSfA, smoothstep( uSfY0, uSfY1, vValeWorld.y ) ) * uSfAlpha;
#include <opaque_fragment>`);
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => `${key.call(mat)}|vsf`;
  mat.needsUpdate = true;
}

/** the shell's foot ring: an open band on the plinth (y 0 → FOOT_H) of twelve hour-ticks, the quarters taller */
const FOOT_H = 0.5;
const FOOT_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vP = position;
  vN = normalize( mat3( modelMatrix ) * normal );
  vV = normalize( cameraPosition - wp.xyz );
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FOOT_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uK;
uniform float uFlash;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
  float rim = pow( f, 2.0 );
  float ang = atan( vP.z, vP.x );
  float k = fract( ang / 6.2831853 * 12.0 + 0.5 );
  float q = step( 0.5, fract( ( ang / 6.2831853 * 12.0 + 0.5 ) / 3.0 + 0.17 ) );
  float tick = ( 1.0 - smoothstep( 0.035, 0.06, abs( k - 0.5 ) ) ) * ( 1.0 - smoothstep( mix( 0.26, 0.4, q ), mix( 0.34, 0.48, q ), vP.y ) );
  float foot = 1.0 - smoothstep( 0.0, 0.06, vP.y );
  float top = 1.0 - smoothstep( 0.0, 0.18, ${FOOT_H.toFixed(2)} - vP.y );
  float pulse = 0.85 + 0.15 * sin( uTime * 2.1 - ang * 2.0 );
  float a = ( 0.05 + 0.18 * rim ) * ( 1.0 - 0.8 * top ) + 0.5 * tick * pulse + 0.42 * foot;
  a = clamp( a * uK + uFlash * ( 0.2 + 0.4 * rim ), 0.0, 0.7 );
  gl_FragColor = vec4( uColor * ( 0.8 + 0.3 * rim + 0.4 * tick + uFlash ), a );
}`;
/** the glaze: the tower's own surface pushed out along smoothed normals (no seams at hard edges) */
const SKIN_VERT = /* glsl */`
attribute vec3 aSmooth;
uniform float uInflate;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vec3 sn = normalize( mat3( modelMatrix ) * aSmooth );
  wp.xyz += sn * uInflate;
  vW = wp.xyz;
  vN = sn;
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SKIN_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uK;
uniform float uFlash;
uniform float uTime;
uniform vec3 uCenter;
uniform float uH;
uniform float uSfY0;
uniform float uSfY1;
uniform float uSfA;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
  float rim = pow( f, 2.2 );
  vec3 q = vW - uCenter;
  float ang = atan( q.z, q.x );
  // the shield's 45-degree hatch, wrapped round the tower's axis (arc length + height)
  float hatch = smoothstep( 0.84, 0.96, fract( ( ang * max( length( q.xz ), 0.35 ) + q.y ) * 2.4 ) );
  // a band of light rising slowly up the tower
  float band = exp( -pow( ( fract( q.y / uH * 0.5 - uTime * 0.12 ) - 0.5 ) * 9.0, 2.0 ) );
  float a = 0.045 + 0.34 * rim + 0.1 * hatch * ( 0.5 + rim ) + 0.09 * band * ( 0.4 + rim );
  a = a * uK + uFlash * ( 0.2 + 0.4 * rim );
  // the occlusion fade thins the glaze with the tower
  a *= mix( 1.0, uSfA, smoothstep( uSfY0, uSfY1, vW.y ) );
  gl_FragColor = vec4( uColor * ( 0.8 + 0.4 * rim + uFlash ), clamp( a, 0.0, 0.6 ) );
}`;

export class StructureFx {
  private readonly host: StructHost;
  private readonly list = new Map<number, Struct>();
  /** the killer of a structure that fell this frame (its top falls away from it) */
  private readonly killers = new Map<number, number>();
  /** where a structure actor was removed (a gate about to respawn): position → time */
  private readonly gone: { x: number; y: number; t: number }[] = [];
  private time = 0;
  private view: WorldView | null = null;

  constructor(host: StructHost) { this.host = host; }

  /** the template is on the actor (renderer.syncActors): find the nodes, hide the hidden states, build the clones */
  attach(a: Actor, def: UnitDefT): void {
    const model = a.model;
    if (!model || a.disposed) return;
    const nodes = new Map<string, Object3D>();
    model.traverse((o) => {
      if (o.userData.valeOutline) return;
      const m = NODE_RE.exec(o.name);
      if (m && !nodes.has(m[1])) nodes.set(m[1], o);
    });
    const upper = nodes.get('upper') ?? null;
    const ruin = nodes.get('ruin') ?? null;
    if (ruin) ruin.visible = false;
    const dmg = [nodes.get('dmg1') ?? null, nodes.get('dmg2') ?? null];
    for (const d of dmg) if (d) d.visible = false;
    const u: Uniforms = { uSfY0: { value: 1e4 }, uSfY1: { value: 1e4 + 1 }, uSfA: { value: 1 }, uSfAlpha: { value: 1 }, uSfClip: { value: -1e4 } };
    const s: Struct = {
      a, def, upper, ruin, chips: [nodes.get('chip1') ?? null, nodes.get('chip2') ?? null], dmg, accents: [],
      u, clones: [], upperMats: [], depth: [], depthMat: null, trans: false, upRest: new Matrix4(), plinth: 0.4, top: def.art.height, radius: 1,
      stage: 0, seen: false, dieT: -1, fallDir: new Vector3(1, 0, 0), broke: false, landed: false, dead: false, riseT: -1, fade: 0,
      occ: null, occWant: false, shell: null, skins: [], skinMat: null, noSkin: new Set(),
      shellK: 0, shellBreak: -1, seed: (a.id * 0.6180339) % 1 * 100, dipUntil: 0, nextDip: 0, flareT: -1, falling: [], warmed: false,
    };
    for (const n of [...dmg, nodes.get('core') ?? null]) if (n) for (const m of meshes(n)) s.noSkin.add(m);
    // bounds (root-local): the plinth's top, the tower's top and radius
    const base = nodes.get('base');
    if (base) s.plinth = boundsIn(base, a.root, _box).max.y;
    if (upper) {
      relMatrix(upper, a.root, s.upRest);
      boundsIn(upper, a.root, _box);
      s.top = _box.max.y;
      s.radius = Math.max(0.4, Math.abs(_box.min.x), Math.abs(_box.max.x), Math.abs(_box.min.z), Math.abs(_box.max.z));
      s.occ = occProxy(upper, a.root, s.plinth, s.top, s.radius);
    }
    // accents: the tower's (flicker, die) and the plinth's hour-ticks (they die with it)
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.userData.valeOutline) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if (mat.name === 'accent') s.accents.push(mat as MeshStandardMaterial);
    });
    // the upper's see-through clones (accent clones are the actor's own: patched in place), and its depth prepass
    if (upper) {
      const cl = new Map<Material, Material>();
      const depthMat = new MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      depthMat.name = 'vale_struct_depth';
      s.depthMat = depthMat;
      for (const m of meshes(upper)) {
        const swap = (mat: Material): Material => {
          let c = cl.get(mat);
          if (!c) {
            if (mat.name === 'accent') c = mat;
            else { c = mat.clone(); patchWorldMaterial(c); s.clones.push(c); }
            patchStructure(c, u);
            cl.set(mat, c);
            s.upperMats.push(c);
          }
          return c;
        };
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
        const d = new Mesh(m.geometry, depthMat);
        d.name = 'vale_struct_depth';
        d.userData.valeOutline = true;
        d.castShadow = false; d.receiveShadow = false;
        d.renderOrder = 50;                  // after every opaque draw: what stands behind is already there
        d.matrixAutoUpdate = false;
        d.visible = false;
        m.add(d);
        s.depth.push(d);
      }
    }
    // a gate replacing the ruin it left (it respawned): it rises out of its plinth
    const v = a.view;
    if (v) {
      const i = this.gone.findIndex((g) => Math.hypot(g.x - v.x, g.y - v.y) < 0.5 && this.time - g.t < 2);
      if (i >= 0 && v.alive) { this.gone.splice(i, 1); s.riseT = 0; }
    }
    this.list.set(a.id, s);
    this.warm(a);
  }

  /** the structure's entity left the view (a gate respawning as a new entity, or the match ending): drop it */
  forget(a: Actor): void {
    const s = this.list.get(a.id);
    if (!s) return;
    this.gone.push({ x: a.x, y: a.y, t: this.time });
    if (this.gone.length > 8) this.gone.shift();
    this.dispose(s);
    this.list.delete(a.id);
  }

  clear(): void {
    for (const s of this.list.values()) this.dispose(s);
    this.list.clear();
    this.killers.clear();
    this.gone.length = 0;
  }

  private dispose(s: Struct): void {
    for (const c of s.clones) c.dispose();
    s.depthMat?.dispose();
    if (s.shell) { s.shell.geometry.dispose(); (s.shell.material as Material).dispose(); s.shell.removeFromParent(); s.shell = null; }
    // the glaze's geometries share the template's buffers (cached): never disposed here
    for (const m of s.skins) m.removeFromParent();
    s.skins.length = 0;
    s.skinMat?.dispose();
    s.skinMat = null;
    for (const f of s.falling) f.g.removeFromParent();
    s.falling.length = 0;
  }

  /** compile the see-through and shell programs once per template (the renderer calls it again when its sky lands) */
  private readonly warmedKeys = new Set<string>();
  warm(a: Actor): void {
    const s = this.list.get(a.id);
    if (!s || s.warmed || a.disposed) return;
    const key = `${s.def.id}:${a.team}`;
    if (this.warmedKeys.has(key)) { s.warmed = true; return; }
    // every program this structure can show: the see-through upper, its cracks (hidden until damaged) and the shell
    this.ensureShell(s);
    const shellVis = s.shell!.visible;
    const skinVis = s.skins.map((m) => m.visible);
    const dmgVis = s.dmg.map((d) => d?.visible ?? false);
    s.shell!.visible = true;
    for (const m of s.skins) m.visible = true;
    for (const d of s.dmg) if (d) d.visible = true;
    const was = s.trans;
    this.setTransparent(s, true);
    for (const d of s.depth) d.visible = true;
    const ok = this.host.compile(a.root);
    this.setTransparent(s, was);
    for (const d of s.depth) d.visible = s.fade > 0.001;
    s.dmg.forEach((d, k) => { if (d) d.visible = dmgVis[k]; });
    s.shell!.visible = shellVis;
    s.skins.forEach((m, k) => { m.visible = skinVis[k]; });
    if (ok) { this.warmedKeys.add(key); s.warmed = true; }
  }
  warmAll(actors: Iterable<Actor>): void { for (const a of actors) if (a.kind === 'structure') this.warm(a); }

  /** sim events: a structure's killer (its top falls away from it) */
  handle(events: readonly SimEvent[]): void {
    for (const ev of events) if (ev.e === 'death' && ev.kind === 'structure' && ev.killer >= 0) this.killers.set(ev.dst, ev.killer);
  }

  /**
   * per frame, after the actors updated: damage stage, flicker, collapse, rise, shell and the occlusion fade.
   * `focus`: your fighter, the hovered and the targeted unit (entity ids, −1 = none).
   */
  update(dt: number, time: number, view: WorldView, cam: PerspectiveCamera, focus: readonly number[], actors: ReadonlyMap<number, Actor>): void {
    this.time = time;
    this.view = view;
    cam.updateMatrixWorld();
    cam.getWorldDirection(_fwd);
    _right.setFromMatrixColumn(cam.matrixWorld, 0).setY(0);
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    _right.normalize();
    for (const s of this.list.values()) {
      const a = s.a;
      const v = a.view;
      if (!v || a.disposed) continue;
      // ── life
      if (!v.alive || v.state === 'dead') {
        if (!s.dead) this.die(s, v, actors);
      }
      if (s.dieT >= 0) this.collapse(s, dt, v);
      else if (!s.dead) {
        this.damage(s, v);
        if (s.riseT >= 0) this.rise(s, dt);
      }
      s.seen = true;
      // ── light: flicker while damaged, out once fallen
      this.light(s, dt);
      // ── shell while protected
      this.shellUpdate(s, dt, v);
      // ── broken-off chips on their way down
      if (s.falling.length) this.fallUpdate(s, dt);
      // ── occlusion fade (the standing tower, or its top while it falls)
      let want = 0;
      const falling = s.dieT >= 0;
      if ((!s.dead || falling) && a.root.visible && s.upper && s.occ) {
        const need = s.occWant ? STRUCT_FADE.keep : STRUCT_FADE.on;
        for (const id of focus) {
          if (id < 0 || id === a.id) continue;
          const o = actors.get(id);
          if (o && o.visible && o.root.visible && o.view?.alive && this.blocked(s, o, cam, falling) >= need) { want = 1; break; }
        }
      }
      s.occWant = want > 0;
      const rate = want > s.fade ? 1 / STRUCT_FADE.inS : 1 / STRUCT_FADE.outS;
      s.fade = want > s.fade ? Math.min(want, s.fade + dt * rate) : Math.max(want, s.fade - dt * rate);
      this.applyFade(s);
    }
    for (const id of [...this.killers.keys()]) if (!this.list.has(id)) this.killers.delete(id);
  }

  // ── damage states ──────────────────────────────────────────────────────────────────────────────
  private damage(s: Struct, v: EntityView): void {
    const at = s.def.art.damage?.at;
    if (!at?.length) return;
    const f = Math.max(0, v.hp) / Math.max(1, v.maxHp);
    let want = 0;
    for (const x of at) if (f <= x) want++;
    let stage = s.stage;
    if (want > stage) {
      // seen crossing it: the chip's stones fall (before showStage hides it), the cracks flare, the vfx plays there
      if (s.seen) {
        for (let k = stage; k < want; k++) this.crackVfx(s, v, k, this.dropChip(s, k));
        s.flareT = this.time;
      }
      stage = want;
    } else while (stage > 0 && f > at[stage - 1] + MEND) stage--;
    if (stage !== s.stage || !s.seen) { s.stage = stage; this.showStage(s, stage); }
  }

  private showStage(s: Struct, stage: number): void {
    s.chips.forEach((c, k) => { if (c) showPart(c, stage <= k); });
    s.dmg.forEach((d, k) => { if (d) d.visible = stage > k; });
  }

  /** the threshold's vfx where the chip broke off (`at`, world), else on the flank at the crack height */
  private crackVfx(s: Struct, v: EntityView, k: number, at: Vector3 | null): void {
    const id = s.def.art.damage?.vfx;
    if (!id) return;
    const a = s.a;
    let o: Vector3;
    if (at) o = at.clone();
    else {
      const h = s.plinth + (s.top - s.plinth) * (k === 0 ? 0.62 : 0.45);
      const ang = s.seed + k * 2.1;
      o = new Vector3(a.x + Math.cos(ang) * s.radius * 0.7, a.h + h, a.y + Math.sin(ang) * s.radius * 0.7);
    }
    this.host.vfx.spawn(id, { tier: 2, team: this.host.tint(v), element: null, ally: false, origin: o, ground: new Vector3(o.x, a.h, o.z), scale: 1, anchor: 'origin', world: true });
  }

  /** the chip of threshold k breaks off: each of its stones (a connected piece of the real mesh, same material)
   *  tumbles away from the tower and down under gravity, lands in ~CHIP_FALL_S, shrinks away. Returns where the
   *  largest stone broke (world), for the threshold's vfx. */
  private dropChip(s: Struct, k: number): Vector3 | null {
    const node = s.chips[k];
    const a = s.a;
    if (!node || !a.root.visible) return null;
    let best: Vector3 | null = null, bestR = -1;
    for (const m of meshes(node)) {
      if (m.userData.sfGone) continue;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const rel = relMatrix(m, a.root, new Matrix4());
      for (const pc of chipPieces(m.geometry)) {
        if (s.falling.length >= 24) break;
        const c = pc.c.clone().applyMatrix4(rel);                     // root-local centre of the stone
        const stone = new Mesh(pc.geo, mat);
        stone.name = 'vale_struct_chip';
        stone.userData.valeOutline = true;
        stone.castShadow = true; stone.receiveShadow = false;
        stone.matrixAutoUpdate = false;
        stone.matrix.makeTranslation(-c.x, -c.y, -c.z).multiply(rel);
        const g = new Group();
        g.name = 'vale_struct_chip';
        g.userData.valeOutline = true;
        g.position.copy(c);
        g.add(stone);
        a.root.add(g);
        // away from the tower's axis, a little up; gravity scaled so it lands in ~CHIP_FALL_S whatever its height
        const r = fract(Math.sin((c.x * 12.9898 + c.z * 78.233 + k) * 43758.5453));
        const out = _v.set(c.x, 0, c.z);
        if (out.lengthSq() < 1e-4) out.set(Math.cos(s.seed + k), 0, Math.sin(s.seed + k));
        out.normalize();
        const v = new Vector3(out.x * (1.3 + 1.1 * r), 0.8 + 0.8 * r, out.z * (1.3 + 1.1 * r));
        const land = 0.12;
        const T = CHIP_FALL_S * (0.85 + 0.3 * r);
        const acc = Math.max(9.8, (2 * (c.y - land + v.y * T)) / (T * T));
        const axis = new Vector3(-out.z, 0.35 * (r - 0.5), out.x).normalize();
        s.falling.push({ g, t: 0, p0: c, v, acc, land, axis, spin: (5 + 6 * r) * (r > 0.5 ? 1 : -1), landed: -1 });
        const size = pc.geo.boundingSphere?.radius ?? 0;
        if (size > bestR) { bestR = size; best = c; }
      }
    }
    if (!best) return null;
    _p.copy(best);
    a.root.updateMatrix();
    return _p.applyMatrix4(a.root.matrix).clone();
  }

  private fallUpdate(s: Struct, dt: number): void {
    for (let i = s.falling.length - 1; i >= 0; i--) {
      const f = s.falling[i];
      f.t += dt;
      if (f.landed < 0) {
        const t = f.t;
        const y = f.p0.y + f.v.y * t - 0.5 * f.acc * t * t;
        f.g.position.set(f.p0.x + f.v.x * t, Math.max(f.land, y), f.p0.z + f.v.z * t);
        f.g.quaternion.setFromAxisAngle(f.axis, f.spin * t);
        if (y <= f.land) f.landed = f.t;
      } else {
        const u = (f.t - f.landed) / CHIP_GONE_S;
        f.g.scale.setScalar(Math.max(0.001, 1 - u));
        if (u >= 1) { f.g.removeFromParent(); s.falling.splice(i, 1); }
      }
    }
  }

  // ── death: the collapse ─────────────────────────────────────────────────────────────────────────
  private die(s: Struct, v: EntityView, actors: ReadonlyMap<number, Actor>): void {
    s.dead = true;
    s.riseT = -1;
    s.chips.forEach((c) => { if (c) showPart(c, false); });
    s.dmg.forEach((d) => { if (d) d.visible = true; });
    if (!s.seen || !s.upper || !s.def.art.ruin) { this.toRuin(s); return; }
    // the top falls away from the killer (else a fixed side per structure)
    const a = s.a;
    const k = actors.get(this.killers.get(a.id) ?? -1);
    let dx = Math.cos(s.seed), dz = Math.sin(s.seed);
    if (k && Math.hypot(a.x - k.x, a.y - k.y) > 0.5) { dx = a.x - k.x; dz = a.y - k.y; }
    const l = Math.hypot(dx, dz) || 1;
    s.fallDir.set(dx / l, 0, dz / l);
    s.dieT = 0;
    s.broke = false;
    s.landed = false;
  }

  private collapse(s: Struct, dt: number, v: EntityView): void {
    const a = s.a;
    const T = s.def.art.ruin?.collapse ?? 1.8;
    s.dieT += dt;
    const t = s.dieT;
    const up = s.upper!;
    const shudder = 0.2, tLand = shudder + T * 0.55;
    // the pivot is the tower's foot on the fall side, the axis lies across the fall (both in the upper's parent space)
    const parent = up.parent!;
    relMatrix(parent, a.root, _m2);
    _m.copy(_m2).invert();
    _q.copy(a.root.quaternion).invert();
    const dirL = _v.copy(s.fallDir).applyQuaternion(_q);                                // root-local fall direction
    const pivot = _p.set(dirL.x * s.radius * 0.55, s.plinth, dirL.z * s.radius * 0.55).applyMatrix4(_m);
    const axis = _v2.set(0, 1, 0).cross(dirL).transformDirection(_m).normalize();
    let theta = 0, drop = 0, jitter = 0;
    if (t < shudder) jitter = 0.035 * Math.sin(t * 95) * (1 - t / shudder * 0.4);
    else if (t < tLand) { const u = (t - shudder) / (tLand - shudder); theta = FALL_MAX * u * u; }
    else {
      const u = Math.min(1, (t - tLand) / Math.max(0.1, T - tLand));
      theta = FALL_MAX + 0.12 * u;
      drop = 2.4 * Math.pow(u, 1.4);
    }
    _q.setFromAxisAngle(axis, theta);
    up.quaternion.copy(_q);
    up.position.copy(pivot).sub(_v2.copy(pivot).applyQuaternion(_q));
    up.position.y -= drop / Math.max(1e-3, parent.getWorldScale(_v2).y);
    up.position.x += jitter;
    // the break: the top shears off; the ruin shows under it from here
    if (!s.broke && t >= shudder) {
      s.broke = true;
      if (s.ruin) s.ruin.visible = true;
      const id = s.def.art.ruin?.breakVfx;
      if (id) {
        const o = new Vector3(a.x + s.fallDir.x * s.radius * 0.6, a.h + Math.min(1.3, s.plinth + 0.8), a.y + s.fallDir.z * s.radius * 0.6);
        this.host.vfx.spawn(id, { tier: 3, team: this.host.tint(v), element: null, ally: false, origin: o, ground: new Vector3(o.x, a.h, o.z), scale: 1, anchor: 'origin', world: true });
      }
    }
    if (!s.landed && t >= tLand) {
      s.landed = true;
      const id = s.def.art.ruin?.landVfx;
      const reach = s.radius * 0.55 + (s.top - s.plinth) * 0.62;
      if (id) {
        const g = new Vector3(a.x + s.fallDir.x * reach, a.h, a.y + s.fallDir.z * reach);
        this.host.vfx.spawn(id, { tier: 3, team: this.host.tint(v), element: null, ally: false, origin: g.clone().setY(a.h + 0.4), ground: g, scale: Math.max(1, (s.top - s.plinth) / 4.5), anchor: 'ground', dir: Math.atan2(s.fallDir.z, s.fallDir.x), world: true });
      }
    }
    // it sinks through the ground and fades out
    s.u.uSfClip.value = a.h + 0.02;
    s.u.uSfAlpha.value = t < tLand ? 1 : 1 - smooth(0.25, 1, (t - tLand) / Math.max(0.1, T - tLand));
    if (t >= T) this.toRuin(s);
  }

  private toRuin(s: Struct): void {
    s.dieT = -1;
    s.dead = true;
    if (s.upper) { s.upper.visible = false; s.upper.position.set(0, 0, 0); s.upper.quaternion.identity(); }
    if (s.ruin) s.ruin.visible = true;
    s.u.uSfAlpha.value = 1;
    s.u.uSfClip.value = -1e4;
  }

  private rise(s: Struct, dt: number): void {
    const up = s.upper;
    if (!up) { s.riseT = -1; return; }
    s.riseT += dt;
    const u = Math.min(1, s.riseT / RISE_S);
    const e = 1 - Math.pow(1 - u, 3);
    const parent = up.parent!;
    up.position.set(0, -(1 - e) * (s.top - s.plinth) / Math.max(1e-3, parent.getWorldScale(_v2).y), 0);
    s.u.uSfClip.value = u < 1 ? s.a.h + s.plinth - 0.02 : -1e4;
    if (u >= 1) { s.riseT = -1; up.position.set(0, 0, 0); }
  }

  // ── accent light ───────────────────────────────────────────────────────────────────────────────
  private light(s: Struct, _dt: number): void {
    const t = this.time;
    let k = 1;
    if (s.dead) {
      // the light goes out over the collapse, and stays out
      const T = s.def.art.ruin?.collapse ?? 1.8;
      k = s.dieT >= 0 ? 1 - 0.88 * smooth(0, 0.7, s.dieT / T) : 0.12;
      if (s.dieT >= 0 && s.dieT < 0.2) k = 1.0 + 0.25 * Math.sin(s.dieT * 60);   // the crack flare as it breaks (still ≤ rest × 1.25)
    } else if (s.stage > 0) {
      const deep = s.stage >= 2;
      const n = 0.5 + 0.5 * Math.sin(t * (deep ? 9.1 : 6.3) + s.seed) * Math.sin(t * (deep ? 3.7 : 2.3) + s.seed * 1.7);
      k = deep ? 0.68 + 0.27 * n : 0.84 + 0.14 * n;
      if (t >= s.nextDip) {
        const r = fract(Math.sin((t + s.seed) * 12.9898) * 43758.5453);
        s.dipUntil = t + (deep ? 0.06 + 0.1 * r : 0.05 + 0.05 * r);
        s.nextDip = t + (deep ? 0.7 + 1.5 * r : 2.4 + 2.8 * r);
      }
      if (t < s.dipUntil) k *= deep ? 0.18 : 0.4;
      // the threshold's flare: the light bursts through the new cracks for ~3 frames (≤ 1.25 × rest)
      if (s.flareT >= 0 && t - s.flareT < FLARE.s) k = FLARE.k;
    }
    // the actor sets every accent to its glow each frame it updates; this scales that (idempotent)
    if (k !== 1 && s.a.visible) { const g = s.a.glowLevel * k; for (const m of s.accents) m.emissiveIntensity = g; }
  }

  // ── protected shell ────────────────────────────────────────────────────────────────────────────
  private ensureShell(s: Struct): void {
    if (s.shell) return;
    const a = s.a;
    // the foot ring: on the plinth, just outside the tower's foot (inside the plinth's own disc)
    const rf = (s.occ?.foot ?? s.radius) + 0.12;
    const prof = [new Vector2(rf, 0), new Vector2(rf, FOOT_H * 0.5), new Vector2(rf, FOOT_H)];
    const geo = new LatheGeometry(prof, 48);
    const mat = new ShaderMaterial({
      vertexShader: FOOT_VERT, fragmentShader: FOOT_FRAG, transparent: true, depthWrite: false, side: DoubleSide, blending: NormalBlending,
      uniforms: { uColor: { value: new Color() }, uK: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 } },
    });
    mat.name = 'vale_struct_shell';
    const m = new Mesh(geo, mat);
    m.name = 'vale_struct_shell';
    m.userData.valeOutline = true;
    m.castShadow = false; m.receiveShadow = false;
    m.position.y = s.plinth;
    m.renderOrder = 5;
    m.visible = false;
    a.root.add(m);
    s.shell = m;
    // the glaze: every stone of the upper (cracks and the animated core left out), its surface pushed out
    if (!s.upper) return;
    const sm = new ShaderMaterial({
      vertexShader: SKIN_VERT, fragmentShader: SKIN_FRAG, transparent: true, depthWrite: false, blending: NormalBlending,
      uniforms: {
        uColor: { value: new Color() }, uK: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uInflate: { value: SKIN_INFLATE },
        uCenter: { value: new Vector3() }, uH: { value: Math.max(1, s.top - s.plinth) },
        uSfY0: s.u.uSfY0, uSfY1: s.u.uSfY1, uSfA: s.u.uSfA,
      },
    });
    sm.name = 'vale_struct_skin';
    s.skinMat = sm;
    for (const src of meshes(s.upper)) {
      if (s.noSkin.has(src)) continue;
      const k = new Mesh(skinGeometry(src.geometry), sm);
      k.name = 'vale_struct_skin';
      k.userData.valeOutline = true;
      k.castShadow = false; k.receiveShadow = false;
      k.renderOrder = 6;
      k.visible = false;
      src.add(k);
      s.skins.push(k);
    }
  }

  private shellUpdate(s: Struct, dt: number, v: EntityView): void {
    const prot = v.alive && !v.targetable && !s.dead;
    if (!prot && !s.shell) return;
    this.ensureShell(s);
    const sh = s.shell!;
    const u = (sh.material as ShaderMaterial).uniforms;
    const su = s.skinMat?.uniforms;
    let burst = 0;
    if (prot) { s.shellBreak = -1; s.shellK = Math.min(1, s.shellK + dt / 0.4); u.uFlash.value = 0; }
    else if (s.shellK > 0 && s.shellBreak < 0) s.shellBreak = 0;
    if (s.shellBreak >= 0) {
      s.shellBreak += dt;
      const b = Math.min(1, s.shellBreak / SHELL_BREAK_S);
      s.shellK = 1 - b;
      burst = 1 - (1 - b) * (1 - b);
      u.uFlash.value = 0.6 * (1 - b) * (1 - b);
      if (b >= 1) { s.shellBreak = -1; s.shellK = 0; burst = 0; }
    }
    sh.scale.setScalar(1 + 0.14 * burst);
    const on = s.shellK > 0.001 && s.a.root.visible;
    sh.visible = on;
    for (const k of s.skins) k.visible = on && !k.parent?.userData.sfGone;
    if (!on) return;
    const tint = (u.uColor.value as Color).copy(SHELL_COLOR).lerp(this.host.tint(v), 0.2);
    u.uK.value = s.shellK;
    u.uTime.value = this.time;
    if (su) {
      (su.uColor.value as Color).copy(tint);
      su.uK.value = s.shellK;
      su.uFlash.value = u.uFlash.value;
      su.uTime.value = this.time;
      su.uInflate.value = SKIN_INFLATE + (SKIN_BURST - SKIN_INFLATE) * burst;
      (su.uCenter.value as Vector3).set(s.a.x, s.a.h + s.plinth, s.a.y);
    }
  }

  // ── occlusion ──────────────────────────────────────────────────────────────────────────────────
  /** the share (0..1) of rays from the camera to points on the unit's body that the structure's fade-able part
   *  blocks (world-space, against the occluder proxy; no screen-space boxes, so no aspect-ratio dependence).
   *  `fall`: the top is falling (the proxy rides along with it, and a unit it buries counts as hidden). */
  private blocked(s: Struct, o: Actor, cam: PerspectiveCamera, fall = false): number {
    const a = s.a;
    const occ = s.occ!;
    // cheap cull: near the structure, and (standing) not in front of its front face along the camera's
    // ground-forward axis; a falling top reaches about its height out, toward the camera too
    const dx = o.x - a.x, dz = o.y - a.y;
    if (fall) { if (dx * dx + dz * dz > (s.radius + s.top + 1) ** 2) return 0; }
    else {
      if (dx * dx + dz * dz > (s.radius + 8) ** 2) return 0;
      const fl = Math.hypot(_fwd.x, _fwd.z) || 1;
      if ((dx * _fwd.x + dz * _fwd.z) / fl < -(s.radius + 0.6)) return 0;
    }
    // the proxy's frame: root-local (static; composed from the root's own transform so it is right before the
    // first render), and for a falling top the upper's rest pose × its current pose⁻¹ on top
    _inv.compose(a.root.position, a.root.quaternion, a.root.scale).invert();
    if (fall && s.upper) _inv.premultiply(relMatrix(s.upper, a.root, _m2).invert().premultiply(s.upRest));
    _rc.copy(cam.position).applyMatrix4(_inv);
    const H = Math.max(0.6, o.artHeight);
    // the flank rays sample inside the body (its collision radius is wider than its head, legs and waist): a
    // tower edge that only passes beside the unit must not count as hiding it
    const w = Math.min(0.3, Math.max(0.15, o.radius * 0.55));
    let hit = 0, n = 0;
    for (const f of RAY_ROWS) for (const c of RAY_COLS) {
      n++;
      _rp.set(o.x + _right.x * c * w, o.h + f * H, o.y + _right.z * c * w).applyMatrix4(_inv);
      if (segBlocked(_rc, _rp, occ.vols, !fall)) hit++;
    }
    return hit / n;
  }

  private applyFade(s: Struct): void {
    const a = s.a;
    const on = s.fade > 0.001;
    // standing: the upper part from STRUCT_FADE.from above the plinth; falling: the whole top (it lies low)
    s.u.uSfY0.value = s.dieT >= 0 ? a.h - 100 : a.h + s.plinth + STRUCT_FADE.from;
    s.u.uSfY1.value = s.u.uSfY0.value + STRUCT_FADE.band;
    s.u.uSfA.value = 1 - (1 - STRUCT_FADE.alpha) * smooth(0, 1, s.fade);
    const trans = on || (s.dieT >= 0 && s.u.uSfAlpha.value < 0.999);
    if (trans !== s.trans) this.setTransparent(s, trans);
    for (const d of s.depth) d.visible = on && !d.parent?.userData.sfGone;
  }

  private setTransparent(s: Struct, on: boolean): void {
    s.trans = on;
    for (const m of s.upperMats) { m.transparent = on; m.depthWrite = !on; }
  }

  /** harness: every structure's presentation state */
  info(): { id: number; def: string; team: number; stage: number; dead: boolean; collapsing: boolean; rising: boolean; ruin: boolean; fade: number; shell: number; plinth: number; top: number; radius: number; falling: number; occVols: number; foot: number }[] {
    return [...this.list.values()].map((s) => ({
      id: s.a.id, def: s.def.id, team: s.a.team, stage: s.stage, dead: s.dead, collapsing: s.dieT >= 0, rising: s.riseT >= 0, ruin: !!s.ruin?.visible,
      fade: +s.fade.toFixed(3), shell: +s.shellK.toFixed(3), plinth: +s.plinth.toFixed(3), top: +s.top.toFixed(3), radius: +s.radius.toFixed(3),
      falling: s.falling.length, occVols: s.occ?.vols.length ?? 0, foot: +(s.occ?.foot ?? 0).toFixed(3),
    }));
  }

  /** harness: the share of a unit's body rays this structure's fade-able part blocks (what the fade decides on) */
  blockedShare(structId: number, unit: Actor, cam: PerspectiveCamera): number {
    const s = this.list.get(structId);
    if (!s || !s.occ) return 0;
    cam.updateMatrixWorld();
    cam.getWorldDirection(_fwd);
    _right.setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
    return this.blocked(s, unit, cam);
  }
}

/** show or hide a chip's meshes (their material, not the node: see GONE) */
function showPart(node: Object3D, shown: boolean): void {
  for (const m of meshes(node)) {
    if (shown && m.userData.sfGone) { m.material = m.userData.sfMat as Material; m.userData.sfGone = false; }
    else if (!shown && !m.userData.sfGone) { m.userData.sfMat = m.material; m.material = GONE; m.userData.sfGone = true; }
  }
}

/** does the ray c → p cross an occluder volume before p? (root-local) `strict` (a standing tower): only a crossing
 *  that ends ≥ OCC_CLEAR m before p counts, so a point inside or right at a volume (a unit beside the tower, its
 *  body touching the conservative proxy) is not hidden by it; else (a falling top) a crossing that starts
 *  ≥ OCC_CLEAR m before p counts, a point inside the top (a unit it buries) included */
function segBlocked(c: Vector3, p: Vector3, vols: readonly OccVol[], strict: boolean): boolean {
  const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.3) return false;
  const tMax = 1 - OCC_CLEAR / len;
  const aa = dx * dx + dz * dz;
  for (const b of vols) {
    // strict: the whole crossing (on the unbounded ray) must lie before tMax; else only its start
    let lo = 0, hi = strict ? Infinity : tMax;
    // slabs: y, x, z
    if (Math.abs(dy) < 1e-9) { if (c.y < b.y0 || c.y > b.y1) continue; }
    else { let t0 = (b.y0 - c.y) / dy, t1 = (b.y1 - c.y) / dy; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } lo = Math.max(lo, t0); hi = Math.min(hi, t1); if (lo > hi) continue; }
    if (Math.abs(dx) < 1e-9) { if (c.x < b.x0 || c.x > b.x1) continue; }
    else { let t0 = (b.x0 - c.x) / dx, t1 = (b.x1 - c.x) / dx; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } lo = Math.max(lo, t0); hi = Math.min(hi, t1); if (lo > hi) continue; }
    if (Math.abs(dz) < 1e-9) { if (c.z < b.z0 || c.z > b.z1) continue; }
    else { let t0 = (b.z0 - c.z) / dz, t1 = (b.z1 - c.z) / dz; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } lo = Math.max(lo, t0); hi = Math.min(hi, t1); if (lo > hi) continue; }
    // the footprint's bounding cylinder (vertical axis)
    const ex = c.x - b.cx, ez = c.z - b.cz;
    if (aa < 1e-12) { if (ex * ex + ez * ez > b.r2) continue; }
    else {
      const bb = 2 * (ex * dx + ez * dz), cc = ex * ex + ez * ez - b.r2;
      const disc = bb * bb - 4 * aa * cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      lo = Math.max(lo, (-bb - sq) / (2 * aa)); hi = Math.min(hi, (-bb + sq) / (2 * aa));
      if (lo > hi) continue;
    }
    if (hi <= tMax) return true;
  }
  return false;
}

/** the occluder proxy of an upper (root-local): from the fade line to the top in OCC_BAND slabs; in each, the
 *  footprint of the triangles clipped to the slab rasterised on an OCC_CELL grid, one volume per 8-connected
 *  footprint: the box of its clipped triangles' real points ∩ their bounding cylinder round the box's centre
 *  (the grid only tells the footprints apart, so its cells never widen a volume). `foot`: the tower's widest
 *  reach just above the plinth. */
function occProxy(upper: Object3D, root: Object3D, plinth: number, top: number, radius: number): OccProxy {
  const ms = meshes(upper);
  const m4 = new Matrix4();
  const key = ms.length ? `${ms[0].geometry.uuid}|${relMatrix(ms[0], root, m4).elements.map((e) => e.toFixed(3)).join(',')}` : upper.uuid;
  const hit = occCache.get(key);
  if (hit) return hit;
  const y0 = plinth + STRUCT_FADE.from;
  const nb = Math.max(1, Math.ceil((top - y0) / OCC_BAND));
  const bh = (top - y0) / nb;
  const ext = radius + OCC_CELL;
  const n = Math.ceil((2 * ext) / OCC_CELL);
  const grids = Array.from({ length: nb }, () => new Uint8Array(n * n));
  // per band, every clipped piece: its points (x, z pairs) and [its centre cell, its span in the points]
  const pp: number[][] = Array.from({ length: nb }, () => []);
  const pc: number[][] = Array.from({ length: nb }, () => []);
  let foot = 0;
  const A = new Vector3(), B = new Vector3(), C = new Vector3();
  const pts: number[] = [];
  const mark = (g: Uint8Array, x0: number, x1: number, z0: number, z1: number): void => {
    const i0 = Math.max(0, Math.floor((x0 + ext) / OCC_CELL)), i1 = Math.min(n - 1, Math.floor((x1 + ext) / OCC_CELL));
    const j0 = Math.max(0, Math.floor((z0 + ext) / OCC_CELL)), j1 = Math.min(n - 1, Math.floor((z1 + ext) / OCC_CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g[j * n + i] = 1;
  };
  // the part of triangle ABC inside [lo, hi] in y: its vertices there and its edges' crossings (x, z pairs)
  const clip = (lo: number, hi: number): void => {
    pts.length = 0;
    const P = [A, B, C];
    for (let i = 0; i < 3; i++) {
      const p = P[i], q = P[(i + 1) % 3];
      if (p.y >= lo && p.y <= hi) pts.push(p.x, p.z);
      for (const yy of [lo, hi]) {
        if ((p.y - yy) * (q.y - yy) < 0) { const t = (yy - p.y) / (q.y - p.y); pts.push(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t); }
      }
    }
  };
  for (const m of ms) {
    relMatrix(m, root, m4);
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.index;
    const tris = idx ? idx.count / 3 : pos.count / 3;
    const world = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { A.fromBufferAttribute(pos, i).applyMatrix4(m4); world[i * 3] = A.x; world[i * 3 + 1] = A.y; world[i * 3 + 2] = A.z; }
    for (let t = 0; t < tris; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      A.fromArray(world, ia * 3); B.fromArray(world, ib * 3); C.fromArray(world, ic * 3);
      const tlo = Math.min(A.y, B.y, C.y), thi = Math.max(A.y, B.y, C.y);
      // the foot's reach (just above the plinth)
      if (tlo <= plinth + 0.6 && thi >= plinth) {
        clip(plinth, plinth + 0.6);
        for (let i = 0; i < pts.length; i += 2) foot = Math.max(foot, Math.hypot(pts[i], pts[i + 1]));
      }
      if (thi < y0 || tlo > top) continue;
      const b0 = Math.max(0, Math.floor((tlo - y0) / bh)), b1 = Math.min(nb - 1, Math.floor((thi - y0) / bh));
      for (let k = b0; k <= b1; k++) {
        clip(y0 + k * bh, y0 + (k + 1) * bh);
        if (!pts.length) continue;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
        mark(grids[k], x0, x1, z0, z1);
        const ci = Math.min(n - 1, Math.max(0, Math.floor(((x0 + x1) / 2 + ext) / OCC_CELL)));
        const cj = Math.min(n - 1, Math.max(0, Math.floor(((z0 + z1) / 2 + ext) / OCC_CELL)));
        pc[k].push(cj * n + ci, pp[k].length, pp[k].length + pts.length);
        for (const v of pts) pp[k].push(v);
      }
    }
  }
  // the footprints: 8-connected components of each band's grid
  const vols: OccVol[] = [];
  const seen = new Uint8Array(n * n);
  const lab = new Int32Array(n * n);
  const stack: number[] = [];
  grids.forEach((g, k) => {
    seen.fill(0);
    const first = vols.length;
    for (let s0 = 0; s0 < n * n; s0++) {
      if (!g[s0] || seen[s0]) continue;
      const cells: number[] = [];
      stack.push(s0); seen[s0] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        const ci = c % n, cj = (c / n) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const q = j * n + i;
          if (g[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      for (const c of cells) lab[c] = vols.length;
      vols.push({ y0: y0 + k * bh, y1: y0 + (k + 1) * bh, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, cx: 0, cz: 0, r2: 0 });
    }
    // fit each footprint's volume to its pieces' real points (every marked cell belongs to a piece of its own
    // footprint): the box, then the cylinder round the box's centre; 1 cm of slack against rounding
    const P = pp[k], Q = pc[k];
    for (let i = 0; i < Q.length; i += 3) {
      const v = vols[lab[Q[i]]];
      for (let j = Q[i + 1]; j < Q[i + 2]; j += 2) { v.x0 = Math.min(v.x0, P[j]); v.x1 = Math.max(v.x1, P[j]); v.z0 = Math.min(v.z0, P[j + 1]); v.z1 = Math.max(v.z1, P[j + 1]); }
    }
    for (let i = first; i < vols.length; i++) {
      const v = vols[i];
      v.x0 -= 0.01; v.x1 += 0.01; v.z0 -= 0.01; v.z1 += 0.01;
      v.cx = (v.x0 + v.x1) / 2; v.cz = (v.z0 + v.z1) / 2;
    }
    for (let i = 0; i < Q.length; i += 3) {
      const v = vols[lab[Q[i]]];
      for (let j = Q[i + 1]; j < Q[i + 2]; j += 2) v.r2 = Math.max(v.r2, (P[j] - v.cx) ** 2 + (P[j + 1] - v.cz) ** 2);
    }
    for (let i = first; i < vols.length; i++) vols[i].r2 = (Math.sqrt(vols[i].r2) + 0.01) ** 2;
  });
  const out = { vols, foot: foot || radius };
  occCache.set(key, out);
  return out;
}

/** the glaze geometry of a source mesh: its index, position and normal shared, plus `aSmooth` (the normals of
 *  every vertex at one position averaged, so pushing out along it opens no seams at hard edges) */
function skinGeometry(src: BufferGeometry): BufferGeometry {
  const hit = skinCache.get(src);
  if (hit) return hit;
  const pos = src.getAttribute('position');
  const nor = src.getAttribute('normal');
  const sm = new Float32Array(pos.count * 3);
  const acc = new Map<string, number[]>();
  const keys: string[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    keys[i] = k;
    const nx = nor ? nor.getX(i) : 0, ny = nor ? nor.getY(i) : 1, nz = nor ? nor.getZ(i) : 0;
    const s = acc.get(k);
    if (s) { s[0] += nx; s[1] += ny; s[2] += nz; } else acc.set(k, [nx, ny, nz]);
  }
  for (let i = 0; i < pos.count; i++) {
    const s = acc.get(keys[i])!;
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    sm[i * 3] = s[0] / l; sm[i * 3 + 1] = s[1] / l; sm[i * 3 + 2] = s[2] / l;
  }
  const g = new BufferGeometry();
  if (src.index) g.setIndex(src.index);
  g.setAttribute('position', pos);
  if (nor) g.setAttribute('normal', nor);
  g.setAttribute('aSmooth', new BufferAttribute(sm, 3));
  g.boundingSphere = src.boundingSphere?.clone() ?? null;
  if (g.boundingSphere) g.boundingSphere.radius += 1;                  // the glaze (and its burst) stands proud
  skinCache.set(src, g);
  return g;
}

/** a chip's stones: the connected pieces of its geometry (vertices joined by position), each a geometry sharing the
 *  source's attributes with its own index, and its centre (mesh-local) */
function chipPieces(src: BufferGeometry): { geo: BufferGeometry; c: Vector3 }[] {
  const hit = pieceCache.get(src);
  if (hit) return hit;
  const pos = src.getAttribute('position');
  const idx = src.index;
  const nT = idx ? idx.count / 3 : pos.count / 3;
  const parent = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) parent[i] = i;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (i: number, j: number): void => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  const byPos = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const j = byPos.get(k);
    if (j === undefined) byPos.set(k, i); else join(i, j);
  }
  const vi = (t: number, c: number): number => (idx ? idx.getX(t * 3 + c) : t * 3 + c);
  for (let t = 0; t < nT; t++) { join(vi(t, 0), vi(t, 1)); join(vi(t, 1), vi(t, 2)); }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < nT; t++) {
    const r = find(vi(t, 0));
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(vi(t, 0), vi(t, 1), vi(t, 2));
  }
  const out: { geo: BufferGeometry; c: Vector3 }[] = [];
  const v = new Vector3();
  for (const list of groups.values()) {
    const box = new Box3();
    for (const i of list) box.expandByPoint(v.fromBufferAttribute(pos, i));
    const g = new BufferGeometry();
    g.setIndex(pos.count > 65535 ? new BufferAttribute(new Uint32Array(list), 1) : new BufferAttribute(new Uint16Array(list), 1));
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.computeBoundingSphere();
    out.push({ geo: g, c: box.getCenter(new Vector3()) });
  }
  // the larger stones first (the cap on falling stones keeps those)
  out.sort((p, q) => (q.geo.boundingSphere?.radius ?? 0) - (p.geo.boundingSphere?.radius ?? 0));
  pieceCache.set(src, out);
  return out;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function fract(x: number): number { return x - Math.floor(x); }
