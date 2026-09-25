// BLOCKTOOTH v2 — map-objective view (FEATURES_V2 §5.4, lane L6). VIEW: reads `w.map.objectives`, the
// bound building / prop and the objective* events; never writes gameplay state.
//
// Every live objective gets (shared batches, all instanced):
//   * a vertical LIGHT COLUMN (kind colour: OVERLOAD gold #ffd166 · RELIEF teal #4fb3b0 · ANNEX coral
//     #ff6f5e), height 4 H at placement (H latched the first frame the view sees it), width 0.12 H (never
//     thinner than ~2.5 px), additive with travelling dash bands so it is not colour-only; no bloom;
//   * a pulsing DASHED GROUND RING around the footprint (RingBatch);
//   * an ICON BILLBOARD at the column top, screen-constant (34 px at 720p, 51 px at 1080p = 4.72 % of the
//     view height), always on top — glyphs baked once per mount into a small canvas atlas.
// Dressing per kind (≤ 4 draw calls per kind):
//   * OVERLOAD SITE — a municipal utility unit (transformer box + cooling fins + insulators + hazard
//     placard + cable spool): beside the tagged prop at Size I, on the roof of the tagged building at
//     Size II+, with crackling arcs (RibbonBatch) over it / sparks on the prop;
//   * RELIEF DEPOT — a real stack of 3 supply crates with straps and the teal bandage emblem on a cream
//     disc (never a red cross, FEATURES_V2 §0.7);
//   * RECORDS ANNEX — a rooftop filing cabinet with a coral wax seal on the tagged building.
// objectiveDone → a gold stamp (LOAD SHED / CRATES OPEN / FILES SEIZED) pops over the site.
// Draw calls: column 1 + ring 1 + icons 1 + unit 2 + crates 2 + cabinet 2 + arcs 1 = 10 max.
//
// `OBJ_ANCHOR` (id → column-top height, m) is shared with MarkerView so the DOM label sits under the icon.

import * as THREE from 'three';
import type { Objective, ObjectiveKind, SimEvent, World } from '../core/types.ts';
import { addOutline, facet, INK, makeToon, OUTLINE_PX } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import { K_VIEW, RibbonBatch, RingBatch, clamp01, easeOutCubic, hash01, mergePainted, part } from './ultview.ts';

/** objective id → marker anchor height (m): the top of its light column (read by MarkerView) */
export const OBJ_ANCHOR = new Map<number, number>();

export const OBJ_COLOR: Record<ObjectiveKind, string> = { overloadSite: '#ffd166', reliefDepot: '#4fb3b0', recordsAnnex: '#ff6f5e' };
const STAMP_TEXT: Record<ObjectiveKind, string> = { overloadSite: 'LOAD SHED', reliefDepot: 'CRATES OPEN', recordsAnnex: 'FILES SEIZED' };
/** icon size: 34 px at a 720 px tall view (§5.4) = this fraction of the view height at any resolution */
const ICON_FRAC = 34 / 720;
const SLOTS = 8;
const STAMPS = 6;
const CREAM = '#f4ecd8';

// ─────────────────────────────── glyph atlas (canvas, baked once per mount) ───────────────────────────────

/** atlas cells: 4 icons on the top row (128 px), 3 stamps below (256 × 128) */
const ATLAS_W = 512, ATLAS_H = 384;
export type IconCell = 'overload' | 'relief' | 'annex' | 'till';
const ICON_UV: Record<IconCell, [number, number, number, number]> = {
  overload: [0, 0, 128, 128], relief: [128, 0, 256, 128], annex: [256, 0, 384, 128], till: [384, 0, 512, 128],
};
const STAMP_UV: Record<ObjectiveKind, [number, number, number, number]> = {
  overloadSite: [0, 128, 256, 256], reliefDepot: [256, 128, 512, 256], recordsAnnex: [0, 256, 256, 384],
};

function rr(x: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(cx - w / 2 + r, cy - h / 2);
  x.arcTo(cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, r);
  x.arcTo(cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2, r);
  x.arcTo(cx - w / 2, cy + h / 2, cx - w / 2, cy - h / 2, r);
  x.arcTo(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, r);
  x.closePath();
}

/** One BLOCKTOOTH glyph (ink-edged, flat fills) centred at (cx, cy) in a `s` px box. Exported so the
 *  power-up token faces use the same drawing hand. */
