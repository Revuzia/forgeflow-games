// Ceremonies (DESIGN.md section 6): the capsule open reveal (6.3) and the merge ceremony (6.4).
//
// The CeremonyDirector advances one run at a time, once per stage.update(), and drives the stage through a small CeremonyHost:
//   * stage-OWNED bodies (created through spec.createBody, stepped by the stage) rendered through BodyProxy puppets,
//   * the capsule object, the shared Particles system, the ScreenFx light ramp, camera offsets (push / arc), the time-scale dip,
//   * the beats the shell hooks audio and haptics to: grab, crack, burst, reveal (capsule) / press, fold, charge, burst, reveal (merge) + settle.
// Budgets are 6.1 exactly (wall clock; the time-scale dip slows physics and particles, never the schedule). Flash safety (6.6) goes
// through the FlashGovernor; calm mode removes camera moves, slow-mo, pulses and the screen flash, thins particles to x0.3, turns rings into
// fades and shortens everything x0.65. skip() renders the current frame, snapshots it, jumps to the final state and fades the snapshot out
// over 120 ms.
import * as THREE from 'three';
import type { CapsuleRevealSpec, CeremonyBeat, CeremonyHandle, CeremonyHooks, MergeCeremonySpec, SoftBodyLike, TierName } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { mulberry32 } from '../core/rng.ts';
import type { BodyView } from './bodyview.ts';
import type { Capsule } from './capsule.ts';
import { FlashGovernor, rampEnvelope } from './flash.ts';
import { linearToSrgb, genomePalette, type Rgb } from './oklch.ts';
import type { Particles } from './particles.ts';
import { LightPillar, PrismDome, TIER_STYLES, spectrum, tierIndex, type TierStyle } from './rarity.ts';
import type { ScreenFx } from './screenfx.ts';

/** DESIGN 6.1 duration budgets, seconds (result tier). */
export const CAPSULE_BUDGET_S: Record<TierName, number> = { common: 1.6, uncommon: 2.0, rare: 2.6, epic: 3.2, legendary: 3.9, mythic: 4.5 };
export const MERGE_BUDGET_S: Record<TierName, number> = { common: 2.2, uncommon: 2.6, rare: 3.2, epic: 3.8, legendary: 4.5, mythic: 5.2 };
export const TIER_UP_ACCENT_S = 0.4;
export const QUICK_POP_S = 0.8;
export const CALM_DURATION_SCALE = 0.65;
export const SKIP_CROSSFADE_S = 0.12;

export function capsuleDuration(tier: TierName, o: { quick?: boolean; calm?: boolean } = {}): number {
  const base = o.quick && tierIndex(tier) <= 1 ? QUICK_POP_S : CAPSULE_BUDGET_S[tier];
  return base * (o.calm ? CALM_DURATION_SCALE : 1);
}
export function mergeDuration(tier: TierName, o: { tierUp?: boolean; calm?: boolean } = {}): number {
  return (MERGE_BUDGET_S[tier] + (o.tierUp ? TIER_UP_ACCENT_S : 0)) * (o.calm ? CALM_DURATION_SCALE : 1);
}

// ---- the 6.3 escalation table (index = tier) ----
const PREROLL_S = [0, 0, 0.3, 0.5, 0.8, 1.0];
const MOTES = [12, 24, 40, 70, 120, 200];
const GLITTER = [0, 6, 12, 0, 0, 0];
const SPIRAL = [0, 0, 0, 24, 0, 0];
const RIBBONS = [0, 0, 0, 0, 3, 0];              // x 14 segments
const STARS = [0, 0, 0, 0, 0, 24];
const RINGS = [0, 0, 1, 2, 3, 3];
const PUSH = [0, 0.02, 0.04, 0.06, -0.07, 0.05];  // distance factor change (negative = the Legendary pull-back reveal)
const ARC_DEG = [0, 0, 6, 10, 15, 25];
const DIP: [number, number][] = [[1, 0], [1, 0], [1, 0], [0.6, 0.25], [0.5, 0.35], [0.4, 0.5]];  // [time scale, seconds]
const FLASH_AMP = [0.1, 0.12, 0.15, 0.18, 0.22, 0.25];
const KICK = [0, 0.08, 0.16, 0.28, 0.42, 0.55];   // merge burst camera kick (stage.shake units)
const LEAK = [0.45, 0.6, 0.8, 1.0, 1.15, 1.2];    // crack light strength

const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface CeremonyHost {
  readonly flash: FlashGovernor;
  readonly screen: ScreenFx;
  readonly particles: Particles;
  readonly cameraFx: { dist: number; yaw: number; pitch: number };
  calm(): boolean;
  now(): number;
  createOwned(genome: Genome, createBody: (g: Genome) => SoftBodyLike, tier: TierName): BodyView;
  allViews(): BodyView[];
  removeView(v: BodyView): void;
  makePrimary(v: BodyView): void;
  capsule(): Capsule | null;
  ensureCapsule(): Capsule;
  discardCapsule(): void;
  /** Add world-space scene objects (dome, pillar) owned by a run; removed with removeFromScene. */
  addToScene(o: THREE.Object3D): void;
  removeFromScene(o: THREE.Object3D): void;
  /** Render the current state to the screen and start a crossfade snapshot of it. */
  crossfade(seconds: number): void;
  shake(a: number): void;
}

