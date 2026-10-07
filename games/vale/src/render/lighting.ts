// VALE render — the one sun (STYLE_BIBLE "Look rules": one sun, behind-left of camera; tokens
// `grade.maps.*.sun`), with a single directional shadow map FITTED to the visible ground.
//
// The lane camera never sees the horizon, so cascades are wasted: each frame the four screen-corner
// rays are intersected with the ground (y = 0) and with a caster ceiling (y = 6 m); the eight points
// are bounded in light space, the extent is quantised to 2 m steps and the centre is snapped to whole
// shadow texels, so the map never shimmers while the camera pans. PCF (r186: Vogel-disk PCF) from
// High up; tier 1 is 1024² "hard" (radius 0.5), tier 0 has no sun shadows (blob contact shadows
// carry grounding then). Fighters soften what they receive in world_material.ts (≥ 75 % in shadow).

import {
  BasicShadowMap, Color, DirectionalLight, Matrix4, Object3D, PCFShadowMap, type PerspectiveCamera,
  Vector3, type WebGLRenderer,
} from 'three';
import { worldUniforms } from './world_material.ts';

export interface SunSpec { sunDir: readonly [number, number, number]; sunColor: string; sunIntensity: number }

const CEILING = 6;
const QUANT = 2;
const PAD = 3;

export class Sun {
  readonly light: DirectionalLight;
  readonly target = new Object3D();
  private dir = new Vector3(0, 1, 0);
  private basis = new Matrix4();
  private basisInv = new Matrix4();
  private mapSize = 2048;
  private readonly corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  shadowsOn = true;

  constructor() {
    this.light = new DirectionalLight(0xffffff, 3);
    this.light.target = this.target;
    this.light.castShadow = true;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.radius = 2;
  }

  configure(spec: SunSpec): void {
    const [x, y, z] = spec.sunDir;
    this.dir.set(x, y, z).normalize();
    this.light.color.setStyle(spec.sunColor);
    this.light.intensity = spec.sunIntensity;
    // light-space basis: eye on the sun direction looking at the origin (same as the shadow camera)
    const up = Math.abs(this.dir.y) > 0.999 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    this.basis.lookAt(this.dir, new Vector3(0, 0, 0), up);
    this.basisInv.copy(this.basis).invert();
    // fighters' own key light = 0.9 × sun, in the sun's colour (world_material.ts)
    const c = new Color().setStyle(spec.sunColor).multiplyScalar(spec.sunIntensity * 0.9);
    worldUniforms.valeKeyColor.value.copy(c);
    worldUniforms.valeRimColor.value.setStyle(spec.sunColor).multiplyScalar(0.18 * spec.sunIntensity / 3);
  }

  /** 0 off · 1 1024² hard · 2 2048² PCF · 3 4096² PCF */
  setQuality(renderer: WebGLRenderer, tier: 0 | 1 | 2 | 3): void {
    this.shadowsOn = tier > 0;
    renderer.shadowMap.enabled = this.shadowsOn;
    renderer.shadowMap.type = tier === 1 ? BasicShadowMap : PCFShadowMap;
    this.light.castShadow = this.shadowsOn;
    const size = tier === 3 ? 4096 : tier === 2 ? 2048 : 1024;
    if (size !== this.mapSize || !this.light.shadow.map) {
      this.mapSize = size;
      this.light.shadow.mapSize.set(size, size);
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
    }
    this.light.shadow.radius = tier >= 2 ? 2.2 : 1;
    renderer.shadowMap.needsUpdate = true;
  }

  /** fit the shadow frustum to what the camera sees (call after the camera moved) */
  fit(camera: PerspectiveCamera): void {
    // view-space sun direction for the fighters' rim term
    worldUniforms.valeSunDirView.value.copy(this.dir).transformDirection(camera.matrixWorldInverse);
    const cam = camera.position;
    for (let i = 0; i < 4; i++) {
      const [nx, ny] = this.ndc[i];
      this.tmp.set(nx, ny, 0.5).unproject(camera).sub(cam).normalize();
      for (let k = 0; k < 2; k++) {
        const h = k === 0 ? 0 : CEILING;
        const t = this.tmp.y < -1e-4 ? (h - cam.y) / this.tmp.y : 200;
        this.corners[i * 2 + k].copy(cam).addScaledVector(this.tmp, Math.min(Math.max(t, 0), 200));
      }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.corners) {
      this.tmp2.copy(p).applyMatrix4(this.basisInv);
      minX = Math.min(minX, this.tmp2.x); maxX = Math.max(maxX, this.tmp2.x);
      minY = Math.min(minY, this.tmp2.y); maxY = Math.max(maxY, this.tmp2.y);
      minZ = Math.min(minZ, this.tmp2.z); maxZ = Math.max(maxZ, this.tmp2.z);
    }
    const half = Math.ceil((Math.max(maxX - minX, maxY - minY) / 2 + PAD) / QUANT) * QUANT;
    const texel = (half * 2) / this.mapSize;
    let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    cx = Math.round(cx / texel) * texel; cy = Math.round(cy / texel) * texel;
    const cz = (minZ + maxZ) / 2;
    // centre back to world space
    this.tmp.set(cx, cy, cz).applyMatrix4(this.basis);
    const depth = 80;
    this.target.position.copy(this.tmp);
    this.light.position.copy(this.tmp).addScaledVector(this.dir, depth);
    this.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
    const sc = this.light.shadow.camera;
    const far = Math.ceil((depth + (maxZ - minZ) / 2 + 30) / 10) * 10;
    if (sc.right !== half || sc.near !== 1 || sc.far !== far) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 1; sc.far = far;
      sc.updateProjectionMatrix();
    }
  }
}
