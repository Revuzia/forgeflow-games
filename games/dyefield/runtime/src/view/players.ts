// DYEFIELD — the 8 runners on screen (CONTRACT §11 view/players.ts; phase 6 kits: CONTRACT_P6_11 §18.2).
//
// ONE HeroAssets → ONE shared merged geometry PER KIT:
//   * prepareRunnerKit() bakes the hero's 15 body primitives + the tank-dye mesh + one kit GLB into ONE
//     skinned BufferGeometry (drawn once per runner). The kit is baked into bind space and weighted
//     100 % to `hand.R`, through the exact socket_weapon transform, so it rides the hand like an
//     attached kit would (world = hand(now) · socketLocal · kitMesh · v — see the kit block below).
//     Per-vertex attributes carry what the materials used to: `color` = material base colour ×
//     COLOR_0 (linear), `aTone` = (team mask, roughness, metalness, part flag). M_glass is dropped.
//     SHEET-DRUM's drum (`drum` empty, spin axis +X) is flagged PART_DRUM and spun in the vertex shader
//     about its bind-space axis (a per-runner uniform), so the roller stays ONE draw call.
//     The slick_fin (weighted 100 % to `root`) becomes a second, static merged geometry.
//   * one custom MeshStandardMaterial per runner (shared program, `customProgramCacheKey`): the team
//     dye multiplies the team-masked vertices, the tank dye is clipped at the tank level in bind
//     space (df_fill_min..df_fill_max), a hit flash and a team rim light keep runners readable.
//   → each runner is ONE draw call (+ one in the sun's shadow pass); in SLICK it is the fin instead.
//
// Animation (per runner, one AnimationMixer), weights composed per bone group so every group sums to 1:
//   lower body  locomotion (idle / run / back / strafe / jump / fall / land / victory by the body-frame
//               velocity) × (1 − F) + the FULL-body clips `roll` (while rolling, synced to speed) and
//               `slam` (the WELLSPRING leap + slam, once) × F.
//   upper body  base = locomotion-upper (one-handed kits) or `hold_two` (two-handed kits: the left hand on
//               the kit's grip_L, as authored), plus the full clips' upper halves; then the OVERLAYS
//               replace a share O of it: a continuous `aim` (MIST-RASP / POP-WELL firing) or `charge`
//               (NEEDLE-GLINT charging), and one-shots `flick`, `blast`, `throw` (JELLY CHARGE),
//               `special_throw` (CLOUDBURST). The slam owns the whole body.
// After the mixer, the aim pitch / yaw offset bends spine + chest + neck about WORLD axes while an aim-type
// overlay plays, and the crest chain gets a damped spring. The bent bones are restored to their
// post-mixer pose before every mixer update (the mixer skips writing an unchanged value, so a bend
// would otherwise accumulate on a steady clip). Far runners (> 28 m) animate at 30 Hz; hidden bodies
// (slick, washed) do not animate.
//
// SLICK: body hidden, fin shown (bobbing, banking on turns; laid flat against the wall in WALL-SLICK),
// with a wake from fx.ts. Enemy slickers that the sim marks `hidden` are drawn only as a faint ripple
// beyond 3 m (DESIGN §4). WASHED: a squash-pop then the body is hidden until respawn; the respawn is a
// tide-spout drop onto the pad (0.6 s). Name tags (DOM, one element per runner, transforms only):
// allies always, enemies only while seen. Rollers throw a sheet spray at the drum contact while rolling;
// WELLSPRING leapers drip a dye trail.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { HeroAssets } from './heroview.ts';
import type { Fx } from './fx.ts';
import { teamById, WEAPONS } from '../core/data.ts';
import { artUrl } from '../core/glb.ts';
import { MOVE } from '../core/config.ts';
import type { MoveState, TeamId } from '../core/types.ts';

/** The slice of core/runner.ts `Runner` (CONTRACT §10.2) the view reads. Structural, read-only. */
export interface RunnerLike {
  readonly id: number; readonly name: string; readonly team: TeamId;
  x: number; y: number; z: number; px: number; py: number; pz: number; yaw: number; pyaw: number;
  vx: number; vy: number; vz: number; aimYaw: number; aimPitch: number;
  state: MoveState; grounded: boolean; tank: number; hp: number; alive: boolean; hidden: boolean; firing: boolean;
  jumps: number; landings: number;
  /** CHANGED(SIM) §10.4 read-outs (optional so older sims still type-check) */
  slickForm?: boolean; wallNx?: number; wallNz?: number;
  /** CHANGED(KITSIM) §10.2 read-outs */
  charge?: number; rolling?: boolean; flicking?: boolean; leaping?: boolean; specialActive?: string;
}

export type KitFireType = 'stream' | 'roll' | 'charge' | 'burst';

const TEAM_MATS = new Set(['M_crest', 'M_top_trim', 'M_shorts_stripe', 'M_sole', 'M_tank_dye', 'M_band', 'M_kit_dye']);
const DROP_MATS = new Set(['M_glass']);
const UPPER_BONES = ['spine', 'chest', 'neck', 'head', 'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L',
  'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R'];
const CREST_BONES = ['crest_1', 'crest_2', 'crest_3'];
/** part flags (aTone.w) */
const PART_BODY = 0, PART_TANK = 1, PART_KIT = 2, PART_DRUM = 3;

const LOCO = ['idle', 'run', 'back', 'strafe_l', 'strafe_r', 'jump', 'fall', 'land', 'victory'] as const;
type Loco = typeof LOCO[number];
const FALLBACK: Record<Loco, string[]> = {
  idle: ['idle', 'lobby_idle'], run: ['run', 'idle'], back: ['back', 'run'], strafe_l: ['strafe_l', 'run'],
  strafe_r: ['strafe_r', 'run'], jump: ['jump', 'fall', 'idle'], fall: ['fall', 'jump', 'idle'], land: ['land'],
  victory: ['victory', 'lobby_idle', 'idle'],
};
/** full-body kit clips (split lower / upper so the weights compose) */
const FULL = ['roll', 'slam'] as const;
type Full = typeof FULL[number];
/** upper-body kit clips */
const OVER = ['aim', 'hold_two', 'charge', 'blast', 'flick', 'throw', 'special_throw'] as const;
type Over = typeof OVER[number];
/** upper one-shots (play once, fade out) */
export type OneShot = 'blast' | 'flick' | 'throw' | 'special_throw';
const ONE_SHOTS: readonly OneShot[] = ['blast', 'flick', 'throw', 'special_throw'];

const TAU = Math.PI * 2;
const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return d;
};
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
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
/** name of the nearest ancestor (or self) whose original name is in `names` */
function ownerOf(o: THREE.Object3D, names: readonly string[]): string | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const n = origName(p);
    if (names.includes(n)) return n;
  }
  return null;
}
function trackNode(t: THREE.KeyframeTrack): string {
  try { return THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? ''; } catch { return ''; }
}

/** weapons.json kit row → its fire type (stream when unknown) */
export function kitFireType(kitId: string): KitFireType {
  const t = (WEAPONS.kits.find((k) => k.id === kitId)?.fire as { type?: string } | undefined)?.type;
  return t === 'roll' || t === 'charge' || t === 'burst' ? t : 'stream';
}

/**
 * Bot kits for defaultRoster(): the human's 3 crewmates carry the 3 kits the human does not, the rival
 * crew carries all 4 (one each), so every match shows every kit on both sides. Index = runner id − 1.
 */
export function mixedBotKits(humanKit: string): string[] {
  const all = WEAPONS.kits.map((k) => k.id);
  const mates = all.filter((k) => k !== humanKit);
  while (mates.length < 3) mates.push(all[mates.length % all.length] ?? humanKit);
  const rivals = [...all];
  while (rivals.length < 4) rivals.push(all[rivals.length % all.length] ?? humanKit);
  return [...mates.slice(0, 3), ...rivals.slice(0, 4)];
}

// ───────────────────────────── geometry baking (runners + FX models) ─────────────────────────────