export function drawGlyph(x: CanvasRenderingContext2D, id: string, cx: number, cy: number, s: number, fill: string): void {
  const k = s / 24;              // 24 × 24 design box, like ui/icons.ts
  const P = (px: number, py: number): [number, number] => [cx + (px - 12) * k, cy + (py - 12) * k];
  x.lineJoin = 'round'; x.lineCap = 'round';
  x.strokeStyle = INK; x.lineWidth = Math.max(2, 1.6 * k);
  const poly = (pts: number[], col: string) => {
    x.beginPath();
    for (let i = 0; i < pts.length; i += 2) { const [a, b] = P(pts[i], pts[i + 1]); if (i === 0) x.moveTo(a, b); else x.lineTo(a, b); }
    x.closePath(); x.fillStyle = col; x.fill(); x.stroke();
  };
  const disc = (px: number, py: number, r: number, col: string) => {
    const [a, b] = P(px, py); x.beginPath(); x.arc(a, b, r * k, 0, Math.PI * 2); x.fillStyle = col; x.fill(); x.stroke();
  };
  const box = (px: number, py: number, w: number, h: number, col: string, r = 1.2) => {
    const [a, b] = P(px, py); rr(x, a, b, w * k, h * k, r * k); x.fillStyle = col; x.fill(); x.stroke();
  };
  switch (id) {
    case 'overload':   // a bolt in a square
      box(12, 12, 18, 18, fill, 2.5);
      poly([13.5, 4.5, 7.5, 13, 11.5, 13, 9.5, 19.5, 16.5, 10.5, 12.5, 10.5, 14.5, 4.5], INK === fill ? CREAM : '#1b1426');
      break;
    case 'relief':     // teal bandage "+" on a cream disc (never a red cross)
      disc(12, 12, 9.5, CREAM);
      box(12, 12, 13, 5, fill, 2.4);
      box(12, 12, 5, 13, fill, 2.4);
      disc(12, 12, 1.1, CREAM);
      break;
    case 'annex': {    // a folder with a wax seal
      poly([3.5, 7, 9.5, 7, 11, 9, 20.5, 9, 20.5, 19, 3.5, 19], fill);
      poly([3.5, 11, 20.5, 11, 20.5, 19, 3.5, 19], CREAM);
      disc(15.5, 15, 3, '#ff6f5e');
      break;
    }
    case 'till': {     // pay-station box, coin slot, half-open drawer (the PARKADE-6 TILL)
      box(12, 9.5, 14, 11, fill, 1.5);
      box(12, 7, 5, 1.4, INK, 0.5);
      box(12, 17, 17, 5, CREAM, 1);
      box(12, 17.2, 4, 1.4, INK, 0.5);
      break;
    }
    case 'magnet': {   // CLEANUP CREW: a horseshoe magnet
      x.beginPath(); const [a, b] = P(12, 12); x.arc(a, b, 7.5 * k, Math.PI, 0); x.lineWidth = 6.5 * k; x.strokeStyle = INK; x.stroke();
      x.lineWidth = 3.6 * k; x.strokeStyle = fill; x.stroke();
      x.lineWidth = Math.max(2, 1.6 * k); x.strokeStyle = INK;
      box(5.5, 15, 5, 6, CREAM, 0.8); box(18.5, 15, 5, 6, CREAM, 0.8);
      break;
    }
    case 'notice': {   // DEMOLITION NOTICE: a paper with a stamp
      poly([6, 3.5, 15, 3.5, 19, 7.5, 19, 20.5, 6, 20.5], CREAM);
      for (const yy of [9, 12, 15]) box(11, yy, 7, 1.2, INK, 0.3);
      disc(15.5, 16.5, 3.4, fill);
      break;
    }
    case 'trafficLight': {   // RED LIGHT: a signal head with red, amber and green lamps
      box(12, 12, 9, 20, '#2b2733', 2);
      disc(12, 6.5, 2.6, '#e63946'); disc(12, 12, 2.6, '#ffb13b'); disc(12, 17.5, 2.6, '#4fd48a');
      break;
    }
    case 'rush': {     // RUSH HOUR: a clock with speed lines
      disc(14, 12, 7.5, CREAM);
      x.beginPath(); { const [a, b] = P(14, 12); const [c2, d] = P(14, 7); const [e, f] = P(17.5, 12); x.moveTo(c2, d); x.lineTo(a, b); x.lineTo(e, f); } x.stroke();
      for (const yy of [8, 12, 16]) { x.beginPath(); const [a, b] = P(2.5, yy); const [c2, d] = P(5.5, yy); x.moveTo(a, b); x.lineTo(c2, d); x.stroke(); }
      x.strokeStyle = fill; x.lineWidth = 2 * k;
      x.beginPath(); { const [a, b] = P(14, 12); x.arc(a, b, 7.5 * k, -Math.PI * 0.5, Math.PI * 0.3); } x.stroke();
      x.strokeStyle = INK; x.lineWidth = Math.max(2, 1.6 * k);
      break;
    }
    case 'coin': {     // BACK PAY: stacked coins
      for (let i = 0; i < 3; i++) { const yy = 17 - i * 4; x.beginPath(); const [a, b] = P(12, yy); x.ellipse(a, b, 8 * k, 3 * k, 0, 0, Math.PI * 2); x.fillStyle = i === 2 ? fill : '#e0a93a'; x.fill(); x.stroke(); }
      disc(17.5, 6, 3, CREAM);
      break;
    }
    default: disc(12, 12, 8, fill); break;
  }
}

