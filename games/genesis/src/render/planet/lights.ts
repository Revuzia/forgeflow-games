// GENESIS — sun shadows near the surface: cascaded shadow maps in one depth atlas (CONTRACT.md §15.2, §15.9).
//
// Why custom instead of three's CSM addon: every planet is lit by its own sun direction (a system view shows several
// terminators at once), so the terrain shader evaluates the star itself (RE_Direct with a per-planet IncidentLight,
// tinted per fragment by the transmittance LUT) instead of through three's DirectionalLights. The shadow term is then
// ours too: N cascades (by quality) fitted to view-depth slices with stable bounding spheres snapped to texels, rendered
// into the quadrants of one DepthTexture with hardware comparison (sampler2DShadow → bilinear PCF per tap).
// Casters are the primary planet's terrain patches (layer 1), drawn with per-LOD depth materials that share the
// terrain's displacement and geomorph, so shadows match the drawn ground exactly.

import {
  DepthTexture, FloatType, LessEqualCompare, LinearFilter, Matrix4, OrthographicCamera, PerspectiveCamera, RedFormat,
  UnsignedByteType, Vector3, Vector4, WebGLRenderTarget, type IUniform, type Object3D, type WebGLRenderer,
} from 'three';

export const SHADOW_GLSL = /* glsl */ `
#ifndef GENESIS_SHADOW
#define GENESIS_SHADOW
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMat[4];
uniform vec4 uShadowSplits;
uniform vec4 uShadowBias;
uniform float uShadowOn;
uniform float uShadowCount;
uniform float uShadowTexel;   // 1 / atlas size
float shadowTap(vec3 sc, vec4 tile) {
  vec2 uv = clamp(sc.xy, tile.xy, tile.zw);
  return texture(uShadowMap, vec3(uv, sc.z));
}
float sunShadow(vec3 posView, vec3 nView) {
  if (uShadowOn < 0.5) return 1.0;
  float z = -posView.z;
  int k = z < uShadowSplits.x ? 0 : z < uShadowSplits.y ? 1 : z < uShadowSplits.z ? 2 : 3;
  if (float(k) >= uShadowCount) return 1.0;
  float bias = k == 0 ? uShadowBias.x : k == 1 ? uShadowBias.y : k == 2 ? uShadowBias.z : uShadowBias.w;
  mat4 M = k == 0 ? uShadowMat[0] : k == 1 ? uShadowMat[1] : k == 2 ? uShadowMat[2] : uShadowMat[3];
  vec4 sc4 = M * vec4(posView + nView * bias, 1.0);
  vec3 sc = sc4.xyz / sc4.w;
  vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2)) * 0.5;
  vec4 tile = vec4(o + uShadowTexel * 1.5, o + 0.5 - uShadowTexel * 1.5);
  if (sc.z >= 1.0 || sc.z <= 0.0) return 1.0;
  float r = uShadowTexel * 1.4;
  float s = shadowTap(sc, tile) * 0.36;
  s += shadowTap(sc + vec3(-r, -r * 0.4, 0.0), tile) * 0.16;
  s += shadowTap(sc + vec3(r, r * 0.4, 0.0), tile) * 0.16;
  s += shadowTap(sc + vec3(-r * 0.4, r, 0.0), tile) * 0.16;
  s += shadowTap(sc + vec3(r * 0.4, -r, 0.0), tile) * 0.16;
  // fade out over the last 12 % of the final cascade
  float last = uShadowCount < 1.5 ? uShadowSplits.x : uShadowCount < 2.5 ? uShadowSplits.y : uShadowCount < 3.5 ? uShadowSplits.z : uShadowSplits.w;
  return mix(s, 1.0, smoothstep(last * 0.88, last, z));
}
#endif
`;