function bake(src: THREE.BufferGeometry, mat: THREE.Material, M: THREE.Matrix4 | null,
  skin: 'keep' | 'none' | number, flag: number, remap: Int32Array | null, teamOverride?: number): THREE.BufferGeometry {
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nor = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const col = src.getAttribute('color') as THREE.BufferAttribute | undefined;
  const si = src.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const sw = src.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  const n = pos.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), T = new Float32Array(n * 4);
  const std = mat as THREE.MeshStandardMaterial;
  const base = std.color ?? new THREE.Color(1, 1, 1);
  const team = teamOverride ?? (TEAM_MATS.has(mat.name) ? 1 : 0);
  const rough = typeof std.roughness === 'number' ? std.roughness : 0.5;
  const metal = typeof std.metalness === 'number' ? std.metalness : 0;
  const nm = M ? new THREE.Matrix3().getNormalMatrix(M) : null;
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    if (M) v.applyMatrix4(M);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    if (nor) {
      v.fromBufferAttribute(nor, i);
      if (nm) v.applyMatrix3(nm);
      v.normalize();
    } else v.set(0, 1, 0);
    N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
    const cr = col ? col.getX(i) : 1, cg = col ? col.getY(i) : 1, cb = col ? col.getZ(i) : 1;
    C[i * 3] = base.r * cr; C[i * 3 + 1] = base.g * cg; C[i * 3 + 2] = base.b * cb;
    T[i * 4] = team; T[i * 4 + 1] = rough; T[i * 4 + 2] = metal; T[i * 4 + 3] = flag;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aTone', new THREE.BufferAttribute(T, 4));
  if (skin !== 'none') {
    const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      if (skin === 'keep' && si && sw) {
        for (let c = 0; c < 4; c++) {
          const j = c === 0 ? si.getX(i) : c === 1 ? si.getY(i) : c === 2 ? si.getZ(i) : si.getW(i);
          SI[i * 4 + c] = remap ? Math.max(0, remap[j] ?? 0) : j;
          SW[i * 4 + c] = c === 0 ? sw.getX(i) : c === 1 ? sw.getY(i) : c === 2 ? sw.getZ(i) : sw.getW(i);
        }
      } else {
        SI[i * 4] = typeof skin === 'number' ? skin : 0;
        SW[i * 4] = 1;
      }
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  }
  let idx: Uint32Array;
  if (src.index) {
    idx = new Uint32Array(src.index.count);
    for (let i = 0; i < idx.length; i++) idx[i] = src.index.getX(i);
  } else {
    idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // a mirrored node flips the winding
  if (M && M.determinant() < 0) {
    const ix = g.index!.array as Uint32Array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  return g;
}

/** every (geometry, material) primitive of a mesh (multi-material meshes split by group) */
function primitives(mesh: THREE.Mesh): Array<{ g: THREE.BufferGeometry; mat: THREE.Material }> {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const g = mesh.geometry;
  if (Array.isArray(mesh.material) && g.groups.length > 1) {
    return g.groups.map((gr) => {
      const sub = g.clone();
      sub.setIndex(g.index ? new THREE.BufferAttribute((g.index.array as ArrayLike<number> as Uint32Array).slice(gr.start, gr.start + gr.count), 1) : null);
      return { g: sub, mat: mats[gr.materialIndex ?? 0] };
    });
  }
  return [{ g, mat: mats[0] }];
}

/** A static model baked for instancing: opaque parts and alpha-blended parts (null when absent). */
export interface BakedModel {
  opaque: THREE.BufferGeometry | null;
  blend: THREE.BufferGeometry | null;
  /** opacity of the blended parts (the source material's) */
  blendOpacity: number;
  tris: number;
}

/**
 * Bake the meshes under `root` (minus the subtrees named in `exclude`) into space `rel`, with the same
 * vertex layout as the runners (color, aTone). `blendTeam` = team-mask of the alpha-blended parts (a
 * jelly shell takes a little of the crew dye).
 */
export function bakeModel(root: THREE.Object3D, rel: THREE.Object3D, o: { exclude?: string[]; blendTeam?: number } = {}): BakedModel {
  root.updateMatrixWorld(true);
  const inv = rel.matrixWorld.clone().invert();
  const op: THREE.BufferGeometry[] = [], bl: THREE.BufferGeometry[] = [];
  let blendOpacity = 1;
  root.traverse((ob) => {
    const mesh = ob as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (o.exclude && ownerOf(mesh, o.exclude)) return;
    const M = inv.clone().multiply(mesh.matrixWorld);
    for (const p of primitives(mesh)) {
      const blend = (p.mat as THREE.MeshStandardMaterial).transparent === true;
      if (blend) {
        blendOpacity = (p.mat as THREE.MeshStandardMaterial).opacity ?? 1;
        bl.push(bake(p.g, p.mat, M, 'none', 0, null, o.blendTeam ?? 0.6));
      } else op.push(bake(p.g, p.mat, M, 'none', 0, null));
    }
  });
  const merge = (list: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
    if (!list.length) return null;
    const m = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    m?.computeBoundingSphere();
    return m ?? null;
  };
  const opaque = merge(op), blend = merge(bl);
  const tris = [opaque, blend].reduce((s, g) => s + (g ? (g.index?.count ?? 0) / 3 : 0), 0);
  return { opaque, blend, blendOpacity, tris };
}

// ───────────────────────────── kit art (kits + sub + special GLBs) ─────────────────────────────

export interface KitArt {
  /** kit id → its GLB (null when missing: that kit's runners are shown without a kit) */
  kits: Map<string, GLTF | null>;
  jelly: GLTF | null;
  cloud: GLTF | null;
  warnings: string[];
}

function loadGltf(loader: GLTFLoader, file: string): Promise<GLTF> {
  return new Promise((ok, fail) => {
    let url: string;
    try { url = artUrl(file); } catch (e) { fail(e); return; }
    loader.load(url, ok, undefined, (err) => fail(new Error(`failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`)));
  });
}

/**
 * Load every kit GLB (weapons.json kits[].model) plus the sub and special models, each once.
 * `reuse` hands over GLBs already loaded (heroview loads kit_mist_rasp.glb). Never throws: a missing
 * file becomes a warning and a null entry.
 */
export async function loadKitArt(loader: GLTFLoader, reuse: Record<string, GLTF | null> = {}): Promise<KitArt> {
  const warnings: string[] = [];
  const soft = (file: string) => (e: unknown): null => {
    warnings.push(`${file} unavailable (${e instanceof Error ? e.message : String(e)})`);
    return null;
  };
  const byModel = new Map<string, Promise<GLTF | null>>();
  const get = (model: string): Promise<GLTF | null> => {
    let p = byModel.get(model);
    if (!p) {
      p = model in reuse ? Promise.resolve(reuse[model]) : loadGltf(loader, `${model}.glb`).catch(soft(`${model}.glb`));
      byModel.set(model, p);
    }
    return p;
  };
  const kitIds = WEAPONS.kits.map((k) => k.id);
  const kitP = WEAPONS.kits.map((k) => get(k.model || `kit_${k.id.replace(/-/g, '_')}`));
  const subModel = String(WEAPONS.subs.find((s) => s.id === 'jelly-charge')?.model ?? 'sub_jelly_charge');
  const cloudModel = String(WEAPONS.specials.find((s) => s.id === 'cloudburst')?.model ?? 'special_cloudburst');
  const [kits, jelly, cloud] = await Promise.all([Promise.all(kitP), get(subModel), get(cloudModel)]);
  const map = new Map<string, GLTF | null>();
  kitIds.forEach((id, i) => map.set(id, kits[i]));
  for (const g of [...kits, jelly, cloud]) {
    if (!g) continue;
    const drop: THREE.Object3D[] = [];
    g.scene.traverse((o) => { if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) drop.push(o); });
    for (const o of drop) o.parent?.remove(o);
  }
  return { kits: map, jelly, cloud, warnings };
}

// ───────────────────────────── shared clip layers (once per HeroAssets) ─────────────────────────────

interface SplitClip { lower: THREE.AnimationClip; upper: THREE.AnimationClip; duration: number }

interface ClipLayers {
  loco: Record<Loco, SplitClip | null>;
  full: Record<Full, SplitClip | null>;
  over: Record<Over, THREE.AnimationClip | null>;
  stride: number | null;
  runDuration: number;
  crestAnimated: Set<string>;
  warnings: string[];
}

function splitClip(clip: THREE.AnimationClip, upper: Set<string>, tag: string): SplitClip {
  const lo = clip.tracks.filter((t) => !upper.has(trackNode(t)));
  const up = clip.tracks.filter((t) => upper.has(trackNode(t)));
  return {
    lower: new THREE.AnimationClip(`${clip.name}__lo_${tag}`, clip.duration, lo),
    upper: new THREE.AnimationClip(`${clip.name}__up_${tag}`, clip.duration, up),
    duration: clip.duration,
  };
}

const LAYER_CACHE = new WeakMap<HeroAssets, ClipLayers>();

