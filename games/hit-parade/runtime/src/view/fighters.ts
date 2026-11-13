// HIT PARADE - one fighter on screen (CONTRACT §7 "Pose from state", §2 facing, §6.4 props, §17).
//
//   root  (world: x, y, z + yaw from the snapshot - CHANGED(VIEW3D), SIM3D §35.13; the 1D labs: z 0, yaw +-90 deg from
//          facing - the GLB faces +Z at rest)
//    └ model (SkeletonUtils clone of the GLB; height-normalised to the fighter's heightM when the file disagrees by
//             more than 3 %; the view-only hitstop SHAKE offsets it +-2 cm along the fight line at 30 Hz)
// Pose: PoseDriver writes the pose from (animId, animFrame, prevAnimId, prevAnimFrame, blendT) each frame - never from
// accumulated time - so a rollback re-poses identically. During hitstop the sim holds animFrame, so the attacker holds
// its impact pose; only the VICTIM shakes (BoutView marks it from the HIT/BLOCK event's `b`, or the fighter whose
// current clip is a hit/block reaction).
// P2 (CHANGED VIEW): `update(s, dt, time, ov)` takes an optional FighterOverride - an explicit weighted pose (PRIME TIME
// timelines), an overlay blended into the snapshot pose (the hand-back after a cinematic), a presentation position /
// yaw / visibility. Overrides are pure functions of sim frames computed by BoutView (view/prime.ts), never state.
// Props: attached by a WORLD-space full-basis solve each frame (doctrine §1): the hand bone's world position +
// rotation (its scale stripped - the Mixamo armature carries 0.01 scale) composed with the prop's grip offset
// (§17.1 `attach` metadata); the prop lives at the scene root with matrixAutoUpdate off; view/props.ts rules decide
// when each prop shows (always / during named moves / until the projectile leaves the hand).
// CHANGED(fix_view) (CONTRACT §35.23 fix_view):
//   D2  the body yaw is PRESENTED through view/turn.ts: the sim's re-face snaps (35-180 deg in one sim frame) turn in 2-7
//       frames, continuous tracking stays instant, the fighter's own active frames always show the sim yaw; the mirror
//       (facing -1) flips half-way through such a turn instead of on its first frame. BoutView feeds `simFrame`.
//   D6  a SIDESTEP samples its clip by the sim's step progress (view/stepanim.ts) at full weight from its entry frame, and
//       the leg IK (view/legik.ts) scales the stride to the fighter's sim arc: the planted feet stay planted.
//   D13 `camTop()` = the measured neutral silhouette top (view/bodytop.ts: head + a raised limb) for the camera.
//   D5  `lightProbe` (BoutView: the stage light pool at the body) caps the light a toon body receives (toon setLight).

import * as THREE from 'three';
import type { Assets, FighterAsset, PropAttach } from './assets.ts';
import { PoseDriver } from './anim.ts';
import { hueForTint, profileForBody, toonify, type ToonHandle } from './toon.ts';
import { propVisible, type PropShow } from './props.ts';
import { flagOn, type AnimRef, type ViewFighterDef, type ViewFighterSnap } from './types.ts';
import { TurnSmoother } from './turn.ts';
import { clipTimeAt, stepProgress, strideScale, type StepFacts } from './stepanim.ts';
import { LegIK } from './legik.ts';
import { BodyTop } from './bodytop.ts';

/** CHANGED(fix_view) D6: the sidestep's blend-in from the previous clip runs this many times faster than the sim's 6 f
 *  (6 = full weight from the step's entry frame: the root already moves 13 % of the arc there, and the clip's first frames
 *  are the guard stance idle ends in) */
const STEP_BLEND_GAIN = 6;
/** CHANGED(fix_view) D2: a facing flip during a re-face of at least this many degrees waits for half the turn */
const MIRROR_HOLD_DEG = 60;
/** CHANGED(fix_view) D2: system moves (IMPACT / SHOVE / default throws) are not in the fighter file: land by move frame 5 */
const SYS_FIRST_ACTIVE = 5;
/** CHANGED(fix_view) D2: a root jump this big within 1-2 sim frames is a teleport / reset (dashes move <= ~0.15 m / frame) */
const TELEPORT_M = 0.6;

const DEG = Math.PI / 180;
export const SHAKE_M = 0.02;
export const SHAKE_HZ = 30;