function stampCell(x: CanvasRenderingContext2D, text: string, cx: number, cy: number, w: number, h: number): void {
  x.save();
  x.translate(cx, cy);
  x.rotate(-0.08);
  x.font = `900 ${Math.round(h * 0.34)}px "Anton", "Impact", "Arial Black", sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const tw = Math.min(w * 0.9, x.measureText(text).width + h * 0.3);
  // ink drop, gold frame, cream paper
  x.fillStyle = INK; rr(x, 4, 5, tw + 14, h * 0.62, 8); x.fill();
  x.fillStyle = '#ffd166'; rr(x, 0, 0, tw + 14, h * 0.62, 8); x.fill();
  x.lineWidth = 5; x.strokeStyle = INK; x.stroke();
  x.fillStyle = CREAM; rr(x, 0, 0, tw, h * 0.44, 5); x.fill();
  x.fillStyle = INK; x.fillText(text, 0, 2, tw - 8);
  x.restore();
}

function buildAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = ATLAS_W; c.height = ATLAS_H;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, ATLAS_W, ATLAS_H);
  const badge = (u: [number, number, number, number], col: string, glyph: string) => {
    const cx = (u[0] + u[2]) / 2, cy = (u[1] + u[3]) / 2;
    // a pin badge: ink ring, kind-colour rim, cream face, glyph
    x.beginPath(); x.arc(cx, cy, 58, 0, Math.PI * 2); x.fillStyle = INK; x.fill();
    x.beginPath(); x.arc(cx, cy, 53, 0, Math.PI * 2); x.fillStyle = col; x.fill();
    x.beginPath(); x.arc(cx, cy, 43, 0, Math.PI * 2); x.fillStyle = CREAM; x.fill();
    x.lineWidth = 3; x.strokeStyle = INK; x.stroke();
    drawGlyph(x, glyph, cx, cy, 70, col);
  };
  badge(ICON_UV.overload, OBJ_COLOR.overloadSite, 'overload');
  badge(ICON_UV.relief, OBJ_COLOR.reliefDepot, 'relief');
  badge(ICON_UV.annex, OBJ_COLOR.recordsAnnex, 'annex');
  badge(ICON_UV.till, '#ffd166', 'till');
  for (const k of ['overloadSite', 'reliefDepot', 'recordsAnnex'] as const) {
    const u = STAMP_UV[k];
    stampCell(x, STAMP_TEXT[k], (u[0] + u[2]) / 2, (u[1] + u[3]) / 2, u[2] - u[0], u[3] - u[1]);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ─────────────────────────────── shaders ───────────────────────────────

const ICON_VERT = /* glsl */ `
attribute vec4 aUv4;     // u0, v0, u1, v1 (atlas, 0..1, v down)
attribute vec4 aIc;      // alpha, height (fraction of the view height), aspect (w/h), y offset (quad heights)
uniform float uAspect;
varying vec2 vUv;
varying float vA;
void main() {
  // canvas rows run top-down; the texture is flipY'd, so canvas row f sits at v = 1 - f
  vUv = vec2(mix(aUv4.x, aUv4.z, uv.x), 1.0 - mix(aUv4.w, aUv4.y, uv.y));
  vA = aIc.x;
  vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float s = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
  vec2 q = vec2(position.x * aIc.z, position.y + aIc.w) * aIc.y * 2.0 * s;
  q.x /= uAspect;
  clip.xy += q * clip.w;
  gl_Position = clip;
}`;
const ICON_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(t.rgb, a);
  #include <colorspace_fragment>
}`;

const BEAM_VERT = /* glsl */ `
varying float vY;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  vY = position.y;
  vUv = uv;
  vCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
varying float vY;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  float fade = (1.0 - vY) * (0.55 + 0.45 * (1.0 - vY));
  float dash = 0.72 + 0.28 * step(0.5, fract(vY * 7.0 - uTime * 0.9));
  float edge = 1.0 - 0.6 * abs(fract(vUv.x * 2.0) - 0.5) * 2.0;
  float a = fade * dash * edge * 0.62;
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <colorspace_fragment>
}`;

// ─────────────────────────────── dressing geometry (unit size, base at y = 0) ───────────────────────────────

const _M = (tx: number, ty: number, tz: number, ry = 0, rx = 0, rz = 0): THREE.Matrix4 =>
  new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(tx, ty, tz);

/** OVERLOAD SITE utility unit (≈ 1.4 wide × 1 tall): transformer, fins, insulators, placard, cable spool */
function unitGeometry(): THREE.BufferGeometry {
  const g: THREE.BufferGeometry[] = [];
  g.push(part(new THREE.BoxGeometry(0.8, 0.7, 0.55), '#7d9486', _M(0, 0.35 + 0.08, 0)));
  g.push(part(new THREE.BoxGeometry(0.9, 0.08, 0.65), '#4c5a52', _M(0, 0.04, 0)));        // plinth
  for (let i = 0; i < 4; i++) g.push(part(new THREE.BoxGeometry(0.05, 0.55, 0.62), '#5f7468', _M(-0.3 + i * 0.2, 0.42, 0)));   // fins
  for (let i = 0; i < 3; i++) {
    g.push(part(new THREE.CylinderGeometry(0.05, 0.07, 0.24, 6), '#f4ecd8', _M(-0.25 + i * 0.25, 0.9, 0)));
    g.push(part(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 6), '#c9a47a', _M(-0.25 + i * 0.25, 0.86, 0)));
  }
  // hazard placard: gold square + ink bolt bar
  g.push(part(new THREE.BoxGeometry(0.34, 0.34, 0.03), '#ffd166', _M(0, 0.45, 0.29)));
  g.push(part(new THREE.BoxGeometry(0.07, 0.24, 0.035), '#1b1426', _M(0.01, 0.45, 0.3, 0, 0, 0.45)));
  // cable spool on its side
  g.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), '#b07a45', _M(0.72, 0.3, 0.05, 0, 0, Math.PI / 2)));
  g.push(part(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), '#b07a45', _M(1.02, 0.3, 0.05, 0, 0, Math.PI / 2)));
  g.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10), '#2b2733', _M(0.87, 0.3, 0.05, 0, 0, Math.PI / 2)));
  return facet(mergePainted(g));
}

