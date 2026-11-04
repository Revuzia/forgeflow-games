// GENESIS — the god's pointer in the world (CONTRACT.md §11.4, §15.6; LIVING §0.1.7, §3.6, hook H7). The owner
// (2026-11-04): "the flying 'tornado' thing representing the users hand is no good, it can just be a hand, or the mouse
// pointer". So the god acts through the player's own mouse pointer: a clean CSS cursor (src/ui/styles.css
// body[data-hand]: an open hand idle over the world, a closed hand holding or dragging, a crosshair with a power armed)
// and here, in the world, only what the cursor cannot show:
//
//   * a small soft ring of light on the ground under the pointer (a constant ~14 px on screen at any distance), so the
//     player sees where it acts; regard tints it (warm gold trusted, pale silver-gold awed, cold blue-white feared)
//   * what it holds floats just under the pointer — on the camera's ray through the cursor, its top at the pointer —
//     drawn at its presentation size (render/fx/present.ts), lit, casting its own shadow; people are drawn by the crowds
//     at `pinch`, with a soft contact shadow under them
//   * a throw: while carrying, the arc a throw toward the cursor would fly with a reticle where it lands; flicked, a
//     short streak of light behind what it holds
//   * a rebuke or a soothing: a brief ground pulse (an expanding ring: cold and quick, warm and slow)
//   * a cast: the miracle's sigil traced in light in the air over the pointer (render/fx/sigils.ts)
// The sim's hand entity (HandView) is unchanged — it still lifts, places, hurls, rebukes and soothes. Nothing here is
// weather, a vortex, a column or a drawn hand; idle it costs one decal.

import {
  BufferAttribute, BufferGeometry, Color, CustomBlending, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, OneFactor,
  OneMinusSrcAlphaFactor, Points, ShaderMaterial, Vector3, type IUniform,
} from 'three';
import { makePropMaterial } from './fx/propmat.ts';
import { treeGeometry } from './gen/treegen.ts';
import { buildingMesh } from './gen/buildinggen.ts';
import { leafClusterTexture } from './gen/leaftex.ts';
import { TOUCH_N, stripGeometry, touchLook } from './gen/handgen.ts';
import { materialAt, materialIndex } from './life/catalog.ts';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER, clamp01, smooth } from './fx/fxcommon.ts';
import { DECAL, decal, type DecalPass } from './fx/decals.ts';
import { HELD_SHARE, heldTrueSize, presentScale, touchSize } from './fx/present.ts';
import { sigilOfMiracle, sigilStroke } from './fx/sigils.ts';
import type { PlanetView } from '../client/worldview.ts';
import type { HandView } from '../sim/types.ts';
import { groundHeight } from '../sim/grid/surface.ts';

/** what the pointer is doing (the sim's hand poses; for probes and the audio) */
export type TouchBehaviour = 'open' | 'reach' | 'lift' | 'point' | 'rebuke' | 'soothe' | 'sigil';

/** the UI's hand cursor states (src/ui/handinput.ts HandCursor) */
export type UiHandPose = 'none' | 'hover' | 'open' | 'carry' | 'press' | 'tool' | 'aim' | 'slap';

export interface HandCursor {
  planet: number;
  /** body-frame unit vector of the ground under the cursor */
  dir: ArrayLike<number>;
}

export interface HandFrame {
  pv: PlanetView;
  hand: HandView | null;
  camBody: Vector3;
  /** camera forward and up in the body frame */
  camFwd: Vector3;
  camUp: Vector3;
  /** real seconds since the last frame (motion), and the FX clock (animation; it stops while the sim is paused) */
  dt: number;
  fxTime: number;
  fxDt: number;
  cursor: HandCursor | null;
  uiPose: UiHandPose;
  aiming: boolean;
  decals: DecalPass;
  /** the primary planet's shared uniforms (proxied) */
  shared: Record<string, IUniform>;
  /** (unused since the pointer; kept for callers) the cloud deck's base radius and whether the world has air */
  cloudBase?: number;
  air?: boolean;
  /** the vertical field of view (deg) and the view's height (px): sizes that must read on screen */
  fov?: number;
  viewH?: number;
  /** (unused since the pointer; kept for callers) one-off weather */
  burst?: (kind: 'gust' | 'flash', p: Vector3, size: number) => void;
}

// ───────────────────────────── shaders ─────────────────────────────

const COMMON = /* glsl */ `
uniform vec3 uCol;       // the pointer's light (regard)
uniform vec3 uRim;       // a feared god's cold light
uniform float uDark;     // 0 … 1 how far the glow leans cold (feared)
uniform float uPres;     // presence 0..1
uniform float uTouchT;   // seconds (real time)
`;

