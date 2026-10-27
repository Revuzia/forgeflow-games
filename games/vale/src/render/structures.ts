// VALE render — structures (r12 M9): damage states, the collapse and the ruin, the occlusion fade, the protected shell.
//
// Presentation only: this reads EntityView (hp, alive, targetable) and the UnitDef's art; the sim never waits on it
// and never learns of it. A structure GLB carries named nodes (art/blender/units/structure_kit.py):
//   _base (the plinth) · _glow_base (its hour-ticks) · _upper (the tower) > _chip1 _chip2 _dmg1 _dmg2 _glow _core · _ruin
//   * damage (UnitDef.art.damage): past `at[k]` of max hp the `_dmg<k+1>` cracks show (dark ink with a live accent
//     seam), `_chip<k+1>` breaks off and `vfx` plays once on the flank; the accent light then flickers, deeper at the
//     second stage, never above the 0.8 rest glow (a glow is a warning). Healing 6 % past a threshold mends that stage
//     (the Hourbell regenerates).
//   * death (UnitDef.art.ruin): `collapse` s. The tower shudders with every crack lit; its top then tips over its foot
//     (away from the killer) with an accelerating fall, `breakVfx` at the break; where it lands `landVfx`; it sinks
//     through the ground and fades. The `_ruin` (≤ ruin.height m) stays for the match and the accent light dies.
//     A structure seen first already dead is a ruin at once; a gate that respawns rises out of its plinth (0.9 s).
//   * occlusion: while your fighter, the hovered or the targeted unit stands behind a live structure from the camera,
//     the structure's upper part (from 0.5 m above its plinth) fades to 35 % (in 0.15 s, back in 0.35 s): per-actor
//     see-through clones over a depth prepass, so only the nearest surface shows (the actors.ts veils use the same idea).
//   * shell: while protected (untargetable) a dawnglass bell jar stands over the tower: a fresnel rim, the shield's
//     45° hatch, twelve hour-ticks at its foot and a slow rising band; it shatters outward in 0.45 s when the
//     protection drops.

