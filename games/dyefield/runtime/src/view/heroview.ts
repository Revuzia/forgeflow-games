// DYEFIELD — HeroView: the Blender-authored tide-runner on screen (CONTRACT §3.2, §5.1).
//
//   * GLTFLoader once (loadHeroAssets), SkeletonUtils.clone per runner, one AnimationMixer each.
//   * Locomotion: idle ↔ run cross-faded by ground speed; run playback synced to speed through the
//     rig's `df_run_stride` extra (metres per foot-plant cycle); jump / fall / land from the vertical
//     state. `frustumCulled = false` on skinned meshes (bind-pose bounds lie — doctrine §3).
//   * Upper-body layer: every locomotion clip is split into a lower-body and an upper-body sub-clip
//     (bone sets from CONTRACT §3.2). While brushing, the 'brush' upper-body sub-clip fades to full
//     weight and the locomotion's upper halves fade out by the same amount, so the stroke fully owns
//     spine/arms/head while the legs keep running (three's PropertyMixer normalises weights; a plain
//     full-weight overlay would only get 50 %).
//   * Team tint: team materials (M_crest M_top_trim M_shorts_stripe M_sole M_tank_dye M_band, and the
//     kit's M_kit_dye) are cloned per runner and multiplied by the crew dye from teams.json.
//   * Kit: kit_mist_rasp.glb attached under `socket_weapon` with an identity transform.
//   * Crest spring: the hair-crest chain (crest_1..3) gets a small damped lag from turn rate and
//     vertical speed, layered after the mixer.
//   * Any missing clip / node falls back and logs ONE warning; nothing here throws after load.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { artUrl } from '../core/glb.ts';
import { teamById } from '../core/data.ts';
import { MOVE } from '../core/config.ts';
import type { TeamId } from '../core/types.ts';

export const REQUIRED_CLIPS = ['idle', 'run', 'jump', 'fall', 'land', 'aim', 'brush'] as const;
const LOCO = ['idle', 'run', 'jump', 'fall', 'land'] as const;
type Loco = typeof LOCO[number];
const UPPER_BONES = ['spine', 'chest', 'neck', 'head', 'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L',
  'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R'];
const TEAM_MATERIALS = new Set(['M_crest', 'M_top_trim', 'M_shorts_stripe', 'M_sole', 'M_tank_dye', 'M_band', 'M_kit_dye']);
const CREST_BONES = ['crest_1', 'crest_2', 'crest_3'];
/**
 * Parts that do not cast into the sun's shadow map (perf: each caster is one more draw call in the
 * shadow pass). All are tiny, inside, or a thin skin layer on another caster: eyes, mouth, visor glass,
 * the dye inside the tank shell, the soles under the shoes, and trim bands a few mm proud of the top,
 * shorts and arms. The shadow map is 1024² over 48 m (~4.7 cm a texel), so their shadows were already
 * inside the casters' own. They still RECEIVE shadows.
 */
const NO_SHADOW_MATERIALS = new Set(['M_eye_white', 'M_eye_dark', 'M_mouth', 'M_glass', 'M_tank_dye', 'M_sole',
  'M_shorts_stripe', 'M_top_trim', 'M_band']);

export interface HeroAssets {
  hero: GLTF;
  kit: GLTF | null;
  /** df_run_stride from the rig extras (m per cycle), or null */
  stride: number | null;
  /** resolved clip per role (after fallbacks) */
  clips: Record<string, THREE.AnimationClip | null>;
  /** lower/upper sub-clips per locomotion role (null when no upper layer is possible) */
  lower: Record<Loco, THREE.AnimationClip | null>;
  upper: Record<Loco, THREE.AnimationClip | null>;
  brushUpper: THREE.AnimationClip | null;
  /** sanitized node names of the crest chain that any clip animates */
  crestAnimated: Set<string>;
  warnings: string[];
  tris: number;
}

function origName(o: THREE.Object3D): string {
  return (o.userData && typeof o.userData.name === 'string') ? o.userData.name : o.name;
}

function findByOrigName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  const san = THREE.PropertyBinding.sanitizeNodeName(name);
  root.traverse((o) => { if (!hit && (origName(o) === name || o.name === name || o.name === san)) hit = o; });
  return hit;
}

function nodeNameOfTrack(track: THREE.KeyframeTrack): string {
  try { return THREE.PropertyBinding.parseTrackName(track.name).nodeName ?? ''; } catch { return ''; }
}

function subClip(clip: THREE.AnimationClip, keep: (node: string) => boolean, suffix: string): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => keep(nodeNameOfTrack(t)));
  return new THREE.AnimationClip(clip.name + suffix, clip.duration, tracks);
}

