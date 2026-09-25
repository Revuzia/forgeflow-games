// BLOCKTOOTH v2 — map power-up tokens + their live looks (FEATURES_V2 §6.3, lane L6). VIEW: reads
// `w.map.powerups`, `w.map.rushHourT` and the powerup* events; never writes gameplay state.
//
// A floating CIVIC TOKEN, 0.5 H across (H = the titan's height at spawn, `PowerUp.h`): two enamel face
// cards around a small ink core, each kind its own colour AND silhouette with its glyph on BOTH faces
// (CLEANUP teal rounded square + magnet · DEMOLITION orange warning triangle + notice · RED LIGHT red
// octagon + signal head · RUSH HOUR gold diamond + clock · BACK PAY green coin + coin stack), bobbing
// and wobbling ±0.45 rad about facing the camera (yaw and pitch: never edge-on, never a flat sliver) over a dashed ground ring in the kind
// colour; it blinks through its last 5 s. F4: rev 1's cream hex plates all read as cream chips at Size I. On pickup: a token pop (swell then gone) + radial streaks.
// RUSH HOUR: speed lines streaming past the titan while it lasts. (The RED LIGHT screen tint and the
// HUD burst / tracker row are L8's DOM.)
// Draw calls: plate 1 + ink 1 + faces 1 + ring 1 + streaks 1 = 5. Fixed pools, no per-frame allocation.

import * as THREE from 'three';
import type { PowerUpKind, SimEvent, World } from '../core/types.ts';
import { POWERUP_KINDS } from '../core/types.ts';
import { addOutline, facet, INK, makeToon, OUTLINE_PX } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import { K_VIEW, RibbonBatch, RingBatch, clamp01, easeOutCubic, hash01, part } from './ultview.ts';
import { drawGlyph } from './objectiveview.ts';

export const POWERUP_TINT: Record<PowerUpKind, string> = {
  cleanup: '#4fb3b0', demolition: '#ff8a3d', redLight: '#e63946', rushHour: '#ffd166', backPay: '#7bd389',
};
const GLYPH: Record<PowerUpKind, string> = { cleanup: 'magnet', demolition: 'notice', redLight: 'trafficLight', rushHour: 'rush', backPay: 'coin' };
/**
 * F4: each kind has its own SILHOUETTE as well as its own colour, so five Size-I tokens never read as
 * five identical cream chips: CLEANUP a rounded square · DEMOLITION a warning triangle · RED LIGHT an
 * octagon · RUSH HOUR a diamond · BACK PAY a round coin. The face is the kind colour edge to edge (no
 * cream medallion), the glyph sits on it in a contrasting fill, and the plate behind is a small ink core
 * hidden by the face from the front (the silhouette is the face's alpha cut-out).
 */
export const POWERUP_SHAPE: Record<PowerUpKind, 'square' | 'triangle' | 'octagon' | 'diamond' | 'circle'> = {
  cleanup: 'square', demolition: 'triangle', redLight: 'octagon', rushHour: 'diamond', backPay: 'circle',
};
const GLYPH_FILL: Record<PowerUpKind, string> = {
  cleanup: '#e63946', demolition: '#e63946', redLight: '#ffb13b', rushHour: '#3d2b6b', backPay: '#ffd166',
};
const CAP = 8;           // tokens drawn (sim keeps ≤ 3 alive) + pops
const POPS = 4;
const POP_S = 0.32;
const BLINK_S = 5;
const SIZE_H = 0.5;      // token width, × H at spawn (§6.3)
const MIN_PX = 44;       // readability floor (px at a 720-px-tall view)
const CELL = 128;
const WOBBLE = 0.45;     // rad either side of facing the camera (the token never turns edge-on)

/** A token's drawn width (m): 0.5 H at spawn, floored at MIN_PX on screen. Shared with the marker chip
 *  (markerview) so the chip hangs above the token's real top, not over it (F4). */