/** Display-space colour for the screen light ramp: the tier colour, lifted toward white so it reads as light, not paint. */
function lightColour(style: TierStyle, time: number, out: Rgb): Rgb {
  const t = style.prism ? spectrum(time * 0.2, out) : style.tell;
  out[0] = linearToSrgb(t[0]) * 0.7 + 0.3; out[1] = linearToSrgb(t[1]) * 0.7 + 0.3; out[2] = linearToSrgb(t[2]) * 0.7 + 0.3;
  return out;
}

abstract class Run implements CeremonyHandle {
  t = 0;
  readonly duration: number;
  readonly tier: TierName;
  readonly style: TierStyle;
  readonly done: Promise<void>;
  protected readonly rng: () => number;
  protected resolveDone!: () => void;
  protected finished = false;
  protected skipping = false;
  protected skipLeft = 0;
  protected readonly fired = new Set<CeremonyBeat>();
  protected readonly calm: boolean;
  protected readonly tmp: Rgb = [1, 1, 1];
  resultView: BodyView | null = null;
  // flash ramp
  private rampStart = -1; private rampAmp = 0;

  protected readonly host: CeremonyHost;
  private readonly hooks: CeremonyHooks | undefined;

  constructor(host: CeremonyHost, tier: TierName, duration: number, hooks: CeremonyHooks | undefined, seed: number) {
    this.host = host; this.hooks = hooks;
    this.tier = tier; this.style = TIER_STYLES[tier]; this.duration = duration; this.calm = host.calm();
    this.rng = mulberry32(seed ^ 0xce2e);
    this.done = new Promise<void>((r) => { this.resolveDone = r; });
  }

  get active(): boolean { return !this.finished; }
  get resultBody(): SoftBodyLike | null { return this.resultView ? this.resultView.proxy.inner : null; }
  get resultBodyId(): number | null { return this.resultView ? this.resultView.id : null; }

  protected beat(b: CeremonyBeat): void {
    if (this.fired.has(b)) return;
    this.fired.add(b);
    try { this.hooks?.onBeat?.(b, { t: this.t, tier: this.tier }); } catch { /* a hook must never break the ceremony */ }
  }

  skip(): void {
    if (this.finished || this.skipping) return;
    this.host.crossfade(SKIP_CROSSFADE_S);
    this.finalize(true);
    this.beat('reveal'); this.beat('settle');
    this.skipping = true; this.skipLeft = SKIP_CROSSFADE_S;
  }

  /** Advance by a real dt; returns the time scale the stage applies to physics and particles this frame. */
  step(dt: number): number {
    if (this.finished) return 1;
    if (this.skipping) { this.skipLeft -= dt; if (this.skipLeft <= 0) this.end(); return 1; }
    this.t += dt;
    const ts = this.tick(dt);
    this.updateRamp();
    if (this.t >= this.duration) { this.finalize(false); this.beat('settle'); this.end(); }
    return this.calm ? 1 : ts;
  }

  protected end(): void { if (this.finished) return; this.finished = true; this.host.screen.setLight(0, 0, 0, 0); this.resolveDone(); }

  protected abstract tick(dt: number): number;
  protected abstract finalize(skipped: boolean): void;

  /** The ONE light ramp of a burst (attack 80 ms, decay 400 ms), through the flash governor. */
  protected startRamp(): void {
    const a = this.host.flash.flash(this.host.now(), FLASH_AMP[this.style.index]);
    if (a > 0) { this.rampStart = this.t; this.rampAmp = a; }
  }
  private updateRamp(): void {
    if (this.rampStart < 0) return;
    const e = rampEnvelope(this.t - this.rampStart);
    const c = lightColour(this.style, this.t, this.tmp);
    this.host.screen.setLight(c[0], c[1], c[2], this.rampAmp * e);
    if (this.t - this.rampStart > 0.5) { this.rampStart = -1; this.host.screen.setLight(0, 0, 0, 0); }
  }

  /** push / pull-back / arc camera offsets: rise over `rise` s from `t0`, hold, fall over the last `fall` s before `tEnd`. */
  protected camera(t0: number, rise: number, tEnd: number, fall: number): void {
    const cf = this.host.cameraFx;
    if (this.calm) { cf.dist = 1; cf.yaw = 0; cf.pitch = 0; return; }
    const i = this.style.index;
    const s = smooth(t0, t0 + rise, this.t) * (1 - smooth(tEnd - fall, tEnd, this.t));
    cf.dist = 1 - PUSH[i] * s;
    cf.yaw = (ARC_DEG[i] * Math.PI / 180) * s;
    cf.pitch = i >= 5 ? 0.06 * s : 0;
  }