/** RELIEF DEPOT: 3 supply crates, straps, the teal bandage emblem on a cream disc (≈ 1 tall) */
function crateGeometry(): THREE.BufferGeometry {
  const g: THREE.BufferGeometry[] = [];
  const crate = (x: number, y: number, z: number, ry: number) => {
    const m = _M(x, y, z, ry);
    const mm = (tx: number, ty: number, tz: number, rz = 0) => m.clone().multiply(_M(tx, ty, tz, 0, 0, rz));
    g.push(part(new THREE.BoxGeometry(0.62, 0.46, 0.5), '#c9a47a', m));
    g.push(part(new THREE.BoxGeometry(0.64, 0.06, 0.52), '#8a6a45', mm(0, 0.2, 0)));     // lid rim
    g.push(part(new THREE.BoxGeometry(0.07, 0.48, 0.52), '#3f5f5a', mm(-0.18, 0, 0)));   // straps
    g.push(part(new THREE.BoxGeometry(0.07, 0.48, 0.52), '#3f5f5a', mm(0.18, 0, 0)));
    // emblem: cream disc + teal bandage plus, on the front face (+Z)
    const em = m.clone().multiply(_M(0, 0, 0.255, 0, Math.PI / 2, 0));
    g.push(part(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 14), '#f4ecd8', em));
    g.push(part(new THREE.BoxGeometry(0.2, 0.066, 0.025), '#4fb3b0', m.clone().multiply(_M(0, 0, 0.27))));
    g.push(part(new THREE.BoxGeometry(0.066, 0.2, 0.025), '#4fb3b0', m.clone().multiply(_M(0, 0, 0.27))));
  };
  crate(-0.34, 0.23, 0, 0.05);
  crate(0.34, 0.23, 0.04, -0.08);
  crate(0.02, 0.69, 0.02, 0.35);
  return facet(mergePainted(g));
}

/** RECORDS ANNEX: a filing cabinet (3 drawers, pulls) with a coral wax seal (≈ 1 tall) */
function cabinetGeometry(): THREE.BufferGeometry {
  const g: THREE.BufferGeometry[] = [];
  g.push(part(new THREE.BoxGeometry(0.56, 1.0, 0.6), '#8c9bb0', _M(0, 0.5, 0)));
  for (let i = 0; i < 3; i++) {
    const y = 0.2 + i * 0.3;
    g.push(part(new THREE.BoxGeometry(0.5, 0.25, 0.03), '#a9b6c8', _M(0, y, 0.31)));
    g.push(part(new THREE.BoxGeometry(0.18, 0.04, 0.05), '#2b2733', _M(0, y + 0.03, 0.335)));
    g.push(part(new THREE.BoxGeometry(0.12, 0.06, 0.02), '#f4ecd8', _M(0, y - 0.06, 0.325)));   // label card
  }
  // the seal: a coral wax blob + ribbon across the top drawer seam
  g.push(part(new THREE.BoxGeometry(0.6, 0.04, 0.64), '#ff6f5e', _M(0, 0.62, 0)));
  g.push(part(new THREE.CylinderGeometry(0.1, 0.11, 0.05, 10), '#e0503f', _M(0, 0.62, 0.33, 0, Math.PI / 2, 0)));
  return facet(mergePainted(g));
}