import {
  Box3, Color, DoubleSide, LatheGeometry, type Material, Matrix4, Mesh, MeshBasicMaterial, type MeshStandardMaterial,
  NormalBlending, type Object3D, type PerspectiveCamera, Quaternion, ShaderMaterial, Vector2, Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { UnitDefT } from '../contracts/catalog.ts';
import type { EntityView, SimEvent, WorldView } from '../contracts/sim.ts';
import type { Actor } from './actors.ts';
import type { VfxSystem } from './vfx/system.ts';
import { patchWorldMaterial } from './world_material.ts';

/** occlusion fade: alpha of the faded part, its band above the plinth (m), fade in / out (s) */
export const STRUCT_FADE = { alpha: 0.35, from: 0.5, band: 0.7, inS: 0.15, outS: 0.35 } as const;
const MEND = 0.06;
const RISE_S = 0.9;
const SHELL_BREAK_S = 0.45;
const SHELL_COLOR = new Color().setStyle('#BFD3E6');      // dawnglass (tokens: the untargetable rim, the shield)
const FALL_MAX = (80 * Math.PI) / 180;
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
  shell: Mesh | null;
  shellK: number;
  shellBreak: number;
  seed: number;
  dipUntil: number;
  nextDip: number;
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
const _s0 = new Vector2();
const _s1 = new Vector2();

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

const SHELL_VERT = /* glsl */`
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
const SHELL_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uK;
uniform float uFlash;
uniform float uTime;
uniform float uH;
uniform float uR;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
  float rim = pow( f, 2.4 );
  float ang = atan( vP.z, vP.x );
  // the shield's 45-degree hatch, wrapped round the jar (arc length + height)
  float hatch = smoothstep( 0.86, 0.97, fract( ( ang * uR + vP.y ) * 2.6 ) );
  // twelve hour-ticks at the foot, the quarters longer
  float k = fract( ang / 6.2831853 * 12.0 + 0.5 );
  float q = step( 0.5, fract( ( ang / 6.2831853 * 12.0 + 0.5 ) / 3.0 + 0.17 ) );
  float tick = ( 1.0 - smoothstep( 0.035, 0.06, abs( k - 0.5 ) ) ) * ( 1.0 - smoothstep( mix( 0.32, 0.55, q ), mix( 0.42, 0.65, q ), vP.y ) );
  float foot = 1.0 - smoothstep( 0.0, 0.07, vP.y );
  // a band of light rising slowly up the jar
  float y = vP.y / uH;
  float band = exp( -pow( ( fract( y * 0.5 - uTime * 0.12 ) - 0.5 ) * 9.0, 2.0 ) );
  float a = 0.028 + 0.38 * rim + 0.07 * hatch * ( 0.35 + rim ) + 0.45 * tick + 0.4 * foot + 0.05 * band * ( 0.5 + rim );
  a = clamp( a * uK + uFlash * ( 0.25 + 0.5 * rim ), 0.0, 0.85 );
  gl_FragColor = vec4( uColor * ( 0.75 + 0.35 * rim + uFlash ), a );
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
      u, clones: [], upperMats: [], depth: [], depthMat: null, trans: false, plinth: 0.4, top: def.art.height, radius: 1,
      stage: 0, seen: false, dieT: -1, fallDir: new Vector3(1, 0, 0), broke: false, landed: false, dead: false, riseT: -1, fade: 0,
      shell: null, shellK: 0, shellBreak: -1, seed: (a.id * 0.6180339) % 1 * 100, dipUntil: 0, nextDip: 0, warmed: false,
    };
    // bounds (root-local): the plinth's top, the tower's top and radius
    const base = nodes.get('base');
    if (base) s.plinth = boundsIn(base, a.root, _box).max.y;
    if (upper) {
      boundsIn(upper, a.root, _box);
      s.top = _box.max.y;
      s.radius = Math.max(0.4, Math.abs(_box.min.x), Math.abs(_box.max.x), Math.abs(_box.min.z), Math.abs(_box.max.z));
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
    const dmgVis = s.dmg.map((d) => d?.visible ?? false);
    s.shell!.visible = true;
    for (const d of s.dmg) if (d) d.visible = true;
    const was = s.trans;
    this.setTransparent(s, true);
    for (const d of s.depth) d.visible = true;
    const ok = this.host.compile(a.root);
    this.setTransparent(s, was);
    for (const d of s.depth) d.visible = s.fade > 0.001;
    s.dmg.forEach((d, k) => { if (d) d.visible = dmgVis[k]; });
    s.shell!.visible = shellVis;
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
      // ── occlusion fade
      let want = 0;
      if (!s.dead && a.root.visible && s.upper) {
        for (const id of focus) {
          if (id < 0 || id === a.id) continue;
          const o = actors.get(id);
          if (o && o.visible && o.root.visible && o.view?.alive && this.occludes(s, o, cam)) { want = 1; break; }
        }
      }
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
      if (s.seen) for (let k = stage; k < want; k++) this.crackVfx(s, v, k);
      stage = want;
    } else while (stage > 0 && f > at[stage - 1] + MEND) stage--;
    if (stage !== s.stage || !s.seen) { s.stage = stage; this.showStage(s, stage); }
  }

  private showStage(s: Struct, stage: number): void {
    s.chips.forEach((c, k) => { if (c) showPart(c, stage <= k); });
    s.dmg.forEach((d, k) => { if (d) d.visible = stage > k; });
  }

  private crackVfx(s: Struct, v: EntityView, k: number): void {
    const id = s.def.art.damage?.vfx;
    if (!id) return;
    const a = s.a;
    const h = s.plinth + (s.top - s.plinth) * (k === 0 ? 0.62 : 0.45);
    const ang = s.seed + k * 2.1;
    const o = _v.set(a.x + Math.cos(ang) * s.radius * 0.7, a.h + h, a.y + Math.sin(ang) * s.radius * 0.7);
    this.host.vfx.spawn(id, { tier: 2, team: this.host.tint(v), element: null, ally: false, origin: o.clone(), ground: new Vector3(o.x, a.h, o.z), scale: 1, anchor: 'origin', world: true });
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
    }
    // the actor sets every accent to its glow each frame it updates; this scales that (idempotent)
    if (k !== 1 && s.a.visible) { const g = s.a.glowLevel * k; for (const m of s.accents) m.emissiveIntensity = g; }
  }

  // ── protected shell ────────────────────────────────────────────────────────────────────────────
  private ensureShell(s: Struct): void {
    if (s.shell) return;
    const r = s.radius * 1.12 + 0.15, H = Math.max(1.5, (s.top - s.plinth) * 1.06 + 0.2);
    const dome = Math.min(r * 0.9, H * 0.45), hc = H - dome;
    const prof: Vector2[] = [new Vector2(r, 0), new Vector2(r, hc * 0.5), new Vector2(r * 0.995, hc)];
    for (let i = 1; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; prof.push(new Vector2(Math.max(0.001, r * Math.cos(a)), hc + dome * Math.sin(a))); }
    const geo = new LatheGeometry(prof, 48);
    const mat = new ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, side: DoubleSide, blending: NormalBlending,
      uniforms: { uColor: { value: new Color() }, uK: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uH: { value: H }, uR: { value: r } },
    });
    mat.name = 'vale_struct_shell';
    const m = new Mesh(geo, mat);
    m.name = 'vale_struct_shell';
    m.userData.valeOutline = true;
    m.castShadow = false; m.receiveShadow = false;
    m.position.y = s.plinth;
    m.renderOrder = 5;
    m.visible = false;
    s.a.root.add(m);
    s.shell = m;
  }

  private shellUpdate(s: Struct, dt: number, v: EntityView): void {
    const prot = v.alive && !v.targetable && !s.dead;
    if (!prot && !s.shell) return;
    this.ensureShell(s);
    const sh = s.shell!;
    const u = (sh.material as ShaderMaterial).uniforms;
    if (prot) { s.shellBreak = -1; s.shellK = Math.min(1, s.shellK + dt / 0.4); sh.scale.setScalar(1); u.uFlash.value = 0; }
    else if (s.shellK > 0 && s.shellBreak < 0) s.shellBreak = 0;
    if (s.shellBreak >= 0) {
      s.shellBreak += dt;
      const b = Math.min(1, s.shellBreak / SHELL_BREAK_S);
      s.shellK = 1 - b;
      sh.scale.setScalar(1 + 0.14 * b);
      u.uFlash.value = 0.6 * (1 - b) * (1 - b);
      if (b >= 1) { s.shellBreak = -1; s.shellK = 0; }
    }
    sh.visible = s.shellK > 0.001 && s.a.root.visible;
    if (!sh.visible) return;
    (u.uColor.value as Color).copy(SHELL_COLOR).lerp(this.host.tint(v), 0.2);
    u.uK.value = s.shellK;
    u.uTime.value = this.time;
  }

  // ── occlusion ──────────────────────────────────────────────────────────────────────────────────
  /** does the structure stand between the camera and this unit (its body inside the tower's screen box, farther away)? */
  private occludes(s: Struct, o: Actor, cam: PerspectiveCamera): boolean {
    const a = s.a;
    const dS = _v.set(a.x, a.h + s.plinth, a.y).sub(cam.position).dot(_fwd);
    const dO = _v.set(o.x, o.h + o.artHeight * 0.5, o.y).sub(cam.position).dot(_fwd);
    if (dO < dS + 0.4) return false;
    // the tower's screen box (NDC) from the fade line up, and the unit's
    project(_s0, a.x, a.h + s.plinth + STRUCT_FADE.from, a.y, cam);
    project(_s1, a.x, a.h + s.top, a.y, cam);
    const ppm = Math.abs(_s1.y - _s0.y) / Math.max(0.5, s.top - s.plinth - STRUCT_FADE.from);
    const rx = s.radius * ppm * 0.9;
    const sx = _s0.x, yLo = Math.min(_s0.y, _s1.y), yHi = Math.max(_s0.y, _s1.y);
    project(_s0, o.x, o.h, o.y, cam);
    project(_s1, o.x, o.h + o.artHeight, o.y, cam);
    const ux = _s0.x, uLo = Math.min(_s0.y, _s1.y), uHi = Math.max(_s0.y, _s1.y);
    const uh = Math.max(1e-4, uHi - uLo);
    const urx = Math.max(o.radius * Math.abs(_s1.y - _s0.y) / Math.max(0.5, o.artHeight), uh * 0.18);
    // covered share of the unit's box (≥ 25 % hides enough to matter)
    const ox = Math.max(0, Math.min(ux + urx, sx + rx) - Math.max(ux - urx, sx - rx)) / (2 * urx);
    const oy = Math.max(0, Math.min(uHi, yHi) - Math.max(uLo, yLo)) / uh;
    return ox * oy >= 0.25;
  }

  private applyFade(s: Struct): void {
    const a = s.a;
    const on = s.fade > 0.001;
    s.u.uSfY0.value = a.h + s.plinth + STRUCT_FADE.from;
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
  info(): { id: number; def: string; team: number; stage: number; dead: boolean; collapsing: boolean; rising: boolean; ruin: boolean; fade: number; shell: number; plinth: number; top: number; radius: number }[] {
    return [...this.list.values()].map((s) => ({
      id: s.a.id, def: s.def.id, team: s.a.team, stage: s.stage, dead: s.dead, collapsing: s.dieT >= 0, rising: s.riseT >= 0, ruin: !!s.ruin?.visible,
      fade: +s.fade.toFixed(3), shell: +s.shellK.toFixed(3), plinth: +s.plinth.toFixed(3), top: +s.top.toFixed(3), radius: +s.radius.toFixed(3),
    }));
  }
}

/** show or hide a chip's meshes (their material, not the node: see GONE) */
function showPart(node: Object3D, shown: boolean): void {
  for (const m of meshes(node)) {
    if (shown && m.userData.sfGone) { m.material = m.userData.sfMat as Material; m.userData.sfGone = false; }
    else if (!shown && !m.userData.sfGone) { m.userData.sfMat = m.material; m.material = GONE; m.userData.sfGone = true; }
  }
}

function project(out: Vector2, x: number, y: number, z: number, cam: PerspectiveCamera): Vector2 {
  _v2.set(x, y, z).project(cam);
  return out.set(_v2.x, _v2.y);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function fract(x: number): number { return x - Math.floor(x); }