  /** The 6.3 particle table at the burst, plus the staggered rings (>= 500 ms apart, fades in calm mode). */
  protected burstParticles(cx: number, cy: number, cz: number, scale: number, view: BodyView | null): void {
    const P = this.host.particles, i = this.style.index, rng = this.rng, k = this.calm ? 0.3 : 1;
    const tell = this.style.tell;
    const mix = (t: number, w: number): number => t * (1 - w) + w;
    const col = (j: number): Rgb => {
      if (this.style.prism) return spectrum(rng() + j * 0.01, this.tmp);
      this.tmp[0] = mix(tell[0], 0.5); this.tmp[1] = mix(tell[1], 0.45); this.tmp[2] = mix(tell[2], 0.4);
      return this.tmp;
    };
    for (let j = 0, n = Math.round(MOTES[i] * k); j < n; j++) {
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z), sp = (0.7 + 1.7 * rng()) * scale;
      const c = col(j);
      P.emit({ x: cx, y: cy, z: cz, vx: rr * Math.cos(a) * sp, vy: Math.abs(z) * sp * 0.9 + 0.4 * scale, vz: rr * Math.sin(a) * sp, life: 0.6 + 0.6 * rng(), size: (0.018 + 0.022 * rng()) * scale, kind: 0, r: c[0], g: c[1], b: c[2], a: 0.9, drag: 1.3, grav: 0.8 });
    }
    for (let j = 0, n = Math.round(GLITTER[i] * k); j < n; j++) {
      const a = rng() * Math.PI * 2, sp = (0.5 + 0.9 * rng()) * scale;
      P.emit({ x: cx, y: cy, z: cz, vx: Math.cos(a) * sp, vy: (0.6 + 0.9 * rng()) * scale, vz: Math.sin(a) * sp, life: 0.8 + 0.5 * rng(), size: 0.02 * scale, kind: 1, r: 1, g: 0.95, b: 0.85, a: 0.9, drag: 1.2, grav: 0.5 });
    }
    for (let j = 0, n = Math.round(SPIRAL[i] * k); j < n; j++) {   // Epic: spiral trails
      const a = (j / Math.max(1, n)) * Math.PI * 2 + rng() * 0.4, c = col(j);
      const tx = -Math.sin(a), tz = Math.cos(a);
      P.emit({ x: cx + Math.cos(a) * 0.2 * scale, y: cy, z: cz + Math.sin(a) * 0.2 * scale, vx: (tx * 2.6 + Math.cos(a) * 0.9) * scale, vy: (0.8 + 0.6 * rng()) * scale, vz: (tz * 2.6 + Math.sin(a) * 0.9) * scale, life: 0.8 + 0.3 * rng(), size: 0.03 * scale, kind: 2, r: c[0], g: c[1], b: c[2], a: 0.9, drag: 1.1 });
    }
    for (let rb = 0, nr = Math.round(RIBBONS[i] * (this.calm ? 0.34 : 1)); rb < nr; rb++) {   // Legendary: three aurora ribbons
      for (let j = 0; j < 14; j++) {
        const a = rb * 2.094 + j * 0.34, h = 0.05 + j * 0.085;
        const aur = 0.5 + 0.5 * Math.sin(j * 0.5 + rb);
        P.emit({ x: cx + Math.cos(a) * 0.32 * scale, y: cy * 0.3 + h * scale, z: cz + Math.sin(a) * 0.32 * scale, vx: -Math.sin(a) * 2.0 * scale, vy: 0.9 * scale, vz: Math.cos(a) * 2.0 * scale, life: 0.9 + 0.5 * (j / 14), size: 0.034 * scale, kind: 2, r: 1.0 - 0.6 * aur, g: 0.62 + 0.2 * aur, b: 0.2 + 0.65 * aur, a: 0.85, drag: 1.0 });
      }
    }
    for (let j = 0, n = Math.round(STARS[i] * k); j < n; j++) {     // Mythic: star points
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z), sp = (0.5 + 0.8 * rng()) * scale, c = spectrum(rng(), this.tmp);
      P.emit({ x: cx, y: cy, z: cz, vx: rr * Math.cos(a) * sp, vy: (Math.abs(z) * 0.8 + 0.2) * sp, vz: rr * Math.sin(a) * sp, life: 1.6 + 0.6 * rng(), size: 0.034 * scale, kind: 1, r: c[0] * 0.5 + 0.5, g: c[1] * 0.5 + 0.5, b: c[2] * 0.5 + 0.5, a: 0.95, drag: 1.8, fade: 2 });
    }
    void view;
  }

  /** Rings: staggered >= 500 ms apart through the governor (fades in calm mode: same count and spacing). */
  protected ringSchedule(t0: number): number[] {
    const n = RINGS[this.style.index], out: number[] = [];
    for (let i = 0; i < n; i++) out.push(t0 + i * 0.52);
    return out;
  }
}

/* ───────────────────────────── capsule reveal ───────────────────────────── */

export class CapsuleRun extends Run {
  private readonly cap: Capsule;
  private readonly spec: CapsuleRevealSpec;
  private readonly others: BodyView[];
  private readonly tb: { b0: number; b1: number; b2: number; b3: number; burstAt: number; revealAt: number };
  private readonly ks: number;
  private readonly pillar: LightPillar | null;
  private readonly dome: PrismDome | null;
  private readonly rings: number[];
  private ringIdx = 0;
  private burst = false;
  private cx = 0; private cz = 0;
  private drop = { y: 0.5, vy: 0.7, bounces: 0, landed: false, age: 0 };
  private converge = false;
  private dipT = -1;
  private fadeIn = 0;