interface Attached { obj: THREE.Object3D; bone: THREE.Object3D; offset: THREE.Matrix4; show: PropShow | null; id: string }

export interface PoseItem { clip: string; t: number; w: number }
export interface FighterOverride {
  /** explicit weighted pose (replaces the snapshot pose) */
  list?: ReadonlyArray<PoseItem>;
  /** an overlay mixed over the snapshot pose with weight w (0..1) */
  blend?: { list: ReadonlyArray<PoseItem>; w: number };
  x?: number; y?: number; z?: number;
  /** world yaw (radians) replacing the facing yaw (carried victims) */
  yaw?: number;
  facing?: number;
  visible?: boolean;
  inCinematic?: boolean;
}

export class FighterView {
  readonly id: string;
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly pose: PoseDriver;
  readonly toon: ToonHandle;
  readonly table: ReadonlyArray<AnimRef>;
  readonly heightM: number;
  readonly def: ViewFighterDef | undefined;
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
  private readonly entries: PoseItem[] = [];
  private readonly mixed: PoseItem[] = [];
  private readonly startupOf = new Map<string, number>();
  /** read-back for the lab / harness (CHANGED(fix_view): + simYawDeg / turnErr / turnSnap, stride, top, lightK) */
  readonly last = { shake: 0, facing: 1, x: 0, y: 0, z: 0, yawDeg: 0, mirror: false, clip: '', t: 0, w: 1, props: 0, propsShown: 0, override: '',
    simYawDeg: 0, turnErr: 0, turnSnap: '', lockIn: -1, stride: 1, ikShift: 0, ikDrop: 0, stepP: 0, top: 0, lightK: 1 };
  /** CHANGED(fix_view) D2: the sim frame of the snapshot the next update() presents (BoutView sets it; -1 = unknown: no smoothing) */
  simFrame = -1;
  /** CHANGED(fix_view) D2: smooth the sim's re-face snaps (the lab / lineups that pose by hand turn it off) */
  smoothTurns = true;
  readonly turn = new TurnSmoother();
  private mirrorSide = 1;
  private mirrorHold = 0;
  private lastSimX = 0;
  private lastSimZ = 0;
  private lastSimF = -1;
  /** CHANGED(fix_view) D6: sidestep facts (BoutView: system.json step + this fighter's step.distM + its clips' rootLat) */
  stepFacts: StepFacts | null = null;
  /** CHANGED(fix_view) D6: sample the sidestep by the sim's progress + scale the stride (a harness A/B switch; default on) */
  stepSync = true;
  private readonly legIK: LegIK;
  /** CHANGED(fix_view) D13: the measured neutral silhouette top above the root (m), see view/bodytop.ts; 0 until measureTop() */
  neutralTopM = 0;
  private bodyTop: BodyTop | null = null;
  /** CHANGED(fix_view) D5: light level at a world point -> the toon light scale (BoutView: the stage's light pool) */
  lightProbe: ((x: number, y: number, z: number) => number) | null = null;
  private readonly headTop: THREE.Object3D | null;

  constructor(assets: Assets, asset: FighterAsset, table: ReadonlyArray<AnimRef>, def: ViewFighterDef | undefined, color = 0, outline = true) {
    this.id = asset.id;
    this.table = table;
    this.def = def;
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
    this.headTop = this.bonesByName.get('mixamorigHeadTop_End') ?? null;
    this.pose = new PoseDriver(this.model, asset.clips);
    for (const [kk, m] of Object.entries(def?.moves ?? {})) if (typeof m.startup === 'number') this.startupOf.set(kk, m.startup);
    const swap = (c: string): string => (/^side(step|walk)_[lr]$/.test(c) ? c.slice(0, -1) + (c.endsWith('_l') ? 'r' : 'l') : c);
    this.tableMir = table.some((e) => /^side(step|walk)_[lr]$/.test(e.clip)) ? table.map((e) => ({ ...e, clip: swap(e.clip) })) : table;
    // CHANGED(fix_view) D6
    this.legIK = new LegIK((n) => this.bone(n));
  }

