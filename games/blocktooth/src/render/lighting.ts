// BLOCKTOOTH — the fixed light pool + fog + shadow fitting (CONTRACT.md §4, §6). render-core lane.
//
// Fixed pool (doctrine §3: visible-light COUNT is a program key): ONE DirectionalLight (sun /
// moon, the only shadow caster), ONE HemisphereLight, ONE AmbientLight — created in the
// constructor, added once, NEVER added/removed later. applyBiome() only re-colours them.
//
// Toon maths (three r186, physically-correct light units): a toon surface outputs
//   albedo/π × (ambient + hemi(n) + ramp(n·l) × sun × shadow)
// so the per-time LEVELS below are fractions of π: `lit` ≈ fill + sun, `shade` ≈ fill.
// Day (up-facing): shade ≈ 0.70, half ≈ 0.87, lit ≈ 1.04 of the painted palette hex — a comic
// shadow is a DARKER SAME-HUE tone, not a grey one (0.62 + a strong sky-blue fill turned cream
// sidewalks and teal roads grey whenever the titan stood in a tower's shadow, which the low
// sun makes common). Shadow intensity stays 1 so a cast shadow and a face turned from the sun
// land on the SAME flat comic tone.
//
// Shadow camera (CONTRACT §4): orthographic box centred on the rig's look target, half-size
// 0.9·D·k·aspect (clamped + quantised in 6 % steps so the texel size only changes when the zoom
// crosses a step), depth covering 3·D and every tall caster, re-fit every frame and snapped to
// whole shadow texels in light space so nothing shimmers while the titan walks.

import * as THREE from 'three';
import type { BiomeDef, World } from '../core/types.ts';
import type { CameraRig } from './camera.ts';
import { BUDGET, CAMERA } from '../core/config.ts';

const K = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
/** tallest shadow caster we must keep inside the light frustum (megatower / boss boom), m */
const CASTER_TOP = 190;
/** quantisation step for the shadow box half-size */
const HALF_STEP = 1.06;

interface TimeLook {
  sun: number;          // × π
  hemi: number;         // × π
  ambient: number;      // × π
  tintSat: number;      // how much of the palette hue the fill lights keep (0 = white)
  fogNear: number;      // × camera distance D
  fogFar: number;       // × D
  shadowRadius: number; // PCF softness (texels). The shadow box scales with the view, so a texel is
                        // ≈2.3 screen px at EVERY rank: 1.6 → a ≈7 px penumbra (crisp comic edge, no stair-steps)
  shadowIntensity: number;
}

const LOOK: Record<BiomeDef['time'], TimeLook> = {
  day:      { sun: 0.34, hemi: 0.50, ambient: 0.20, tintSat: 0.12, fogNear: 1.35, fogFar: 3.6, shadowRadius: 1.6, shadowIntensity: 1.0 },
  overcast: { sun: 0.33, hemi: 0.53, ambient: 0.19, tintSat: 0.20, fogNear: 1.10, fogFar: 3.0, shadowRadius: 3.0, shadowIntensity: 1.0 },
  night:    { sun: 0.42, hemi: 0.44, ambient: 0.20, tintSat: 0.55, fogNear: 1.15, fogFar: 3.1, shadowRadius: 1.6, shadowIntensity: 1.0 },
};

const _c = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);

/** Palette hex → a light tint: hue kept, brightness normalised to max channel 1, then
 *  desaturated toward white by (1 − sat). Returns `out` (linear working space). */