  constructor(host: CeremonyHost, spec: CapsuleRevealSpec, hooks: CeremonyHooks | undefined) {
    const tier = spec.result.tier, calm = host.calm();
    const D = capsuleDuration(tier, { quick: spec.quick, calm });
    super(host, tier, D, hooks, spec.result.genome.seed);
    this.spec = spec;
    const i = this.style.index;
    const nominal = CAPSULE_BUDGET_S[tier];
    this.ks = D / nominal;
    const ks = this.ks;
    const P = PREROLL_S[i] * ks;
    const b0 = 0.35 * ks, b1 = 0.3 * ks + P, b2 = 0.35 * ks;
    this.tb = { b0, b1, b2, b3: D - (b0 + b1 + b2), burstAt: b0 + b1, revealAt: b0 + b1 + b2 };
    this.cap = host.capsule() ?? host.ensureCapsule();
    if (!this.cap.landed && this.cap.group.visible === false) this.cap.placeStanding(0, 0.25);
    this.others = spec.keepCurrent ? [] : host.allViews().filter((v) => v.visible);
    this.pillar = i === 4 ? new LightPillar() : null;
    this.dome = i === 5 ? new PrismDome() : null;
    if (this.pillar) host.addToScene(this.pillar.mesh);
    if (this.dome) host.addToScene(this.dome.mesh);
    this.rings = this.ringSchedule(this.tb.burstAt);
    // prepay the result's GPU cost now, hidden: the burst frame must not hitch
    this.resultView = host.createOwned(spec.result.genome, spec.createBody, tier);
    this.resultView.setVisible(false);
    this.resultView.rarity.strength = 0;
    this.beat('grab');
  }