const STRIP_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  vT = aT; vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const GLYPH_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
uniform float uTrace;    // how much of the stroke is drawn (0..1)
uniform float uGlyphK;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 0.5);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // a thread of light about a pixel wide in a broad glow of its own colour
  float core = exp(-x * x * 48.0), halo = exp(-x * x * 4.0) * (1.0 - smoothstep(0.75, 1.0, x));
  float drawn = 1.0 - smoothstep(uTrace - 0.004, uTrace + 0.004, vT);
  float head = exp(-pow((vT - uTrace) / 0.025, 2.0)) * (1.0 - step(0.999, uTrace));
  // (the light runs along the stroke, from where it began toward its head: beads of brightness, never a steady rod)
  float flow = 0.6 + 0.4 * sin(vT * 150.0 - uTouchT * 9.0) * (0.55 + 0.45 * sin(vT * 41.0 + uTouchT * 2.3));
  float ends = smoothstep(0.0, 0.035, vT);
  float kc = core * 0.55 * flow * drawn * ends + head * core * 1.3;
  float kh = halo * 0.2 * (0.75 + 0.25 * flow) * drawn * ends + head * halo * 0.45;
  vec3 col = mix(uCol, uRim, uDark * 0.75);
  vec3 deep = col * col * col;
  vec3 c = col * kc + deep * kh * 1.6 + vec3(0.22) * head * core;
  float veil = clamp(halo * 0.2 + core * 0.1, 0.0, 0.32) * max(drawn, head) * ends * uGlyphK * uPres * vis;
  gl_FragColor = vec4(c * uGlyphK * uPres * vis * fxDisplay(0.92), veil);
}
`;
const TRAIL_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
uniform float uTrailK;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 0.5);
  float a = pow(1.0 - vT, 1.6) * (1.0 - abs(vSide)) * uTrailK * vis;
  vec3 col = mix(uCol, uRim, uDark * 0.6);
  gl_FragColor = vec4(col * a * 1.2 * fxDisplay(0.8), 0.0);
}
`;