function clipLayers(assets: HeroAssets): ClipLayers {
  const hit = LAYER_CACHE.get(assets);
  if (hit) return hit;
  const scene = assets.hero.scene;
  const warnings: string[] = [];
  const upper = new Set<string>();
  const crestNames = new Set<string>();
  scene.traverse((o) => {
    const n = origName(o);
    if (UPPER_BONES.includes(n)) upper.add(o.name);
    if (CREST_BONES.includes(n)) crestNames.add(o.name);
  });
  const byName = new Map<string, THREE.AnimationClip>();
  for (const c of assets.hero.animations) byName.set(c.name, c);
  const loco = {} as Record<Loco, SplitClip | null>;
  const missing: string[] = [];
  for (const k of LOCO) {
    const names = FALLBACK[k];
    let clip: THREE.AnimationClip | null = null;
    for (const n of names) { const c = byName.get(n); if (c) { clip = c; break; } }
    if (!byName.has(names[0])) missing.push(k);
    loco[k] = clip ? splitClip(clip, upper, k) : null;
  }
  const full = {} as Record<Full, SplitClip | null>;
  for (const k of FULL) {
    const c = byName.get(k);
    if (!c) missing.push(k);
    full[k] = c ? splitClip(c, upper, k) : null;
  }
  const over = {} as Record<Over, THREE.AnimationClip | null>;
  for (const k of OVER) {
    let c = byName.get(k) ?? null;
    if (!c) {
      missing.push(k);
      c = k === 'aim' ? byName.get('brush') ?? null : k === 'charge' || k === 'blast' ? byName.get('aim') ?? null : null;
    }
    over[k] = c ? splitClip(c, upper, `ov_${k}`).upper : null;
  }
  if (missing.length) warnings.push(`tide_runner.glb lacks clip(s) ${missing.join(', ')} — using fallbacks`);
  const crestAnimated = new Set<string>();
  for (const c of assets.hero.animations) for (const t of c.tracks) { const n = trackNode(t); if (crestNames.has(n)) crestAnimated.add(n); }
  const layers: ClipLayers = {
    loco, full, over, crestAnimated, warnings, stride: assets.stride, runDuration: byName.get('run')?.duration ?? 0.8,
  };
  LAYER_CACHE.set(assets, layers);
  return layers;
}

// ───────────────────────────── per-kit runner geometry ─────────────────────────────

export interface RunnerKit {
  /** weapons.json kit id this body carries ('' = no kit) */
  kitId: string;
  fire: KitFireType;
  /** the kit has a `grip_L` (roller / charger): the upper base layer is `hold_two` */
  twoHanded: boolean;
  body: THREE.BufferGeometry;
  fin: THREE.BufferGeometry;
  fillMin: number; fillMax: number;
  /** hand.R local → muzzle (null without a kit) */
  muzzleInHand: THREE.Matrix4 | null;
  /** hand.R local → scope (NEEDLE-GLINT glint origin), null when the kit has none */
  scopeInHand: THREE.Matrix4 | null;
  /** hand.R local → grip_L (two-handed kits; the left-hand target) */
  gripInHand: THREE.Matrix4 | null;
  /** SHEET-DRUM drum: bind-space axis point + unit direction (vertex spin), axis in hand space, radius */
  drum: { p: THREE.Vector3; d: THREE.Vector3; axisInHand: THREE.Vector3; radius: number } | null;
  loco: Record<Loco, SplitClip | null>;
  full: Record<Full, SplitClip | null>;
  over: Record<Over, THREE.AnimationClip | null>;
  /** legacy (phase 5): the aim upper layer */
  aimUpper: THREE.AnimationClip | null;
  stride: number | null;
  runDuration: number;
  crestAnimated: Set<string>;
  bodyTris: number; finTris: number;
  warnings: string[];
}

/**
 * Bake the shared merged geometry for ONE kit (default: the hero's MIST-RASP from HeroAssets) + the
 * clip layers. Call once per (HeroAssets, kit).
 */
export function prepareRunnerKit(assets: HeroAssets, kitIn?: { id: string; gltf: GLTF | null }): RunnerKit {
  const layers = clipLayers(assets);
  const warnings: string[] = [...layers.warnings];
  const kitId = kitIn?.id ?? 'mist-rasp';
  const kitGltf = kitIn ? kitIn.gltf : assets.kit;
  const scene = assets.hero.scene;
  scene.updateMatrixWorld(true);

  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
  const bodyParts = skinned.filter((m) => ownerOf(m, ['tide_runner']) === 'tide_runner');
  const tankParts = skinned.filter((m) => ownerOf(m, ['tank_dye']) === 'tank_dye');
  const finParts = skinned.filter((m) => ownerOf(m, ['slick_fin']) === 'slick_fin');
  const ref = bodyParts[0] ?? skinned[0];
  if (!ref) throw new Error('tide_runner.glb has no skinned mesh');
  const refBones = ref.skeleton.bones;
  const refInv = ref.bindMatrix.clone().invert();

  const remapFor = (m: THREE.SkinnedMesh): Int32Array | null => {
    const b = m.skeleton.bones;
    if (b.length === refBones.length && b.every((x, i) => origName(x) === origName(refBones[i]))) return null;
    const map = new Int32Array(b.length);
    for (let i = 0; i < b.length; i++) map[i] = Math.max(0, refBones.findIndex((r) => origName(r) === origName(b[i])));
    return map;
  };
  const toRef = (m: THREE.SkinnedMesh): THREE.Matrix4 | null => {
    const M = refInv.clone().multiply(m.bindMatrix);
    return M.equals(new THREE.Matrix4()) ? null : M;
  };

  const pieces: THREE.BufferGeometry[] = [];
  for (const m of [...bodyParts, ...tankParts]) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const mat = mats[0];
    if (!mat || DROP_MATS.has(mat.name)) continue;
    const flag = tankParts.includes(m) ? PART_TANK : PART_BODY;
    pieces.push(bake(m.geometry, mat, toRef(m), 'keep', flag, remapFor(m)));
  }

  // ── the kit, baked into bind space and weighted to hand.R through socket_weapon
  let muzzleInHand: THREE.Matrix4 | null = null;
  let scopeInHand: THREE.Matrix4 | null = null;
  let gripInHand: THREE.Matrix4 | null = null;
  let drum: RunnerKit['drum'] = null;
  const hand = findByOrigName(scene, 'hand.R');
  const socket = findByOrigName(scene, 'socket_weapon') ?? hand;
  const handIdx = hand ? refBones.findIndex((b) => b === hand || origName(b) === 'hand.R') : -1;
  const file = `${WEAPONS.kits.find((k) => k.id === kitId)?.model ?? kitId}.glb`;
  if (kitGltf && hand && socket && handIdx >= 0) {
    const kitScene = kitGltf.scene;
    kitScene.updateMatrixWorld(true);
    const S = hand.matrixWorld.clone().invert().multiply(socket.matrixWorld);            // hand → socket
    const handBind = ref.skeleton.boneInverses[handIdx].clone().invert();                // hand world @ bind
    const pre = refInv.clone().multiply(handBind).multiply(S);                           // socket space → bind space
    kitScene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const M = pre.clone().multiply(mesh.matrixWorld);
      const flag = ownerOf(mesh, ['drum', 'drum_roller']) ? PART_DRUM : PART_KIT;
      for (const p of primitives(mesh)) pieces.push(bake(p.g, p.mat, M, handIdx, flag, null));
    });
    const node = (n: string): THREE.Matrix4 | null => {
      const o = findByOrigName(kitScene, n);
      return o ? S.clone().multiply(o.matrixWorld) : null;
    };
    muzzleInHand = node('muzzle');
    scopeInHand = node('scope');
    gripInHand = node('grip_L');
    if (!muzzleInHand) warnings.push(`${file} has no \`muzzle\` node — muzzle FX use the hand`);
    const drumNode = findByOrigName(kitScene, 'drum');
    if (drumNode) {
      const ex = drumNode.userData ?? {};
      const ax = Array.isArray(ex.df_spin_axis) && ex.df_spin_axis.length === 3 ? ex.df_spin_axis as number[] : [1, 0, 0];
      const radius = typeof ex.df_radius === 'number' && ex.df_radius > 0.02 ? ex.df_radius : 0.16;
      const Mb = pre.clone().multiply(drumNode.matrixWorld);
      const p = new THREE.Vector3().setFromMatrixPosition(Mb);
      const d = new THREE.Vector3(ax[0], ax[1], ax[2]).transformDirection(Mb);
      const axisInHand = new THREE.Vector3(ax[0], ax[1], ax[2]).transformDirection(S.clone().multiply(drumNode.matrixWorld));
      drum = { p, d, axisInHand, radius };
    }
  } else if (kitIn && !kitGltf) {
    warnings.push(`${file} unavailable — ${kitId} runners are shown without the kit`);
  } else if (kitGltf) {
    warnings.push('hero has no hand.R / socket_weapon — the kit is not merged');
  }
  const body = mergeGeometries(pieces, false);
  if (!body) throw new Error('merging the hero primitives failed (attribute layouts differ)');
  for (const p of pieces) p.dispose();
  body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.62, 0), 1.6);
  body.boundingBox = new THREE.Box3(new THREE.Vector3(-1.6, -0.2, -1.6), new THREE.Vector3(1.6, 2.2, 1.6));
  const bodyTris = (body.index?.count ?? 0) / 3;

  // ── the slick fin: static (it is weighted 100 % to root)
  const finPieces: THREE.BufferGeometry[] = [];
  for (const m of finParts) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats[0]) continue;
    finPieces.push(bake(m.geometry, mats[0], toRef(m), 'none', PART_BODY, null));
  }
  let fin: THREE.BufferGeometry;
  if (finPieces.length) {
    fin = mergeGeometries(finPieces, false) ?? new THREE.BufferGeometry();
    for (const p of finPieces) p.dispose();
  } else {
    warnings.push('tide_runner.glb has no slick_fin — SLICK shows a stand-in fin');
    fin = bake(new THREE.ConeGeometry(0.16, 0.34, 6).translate(0, 0.17, 0), new THREE.MeshStandardMaterial({ name: 'M_crest' }), null, 'none', 0, null);
  }
  fin.computeBoundingSphere();

  return {
    kitId, fire: kitFireType(kitId), twoHanded: !!gripInHand,
    body, fin, muzzleInHand, scopeInHand, gripInHand, drum,
    loco: layers.loco, full: layers.full, over: layers.over, aimUpper: layers.over.aim,
    crestAnimated: layers.crestAnimated, warnings,
    fillMin: numberExtra(scene, 'tank_dye', 'df_fill_min', 0.474),
    fillMax: numberExtra(scene, 'tank_dye', 'df_fill_max', 0.638),
    stride: layers.stride,
    runDuration: layers.runDuration,
    bodyTris, finTris: (fin.index?.count ?? fin.getAttribute('position').count) / 3,
  };
}