export interface ShadowUniforms {
  uShadowMap: IUniform<DepthTexture>;
  uShadowMat: IUniform<Matrix4[]>;
  uShadowSplits: IUniform<Vector4>;
  uShadowBias: IUniform<Vector4>;
  uShadowOn: IUniform<number>;
  uShadowCount: IUniform<number>;
  uShadowTexel: IUniform<number>;
}

const _corners: Vector3[] = Array.from({ length: 8 }, () => new Vector3());
const _c = new Vector3();
const _ls = new Vector3();
const _up = new Vector3();
const _bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _tile = new Matrix4();
const _m = new Matrix4();

export class SunShadows {
  readonly uniforms: ShadowUniforms;
  private rt: WebGLRenderTarget;
  private cams: OrthographicCamera[] = [];
  size: number;
  cascades = 0;
  splits = [0, 0, 0, 0];
  /** world size of one shadow texel per cascade (m) */
  readonly texel = [0, 0, 0, 0];
  private radii = [0, 0, 0, 0];

  constructor(size = 2048) {
    this.size = size;
    this.rt = this.makeTarget(size);
    const mats = [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()];
    this.uniforms = {
      uShadowMap: { value: this.rt.depthTexture as DepthTexture }, uShadowMat: { value: mats },
      uShadowSplits: { value: new Vector4(1e9, 1e9, 1e9, 1e9) }, uShadowBias: { value: new Vector4() },
      uShadowOn: { value: 0 }, uShadowCount: { value: 0 }, uShadowTexel: { value: 1 / size },
    };
    for (let i = 0; i < 4; i++) {
      const c = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
      c.layers.set(1);
      c.matrixAutoUpdate = false;
      this.cams.push(c);
    }
  }

  private makeTarget(size: number): WebGLRenderTarget {
    const dt = new DepthTexture(size, size, FloatType);
    dt.compareFunction = LessEqualCompare;
    dt.minFilter = LinearFilter;
    dt.magFilter = LinearFilter;
    // the colour attachment is required by the framebuffer but never written (colorWrite = false)
    return new WebGLRenderTarget(size, size, { depthTexture: dt, format: RedFormat, type: UnsignedByteType, depthBuffer: true });
  }

  /** allocate the depth atlas on the GPU now, so samplers bound to it are valid before the first shadow pass */
  init(renderer: WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(prev);
  }

  setSize(size: number): void {
    if (size === this.size) return;
    this.rt.dispose();
    this.size = size;
    this.rt = this.makeTarget(size);
    this.uniforms.uShadowMap.value = this.rt.depthTexture as DepthTexture;
    this.uniforms.uShadowTexel.value = 1 / size;
  }

