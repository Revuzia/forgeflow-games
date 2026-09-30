// HIT PARADE - one fighter on screen (CONTRACT §7 "Pose from state", §2 facing, §6.4 props, §17).
//
//   root  (world: x, y from the snapshot, z 0; yaw +90 deg facing +x / -90 deg facing -x - the GLB faces +Z at rest)
//    └ model (SkeletonUtils clone of the GLB; height-normalised to the fighter's heightM when the file disagrees by
//             more than 3 %; the view-only hitstop SHAKE offsets it +-2 cm along the fight line at 30 Hz)
// Pose: PoseDriver writes the pose from (animId, animFrame, prevAnimId, prevAnimFrame, blendT) each frame - never from
// accumulated time - so a rollback re-poses identically. During hitstop the sim holds animFrame, so the attacker holds
// its impact pose; only the VICTIM shakes (BoutView marks it from the HIT/BLOCK event's `b`, or the fighter whose
// current clip is a hit/block reaction).
// Props: attached by a WORLD-space full-basis solve each frame (doctrine §1): the hand bone's world position +
// rotation (its scale stripped - the Mixamo armature carries 0.01 scale) composed with the prop's grip offset
// (§17.1 `attach` metadata); the prop lives at the scene root with matrixAutoUpdate off.

import * as THREE from 'three';
import type { Assets, FighterAsset, PropAttach } from './assets.ts';
import { PoseDriver } from './anim.ts';
import { hueForTint, profileForBody, toonify, type ToonHandle } from './toon.ts';
import { flagOn, type AnimRef, type ViewFighterDef, type ViewFighterSnap } from './types.ts';

const DEG = Math.PI / 180;
export const SHAKE_M = 0.02;
export const SHAKE_HZ = 30;

interface Attached { obj: THREE.Object3D; bone: THREE.Object3D; offset: THREE.Matrix4 }

export class FighterView {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly pose: PoseDriver;
  readonly toon: ToonHandle;
  readonly table: ReadonlyArray<AnimRef>;
  readonly heightM: number;
  /** set by BoutView from HIT/BLOCK events; cleared when the hitstop ends */
  victim = false;
  /** mirror the model when facing -1 (view setting, default on) */
  mirror = true;
  private readonly head: THREE.Object3D | null;
  private readonly hands: THREE.Object3D[];
  private readonly chestBone: THREE.Object3D | null;
  private readonly bonesByName = new Map<string, THREE.Object3D>();
  private flashAmt = 0;
  private flashFrom = 0;
  private flashDur = 0.001;
  private flashT = 1;
  private flashColor = new THREE.Color(1, 1, 1);
  private glowT = 0;
  private glowHold = 0;
  private readonly props: Attached[] = [];
  private readonly mp = new THREE.Vector3();
  private readonly mq = new THREE.Quaternion();
  private readonly ms = new THREE.Vector3();
  private readonly mm = new THREE.Matrix4();
  /** read-back for the lab / harness */
  readonly last = { shake: 0, facing: 1, x: 0, y: 0, clip: '', t: 0, w: 1 };

  constructor(assets: Assets, asset: FighterAsset, table: ReadonlyArray<AnimRef>, def: ViewFighterDef | undefined, color = 0, outline = true) {
    this.id = asset.id;
    this.table = table;
    this.root.name = 'fighter:' + asset.id;
    this.model = assets.instantiate(asset);
    const target = def?.heightM && def.heightM > 0.5 ? def.heightM : asset.heightM;
    const k = Math.abs(asset.heightM - target) / target > 0.03 ? target / asset.heightM : 1;
    this.model.scale.multiplyScalar(k);
    this.heightM = asset.heightM * k;
    this.root.add(this.model);
    const tint = def?.colors?.[color]?.tint ?? null;
    this.toon = toonify(this.model, {
      profile: profileForBody(def?.body ?? asset.id, def?.toon),
      hueShift: hueForTint(tint),
      outline,
    });
    this.model.traverse((o) => { if ((o as THREE.Bone).isBone) this.bonesByName.set(o.name, o); });
    this.head = this.bonesByName.get('mixamorigHead') ?? null;
    this.hands = ['mixamorigLeftHand', 'mixamorigRightHand'].map((n) => this.bonesByName.get(n)).filter((b): b is THREE.Object3D => !!b);
    this.chestBone = this.bonesByName.get('mixamorigSpine2') ?? this.bonesByName.get('mixamorigSpine1') ?? null;
    this.pose = new PoseDriver(this.model, asset.clips);
  }

  bone(name: string): THREE.Object3D | null { return this.bonesByName.get(name) ?? this.bonesByName.get('mixamorig' + name) ?? null; }

  /** whole-body flash toward `color`, fading over `seconds` (real time) */
  flash(amount: number, color: THREE.ColorRepresentation, seconds: number): void {
    this.flashFrom = amount; this.flashAmt = amount; this.flashColor.set(color); this.flashDur = Math.max(0.001, seconds); this.flashT = 0;
    this.toon.setFlash(amount, this.flashColor);
  }

  /** IMPACT armour glow for `seconds` (also driven by the snapshot's armor flag) */
  glow(seconds: number): void { this.glowHold = Math.max(this.glowHold, seconds); }

