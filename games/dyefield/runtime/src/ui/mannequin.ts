// DYEFIELD — the LOADOUT mannequin (CONTRACT_P6_11 §20): the tide-runner holding the selected kit, standing
// on a painted disk in the player's crew colour, playing `lobby_idle`, with a short `aim` preview when a kit
// is picked. It is its own tiny scene (key + fill + rim lights, a RoomEnvironment for the gloss), drawn by the
// game's renderer as a second pass into a screen rectangle (a DOM slot on the right of the LOADOUT screen)
// after the live lobby frame — no second WebGL context.
//
//   * body: a SkeletonUtils clone of tide_runner.glb; crew materials (the same set heroview tints) are cloned
//     and multiplied by the crew dye from teams.json (the colorblind palette when that setting is on);
//   * kit: the selected kit's GLB cloned under `socket_weapon` (identity), tinted the same way;
//   * clips: lower body = lobby_idle; upper body = lobby_idle (one-handed kits) or hold_two (the roller and the
//     charger, which carry a grip_L); a pick cross-fades the upper body to `aim` for AIM_PREVIEW_S;
//   * the disk: a canvas-drawn dye splat (crew colour, glossy) with a soft contact shadow;
//   * drag on the slot turns the runner; it sways slowly on its own.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { HeroAssets } from '../view/heroview.ts';
import type { KitArt } from '../view/players.ts';
import type { TeamId } from '../core/types.ts';

/** the crew-dyed materials (heroview TEAM_MATERIALS) */
const TEAM_MATERIALS = new Set(['M_crest', 'M_top_trim', 'M_shorts_stripe', 'M_sole', 'M_tank_dye', 'M_band', 'M_kit_dye']);
const UPPER_BONES = new Set(['spine', 'chest', 'neck', 'head', 'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L',
  'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R']);
export const AIM_PREVIEW_S = 1.4;
/** 3/4 view that shows the kit hand (the runner's right, screen left) */
const BASE_YAW = 0.5;
const TWO_HANDED = new Set(['sheet-drum', 'needle-glint']);

function origName(o: THREE.Object3D): string {
  return (o.userData && typeof o.userData.name === 'string') ? o.userData.name : o.name;
}
function findByOrigName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  const san = THREE.PropertyBinding.sanitizeNodeName(name);
  root.traverse((o) => { if (!hit && (origName(o) === name || o.name === name || o.name === san)) hit = o; });
  return hit;
}
function nodeOfTrack(t: THREE.KeyframeTrack): string {
  try { return THREE.PropertyBinding.parseTrackName(t.name).nodeName ?? ''; } catch { return ''; }
}