function numberExtra(root: THREE.Object3D, node: string, key: string, fallback: number): number {
  const o = findByOrigName(root, node);
  const v = o?.userData?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ───────────────────────────── the runner material ─────────────────────────────

interface RunnerUniforms {
  uTeam: { value: THREE.Color };
  uTankY: { value: number };
  uFlash: { value: number };
  uRim: { value: number };
  uGlow: { value: number };
  /** SHEET-DRUM drum spin (rad) about uDrumP + t·uDrumD (bind space) */
  uSpin: { value: number };
  uDrumP: { value: THREE.Vector3 };
  uDrumD: { value: THREE.Vector3 };
}

function runnerMaterial(team: TeamId, u: RunnerUniforms, skinned: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0 });
  m.name = skinned ? `runner_team${team}` : `runner_fin_team${team}`;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTone;\nvarying vec4 vTone;\nvarying float vBindY;\n'
        + 'uniform float uSpin;\nuniform vec3 uDrumP;\nuniform vec3 uDrumD;\n'
        + 'vec3 dfSpin(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nif (aTone.w > 2.5) objectNormal = dfSpin(objectNormal, uDrumD, uSpin);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTone = aTone;\nvBindY = position.y;\n'
        + 'if (aTone.w > 2.5) transformed = uDrumP + dfSpin(transformed - uDrumP, uDrumD, uSpin);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTeam;\nuniform float uTankY;\nuniform float uFlash;\nuniform float uRim;\nuniform float uGlow;\nvarying vec4 vTone;\nvarying float vBindY;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n'
        + 'if (vTone.w > 0.5 && vTone.w < 1.5 && vBindY > uTankY) discard;\n'
        + 'diffuseColor.rgb *= mix(vec3(1.0), uTeam, vTone.x);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vTone.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vTone.z;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n'
        + 'totalEmissiveRadiance += uFlash * vec3(1.0, 0.96, 0.9) + vTone.x * uTeam * uGlow;')
      .replace('#include <opaque_fragment>',
        '{ float fr = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);\n'
        + '  outgoingLight += uRim * fr * fr * fr * mix(vec3(1.0), uTeam, 0.55); }\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'df-runner-v2';
  return m;
}

// ───────────────────────────── one runner ─────────────────────────────

export interface RunnerFrame {
  x: number; y: number; z: number; yaw: number;
  speed: number; vx: number; vz: number; vy: number;
}

interface FullActions { lo: THREE.AnimationAction; up: THREE.AnimationAction; dur: number }

class RunnerView {
  readonly id: number;
  readonly team: TeamId;
  readonly name: string;
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly body: THREE.SkinnedMesh;
  readonly fin: THREE.Mesh;
  readonly mixer: THREE.AnimationMixer;
  readonly tag: HTMLElement;
  readonly u: RunnerUniforms;
  readonly kit: RunnerKit;
  baseRole: Loco = 'idle';
  aimW = 0;
  /** layer weights (debug read-back) */
  rollW = 0; slamW = 0; holdW = 0; contW = 0; oneW = 0;
  one: OneShot | null = null;
  /** animation: slow far runners */
  private animAcc = 0;
  private readonly lowerA = new Map<Loco, THREE.AnimationAction>();
  private readonly upperA = new Map<Loco, THREE.AnimationAction>();
  private readonly fullA = new Map<Full, FullActions>();
  private readonly overA = new Map<Over, THREE.AnimationAction>();
  private readonly contClip: Over | null;
  private readonly w: Record<Loco, number> = { idle: 1, run: 0, back: 0, strafe_l: 0, strafe_r: 0, jump: 0, fall: 0, land: 0, victory: 0 };
  private readonly t: Record<Loco, number> = { idle: 0, run: 0, back: 0, strafe_l: 0, strafe_r: 0, jump: 0, fall: 0, land: 0, victory: 0 };
  /** [bone, pitch share, twist share] of the aim bend (no per-frame arrays) */
  private readonly bend: Array<[THREE.Object3D, number, number]> = [];
  /** post-mixer (un-bent) quaternions of every bone the view edits after the mixer */
  private readonly edited: Array<[THREE.Object3D, THREE.Quaternion]> = [];
  private lastJumps = 0;
  private lastLandings = 0;
  private jumpT = 99;
  private landT = 99;
  private airT = 0;
  private maxAir = 0;
  private airborneByJump = false;
  private fireHold = 0;
  private oneT = 99;
  private oneDur = 0.5;
  slamT = 99;
  private slamDur = 1.1;
  private readonly crest: Array<{ bone: THREE.Object3D; rest: THREE.Quaternion; animated: boolean }> = [];
  private crestPitch = 0; private crestPitchV = 0; private crestSway = 0; private crestSwayV = 0;
  private readonly spine: THREE.Object3D | null;
  private readonly chest: THREE.Object3D | null;
  private readonly neck: THREE.Object3D | null;
  readonly hand: THREE.Object3D | null;
  readonly handL: THREE.Object3D | null;
  private lastYaw = NaN;
  yawRate = 0;
  // life-cycle visuals
  alive = true;
  washT = 99;           // since washed (s)
  dropT = 99;           // since respawn (s)
  finWas = false;
  finBob = 0;
  /** map mist (CONTRACT_P6_11 §19): 1 = fin shown, 0 = sunk out of sight; eased so a slicker fades, not pops */
  mistK = 1;
  wakeAcc = 0;
  rippleAcc = 0;
  sprayAcc = 0;
  trailAcc = 0;
  landedDrop = true;
  victory = false;
  tagOn = false;
  // scratch
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly q3 = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly axis = new THREE.Vector3();