function lightTint(hex: string, sat: number, out: THREE.Color): THREE.Color {
  out.set(hex);
  const m = Math.max(out.r, out.g, out.b, 1e-4);
  out.setRGB(out.r / m, out.g / m, out.b / m);
  return out.lerp(_white, 1 - sat);
}

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly fog: THREE.Fog;
  private readonly scene: THREE.Scene;
  private look: TimeLook = LOOK.day;
  /** unit vector from the scene toward the sun */
  private readonly sunDir = new THREE.Vector3(0.78, 0.5, -0.38).normalize();
  // light-space basis (matches Matrix4.lookAt(eye = target + sunDir, target, up))
  private readonly lx = new THREE.Vector3();
  private readonly ly = new THREE.Vector3();
  private readonly lz = new THREE.Vector3();
  private lastHalf = -1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.5);
    sun.name = 'sun';
    sun.castShadow = true;
    sun.shadow.mapSize.set(BUDGET.shadowMap, BUDGET.shadowMap);
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 2.5;
    sun.shadow.blurSamples = 8;
    const sc = sun.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 0.5; sc.far = 400;
    sc.updateProjectionMatrix();
    sun.shadow.autoUpdate = true;
    this.sun = sun;

    const hemi = new THREE.HemisphereLight(0xdfefff, 0x8a8a80, Math.PI * 0.4);
    hemi.name = 'hemi';
    hemi.position.set(0, 1, 0);
    this.hemi = hemi;

    const ambient = new THREE.AmbientLight(0xffffff, Math.PI * 0.14);
    ambient.name = 'ambient';
    this.ambient = ambient;

    scene.add(sun);
    scene.add(sun.target);
    scene.add(hemi);
    scene.add(ambient);

    this.fog = new THREE.Fog(0xf4e6d4, 30, 90);
    scene.fog = this.fog;
    this.setBasis();
  }

  /** Re-colour the fixed pool + fog for a biome (never adds or removes a light). */
  applyBiome(b: BiomeDef): void {
    const p = b.palette;
    const L = LOOK[b.time] ?? LOOK.day;
    this.look = L;

    // sun / moon — colour straight from the palette (it IS the key light), level per time of day
    lightTint(p.sun, 1, _c);
    this.sun.color.copy(_c);
    this.sun.intensity = Math.PI * L.sun;
    const sd = b.sunDir;
    this.sunDir.set(sd[0], sd[1], sd[2]);
    if (this.sunDir.lengthSq() < 1e-6) this.sunDir.set(0.78, 0.5, -0.38);
    this.sunDir.normalize();
    // keep the sun low but never grazing (long soft shadows, no infinite smears)
    const el = Math.asin(Math.min(1, Math.max(-1, this.sunDir.y)));
    const minEl = (22 * Math.PI) / 180, maxEl = (40 * Math.PI) / 180;
    if (el < minEl || el > maxEl) {
      const e = Math.min(maxEl, Math.max(minEl, el));
      const hx = this.sunDir.x, hz = this.sunDir.z;
      const hl = Math.hypot(hx, hz) || 1;
      this.sunDir.set((hx / hl) * Math.cos(e), Math.sin(e), (hz / hl) * Math.cos(e));
    }
    this.setBasis();

    // fill: sky side from the ambient palette colour, ground bounce from road/ground
    lightTint(p.ambient, L.tintSat, this.hemi.color);
    const bounce = new THREE.Color(p.ground).lerp(new THREE.Color(p.road), 0.5);
    const bl = Math.max(bounce.r, bounce.g, bounce.b, 1e-4);
    this.hemi.groundColor.setRGB(bounce.r / bl, bounce.g / bl, bounce.b / bl).lerp(_white, 0.35).multiplyScalar(0.72);
    this.hemi.intensity = Math.PI * L.hemi;
    lightTint(p.ambient, L.tintSat * 0.8, this.ambient.color);
    this.ambient.intensity = Math.PI * L.ambient;

    // fog + background (the sky dome in env.ts paints over the background when mounted)
    this.fog.color.set(p.fog);
    if (this.scene.background instanceof THREE.Color) this.scene.background.set(p.fog);
    else this.scene.background = new THREE.Color(p.fog);

    this.sun.shadow.radius = L.shadowRadius;
    this.sun.shadow.intensity = L.shadowIntensity;
    this.lastHalf = -1;
  }

  /** Fit the shadow frustum + fog to the rig. Call after rig.update() every frame. */
  update(w: World, rig: CameraRig): void {
    const D = Math.max(0.5, rig.distance);
    const tg = rig.target;
    const aspect = Math.min(2.4, Math.max(1, rig.camera.aspect || 16 / 9));

    // ── fog scales with the zoom (the game spans a 30× camera range) ──
    this.fog.near = D * this.look.fogNear;
    this.fog.far = D * this.look.fogFar;

    // ── shadow box ──
    let half = 0.9 * D * K * aspect;
    half = Math.min(760, Math.max(6, half));
    half = Math.pow(HALF_STEP, Math.ceil(Math.log(half) / Math.log(HALF_STEP)));
    const sh = this.sun.shadow;
    const cam = sh.camera;
    const map = sh.mapSize.x;
    const texel = (2 * half) / map;

    // centre: the look target on the ground plane, extended a little toward the far side of
    // the view (the visible ground footprint is a trapezoid that is longer away from the camera)
    const fx = -Math.sin((CAMERA.yawDeg * Math.PI) / 180), fz = -Math.cos((CAMERA.yawDeg * Math.PI) / 180);
    const cx = tg.x + fx * half * 0.18, cy = 0, cz = tg.z + fz * half * 0.18;
    // snap in light space
    let u = cx * this.lx.x + cy * this.lx.y + cz * this.lx.z;
    let v = cx * this.ly.x + cy * this.ly.y + cz * this.ly.z;
    const d = cx * this.lz.x + cy * this.lz.y + cz * this.lz.z;
    u = Math.round(u / texel) * texel;
    v = Math.round(v / texel) * texel;
    const sx = this.lx.x * u + this.ly.x * v + this.lz.x * d;
    const sy = this.lx.y * u + this.ly.y * v + this.lz.y * d;
    const sz = this.lx.z * u + this.ly.z * v + this.lz.z * d;

    // depth: far enough back that the tallest caster inside the box stays in front of the near plane
    const back = Math.max(1.5 * D, CASTER_TOP / Math.max(0.2, this.sunDir.y), half * 1.2);
    const depth = back + Math.max(1.5 * D, half * 1.5);

    this.sun.position.set(sx + this.sunDir.x * back, sy + this.sunDir.y * back, sz + this.sunDir.z * back);
    this.sun.target.position.set(sx, sy, sz);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();

    if (half !== this.lastHalf || cam.far !== depth) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = 0.5; cam.far = depth;
      cam.updateProjectionMatrix();
      this.lastHalf = half;
    }
    // bias in world units, re-expressed per frame: depth bias ≈ 0.25 texel along the light,
    // normal bias ≈ 1.1 texel (toon + low sun: kills acne on the ground and grazing walls)
    sh.bias = -(0.25 * texel) / Math.max(1, depth - 0.5);
    sh.normalBias = 1.1 * texel;
    void w;
  }

  private setBasis(): void {
    // Matrix4.lookAt(eye, target, up): z = eye − target (= sunDir), x = up × z, y = z × x
    this.lz.copy(this.sunDir);
    this.lx.set(0, 1, 0).cross(this.lz);
    if (this.lx.lengthSq() < 1e-8) this.lx.set(1, 0, 0);
    this.lx.normalize();
    this.ly.copy(this.lz).cross(this.lx).normalize();
  }
}