  protected tick(dt: number): number {
    const { b0, b1, burstAt, revealAt } = this.tb;
    const t = this.t, st = this.style, i = st.index, host = this.host, cap = this.cap;
    // --- the player's current squishy slides off; the capsule slides to the centre ---
    const slide = smooth(0, 0.5 * this.ks, t);
    for (const v of this.others) { v.proxy.offset.x = -3.4 * slide; if (slide >= 1) v.setVisible(false); }
    cap.slideTo(0, 0.25, 1 - Math.exp(-dt * 7));
    this.cx = cap.pos.x; this.cz = cap.pos.z;
    // --- B0: grab ---
    if (t < b0) {
      cap.setSqueeze(0.7 + 0.3 * smooth(0, b0, t));
      if (!this.calm) cap.wobble(0.9 * Math.sin(t * 52) * dt * 12);
    }
    // --- B1: crack (+ the tier pre-roll): light leaks through the cracks in the TIER colour ---
    if (t >= b0 && t < burstAt) {
      this.beat('crack');
      const p1 = clamp01((t - b0) / b1);
      const fam = host.flash.tint(host.now(), st.tellFamily);
      const tell: Rgb = fam === st.tellFamily ? st.tell : [1, 0.88, 0.68];
      const crack = smooth(0, 0.7, p1);
      const leak = LEAK[i] * (i >= 3 ? Math.pow(p1, 1.6) : smooth(0.05, 1, p1));   // Epic and up: a slow ramp, not a pulse
      cap.setCrack(crack, leak, tell, st.prism);
      cap.setSqueeze(1);
      if (!this.calm) cap.wobble(Math.sin(t * 61) * dt * (6 + 22 * p1 * p1));
      if (this.pillar) {                        // Legendary: a light pillar over the last 0.8 s
        const pp = smooth(burstAt - 0.8 * this.ks, burstAt, t);
        this.pillar.set(this.cx, this.cz, 0.22, 3.2, st.tell, 0.3 * pp);
      }
      if (this.dome) this.dome.set(this.cx, this.cz, 0.62, 0.8, 0.85 * smooth(0, 1, p1), t);
      if (this.dome && !this.converge) {         // Mythic: constellation points converge on the capsule
        this.converge = true;
        const P = host.particles; P.ax = this.cx; P.ay = 0.35; P.az = this.cz; P.attractK = 16;
        for (let j = 0, n = Math.round(24 * (this.calm ? 0.3 : 1)); j < n; j++) {
          const z = this.rng() * 2 - 1, a = this.rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z), R = 1.5 + 0.4 * this.rng();
          const c = spectrum(this.rng(), this.tmp);
          P.emit({ x: this.cx + rr * Math.cos(a) * R, y: 0.4 + z * R * 0.6 + 0.3, z: this.cz + rr * Math.sin(a) * R, life: b1 * 0.98, size: 0.032, kind: 1, r: c[0] * 0.5 + 0.5, g: c[1] * 0.5 + 0.5, b: c[2] * 0.5 + 0.5, a: 0.9, attract: 1, drag: 1.2, spin: 1.5, fade: 2 });
        }
      }
    }
    // --- B2: burst ---
    let ts = 1;
    if (t >= burstAt && !this.burst) this.doBurst();
    if (this.burst) {
      // time-scale dip (physics and particles only)
      const [dipScale, dipLen] = DIP[i];
      if (dipLen > 0) {
        const a = t - burstAt;
        const w = smooth(0, 0.04, a) * (1 - smooth(dipLen, dipLen + 0.09, a));
        ts = 1 - (1 - dipScale) * w;
      }
      this.tickResult(dt * ts);
      cap.setCrack(1, Math.max(0, LEAK[i] * (1 - (t - burstAt) * 2.2)), st.tell, st.prism);
      // rings
      while (this.ringIdx < this.rings.length && t >= this.rings[this.ringIdx]) {
        this.ringIdx++;
        const v = this.resultView;
        if (v && (this.calm || host.flash.ring(host.now()))) v.fx.spawn('ring', { x: this.cx, y: 0, z: this.cz }, 1);
      }
      if (this.pillar) this.pillar.set(this.cx, this.cz, 0.22 + 0.5 * (t - burstAt), 3.2, st.tell, 0.3 * Math.max(0, 1 - (t - burstAt) * 1.3));
      if (this.dome) this.dome.set(this.cx, this.cz, 0.62 + 0.7 * smooth(0, 0.6, t - burstAt), 0.8 + 0.8 * smooth(0, 0.6, t - burstAt), 0.85 * (1 - smooth(0.4, 1.4, t - burstAt)), t);
    }
    if (t >= this.tb.revealAt) this.beat('reveal');
    this.camera(burstAt, 0.5 * this.ks + 0.2, this.duration, 0.3 * this.tb.b3);
    // close in on the capsule while it is being squeezed open, then ease back out as it bursts
    if (!this.calm) host.cameraFx.dist *= 1 - 0.11 * smooth(0, 0.35 * this.ks, t) * (1 - smooth(burstAt, burstAt + 0.3 * this.ks + 0.1, t));
    void revealAt;
    return ts;
  }

  private doBurst(): void {
    this.burst = true;
    this.beat('burst');
    const host = this.host, st = this.style, i = st.index;
    this.cap.burst();
    host.particles.attractK = 0;
    host.particles.clear();
    // the result view appears at the capsule and drops out
    const v = this.resultView as BodyView;
    v.setVisible(true);
    this.drop = { y: 0.3, vy: 0.6, bounces: 0, landed: false, age: 0 };
    v.proxy.setOffset(this.cx, this.drop.y, this.cz);
    v.proxy.scale = 0.55;
    this.burstParticles(this.cx, 0.4, this.cz, v.scale, v);
    this.startRamp();
    void i;
    this.cap.wobble(0);
  }

  private tickResult(dt: number): void {
    const v = this.resultView;
    if (!v) return;
    const d = this.drop, off = v.proxy.offset;
    d.age += dt;
    v.proxy.scale = 0.55 + 0.45 * smooth(0, 0.3, d.age);
    off.x += (0 - off.x) * (1 - Math.exp(-dt * 5)); off.z += (0 - off.z) * (1 - Math.exp(-dt * 5));
    this.cx = off.x; this.cz = off.z;
    d.vy -= 9.8 * dt; d.y += d.vy * dt;
    if (d.y <= 0) {
      d.y = 0;
      if (!d.landed) {
        if (d.vy < -0.9 && d.bounces < 1) { d.vy = -d.vy * 0.22; d.bounces++; }
        else { d.landed = true; d.vy = 0; }
        v.proxy.inner.nudge({ x: 0, y: -2.4, z: 0 });
        v.fx.spawn('dust', { x: off.x, y: 0, z: off.z }, 0.7);
        this.host.shake(0.05 + 0.04 * this.style.index);
      }
    }
    off.y = d.y;
    this.fadeIn = Math.min(1, this.fadeIn + dt / 0.7);
    v.rarity.strength = smooth(0, 1, this.fadeIn);
    const u = v.mats.uniforms;
    u.uTierAmt.value = Math.max(0, (0.3 + 0.03 * this.style.index) * (1 - d.age / 0.9));
    u.uTierCol.value.setRGB(this.style.tell[0], this.style.tell[1], this.style.tell[2], THREE.LinearSRGBColorSpace);
    v.extraPool = Math.max(0, 0.5 * (1 - d.age / 1.2));
  }

  protected finalize(skipped: boolean): void {
    const host = this.host;
    host.particles.attractK = 0; host.particles.clear();
    host.cameraFx.dist = 1; host.cameraFx.yaw = 0; host.cameraFx.pitch = 0;
    this.cap.hide(); host.discardCapsule();
    if (this.pillar) { host.removeFromScene(this.pillar.mesh); this.pillar.dispose(); }
    if (this.dome) { host.removeFromScene(this.dome.mesh); this.dome.dispose(); }
    for (const v of this.others) host.removeView(v);
    const v = this.resultView as BodyView;
    v.setVisible(true);
    v.proxy.setOffset(0, 0, 0); v.proxy.scale = 1; v.proxy.popFrom(0, 0);
    if (skipped || !this.drop.landed) v.proxy.inner.reset();
    v.rarity.strength = 1; v.extraPool = 0; v.core.boost = 0;
    v.mats.uniforms.uTierAmt.value = 0; v.mats.uniforms.uMixAmt.value = 0;
    host.makePrimary(v);
    host.screen.setLight(0, 0, 0, 0);
  }
}

/* ───────────────────────────── merge ceremony ───────────────────────────── */

export class MergeRun extends Run {
  private readonly spec: MergeCeremonySpec;
  private readonly parents: BodyView[] = [];
  private readonly others: BodyView[];
  private readonly b: { t0: number; t1: number; t2: number; t3: number; t4: number; a1: number; a2: number; a3: number; a4: number };
  private readonly ks: number;
  private readonly start: { x: number; z: number }[] = [];
  private readonly pillar: LightPillar | null;
  private readonly dome: PrismDome | null;
  private readonly rings: number[] = [];
  private ringIdx = 0;
  private burst = false;
  private drop = { y: 0, vy: 0, landed: false, age: 0, hopped: false };
  private moteAcc = 0;
  private sparkled = false;
  private fadeIn = 0;
  private readonly mixCol: Rgb;
  private bodyScale = 1;
  private ballCx = 0; private ballCy = 0.4; private ballCz = 0;