/** a canvas splat disk: an organic blob of dye + droplets, a lighter gloss rim, in `hex` */
function diskTexture(hex: string): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(hex);
  const css = (k: number, a = 1): string => {
    const r = Math.round(Math.min(1, col.r * k) * 255), gg = Math.round(Math.min(1, col.g * k) * 255), b = Math.round(Math.min(1, col.b * k) * 255);
    return `rgba(${r},${gg},${b},${a})`;
  };
  const blob = (cx: number, cy: number, r: number, lobes: number, amp: number, seed: number): void => {
    g.beginPath();
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const w = 1 + amp * (Math.sin(a * lobes + seed) * 0.6 + Math.sin(a * (lobes + 3) + seed * 2.1) * 0.4);
      const x = cx + Math.cos(a) * r * w, y = cy + Math.sin(a) * r * w;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  };
  g.clearRect(0, 0, S, S);
  g.fillStyle = css(0.62);
  blob(S / 2, S / 2, S * 0.43, 7, 0.07, 1.3);
  g.fillStyle = css(1);
  blob(S / 2, S / 2 - 6, S * 0.41, 7, 0.07, 1.3);
  const drops: Array<[number, number, number]> = [[0.13, 0.2, 0.035], [0.86, 0.3, 0.028], [0.82, 0.82, 0.04], [0.16, 0.78, 0.024], [0.52, 0.06, 0.02], [0.06, 0.5, 0.018]];
  for (const [x, y, r] of drops) { g.beginPath(); g.arc(x * S, y * S, r * S, 0, Math.PI * 2); g.fill(); }
  // gloss rim + a highlight crescent
  const rg = g.createRadialGradient(S * 0.42, S * 0.36, S * 0.02, S / 2, S / 2, S * 0.44);
  rg.addColorStop(0, 'rgba(255,255,255,0.34)');
  rg.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function shadowTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(10,16,30,0.62)');
  rg.addColorStop(0.55, 'rgba(10,16,30,0.3)');
  rg.addColorStop(1, 'rgba(10,16,30,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface MannequinRect { x: number; y: number; w: number; h: number }

export class Mannequin {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
  kitId = '';
  team: TeamId = 1;
  /** the upper-body role now playing (harness read-back) */
  upperRole: 'idle' | 'hold' | 'aim' = 'idle';
  /** kit swaps so far (harness read-back) */
  swaps = 0;
  yaw = BASE_YAW;
  private readonly hero: HeroAssets;
  private readonly art: KitArt;
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly spin = new THREE.Group();
  private readonly socket: THREE.Object3D | null;
  private kitNode: THREE.Object3D | null = null;
  private readonly bodyMats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private kitMats: THREE.MeshStandardMaterial[] = [];
  private readonly disk: THREE.Mesh;
  private diskTex: THREE.CanvasTexture | null = null;
  private readonly shadow: THREE.Mesh;
  private readonly env: THREE.Texture;
  private readonly lower: THREE.AnimationAction | null;
  private readonly upperIdle: THREE.AnimationAction | null;
  private readonly upperHold: THREE.AnimationAction | null;
  private readonly upperAim: THREE.AnimationAction | null;
  private aimT = 0;
  private time = 0;
  private dragging = false;
  private dragX = 0;
  private dragVel = 0;
  private dyeHex: (t: TeamId) => string;

  constructor(renderer: THREE.WebGLRenderer, hero: HeroAssets, art: KitArt, dyeHex: (t: TeamId) => string) {
    this.hero = hero;
    this.art = art;
    this.dyeHex = dyeHex;
    const pm = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.env = pm.fromScene(room, 0.04).texture;
    room.dispose();
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.55;

    const hemi = new THREE.HemisphereLight(0xdff3ff, 0x6a5a48, 1.1);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(2.2, 3.4, 2.6);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 1.8);
    rim.position.set(-2.4, 2.2, -2.2);
    this.scene.add(hemi, key, rim);

    this.model = SkeletonUtils.clone(hero.hero.scene);
    this.model.traverse((o) => {
      if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) o.visible = false;
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.material = Array.isArray(m.material) ? m.material.map((x) => this.bodyMat(x)) : this.bodyMat(m.material);
    });
    const fin = findByOrigName(this.model, 'slick_fin');
    if (fin) fin.visible = false;
    this.socket = findByOrigName(this.model, 'socket_weapon') ?? findByOrigName(this.model, 'hand.R');
    this.spin.add(this.model);
    this.scene.add(this.spin);

    // disk + contact shadow
    // unlit + not tone-mapped: the disk shows the crew's dye exactly as the HUD does (its gloss is painted in)
    this.disk = new THREE.Mesh(new THREE.CircleGeometry(0.82, 64),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    this.disk.rotation.x = -Math.PI / 2;
    this.disk.position.y = 0.004;
    this.disk.renderOrder = 1;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.008;
    this.shadow.renderOrder = 2;
    this.scene.add(this.disk, this.shadow);

    // clips: lower / upper split (like heroview) so the upper body can hold a two-handed kit or aim
    const byName = new Map<string, THREE.AnimationClip>();
    for (const c of hero.hero.animations) byName.set(c.name, c);
    const upperNames = new Set<string>();
    this.model.traverse((o) => { if (UPPER_BONES.has(origName(o))) upperNames.add(o.name); });
    const split = (c: THREE.AnimationClip | undefined, upper: boolean): THREE.AnimationClip | null => {
      if (!c) return null;
      const tracks = c.tracks.filter((t) => upperNames.has(nodeOfTrack(t)) === upper);
      return new THREE.AnimationClip(`${c.name}__${upper ? 'up' : 'lo'}`, c.duration, tracks);
    };
    const idle = byName.get('lobby_idle') ?? byName.get('idle');
    this.mixer = new THREE.AnimationMixer(this.model);
    const act = (c: THREE.AnimationClip | null, w: number): THREE.AnimationAction | null => {
      if (!c) return null;
      const a = this.mixer.clipAction(c);
      a.setEffectiveWeight(w);
      a.play();
      return a;
    };
    this.lower = act(split(idle, false), 1);
    this.upperIdle = act(split(idle, true), 1);
    this.upperHold = act(split(byName.get('hold_two'), true), 0);
    this.upperAim = act(split(byName.get('aim'), true), 0);
    this.mixer.update(0);
    this.fit();
  }

  private bodyMat(mat: THREE.Material): THREE.Material {
    if (!TEAM_MATERIALS.has(mat.name)) return mat;
    let t = this.bodyMats.get(mat);
    if (!t) {
      t = (mat as THREE.MeshStandardMaterial).clone();
      t.userData.dfBase = (mat as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(1, 1, 1);
      this.bodyMats.set(mat, t);
    }
    return t;
  }

  /** frame the runner: the camera looks at its middle, the whole body + disk in view */
  private fit(): void {
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const h = Math.max(0.6, box.max.y - Math.min(0, box.min.y));
    const cy = h * 0.5;
    const dist = (h * 0.5 + 0.2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(0, cy + h * 0.2, dist);
    this.camera.lookAt(0, cy + h * 0.06, 0);
  }

  /** crew colour for the crest / trims / kit / disk */
  setTeam(team: TeamId): void {
    this.team = team;
    const dye = new THREE.Color(this.dyeHex(team));
    for (const m of [...this.bodyMats.values(), ...this.kitMats]) {
      const base = (m.userData.dfBase as THREE.Color | undefined) ?? new THREE.Color(1, 1, 1);
      m.color.copy(base).multiply(dye);
    }
    const dm = this.disk.material as THREE.MeshBasicMaterial;
    this.diskTex?.dispose();
    this.diskTex = diskTexture(this.dyeHex(team));
    dm.map = this.diskTex;
    dm.needsUpdate = true;
  }

  /** show `kitId` in the hand; `preview` plays the short aim */
  setKit(kitId: string, preview = true): void {
    if (kitId !== this.kitId) {
      this.kitId = kitId;
      this.swaps++;
      if (this.kitNode) {
        this.kitNode.removeFromParent();
        for (const m of this.kitMats) m.dispose();
        this.kitMats = [];
        this.kitNode = null;
      }
      const gltf: GLTF | null | undefined = this.art.kits.get(kitId) ?? (kitId === 'mist-rasp' ? this.hero.kit : null);
      if (gltf && this.socket) {
        const k = gltf.scene.clone(true);
        k.traverse((o) => {
          if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) { o.visible = false; return; }
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.frustumCulled = false;
          const tint = (mat: THREE.Material): THREE.Material => {
            if (!TEAM_MATERIALS.has(mat.name)) return mat;
            const t = (mat as THREE.MeshStandardMaterial).clone();
            t.userData.dfBase = (mat as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(1, 1, 1);
            this.kitMats.push(t);
            return t;
          };
          m.material = Array.isArray(m.material) ? m.material.map(tint) : tint(m.material);
        });
        k.position.set(0, 0, 0);
        k.quaternion.identity();
        k.scale.set(1, 1, 1);
        k.name = `kit_${kitId}`;
        this.socket.add(k);
        this.kitNode = k;
      }
      this.setTeam(this.team);
    }
    if (preview) this.aimT = AIM_PREVIEW_S;
  }

  /** the slot element: drag to turn */
  bindDrag(slot: HTMLElement): () => void {
    const down = (e: PointerEvent): void => { this.dragging = true; this.dragX = e.clientX; slot.setPointerCapture?.(e.pointerId); };
    const move = (e: PointerEvent): void => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragX;
      this.dragX = e.clientX;
      this.yaw += dx * 0.012;
      this.dragVel = dx * 0.012 * 60;
    };
    const up = (): void => { this.dragging = false; };
    slot.addEventListener('pointerdown', down);
    slot.addEventListener('pointermove', move);
    slot.addEventListener('pointerup', up);
    slot.addEventListener('pointercancel', up);
    return () => {
      slot.removeEventListener('pointerdown', down);
      slot.removeEventListener('pointermove', move);
      slot.removeEventListener('pointerup', up);
      slot.removeEventListener('pointercancel', up);
    };
  }

  update(dt: number): void {
    this.time += dt;
    if (this.aimT > 0) this.aimT = Math.max(0, this.aimT - dt);
    const two = TWO_HANDED.has(this.kitId);
    const aimW = this.aimT > 0 ? Math.min(1, this.aimT / 0.25, (AIM_PREVIEW_S - this.aimT) / 0.18 + 0.001) : 0;
    const holdW = two ? 1 - aimW : 0;
    const idleW = two ? 0 : 1 - aimW;
    this.upperAim?.setEffectiveWeight(this.upperAim ? aimW : 0);
    this.upperHold?.setEffectiveWeight(this.upperHold ? holdW : 0);
    // no hold_two clip: a two-handed kit falls back to the idle upper body
    this.upperIdle?.setEffectiveWeight(this.upperHold ? idleW : 1 - aimW);
    this.upperRole = aimW > 0.5 ? 'aim' : two && this.upperHold ? 'hold' : 'idle';
    this.mixer.update(dt);
    if (!this.dragging) {
      this.dragVel *= Math.pow(0.02, dt);
      this.yaw += this.dragVel * dt;
      if (Math.abs(this.dragVel) < 0.05) {
        // ease back into a slow sway around the 3/4 view
        const target = BASE_YAW + Math.sin(this.time * 0.45) * 0.26;
        this.yaw += (target - this.yaw) * Math.min(1, dt * 1.2);
      }
    }
    this.spin.rotation.y = this.yaw;
  }

  /** draw into `rect` (CSS px, top-left origin) over the current frame; the caller rendered the world first */
  render(renderer: THREE.WebGLRenderer, rect: MannequinRect): void {
    if (rect.w < 8 || rect.h < 8) return;
    const size = renderer.getSize(new THREE.Vector2());
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const w = Math.min(size.x - x, rect.w), h = Math.min(size.y - y, rect.h);
    if (w < 8 || h < 8) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const vy = size.y - y - h;
    const ac = renderer.autoClear;
    const sm = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x, vy, w, h);
    renderer.setViewport(x, vy, w, h);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.autoClear = ac;
    renderer.shadowMap.autoUpdate = sm;
  }

  /** read-back for the harness */
  info(): Record<string, unknown> {
    return { kit: this.kitId, team: this.team, upper: this.upperRole, swaps: this.swaps, kitAttached: !!this.kitNode, aimT: this.aimT };
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of [...this.bodyMats.values(), ...this.kitMats]) m.dispose();
    this.diskTex?.dispose();
    (this.disk.material as THREE.Material).dispose();
    this.disk.geometry.dispose();
    const sm = this.shadow.material as THREE.MeshBasicMaterial;
    sm.map?.dispose();
    sm.dispose();
    this.shadow.geometry.dispose();
    this.env.dispose();
  }
}
