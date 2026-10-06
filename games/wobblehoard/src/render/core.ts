// The glowing core: an emissive ember blob inside the body (oriented by body.frame, squeezed and brightened with the
// compression) plus a soft additive halo billboard. Both live in the OPAQUE list on purpose: three renders them into
// its transmission target, so the jelly refracts and blurs them (the glow you see through the body). The jelly shader
// adds an analytic halo on top, which also covers the low tier (no transmission).
// Rarity (DESIGN 5.3) scales it per tier: Common dim, Uncommon warm, Rare a visible slowly pulsing seed, Epic a bloom,
// Legendary bright, Mythic a prism core whose colour slides through the spectrum with the view angle.
import * as THREE from 'three';
import type { SoftBodyLike } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import type { JellyPalette } from './oklch.ts';
import type { TierStyle } from './rarity.ts';
import { HaloQuad } from './halo.ts';
import { NOISE_GLSL } from './shaderlib.ts';

const BLOB_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
void main() {
  vL = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
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
${NOISE_GLSL}
void main() {
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

export class Core {
  readonly group = new THREE.Group();
  /** World centre and a 0..~2 glow amount for the jelly shader's analytic halo. */
  readonly center = new THREE.Vector3();
  amount = 1;
  /** Extra glow 0..1.5 from outside (merge: where the bodies touch; charge). Eased by the owner. */
  boost = 0;
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
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: false,
      uniforms: { uColor: { value: col }, uHot: { value: hot }, uIntensity: { value: 2 }, uTime: { value: 0 }, uPrism: { value: style.corePrism } },
    });
    this.halo = new HaloQuad({ renderOrder: -19, fadeH: 0.2 * scale });
    this.halo.setColor(palette.core[0], palette.core[1], palette.core[2]);
    this.blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    this.blob.renderOrder = -20;
    this.blob.frustumCulled = false;
    this.group.add(this.blob, this.halo.mesh);
    this.setStyle(style);
  }

  /** Rarity tier changed: recolour (Uncommon warm core, Mythic prism core) and re-scale on the next update. */
  setStyle(style: TierStyle): void {
    this.style = style;
    const p = this.palette;
    const col = this.blobMat.uniforms.uColor.value as THREE.Color, hot = this.blobMat.uniforms.uHot.value as THREE.Color;
    col.setRGB(p.core[0], p.core[1], p.core[2], THREE.LinearSRGBColorSpace);
    hot.setRGB(p.coreHot[0], p.coreHot[1], p.coreHot[2], THREE.LinearSRGBColorSpace);
    if (style.coreWarm > 0) { col.lerp(new THREE.Color(1.0, 0.45, 0.12), style.coreWarm); hot.lerp(new THREE.Color(1.0, 0.8, 0.5), style.coreWarm); }
    const t = style.tell;
    if (style.coreTint > 0) {
      const tc = new THREE.Color().setRGB(t[0], t[1], t[2], THREE.LinearSRGBColorSpace);
      col.lerp(tc, style.coreTint); hot.lerp(tc.clone().lerp(new THREE.Color(1, 1, 1), 0.35), style.coreTint);
    }
    const k = style.coreTint, w = style.corePrism > 0 ? 0.4 : 0;   // a prism core's halo is pastel (its blob carries the spectrum)
    const hr = p.core[0] + (t[0] - p.core[0]) * k, hg = p.core[1] + (t[1] - p.core[1]) * k, hb = p.core[2] + (t[2] - p.core[2]) * k;
    this.halo.setColor(hr * (1 - w) + w * 0.9, hg * (1 - w) + w * 0.9, hb * (1 - w) + w);
    this.baseHalo.setRGB(hr * (1 - w) + w * 0.9, hg * (1 - w) + w * 0.9, hb * (1 - w) + w, THREE.LinearSRGBColorSpace);
    this.baseCol.copy(col); this.baseHot.copy(hot);
    this.blobMat.uniforms.uPrism.value = style.corePrism;
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
  update(body: SoftBodyLike, dt: number, time: number, squeeze: number): void {
    const c = body.center, q = body.frame, st = this.style;
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
    this.amount = (1.2 + 0.9 * this.glow) * st.coreMul * (1 + 1.5 * k) * pulse * b;
    this.blobMat.uniforms.uIntensity.value = (1.0 + 1.2 * this.glow) * st.coreMul * (1 + 1.4 * k) * pulse * b;
    this.blobMat.uniforms.uTime.value = time;
    const hs = (0.28 + 0.4 * this.glow) * st.haloMul * (1 + 0.7 * k) * (this.lite ? 0.85 : 1) * pulse * b;
    // same soft knee as the jelly's inner glow: past 0.5 the halo keeps growing, slowly, so stacked glows saturate in hue instead of whiting out
    this.halo.set(c.x, c.y, c.z, r * (3.4 + 0.3 * k) * st.haloSize, hs < 0.5 ? hs : 0.5 + (hs - 0.5) / (1 + (hs - 0.5) / 0.4));
  }

  dispose(): void {
    this.blobGeo.dispose(); this.blobMat.dispose(); this.halo.dispose();
  }
}