  constructor(host: CeremonyHost, spec: MergeCeremonySpec, hooks: CeremonyHooks | undefined) {
    const tier = spec.result.tier, tierUp = !!spec.result.tierUp, calm = host.calm();
    const D = mergeDuration(tier, { tierUp, calm });
    super(host, tier, D, hooks, spec.result.genome.seed);
    this.spec = spec;
    const i = this.style.index;
    const nominal = MERGE_BUDGET_S[tier] + (tierUp ? TIER_UP_ACCENT_S : 0);
    const ks = this.ks = D / nominal;
    const T0 = 0.4 * ks, T1 = 0.5 * ks, T2 = (0.4 + 1.5 * PREROLL_S[i]) * ks, T3 = 0.2 * ks;
    const T4 = D - (T0 + T1 + T2 + T3);
    this.b = { t0: 0, t1: T0, t2: T0 + T1, t3: T0 + T1 + T2, t4: T0 + T1 + T2 + T3, a1: T0, a2: T1, a3: T2, a4: T4 };
    this.others = host.allViews().filter((v) => v.visible);
    for (const v of this.others) v.setVisible(false);
    const n = Math.max(2, Math.min(3, spec.parents.length));
    for (let k = 0; k < n; k++) {
      const p = spec.parents[k] ?? spec.parents[0];
      const ang = n === 2 ? (k === 0 ? Math.PI : 0) : Math.PI / 2 + (k * 2 * Math.PI) / 3;
      this.start.push({ x: Math.cos(ang) * (n === 2 ? 1.55 : 1.5), z: Math.sin(ang) * (n === 2 ? 0 : 1.2) });
      const v = host.createOwned(p.genome, spec.createBody, p.tier ?? 'common');
      v.proxy.setOffset(this.start[k].x, 0, this.start[k].z);
      this.parents.push(v);
    }
    this.bodyScale = this.parents[0].scale;
    // the parents' lineage colour: the average of the others' body colours swirls through the ball
    const avg: Rgb = [0, 0, 0];
    for (const p of spec.parents) { const pal = genomePalette(p.genome); avg[0] += pal.body[0] / spec.parents.length; avg[1] += pal.body[1] / spec.parents.length; avg[2] += pal.body[2] / spec.parents.length; }
    this.mixCol = avg;
    this.pillar = i === 4 ? new LightPillar() : null;
    this.dome = i === 5 ? new PrismDome() : null;
    if (this.pillar) host.addToScene(this.pillar.mesh);
    if (this.dome) host.addToScene(this.dome.mesh);
    // prepay the result's GPU cost now, hidden
    this.resultView = host.createOwned(spec.result.genome, spec.createBody, tier);
    this.resultView.setVisible(false);
    this.resultView.rarity.strength = 0;
    this.beat('press');
  }

  private dirOf(k: number): { x: number; z: number } {
    const s = this.start[k]; const l = Math.hypot(s.x, s.z) || 1;
    return { x: s.x / l, z: s.z / l };
  }