  /**
   * Fit `count` cascades to the camera between `near` and `far` (view depth, m) for a sun travelling along `sunDir`
   * (world, pointing TO the sun). `casterReach` extends each light box toward the sun to catch distant casters.
   */
  fit(camera: PerspectiveCamera, sunDir: Vector3, count: number, near: number, far: number, casterReach: number): void {
    this.cascades = Math.max(0, Math.min(4, count));
    const u = this.uniforms;
    u.uShadowCount.value = this.cascades;
    u.uShadowOn.value = this.cascades > 0 ? 1 : 0;
    if (!this.cascades) return;
    // practical split scheme (λ = 0.75 toward logarithmic)
    const lambda = 0.75;
    const bounds: number[] = [near];
    for (let i = 1; i <= this.cascades; i++) {
      const f = i / this.cascades;
      const log = near * Math.pow(far / near, f);
      const lin = near + (far - near) * f;
      bounds.push(lambda * log + (1 - lambda) * lin);
    }
    const sp = u.uShadowSplits.value;
    sp.set(bounds[1], bounds[2] ?? 1e9, bounds[3] ?? 1e9, bounds[4] ?? 1e9);
    for (let i = 0; i < 4; i++) this.splits[i] = bounds[i + 1] ?? 1e9;
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    const tanX = tanY * camera.aspect;
    const half = this.size / 2;
    for (let k = 0; k < this.cascades; k++) {
      const z0 = bounds[k], z1 = bounds[k + 1];
      // frustum slice corners in view space → world
      let idx = 0;
      for (const z of [z0, z1]) {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          _corners[idx++].set(sx * tanX * z, sy * tanY * z, -z).applyMatrix4(camera.matrixWorld);
        }
      }
      // stable bounding sphere: centre on the slice axis, radius from the far corners (rotation invariant)
      const zc = Math.min(z1, 0.5 * (z0 + z1) * (1 + tanX * tanX + tanY * tanY));
      _c.set(0, 0, -zc).applyMatrix4(camera.matrixWorld);
      let r = 0;
      for (const p of _corners) r = Math.max(r, p.distanceTo(_c));
      r = Math.ceil(r * 1.02 * 16) / 16;
      this.radii[k] = r;
      const cam = this.cams[k];
      // light basis
      _up.set(0, 1, 0);
      if (Math.abs(sunDir.y) > 0.95) _up.set(1, 0, 0);
      const eye = _ls.copy(sunDir).multiplyScalar(r + casterReach).add(_c);
      cam.position.copy(eye);
      cam.up.copy(_up);
      cam.lookAt(_c);
      cam.updateMatrix();
      cam.updateMatrixWorld(true);
      // snap the centre to whole texels in light space (no shimmering while the camera moves)
      const texel = (2 * r) / half;
      this.texel[k] = texel;
      const inv = _m.copy(cam.matrixWorld).invert();
      const lc = _ls.copy(_c).applyMatrix4(inv);
      lc.x = Math.round(lc.x / texel) * texel;
      lc.y = Math.round(lc.y / texel) * texel;
      cam.left = lc.x - r; cam.right = lc.x + r; cam.bottom = lc.y - r; cam.top = lc.y + r;
      cam.near = 0.5; cam.far = r * 2 + casterReach;
      cam.updateProjectionMatrix();
      // view-space position → atlas tile [0,1]: tile × bias × proj × lightView × cameraWorld
      _tile.makeTranslation((k % 2) * 0.5, Math.floor(k / 2) * 0.5, 0).multiply(new Matrix4().makeScale(0.5, 0.5, 1));
      u.uShadowMat.value[k].copy(_tile).multiply(_bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse).multiply(camera.matrixWorld);
      // normal-offset bias ≈ 1.5 texels of this cascade
      (['x', 'y', 'z', 'w'] as const).forEach((key, i) => { if (i === k) u.uShadowBias.value[key] = texel * 1.5; });
    }
  }

  /**
   * render the casters (layer 1) into the atlas; `swap(true)` must switch casters to depth materials. `perCascade(k)`
   * runs before cascade k is drawn (and with −1 after the last) so the caller can leave out casters that cascade
   * cannot use — ground near the camera in the far cascades (those pixels read cascade 0), casters smaller than a
   * texel — instead of drawing the whole view's geometry once per cascade.
   */
  render(renderer: WebGLRenderer, scene: Object3D, swap: (depth: boolean) => void, perCascade?: (k: number) => void): void {
    if (!this.cascades) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    swap(true);
    renderer.setRenderTarget(this.rt);
    this.rt.scissorTest = false;
    this.rt.viewport.set(0, 0, this.size, this.size);
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.autoClear = false;
    const half = this.size / 2;
    for (let k = 0; k < this.cascades; k++) {
      this.rt.viewport.set((k % 2) * half, Math.floor(k / 2) * half, half, half);
      this.rt.scissor.copy(this.rt.viewport);
      this.rt.scissorTest = true;
      renderer.setRenderTarget(this.rt);
      perCascade?.(k);
      renderer.render(scene, this.cams[k]);
    }
    perCascade?.(-1);
    this.rt.scissorTest = false;
    renderer.autoClear = prevAuto;
    renderer.setClearColor(0x000000, 1);
    swap(false);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.rt.dispose();
  }
}