function loadGltf(loader: GLTFLoader, url: string, onProgress?: (f: number) => void): Promise<GLTF> {
  return new Promise((ok, fail) => {
    loader.load(url, ok, (e) => { if (onProgress && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total); },
      (err) => fail(new Error(`failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`)));
  });
}

/** Load tide_runner.glb (required) + kit_mist_rasp.glb (optional) and prepare the clip layers. */
export async function loadHeroAssets(loader: GLTFLoader, onProgress?: (f: number) => void): Promise<HeroAssets> {
  const warnings: string[] = [];
  let pHero = 0, pKit = 0;
  const report = (): void => { onProgress?.(pHero * 0.8 + pKit * 0.2); };
  const heroP = loadGltf(loader, artUrl('tide_runner.glb'), (f) => { pHero = f; report(); });
  const noKit = (e: unknown): null => {
    const msg = `kit_mist_rasp.glb unavailable — runner is shown without the kit (${e instanceof Error ? e.message : String(e)})`;
    warnings.push(msg);
    console.warn('[heroview]', msg);
    return null;
  };
  // the kit is optional: a missing file (artUrl throws when it is not in the build) must not stop boot
  let kitP: Promise<GLTF | null>;
  try {
    kitP = loadGltf(loader, artUrl('kit_mist_rasp.glb'), (f) => { pKit = f; report(); }).catch(noKit);
  } catch (e) {
    kitP = Promise.resolve(noKit(e));
  }
  const [hero, kit] = await Promise.all([heroP, kitP]);

  // strip any exported lights / cameras (doctrine §3: never ship GLB lights)
  for (const g of [hero, kit]) {
    if (!g) continue;
    const drop: THREE.Object3D[] = [];
    g.scene.traverse((o) => { if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) drop.push(o); });
    for (const o of drop) o.parent?.remove(o);
  }

  const byName = new Map<string, THREE.AnimationClip>();
  for (const c of hero.animations) byName.set(c.name, c);
  const missing = REQUIRED_CLIPS.filter((n) => !byName.has(n));
  if (missing.length) {
    const msg = `tide_runner.glb lacks required clip(s) ${missing.join(', ')} — using fallbacks (have: ${[...byName.keys()].join(', ') || 'none'})`;
    warnings.push(msg);
    console.warn('[heroview]', msg);
  }
  const first = hero.animations[0] ?? null;
  const pick = (...names: string[]): THREE.AnimationClip | null => {
    for (const n of names) { const c = byName.get(n); if (c) return c; }
    return null;
  };
  const clips: Record<string, THREE.AnimationClip | null> = {
    idle: pick('idle', 'lobby_idle') ?? first,
    run: pick('run', 'idle', 'lobby_idle') ?? first,
    jump: pick('jump', 'fall', 'idle') ?? first,
    fall: pick('fall', 'jump', 'idle') ?? first,
    land: pick('land'),
    aim: pick('aim'),
    brush: pick('brush', 'aim'),
  };

  // upper-body node names (as three sanitized them)
  const upper = new Set<string>();
  const crestNames = new Set<string>();
  hero.scene.traverse((o) => {
    const n = origName(o);
    if (UPPER_BONES.includes(n)) upper.add(o.name);
    if (CREST_BONES.includes(n)) crestNames.add(o.name);
  });
  if (upper.size < UPPER_BONES.length) {
    const msg = `tide_runner.glb: found ${upper.size}/${UPPER_BONES.length} upper-body bones — the brush layer may look partial`;
    warnings.push(msg);
    console.warn('[heroview]', msg);
  }
  const isUpper = (n: string): boolean => upper.has(n);
  const layered = upper.size > 0 && !!clips.brush;
  const lower = {} as Record<Loco, THREE.AnimationClip | null>;
  const upperC = {} as Record<Loco, THREE.AnimationClip | null>;
  for (const k of LOCO) {
    const c = clips[k];
    if (!c) { lower[k] = null; upperC[k] = null; continue; }
    if (layered) {
      lower[k] = subClip(c, (n) => !isUpper(n), `__lower_${k}`);
      upperC[k] = subClip(c, isUpper, `__upper_${k}`);
    } else {
      lower[k] = c;
      upperC[k] = null;
    }
  }
  const brushUpper = layered && clips.brush ? subClip(clips.brush, isUpper, '__upper_brush') : null;

  const crestAnimated = new Set<string>();
  for (const c of hero.animations) for (const t of c.tracks) { const n = nodeNameOfTrack(t); if (crestNames.has(n)) crestAnimated.add(n); }

  // df_run_stride from the rig node's extras
  let stride: number | null = null;
  const rig = findByOrigName(hero.scene, 'rig');
  const sv = rig?.userData?.df_run_stride;
  if (typeof sv === 'number' && sv > 0.2) stride = sv;
  else {
    const msg = 'tide_runner.glb: rig extras lack df_run_stride — run playback scales by speed/walk instead';
    warnings.push(msg);
    console.warn('[heroview]', msg);
  }

  let tris = 0;
  hero.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) tris += (m.geometry.index ? m.geometry.index.count : (m.geometry.attributes.position?.count ?? 0)) / 3;
  });

  return { hero, kit, stride, clips, lower, upper: upperC, brushUpper, crestAnimated, warnings, tris };
}