  /**
   * CHANGED(fix_view) D13: measure the neutral silhouette top (view/bodytop.ts) - BoutView calls it for its fighters right
   * after construction (portraits / the char-select showcase never need it). Poses clips by hand: call it outside a frame.
   */
  measureTop(): void {
    if (this.bodyTop) return;
    const keepPos = this.root.position.clone(), keepRot = this.root.rotation.y, keepScale = this.root.scale.x;
    this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); this.root.scale.set(1, 1, 1);
    this.root.updateMatrixWorld(true);
    this.bodyTop = new BodyTop(this.model);
    this.neutralTopM = this.bodyTop.neutralTop(this.model, (c) => this.pose.has(c), (c) => this.pose.dur(c), (c, t) => this.pose.poseClip(c, t));
    this.pose.poseClip(this.pose.has('idle') ? 'idle' : '', 0);
    this.root.position.copy(keepPos); this.root.rotation.set(0, keepRot, 0); this.root.scale.set(keepScale, 1, 1);
    this.root.updateMatrixWorld(true);
  }

  bone(name: string): THREE.Object3D | null { return this.bonesByName.get(name) ?? this.bonesByName.get('mixamorig' + name) ?? null; }

  /** whole-body flash toward `color`, fading over `seconds` (real time) */
  flash(amount: number, color: THREE.ColorRepresentation, seconds: number): void {
    this.flashFrom = amount; this.flashAmt = amount; this.flashColor.set(color); this.flashDur = Math.max(0.001, seconds); this.flashT = 0;
    this.toon.setFlash(amount, this.flashColor);
  }

  /** IMPACT armour glow for `seconds` (also driven by the snapshot's armor flag) */
  glow(seconds: number): void { this.glowHold = Math.max(this.glowHold, seconds); }

  /** attach a prop (Assets.prop clone) to a bone by its §17.1 grip metadata; `show` = when it is visible (null = always) */
  attachProp(obj: THREE.Object3D, a: PropAttach | null, scene: THREE.Object3D, show: PropShow | null = null, id = ''): boolean {
    const meta: PropAttach = a ?? { bone: 'RightHand', pos: [0, 0.08, 0.03], rotDeg: [0, 0, 0] };
    const bone = this.bone(meta.bone);
    if (!bone) return false;
    const offset = new THREE.Matrix4().compose(
      new THREE.Vector3(meta.pos[0], meta.pos[1], meta.pos[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(meta.rotDeg[0] * DEG, meta.rotDeg[1] * DEG, meta.rotDeg[2] * DEG)),
      new THREE.Vector3(1, 1, 1));
    if (meta.mirror) {
      // M * offset * M (M = local X mirror): the other hand's grip, still a proper rotation (the prop is not flipped)
      const M = new THREE.Matrix4().makeScale(-1, 1, 1);
      offset.premultiply(M).multiply(M);
    }
    obj.matrixAutoUpdate = false;
    scene.add(obj);
    this.props.push({ obj, bone, offset, show, id });
    return true;
  }

  /**
   * CHANGED(fixer) D3: presentation-only depth offset (m, toward the camera). BoutView sets the target while a side-swap
   * throw carries this fighter PAST the thrower (thrown_b) so the tumbling body passes in front of the thrower instead of
   * through it (2D fighters layer the victim over the thrower); eased in / out in real time, never touches the sim.
   */
  zTarget = 0;
  private zNow = 0;
  /** CHANGED(VIEW3D): the planar unit vector toward the camera (the zTarget offset direction; BoutView sets it) */
  readonly towardCam = new THREE.Vector3(0, 0, 1);
  /**
   * CHANGED(VIEW3D): the anim table with the §35.5 step clips' _l / _r swapped, used while the model is MIRRORED: the sim
   * picks sidestep_l / sidewalk_l for a step toward the fighter's OWN left, and a mirrored rig's left leg is drawn on its
   * right, so the mirrored body plays the _r clip to move its visible legs the way the root moves.
   */
  private readonly tableMir: ReadonlyArray<AnimRef>;

  /** Apply one snapshot (+ an optional presentation override). `dt` real seconds; `time` real seconds (the shake clock). */
  update(s: ViewFighterSnap, dt: number, time: number, ov?: FighterOverride | null): void {
    this.legIK.restore();                                  // CHANGED(fix_view) D6: last frame's stride IK out before the pose
    const facing = (ov?.facing ?? s.facing) < 0 ? -1 : 1;
    this.zNow += (this.zTarget - this.zNow) * Math.min(1, dt * 10);
    if (Math.abs(this.zNow) < 1e-4) this.zNow = 0;
    this.root.visible = ov?.visible !== false;
    // CHANGED(VIEW3D): world (x, y, z) from the snapshot (SIM3D); the presentation depth offset runs toward the camera
    const tc = this.towardCam;
    this.root.position.set((ov?.x ?? s.x) + tc.x * this.zNow, ov?.y ?? s.y, (ov?.z ?? s.z ?? 0) + tc.z * this.zNow);
    // yaw: the snapshot's body yaw (SIM3D, radians = rotation.y) - else +-90 deg from facing (the 1D labs); facing -1 also
    // MIRRORS the model (local X scale -1, SF4-6 convention, §17.1) so both screen sides show the same silhouette to the
    // camera. The mirror is about the body's own forward axis, so it holds at any yaw.
    // CHANGED(fix_view) D2: the PRESENTED yaw comes from the turn smoother (a cinematic yaw override is shown as given and
    // the smoother follows it); the mirror flips with the sim facing, except that a flip arriving with a big re-face
    // pending waits until the presented turn is half done (the body is edge-on to the camera then).
    const simYaw = typeof s.yaw === 'number' && Number.isFinite(s.yaw) ? s.yaw : facing * 90 * DEG;
    // a teleport / reset (the root jumped > TELEPORT_M since the last presented sim frame) re-presents the body: no turn
    const jx = s.x - this.lastSimX, jz = (s.z ?? 0) - this.lastSimZ, df = this.simFrame - this.lastSimF;
    if (this.lastSimF >= 0 && df >= 0 && df <= 2 && jx * jx + jz * jz > TELEPORT_M * TELEPORT_M) this.turn.reset();
    this.lastSimX = s.x; this.lastSimZ = s.z ?? 0; this.lastSimF = this.simFrame;
    let yaw: number;
    let lockIn = -1;
    if (ov?.yaw !== undefined) { yaw = ov.yaw; this.turn.hold(yaw, simYaw, this.simFrame); }
    else if (this.smoothTurns && this.simFrame >= 0) { lockIn = this.lockIn(s); yaw = this.turn.step(simYaw, this.simFrame, lockIn); }
    else { yaw = simYaw; this.turn.hold(yaw, simYaw, this.simFrame); }
    if (ov?.facing !== undefined || !this.smoothTurns) { this.mirrorSide = facing; this.mirrorHold = 0; }
    else if (facing !== this.mirrorSide) {
      const err = Math.abs(this.turn.last.errDeg);
      if (this.mirrorHold <= 0) this.mirrorHold = Math.max(err, 1e-3);
      if (err < MIRROR_HOLD_DEG || err <= this.mirrorHold / 2) { this.mirrorSide = facing; this.mirrorHold = 0; }
    } else this.mirrorHold = 0;
    const mirror = this.mirror && this.mirrorSide < 0;
    this.root.rotation.set(0, yaw, 0);
    this.root.scale.set(mirror ? -1 : 1, 1, 1);
    const table = mirror ? this.tableMir : this.table;
    let stride = 1;
    this.last.stepP = 0;
    if (ov?.list && ov.list.length) {
      this.pose.poseWeighted(ov.list);
      this.last.override = 'list';
    } else if (ov?.blend && ov.blend.w > 0.001) {
      this.pose.entriesFor(table, s, this.entries);
      const k = Math.min(1, ov.blend.w);
      this.mixed.length = 0;
      for (const e of this.entries) this.mixed.push({ clip: e.clip, t: e.t, w: e.w * (1 - k) });
      for (const e of ov.blend.list) this.mixed.push({ clip: e.clip, t: e.t, w: e.w * k });
      this.pose.poseWeighted(this.mixed);
      this.last.override = 'blend';
    } else if (this.stepSync && this.stepFacts && s.step && s.step.kind === 'sidestep' && (s.step.frame ?? 0) > 0 && this.isStepClip(table, s.animId)) {
      // CHANGED(fix_view) D6: the sidestep clip at the time its OWN lateral travel matches the sim's arc progress
      const F = this.stepFacts, k = s.step.frame ?? 0;
      const clip = table[s.animId].clip;
      this.pose.entriesFor(table, s, this.entries);
      const p = stepProgress(F, k);
      this.entries[0].t = clipTimeAt(F, clip, p, this.pose.dur(clip));
      if (this.entries.length > 1) {
        // the sim's blend counter is 0 on the step's entry frame (blendT 0: a pure previous pose while the root already
        // moved 13 % of the arc): count that frame as one blend frame
        const w = Math.min(1, (this.entries[0].w + 1 / 6) * STEP_BLEND_GAIN);
        this.entries[0].w = w; this.entries[1].w = 1 - w;
      }
      this.pose.poseWeighted(this.entries);
      // stride: full until 3 frames before the step ends, then eased out (the feet close together at its end); the sim's
      // own arc (snapshot step.dist, fix_core §35.20) wins over the data value when the snapshot carries it
      const fade = Math.max(0, Math.min(1, (F.frames - k) / 3));
      const sd = s.step.dist;
      const sc = typeof sd === 'number' && sd > 0.05 && F.lat[clip]?.len > 0.05 ? sd / F.lat[clip].len : strideScale(F, clip);
      stride = 1 + (sc - 1) * fade;
      this.last.stepP = Math.round(p * 1000) / 1000;
      this.last.override = 'step';
    } else {
      this.pose.pose(table, s);
      this.last.override = '';
    }
    // victim shake: +-2 cm along the fight line at 30 Hz while the hitstop lasts (view only)
    const hs = ov?.list ? 0 : s.hitstop ?? 0;
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
    // CHANGED(fix_view) D5: the light this body receives, capped where a stage's pool is far brighter than the rest
    const rp = this.root.position;
    const lk = this.lightProbe ? this.lightProbe(rp.x, rp.y + this.heightM * 0.62, rp.z) : 1;
    this.toon.setLight(lk);
    // CHANGED(fix_view) D6: the stride scale (after the pose: the leg IK reads the posed bones)
    const needMw = this.props.length > 0 || Math.abs(stride - 1) > 1e-3;
    if (needMw) this.root.updateMatrixWorld(true);
    if (Math.abs(stride - 1) > 1e-3) this.legIK.apply(this.root, stride); else { this.legIK.lastShift = 0; this.legIK.lastDrop = 0; }
    // props: visibility by rule, then the world-space full-basis solve
    let shown = 0;
    if (this.props.length) {
      const mn = s.moveName ?? '';
      const mf = s.moveFrame ?? 0;
      for (const p of this.props) {
        const vis = this.root.visible && (!p.show || propVisible(p.show, mn, mf, this.startupOf.get(mn) ?? 1, ov?.inCinematic ? this.pose.last.clip || ' ' : ''));
        p.obj.visible = vis;
        if (!vis) continue;
        shown++;
        p.bone.matrixWorld.decompose(this.mp, this.mq, this.ms);
        this.mm.compose(this.mp, this.mq, this.ms.set(this.ms.x < 0 ? -1 : 1, 1, 1)).multiply(p.offset);
        p.obj.matrix.copy(this.mm);
        p.obj.matrixWorldNeedsUpdate = true;
      }
    }
    const L = this.last;
    L.shake = shake; L.facing = facing; L.x = this.root.position.x; L.y = this.root.position.y; L.z = this.root.position.z;
    L.yawDeg = Math.round(((yaw * 180 / Math.PI) % 360 + 360) % 360 * 10) / 10; L.mirror = mirror;
    L.clip = this.pose.last.clip; L.t = this.pose.last.t; L.w = this.pose.last.w;
    L.props = this.props.length; L.propsShown = shown;
    L.simYawDeg = Math.round(((simYaw * 180 / Math.PI) % 360 + 360) % 360 * 10) / 10;
    L.turnErr = this.turn.last.errDeg; L.turnSnap = this.turn.last.snap; L.lockIn = lockIn;
    L.stride = Math.round(stride * 1000) / 1000; L.ikShift = Math.round(this.legIK.lastShift * 1000) / 1000; L.ikDrop = Math.round(this.legIK.lastDrop * 1000) / 1000;
    L.top = Math.round(this.neutralTopM * 1000) / 1000; L.lightK = Math.round(lk * 1000) / 1000;
  }

  /** CHANGED(fix_view) D6 read-back (harness): world positions of the ankles + toes [lx, ly, lz, ltx, lty, ltz, rx, ...] */
  feetInfo(): number[] {
    const out: number[] = [];
    for (const n of ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase']) {
      if (this.bonePos(n, this.mp)) out.push(Math.round(this.mp.x * 1e4) / 1e4, Math.round(this.mp.y * 1e4) / 1e4, Math.round(this.mp.z * 1e4) / 1e4);
      else out.push(0, 0, 0);
    }
    return out;
  }

  /** CHANGED(fix_view) D6: is table[id] one of the §35.5 sidestep clips the GLB carries? */
  private isStepClip(table: ReadonlyArray<AnimRef>, id: number): boolean {
    const e = id >= 0 && id < table.length ? table[id] : null;
    return !!e && (e.clip === 'sidestep_l' || e.clip === 'sidestep_r') && this.pose.has(e.clip);
  }

  /**
   * CHANGED(fix_view) D2: sim frames until this fighter's own first active frame (0 = an active frame now), -1 = no
   * attack (or past the last active frame: the yaw is frozen there anyway). Move frames are 1-based; active frames are
   * startup .. startup + active - 1 (compile.ts lastActive).
   */
  private lockIn(s: ViewFighterSnap): number {
    const mn = s.moveName;
    if (!mn || mn === 'parry' || mn === 'rush') return -1;
    if (s.stateName !== undefined && s.stateName !== 'attack' && s.stateName !== 'grab' && s.stateName !== 'cinematic') return -1;
    const f = s.moveFrame ?? 0;
    if (f <= 0) return -1;
    const m = this.def?.moves?.[mn];
    if (!m || typeof m.startup !== 'number') return f <= SYS_FIRST_ACTIVE ? SYS_FIRST_ACTIVE - f : -1;
    const last = m.startup + Math.max(1, m.active ?? 1) - 1;
    if (f > last) return -1;
    return Math.max(0, m.startup - f);
  }

  /** CHANGED(fix_view) D13 read-back: the POSED silhouette top this frame (world y; bone boxes, view/bodytop.ts) */
  liveTop(): number { return this.bodyTop && this.bodyTop.ok ? this.bodyTop.top() : this.topY(); }

  /**
   * CHANGED(fix_view) D13: the silhouette top the camera frames (world m): the measured neutral top (head + a raised limb,
   * view/bodytop.ts) above the root, or the live head / raised hands when higher (jumps, a crouch is lower: no bob).
   */
  camTop(airborne: boolean): number {
    const base = this.root.position.y + this.neutralTopM;
    return Math.max(base, airborne ? this.topY() : this.headY());
  }

  /** world head-top height (m) for the camera's jump pan (CHANGED(fix_view) D13: never below the HeadTop_End bone + hair) */
  headY(): number {
    let y = -Infinity;
    if (this.head) { this.head.getWorldPosition(this.mp); y = this.mp.y + 0.24 * (this.heightM / 1.8); }   // head bone -> hair top
    if (this.headTop) { this.headTop.getWorldPosition(this.mp); y = Math.max(y, this.mp.y + 0.04 * (this.heightM / 1.8)); }   // skull top -> hair
    return Number.isFinite(y) ? y : this.root.position.y + this.heightM;
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
    return out.set(this.root.position.x, this.root.position.y + this.heightM * 0.7, this.root.position.z);
  }

  /** world position of a named bone (FX / prop anchors); false when the body has no such bone */
  bonePos(name: string, out: THREE.Vector3): boolean {
    const b = this.bone(name);
    if (!b) return false;
    b.getWorldPosition(out);
    return true;
  }

  /** the body's facing on the floor plane (unit XZ), from the shoulder line - follows spins in a clip */
  forward(out: THREE.Vector3): THREE.Vector3 {
    const l = this.bone('LeftShoulder') ?? this.bone('LeftArm'), r = this.bone('RightShoulder') ?? this.bone('RightArm');
    if (!l || !r) { const y = this.root.rotation.y; return out.set(Math.sin(y), 0, Math.cos(y)); }
    l.getWorldPosition(this.mp); r.getWorldPosition(out);
    const dx = out.x - this.mp.x, dz = out.z - this.mp.z;           // R - L
    // character facing +Z has its right shoulder at -X: forward = up x (R - L); a mirrored model flips the handedness
    const s = this.root.scale.x < 0 ? -1 : 1;
    out.set(dz * s, 0, -dx * s);
    const n = Math.hypot(out.x, out.z);
    if (n > 1e-5) return out.multiplyScalar(1 / n);
    const y = this.root.rotation.y;
    return out.set(Math.sin(y), 0, Math.cos(y));
  }

  /** read-back of attached props (lab / harness) */
  propInfo(): Array<{ id: string; visible: boolean; bone: string }> {
    return this.props.map((p) => ({ id: p.id, visible: p.obj.visible, bone: p.bone.name }));
  }

  dispose(): void {
    this.pose.dispose();
    this.toon.dispose();
    for (const p of this.props) p.obj.removeFromParent();
    this.root.removeFromParent();
  }
}