  /** attach a prop (Assets.prop clone) to a bone by its §17.1 grip metadata */
  attachProp(obj: THREE.Object3D, a: PropAttach | null, scene: THREE.Object3D): boolean {
    const meta: PropAttach = a ?? { bone: 'RightHand', pos: [0, 0.08, 0.03], rotDeg: [0, 0, 0] };
    const bone = this.bone(meta.bone);
    if (!bone) return false;
    const offset = new THREE.Matrix4().compose(
      new THREE.Vector3(meta.pos[0], meta.pos[1], meta.pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(meta.rotDeg[0] * DEG, meta.rotDeg[1] * DEG, meta.rotDeg[2] * DEG)),
      new THREE.Vector3(1, 1, 1));
    obj.matrixAutoUpdate = false;
    scene.add(obj);
    this.props.push({ obj, bone, offset });
    return true;
  }

  /**
   * Apply one snapshot. `dt` real seconds; `time` real seconds (the shake clock); `timeScale` 0.25 in KO slow-mo.
   */
  /**
   * CHANGED(fixer) D3: presentation-only depth offset (m, toward the camera). BoutView sets the target while a side-swap
   * throw carries this fighter PAST the thrower (thrown_b) so the tumbling body passes in front of the thrower instead of
   * through it (2D fighters layer the victim over the thrower); eased in / out in real time, never touches the sim.
   */
  zTarget = 0;
  private zNow = 0;

  update(s: ViewFighterSnap, dt: number, time: number): void {
    const facing = s.facing < 0 ? -1 : 1;
    this.zNow += (this.zTarget - this.zNow) * Math.min(1, dt * 10);
    if (Math.abs(this.zNow) < 1e-4) this.zNow = 0;
    this.root.position.set(s.x, s.y, this.zNow);
    // yaw +-90 deg from facing (CONTRACT §2); facing -1 also MIRRORS the model (local X scale -1, SF4-6 convention,
    // §17.1) so both sides show the same silhouette to the camera. Equivalent to reflecting the facing +1 pose in x.
    const mirror = this.mirror && facing < 0;
    this.root.rotation.set(0, facing * 90 * DEG, 0);
    this.root.scale.set(mirror ? -1 : 1, 1, 1);
    this.pose.pose(this.table, s);
    // victim shake: +-2 cm along the fight line at 30 Hz while the hitstop lasts (view only)
    const hs = s.hitstop ?? 0;
    let clipHit = false;
    const e = s.animId >= 0 && s.animId < this.table.length ? this.table[s.animId] : null;
    if (e && /^(hit_|block_|crumple|wall_splat)/.test(e.clip)) clipHit = true;
    if (hs <= 0) this.victim = false;
    const shake = hs > 0 && (this.victim || clipHit) ? ((Math.floor(time * SHAKE_HZ) & 1) ? SHAKE_M : -SHAKE_M) : 0;
    // the model is rotated by the facing yaw; its local z maps to world x (yaw +90: local +z -> world +x)
    this.model.position.set(0, 0, shake * facing);
    // flash fade
    if (this.flashT < 1) {
      this.flashT = Math.min(1, this.flashT + dt / this.flashDur);
      this.flashAmt = this.flashFrom * (1 - this.flashT);
      this.toon.setFlash(this.flashAmt);
    }
    // armour glow: snapshot flag or a timed pulse
    this.glowHold = Math.max(0, this.glowHold - dt);
    const armored = flagOn(s.flags?.armor) || this.glowHold > 0;
    this.glowT = armored ? Math.min(1, this.glowT + dt * 10) : Math.max(0, this.glowT - dt * 4);
    this.toon.setGlow(this.glowT * (0.45 + 0.25 * Math.sin(time * 22)));
    // props: world-space full-basis solve
    if (this.props.length) {
      this.root.updateMatrixWorld(true);
      for (const p of this.props) {
        p.bone.matrixWorld.decompose(this.mp, this.mq, this.ms);
        this.mm.compose(this.mp, this.mq, this.ms.set(this.ms.x < 0 ? -1 : 1, 1, 1)).multiply(p.offset);
        p.obj.matrix.copy(this.mm);
        p.obj.matrixWorldNeedsUpdate = true;
      }
    }
    const L = this.last;
    L.shake = shake; L.facing = facing; L.x = s.x; L.y = s.y;
    L.clip = this.pose.last.clip; L.t = this.pose.last.t; L.w = this.pose.last.w;
  }

  /** world head-top height (m) for the camera's jump pan */
  headY(): number {
    if (this.head) { this.head.getWorldPosition(this.mp); return this.mp.y + 0.24 * (this.heightM / 1.8); }   // head bone -> hair top
    return this.root.position.y + this.heightM;
  }

  /** CHANGED(fixer) D4: the silhouette top for the camera = head top, or a raised hand (jump clips throw the arms up) */
  topY(): number {
    let y = this.headY();
    for (const b of this.hands) { b.getWorldPosition(this.mp); y = Math.max(y, this.mp.y + 0.06 * (this.heightM / 1.8)); }
    return y;
  }

  /** world chest position (FX anchor) */
  chest(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.chestBone) return this.chestBone.getWorldPosition(out);
    return out.set(this.root.position.x, this.root.position.y + this.heightM * 0.7, 0);
  }

  dispose(): void {
    this.pose.dispose();
    this.toon.dispose();
    for (const p of this.props) p.obj.removeFromParent();
    this.root.removeFromParent();
  }
}
