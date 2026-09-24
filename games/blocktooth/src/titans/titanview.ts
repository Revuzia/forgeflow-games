// BLOCKTOOTH — the titan on screen (lane titan-view; CONTRACT §6).
//
// Mounts the hero model for world.titanId, scales it to titan.height, interpolates the pose
// between sim ticks, turns sim state + events into AnimState for the procedural animator,
// and drives the glow parts (MOLO throat/gills, VOLT-KITE static mane + kite fin, HEARTHBACK
// magma seams + crater by kit.stored/kit.cap, BRIARWICK spore pods). Reads the sim, never writes it.
//
// Run end (F18): on 'dead' the animator plays the DEFEAT pose (stagger → topple onto the flank →
// bounce → legs out, eyes shut) — this view picks the flank that turns the belly to the camera,
// keeps the fallen body resting ON the ground (skinned-vertex ground clamp while it moves) and
// kicks a dust skirt along the flank at impact; on 'clear' it plays the victory roar. Both run
// inside the app's 2.5 s aftermath, BEFORE the tabloid's freeze-frame photo is taken.

import * as THREE from 'three';
import type { SimEvent, TitanId, World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from '../render/viewtypes.ts';
import { lerpPose } from '../render/viewtypes.ts';
import { clamp, lerpAngle, wrapAngle } from '../core/math.ts';
import { SIM_DT } from '../core/config.ts';
import { titanMaxSpeed } from './titansim.ts';
import { applyGlow, buildTitanModel, setTitanFill, setTitanRim } from './models.ts';
import { BIOMES } from '../data/biomes.ts';
import type { TitanModel } from './models.ts';
import { DEFEAT, TitanAnimator } from './anim.ts';
import { addOutline, bakeOutlineNormals, makeToon } from '../render/materials.ts';
import type { AnimState } from './anim.ts';

/**
 * Night look (LOCKWATER). The navy street (#0d1a26) and the #1b1426 ink leave a dark hide with no
 * value to read against (F07 / PC-05: VOLT-KITE's indigo body measured 45.9 mean luma on a 48.0
 * street at Size I — invisible). Two titan-only terms on the body material, no bloom:
 *   fill — a character light: + fill × painted albedo (diffuse value lift, toon steps kept);
 *   rim  — a stepped fresnel edge band tinted palette.rim (magenta neon) so the silhouette gets a
 *          bright edge for the ink line to sit against.
 * Per titan because the hides differ: MOLO's jade already reads (111 vs 47), HEARTHBACK's basalt
 * must stay the darkest hide (its magma seams are its identity — lifted, not washed out),
 * VOLT-KITE's indigo needs the most. Tuned with _harness/scratch/titans/rimprobe.py.
 */
const NIGHT_LOOK: Record<TitanId, { fill: number; rim: number }> = {
  molo: { fill: 0, rim: 0.26 },
  voltkite: { fill: 1.1, rim: 0.5 },
  hearthback: { fill: 0.5, rim: 0.45 },
  briarwick: { fill: 0.12, rim: 0.3 },
};
/** fresnel band edges (1 − |n·v|) for the in-game rim: wider than the portrait's hero rim */
const NIGHT_RIM_BAND = [0.46, 0.58] as const;

/** how long a pose timer keeps counting after its event (s) — longer than every pose it drives */
const TIMER_MAX = 3;

/** advance a "seconds since" pose timer; < 0 = inactive, expires after TIMER_MAX */
function advT(v: number, dt: number): number { return v >= 0 ? (v + dt > TIMER_MAX ? -1 : v + dt) : v; }
/** linear decay of a 0..1 glow kick */
function decay(v: number, rate: number, dt: number): number { return Math.max(0, v - dt * rate); }
/** read a kit number with a default (NaN-safe) */
function kitNum(K: Record<string, number>, k: string, d = 0): number { const v = K[k]; return v === undefined || v !== v ? d : v; }

/** DEFEAT dust skirt: puffs kicked along the flank at impact (a private pool — shown only then) */
const DUST_N = 18;
/** the ground clamp stops re-measuring this long after death (the pose is at rest by then) */
const CLAMP_UNTIL_S = 3.2;
/** skinned vertices sampled per mesh per frame for the ground clamp */
const CLAMP_SAMPLES = 700;
interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; t: number; life: number; rot: number }
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dp = new THREE.Vector3(), _ds = new THREE.Vector3(), _de = new THREE.Euler();
const _cv = new THREE.Vector3();

