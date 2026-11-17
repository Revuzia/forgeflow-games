// The glowing core: an emissive ember blob inside the body (oriented by body.frame, squeezed and brightened with the
// compression) plus a soft additive halo billboard. Both live in the OPAQUE list on purpose: three renders them into
// its transmission target, so the jelly refracts and blurs them (the glow you see through the body). The jelly shader
// adds an analytic halo on top, which also covers the low tier (no transmission).
// Rarity (DESIGN 5.3) scales it per tier: Common dim, Uncommon warm, Rare a visible slowly pulsing seed, Epic a bloom,
// Legendary bright, Mythic a prism core whose colour slides through the spectrum with the view angle.
import * as THREE from 'three';
import type { PieceInfo, SoftBodyLike } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import type { CapInfo } from './jelly.ts';
import { isCutPiece } from './pieceBuild.ts';
import { tintShare, type JellyPalette, type Rgb } from './oklch.ts';

const WARM: Rgb = [1.0, 0.45, 0.12];
import type { TierStyle } from './rarity.ts';
import { ADD_KEEP_ALPHA, HaloQuad } from './halo.ts';
import { NOISE_GLSL } from './shaderlib.ts';
import type { RenderPose } from './pose.ts';

// (CUT2: the blob carries two clip planes, inert for a whole, so a piece's ember never pokes out of the cut face and wholes and pieces share one program)
const BLOB_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
#include <clipping_planes_pars_vertex>
void main() {
  vL = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`;
const BLOB_FRAG = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uIntensity;
uniform float uTime;
uniform float uPrism;
#include <clipping_planes_pars_fragment>
${NOISE_GLSL}
void main() {
  #include <clipping_planes_fragment>
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float hot = pow(ndv, 2.4);
  float mott = 0.84 + 0.3 * whNoise3(vL * 2.6 + vec3(0.0, uTime * 0.35, uTime * 0.2));
  float soft = smoothstep(0.0, 0.8, ndv);   // additive and fading to nothing at its rim: a glow seen through the jelly, never a disc
  vec3 base = mix(uColor, uHot, 0.3 * hot * hot);
  vec3 spec = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + (1.0 - ndv) * 1.3 + uTime * 0.05));
  base = mix(base, spec * (0.6 + 0.8 * hot), uPrism);
  // soft knee: a bright core gets brighter (and brighter still when squeezed) but saturates in its own hue, never into a white blob
  float e = (0.5 + 0.7 * hot) * mott * uIntensity * soft * 0.7;
  vec3 c = base * (1.8 * e / (1.8 + e));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Probe knob (the harness sets it; the game never does): the floor of a piece's analytic halo, CUT2 8.3: coreAmt = max(share, 0.35) (a piece without ember is lit by its neighbour's). */
export const CORE_TUNING = { pieceFloor: 0.35 };

/** A clip plane that clips nothing (three.js keeps the side where normal . p + constant >= 0). */
const inertPlane = (): THREE.Plane => new THREE.Plane(new THREE.Vector3(0, 0, 0), 1e6);

export class Core {
  readonly group = new THREE.Group();
  /** World centre and a 0..~2 glow amount for the jelly shader's analytic halo. */
  readonly center = new THREE.Vector3();
  amount = 1;
  /** Extra glow 0..1.5 from outside (merge: where the bodies touch; charge). Eased by the owner. */
  boost = 0;
  /**
   * CUT2 (8.3): a PIECE of a cut squishy keeps the ember where the WHOLE has it: a sphere at W (0, 0, 0), that is at -offset in the piece's rest frame (zero offset and kept = 1 for a whole).
   * `kept` = the share of the sphere on this piece's side of its cut faces (spherical caps, the product over the planes that cross it); the blob hides under 0.2 %, the camera-facing halo is
   * scaled by it, the jelly's analytic halo keeps a floor of 0.35 (a piece without ember is lit by its neighbour's). The blob is clipped against the piece's LIVE cut faces.
   */
  readonly offset = new THREE.Vector3();
  kept = 1;
  /** CUT3: the least kept share that draws the blob (0.002 = the old rule; BodyView.setLod raises it for a small piece among many). */
  minKept = 0.002;
  /** CUT3: a small mini among many draws neither the blob nor the halo (the jelly's own analytic glow still carries the ember); BodyView.setLod sets it. */
  private hidden = false;
  private manyFaces = false;
  setHidden(h: boolean): void { if (h === this.hidden) return; this.hidden = h; if (!h) this.blob.visible = !this.lite; }
  private cut = false;
  private cells: readonly { n: { x: number; y: number; z: number }; d: number }[] = [];
  private clipCaps: number[] = [];
  private readonly clipPlanes: THREE.Plane[] = [inertPlane(), inertPlane()];
  private readonly vOff = new THREE.Vector3();
  /** PLAYGROUND (round 3): the body's render pose (BodyView's): the ember, its halo, the jelly's glow centre and a piece's ember clip ride it
   *  as the skin does (the vertex stage poses the skin: an unposed ember hung off a leaning piece). Null or inactive = the PC's path exactly. */
  pose: RenderPose | null = null;
  private readonly vPose = new THREE.Vector3();
  private readonly p4 = new Float64Array(4);
  private readonly qOff = new THREE.Quaternion();
  /** The multiplier of the jelly's analytic halo: 1 at birth (a piece born at the swap lights its jelly exactly as the whole did: no step), eased to max(kept, 0.35) (CUT2 8.3) with a 0.25 s time constant. */
  private amtK = 1;
  private readonly blob: THREE.Mesh;
  private readonly halo: HaloQuad;
  private readonly blobMat: THREE.ShaderMaterial;
  private readonly blobGeo = new THREE.SphereGeometry(1, 28, 18);
  private readonly radius: number;
  private readonly glow: number;
  private style: TierStyle;
  private readonly palette: JellyPalette;
  private comp = 0;
  private lite = false;
  calm = false;
  /** PLAYGROUND (RD-06): a lite chunk draws no halo quad (its glow stays in the jelly's analytic halo, uCoreAmt). */
  noHalo = false;
  /** Multiplier on the core's size (blob and halo): the body's own pop-in scale, so a result popping out of a capsule at 0.55x does not
   *  wear a full-size halo around a small body (it read as a big saturated aura at the burst peak). */
  sizeMul = 1;
  // the tier colours setStyle computed (tint() leans away from them and back without allocating)
  private readonly baseCol = new THREE.Color(); private readonly baseHot = new THREE.Color();
  private readonly baseHalo = new THREE.Color(); private readonly tintTmp = new THREE.Color();

  constructor(genome: Genome, palette: JellyPalette, scale: number, style: TierStyle) {
    this.radius = 0.17 * scale;
    this.glow = genome.coreGlow;
    this.style = style;
    this.palette = palette;
    const col = new THREE.Color(), hot = new THREE.Color();
    this.blobMat = new THREE.ShaderMaterial({
      vertexShader: BLOB_VERT, fragmentShader: BLOB_FRAG, fog: false,
      // opaque list (so the transmission pass sees it and the jelly refracts it), but ADDITIVE: it lights what is behind it instead of
      // covering it, so a big Rare+ core reads as an inner light and never as a flat coin with an edge
      ...ADD_KEEP_ALPHA, depthWrite: false, transparent: false, clipping: true,
      uniforms: { uColor: { value: col }, uHot: { value: hot }, uIntensity: { value: 2 }, uTime: { value: 0 }, uPrism: { value: style.corePrism } },
    });
    this.halo = new HaloQuad({ renderOrder: -19, fadeH: 0.2 * scale });
    this.halo.setColor(palette.core[0], palette.core[1], palette.core[2]);
    this.blobMat.clippingPlanes = this.clipPlanes;
    this.blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    this.blob.renderOrder = -20;
    this.blob.frustumCulled = false;
    this.group.add(this.blob, this.halo.mesh);
    this.setStyle(style);
  }

  /** The piece this ember belongs to (undefined / not cut = a whole: nothing changes). Call again when a merge publishes a NEW PieceInfo. */
  setPiece(piece: PieceInfo | undefined): void {
    this.cut = isCutPiece(piece);
    this.cells = this.cut ? (piece as PieceInfo).cells[0].slice(0, 8) : [];
    if (this.cut) this.offset.set((piece as PieceInfo).offset.x, (piece as PieceInfo).offset.y, (piece as PieceInfo).offset.z); else this.offset.set(0, 0, 0);
    this.recomputeKept();
  }

  /** The kept share of the sphere (rc = 0.17 x scale x coreSize; the sphere's centre is at distance d_k inside plane k) and which cut faces cross it. */
  private recomputeKept(): void {
    this.clipCaps = []; this.kept = 1; this.manyFaces = false;
    if (!this.cut) return;
    const rc = this.radius * this.style.coreSize, near: { k: number; s: number }[] = [];
    for (let k = 0; k < this.cells.length; k++) {
      const s = this.cells[k].d;   // (the origin of W is inside plane k by d_k: n . 0 - d_k = -d_k < 0 inside)
      if (s >= rc) continue;
      this.kept *= s <= -rc ? 0 : 1 - ((rc - s) * (rc - s) * (2 * rc + s)) / (4 * rc * rc * rc);
      near.push({ k, s });
    }
    near.sort((a, b) => a.s - b.s);
    this.clipCaps = near.slice(0, 2).map((x) => x.k);
    // CUT3: the blob is clipped by at most two cut faces (two clip planes): a piece whose cell has THREE or more faces crossing the ember (a shard of a squishy cut many times) would show the sphere poking out of
    // its other faces as a loose pink ball; it draws no blob there (the camera-facing halo, scaled by the share it holds, and the jelly's own analytic glow still carry its light)
    this.manyFaces = near.length > 2;
  }

  /** Rarity tier changed: recolour (Uncommon warm core, Mythic prism core) and re-scale on the next update. */
  setStyle(style: TierStyle): void {
    this.style = style;
    const p = this.palette;
    const col = this.blobMat.uniforms.uColor.value as THREE.Color, hot = this.blobMat.uniforms.uHot.value as THREE.Color;
    col.setRGB(p.core[0], p.core[1], p.core[2], THREE.LinearSRGBColorSpace);
    hot.setRGB(p.coreHot[0], p.coreHot[1], p.coreHot[2], THREE.LinearSRGBColorSpace);
    // the tier's tints, each scaled by its colour harmony with the body (tintShare: a far hue would muddy the jelly)
    const warm = style.coreWarm * tintShare(WARM, p);
    if (warm > 0) { col.lerp(new THREE.Color(1.0, 0.45, 0.12), warm); hot.lerp(new THREE.Color(1.0, 0.8, 0.5), warm); }
    const t = style.tell, k = style.coreTint * tintShare(t, p);
    if (k > 0) {
      const tc = new THREE.Color().setRGB(t[0], t[1], t[2], THREE.LinearSRGBColorSpace);
      col.lerp(tc, k); hot.lerp(tc.clone().lerp(new THREE.Color(1, 1, 1), 0.35), k);
    }
    const w = style.corePrism > 0 ? 0.4 : 0;   // a prism core's halo is pastel (its blob carries the spectrum)
    const hr = p.core[0] + (t[0] - p.core[0]) * k, hg = p.core[1] + (t[1] - p.core[1]) * k, hb = p.core[2] + (t[2] - p.core[2]) * k;
    this.halo.setColor(hr * (1 - w) + w * 0.9, hg * (1 - w) + w * 0.9, hb * (1 - w) + w);
    this.baseHalo.setRGB(hr * (1 - w) + w * 0.9, hg * (1 - w) + w * 0.9, hb * (1 - w) + w, THREE.LinearSRGBColorSpace);
    this.baseCol.copy(col); this.baseHot.copy(hot);
    this.blobMat.uniforms.uPrism.value = style.corePrism;
    this.recomputeKept();
  }

  /** Lean the core (blob, hot centre, halo) toward a colour (linear rgb) by k 0..1: the merge charge's tell. k 0 = the tier colours. */
  tint(r: number, g: number, b: number, k: number): void {
    const col = this.blobMat.uniforms.uColor.value as THREE.Color, hot = this.blobMat.uniforms.uHot.value as THREE.Color, t = this.tintTmp;
    t.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    col.copy(this.baseCol).lerp(t, k);
    hot.copy(this.baseHot).lerp(t, k * 0.8);
    const h = this.baseHalo;
    this.halo.setColor(h.r + (r - h.r) * k, h.g + (g - h.g) * k, h.b + (b - h.b) * k);
  }

  /** Low tier: no opaque blob (nothing refracts it, so it would read as a flat coin); the soft halo + the jelly's own glow carry it. */
  setLite(on: boolean): void { this.lite = on; this.blob.visible = !on; }

  /** `squeeze` is the renderer's 0..1 compression (global metric or deepest local dent). */
  update(body: SoftBodyLike, dt: number, time: number, squeeze: number, caps?: readonly CapInfo[]): void {
    const c0 = body.center, q = body.frame, st = this.style;
    let c = c0;
    if (this.cut) {   // a piece: the ember sits at W's origin, which is -offset in the piece's rest frame, turned by the body's frame
      this.vOff.set(-this.offset.x, -this.offset.y, -this.offset.z).applyQuaternion(this.qOff.set(q.x, q.y, q.z, q.w));
      c = { x: c0.x + this.vOff.x, y: c0.y + this.vOff.y, z: c0.z + this.vOff.z };
      for (let j = 0; j < 2; j++) {
        const pl = this.clipPlanes[j], k = j < this.clipCaps.length ? this.clipCaps[j] : -1, cap = k >= 0 && caps ? caps[k] : undefined;
        if (cap && cap.live) { pl.normal.set(-cap.nx, -cap.ny, -cap.nz); pl.constant = cap.d; } else { pl.normal.set(0, 0, 0); pl.constant = 1e6; }
      }
      this.blob.visible = !this.lite && this.kept > this.minKept && !this.manyFaces;
      this.amtK += (Math.max(this.kept, CORE_TUNING.pieceFloor) - this.amtK) * (1 - Math.exp(-dt / 0.25));
    }
    const ps = this.pose;
    if (ps && ps.active) {
      const o = this.p4;
      if (this.cut && caps) for (let j = 0; j < 2; j++) {
        const kk = j < this.clipCaps.length ? this.clipCaps[j] : -1, cap = kk >= 0 ? caps[kk] : undefined;
        if (cap && cap.live) { ps.applyPlane(cap.nx, cap.ny, cap.nz, cap.d, c.x, c.y, c.z, o); this.clipPlanes[j].normal.set(-o[0], -o[1], -o[2]); this.clipPlanes[j].constant = o[3]; }
      }
      ps.apply(c.x, c.y, c.z, o, 0);
      c = this.vPose.set(o[0], o[1], o[2]);
    }
    this.center.set(c.x, c.y, c.z);
    this.comp += (squeeze - this.comp) * (1 - Math.exp(-dt * 12));
    const k = this.comp;
    const sy = 1 - 0.42 * k, sxz = 1 + 0.2 * k;
    const r = this.radius * st.coreSize * this.sizeMul;
    this.blob.position.set(c.x, c.y, c.z);
    this.blob.quaternion.set(q.x, q.y, q.z, q.w);
    this.blob.scale.set(r * sxz, r * sy, r * sxz);
    // idle motion: a slow pulse (Rare, under 0.5 Hz) or a slow breathing glow (Mythic); calm mode shows neither
    const pulse = this.calm ? 1 : 1 + st.corePulseAmp * Math.sin(time * Math.PI * 2 * st.corePulseHz);
    const b = 1 + this.boost;
    this.amount = (1.2 + 0.9 * this.glow) * st.coreMul * (1 + 1.5 * k) * pulse * b * (this.cut ? this.amtK : 1);
    this.blobMat.uniforms.uIntensity.value = (1.0 + 1.2 * this.glow) * st.coreMul * (1 + 1.4 * k) * pulse * b;
    this.blobMat.uniforms.uTime.value = time;
    const hs = (0.28 + 0.4 * this.glow) * st.haloMul * (1 + 0.7 * k) * (this.lite ? 0.85 : 1) * pulse * b * (this.cut ? this.kept : 1);
    // same soft knee as the jelly's inner glow: past 0.5 the halo keeps growing, slowly, so stacked glows saturate in hue instead of whiting out
    this.halo.set(c.x, c.y, c.z, r * (3.4 + 0.3 * k) * st.haloSize, this.noHalo ? 0 : hs < 0.5 ? hs : 0.5 + (hs - 0.5) / (1 + (hs - 0.5) / 0.4));
    if (this.hidden) { this.blob.visible = false; this.halo.mesh.visible = false; }
  }

  dispose(): void {
    this.blobGeo.dispose(); this.blobMat.dispose(); this.halo.dispose();
  }
}