export interface HeroAnimInput {
  speed: number;       // horizontal m/s
  vy: number;
  grounded: boolean;
  brushing: boolean;
  jumps: number;       // take-off counter
  landings: number;    // landing counter
  airTime: number;
  yawRate: number;     // rad/s (render-side estimate)
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class HeroView {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly team: TeamId;
  /** base locomotion role with the largest weight (debug read-out) */
  baseRole = 'idle';
  brushWeight = 0;

  private readonly assets: HeroAssets;
  private readonly lowerA = new Map<Loco, THREE.AnimationAction>();
  private readonly upperA = new Map<Loco, THREE.AnimationAction>();
  private readonly brushA: THREE.AnimationAction | null;
  private readonly w: Record<Loco, number> = { idle: 1, run: 0, jump: 0, fall: 0, land: 0 };
  private lastJumps = 0;
  private lastLandings = 0;
  private jumpT = 99;
  private landT = 99;
  private airborneByJump = false;
  private maxAir = 0;
  private readonly crest: Array<{ bone: THREE.Object3D; rest: THREE.Quaternion; animated: boolean }> = [];
  private crestPitch = 0;
  private crestPitchV = 0;
  private crestSway = 0;
  private crestSwayV = 0;
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor(assets: HeroAssets, team: TeamId) {
    this.assets = assets;
    this.team = team;
    this.model = SkeletonUtils.clone(assets.hero.scene);
    this.root.name = `runner_team${team}`;
    this.root.add(this.model);

    const dye = new THREE.Color(teamById(team).dye);
    const tinted = new Map<THREE.Material, THREE.Material>();
    const tint = (mat: THREE.Material): THREE.Material => {
      if (!TEAM_MATERIALS.has(mat.name)) return mat;
      let t = tinted.get(mat);
      if (!t) {
        t = mat.clone();
        const c = (t as THREE.MeshStandardMaterial).color;
        if (c) c.multiply(dye);
        tinted.set(mat, t);
      }
      return t;
    };
    const prep = (root: THREE.Object3D): void => {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        m.castShadow = !mats.every((mm) => NO_SHADOW_MATERIALS.has(mm.name));
        m.receiveShadow = true;
        if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
        m.material = Array.isArray(m.material) ? m.material.map(tint) : tint(m.material);
      });
    };
    prep(this.model);

    // swim-form fin hidden until SLICK (phase 3)
    const fin = findByOrigName(this.model, 'slick_fin');
    if (fin) fin.visible = false;

    // kit on the weapon socket, identity transform
    if (assets.kit) {
      const kit = assets.kit.scene.clone(true);
      prep(kit);
      kit.position.set(0, 0, 0);
      kit.quaternion.identity();
      kit.scale.set(1, 1, 1);
      kit.name = 'kit_mist_rasp';
      const socket = findByOrigName(this.model, 'socket_weapon') ?? findByOrigName(this.model, 'hand.R');
      if (socket) socket.add(kit);
      else console.warn('[heroview] no socket_weapon / hand.R node — kit not attached');
    }

    // crest chain
    for (const n of CREST_BONES) {
      const b = findByOrigName(this.model, n);
      if (b) this.crest.push({ bone: b, rest: b.quaternion.clone(), animated: assets.crestAnimated.has(b.name) });
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const k of LOCO) {
      const lc = assets.lower[k];
      if (lc) this.lowerA.set(k, this.mixer.clipAction(lc));
      const uc = assets.upper[k];
      if (uc) this.upperA.set(k, this.mixer.clipAction(uc));
    }
    for (const k of ['jump', 'land'] as const) {
      for (const a of [this.lowerA.get(k), this.upperA.get(k)]) {
        if (!a) continue;
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    }
    this.brushA = assets.brushUpper ? this.mixer.clipAction(assets.brushUpper) : null;
    for (const a of [...this.lowerA.values(), ...this.upperA.values()]) { a.enabled = true; a.setEffectiveWeight(0); a.play(); }
    this.brushA?.setEffectiveWeight(0).play();
    this.applyWeights();
    this.mixer.update(0);
  }