export class TitanView implements ViewModule {
  private readonly ctx: ViewCtx;
  private model: TitanModel | null = null;
  private anim: TitanAnimator | null = null;
  private id: TitanId | null = null;
  private readonly st: AnimState = {
    speed01: 0, moving: false, turn: 0, attack: null, attackT: -1, dashT: -1, hurtT: -1,
    abilityT: -1, growT: -1, t: 0, kit: {}, speedH: 0, hurtAmt: 0.5, noFlash: false, deadT: -1, aim: 0,
    downSide: 1, clearT: -1,
  };
  // run-end: ground clamp lift (m) + DEFEAT dust
  private lift = 0;
  private dustDone = false;
  private dust: THREE.InstancedMesh | null = null;
  private readonly puffs: Puff[] = [];
  private dustLive = 0;
  private dustGeo: THREE.BufferGeometry | null = null;
  private dustMat: THREE.Material | null = null;
  // tick-to-tick height interpolation (the grow tween advances per sim tick)
  private lastTick = -1;
  private hPrev = 1;
  private hCur = 1;
  // glow kicks (decay per frame)
  private kPulse = 0; private kArc = 0; private kDet = 0; private kVent = 0; private kStomp = 0; private kSpore = 0; private kAbility = 0;
  private aimT = -1;
  private glowOut = 1;
  private aimYaw = 0;
  private shadowsOn = true;

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
  }

  /** The mounted model's root (null when unmounted) — for cameras / photo framing. */
  get object(): THREE.Object3D | null { return this.model ? this.model.root : null; }

  mount(w: World): void {
    if (!this.model || this.id !== w.titanId) {
      this.disposeModel();
      this.model = buildTitanModel(w.titanId);
      this.id = w.titanId;
      this.anim = new TitanAnimator(this.model, this.id);
    }
    if (this.model.root.parent !== this.ctx.scene) this.ctx.scene.add(this.model.root);
    this.ensureDust(w);
    const s = this.st;
    s.attack = null; s.attackT = -1; s.dashT = -1; s.hurtT = -1; s.abilityT = -1; s.growT = -1; s.deadT = -1;
    s.clearT = -1; s.downSide = 1;
    this.lift = 0; this.dustDone = false; this.dustLive = 0;
    for (const p of this.puffs) p.t = p.life;
    if (this.dust) { this.dust.count = 0; this.dust.visible = false; }
    s.speed01 = 0; s.speedH = 0; s.turn = 0; s.moving = false; s.aim = 0;
    this.kPulse = this.kArc = this.kDet = this.kVent = this.kStomp = this.kSpore = this.kAbility = 0;
    this.aimT = -1; this.aimYaw = 0;
    const T = w.titan;
    this.lastTick = w.tick;
    this.hPrev = this.hCur = T.height;
    this.applyShadows(this.ctx.quality.shadows);
    this.applyBiomeRim(w);
    // place + settle one frame so the first rendered frame is already posed
    this.placeRoot(w, 1);
    s.kit = T.kit;
    this.anim!.update(s, 0);
    this.driveGlow(w, 0);
  }

  update(w: World, f: FrameInfo): void {
    const model = this.model, anim = this.anim;
    if (!model || !anim) return;
    const T = w.titan;
    const s = this.st;
    const dt = f.dt;
    if (this.shadowsOn !== this.ctx.quality.shadows) this.applyShadows(this.ctx.quality.shadows);

    if (w.tick !== this.lastTick) {
      this.hPrev = w.tick === this.lastTick + 1 ? this.hCur : T.height;
      this.hCur = T.height;
      this.lastTick = w.tick;
    }
    this.onEvents(w, f.events);

    // pose timers (real time: cosmetic)
    s.attackT = advT(s.attackT, dt); if (s.attackT < 0) s.attack = null;
    s.dashT = advT(s.dashT, dt);
    s.hurtT = advT(s.hurtT, dt);
    s.abilityT = advT(s.abilityT, dt);
    s.growT = advT(s.growT, dt);
    if (!T.alive) {
      if (s.deadT! < 0) {
        // land on the flank that turns the belly to the camera (camera yaw 45°: it sits at +X+Z).
        // Model +X is world (cos h, 0, −sin h); falling onto the right flank (downSide +1) turns
        // the belly to model +X.
        s.downSide = this.pickDownSide(w);
        s.deadT = 0;
      } else s.deadT! += dt;
    } else s.deadT = -1;
    if (w.run.result === 'clear' && T.alive) s.clearT = s.clearT! >= 0 ? s.clearT! + dt : 0; else s.clearT = -1;
    if (this.aimT >= 0) { this.aimT += dt; if (this.aimT > 0.6) this.aimT = -1; }

    // locomotion
    const H = Math.max(0.01, T.height);
    const top = Math.max(0.1, titanMaxSpeed(w));
    if (f.frozen || !T.alive || w.run.result) {       // the run is over: no walking in place
      s.speed01 = 0; s.speedH = 0; s.turn = 0; s.moving = false;
    } else {
      s.speed01 = clamp(T.speed / top, 0, 1.5);
      s.speedH = T.speed / H;
      s.turn = wrapAngle(T.heading - T.pheading) / SIM_DT;
      s.moving = T.moving || T.dashT > 0;
    }
    s.aim = this.aimT >= 0 ? this.aimYaw * (1 - clamp((this.aimT - 0.35) / 0.25, 0, 1)) : 0;
    s.kit = T.kit;
    s.t = f.time;
    s.noFlash = this.ctx.quality.reduceFlashing;

    this.placeRoot(w, f.alpha);
    anim.update(s, dt);
    if (s.deadT! >= 0) this.groundClamp(s.deadT!);
    this.driveGlow(w, dt);
    this.updateDust(w, dt);
  }

  unmount(): void {
    this.disposeModel();
    if (this.dust) {
      this.dust.removeFromParent();
      this.dust.dispose();
      this.dust = null;
    }
    this.dustGeo?.dispose(); this.dustGeo = null;
    this.dustMat?.dispose(); this.dustMat = null;
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private placeRoot(w: World, alpha: number): void {
    const T = w.titan, root = this.model!.root;
    const a = clamp(alpha, 0, 1);
    root.position.set(lerpPose(T.px, T.x, a), 0, lerpPose(T.pz, T.z, a));
    root.rotation.set(0, lerpAngle(T.pheading, T.heading, a), 0);
    root.scale.setScalar(Math.max(0.01, lerpPose(this.hPrev, this.hCur, a)));
    if (this.lift !== 0) root.position.y = this.lift;
  }

  /**
   * Keep the toppled body resting ON the ground: the animator rolls the skeleton about the
   * down-side foot edge, which leaves the flank a little below / above y = 0 depending on the
   * hide's girth. Measure the lowest skinned vertex (strided sample, only while the fall is in
   * motion) and lift the root by exactly that.
   */
  private groundClamp(deadT: number): void {
    const model = this.model!;
    if (deadT > CLAMP_UNTIL_S) return;                        // at rest: keep the last lift
    if (deadT < DEFEAT.toppleStart) { this.lift = 0; return; }
    const root = model.root;
    root.position.y = 0;
    root.updateMatrixWorld(true);
    let minY = Infinity;
    for (const m of model.meshes) {
      if (!m.visible) continue;
      const pos = m.geometry.getAttribute('position');
      if (!pos) continue;
      const n = pos.count;
      const stride = Math.max(1, Math.floor(n / CLAMP_SAMPLES));
      for (let i = 0; i < n; i += stride) {
        m.getVertexPosition(i, _cv);
        _cv.applyMatrix4(m.matrixWorld);
        if (_cv.y < minY) minY = _cv.y;
      }
    }
    this.lift = Number.isFinite(minY) ? -minY : 0;
    root.position.y = this.lift;
  }

  /**
   * Which flank to fall on. Preferred: the one that turns the belly (and the legs-out silhouette)
   * to the camera. But a titan falling into a standing building, or landing behind one from the
   * camera's point of view, would vanish from the front-page photo — so score both flanks by the
   * standing buildings over the landing strip and on the sight line from it to the camera
   * (yaw 45°: the camera sits at +X+Z), and take the clearer one (ties keep the preferred flank).
   */
  private pickDownSide(w: World): number {
    const T = w.titan, model = this.model;
    const H = Math.max(0.01, T.height);
    const h = T.heading;
    const mx = Math.cos(h), mz = -Math.sin(h);                   // model +X in world
    const fx = Math.sin(h), fz = Math.cos(h);                    // forward
    const pref = mx * 0.7071 + mz * 0.7071 >= 0 ? 1 : -1;        // belly toward the camera
    const zMin = model ? model.size.zMin * H : -0.5 * H, zMax = model ? model.size.zMax * H : 0.5 * H;
    const blds = w.city.buildings;
    const solidAt = (x: number, z: number, y: number): number => {
      for (let i = 0; i < blds.length; i++) {
        const b = blds[i];
        if (b.collapsed || b.alive <= 0) continue;
        if (b.alive * b.floorH <= y) continue;
        if (Math.abs(x - b.x) <= b.w * 0.5 && Math.abs(z - b.z) <= b.d * 0.5) return 1;
      }
      return 0;
    };
    const score = (side: number): number => {
      // the body lands across −X·side (model), about half a body-height out
      const dx = -side * mx, dz = -side * mz;
      let n = 0;
      for (let a = 0; a < 3; a++) {
        const along = zMin + (zMax - zMin) * (a + 0.5) / 3;
        for (const out of [0.35, 0.75]) {
          const x = T.x + fx * along + dx * out * H, z = T.z + fz * along + dz * out * H;
          n += 2 * solidAt(x, z, 0.1 * H);
          // sight line to the camera (pitch ~40°: the ray rises ~0.84 m per horizontal metre)
          for (const d of [0.6, 1.2, 1.8]) n += solidAt(x + 0.7071 * d * H, z + 0.7071 * d * H, 0.2 * H + 0.84 * d * H);
        }
      }
      return n;
    };
    const a = score(pref), b = score(-pref);
    return b < a ? -pref : pref;
  }

  /** the private DEFEAT dust pool (faceted toon puffs + ink hull, like the fx dust), built once */
  private ensureDust(w: World): void {
    const col = w.biomeId === 'whitestacks' ? '#f3f5f8' : w.biomeId === 'lockwater' ? '#b7b2c8' : '#f1e6cf';
    if (!this.dust) {
      let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.5, 1);   // polyhedra are already non-indexed (faceted)
      g.computeVertexNormals();
      g = bakeOutlineNormals(g);
      g.computeBoundingSphere();
      const mat = makeToon({ color: col, emissive: '#6f675d', emissiveIntensity: 0.35 });
      const im = new THREE.InstancedMesh(g, mat, DUST_N);
      im.name = 'titan:defeatDust';
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = false; im.receiveShadow = true;
      im.count = 0;
      im.visible = false;
      addOutline(im, 1.6);
      this.dust = im; this.dustGeo = g; this.dustMat = mat;
      for (let i = 0; i < DUST_N; i++) this.puffs.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, t: 1, life: 1, rot: 0 });
    } else {
      (this.dustMat as THREE.MeshToonMaterial).color.set(col);
    }
    if (this.dust.parent !== this.ctx.scene) this.ctx.scene.add(this.dust);
  }

  /** kick the skirt along the down-side flank (world space), once per death, at impact */
  private kickDust(w: World): void {
    const T = w.titan, model = this.model;
    if (!model) return;
    const H = Math.max(0.01, this.hCur);
    const side = this.st.downSide!;
    const hx = Math.sin(T.heading), hz = Math.cos(T.heading);   // forward
    const rx = hz, rz = -hx;                                     // model +X in world
    // the flank lands ~one body-height of girth out from the down-side foot edge
    const off = -side * (model.size.width * 0.5 + 0.25) * H;
    const zMin = model.size.zMin * H, zMax = model.size.zMax * H;
    for (let i = 0; i < DUST_N; i++) {
      const p = this.puffs[i];
      const u = (i + 0.5) / DUST_N;
      const along = zMin + (zMax - zMin) * u + (Math.random() - 0.5) * 0.08 * H;
      const lat = off + (Math.random() - 0.5) * 0.5 * H;
      p.x = T.x + hx * along + rx * lat;
      p.z = T.z + hz * along + rz * lat;
      p.y = 0.05 * H;
      // out along the ground, away from the body (both sides of the flank), a little up
      const out = (i % 3 === 0 ? 1 : -1) * side;
      const sp = H * (0.5 + Math.random() * 0.7);
      p.vx = rx * out * sp + hx * (u - 0.5) * sp;
      p.vz = rz * out * sp + hz * (u - 0.5) * sp;
      p.vy = H * (0.25 + Math.random() * 0.35);
      p.s = H * (0.07 + Math.random() * 0.07);
      p.t = 0;
      p.life = 1.9 + Math.random() * 0.7;
      p.rot = Math.random() * 6.28;
    }
  }

  private updateDust(w: World, dt: number): void {
    const im = this.dust;
    if (!im) return;
    const deadT = this.st.deadT!;
    if (deadT >= DEFEAT.impact && !this.dustDone) { this.dustDone = true; this.kickDust(w); }
    let n = 0;
    for (const p of this.puffs) {
      if (p.t >= p.life) continue;
      p.t += dt;
      if (p.t >= p.life) continue;
      const drag = Math.exp(-2.4 * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const u = p.t / p.life;
      // swell fast, hold, shrink away (dust never pops out)
      const k = u < 0.18 ? u / 0.18 : u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      const sc = Math.max(0.001, p.s * (0.45 + 0.55 * k) * (u < 0.6 ? 1 : k));
      _dp.set(p.x, p.y + sc * 0.3, p.z);
      _de.set(0, p.rot + u * 1.5, 0);
      _dq.setFromEuler(_de);
      _ds.set(sc, sc * 0.8, sc);
      im.setMatrixAt(n++, _dm.compose(_dp, _dq, _ds));
    }
    this.dustLive = n;
    im.count = n;
    im.visible = n > 0;
    if (n > 0) im.instanceMatrix.needsUpdate = true;
  }

  private onEvents(w: World, events: readonly SimEvent[]): void {
    const s = this.st, T = w.titan;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      switch (ev.type) {
        case 'titanAttack':
          s.attack = ev.attack; s.attackT = 0;
          this.aimYaw = clamp(wrapAngle(ev.dir - T.heading), -1.1, 1.1); this.aimT = 0;
          break;
        case 'dash': s.dashT = 0; break;
        case 'ability': s.abilityT = 0; this.kAbility = 1; break;
        case 'titanHurt':
          s.hurtT = 0;
          s.hurtAmt = clamp((ev.dmg / Math.max(1, T.maxHp)) * 10, 0.3, 1);
          break;
        case 'rankUp': s.growT = 0; break;
        case 'pulse': this.kPulse = 1; break;
        case 'arc': if (ev.kind === 'fork') this.kArc = 1; break;
        case 'wireDetonate': this.kDet = 1; break;
        case 'vent': this.kVent = 1; break;
        case 'explosion': if (ev.kind === 'stomp') this.kStomp = 1; else if (ev.kind === 'arc' && this.id === 'voltkite') this.kDet = Math.max(this.kDet, 0.7); break;
        case 'spore': case 'bloomSpawn': this.kSpore = Math.max(this.kSpore, ev.type === 'spore' ? 1 : 0.5); break;
        default: break;
      }
    }
  }

  private driveGlow(w: World, dt: number): void {
    // DEFEAT: the glow parts gutter out as the titan goes down (a clear keeps them blazing)
    const out = this.st.deadT! >= 0 ? 1 - 0.75 * clamp(this.st.deadT! / DEFEAT.impact, 0, 1) : 1;
    this.glowOut = out;
    if (this.st.clearT! >= 0 && this.kAbility < 0.6) this.kAbility = 0.6;
    const K = w.titan.kit;
    const calm = this.ctx.quality.reduceFlashing;
    this.kPulse = decay(this.kPulse, 3, dt); this.kArc = decay(this.kArc, 5, dt); this.kDet = decay(this.kDet, 1.8, dt);
    this.kVent = decay(this.kVent, 1.4, dt); this.kStomp = decay(this.kStomp, 3, dt); this.kSpore = decay(this.kSpore, 1.2, dt);
    this.kAbility = decay(this.kAbility, 1.5, dt);
    const spike = calm ? 0.5 : 1;
    switch (this.id) {
      case 'molo': {
        const vac = kitNum(K, 'vacuumT') > 0 ? 1 : 0;
        this.glow(0.22 + 0.8 * vac + 0.6 * this.kPulse * spike + 0.3 * this.kAbility * spike);
        break;
      }
      case 'voltkite': {
        const wires = clamp(kitNum(K, 'wires') / 6, 0, 1);
        const flick = calm ? 0 : (Math.random() - 0.5) * 0.22;
        this.glow(0.55 + 0.2 * wires + flick + (0.45 * this.kArc + 0.8 * this.kDet) * spike, 0);
        this.glow(0.45 + 0.55 * wires + 0.6 * this.kDet * spike, 1);
        break;
      }
      case 'hearthback': {
        const cap = kitNum(K, 'cap', 0);
        const fill = cap > 0 ? clamp(kitNum(K, 'stored') / cap, 0, 1) : 0;
        this.glow(0.12 + 0.88 * fill + 0.5 * this.kVent * spike, 0);
        this.glow(0.3 + 0.7 * fill + (0.9 * this.kVent + 0.35 * this.kStomp) * spike, 1);
        break;
      }
      case 'briarwick': {
        const cap = Math.max(1, w.titan.stats && Number.isFinite(w.titan.stats.turretCap) ? w.titan.stats.turretCap : 4);
        const turrets = clamp(kitNum(K, 'turrets') / cap, 0, 1);
        const sow = kitNum(K, 'sowT') > 0 ? 1 : 0;
        this.glow(0.3 + 0.2 * turrets + 0.45 * sow + 0.7 * this.kSpore * spike);
        break;
      }
      default: break;
    }
  }

  /** applyGlow scaled by the run-end dimmer */
  private glow(level: number, index = -1): void { applyGlow(this.model!, level * this.glowOut, index); }

  private applyBiomeRim(w: World): void {
    const model = this.model!;
    const b = BIOMES[w.biomeId];
    if (!b || b.time !== 'night') { setTitanRim(model, '#ffffff', 0); setTitanFill(model, 0); return; }
    const look = NIGHT_LOOK[w.titanId];
    setTitanRim(model, b.palette.rim ?? b.palette.sign, look.rim, NIGHT_RIM_BAND[0], NIGHT_RIM_BAND[1]);
    setTitanFill(model, look.fill);
  }

  private applyShadows(on: boolean): void {
    this.shadowsOn = on;
    if (!this.model) return;
    for (const m of this.model.meshes) {
      const isEyes = m.name.startsWith('titanEyes');
      m.castShadow = on && !isEyes;
      m.receiveShadow = on && m.name.startsWith('titanBody');
    }
  }

  private disposeModel(): void {
    if (this.model) this.model.dispose();
    this.model = null;
    this.anim = null;
    this.id = null;
  }
}