  protected tick(dt: number): number {
    const t = this.t, b = this.b, st = this.style, i = st.index, host = this.host;
    const n = this.parents.length;
    const sc = this.bodyScale;
    let ts = 1;
    if (t < b.t3) {
      // ---- T0 press together / T1 fold ----
      const slide = smooth(0, b.a1, t);
      const gap = 0.31 * sc;                                    // each body's centre distance from the pad: touching, squashed
      const foldP = smooth(b.t1, b.t2, t);
      const squash = 0.4 * smooth(b.a1 * 0.3, b.a1, t) * (1 - smooth(b.t1 + b.a2 * 0.2, b.t2, t));
      for (let k = 0; k < n; k++) {
        const v = this.parents[k], s = this.start[k], d = this.dirOf(k);
        const px = (s.x + (d.x * gap - s.x) * slide) * (1 - foldP), pz = (s.z + (d.z * gap - s.z) * slide) * (1 - foldP);
        v.proxy.offset.x = px; v.proxy.offset.z = pz;
        v.proxy.squashAx = d.x; v.proxy.squashAz = d.z; v.proxy.squashAmt = squash;
        v.core.boost = 0.95 * smooth(b.a1 * 0.5, b.a1, t) + 0.6 * foldP;        // cores glow brighter where they touch
        v.proxy.setFold(foldP);
        if (k > 0) v.proxy.scale = 1 - 0.92 * smooth(0.55, 1, foldP);            // the others are absorbed into the ball
        if (k > 0 && v.proxy.scale < 0.1) v.setVisible(false);
      }
      const ball = this.parents[0];
      ball.mats.uniforms.uMixCol.value.setRGB(this.mixCol[0], this.mixCol[1], this.mixCol[2], THREE.LinearSRGBColorSpace);
      ball.mats.uniforms.uMixAmt.value = 0.7 * smooth(b.t1, b.t2, t);
      if (t >= b.t1) this.beat('fold');
    }
    // ---- T2 charge ----
    if (t >= b.t2 && t < b.t3) {
      this.beat('charge');
      const p2 = clamp01((t - b.t2) / b.a3);
      const ball = this.parents[0];
      this.ballCx = ball.proxy.center.x; this.ballCy = ball.proxy.center.y; this.ballCz = ball.proxy.center.z;
      ball.proxy.tremble(this.calm ? 0.15 + 0.2 * p2 : 0.2 + 0.8 * p2);
      ball.proxy.charge = 0.3 + 0.7 * p2;
      ball.proxy.scale = 1 - 0.1 * p2;
      ball.core.boost = 1.0 + 1.1 * p2;
      const fam = host.flash.tint(host.now(), st.tellFamily);
      const tellOk = fam === st.tellFamily;
      const u = ball.mats.uniforms;
      u.uTierCol.value.setRGB(tellOk ? st.tell[0] : 1, tellOk ? st.tell[1] : 0.88, tellOk ? st.tell[2] : 0.68, THREE.LinearSRGBColorSpace);
      u.uTierAmt.value = 0.95 * p2 * p2 * (3 - 2 * p2);          // the light drifts toward the result tier colour
      ball.extraPool = 0.5 * p2;
      // motes spiral inward
      const P = host.particles;
      P.ax = this.ballCx; P.ay = this.ballCy; P.az = this.ballCz; P.attractK = 24;
      const rate = (MOTES[i] * 1.2 * (this.calm ? 0.3 : 1)) / Math.max(0.2, b.a3);
      this.moteAcc += rate * dt;
      while (this.moteAcc >= 1) {
        this.moteAcc -= 1;
        const a = this.rng() * Math.PI * 2, R = (1.0 + 0.5 * this.rng()) * sc;
        const col = st.prism ? spectrum(this.rng(), this.tmp) : st.tell;
        const w = p2;
        const mixr = this.mixCol[0] * (1 - w) + (st.prism ? col[0] : st.tell[0]) * w, mixg = this.mixCol[1] * (1 - w) + (st.prism ? col[1] : st.tell[1]) * w, mixb = this.mixCol[2] * (1 - w) + (st.prism ? col[2] : st.tell[2]) * w;
        P.emit({ x: this.ballCx + Math.cos(a) * R, y: this.ballCy + (this.rng() - 0.4) * 0.6 * sc, z: this.ballCz + Math.sin(a) * R, vx: -Math.sin(a) * 1.4, vz: Math.cos(a) * 1.4, life: 0.55, size: (0.02 + 0.018 * this.rng()) * sc, kind: this.rng() < 0.4 ? 2 : 0, r: 0.35 + mixr * 1.4, g: 0.35 + mixg * 1.4, b: 0.35 + mixb * 1.4, a: 0.9, attract: 1, spin: 6, drag: 0.6, fade: 1 });
      }
      if (this.pillar) { const pp = smooth(b.t3 - 0.8 * this.ks, b.t3, t); this.pillar.set(this.ballCx, this.ballCz, 0.25, 3.2, st.tell, 0.3 * pp); }
      if (this.dome) this.dome.set(this.ballCx, this.ballCz, 0.7, 0.9, 0.8 * smooth(0, 1, p2), t);
    }
    // ---- T3 burst ----
    if (t >= b.t3 && !this.burst) this.doBurst();
    if (this.burst) {
      const [dipScale, dipLen] = DIP[i];
      if (dipLen > 0) {
        const a = t - b.t3;
        ts = 1 - (1 - dipScale) * smooth(0, 0.04, a) * (1 - smooth(dipLen, dipLen + 0.09, a));
      }
      this.tickResult(dt * ts);
      while (this.ringIdx < this.rings.length && t >= this.rings[this.ringIdx]) {
        this.ringIdx++;
        const v = this.resultView;
        if (v && (this.calm || host.flash.ring(host.now()))) v.fx.spawn('ring', { x: 0, y: 0, z: 0 }, 1);
      }
      if (this.pillar) this.pillar.set(0, 0, 0.25 + 0.5 * (t - b.t3), 3.2, st.tell, 0.3 * Math.max(0, 1 - (t - b.t3) * 1.2));
      if (this.dome) this.dome.set(0, 0, 0.7 + 0.6 * smooth(0, 0.6, t - b.t3), 0.9 + 0.7 * smooth(0, 0.6, t - b.t3), 0.8 * (1 - smooth(0.4, 1.4, t - b.t3)), t);
      // tier-up accent: a rising ladder of star sparkles in the new colour over the last 0.4 s
      if (this.spec.result.tierUp && !this.sparkled && t >= this.duration - 0.4 * this.ks) {
        this.sparkled = true;
        const P = host.particles, sc2 = this.resultView ? this.resultView.scale : 1;
        for (let j = 0, nn = Math.round(16 * (this.calm ? 0.3 : 1)); j < nn; j++) {
          const a = this.rng() * Math.PI * 2, R = (0.15 + 0.5 * this.rng()) * sc2;
          const c = st.prism ? spectrum(this.rng(), this.tmp) : st.tell;
          P.emit({ x: Math.cos(a) * R, y: 0.1 + 0.8 * this.rng() * sc2, z: Math.sin(a) * R, vy: (1.0 + 0.8 * this.rng()) * sc2, life: 0.9, size: 0.026 * sc2, kind: 1, r: c[0] * 0.4 + 0.6, g: c[1] * 0.4 + 0.6, b: c[2] * 0.4 + 0.6, a: 0.95, drag: 0.8, fade: 0 });
        }
      }
    }
    if (t >= b.t4) this.beat('reveal');
    this.camera(b.t3, 0.45 * this.ks + 0.2, this.duration, 0.3 * b.a4);
    return ts;
  }