  setPose(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);
  }

  animate(dt: number, s: HeroAnimInput): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    // ── events
    if (s.jumps !== this.lastJumps) {
      this.lastJumps = s.jumps;
      this.jumpT = 0;
      this.airborneByJump = true;
      this.restart('jump');
    }
    if (s.landings !== this.lastLandings) {
      this.lastLandings = s.landings;
      if (this.maxAir > 0.22) { this.landT = 0; this.restart('land'); }
      this.airborneByJump = false;
      this.maxAir = 0;
    }
    if (!s.grounded) this.maxAir = Math.max(this.maxAir, s.airTime);
    this.jumpT += dt;
    this.landT += dt;

    // ── target weights
    const t: Record<Loco, number> = { idle: 0, run: 0, jump: 0, fall: 0, land: 0 };
    const jumpDur = this.assets.clips.jump?.duration ?? 0.3;
    const landDur = this.assets.clips.land?.duration ?? 0.25;
    const air = !s.grounded && (this.airborneByJump || s.airTime > 0.12);
    if (air) {
      if (this.airborneByJump && this.jumpT < jumpDur && s.vy > -1.5) t.jump = 1;
      else t.fall = 1;
    } else {
      const r = smoothstep(0.35, 2.2, s.speed);
      t.run = r;
      t.idle = 1 - r;
      if (this.assets.clips.land && this.landT < landDur) {
        const lw = (1 - this.landT / landDur) * (1 - 0.75 * r);
        t.land = lw;
        t.run *= 1 - lw;
        t.idle *= 1 - lw;
      }
    }
    const rate = air || t.land > 0 ? 22 : 12;
    const k = 1 - Math.exp(-rate * dt);
    let best: Loco = 'idle', bw = -1;
    for (const n of LOCO) {
      this.w[n] += (t[n] - this.w[n]) * k;
      if (this.w[n] > bw) { bw = this.w[n]; best = n; }
    }
    this.baseRole = best;
    const bt = s.brushing && this.brushA ? 1 : 0;
    this.brushWeight += (bt - this.brushWeight) * (1 - Math.exp(-18 * dt));
    if (this.brushWeight < 1e-3 && bt === 0) this.brushWeight = 0;

    // ── run playback synced to ground speed
    const runClip = this.assets.clips.run;
    if (runClip) {
      const v = Math.max(1.2, s.speed);
      const ts = this.assets.stride ? (v / this.assets.stride) * runClip.duration : v / MOVE.walk;
      const scale = Math.min(2.2, Math.max(0.5, ts));
      const lr = this.lowerA.get('run'); if (lr) lr.timeScale = scale;
      const ur = this.upperA.get('run'); if (ur) ur.timeScale = scale;
    }

    this.applyWeights();
    this.mixer.update(dt);
    this.crestSpring(dt, s);
  }

  private restart(k: Loco): void {
    for (const a of [this.lowerA.get(k), this.upperA.get(k)]) { if (a) { a.reset(); a.play(); } }
  }

  private applyWeights(): void {
    let sum = 0;
    for (const n of LOCO) sum += this.w[n];
    const inv = sum > 1e-6 ? 1 / sum : 0;
    const b = this.brushWeight;
    for (const n of LOCO) {
      const wn = sum > 1e-6 ? this.w[n] * inv : (n === 'idle' ? 1 : 0);
      this.lowerA.get(n)?.setEffectiveWeight(wn);
      this.upperA.get(n)?.setEffectiveWeight(wn * (1 - b));
    }
    this.brushA?.setEffectiveWeight(b);
  }

  /** small damped lag on the crest chain (turns sway it, vertical speed lifts / drops it) */
  private crestSpring(dt: number, s: HeroAnimInput): void {
    if (!this.crest.length || dt <= 0) return;
    const targetPitch = Math.max(-0.35, Math.min(0.35, -s.vy * 0.045 + s.speed * 0.012));
    const targetSway = Math.max(-0.4, Math.min(0.4, -s.yawRate * 0.06));
    const K = 90, D = 12;
    this.crestPitchV += (K * (targetPitch - this.crestPitch) - D * this.crestPitchV) * dt;
    this.crestPitch += this.crestPitchV * dt;
    this.crestSwayV += (K * (targetSway - this.crestSway) - D * this.crestSwayV) * dt;
    this.crestSway += this.crestSwayV * dt;
    for (let i = 0; i < this.crest.length; i++) {
      const c = this.crest[i];
      const f = (i + 1) / this.crest.length;
      this.e.set(this.crestPitch * f, 0, this.crestSway * f);
      this.q.setFromEuler(this.e);
      if (c.animated) c.bone.quaternion.multiply(this.q);
      else c.bone.quaternion.copy(c.rest).multiply(this.q);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