  constructor(assets: HeroAssets, kit: RunnerKit, id: number, team: TeamId, name: string, tagHost: HTMLElement | null) {
    this.id = id; this.team = team; this.name = name; this.kit = kit;
    this.root.name = `runner_${id}`;
    this.model = SkeletonUtils.clone(assets.hero.scene);
    this.model.traverse((o) => { if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) o.visible = false; });
    // find the skeleton, drop the original meshes (16 primitives → 1 merged skinned mesh)
    const drop: THREE.Object3D[] = [];
    const skins: THREE.SkinnedMesh[] = [];
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skins.push(o as THREE.SkinnedMesh);
      if ((o as THREE.Mesh).isMesh) drop.push(o);
    });
    const refMesh: THREE.SkinnedMesh | null = skins.find((m) => ownerOf(m, ['tide_runner']) === 'tide_runner') ?? skins[0] ?? null;
    if (!refMesh) throw new Error('hero clone has no skinned mesh');
    const parent = refMesh.parent ?? this.model;
    // the original tide_runner Group (multi-primitive) may be the parent: attach to ITS parent
    const holder = ownerOf(refMesh, ['tide_runner']) && parent !== this.model && origName(parent) === 'tide_runner' ? (parent.parent ?? this.model) : parent;

    const col = new THREE.Color(teamById(team).dye);
    this.u = {
      uTeam: { value: col }, uTankY: { value: kit.fillMax }, uFlash: { value: 0 }, uRim: { value: 0.22 }, uGlow: { value: 0.05 },
      uSpin: { value: 0 }, uDrumP: { value: kit.drum ? kit.drum.p.clone() : new THREE.Vector3() }, uDrumD: { value: kit.drum ? kit.drum.d.clone() : new THREE.Vector3(1, 0, 0) },
    };
    this.body = new THREE.SkinnedMesh(kit.body, runnerMaterial(team, this.u, true));
    this.body.name = `runner_body_${id}`;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    holder.add(this.body);
    this.body.bind(refMesh.skeleton, refMesh.bindMatrix);
    for (const o of drop) o.removeFromParent();

    this.fin = new THREE.Mesh(kit.fin, runnerMaterial(team, this.u, false));
    this.fin.name = `runner_fin_${id}`;
    this.fin.castShadow = true;
    this.fin.receiveShadow = false;
    this.fin.visible = false;
    this.root.add(this.model, this.fin);

    for (const n of CREST_BONES) {
      const b = findByOrigName(this.model, n);
      if (b) {
        this.crest.push({ bone: b, rest: b.quaternion.clone(), animated: kit.crestAnimated.has(b.name) });
        this.edited.push([b, b.quaternion.clone()]);
      }
    }
    this.spine = findByOrigName(this.model, 'spine');
    this.chest = findByOrigName(this.model, 'chest');
    this.neck = findByOrigName(this.model, 'neck');
    this.hand = findByOrigName(this.model, 'hand.R');
    this.handL = findByOrigName(this.model, 'hand.L');
    if (this.spine) this.bend.push([this.spine, 0.35, 0.5]);
    if (this.chest) this.bend.push([this.chest, 0.45, 0.5]);
    if (this.neck) this.bend.push([this.neck, 0.2, 0]);
    for (const [b] of this.bend) this.edited.push([b, b.quaternion.clone()]);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const k of LOCO) {
      const c = kit.loco[k];
      if (!c) continue;
      const lo = this.mixer.clipAction(c.lower), up = this.mixer.clipAction(c.upper);
      this.lowerA.set(k, lo); this.upperA.set(k, up);
      if (k === 'jump' || k === 'land') for (const a of [lo, up]) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    for (const k of FULL) {
      const c = kit.full[k];
      if (!c) continue;
      const lo = this.mixer.clipAction(c.lower), up = this.mixer.clipAction(c.upper);
      if (k === 'slam') for (const a of [lo, up]) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.fullA.set(k, { lo, up, dur: c.duration });
    }
    if (kit.full.slam) this.slamDur = kit.full.slam.duration;
    for (const k of OVER) {
      const c = kit.over[k];
      if (!c) continue;
      const a = this.mixer.clipAction(c);
      if ((ONE_SHOTS as readonly string[]).includes(k)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.overA.set(k, a);
    }
    this.contClip = kit.fire === 'charge' ? 'charge' : kit.fire === 'roll' ? null : 'aim';
    for (const a of [...this.lowerA.values(), ...this.upperA.values()]) { a.enabled = true; a.setEffectiveWeight(0); a.play(); }
    const roll = this.fullA.get('roll');
    if (roll) for (const a of [roll.lo, roll.up]) a.setEffectiveWeight(0).play();
    for (const k of ['aim', 'hold_two', 'charge'] as const) this.overA.get(k)?.setEffectiveWeight(0).play();
    this.holdW = kit.twoHanded ? 1 : 0;
    this.applyWeights();
    this.mixer.update(0);

    // name tag
    this.tag = document.createElement('div');
    this.tag.className = `df-tag ${team === 2 ? 'gulf' : 'sun'}`;
    const mk = document.createElement('i');
    mk.textContent = teamById(team).markGlyph;
    mk.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('span');
    nm.textContent = name;
    this.tag.append(mk, nm);
    this.tag.hidden = true;
    tagHost?.append(this.tag);
  }

  /** start an upper one-shot (restarts it when already playing) */
  playOne(k: OneShot): void {
    const a = this.overA.get(k);
    if (!a) return;
    if (this.one && this.one !== k) this.overA.get(this.one)?.setEffectiveWeight(0);
    a.reset(); a.setEffectiveWeight(0); a.play();
    this.one = k;
    this.oneT = 0;
    this.oneDur = Math.max(0.2, a.getClip().duration);
  }

  /** WELLSPRING: the full-body leap + slam (the sim leap is 0.6 s; the clip slams at ≈ 0.7 s) */
  playSlam(): void {
    const s = this.fullA.get('slam');
    if (!s) return;
    for (const a of [s.lo, s.up]) { a.reset(); a.timeScale = 1.15; a.play(); }
    this.slamT = 0;
    this.slamDur = s.dur / 1.15;
  }

  cancelActions(): void {
    this.slamT = 99; this.oneT = 99; this.one = null; this.oneW = 0; this.slamW = 0; this.rollW = 0; this.contW = 0; this.aimW = 0;
    this.fireHold = 0;
  }

  /** feed from the sim + interpolation */
  animate(dt: number, r: RunnerLike, f: RunnerFrame, far: boolean): void {
    // events from counters
    if (r.jumps !== this.lastJumps) { this.lastJumps = r.jumps; this.jumpT = 0; this.airborneByJump = true; this.restart('jump'); }
    if (r.landings !== this.lastLandings) {
      this.lastLandings = r.landings;
      if (this.maxAir > 0.22) { this.landT = 0; this.restart('land'); }
      this.airborneByJump = false; this.maxAir = 0;
    }
    if (!r.grounded) { this.airT += dt; this.maxAir = Math.max(this.maxAir, this.airT); } else this.airT = 0;
    this.jumpT += dt; this.landT += dt; this.oneT += dt; this.slamT += dt;
    if (!Number.isFinite(this.lastYaw)) this.lastYaw = f.yaw;
    if (dt > 0) {
      const d = angleDelta(this.lastYaw, f.yaw);
      this.yawRate += (d / dt - this.yawRate) * (1 - Math.exp(-10 * dt));
    }
    this.lastYaw = f.yaw;
    this.fireHold = r.firing ? 0.35 : Math.max(0, this.fireHold - dt);

    if (!this.model.visible) return;
    // far runners: 30 Hz animation
    this.animAcc += dt;
    if (far && this.animAcc < 1 / 30) return;
    const adt = Math.min(0.1, this.animAcc);
    this.animAcc = 0;

    // ── target weights
    const t = this.t;
    for (const n of LOCO) t[n] = 0;
    const jumpDur = this.kit.loco.jump?.duration ?? 0.3;
    const landDur = this.kit.loco.land?.duration ?? 0.25;
    const air = !r.grounded && (this.airborneByJump || this.airT > 0.12) && r.state !== 'wallslick';
    if (this.victory) t.victory = 1;
    else if (air) {
      if (this.airborneByJump && this.jumpT < jumpDur && f.vy > -1.5) t.jump = 1; else t.fall = 1;
    } else {
      const s = f.speed;
      const mv = smoothstep(0.35, 2.2, s);
      const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
      const fwd = f.vx * sy + f.vz * cy;
      const rgt = -f.vx * cy + f.vz * sy;
      const sum = Math.abs(fwd) + Math.abs(rgt);
      if (sum > 0.05) {
        t.run = mv * Math.max(0, fwd) / sum;
        t.back = mv * Math.max(0, -fwd) / sum;
        t.strafe_r = mv * Math.max(0, rgt) / sum;
        t.strafe_l = mv * Math.max(0, -rgt) / sum;
      } else t.run = mv;
      t.idle = 1 - mv;
      if (this.kit.loco.land && this.landT < landDur) {
        const lw = (1 - this.landT / landDur) * (1 - 0.75 * mv);
        for (const k of LOCO) t[k] *= 1 - lw;
        t.land = lw;
      }
    }
    const rate = air || t.land > 0 ? 22 : 12;
    const k = 1 - Math.exp(-rate * adt);
    let best: Loco = 'idle', bw = -1;
    for (const n of LOCO) {
      this.w[n] += (t[n] - this.w[n]) * k;
      if (this.w[n] > bw) { bw = this.w[n]; best = n; }
    }
    this.baseRole = best;

    // ── kit layers
    const ease = (w: number, target: number, rateHz: number): number => {
      const v = w + (target - w) * (1 - Math.exp(-rateHz * adt));
      return Math.abs(v - target) < 1e-3 ? target : v;
    };
    const rolling = !!r.rolling && this.fullA.has('roll') && !this.victory;
    this.rollW = ease(this.rollW, rolling ? 1 : 0, 14);
    // slam: fade in 0.05 s, hold, fade out over the last 0.18 s of the clip
    const sd = this.slamDur;
    this.slamW = this.slamT < sd ? Math.min(1, this.slamT / 0.05) * Math.min(1, (sd - this.slamT) / 0.18) : 0;
    this.holdW = ease(this.holdW, this.kit.twoHanded && !this.victory ? 1 : 0, 8);
    const cont = this.contClip && this.fireHold > 0 && !this.victory && !rolling ? 1 : 0;
    this.contW = ease(this.contW, cont, 16);
    // one-shot: fade in 0.06 s, out over its last 0.18 s
    if (this.one) {
      const od = this.oneDur;
      this.oneW = this.oneT < od ? Math.min(1, this.oneT / 0.06) * Math.min(1, (od - this.oneT) / 0.18) : 0;
      if (this.oneT >= od) { this.overA.get(this.one)?.setEffectiveWeight(0); this.one = null; this.oneW = 0; }
    } else this.oneW = 0;
    // the aim bend follows the aim-type overlays (aim / charge / blast)
    const bendT = Math.max(this.contW, this.one === 'blast' ? this.oneW : 0) * (1 - this.slamW);
    this.aimW = bendT < 1e-3 ? 0 : bendT;

    // ── playback speed
    const v = Math.max(1.2, f.speed);
    const runTs = this.kit.stride ? (v / this.kit.stride) * this.kit.runDuration : v / MOVE.walk;
    const walkTs = clamp(v / MOVE.walk, 0.5, 2.2);
    this.speedScale('run', clamp(runTs, 0.5, 2.2));
    this.speedScale('back', walkTs);
    this.speedScale('strafe_l', walkTs);
    this.speedScale('strafe_r', walkTs);
    const roll = this.fullA.get('roll');
    if (roll) { const ts = clamp(f.speed / 4.4, 0.55, 1.6); roll.lo.timeScale = ts; roll.up.timeScale = ts; }
    this.applyWeights();
    // restore the bones edited after the last mixer pass (see header), then mix, then re-edit
    for (const [b, q] of this.edited) b.quaternion.copy(q);
    this.mixer.update(adt);
    for (const [b, q] of this.edited) q.copy(b.quaternion);
    this.poseLayers(adt, r, f);
  }

  private speedScale(n: Loco, sc: number): void {
    const lo = this.lowerA.get(n); if (lo) lo.timeScale = sc;
    const up = this.upperA.get(n); if (up) up.timeScale = sc;
  }

  private restart(k: Loco): void {
    for (const a of [this.lowerA.get(k), this.upperA.get(k)]) if (a) { a.reset(); a.play(); }
  }

  /** compose the layer weights so every bone group sums to 1 (see header) */
  private applyWeights(): void {
    let sum = 0;
    for (const n of LOCO) sum += this.w[n];
    const inv = sum > 1e-6 ? 1 / sum : 0;
    const Fs = this.fullA.has('slam') ? this.slamW : 0;
    const Fr = this.rollW * (1 - Fs);
    const F = Fs + Fr;
    const H = this.overA.has('hold_two') ? this.holdW : 0;
    const one = this.oneW * (1 - Fs);
    const cont = (this.contClip && this.overA.has(this.contClip) ? this.contW : 0) * (1 - this.oneW) * (1 - Fs);
    const O = one + cont;
    const base = 1 - O;
    for (const n of LOCO) {
      const wn = sum > 1e-6 ? this.w[n] * inv : (n === 'idle' ? 1 : 0);
      this.lowerA.get(n)?.setEffectiveWeight(wn * (1 - F));
      this.upperA.get(n)?.setEffectiveWeight(wn * (1 - F) * (1 - H) * base);
    }
    this.overA.get('hold_two')?.setEffectiveWeight((1 - F) * H * base);
    const roll = this.fullA.get('roll');
    if (roll) { roll.lo.setEffectiveWeight(Fr); roll.up.setEffectiveWeight(Fr * base); }
    const slam = this.fullA.get('slam');
    if (slam) { slam.lo.setEffectiveWeight(Fs); slam.up.setEffectiveWeight(Fs); }
    if (this.contClip) this.overA.get(this.contClip)?.setEffectiveWeight(cont);
    for (const k of ONE_SHOTS) this.overA.get(k)?.setEffectiveWeight(k === this.one ? one : 0);
  }

  /** aim pitch / twist on spine-chest-neck (about world axes), then the crest spring */
  private poseLayers(dt: number, r: RunnerLike, f: RunnerFrame): void {
    const aw = this.aimW;
    if (aw > 0.01 && this.spine && this.chest) {
      // the aim clip already holds the kit forward; the bend only has to carry the rest of the pitch,
      // and a floor-painting stream (−30° and below) should not fold the runner over its kit
      const pitch = clamp(r.aimPitch, -0.55, 0.7) * 0.6 * aw;
      const twist = clamp(angleDelta(f.yaw, r.aimYaw), -0.7, 0.7) * aw;
      this.root.updateMatrixWorld(false);
      // right axis of the runner (forward = +Z local → right = −X local), in world space
      this.axis.set(-Math.cos(f.yaw), 0, Math.sin(f.yaw));
      for (const [bone, kp, kt] of this.bend) {
        if (!bone.parent) continue;
        bone.parent.updateWorldMatrix(true, false);
        bone.parent.getWorldQuaternion(this.q2);
        // world rotation: twist about +Y, then pitch about the runner's right axis
        this.q.setFromAxisAngle(this.axis, pitch * kp);
        if (kt) { this.q3.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, twist * kt); this.q.multiply(this.q3); }
        this.q3.copy(this.q2).invert().multiply(this.q).multiply(this.q2);
        bone.quaternion.premultiply(this.q3);
      }
    }
    // crest spring
    if (!this.crest.length || dt <= 0) return;
    const targetPitch = clamp(-f.vy * 0.045 + f.speed * 0.012, -0.35, 0.35);
    const targetSway = clamp(-this.yawRate * 0.06, -0.4, 0.4);
    const K = 90, D = 12;
    this.crestPitchV += (K * (targetPitch - this.crestPitch) - D * this.crestPitchV) * dt;
    this.crestPitch += this.crestPitchV * dt;
    this.crestSwayV += (K * (targetSway - this.crestSway) - D * this.crestSwayV) * dt;
    this.crestSway += this.crestSwayV * dt;
    for (let i = 0; i < this.crest.length; i++) {
      const c = this.crest[i];
      const fr = (i + 1) / this.crest.length;
      this.e.set(this.crestPitch * fr, 0, this.crestSway * fr);
      this.q.setFromEuler(this.e);
      if (c.animated) c.bone.quaternion.multiply(this.q);
      else c.bone.quaternion.copy(c.rest).multiply(this.q);
    }
  }

  /** layer summary (debug panel) */
  describe(): string {
    const parts: string[] = [this.baseRole];
    if (this.rollW > 0.05) parts.push(`roll ${(this.rollW * 100).toFixed(0)}%`);
    if (this.slamW > 0.05) parts.push(`slam ${(this.slamW * 100).toFixed(0)}%`);
    if (this.holdW > 0.05) parts.push('hold_two');
    if (this.contW > 0.05 && this.contClip) parts.push(`${this.contClip} ${(this.contW * 100).toFixed(0)}%`);
    if (this.one && this.oneW > 0.05) parts.push(`${this.one} ${(this.oneW * 100).toFixed(0)}%`);
    return parts.join(' + ');
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    (this.body.material as THREE.Material).dispose();
    (this.fin.material as THREE.Material).dispose();
    this.tag.remove();
  }
}