  private doBurst(): void {
    this.burst = true;
    const host = this.host, st = this.style, i = st.index;
    this.beat('burst');
    host.particles.attractK = 0;
    host.particles.clear();
    for (const p of this.parents) { host.removeView(p); }
    this.parents.length = 0;
    const v = this.resultView as BodyView;
    v.setVisible(true);
    v.proxy.setOffset(0, 0, 0); v.proxy.scale = 1;
    // springs open: overshoots ~1.25x, then settles (native burstOpen, or the proxy's puppet spring)
    if (v.proxy.native.burst) v.proxy.burstOpen(1); else v.proxy.popFrom(-0.2, 7.2);
    const mix = v.mats.uniforms;
    mix.uMixCol.value.setRGB(this.mixCol[0], this.mixCol[1], this.mixCol[2], THREE.LinearSRGBColorSpace);
    mix.uMixAmt.value = 0.45;
    mix.uTierAmt.value = 0.95;
    this.drop = { y: 0, vy: 2.4, landed: false, age: 0, hopped: true };
    this.rings.push(...this.ringSchedule(this.b.t3));
    this.burstParticles(0, this.ballCy, 0, v.scale, v);
    this.startRamp();
    host.shake(KICK[i]);
  }

  private tickResult(dt: number): void {
    const v = this.resultView;
    if (!v) return;
    const d = this.drop, off = v.proxy.offset, u = v.mats.uniforms;
    d.age += dt;
    // the new squishy rises from the burst and lands
    if (d.hopped && !d.landed) {
      d.vy -= 9.8 * dt; d.y += d.vy * dt;
      if (d.y <= 0 && d.vy < 0) {
        d.y = 0; d.landed = true; d.vy = 0;
        v.proxy.inner.nudge({ x: 0, y: -2.6, z: 0 });
        v.fx.spawn('dust', { x: 0, y: 0, z: 0 }, 0.8);
        if (this.style.index >= 4) v.fx.spawn('ring', { x: 0, y: 0, z: 0 }, 0.8);   // Legendary and up: it settles with a visible wobble ring
        this.host.shake(0.05 + 0.04 * this.style.index);
      }
      off.y = d.y;
    }
    this.fadeIn = Math.min(1, this.fadeIn + dt / 0.8);
    v.rarity.strength = smooth(0, 1, this.fadeIn);
    u.uTierAmt.value = Math.max(0, 0.95 * (1 - d.age / 0.9));
    u.uMixAmt.value = Math.max(0, 0.45 * (1 - d.age / 1.5));
    v.extraPool = Math.max(0, 1.0 * (1 - d.age / 1.2));
    v.core.boost = Math.max(0, 1.2 * (1 - d.age / 0.7));
  }

  protected finalize(skipped: boolean): void {
    const host = this.host;
    host.particles.attractK = 0; host.particles.clear();
    host.cameraFx.dist = 1; host.cameraFx.yaw = 0; host.cameraFx.pitch = 0;
    if (this.pillar) { host.removeFromScene(this.pillar.mesh); this.pillar.dispose(); }
    if (this.dome) { host.removeFromScene(this.dome.mesh); this.dome.dispose(); }
    for (const p of this.parents) host.removeView(p);
    this.parents.length = 0;
    for (const v of this.others) host.removeView(v);
    const v = this.resultView as BodyView;
    v.setVisible(true);
    v.proxy.setOffset(0, 0, 0); v.proxy.scale = 1; v.proxy.popFrom(0, 0);
    if (skipped || !this.drop.landed) v.proxy.inner.reset();
    v.rarity.strength = 1; v.extraPool = 0; v.core.boost = 0;
    v.mats.uniforms.uTierAmt.value = 0; v.mats.uniforms.uMixAmt.value = 0;
    host.makePrimary(v);
    host.screen.setLight(0, 0, 0, 0);
  }
}

/* ───────────────────────────── director ───────────────────────────── */

export class CeremonyDirector {
  private run: Run | null = null;
  private readonly host: CeremonyHost;
  constructor(host: CeremonyHost) { this.host = host; }

  get active(): boolean { return !!this.run && this.run.active; }
  get current(): CeremonyHandle | null { return this.run && this.run.active ? this.run : null; }

  startCapsule(spec: CapsuleRevealSpec, hooks?: CeremonyHooks): CeremonyHandle {
    this.abort();
    const r = new CapsuleRun(this.host, spec, hooks);
    this.run = r;
    return r;
  }
  startMerge(spec: MergeCeremonySpec, hooks?: CeremonyHooks): CeremonyHandle {
    this.abort();
    const r = new MergeRun(this.host, spec, hooks);
    this.run = r;
    return r;
  }
  /** Starting something new while a ceremony runs resolves the old one at its final frame. */
  abort(): void { const r = this.run; if (r && r.active) { r.skip(); r.step(SKIP_CROSSFADE_S + 0.01); } this.run = null; }

  /** Returns the time scale for this frame (physics and particles of the ceremony bodies). */
  update(dt: number): number {
    const r = this.run;
    if (!r) return 1;
    const ts = r.step(dt);
    if (!r.active) this.run = null;
    return ts;
  }
}