// ─────────────────────────────── the view ───────────────────────────────

interface Slot { id: number; kind: ObjectiveKind; x: number; z: number; H0: number; top: number; t: number; fade: number; used: boolean; seen: boolean }
interface Stamp { kind: ObjectiveKind; x: number; y: number; z: number; t: number; on: boolean }

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class ObjectiveView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private rings: RingBatch | null = null;
  private arcs: RibbonBatch | null = null;
  private column: THREE.InstancedMesh | null = null;
  private icons: THREE.InstancedMesh | null = null;
  private unit: THREE.InstancedMesh | null = null;
  private crates: THREE.InstancedMesh | null = null;
  private cabinet: THREE.InstancedMesh | null = null;
  private iconUv: THREE.InstancedBufferAttribute | null = null;
  private iconIc: THREE.InstancedBufferAttribute | null = null;
  private beamMat: THREE.ShaderMaterial | null = null;
  private iconMat: THREE.ShaderMaterial | null = null;
  private disposables: { dispose(): void }[] = [];
  private readonly slots: Slot[] = [];
  private readonly stamps: Stamp[] = [];
  private readonly arcPts = new Float32Array(3 * 5 * 3);
  private arcSeed = 0;
  private arcT = 0;
  private readonly col = new THREE.Color();
  /** kind colours parsed once (Color.set(string) runs a regex: never per frame) */
  private readonly kindCol: Record<ObjectiveKind, THREE.Color> = {
    overloadSite: new THREE.Color(OBJ_COLOR.overloadSite), reliefDepot: new THREE.Color(OBJ_COLOR.reliefDepot),
    recordsAnnex: new THREE.Color(OBJ_COLOR.recordsAnnex),
  };

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'objectives';
    for (let i = 0; i < SLOTS; i++) this.slots.push({ id: -1, kind: 'overloadSite', x: 0, z: 0, H0: 1, top: 4, t: 0, fade: -1, used: false, seen: false });
    for (let i = 0; i < STAMPS; i++) this.stamps.push({ kind: 'overloadSite', x: 0, y: 0, z: 0, t: 0, on: false });
  }

  mount(w: World): void {
    this.unmountParts();
    this.rings = new RingBatch(SLOTS * 2, 'obj:rings', 2);
    this.arcs = new RibbonBatch(64, 'obj:arcs');
    this.root.add(this.rings.mesh, this.arcs.mesh);

    // light columns: open cylinder, base at y = 0, height 1
    const cg = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true);
    cg.translate(0, 0.5, 0);
    this.beamMat = new THREE.ShaderMaterial({
      name: 'objBeam', vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.column = this.inst(cg, this.beamMat, SLOTS, 'obj:column', 0);
    this.column.setColorAt(0, this.col.set('#ffffff'));
    this.column.renderOrder = 3;

    // icon billboards (+ the done stamps): screen-constant, always on top
    const tex = buildAtlas();
    const ig = new THREE.PlaneGeometry(1, 1);
    this.iconUv = new THREE.InstancedBufferAttribute(new Float32Array((SLOTS + STAMPS) * 4), 4);
    this.iconIc = new THREE.InstancedBufferAttribute(new Float32Array((SLOTS + STAMPS) * 4), 4);
    this.iconUv.setUsage(THREE.DynamicDrawUsage); this.iconIc.setUsage(THREE.DynamicDrawUsage);
    ig.setAttribute('aUv4', this.iconUv);
    ig.setAttribute('aIc', this.iconIc);
    this.iconMat = new THREE.ShaderMaterial({
      name: 'objIcon', vertexShader: ICON_VERT, fragmentShader: ICON_FRAG,
      uniforms: { uMap: { value: tex }, uAspect: { value: 16 / 9 } },
      transparent: true, depthWrite: false, depthTest: false,
    });
    this.disposables.push(tex);
    this.icons = this.inst(ig, this.iconMat, SLOTS + STAMPS, 'obj:icons', 0);
    this.icons.renderOrder = 20;

    const toon = () => makeToon({ vertexColors: true });
    this.unit = this.inst(unitGeometry(), toon(), 4, 'obj:unit', OUTLINE_PX.prop);
    this.crates = this.inst(crateGeometry(), toon(), 4, 'obj:crates', OUTLINE_PX.prop);
    this.cabinet = this.inst(cabinetGeometry(), toon(), 6, 'obj:cabinet', OUTLINE_PX.prop);
    for (const im of [this.unit, this.crates, this.cabinet]) { im.castShadow = true; im.receiveShadow = true; }

    for (const s of this.slots) { s.used = false; s.id = -1; s.fade = -1; }
    for (const s of this.stamps) s.on = false;
    OBJ_ANCHOR.clear();
    this.ctx.scene.add(this.root);
    void w;
  }

  update(w: World, f: FrameInfo): void {
    if (!this.rings || !this.arcs || !this.column || !this.icons || !this.unit || !this.crates || !this.cabinet) return;
    const dt = f.frozen ? 0 : Math.min(0.1, f.dt);
    const ev = f.events;
    for (let i = 0; i < ev.length; i++) this.onEvent(w, ev[i]);
    const map = w.map;
    const H = Math.max(0.2, w.titan.height);
    const time = f.time;
    const calm = this.ctx.quality.reduceFlashing;
    const mpp = (Math.max(1, f.camDist) * K_VIEW) / 720;

    // ── bind live objectives to slots ──
    for (const s of this.slots) s.seen = false;
    const objs = map ? map.objectives : null;
    if (objs) {
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (!o.alive) continue;
        let s = this.findSlot(o.id);
        if (!s) s = this.alloc(o, H);
        if (!s) continue;
        s.seen = true;
        s.fade = -1;
        s.x = o.x; s.z = o.z;
        s.t += dt;
        s.top = this.columnTop(w, o, s.H0);
        OBJ_ANCHOR.set(o.id, s.top);
      }
    }
    for (const s of this.slots) {
      if (!s.used || s.seen) continue;
      if (s.fade < 0) s.fade = 0;
      s.fade += dt;
      if (s.fade > 0.35) { s.used = false; OBJ_ANCHOR.delete(s.id); s.id = -1; }
    }

    // ── draw ──
    this.rings.begin();
    this.arcs.begin(this.ctx.camera);
    const uv = this.iconUv!.array as Float32Array, ic = this.iconIc!.array as Float32Array;
    let nCol = 0, nIcon = 0, nUnit = 0, nCrate = 0, nCab = 0;
    this.arcT += dt;
    const rejit = this.arcT > 0.07;
    if (rejit) { this.arcT = 0; this.arcSeed++; }
    for (const s of this.slots) {
      if (!s.used) continue;
      const o = objs ? this.findObjective(objs, s.id) : null;
      const k = s.fade < 0 ? easeOutCubic(s.t / 0.3) : clamp01(1 - s.fade / 0.35);
      const H0 = s.H0;
      const kc = this.kindCol[s.kind];
      // column
      const cw = Math.max(0.12 * H0, 2.5 * mpp) * k;
      _p.set(s.x, 0, s.z); _q.identity(); _s.set(cw, s.top * (0.4 + 0.6 * k), cw);
      _m4.compose(_p, _q, _s);
      this.column.setMatrixAt(nCol, _m4);
      this.column.setColorAt(nCol, this.col.copy(kc).multiplyScalar(calm ? 0.7 : 1));
      nCol++;
      // ground ring: dashed, pulsing
      const baseR = this.ringRadius(w, o, s, H0);
      const pulse = calm ? 1 : 1 + 0.06 * Math.sin(time * 4 + s.id);
      this.rings.add(s.x, 0.05, s.z, baseR * pulse, 0.7, 0.9 * k, kc, 20, 0.14);
      // icon at the column top
      this.icon(nIcon++, uv, ic, s.x, s.top, s.z, s.kind === 'overloadSite' ? 'overload' : s.kind === 'reliefDepot' ? 'relief' : 'annex', k);
      // dressing
      if (o && s.fade < 0) {
        if (s.kind === 'overloadSite') {
          if (nUnit < 4) this.placeUnit(w, o, H0, nUnit++);
          this.overloadArcs(w, o, H0, mpp, rejit, calm);
        } else if (s.kind === 'reliefDepot') {
          if (nCrate < 4) {
            const size = Math.max(0.3, o.h);
            _e.set(0, hash01(o.id, 3) * 6.283, 0); _q.setFromEuler(_e);
            _p.set(o.x, 0, o.z); _s.set(size, size, size);
            _m4.compose(_p, _q, _s);
            this.crates.setMatrixAt(nCrate++, _m4);
          }
        } else if (s.kind === 'recordsAnnex') {
          const b = o.target === 'building' ? w.city.buildings[o.targetId] : undefined;
          if (b && !b.collapsed && nCab < 6) {
            const size = Math.max(0.8, Math.min(b.w, b.d) * 0.3);
            _e.set(0, hash01(o.id, 5) * 6.283, 0); _q.setFromEuler(_e);
            _p.set(b.x, b.alive * b.floorH, b.z); _s.set(size, size, size);
            _m4.compose(_p, _q, _s);
            this.cabinet.setMatrixAt(nCab++, _m4);
          }
        }
      }
    }
    // done stamps (gold, pop in, hold, fade)
    for (const st of this.stamps) {
      if (!st.on) continue;
      st.t += dt;
      if (st.t > 1.7) { st.on = false; continue; }
      if (nIcon >= SLOTS + STAMPS) break;
      const pop = st.t < 0.14 ? 1.7 - 0.7 * easeOutCubic(st.t / 0.14) : 1;
      const a = st.t < 1.4 ? 1 : 1 - (st.t - 1.4) / 0.3;
      const u = STAMP_UV[st.kind];
      const i = nIcon++;
      uv[i * 4] = u[0] / ATLAS_W; uv[i * 4 + 1] = u[1] / ATLAS_H; uv[i * 4 + 2] = u[2] / ATLAS_W; uv[i * 4 + 3] = u[3] / ATLAS_H;
      ic[i * 4] = a; ic[i * 4 + 1] = ICON_FRAC * 1.3 * pop; ic[i * 4 + 2] = 2; ic[i * 4 + 3] = 0.1;
      _m4.makeTranslation(st.x, st.y, st.z);
      this.icons.setMatrixAt(i, _m4);
    }
    this.finish(this.column, nCol, true);
    this.finish(this.icons, nIcon, false);
    this.finish(this.unit, nUnit, false);
    this.finish(this.crates, nCrate, false);
    this.finish(this.cabinet, nCab, false);
    if (nIcon > 0) { this.iconUv!.needsUpdate = true; this.iconIc!.needsUpdate = true; }
    this.rings.end();
    this.arcs.end();
    if (this.beamMat) this.beamMat.uniforms.uTime.value = calm ? 0 : time;
    if (this.iconMat) this.iconMat.uniforms.uAspect.value = Math.max(0.2, this.ctx.camera.aspect);
  }

  unmount(): void {
    this.unmountParts();
    this.root.removeFromParent();
    OBJ_ANCHOR.clear();
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, outline: number): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.name = name;
    im.count = 0;
    im.visible = false;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = false; im.receiveShadow = false;
    if (outline > 0) addOutline(im, outline);
    this.root.add(im);
    this.disposables.push(geo, mat);
    return im;
  }

  private finish(im: THREE.InstancedMesh, n: number, colors: boolean): void {
    im.count = n;
    im.visible = n > 0;
    if (n > 0) { im.instanceMatrix.needsUpdate = true; if (colors && im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  private unmountParts(): void {
    this.rings?.dispose(); this.arcs?.dispose();
    this.rings = null; this.arcs = null;
    for (const im of [this.column, this.icons, this.unit, this.crates, this.cabinet]) if (im) { im.removeFromParent(); im.dispose(); }
    this.column = this.icons = this.unit = this.crates = this.cabinet = null;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.iconUv = this.iconIc = null;
    this.beamMat = this.iconMat = null;
    this.root.clear();
  }

  private findSlot(id: number): Slot | null {
    for (const s of this.slots) if (s.used && s.id === id) return s;
    return null;
  }

  private alloc(o: Objective, H: number): Slot | null {
    let s: Slot | null = null;
    for (const x of this.slots) if (!x.used) { s = x; break; }
    if (!s) return null;
    s.used = true; s.id = o.id; s.kind = o.kind; s.x = o.x; s.z = o.z; s.H0 = H; s.t = 0; s.fade = -1;
    return s;
  }

  private findObjective(objs: readonly Objective[], id: number): Objective | null {
    for (let i = 0; i < objs.length; i++) if (objs[i].id === id && objs[i].alive) return objs[i];
    return null;
  }

  /** column top (m): 4 H at placement, and always clear of the bound building's roof */
  private columnTop(w: World, o: Objective, H0: number): number {
    let roof = 0;
    if (o.target === 'building') { const b = w.city.buildings[o.targetId]; if (b) roof = b.alive * b.floorH; }
    else roof = Math.max(0, o.h);
    return Math.max(4 * H0, roof + 1.6 * H0);
  }

  private ringRadius(w: World, o: Objective | null, s: Slot, H0: number): number {
    if (!o) return Math.max(0.6 * H0, 1);
    if (o.target === 'building') {
      const b = w.city.buildings[o.targetId];
      return b ? 0.55 * Math.hypot(b.w, b.d) + 0.25 * H0 : Math.max(o.r, H0);
    }
    if (s.kind === 'reliefDepot') return Math.max(o.r * 1.7, 0.5 * H0);
    return Math.max(o.r * 1.6, 0.6 * H0);
  }

  /** the utility unit: beside the prop (Size I) or on the tagged building's roof (Size II+) */
  private placeUnit(w: World, o: Objective, H0: number, i: number): void {
    const um = this.unit!;
    const ry = hash01(o.id, 7) * 6.283;
    if (o.target === 'building') {
      const b = w.city.buildings[o.targetId];
      if (!b) return;
      const size = Math.max(0.8, Math.min(b.w, b.d) * 0.32);
      _p.set(b.x, b.alive * b.floorH, b.z);
      _s.set(size, size, size);
    } else {
      const size = Math.max(0.5, 0.42 * H0);
      const off = o.r + size * 0.9;
      _p.set(o.x + Math.sin(ry) * off, 0, o.z + Math.cos(ry) * off);
      _s.set(size, size, size);
    }
    _e.set(0, ry, 0); _q.setFromEuler(_e);
    _m4.compose(_p, _q, _s);
    um.setMatrixAt(i, _m4);
  }

  /** crackling arcs: across the roof of a building site, short sparks over a prop site */
  private overloadArcs(w: World, o: Objective, H0: number, mpp: number, rejit: boolean, calm: boolean): void {
    let cx = o.x, cz = o.z, y = 0, span = 1;
    if (o.target === 'building') {
      const b = w.city.buildings[o.targetId];
      if (!b) return;
      y = b.alive * b.floorH + 0.3; span = Math.min(b.w, b.d) * 0.45; cx = b.x; cz = b.z;
    } else { y = Math.max(0.4, o.h * 0.9); span = Math.max(0.6, o.r + 0.3 * H0); }
    const pts = this.arcPts;
    const n = calm ? 1 : 3;
    for (let a = 0; a < n; a++) {
      const off = a * 5 * 3;
      if (rejit || pts[off + 1] === 0) {
        const seed = this.arcSeed * 7 + a * 13 + o.id;
        const a0 = hash01(seed, 1) * 6.283, a1 = a0 + 1.5 + hash01(seed, 2) * 2;
        const x0 = cx + Math.sin(a0) * span, z0 = cz + Math.cos(a0) * span;
        const x1 = cx + Math.sin(a1) * span * 0.8, z1 = cz + Math.cos(a1) * span * 0.8;
        for (let s = 0; s < 5; s++) {
          const u = s / 4;
          const j = s === 0 || s === 4 ? 0 : (hash01(seed, 10 + s) - 0.5) * span * 0.5;
          pts[off + s * 3] = x0 + (x1 - x0) * u + j;
          pts[off + s * 3 + 1] = y + Math.sin(u * Math.PI) * span * 0.35 + Math.abs(j) * 0.3;
          pts[off + s * 3 + 2] = z0 + (z1 - z0) * u - j;
        }
      }
      const flick = calm ? 0.55 : 0.5 + 0.5 * hash01(this.arcSeed * 3 + a, o.id);
      this.arcs!.line(pts, off, 5, 4 * mpp, flick, 1.0, 0.86, 0.45);
    }
  }

  private icon(i: number, uv: Float32Array, ic: Float32Array, x: number, y: number, z: number, cell: IconCell, k: number): void {
    const u = ICON_UV[cell];
    uv[i * 4] = u[0] / ATLAS_W; uv[i * 4 + 1] = u[1] / ATLAS_H; uv[i * 4 + 2] = u[2] / ATLAS_W; uv[i * 4 + 3] = u[3] / ATLAS_H;
    ic[i * 4] = k; ic[i * 4 + 1] = ICON_FRAC * (0.6 + 0.4 * k); ic[i * 4 + 2] = 1; ic[i * 4 + 3] = 0.5;
    _m4.makeTranslation(x, y, z);
    this.icons!.setMatrixAt(i, _m4);
  }

  private onEvent(w: World, e: SimEvent): void {
    if (e.type !== 'objectiveDone') return;
    let st: Stamp | null = null;
    for (const s of this.stamps) if (!s.on) { st = s; break; }
    if (!st) st = this.stamps[0];
    const top = OBJ_ANCHOR.get(e.id) ?? 4 * Math.max(0.2, w.titan.height);
    st.kind = e.kind; st.x = e.x; st.z = e.z; st.y = top; st.t = 0; st.on = true;
  }
}