// ───────────────────────────── all runners ─────────────────────────────

export interface PlayersFrameOpts {
  alpha: number;
  camera: THREE.PerspectiveCamera;
  /** the viewer's team (tags, hidden-enemy rule) */
  viewerTeam: TeamId;
  /** the viewer's runner id (no tag over it) */
  viewerId: number;
  /** is this enemy currently seen by the viewer's crew (tags, fin visibility of hidden slickers) */
  seen: (id: number) => boolean;
  /** CSS px size of the view (tags) */
  width: number; height: number;
  /** match over → winners play victory */
  winner: TeamId | null;
  /** CHANGED(INTEGRATE): world.mistRange (m, Infinity = no mist). Mist hides every SLICK enemy the crew can't see
   *  (MatchWorld.canSee drops slickers beyond it, moving or not): the fin sinks away over 0.2 s and leaves no wake */
  mistRange?: number;
}

export class PlayerViews {
  readonly root = new THREE.Group();
  /** the human's (runner 0) kit geometry — legacy single-kit handle */
  readonly kit: RunnerKit;
  readonly kits: Map<string, RunnerKit>;
  readonly views: RunnerView[] = [];
  private readonly fx: Fx | null;
  private readonly tagHost: HTMLElement | null;
  private readonly frames: RunnerFrame[] = [];
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private time = 0;

