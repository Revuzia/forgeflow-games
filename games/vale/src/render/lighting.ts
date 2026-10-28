// VALE render — the one sun (STYLE_BIBLE "Look rules": one sun, behind-left of camera; tokens
// `grade.maps.*.sun`), with a single directional shadow map FITTED to the visible ground.
//
// The lane camera never sees the horizon, so cascades are wasted: each frame the four screen-corner
// rays are intersected with the ground (y = 0) and with a caster ceiling (y = 6 m); the eight points
// are bounded in light space, the extent is quantised to 2 m steps and the centre is snapped to whole
// shadow texels, so the map never shimmers while the camera pans. PCF (r186: Vogel-disk PCF) from
// High up; tier 1 is 1024² "hard" (radius 0.5), tier 0 has no sun shadows (blob contact shadows
// carry grounding then). Fighters soften what they receive in world_material.ts (≥ 75 % in shadow).
// Characters also carry their own light (CHAR_LIGHT below, world_material.ts): no light object, no shadow map.

import {
  BasicShadowMap, Color, DirectionalLight, Matrix4, Object3D, PCFShadowMap, type PerspectiveCamera,
  Vector3, type WebGLRenderer,
} from 'three';
import { worldUniforms } from './world_material.ts';

export interface SunSpec { sunDir: readonly [number, number, number]; sunColor: string; sunIntensity: number }

/** tokens.json `grade.fighterLight` (the key) and `grade.fighterLight.rig` (the character light, world_material.ts):
 *  the key's share of the sun; the noon crown (view-space direction, Fresnel power, radiance as luminance in linear light,
 *  its hue Noonwhite leaned toward the sun's colour, the albedo value floor); the eye fill (luminance, Noonwhite); the
 *  knee (the light fades out as the world's own light on the surface rises through this linear luminance range); the
 *  wick and monster share of the crown. The same on every map: a character reads alike wherever it stands. */
export const CHAR_LIGHT = {
  keyOfSun: 0.9,
  crown: { viewDir: [0, 0.8, -0.6] as const, power: 2.5, luminance: 3.4, sunHue: 0.5, albedoFloor: 0.3 },
  fill: { luminance: 0.7 },
  knee: [0.25, 0.75] as const,
  unitShare: 0.35,
  /** a jungle monster's key: its share of the sun (wicks keep 1). Their pale hides lit by the full sun measured top-25
   *  L* 79.4 / 79.9 on RIFT, over the fighters' 75.7 / 76.0 (value_probe, r12 B5); at this share they sit at or just
   *  under the fighters, so a camp never outshines the fighters fighting in it */
  monsterKeyOfSun: 0.82,
} as const;
const NOONWHITE = new Color().setStyle('#F4EFE2');
const _crown = new Color();
const _sunHue = new Color();
const lum = (c: Color): number => Math.max(1e-4, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);

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
    // fighters re-aim this light to their own view-space key at CHAR_LIGHT.keyOfSun × (world_material.ts), and take
    // the character light: crown and fill radiance set here as luminance (hue only from Noonwhite and the sun)
    const W = worldUniforms, C = CHAR_LIGHT;
    W.valeCharKey.value = C.keyOfSun;
    const crown = _crown.copy(NOONWHITE).lerp(_sunHue.setStyle(spec.sunColor), C.crown.sunHue);
    crown.multiplyScalar(C.crown.luminance / lum(crown));
    W.valeCharRim.value.set(crown.r, crown.g, crown.b, C.crown.power);
    W.valeCharRimDir.value.set(C.crown.viewDir[0], C.crown.viewDir[1], C.crown.viewDir[2]).normalize();
    W.valeCharFill.value.copy(NOONWHITE).multiplyScalar(C.fill.luminance / lum(NOONWHITE));
    W.valeCharShape.value.set(C.crown.albedoFloor, C.unitShare, C.knee[0], C.knee[1]);
    W.valeCharMonster.value = C.monsterKeyOfSun;
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