export function tokenSize(H0: number, camDist: number): number {
  return Math.max(SIZE_H * H0, MIN_PX * (Math.max(1, camDist) * K_VIEW) / 720);
}
/** the token's top above the ground, × its size (bob 1.05 + 0.18, half the card) */
export const TOKEN_TOP = 1.05 + 0.18 + 0.5;

function shapePath(x: CanvasRenderingContext2D, shape: string, cx: number, cy: number, r: number): void {
  x.beginPath();
  const reg = (n: number, a0: number, rr: number) => {
    for (let j = 0; j < n; j++) { const a = a0 + (j * Math.PI * 2) / n; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; if (j === 0) x.moveTo(px, py); else x.lineTo(px, py); }
    x.closePath();
  };
  switch (shape) {
    case 'circle': x.arc(cx, cy, r * 0.94, 0, Math.PI * 2); break;
    case 'triangle': { // apex up, centred on the cell (centroid lowered so the glyph sits in the fat part)
      const R = r * 1.12, oy = r * 0.16;
      for (let j = 0; j < 3; j++) { const a = -Math.PI / 2 + (j * Math.PI * 2) / 3; const px = cx + Math.cos(a) * R, py = cy + oy + Math.sin(a) * R; if (j === 0) x.moveTo(px, py); else x.lineTo(px, py); }
      x.closePath();
      break;
    }
    case 'octagon': reg(8, Math.PI / 8, r * 0.98); break;
    case 'diamond': reg(4, -Math.PI / 2, r * 1.0); break;
    default: { // rounded square
      const h = r * 0.8, q = r * 0.22;
      x.moveTo(cx - h + q, cy - h); x.lineTo(cx + h - q, cy - h); x.quadraticCurveTo(cx + h, cy - h, cx + h, cy - h + q);
      x.lineTo(cx + h, cy + h - q); x.quadraticCurveTo(cx + h, cy + h, cx + h - q, cy + h);
      x.lineTo(cx - h + q, cy + h); x.quadraticCurveTo(cx - h, cy + h, cx - h, cy + h - q);
      x.lineTo(cx - h, cy - h + q); x.quadraticCurveTo(cx - h, cy - h, cx - h + q, cy - h);
      x.closePath();
    }
  }
}

function faceAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = CELL * POWERUP_KINDS.length; c.height = CELL;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, c.width, c.height);
  x.lineJoin = 'round';
  POWERUP_KINDS.forEach((k, i) => {
    const cx = i * CELL + CELL / 2, cy = CELL / 2;
    const sh = POWERUP_SHAPE[k];
    // ink border (the silhouette's outline), the kind colour edge to edge, a cream keyline inside
    shapePath(x, sh, cx, cy, 58); x.fillStyle = INK; x.fill(); x.lineWidth = 6; x.strokeStyle = INK; x.stroke();
    shapePath(x, sh, cx, cy, 52); x.fillStyle = POWERUP_TINT[k]; x.fill();
    shapePath(x, sh, cx, cy, 44); x.lineWidth = 4; x.strokeStyle = '#f4ecd8'; x.stroke();
    const gy = sh === 'triangle' ? cy + 14 : cy;
    drawGlyph(x, GLYPH[k], cx, gy, sh === 'triangle' ? 44 : 60, GLYPH_FILL[k]);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const FACE_VERT = /* glsl */ `
attribute float aCell;
uniform float uCells;
varying vec2 vUv;
void main() {
  vUv = vec2((uv.x + aCell) / uCells, uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const FACE_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(t.rgb, 1.0);
  #include <colorspace_fragment>
}`;

interface Pop { kind: PowerUpKind; x: number; y: number; z: number; s: number; t: number; on: boolean }

const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _qw = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);

export class PowerupView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private plate: THREE.InstancedMesh | null = null;
  private faces: THREE.InstancedMesh | null = null;
  private faceCell: THREE.InstancedBufferAttribute | null = null;
  private rings: RingBatch | null = null;
  private streaks: RibbonBatch | null = null;
  private disposables: { dispose(): void }[] = [];
  private readonly pops: Pop[] = [];
  private readonly pts = new Float32Array(2 * 3);
  /** ring / streak colour per kind, parsed once */
  private readonly tint: Record<PowerUpKind, THREE.Color> = {
    cleanup: new THREE.Color(POWERUP_TINT.cleanup), demolition: new THREE.Color(POWERUP_TINT.demolition),
    redLight: new THREE.Color(POWERUP_TINT.redLight), rushHour: new THREE.Color(POWERUP_TINT.rushHour),
    backPay: new THREE.Color(POWERUP_TINT.backPay),
  };
  private plateThick = 0.06;

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'powerups';
    for (let i = 0; i < POPS; i++) this.pops.push({ kind: 'cleanup', x: 0, y: 0, z: 0, s: 1, t: 0, on: false });
  }

  mount(w: World): void {
    this.unmountParts();
    // the plate: a small dark core standing upright (faces ±Z) between the two face cards. It is smaller
    // than every silhouette's inscribed circle, so from the front the kind's shape (the face cut-out) is
    // all that reads; seen at the wobble's extreme it gives the card its thickness (F4)
    const hexR = 0.5, coreR = 0.2, th = this.plateThick;
    const body = new THREE.CylinderGeometry(coreR, coreR, th, 12, 1, false);
    body.rotateX(Math.PI / 2);
    const bev = new THREE.CylinderGeometry(coreR * 1.15, coreR * 1.15, th * 0.7, 12, 1, false);
    bev.rotateX(Math.PI / 2);
    const g = facet(mergeTwo(part(body, '#3a3346'), part(bev, '#2b2733')));
    const mat = makeToon({ vertexColors: true });
    this.plate = this.inst(g, mat, CAP, 'powerup:plate', OUTLINE_PX.prop);
    this.plate.castShadow = true;

    // enamel faces: 2 quads per token (front + back), cell picked per instance
    const tex = faceAtlas();
    const fg = new THREE.PlaneGeometry(hexR * 2 * 0.98, hexR * 2 * 0.98);
    this.faceCell = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 2), 1);
    this.faceCell.setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute('aCell', this.faceCell);
    const fm = new THREE.ShaderMaterial({
      name: 'powerupFace', vertexShader: FACE_VERT, fragmentShader: FACE_FRAG,
      uniforms: { uMap: { value: tex }, uCells: { value: POWERUP_KINDS.length } },
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.disposables.push(tex);
    this.faces = this.inst(fg, fm, CAP * 2, 'powerup:faces', 0);

    this.rings = new RingBatch(CAP, 'powerup:rings', 2);
    this.streaks = new RibbonBatch(96, 'powerup:streaks');
    this.root.add(this.rings.mesh, this.streaks.mesh);
    for (const p of this.pops) p.on = false;
    this.ctx.scene.add(this.root);
    void w;
  }

  update(w: World, f: FrameInfo): void {
    if (!this.plate || !this.faces || !this.rings || !this.streaks || !this.faceCell) return;
    const ev = f.events;
    for (let i = 0; i < ev.length; i++) this.onEvent(w, ev[i]);
    const dt = f.frozen ? 0 : Math.min(0.1, f.dt);
    const time = f.time;
    const calm = this.ctx.quality.reduceFlashing;
    const cells = this.faceCell.array as Float32Array;
    this.rings.begin();
    this.streaks.begin(this.ctx.camera);
    let n = 0;
    const map = w.map;
    const list = map ? map.powerups : null;
    if (list) {
      for (let i = 0; i < list.length && n < CAP; i++) {
        const p = list[i];
        if (!p.alive) continue;
        const H0 = Math.max(0.3, p.h > 0 ? p.h : w.titan.height);
        // 0.5 H across (§6.3), never smaller than MIN_PX on screen (a Size I token must still read)
        const size = tokenSize(H0, f.camDist);
        const ph = hash01(p.id, 1) * 6.283;
        // blink through the last BLINK_S seconds (steady dimmer under reduce flashing)
        const left = p.life - p.t;
        if (left < BLINK_S && !calm && Math.sin(time * (left < 2 ? 22 : 12)) < -0.2) { this.ring(p.x, p.z, size, p.kind, 0.35, time, ph); continue; }
        const appear = easeOutCubic(p.t / 0.35);
        const y = size * (1.05 + 0.18 * Math.sin(time * 2.4 + ph));
        this.token(n++, cells, p.kind, p.x, y, p.z, size * (0.3 + 0.7 * appear), WOBBLE * Math.sin(time * 1.6 + ph));
        this.ring(p.x, p.z, size, p.kind, left < BLINK_S && calm ? 0.5 : 0.9, time, ph);
      }
    }
    // pickup pops: swell, then shrink away; radial streaks
    for (const pp of this.pops) {
      if (!pp.on) continue;
      pp.t += dt;
      if (pp.t > POP_S) { pp.on = false; continue; }
      const u = pp.t / POP_S;
      const k = u < 0.35 ? 1 + 0.6 * easeOutCubic(u / 0.35) : 1.6 * (1 - (u - 0.35) / 0.65);
      if (n < CAP && k > 0.02) this.token(n++, cells, pp.kind, pp.x, pp.y + pp.s * 0.4 * u, pp.z, pp.s * k, u * Math.PI * 2);
      const mpp = (Math.max(1, f.camDist) * K_VIEW) / 720;
      const c = this.tint[pp.kind];
      for (let r = 0; r < 8; r++) {
        const a = (r / 8) * Math.PI * 2 + 0.2;
        const r0 = pp.s * (0.5 + 1.6 * u), r1 = pp.s * (0.9 + 2.4 * u);
        const P = this.pts;
        P[0] = pp.x + Math.cos(a) * r0; P[1] = pp.y + Math.sin(a) * r0 * 0.9; P[2] = pp.z;
        P[3] = pp.x + Math.cos(a) * r1; P[4] = pp.y + Math.sin(a) * r1 * 0.9; P[5] = pp.z;
        this.streaks.line(P, 0, 2, 5 * mpp, (1 - u) * 0.9, c.r, c.g, c.b);
      }
    }
    // RUSH HOUR: speed lines streaming back past the titan
    if (map && map.rushHourT > 0 && w.titan.alive) this.rushLines(w, f, time, calm);
    this.plate.count = n;
    this.plate.visible = n > 0;
    this.faces.count = n * 2;
    this.faces.visible = n > 0;
    if (n > 0) {
      this.plate.instanceMatrix.needsUpdate = true;
      this.faces.instanceMatrix.needsUpdate = true;
      this.faceCell.needsUpdate = true;
    }
    this.rings.end();
    this.streaks.end();
  }

  unmount(): void {
    this.unmountParts();
    this.root.removeFromParent();
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

  private unmountParts(): void {
    for (const im of [this.plate, this.faces]) if (im) { im.removeFromParent(); im.dispose(); }
    this.plate = this.faces = null;
    this.rings?.dispose(); this.streaks?.dispose();
    this.rings = null; this.streaks = null;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.faceCell = null;
    this.root.clear();
  }

  /** `spin` = the wobble about the card's own vertical axis; the card itself faces the camera (yaw AND
   *  pitch: the iso camera looks steeply down, an upright card read as a flat sliver at Size I — F4) */
  private token(i: number, cells: Float32Array, kind: PowerUpKind, x: number, y: number, z: number, size: number, spin: number): void {
    _p.set(x, y, z);
    _m4.lookAt(this.ctx.camera.position, _p, UP);          // +Z from the token toward the camera
    _q.setFromRotationMatrix(_m4);
    _e.set(0, spin, Math.sin(spin * 0.7) * 0.12); _qw.setFromEuler(_e);
    _q.multiply(_qw);
    _s.set(size, size, size);
    _m4.compose(_p, _q, _s);
    this.plate!.setMatrixAt(i, _m4);
    // faces: just proud of each side of the plate
    const cell = POWERUP_KINDS.indexOf(kind);
    _m4b.makeTranslation(0, 0, this.plateThick * 0.5 + 0.004);
    this.faces!.setMatrixAt(i * 2, _m4b.premultiply(_m4));
    _m4b.makeTranslation(0, 0, this.plateThick * 0.5 + 0.004).premultiply(FLIP);
    this.faces!.setMatrixAt(i * 2 + 1, _m4b.premultiply(_m4));
    cells[i * 2] = cell; cells[i * 2 + 1] = cell;
  }

  private ring(x: number, z: number, size: number, kind: PowerUpKind, a: number, time: number, ph: number): void {
    const r = size * (0.95 + 0.08 * Math.sin(time * 3 + ph));
    this.rings!.add(x, 0.05, z, r, 0.8, a, this.tint[kind], 12, 0.1);
  }

  private rushLines(w: World, f: FrameInfo, time: number, calm: boolean): void {
    const T = w.titan;
    const H = Math.max(0.2, T.height);
    const x = T.px + (T.x - T.px) * f.alpha, z = T.pz + (T.z - T.pz) * f.alpha;
    const sp = Math.hypot(T.vx, T.vz);
    const hx = sp > 0.05 ? T.vx / sp : Math.sin(T.heading), hz = sp > 0.05 ? T.vz / sp : Math.cos(T.heading);
    const px = -hz, pz = hx;
    const mpp = (Math.max(1, f.camDist) * K_VIEW) / 720;
    const n = calm ? 6 : 12;
    const P = this.pts;
    const c = this.tint.rushHour;
    for (let i = 0; i < n; i++) {
      const seed = i * 17;
      const u = (time * 1.8 + hash01(seed, 1)) % 1;                // each line travels front → back
      const side = (hash01(seed, 2) - 0.5) * 2.2 * H;
      const y = (0.2 + 0.9 * hash01(seed, 3)) * H;
      const along = (0.9 - 2.2 * u) * H;
      const len = (0.5 + 0.6 * hash01(seed, 4)) * H;
      P[0] = x + hx * along + px * side; P[1] = y; P[2] = z + hz * along + pz * side;
      P[3] = P[0] - hx * len; P[4] = y; P[5] = P[2] - hz * len;
      const a = Math.sin(u * Math.PI) * (calm ? 0.35 : 0.7);
      this.streaks!.line(P, 0, 2, 3 * mpp, a, c.r, c.g, c.b);
    }
  }

  private onEvent(w: World, e: SimEvent): void {
    if (e.type !== 'powerup') return;
    let pp: Pop | null = null;
    for (const x of this.pops) if (!x.on) { pp = x; break; }
    if (!pp) pp = this.pops[0];
    const size = SIZE_H * Math.max(0.3, w.titan.height);
    pp.kind = e.kind; pp.x = e.x; pp.z = e.z; pp.y = size * 1.1; pp.s = size; pp.t = 0; pp.on = true;
    void clamp01;
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.getAttribute('position') as THREE.BufferAttribute, pb = b.getAttribute('position') as THREE.BufferAttribute;
  const ca = a.getAttribute('color') as THREE.BufferAttribute, cb = b.getAttribute('color') as THREE.BufferAttribute;
  const n = pa.count + pb.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  pos.set(pa.array as Float32Array, 0); pos.set(pb.array as Float32Array, pa.count * 3);
  col.set(ca.array as Float32Array, 0); col.set(cb.array as Float32Array, pa.count * 3);
  a.dispose(); b.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