  constructor(assets: HeroAssets, roster: ReadonlyArray<{ id: number; name: string; team: TeamId; kit?: string }>, fx: Fx | null,
    tagHost: HTMLElement | null, kits?: RunnerKit | Map<string, RunnerKit>) {
    if (kits instanceof Map) this.kits = kits;
    else {
      this.kits = new Map();
      const k = kits ?? prepareRunnerKit(assets);
      this.kits.set(k.kitId, k);
    }
    const fallback = (): RunnerKit => {
      let k = this.kits.get('mist-rasp') ?? this.kits.values().next().value;
      if (!k) { k = prepareRunnerKit(assets); this.kits.set(k.kitId, k); }
      return k;
    };
    const kitFor = (id: string | undefined): RunnerKit => (id && this.kits.get(id)) || fallback();
    this.kit = kitFor(roster[0]?.kit);
    this.fx = fx;
    this.root.name = 'runners';
    if (tagHost) {
      const box = document.createElement('div');
      box.className = 'df-tags';
      tagHost.append(box);
      this.tagHost = box;
    } else this.tagHost = null;
    for (const e of roster) {
      const rv = new RunnerView(assets, kitFor(e.kit), e.id, e.team, e.name, this.tagHost);
      this.views.push(rv);
      this.root.add(rv.root);
      this.frames.push({ x: 0, y: 0, z: 0, yaw: 0, speed: 0, vx: 0, vz: 0, vy: 0 });
    }
  }

  get warnings(): string[] {
    const out = new Set<string>();
    for (const k of this.kits.values()) for (const w of k.warnings) out.add(w);
    return [...out];
  }

  view(id: number): RunnerView | undefined { return this.views[id]; }

  /** interpolated render pose of runner i (after update()) */
  frame(i: number): RunnerFrame { return this.frames[i]; }

  /** extra visual height of the respawn drop for runner i (camera follows it) */
  dropOffset(i: number): number {
    const rv = this.views[i];
    if (!rv || rv.dropT >= 0.6) return 0;
    const k = rv.dropT / 0.6;
    return 3.4 * (1 - k * k);
  }

  // ── events (drained by game.ts)
  onWashed(id: number): void {
    const rv = this.views[id];
    if (!rv) return;
    rv.washT = 0;
    rv.alive = false;
    rv.cancelActions();
  }

  onRespawn(id: number): void {
    const rv = this.views[id];
    if (!rv) return;
    rv.alive = true;
    rv.washT = 99;
    rv.dropT = 0;
    rv.landedDrop = false;
    rv.cancelActions();
  }

  onHit(id: number): void {
    const rv = this.views[id];
    if (rv) rv.u.uFlash.value = 0.9;
  }

  /** SHEET-DRUM flick windup started */
  onFlick(id: number): void { this.views[id]?.playOne('flick'); }
  /** POP-WELL burst fired */
  onBlast(id: number): void { this.views[id]?.playOne('blast'); }
  /** JELLY CHARGE thrown */
  onThrow(id: number): void { this.views[id]?.playOne('throw'); }
  /** a special started: CLOUDBURST = the big two-handed toss, WELLSPRING = the full-body leap + slam */
  onSpecialStart(id: number, specialId: string): void {
    const rv = this.views[id];
    if (!rv) return;
    if (specialId === 'wellspring') rv.playSlam();
    else rv.playOne('special_throw');
  }

  private kitPoint(i: number, which: 'muzzle' | 'scope' | 'grip', out: THREE.Vector3): boolean {
    const rv = this.views[i];
    if (!rv || !rv.hand || !rv.model.visible) return false;
    rv.hand.updateWorldMatrix(true, false);
    const k = rv.kit;
    const local = which === 'scope' ? (k.scopeInHand ?? k.muzzleInHand) : which === 'grip' ? k.gripInHand : k.muzzleInHand;
    if (which === 'grip' && !local) return false;
    if (local) this.m.multiplyMatrices(rv.hand.matrixWorld, local);
    else this.m.copy(rv.hand.matrixWorld);
    out.setFromMatrixPosition(this.m);
    return true;
  }

  /** world position of runner i's muzzle (hand + kit muzzle), false when unavailable */
  muzzle(i: number, out: THREE.Vector3): boolean { return this.kitPoint(i, 'muzzle', out); }

  /** world position of runner i's scope (NEEDLE-GLINT glint origin; the muzzle for other kits) */
  scope(i: number, out: THREE.Vector3): boolean { return this.kitPoint(i, 'scope', out); }

  /** two-handed kits: distance (m) from the left hand to the kit's grip_L in the current pose, or null */
  gripError(i: number): number | null {
    const rv = this.views[i];
    if (!rv || !rv.handL || !this.kitPoint(i, 'grip', this.v2)) return null;
    rv.handL.updateWorldMatrix(true, false);
    this.v.setFromMatrixPosition(rv.handL.matrixWorld);
    return this.v.distanceTo(this.v2);
  }

  reset(): void {
    for (const rv of this.views) {
      rv.alive = true; rv.washT = 99; rv.dropT = 99; rv.landedDrop = true; rv.victory = false;
      rv.u.uFlash.value = 0;
      rv.cancelActions();
    }
  }