const ARC_VERT = /* glsl */ `
attribute float aT;
varying float vT;
varying float vZ;
uniform float uSize;
void main() {
  vT = aT;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (1.0 - 0.4 * aT);
}
`;
const ARC_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform vec3 uArcCol;
uniform float uArcAimK;
varying float vT;
varying float vZ;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float vis = fxSoft(vZ, 0.3);
  float march = 0.6 + 0.4 * sin(vT * 60.0 - uFxTime * 8.0);
  float a = (1.0 - d) * uArcAimK * vis * march;
  gl_FragColor = vec4(uArcCol * a * fxDisplay(0.9), 0.0);
}
`;

// ───────────────────────────── the visual ─────────────────────────────

const _m = new Matrix4();
const _v = new Vector3(), _w = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _s = new Vector3();

interface Sigil { stroke: Float32Array; t0: number }

/** the ring under the pointer: its radius and line width, in screen pixels */
export const RING_PX = 12;
const RING_W_PX = 1.6;

export class HandVisual {
  readonly group = new Group();
  /** what the pointer is doing now (dominant behaviour; for probes and the audio) */
  behaviour: TouchBehaviour = 'open';
  /** body-frame state of the grip point (where things are held), its velocity, the presentation size at its distance */
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  scale = 8;
  presence = 0;
  /** forced on (tests / photo) or off */
  force: boolean | null = null;
  /** captures: hold the pointer's clock at this many seconds (pulses settle at once); null runs on real time */
  hold: number | null = null;
  /** captures: pin regard (−1 feared … +1 trusted) over the sim's HandView.regard; null reads the sim */
  pinRegard: number | null = null;
  /** exposure the pointer asks of the eye (EV): always 0 now (the old feared gloom is gone; kept for GodFx) */
  exposureEV = 0;
  /** what it holds now: kind and id (from the sim) */
  heldKind = '';
  heldId = -1;
  /** the point a held person hangs from (the top of their body), body frame */
  readonly pinch = new Vector3();
  /** where a held boulder, tree or bundle is drawn (its centre) */
  readonly grip = new Vector3();
  /** the ground point under the pointer (the ring's centre), body frame */
  readonly ground = new Vector3();
  /** 0 open … 1 holding (eased) */
  grasp = 0;
  /** a held thing's swing (rad): a pendulum driven by the pointer's acceleration */
  swing = 0;
  /** regard as the pointer shows it (eased; −1 feared … +1 trusted) */
  regard = 0;
  /** the ring's on-screen radius (px) and the metres per pixel at the ground point, last frame (probes) */
  ringPx = 0;
  mPerPx = 0;
  private swingV = 0;
  private lastVf = 0;
  private fwd = new Vector3(0, 0, 1);
  private placed = false;
  private lastSim = '';
  private simActiveAt = -1e9;
  private cursorAt = -1e9;
  private lastHvPose = 'open';
  private slapAt = -1e9;
  private strokeAt = -1e9;
  private castAt = -1e9;
  private sigil: Sigil | null = null;
  private point = 0;
  private built = false;
  private visibleNow = false;
  private heldDrawn = 0;
  private spin = 0;
  private readonly u = {
    uCol: { value: new Color(1, 0.9, 0.7) }, uRim: { value: new Color(0.55, 0.7, 1) }, uDark: { value: 0 }, uPres: { value: 0 },
    uTouchT: { value: 0 }, uTrace: { value: 0 }, uGlyphK: { value: 0 }, uTrailK: { value: 0 },
    uArcCol: { value: new Color(1, 0.85, 0.5) }, uArcAimK: { value: 0 }, uSize: { value: 6 },
  };
  private glyph!: Mesh;
  private trailMesh!: Mesh;
  private arcMesh!: Points;
  private glyphGeo = stripGeometry(TOUCH_N.glyph);
  private trailGeo = stripGeometry(TOUCH_N.trail);
  private arcGeo = new BufferGeometry();
  private trail: { p: Vector3; t: number }[] = [];
  private heldMeshes = new Map<string, Mesh>();
  private heldGroup = new Group();
  private heldMat: MeshStandardMaterial | null = null;
  private heldLeafMat: MeshStandardMaterial | null = null;
  private sharedU: Record<string, IUniform> = {};
  private fxU: Record<string, IUniform> = {};
  private mats: ShaderMaterial[] = [];

  constructor() {
    this.group.name = 'touch';
    this.group.matrixAutoUpdate = false;
    this.heldGroup.matrixAutoUpdate = false;
    this.group.add(this.heldGroup);
    this.arcGeo.setAttribute('position', new BufferAttribute(new Float32Array(96 * 3), 3));
    this.arcGeo.setAttribute('aT', new BufferAttribute(new Float32Array(96), 1));
  }

  /** the FX materials need the shared depth / exposure uniforms (GodFx) */
  bindFx(fx: Record<string, IUniform>): void {
    this.fxU = fx;
    for (const m of this.mats) Object.assign(m.uniforms, fx);
  }

  /** make the meshes on first use */
  private build(shared: Record<string, IUniform>): void {
    if (this.built) return;
    this.built = true;
    this.sharedU = shared;
    const mk = (vert: string, frag: string, additive: boolean): ShaderMaterial => {
      const uniforms: Record<string, IUniform> = { ...this.u };
      for (const k of Object.keys(this.fxU)) uniforms[k] = this.fxU[k];
      for (const k of Object.keys(shared)) if (!(k in uniforms)) uniforms[k] = shared[k];
      const m = new ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
        ...(additive ? ADD_LIGHT : { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor }),
      });
      this.mats.push(m);
      return m;
    };
    const fxMesh = <T extends Mesh | Points>(o: T, order: number): T => {
      o.frustumCulled = false; o.matrixAutoUpdate = false; o.layers.set(FX_LAYER); o.renderOrder = order;
      o.visible = false;
      this.group.add(o);
      return o;
    };
    this.glyph = fxMesh(new Mesh(this.glyphGeo, mk(STRIP_VERT, GLYPH_FRAG, false)), 18);
    this.trailMesh = fxMesh(new Mesh(this.trailGeo, mk(STRIP_VERT, TRAIL_FRAG, true)), 18);
    this.arcMesh = fxMesh(new Points(this.arcGeo, mk(ARC_VERT, ARC_FRAG, true)), 19);
    this.heldMat = makePropMaterial(shared, { key: 'held', roughness: 0.88 });
    // the held props made with the rest, hidden, so Renderer.warmUp (three's compile walks hidden objects too) links their
    // programs behind the loading screen: made lazily, the first lift of a hut or a tree linked new programs inside the
    // frame — a stall of tens of ms on ANGLE / Metal right on the grab (macfix verify-r1-feel lift.mjs: +6, +2)
    for (const k of ['rock', 'building', 'tree']) this.heldMesh(k);
  }

  /** the mesh of a held prop of kind `k` (made once, kept in heldGroup, hidden until held) */
  private heldMesh(k: string): Mesh | undefined {
    let mesh = this.heldMeshes.get(k);
    if (!mesh && this.heldMat) {
      if (k === 'tree' && !this.heldLeafMat) this.heldLeafMat = makeLeafPropMaterial(this.sharedU);
      mesh = new Mesh(heldPropGeometry(k), k === 'tree' ? this.heldLeafMat! : this.heldMat);
      mesh.matrixAutoUpdate = false;
      mesh.layers.enable(1);
      mesh.visible = false;
      this.heldMeshes.set(k, mesh);
      this.heldGroup.add(mesh);
    }
    return mesh;
  }

  /** nothing of the pointer's own casts: what it holds is a prop, swapped by GodFx with the others */
  swapDepth(_depth: boolean): void { /* nothing of its own casts */ }

  /** a rebuke, a soothing or a cast seen in the events (GodFx): `what` is the miracle's kind for a cast */
  pulse(kind: 'slap' | 'stroke' | 'cast', t: number, what?: string): void {
    if (kind === 'slap') this.slapAt = t;
    else if (kind === 'stroke') this.strokeAt = t;
    else {
      this.castAt = t;
      this.sigil = { stroke: sigilStroke(sigilOfMiracle(what ?? ''), TOUCH_N.glyph), t0: t };
    }
  }

  update(f: HandFrame): void {
    const pv = f.pv;
    const hv = f.hand && f.hand.planet === pv.id ? f.hand : null;
    const R = pv.params.radius;
    const t = this.hold ?? f.fxTime;
    // ── presence: the cursor over this world, or the sim's hand doing something ──
    const sig = hv ? `${hv.pos[0].toFixed(5)},${hv.pos[1].toFixed(5)},${hv.alt.toFixed(1)},${hv.pose},${hv.held ? hv.held.kind + hv.held.id : ''}` : '';
    if (hv && sig !== this.lastSim) {
      if (this.lastSim) this.simActiveAt = t;
      this.lastSim = sig;
    }
    const cursorHere = f.cursor && f.cursor.planet === pv.id ? f.cursor : null;
    if (cursorHere) this.cursorAt = t;
    const simActive = !!hv && (!!hv.held || hv.pose !== 'open' || t - this.simActiveAt < 30);
    const altCam = this.camAltitude(f);
    let want = cursorHere || simActive || t - this.cursorAt < 0.25 ? 1 : 0;
    if (altCam > R * 4) want = 0;
    // from orbit only the player's own cursor brings it (the sim's hand drifting on its own lit a lone speck)
    if (altCam > R * 1.2 && !cursorHere) want = 0;
    if (this.force != null) want = this.force ? 1 : 0;
    // (quick: it is the pointer — it is there when the cursor is, gone when it leaves)
    this.presence += (want - this.presence) * Math.min(1, f.dt * (want > this.presence ? 12 : 10));
    if (this.force === true) this.presence = 1;
    // (made on the first frame, before the pointer is ever shown, so the load-time warm-up finds its materials — the
    // ring's, the strokes', the held props' — and links them behind the loading screen, not on the first hover or grab)
    this.build(f.shared);
    if (this.presence < 0.004 && !want) {
      this.presence = 0;
      this.group.visible = false;
      this.visibleNow = false;
      this.placed = false;
      this.ringPx = 0;
      return;
    }
    this.group.visible = true;
    this.visibleNow = true;
    const dt = Math.min(0.1, f.dt);
    this.heldKind = hv?.held ? hv.held.kind : '';
    this.heldId = hv?.held ? hv.held.id : -1;
    // ── behaviour: the sim's pose, the UI's cursor, one-off events ──
    const ui = cursorHere ? f.uiPose : 'none';
    const hp = hv?.pose ?? 'open';
    if (hp !== this.lastHvPose) {
      if (hp === 'slap') this.slapAt = t;
      if (hp === 'stroke') this.strokeAt = t;
      if (hp === 'cast' && t - this.castAt > 1.5) this.pulse('cast', t);
      this.lastHvPose = hp;
    }
    if (ui === 'slap' && t - this.slapAt > 0.9) this.slapAt = t;
    const lifting = this.heldKind !== '';
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, this.hold !== null ? 1 : dt * rate);
    this.grasp = ease(this.grasp, lifting ? 1 : 0, 8);
    this.point = ease(this.point, !lifting && (ui === 'tool' || ui === 'aim' || hp === 'point') ? 1 : 0, 8);
    const rebukeAge = t - this.slapAt, sootheAge = t - this.strokeAt, castAge = t - this.castAt;
    const rk = rebukeAge >= 0 && rebukeAge < 0.6 ? 1 - rebukeAge / 0.6 : 0;
    const sk = sootheAge >= 0 && sootheAge < 1.4 ? 1 - sootheAge / 1.4 : 0;
    const ck = castAge >= 0 && castAge < 2.4 ? Math.sin(Math.PI * Math.min(1, castAge / 2.4)) : 0;
    this.behaviour = rk > 0.05 ? 'rebuke' : ck > 0.2 ? 'sigil' : lifting ? 'lift' : this.point > 0.5 ? 'point'
      : sk > 0.05 || hp === 'stroke' ? 'soothe' : ui === 'open' || ui === 'press' ? 'reach' : 'open';
    // ── regard → the ring's tint (eased: a people's view of its god does not flip in a frame) ──
    const regard = Math.max(-1, Math.min(1, this.pinRegard ?? hv?.regard ?? hv?.alignment ?? 0));
    this.regard += (regard - this.regard) * Math.min(1, this.hold !== null ? 1 : dt * 1.2);
    const look = touchLook(this.regard);
    const col = this.u.uCol.value;
    col.setRGB(look.light[0], look.light[1], look.light[2]);
    this.u.uDark.value = look.dark;
    this.u.uRim.value.setRGB(look.rim[0], look.rim[1], look.rim[2]);
    this.u.uArcCol.value.copy(col);
    this.u.uPres.value = this.presence;
    this.u.uTouchT.value = t % 3600;
    // ── placement ──
    this.place(f, hv, cursorHere, dt);
    const L = this.scale;
    const up = _v.copy(this.ground).normalize();
    this.spin += dt * 0.6;
    this.heldVisual(L, t);
    // the pendulum: pushed by its forward acceleration, damped
    {
      const vf = this.vel.dot(this.fwd);
      const acc = dt > 0 ? (vf - this.lastVf) / dt : 0;
      this.lastVf = vf;
      const w0 = 2.6;
      this.swingV += (-w0 * w0 * this.swing - 1.2 * this.swingV - acc * 0.1) * dt;
      this.swing = Math.max(-0.9, Math.min(0.9, this.swing + this.swingV * dt));
    }
    this.glyphUpdate(f, L, castAge);
    this.trailUpdate(f);
    this.arcUpdate(f, hv);
    // ── on the ground: the ring of light under the pointer (a constant size on screen), a rebuke's or a soothing's
    //    brief pulse, and under what it holds a soft contact shadow ──
    const gp: [number, number, number] = [this.ground.x, this.ground.y, this.ground.z];
    const camD = this.ground.distanceTo(f.camBody);
    const mpp = (f.fov && f.viewH ? Math.tan((f.fov * Math.PI) / 360) * 2 / f.viewH : 0.0015) * camD;
    this.mPerPx = mpp;
    const ringK = this.presence * (1 - 0.75 * this.point) * (1 - 0.5 * ck);
    this.ringPx = RING_PX * (1 - 0.25 * this.grasp);
    if (ringK > 0.01) {
      const rr = this.ringPx * mpp;
      const ring = decal(DECAL.ripple, gp, rr * 1.6 + 1);
      ring.cr = col.r; ring.cg = col.g; ring.cb = col.b;
      ring.p0 = rr; ring.p1 = Math.max(0.02, RING_W_PX * mpp); ring.p2 = 0.75 * ringK;
      // pinned to the pointer's ray (see decals.ts): the drawn terrain may sit metres off the sampled height
      ring.q0 = Math.max(6, rr * 2); ring.q1 = 1;
      f.decals.add(ring);
    }
    if (rk > 0) {
      // a rebuke: a quick cold ring snapping out from the pointer
      const a = 1 - rk;
      const rr = (RING_PX + 70 * Math.sqrt(a)) * mpp;
      const p = decal(DECAL.ripple, gp, rr * 1.4 + 1);
      p.cr = 0.62 + 0.3 * look.feared; p.cg = 0.76; p.cb = 1.0;
      p.p0 = rr; p.p1 = Math.max(0.05, (3 + 6 * a) * mpp); p.p2 = 1.1 * rk * this.presence;
      p.q0 = Math.max(6, rr); p.q1 = 1;
      f.decals.add(p);
    }
    if (sk > 0) {
      // a soothing: a warm ring opening slowly, and a soft warm light in it
      const a = 1 - sk;
      const rr = (RING_PX + 45 * a) * mpp;
      const p = decal(DECAL.ripple, gp, rr * 1.4 + 1);
      p.cr = 1.0; p.cg = 0.78; p.cb = 0.42;
      p.p0 = rr; p.p1 = Math.max(0.05, (4 + 8 * a) * mpp); p.p2 = 0.7 * sk * this.presence;
      p.q0 = Math.max(6, rr); p.q1 = 1;
      f.decals.add(p);
    }
    if (this.grasp > 0.05) this.contactShadow(f, up, mpp);
  }

  /** a soft round shadow on the ground under what it holds (people are drawn by the crowds and cast none of their own here) */
  private contactShadow(f: HandFrame, up: Vector3, mpp: number): void {
    const c = this.heldKind === 'agent' ? _s.copy(this.pinch).addScaledVector(up, -0.9) : _s.copy(this.grip);
    const cu = _x.copy(c).normalize();
    const g = groundHeight(f.pv.ground, cu.x, cu.y, cu.z);
    const h = Math.max(0, c.length() - g);
    const size = Math.max(this.heldKind === 'agent' ? 0.45 : this.heldDrawn * 0.45, 3 * mpp);
    const r = size * (1 + 0.12 * Math.min(6, h / Math.max(0.5, size)));
    const sh = decal(DECAL.shadow, [cu.x * g, cu.y * g, cu.z * g], r * 1.3 + 1);
    sh.ax = this.fwd.x; sh.ay = this.fwd.y; sh.az = this.fwd.z;
    sh.p0 = r; sh.p1 = r; sh.p2 = 0.9;
    sh.ca = 0.5 * this.grasp * this.presence / (1 + 0.15 * h / Math.max(0.5, size));
    // (a generous slab: the drawn terrain can sit a few metres off the sampled ground height)
    sh.q0 = Math.max(6, size * 2);
    f.decals.add(sh);
  }

  /** the camera's altitude over the ground under it */
  private camAltitude(f: HandFrame): number {
    const c = f.camBody;
    const l = c.length() || 1;
    return l - groundHeight(f.pv.ground, c.x / l, c.y / l, c.z / l);
  }

  private place(f: HandFrame, hv: HandView | null, cursor: HandCursor | null, dt: number): void {
    const pv = f.pv;
    // (aiming a throw, what it holds stays where the sim's hand is and the cursor picks the target)
    const aimingHere = f.aiming && !!hv && !!this.heldKind;
    let ux: number, uy: number, uz: number;
    const viaCursor = !!cursor && !aimingHere;
    if (viaCursor) { ux = cursor!.dir[0]; uy = cursor!.dir[1]; uz = cursor!.dir[2]; }
    else if (hv) { ux = hv.pos[0]; uy = hv.pos[1]; uz = hv.pos[2]; }
    else if (this.placed) { ux = this.ground.x; uy = this.ground.y; uz = this.ground.z; }
    else { ux = 0; uy = 1; uz = 0; }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    let g = groundHeight(pv.ground, ux, uy, uz);
    const water = pv.fields.get('water');
    if (water) {
      const surf = pv.fields.get('surface');
      if (surf) g = Math.max(g, pv.params.radius + pv.grid.sample(surf, ux, uy, uz) + pv.grid.sample(water, ux, uy, uz));
    }
    // the ring sits on the ground under the pointer, exactly (the pointer is the player's: no lag)
    this.ground.set(ux * g, uy * g, uz * g);
    const altCam = this.camAltitude(f);
    const cx = f.camBody.x - ux * g, cy = f.camBody.y - uy * g, cz = f.camBody.z - uz * g;
    const camDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const camD = Math.min(camDist, altCam * 3.5 + 40);
    const Lw = touchSize(camD);
    this.scale = this.placed ? this.scale + (Lw - this.scale) * Math.min(1, dt * 4) : Lw;
    const L = this.scale;
    // where what it holds floats: just under the pointer. Its height over the ground (enough that it clears it, drawn at
    // its presentation size) is taken back along the camera's ray through the cursor, so on screen it stays at the
    // pointer whatever the view; a held thing hangs with its top at the pointer.
    const hs = this.heldKind === 'agent' ? 1.8 : this.heldKind === 'tree' ? Math.max(12, HELD_SHARE * L)
      : this.heldKind === 'building' ? Math.max(5, HELD_SHARE * L) : Math.max(1.5, HELD_SHARE * L);
    const hover = this.heldKind ? Math.max(hv && !viaCursor ? hv.alt : 0, hs * 0.75 + 0.6) : 0.3;
    let tx: number, ty: number, tz: number;
    if (viaCursor && camDist > 1e-3) {
      const bx = cx / camDist, by = cy / camDist, bz = cz / camDist;
      const cosU = Math.max(0.25, bx * ux + by * uy + bz * uz);
      const s = Math.min(hover / cosU, camDist * 0.8);
      tx = ux * g + bx * s; ty = uy * g + by * s; tz = uz * g + bz * s;
    } else { tx = ux * (g + hover); ty = uy * (g + hover); tz = uz * (g + hover); }
    // a stiff spring for the held thing's weight (no lag without one); far jumps (a camera cut) snap
    if (!this.placed || Math.hypot(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z) > L * 25) {
      this.pos.set(tx, ty, tz); this.vel.set(0, 0, 0); this.placed = true;
    } else if (dt > 0) {
      // (critically damped, solved exactly over the step: stable at any frame rate)
      const w = this.heldKind ? 18 : 40;
      const e = Math.exp(-w * dt);
      const sx = springStep(this.pos.x - tx, this.vel.x, w, dt, e), sy = springStep(this.pos.y - ty, this.vel.y, w, dt, e), sz = springStep(this.pos.z - tz, this.vel.z, w, dt, e);
      this.pos.set(tx + sx[0], ty + sy[0], tz + sz[0]);
      this.vel.set(sx[1], sy[1], sz[1]);
    }
    const up = _y.copy(this.pos).normalize();
    // a person hangs from the pointer by the top of them; a thing hangs with its top at the pointer
    this.pinch.copy(this.pos);
    this.grip.copy(this.pos).addScaledVector(up, this.heldKind && this.heldKind !== 'agent' ? -this.heldDrawn * 0.5 : -0.95);
    // the facing (for what it holds): away from the camera, level; aiming, toward the target
    const fw = _z.copy(f.camFwd).addScaledVector(up, -f.camFwd.dot(up));
    if (aimingHere && cursor) {
      const R = pv.params.radius;
      fw.set(cursor.dir[0] * R - this.pos.x, cursor.dir[1] * R - this.pos.y, cursor.dir[2] * R - this.pos.z);
      fw.addScaledVector(up, -fw.dot(up));
      if (fw.lengthSq() < 1) fw.copy(f.camFwd).addScaledVector(up, -f.camFwd.dot(up));
    }
    if (fw.lengthSq() < 1e-6) fw.copy(f.camUp).addScaledVector(up, -f.camUp.dot(up));
    fw.normalize();
    this.fwd.lerp(fw, this.placed ? Math.min(1, dt * 6) : 1).addScaledVector(up, -this.fwd.dot(up)).normalize();
  }

  /** a boulder, a tree, a hut or a bundle under the pointer (people are drawn by the crowds at `pinch`) */
  private heldVisual(L: number, t: number): void {
    const k = this.heldKind;
    for (const [key, m] of this.heldMeshes) m.visible = key === k;
    if (!k) { this.heldDrawn = 0; return; }
    if (k === 'agent') { this.heldDrawn = 1.8; return; }
    if (k === 'animal') { this.heldDrawn = Math.max(1.4, HELD_SHARE * L); return; }
    const { size: sTrue, unit } = heldTrueSize(k, this.heldId);
    const drawn = presentScale(sTrue, L, -1);
    this.heldDrawn = drawn;
    const mesh = this.heldMesh(k);
    if (!mesh) return;
    mesh.visible = true;
    const up = _v.copy(this.grip).normalize();
    const s = drawn / unit;
    // it turns slowly, tilted a little, rocking with the swing
    const spin = this.spin * 0.3;
    const tilt = (k === 'tree' ? 0.25 : 0.15) + this.swing * 0.5 + Math.sin(t * 0.9) * 0.04;
    const ex = _x.crossVectors(up, this.fwd).normalize();
    const ez = _z.crossVectors(ex, up);
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const rx = _s.copy(ex).multiplyScalar(cs).addScaledVector(ez, sn);
    const rz = _w.copy(ez).multiplyScalar(cs).addScaledVector(ex, -sn);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const by = _y.copy(up).multiplyScalar(ct).addScaledVector(rz, st);
    const bz = rz.multiplyScalar(ct).addScaledVector(up, -st);
    _m.makeBasis(rx, by, bz).scale(_x.set(s, s, s));
    // centred on the grip: a tree by the middle of its height, a hut by its middle, a rock and a bundle at their centre
    const lift = k === 'tree' ? -drawn * 0.5 : k === 'building' ? -drawn * 0.35 : 0;
    const e = _m.elements;
    _m.setPosition(this.grip.x + e[4] / s * lift, this.grip.y + e[5] / s * lift, this.grip.z + e[6] / s * lift);
    mesh.matrix.copy(_m);
    mesh.matrixWorldNeedsUpdate = true;
  }

  /** the sigil of a cast, traced in light in the air over the pointer, facing the camera */
  private glyphUpdate(f: HandFrame, L: number, age: number): void {
    const sg = this.sigil;
    if (!sg || age < 0 || age > 2.6) { this.glyph.visible = false; if (sg && age > 2.6) this.sigil = null; return; }
    this.glyph.visible = true;
    this.u.uTrace.value = smooth(0, 0.95, age);
    this.u.uGlyphK.value = smooth(0, 0.15, age) * (1 - smooth(1.9, 2.6, age));
    const wup = _w.copy(this.ground).normalize();
    const up = _y.copy(f.camUp);
    const right = _x.copy(f.camFwd).cross(up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0).cross(up);
    right.normalize();
    up.crossVectors(right, f.camFwd).normalize();
    const G = L * 0.75;
    const base = this.ground;
    const cx = base.x + wup.x * L * 1.4, cy = base.y + wup.y * L * 1.4, cz = base.z + wup.z * L * 1.4;
    const pos = this.glyphGeo.getAttribute('position') as BufferAttribute;
    const cam = f.camBody;
    const wpx = f.fov && f.viewH ? Math.tan((f.fov * Math.PI) / 360) * 2 / f.viewH : 0.002;
    const n = TOUCH_N.glyph, st = sg.stroke, tw = this.u.uTouchT.value;
    for (let i = 0; i < n; i++) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1);
      const px = cx + (right.x * st[i * 2] + up.x * st[i * 2 + 1]) * G, py = cy + (right.y * st[i * 2] + up.y * st[i * 2 + 1]) * G, pz = cz + (right.z * st[i * 2] + up.z * st[i * 2 + 1]) * G;
      const tx = (st[j1 * 2] - st[j0 * 2]), ty = (st[j1 * 2 + 1] - st[j0 * 2 + 1]);
      const tl = Math.hypot(tx, ty) || 1;
      const sx = -ty / tl, sy = tx / tl;
      const d = Math.hypot(cam.x - px, cam.y - py, cam.z - pz);
      const w = Math.max(L * 0.05, d * wpx * 7);
      const wob = G * 0.02 * (0.6 * Math.sin(i * 0.43 + tw * 7.3) + 0.4 * Math.sin(i * 1.31 - tw * 11.7));
      const qx = px + (right.x * sx + up.x * sy) * wob, qy = py + (right.y * sx + up.y * sy) * wob, qz = pz + (right.z * sx + up.z * sy) * wob;
      const ox = (right.x * sx + up.x * sy) * w, oy = (right.y * sx + up.y * sy) * w, oz = (right.z * sx + up.z * sy) * w;
      pos.setXYZ(i * 2, qx + ox, qy + oy, qz + oz);
      pos.setXYZ(i * 2 + 1, qx - ox, qy - oy, qz - oz);
    }
    pos.needsUpdate = true;
  }

  /** a short streak of light behind what it holds when it is flicked (a throw) */
  private trailUpdate(f: HandFrame): void {
    const holding = this.heldKind !== '';
    const at = this.heldKind === 'agent' ? this.pinch : this.grip;
    const spd = holding ? this.vel.length() / this.scale : 0;
    const now = f.fxTime;
    if (spd > 1.2 || this.trail.length) this.trail.push({ p: at.clone(), t: now });
    while (this.trail.length && now - this.trail[0].t > 0.3) this.trail.shift();
    if (this.trail.length > TOUCH_N.trail) this.trail.splice(0, this.trail.length - TOUCH_N.trail);
    const want = clamp01((spd - 1.2) / 3);
    const k = this.u.uTrailK;
    k.value += (want - k.value) * Math.min(1, f.dt * 6);
    const n = this.trail.length;
    this.trailMesh.visible = n > 2 && k.value > 0.01;
    if (!this.trailMesh.visible) { if (k.value < 0.01) this.trail.length = 0; return; }
    const pos = this.trailGeo.getAttribute('position') as BufferAttribute;
    const age = this.trailGeo.getAttribute('aT') as BufferAttribute;
    const camB = f.camBody;
    const N = TOUCH_N.trail;
    const width = Math.max(0.3, this.heldDrawn * 0.35);
    for (let i = 0; i < N; i++) {
      const j = Math.min(n - 1, Math.max(0, n - N + i));
      const p = this.trail[j].p;
      const q = this.trail[Math.min(n - 1, j + 1)].p, o = this.trail[Math.max(0, j - 1)].p;
      const tx = q.x - o.x, ty = q.y - o.y, tz = q.z - o.z;
      const vx = camB.x - p.x, vy = camB.y - p.y, vz = camB.z - p.z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const a = clamp01((now - this.trail[j].t) / 0.3);
      const w = width * (1 - a * 0.7);
      sx *= w / sl; sy *= w / sl; sz *= w / sl;
      pos.setXYZ(i * 2, p.x + sx, p.y + sy, p.z + sz);
      pos.setXYZ(i * 2 + 1, p.x - sx, p.y - sy, p.z - sz);
      age.setX(i * 2, a); age.setX(i * 2 + 1, a);
    }
    pos.needsUpdate = true; age.needsUpdate = true;
  }

  /** while carrying: the arc a throw toward the cursor would fly (the sim's aimed throw: 35°, the speed to reach it) */
  private arcUpdate(f: HandFrame, hv: HandView | null): void {
    const want = this.heldKind && f.cursor && f.cursor.planet === f.pv.id ? (f.aiming ? 1 : 0.35) : 0;
    const k = this.u.uArcAimK;
    k.value += (want - k.value) * Math.min(1, f.dt * 5);
    this.arcMesh.visible = k.value > 0.02 && !!f.cursor && !!hv;
    if (!this.arcMesh.visible || !f.cursor || !hv) return;
    const pv = f.pv;
    const g0 = pv.params.gravity || 9.8;
    const start = _x.copy(this.heldKind === 'agent' ? this.pinch : this.grip);
    const to = _w.set(f.cursor.dir[0], f.cursor.dir[1], f.cursor.dir[2]).normalize();
    const up0 = _y.copy(start).normalize();
    const range = Math.acos(Math.max(-1, Math.min(1, up0.dot(to)))) * pv.params.radius;
    const ang = (35 * Math.PI) / 180;
    const v = Math.min(2000, Math.sqrt(Math.max(1, (range * g0) / Math.sin(2 * ang))));
    const dir = to.addScaledVector(up0, -to.dot(up0)).normalize();
    const vel = _z.copy(dir).multiplyScalar(v * Math.cos(ang)).addScaledVector(up0, v * Math.sin(ang));
    const pos = this.arcGeo.getAttribute('position') as BufferAttribute;
    const at = this.arcGeo.getAttribute('aT') as BufferAttribute;
    const p = start;
    const flight = Math.max(0.5, (2 * v * Math.sin(ang)) / g0) * 1.15;
    const dtS = flight / 95;
    let landed = -1;
    for (let i = 0; i < 96; i++) {
      pos.setXYZ(i, p.x, p.y, p.z);
      at.setX(i, i / 95);
      if (landed >= 0) continue;
      const r = p.length();
      const gk = g0 * (pv.params.radius / r) * (pv.params.radius / r);
      vel.addScaledVector(p, -gk * dtS / r);
      p.addScaledVector(vel, dtS);
      const l = p.length();
      if (l < groundHeight(pv.ground, p.x / l, p.y / l, p.z / l)) landed = i;
    }
    if (landed >= 0) for (let i = landed + 1; i < 96; i++) pos.setXYZ(i, p.x, p.y, p.z);
    pos.needsUpdate = true; at.needsUpdate = true;
    this.arcGeo.setDrawRange(0, landed >= 0 ? landed + 1 : 96);
    this.u.uSize.value = 6;
    const li = landed >= 0 ? landed : 95;
    const d = decal(DECAL.reticle, [pos.getX(li), pos.getY(li), pos.getZ(li)], Math.max(4, this.scale * 0.5));
    d.cr = this.u.uCol.value.r; d.cg = this.u.uCol.value.g; d.cb = this.u.uCol.value.b; d.ca = k.value;
    d.p0 = Math.max(3, this.scale * 0.35); d.p1 = 0.6; d.p2 = 1.2; d.p3 = 0.3;
    f.decals.add(d);
  }

  get visible(): boolean { return this.visibleNow; }
  /** the pointer's light colour now (its regard): what it throws is streaked in it */
  get light(): Color { return this.u.uCol.value; }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    this.glyphGeo.dispose();
    this.trailGeo.dispose();
    this.arcGeo.dispose();
    // (the tree and hut geometries are the generators' cached ones: not ours to dispose)
    for (const [k, m] of this.heldMeshes) if (k !== 'tree' && k !== 'building') m.geometry.dispose();
    this.heldMat?.dispose();
    this.heldLeafMat?.dispose();
  }
}

/**
 * One step of a critically damped spring (angular frequency w) toward 0: offset x0 and velocity v0 after dt, exactly
 * (`e` = exp(−w·dt)): x = (x0 + (v0 + w·x0)·dt)·e, v = (v0 − w·(v0 + w·x0)·dt)·e. It never rings and never diverges,
 * whatever the step (from rest it closes without passing its target).
 */
export function springStep(x0: number, v0: number, w: number, dt: number, e = Math.exp(-w * dt)): [number, number] {
  const c = v0 + w * x0;
  return [(x0 + c * dt) * e, (v0 - w * c * dt) * e];
}

// ───────────────────────────── held things ─────────────────────────────

function vcol(geo: BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]): BufferGeometry {
  const p = geo.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const col = f(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  geo.setAttribute('color', new BufferAttribute(c, 3));
  return geo;
}

/** a lumpy boulder of radius ~1 (an icosphere displaced by noise) */
export function boulderGeo(seed: number): BufferGeometry {
  const g = icosphere(2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.18 * Math.sin(x * 4.1 + seed) * Math.cos(y * 3.3 - seed) + 0.1 * Math.sin(z * 7.7 + x * 2.0 + seed * 2);
    p.setXYZ(i, x * n * 1.1, y * n * 0.85, z * n);
  }
  g.computeVertexNormals();
  return vcol(g, (x, y, z) => { const k = 0.38 + 0.06 * Math.sin(x * 9 + y * 7 + z * 5); return [k * 1.0, k * 0.95, k * 0.88]; });
}

/**
 * The mesh of a thing the god holds or throws, by kind: an uprooted broadleaf (unit height, draw it with
 * makeLeafPropMaterial), a thatched hut (metres), a boulder (radius ~1) or a bundle of goods. The tree and the hut are
 * the generators' cached meshes (do not dispose them).
 */
export function heldPropGeometry(kind: string): BufferGeometry {
  return kind === 'tree' ? treeGeometry('broadleaf', 1, 2) : kind === 'rock' ? boulderGeo(7) : kind === 'building' ? heldHutGeo() : bundleGeo();
}

/** the hut a people builds (thatch, round), whole, as torn from its footing */
function heldHutGeo(): BufferGeometry {
  return buildingMesh({ kind: 'hut', mat: materialAt(materialIndex('thatch')), style: 0, era: 1, mood: 0, w: 4.5, d: 4.5, lod: 1 }).geo;
}

/** a prop material for treegen meshes: bark and leaf cards from vertex colours, the sprays alpha-tested in the atlas */
export function makeLeafPropMaterial(shared: Record<string, IUniform>): MeshStandardMaterial {
  const tex = leafClusterTexture();
  const mat = makePropMaterial(shared, {
    key: 'held-tree', roughness: 0.85,
    extraUniforms: { tLeaf: { value: tex } },
    vertexPars: 'attribute vec2 aLeafUv;\nattribute float aCard;\nvarying vec2 vLeafUv;\nvarying float vCard;',
    vertexBegin: '  vLeafUv = aLeafUv; vCard = aCard;\n  vec3 transformed = position;',
    fragmentPars: 'uniform sampler2D tLeaf;\nvarying vec2 vLeafUv;\nvarying float vCard;',
    alphaTest: '  if (vCard > 0.75) { float la = texture(tLeaf, vLeafUv).a; if ((la - 0.45) / max(fwidth(la), 1e-4) + 0.5 < 0.5) discard; }',
    surface: '  if (vCard > 0.5) diffuseColor.rgb *= texture(tLeaf, vLeafUv).rgb * 1.7;',
  });
  mat.side = DoubleSide;
  (mat.userData.propDepth as ShaderMaterial).side = DoubleSide;
  return mat;
}

function bundleGeo(): BufferGeometry {
  const b = icosphere(1); b.scale(1, 0.75, 0.9);
  return vcol(b, (x, y) => (y > 0.6 ? [0.3, 0.2, 0.12] : [0.48, 0.38, 0.24]));
}

function icosphere(sub: number): BufferGeometry {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(key);
      if (i === undefined) { const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]; const l = Math.hypot(p[0], p[1], p[2]); v.push([p[0] / l, p[1] / l, p[2] / l]); i = v.length - 1; mid.set(key, i); }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v.flat()), 3));
  g.setIndex(f.flat());
  g.computeVertexNormals();
  return g;
}
