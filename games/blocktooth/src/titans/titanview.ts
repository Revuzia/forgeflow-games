// BLOCKTOOTH — the titan on screen (lane titan-view; CONTRACT §6).
//
// Mounts the hero model for world.titanId, scales it to titan.height, interpolates the pose
// between sim ticks, turns sim state + events into AnimState for the procedural animator,
// and drives the glow parts (MOLO throat/gills, VOLT-KITE static mane + kite fin, HEARTHBACK
// magma seams + crater by kit.stored/kit.cap, BRIARWICK spore pods). Reads the sim, never writes it.

import type * as THREE from 'three';
import type { SimEvent, TitanId, World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from '../render/viewtypes.ts';
import { lerpPose } from '../render/viewtypes.ts';
import { clamp, lerpAngle, wrapAngle } from '../core/math.ts';
import { SIM_DT } from '../core/config.ts';
import { titanMaxSpeed } from './titansim.ts';
import { applyGlow, buildTitanModel } from './models.ts';
import type { TitanModel } from './models.ts';
import { TitanAnimator } from './anim.ts';
import type { AnimState } from './anim.ts';

/** how long a pose timer keeps counting after its event (s) — longer than every pose it drives */
const TIMER_MAX = 3;

/** advance a "seconds since" pose timer; < 0 = inactive, expires after TIMER_MAX */
function advT(v: number, dt: number): number { return v >= 0 ? (v + dt > TIMER_MAX ? -1 : v + dt) : v; }
/** linear decay of a 0..1 glow kick */
function decay(v: number, rate: number, dt: number): number { return Math.max(0, v - dt * rate); }
/** read a kit number with a default (NaN-safe) */
function kitNum(K: Record<string, number>, k: string, d = 0): number { const v = K[k]; return v === undefined || v !== v ? d : v; }

export class TitanView implements ViewModule {
  private readonly ctx: ViewCtx;
  private model: TitanModel | null = null;
  private anim: TitanAnimator | null = null;
  private id: TitanId | null = null;
  private readonly st: AnimState = {
    speed01: 0, moving: false, turn: 0, attack: null, attackT: -1, dashT: -1, hurtT: -1,
    abilityT: -1, growT: -1, t: 0, kit: {}, speedH: 0, hurtAmt: 0.5, noFlash: false, deadT: -1, aim: 0,
  };
  // tick-to-tick height interpolation (the grow tween advances per sim tick)
  private lastTick = -1;
  private hPrev = 1;
  private hCur = 1;
  // glow kicks (decay per frame)
  private kPulse = 0; private kArc = 0; private kDet = 0; private kVent = 0; private kStomp = 0; private kSpore = 0; private kAbility = 0;
  private aimT = -1;
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
    const s = this.st;
    s.attack = null; s.attackT = -1; s.dashT = -1; s.hurtT = -1; s.abilityT = -1; s.growT = -1; s.deadT = -1;
    s.speed01 = 0; s.speedH = 0; s.turn = 0; s.moving = false; s.aim = 0;
    this.kPulse = this.kArc = this.kDet = this.kVent = this.kStomp = this.kSpore = this.kAbility = 0;
    this.aimT = -1; this.aimYaw = 0;
    const T = w.titan;
    this.lastTick = w.tick;
    this.hPrev = this.hCur = T.height;
    this.applyShadows(this.ctx.quality.shadows);
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
    if (!T.alive) s.deadT = s.deadT! >= 0 ? s.deadT! + dt : 0; else s.deadT = -1;
    if (this.aimT >= 0) { this.aimT += dt; if (this.aimT > 0.6) this.aimT = -1; }

    // locomotion
    const H = Math.max(0.01, T.height);
    const top = Math.max(0.1, titanMaxSpeed(w));
    if (f.frozen || !T.alive) {
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
    this.driveGlow(w, dt);
  }

  unmount(): void {
    this.disposeModel();
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private placeRoot(w: World, alpha: number): void {
    const T = w.titan, root = this.model!.root;
    const a = clamp(alpha, 0, 1);
    root.position.set(lerpPose(T.px, T.x, a), 0, lerpPose(T.pz, T.z, a));
    root.rotation.set(0, lerpAngle(T.pheading, T.heading, a), 0);
    root.scale.setScalar(Math.max(0.01, lerpPose(this.hPrev, this.hCur, a)));
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
    const model = this.model!;
    const K = w.titan.kit;
    const calm = this.ctx.quality.reduceFlashing;
    this.kPulse = decay(this.kPulse, 3, dt); this.kArc = decay(this.kArc, 5, dt); this.kDet = decay(this.kDet, 1.8, dt);
    this.kVent = decay(this.kVent, 1.4, dt); this.kStomp = decay(this.kStomp, 3, dt); this.kSpore = decay(this.kSpore, 1.2, dt);
    this.kAbility = decay(this.kAbility, 1.5, dt);
    const spike = calm ? 0.5 : 1;
    switch (this.id) {
      case 'molo': {
        const vac = kitNum(K, 'vacuumT') > 0 ? 1 : 0;
        applyGlow(model, 0.22 + 0.8 * vac + 0.6 * this.kPulse * spike + 0.3 * this.kAbility * spike);
        break;
      }
      case 'voltkite': {
        const wires = clamp(kitNum(K, 'wires') / 6, 0, 1);
        const flick = calm ? 0 : (Math.random() - 0.5) * 0.22;
        applyGlow(model, 0.55 + 0.2 * wires + flick + (0.45 * this.kArc + 0.8 * this.kDet) * spike, 0);
        applyGlow(model, 0.45 + 0.55 * wires + 0.6 * this.kDet * spike, 1);
        break;
      }
      case 'hearthback': {
        const cap = kitNum(K, 'cap', 0);
        const fill = cap > 0 ? clamp(kitNum(K, 'stored') / cap, 0, 1) : 0;
        applyGlow(model, 0.12 + 0.88 * fill + 0.5 * this.kVent * spike, 0);
        applyGlow(model, 0.3 + 0.7 * fill + (0.9 * this.kVent + 0.35 * this.kStomp) * spike, 1);
        break;
      }
      case 'briarwick': {
        const cap = Math.max(1, w.titan.stats && Number.isFinite(w.titan.stats.turretCap) ? w.titan.stats.turretCap : 4);
        const turrets = clamp(kitNum(K, 'turrets') / cap, 0, 1);
        const sow = kitNum(K, 'sowT') > 0 ? 1 : 0;
        applyGlow(model, 0.3 + 0.2 * turrets + 0.45 * sow + 0.7 * this.kSpore * spike);
        break;
      }
      default: break;
    }
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