  update(dt: number, runners: ReadonlyArray<RunnerLike>, o: PlayersFrameOpts): void {
    this.time += dt;
    const cam = o.camera;
    this.camPos.setFromMatrixPosition(cam.matrixWorld);
    const a = o.alpha;
    for (let i = 0; i < this.views.length && i < runners.length; i++) {
      const rv = this.views[i];
      const r = runners[i];
      const f = this.frames[i];
      f.x = r.px + (r.x - r.px) * a;
      f.y = r.py + (r.y - r.py) * a - MOVE.skin;
      f.z = r.pz + (r.z - r.pz) * a;
      f.yaw = r.pyaw + angleDelta(r.pyaw, r.yaw) * a;
      f.vx = r.vx; f.vz = r.vz; f.vy = r.vy;
      f.speed = Math.hypot(r.vx, r.vz);

      // life cycle
      if (r.alive && !rv.alive && rv.washT > 0.5) { rv.alive = true; rv.washT = 99; }   // missed respawn event
      if (!r.alive && rv.alive) { rv.alive = false; rv.washT = 0; rv.cancelActions(); }
      rv.washT += dt;
      if (rv.dropT < 0.6) {
        rv.dropT += dt;
        if (rv.dropT >= 0.6 && !rv.landedDrop) {
          rv.landedDrop = true;
          this.fx?.slickRing(f.x, f.y + 0.02, f.z, r.team, true);
        }
      }
      const drop = this.dropOffset(i);
      rv.victory = o.winner !== null && o.winner !== 0 && r.team === o.winner && r.alive;

      const slick = r.alive && (r.slickForm ?? (r.state === 'slick' || r.state === 'wallslick'));
      const enemy = r.team !== o.viewerTeam;
      const dx = f.x - this.camPos.x, dz = f.z - this.camPos.z, dy = f.y - this.camPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // hidden enemy slickers: only a faint ripple beyond 3 m (DESIGN §4 / CONTRACT §10.1)
      const ghost = slick && enemy && r.hidden && dist > 3 && !o.seen(r.id);
      const misted = slick && enemy && dist > 3 && (o.mistRange ?? Infinity) < Infinity && !o.seen(r.id);
      rv.mistK = misted ? Math.max(0, rv.mistK - dt * 5) : slick ? Math.min(1, rv.mistK + dt * 5) : 1;
      // washed: squash-pop for 0.12 s, then hidden until respawn
      const popping = !rv.alive && rv.washT < 0.12;
      const bodyOn = (rv.alive || popping) && !slick;
      rv.model.visible = bodyOn;
      rv.fin.visible = slick && !ghost && rv.mistK > 0.02;
      rv.root.position.set(f.x, f.y + drop, f.z);
      rv.root.rotation.set(0, f.yaw, 0);
      if (popping) {
        const k = rv.washT / 0.12;
        rv.model.scale.set(1 + 0.35 * k, 1 - 0.45 * k, 1 + 0.35 * k);
      } else if (rv.model.scale.x !== 1) rv.model.scale.set(1, 1, 1);

      // tank level (bind-space clip) + hit flash decay
      const tk = clamp(r.tank / 100, 0, 1);
      rv.u.uTankY.value = this.kitFill(rv, tk);
      if (rv.u.uFlash.value > 0) rv.u.uFlash.value = Math.max(0, rv.u.uFlash.value - dt * 5);

      // shadows only near the camera: a far runner's shadow is a few texels of a 48 m shadow box
      const caster = dist < 26;
      if (rv.body.castShadow !== caster) { rv.body.castShadow = caster; rv.fin.castShadow = caster; }
      rv.animate(dt, r, f, dist > 28);

      // SHEET-DRUM: spin the drum while it rolls (the top moves with the runner), sheet spray at the contact
      if (rv.kit.drum && bodyOn) this.drum(i, rv, r, f, dt, dist);
      // WELLSPRING leap: a dye trail from the feet
      if (this.fx && r.leaping && bodyOn) {
        rv.trailAcc += dt;
        while (rv.trailAcc >= 0.035) { rv.trailAcc -= 0.035; this.fx.drip(f.x, f.y + drop + 0.2, f.z, r.team); }
      } else rv.trailAcc = 0;

      // fin: bob + bank, flat against the wall in WALL-SLICK
      if (slick) {
        rv.finBob += dt * (3 + f.speed * 0.8);
        const bank = clamp(-rv.yawRate * 0.08, -0.35, 0.35);
        if (r.state === 'wallslick') {
          // flat against the wall: fin up = the wall normal, nose up (root yaw is undone by wallYaw)
          const wn = Math.hypot(r.wallNx ?? 0, r.wallNz ?? 0);
          const wallYaw = wn > 0.1 ? Math.atan2(-(r.wallNx ?? 0), -(r.wallNz ?? 0)) : f.yaw;   // facing INTO the wall
          rv.fin.rotation.set(-Math.PI / 2, wallYaw - f.yaw, 0, 'YXZ');
          rv.fin.position.set(Math.sin(wallYaw - f.yaw) * 0.3, 0.45, Math.cos(wallYaw - f.yaw) * 0.3);
        } else {
          rv.fin.rotation.set(Math.sin(rv.finBob * 0.7) * 0.04, 0, bank + Math.sin(rv.finBob) * 0.05);
          rv.fin.position.set(0, -0.01 + Math.sin(rv.finBob * 1.3) * 0.012 - (1 - rv.mistK) * 0.3, 0);
        }
        const fs = 0.35 + 0.65 * rv.mistK;
        if (rv.fin.scale.x !== fs) rv.fin.scale.setScalar(fs);
      }
      if (slick !== rv.finWas) {
        rv.finWas = slick;
        if (this.fx && r.alive && !ghost) this.fx.slickRing(f.x, f.y + 0.03, f.z, r.team, false);
      }
      // wake (moving slickers, any range) / faint ripple (hidden ones)
      if (this.fx && slick) {
        if (!ghost && !misted && f.speed > 1.0) {
          rv.wakeAcc += dt;
          const period = r.state === 'wallslick' ? 0.09 : 0.055;
          while (rv.wakeAcc >= period) {
            rv.wakeAcc -= period;
            if (r.state === 'wallslick') this.fx.wake(f.x + Math.sin(f.yaw) * 0.3, f.y + 0.4, f.z + Math.cos(f.yaw) * 0.3, f.vx, f.vz, r.team, 0.6, true);
            else this.fx.wake(f.x - Math.sin(f.yaw) * 0.35, f.y + 0.02, f.z - Math.cos(f.yaw) * 0.35, f.vx, f.vz, r.team, Math.min(1, f.speed / 8), false);
          }
        } else {
          rv.rippleAcc += dt;
          const period = ghost ? 0.9 : 0.6;
          if (rv.rippleAcc >= period && !misted) { rv.rippleAcc = 0; this.fx.ripple(f.x, f.y + 0.02, f.z, r.team, ghost ? 0.35 : 0.6); }
        }
      }

      // name tag
      this.placeTag(rv, r, f, o, drop, slick, ghost, dist);
    }
  }

  private kitFill(rv: RunnerView, tk: number): number {
    return rv.kit.fillMin + (rv.kit.fillMax - rv.kit.fillMin) * tk;
  }

  /** the roller drum: spin while rolling (sign from the drum axis vs the runner's left) + the sheet spray */
  private drum(i: number, rv: RunnerView, r: RunnerLike, f: RunnerFrame, dt: number, dist: number): void {
    const d = rv.kit.drum!;
    if (!r.rolling) { rv.sprayAcc = 0; return; }
    if (!rv.hand) return;
    rv.hand.updateWorldMatrix(true, false);
    this.v.copy(d.axisInHand).transformDirection(rv.hand.matrixWorld);
    // the runner's left = +X local = (cos yaw, 0, −sin yaw); a drum rolling forward turns +angle about the left axis
    const left = this.v.x * Math.cos(f.yaw) - this.v.z * Math.sin(f.yaw);
    const sign = left >= 0 ? 1 : -1;
    rv.u.uSpin.value = (rv.u.uSpin.value + sign * (f.speed / d.radius) * dt) % TAU;
    if (!this.fx || dist > 40) return;
    rv.sprayAcc += dt;
    const period = dist < 18 ? 1 / 30 : 1 / 12;
    if (rv.sprayAcc < period) return;
    rv.sprayAcc = 0;
    if (!this.muzzle(i, this.v2)) return;
    const s = Math.sin(f.yaw), c = Math.cos(f.yaw);
    const sp = f.speed > 0.3 ? 1 : 0;
    const mx = sp ? f.vx / f.speed : s, mz = sp ? f.vz / f.speed : c;
    this.fx.rollSpray(this.v2.x, f.y + 0.03, this.v2.z, mx, mz, f.speed, r.team);
  }

  private placeTag(rv: RunnerView, r: RunnerLike, f: RunnerFrame, o: PlayersFrameOpts, drop: number, slick: boolean, ghost: boolean, dist: number): void {
    const enemy = r.team !== o.viewerTeam;
    let show = !!this.tagHost && r.id !== o.viewerId && rv.alive && !ghost && dist < 60 && (!enemy || o.seen(r.id));
    if (show) {
      this.v.set(f.x, f.y + drop + (slick ? 0.62 : 1.55), f.z).project(o.camera);
      if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) show = false;
      else {
        const px = (this.v.x * 0.5 + 0.5) * o.width;
        const py = (-this.v.y * 0.5 + 0.5) * o.height;
        const s = clamp(1.25 - dist / 60, 0.6, 1);
        rv.tag.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
        rv.tag.style.opacity = dist > 40 ? String(clamp(1 - (dist - 40) / 20, 0, 1).toFixed(2)) : '1';
      }
    }
    if (show !== rv.tagOn) { rv.tagOn = show; rv.tag.hidden = !show; }
  }

  /** runner-body draw stats for the debug panel */
  stats(): { bodyTris: number; finTris: number; runners: number; kits: Record<string, number> } {
    const kits: Record<string, number> = {};
    for (const [id, k] of this.kits) kits[id] = Math.round(k.bodyTris);
    return { bodyTris: this.kit.bodyTris, finTris: this.kit.finTris, runners: this.views.length, kits };
  }

  dispose(): void {
    for (const rv of this.views) rv.dispose();
    this.views.length = 0;
    this.tagHost?.remove();
    this.root.removeFromParent();
  }
}
