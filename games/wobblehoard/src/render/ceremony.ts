// Ceremonies (DESIGN.md section 6): the capsule open reveal (6.3) and the merge ceremony (6.4).
//
// The CeremonyDirector advances one run at a time, once per stage.update(), and drives the stage through a small CeremonyHost:
//   * stage-OWNED bodies (created through spec.createBody, stepped by the stage) rendered through BodyProxy puppets,
//   * the capsule object, the shared Particles system, the ScreenFx light ramp, camera offsets (push / arc), the time-scale dip,
//   * the beats the shell hooks audio and haptics to: grab, crack, burst, reveal (capsule) / press, fold, charge, burst, reveal (merge) + settle.
// Budgets are 6.1 exactly (wall clock; the time-scale dip slows physics and particles, never the schedule). Beat times follow the audio
// lane's time map (_spec/SOUND.md): capsule grab 0, crack 0.35, preroll 0.65 (Rare+), burst 0.65 + pre-roll, reveal burst + 0.35;
// merge press 0, fold 0.4, charge 0.9, burst at MERGE_BURST_AT_S (= audio MERGE_CHARGE_S), reveal burst + 0.2. Calm scales all of it x0.65.
// Flash safety (6.6) goes through the FlashGovernor; calm mode removes camera moves, slow-mo, pulses and the screen flash, thins particles to
// x0.3, turns rings into fades and shortens everything x0.65. skip() renders the current frame, snapshots it, jumps to the final state
// (including the result view's own clock, so its idle cycles are exactly where the natural ending leaves them) and fades the snapshot out
// over 120 ms. Every run keeps `stats` (burst particles, rings, push / arc, time-scale dip, light ramps) for the probe.
import * as THREE from 'three';
import type { CapsuleRevealSpec, CeremonyBeat, CeremonyHandle, CeremonyHooks, MergeCeremonySpec, SoftBodyLike, TierName } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { mulberry32 } from '../core/rng.ts';
import type { BodyView } from './bodyview.ts';
import type { Capsule } from './capsule.ts';
import type { FlashGovernor } from './flash.ts';
import { linearToSrgb, genomePalette, type Rgb } from './oklch.ts';
import type { EmitSpec, Particles } from './particles.ts';
import { LightPillar, PrismDome, TIER_STYLES, safeTier, spectrum, tierIndex, type TierStyle } from './rarity.ts';
import type { ScreenFx } from './screenfx.ts';

/** DESIGN 6.1 duration budgets, seconds (result tier). */
export const CAPSULE_BUDGET_S: Record<TierName, number> = { common: 1.6, uncommon: 2.0, rare: 2.6, epic: 3.2, legendary: 3.9, mythic: 4.5 };
export const MERGE_BUDGET_S: Record<TierName, number> = { common: 2.2, uncommon: 2.6, rare: 3.2, epic: 3.8, legendary: 4.5, mythic: 5.2 };
export const TIER_UP_ACCENT_S = 0.4;
export const QUICK_POP_S = 0.8;
export const CALM_DURATION_SCALE = 0.65;
export const SKIP_CROSSFADE_S = 0.12;
/** How long a burst's light lasts (ramp 80 + 400 ms, the tier tell released over 0.5 s): a skip inside it fades instead of cutting. */
const BURST_LIGHT_S = 0.6;
/** The burst's own light when the governor refused the flash (a chained ceremony inside 1 s of the last flash) / in calm mode. */
const SOFT_BURST_GAIN = 0.25;
const CALM_BURST_GAIN = 0.45;

export function capsuleDuration(tier: TierName, o: { quick?: boolean; calm?: boolean } = {}): number {
  const base = o.quick && tierIndex(tier) <= 1 ? QUICK_POP_S : CAPSULE_BUDGET_S[tier];
  return base * (o.calm ? CALM_DURATION_SCALE : 1);
}
export function mergeDuration(tier: TierName, o: { tierUp?: boolean; calm?: boolean } = {}): number {
  return (MERGE_BUDGET_S[tier] + (o.tierUp ? TIER_UP_ACCENT_S : 0)) * (o.calm ? CALM_DURATION_SCALE : 1);
}

// ---- the 6.3 escalation table (index = tier) ----
const PREROLL_S = [0, 0, 0.3, 0.5, 0.8, 1.0];
/**
 * Merge T3 (burst) time per result tier, nominal seconds from the start: T0 press 0.4 + T1 fold 0.5 + T2 charge (the rest).
 * These are the audio lane's `MERGE_CHARGE_S` (src/audio/ceremony.ts, _spec/SOUND.md "Time map"), so `mergeStart()` at 0 with its
 * default `chargeS` and `burst()` on the 'burst' beat line up; T4 (the reveal) gets the rest of the DESIGN 6.1 budget.
 */
export const MERGE_BURST_AT_S = [1.3, 1.5, 1.8, 2.1, 2.4, 2.8];
const MOTES = [12, 24, 40, 70, 120, 200];
const GLITTER = [0, 6, 12, 0, 0, 0];
const SPIRAL = [0, 0, 0, 24, 0, 0];
const RIBBONS = [0, 0, 0, 0, 3, 0];              // x 14 segments
const STARS = [0, 0, 0, 0, 0, 24];
const RINGS = [0, 0, 1, 2, 3, 3];
/** Each later ring is dimmer than the one before (a decaying ripple, not a second flash). */
const RING_GAIN = [1, 0.5, 0.3];
const PUSH = [0, 0.02, 0.04, 0.06, -0.07, 0.05];  // distance factor change (negative = the Legendary pull-back reveal)
const ARC_DEG = [0, 0, 6, 10, 15, 25];
const DIP: [number, number][] = [[1, 0], [1, 0], [1, 0], [0.6, 0.25], [0.5, 0.35], [0.4, 0.5]];  // [time scale, seconds]
const FLASH_AMP = [0.1, 0.12, 0.15, 0.17, 0.18, 0.19];   // Legendary / Mythic were 0.20 / 0.23: their dome, pillar and tell add plenty
const KICK = [0, 0.08, 0.16, 0.28, 0.42, 0.55];   // merge burst camera kick (stage.shake units)
const LEAK = [0.45, 0.6, 0.8, 1.0, 1.15, 1.2];    // crack light strength
/**
 * Merge framing: the ceremony is framed this much WIDER than the play view (by result tier; a cut at the start, which is a scene change
 * anyway, eased back to the result's own framing during T4), so the burst (the result springs open to 1.25x and rises) stays inside the
 * frame. On a narrow (portrait) frame it is also widened until the starting parents fit side by side, so they never start clipped.
 * Not a 6.3 camera move: the push / arc of the escalation table are layered on top. Calm: only the fit (a cut), no tier widening.
 */
const MERGE_FRAMING = [1.0, 1.04, 1.08, 1.12, 1.12, 1.12];   // by result tier, as the 6.3 escalation (Common: no camera change at all)
/**
 * The burst's PEAK must fit the frame whole, whatever the result's own height: the result springs open to this many times its rest height
 * (1.30 measured on the real soft body, 1.25 on the puppet's spring; the starter DOLLOP's Common burst topped out at 1.342 x its rest height
 * with the 0.9 m/s hop) and the hop lifts it a little more. The merge framing is at least the framing that shows that peak with the margin
 * below (of the frame's half height: 4% = 2% of its height) under the top edge. Only a tall result or a frame short for its width makes
 * this bind (the Common merge of the starter on a 4:3 frame widened from 1.026 to 1.057, inside the 4% the harness allows a Common merge);
 * it is a floor under the tier table above, which already covers the other tiers' bursts.
 */
const BURST_OVERSHOOT = 1.3, BURST_TOP_MARGIN = 0.04;
/** The T3 spring-open of the puppet: pre-compressed to 0.8x, overshoots to 1.25x (DESIGN 6.4), settles; calm: 0.9x -> 1.12x. */
const POP = { x0: -0.2, v0: 6.0 }, POP_CALM = { x0: -0.1, v0: 2.8 };
/**
 * How fast the merge result rises from the burst (m/s): ~0.15 above the pad before it lands. Calm: no lift at all (the result appears on the pad and settles): the
 * 0.9 m/s hop carried the bright body up through the top-centre cell of the frame and back, which made the calm Mythic merge 4 local luminance transitions in 1 s (the
 * harness cell metric, 320x240), the same as the normal one; with no hop it is 2 (calm = reduced motion, DESIGN 6.6).
 */
const HOP_VY = [0.9, 1.1, 1.4, 1.7, 1.7, 1.7], HOP_VY_CALM = 0;   // by tier: the Common result only lifts a little (no extra framing for it)
/**
 * The merge result at the burst carries on the charged ball's light: the TIER tell glows through it and is released within 0.5 s, and
 * the parents' lineage colour swirls through as a lighter accent fading over 0.9 s (a heavy or long mix of two far-apart hues, e.g. a
 * coral tell or a pink parent over a green result, read as khaki mud).
 */
const TELL_AT_BURST = [0.55, 0.58, 0.6, 0.42, 0.6, 0.42];   // Epic: coral over a green or teal body turns khaki; Legendary gold and Mythic white are bright already
const MIX_AT_BURST = 0.25;
/** The capsule result's tier tell at the burst (Epic: coral over a green or teal body turns khaki; Mythic white is bright already). */
const CAP_TELL_AT_BURST = [0.26, 0.28, 0.3, 0.18, 0.3, 0.2];
/** The capsule result grows out of the capsule: [start scale, seconds]; soft / calm bursts: from smaller, slower (no one-frame pop). */
const POP_IN: [number, number] = [0.55, 0.3], POP_IN_SOFT: [number, number] = [0.3, 0.5];
/** The crack light while the governor refuses the opposite colour family (coral vs lagoon must not alternate faster than 2 Hz). */
const NEUTRAL_TELL: Rgb = [1, 0.88, 0.68];

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
  /**
   * Hand the current capsule (or a new one standing at the pad, when none is out) to the reveal: from now on the reveal owns it, its
   * CapsuleHandle reads as "opening" (screenPoint null, squeeze / remove ignored) and a new dropCapsule() makes an independent one.
   */
  takeCapsule(): Capsule;
  /** The reveal is done with its capsule: remove and dispose it. */
  releaseCapsule(c: Capsule): void;
  /** The reveal could not start (createBody threw): the capsule goes back on the table as the waiting, tappable one. */
  returnCapsule(c: Capsule): void;
  /** A merge needs the pad: a capsule waiting on the table is put away while it runs (true) and fades back in beside the result (false). */
  parkCapsule(on: boolean): void;
  /** Add world-space scene objects (dome, pillar) owned by a run; removed with removeFromScene. */
  addToScene(o: THREE.Object3D): void;
  removeFromScene(o: THREE.Object3D): void;
  /** Render the current state to the screen and start a crossfade snapshot of it ('decay': fades like the burst light, (1 - t)^2). */
  crossfade(seconds: number, shape?: 'linear' | 'decay'): void;
  /** Camera framing: ease toward a body scale (the result's, from its burst on); null = the primary body's. `snap` jumps there. */
  setFraming(scale: number | null, snap?: boolean): void;
  shake(a: number): void;
  /** World half-width of the frame at the table centre at the rest framing of bodies of `scale` (default: the current framing). */
  viewHalfWidth(scale?: number): number;
  /**
   * The framing (camera scale) at which a point `h` m above the table at the pad lands `margin` (of the frame's half height) under the top of
   * the frame, at the camera's current pitch and zoom: how much headroom a body of that height needs (the merge burst's peak).
   */
  framingForHeight(h: number, margin?: number): number;
}

/**
 * Display-space colour for the screen light ramp: the tier colour, lifted toward white so it reads as light, not paint. Mythic (prism):
 * a pastel white with a slow hue drift, never one saturated hue (a single spectrum sample read as a plain green or blue burst).
 */
function lightColour(style: TierStyle, time: number, out: Rgb): Rgb {
  const t = style.prism ? spectrum(time * 0.2, out) : style.tell, w = style.prism ? 0.62 : 0.18;
  out[0] = linearToSrgb(t[0]) * (1 - w) + w; out[1] = linearToSrgb(t[1]) * (1 - w) + w; out[2] = linearToSrgb(t[2]) * (1 - w) + w;
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
  /**
   * What the run actually did, for the probe to hold against the DESIGN 6.3 escalation table: burst particles emitted, rings / calm fades
   * spawned, the deepest push (+) or pull-back (-) and the widest arc, the lowest time scale and how long it stayed under 1, screen ramps.
   */
  readonly stats = { burstParticles: 0, rings: 0, fades: 0, push: 0, pull: 0, arcDeg: 0, minTimeScale: 1, dipSeconds: 0, ramps: 0, softBurst: 0 };
  /**
   * The burst's OWN light (result tier tell, extra pool light, burst particles, dome / pillar burst, rings, the capsule's pool flash) is
   * scaled by this: 1 when the FlashGovernor granted the burst its screen ramp, SOFT_BURST_GAIN when it refused (a chained ceremony
   * bursting inside 1 s of the last flash), CALM_BURST_GAIN in calm mode. Set at the burst.
   */
  protected gain = 1;
  /** Run time of the burst (-1 before it). */
  protected burstAtT = -1;

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
    // a skip inside the burst light must not cut its decay short (a 120 ms drop is a second, sharper flash): the snapshot then fades like
    // the burst light itself, (1 - t)^2 over what is left of it; the screen ramp keeps its own clock in ScreenFx. Otherwise 120 ms, linear.
    const since = this.burstAtT >= 0 ? this.t - this.burstAtT : Infinity;
    if (since < BURST_LIGHT_S) this.host.crossfade(Math.max(SKIP_CROSSFADE_S, BURST_LIGHT_S - since), 'decay');
    else this.host.crossfade(SKIP_CROSSFADE_S, 'linear');
    this.finalize(true);
    // the final reveal frame, exactly: the result's own clock (every time-phased idle effect reads it) jumps to where the natural
    // ending will have it once the 120 ms crossfade is over, and the framing snaps to the result (the crossfade hides the cut)
    const v = this.resultView;
    if (v) v.clock = Math.max(v.clock, this.duration - SKIP_CROSSFADE_S);
    this.host.setFraming(null, true);
    this.beat('reveal'); this.beat('settle');
    this.skipping = true; this.skipLeft = SKIP_CROSSFADE_S;
  }

  /** Advance by a real dt; returns the time scale the stage applies to physics and particles this frame. */
  step(dt: number): number {
    if (this.finished) return 1;
    if (this.skipping) { this.skipLeft -= dt; if (this.skipLeft <= 0) this.end(); return 1; }
    this.t += dt;
    const raw = this.tick(dt);
    const ts = this.calm ? 1 : raw;   // calm: no slow-motion
    const st = this.stats, cf = this.host.cameraFx;
    st.push = Math.max(st.push, 1 - cf.dist); st.pull = Math.max(st.pull, cf.dist - 1); st.arcDeg = Math.max(st.arcDeg, Math.abs(cf.yaw) * 180 / Math.PI);
    st.minTimeScale = Math.min(st.minTimeScale, raw, ts);   // raw: what the run itself animated with (the result's hop), ts: what physics got
    if (Math.min(raw, ts) < 0.999) st.dipSeconds += dt;
    if (this.t >= this.duration) { this.finalize(false); this.beat('settle'); this.end(); }
    return ts;
  }

  protected end(): void { if (this.finished) return; this.finished = true; this.resolveDone(); }

  protected abstract tick(dt: number): number;
  protected abstract finalize(skipped: boolean): void;

  /**
   * The ONE light ramp of a burst (attack 80 ms, decay 400 ms), through the flash governor; ScreenFx runs it on its own clock. Call FIRST
   * at the burst: it decides `gain` for everything else the burst lights up.
   */
  protected startRamp(): void {
    this.burstAtT = this.t;
    const a = this.host.flash.flash(this.host.now(), FLASH_AMP[this.style.index]);
    if (a > 0) {
      const c = lightColour(this.style, this.t, this.tmp);
      this.host.screen.startRamp(a, c[0], c[1], c[2]);
      this.stats.ramps++; this.gain = 1;
    } else {
      this.gain = this.calm ? CALM_BURST_GAIN : SOFT_BURST_GAIN;
      if (!this.calm) this.stats.softBurst = 1;
    }
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
  protected burstParticles(cx: number, cy: number, cz: number, scale: number): void {
    const P = this.host.particles, i = this.style.index, rng = this.rng, k = this.calm ? 0.3 : 1, ga = this.gain;   // ga: a soft burst's motes are dimmer, not fewer (6.3 counts)
    const before = P.emitted;
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
      P.emit({ x: cx, y: cy, z: cz, vx: rr * Math.cos(a) * sp, vy: Math.abs(z) * sp * 0.9 + 0.4 * scale, vz: rr * Math.sin(a) * sp, life: 0.6 + 0.6 * rng(), size: (0.018 + 0.022 * rng()) * scale, kind: 0, r: c[0], g: c[1], b: c[2], a: 0.9 * ga, drag: 1.3, grav: 0.8 });
    }
    for (let j = 0, n = Math.round(GLITTER[i] * k); j < n; j++) {
      const a = rng() * Math.PI * 2, sp = (0.5 + 0.9 * rng()) * scale;
      P.emit({ x: cx, y: cy, z: cz, vx: Math.cos(a) * sp, vy: (0.6 + 0.9 * rng()) * scale, vz: Math.sin(a) * sp, life: 0.8 + 0.5 * rng(), size: 0.02 * scale, kind: 1, r: 1, g: 0.95, b: 0.85, a: 0.9 * ga, drag: 1.2, grav: 0.5 });
    }
    for (let j = 0, n = Math.round(SPIRAL[i] * k); j < n; j++) {   // Epic: spiral trails
      const a = (j / Math.max(1, n)) * Math.PI * 2 + rng() * 0.4, c = col(j);
      const tx = -Math.sin(a), tz = Math.cos(a);
      P.emit({ x: cx + Math.cos(a) * 0.2 * scale, y: cy, z: cz + Math.sin(a) * 0.2 * scale, vx: (tx * 2.6 + Math.cos(a) * 0.9) * scale, vy: (0.8 + 0.6 * rng()) * scale, vz: (tz * 2.6 + Math.sin(a) * 0.9) * scale, life: 0.8 + 0.3 * rng(), size: 0.03 * scale, kind: 2, r: c[0], g: c[1], b: c[2], a: 0.9 * ga, drag: 1.1 });
    }
    for (let rb = 0, nr = Math.round(RIBBONS[i] * (this.calm ? 0.34 : 1)); rb < nr; rb++) {   // Legendary: three aurora ribbons
      for (let j = 0; j < 14; j++) {
        const a = rb * 2.094 + j * 0.34, h = 0.05 + j * 0.085;
        const aur = 0.5 + 0.5 * Math.sin(j * 0.5 + rb);
        P.emit({ x: cx + Math.cos(a) * 0.32 * scale, y: cy * 0.3 + h * scale, z: cz + Math.sin(a) * 0.32 * scale, vx: -Math.sin(a) * 2.0 * scale, vy: 0.9 * scale, vz: Math.cos(a) * 2.0 * scale, life: 0.9 + 0.5 * (j / 14), size: 0.034 * scale, kind: 2, r: 1.0 - 0.6 * aur, g: 0.62 + 0.2 * aur, b: 0.2 + 0.65 * aur, a: 0.85 * ga, drag: 1.0 });
      }
    }
    for (let j = 0, n = Math.round(STARS[i] * k); j < n; j++) {     // Mythic: star points
      const z = rng() * 2 - 1, a = rng() * Math.PI * 2, rr = Math.sqrt(1 - z * z), sp = (0.5 + 0.8 * rng()) * scale, c = spectrum(rng(), this.tmp);
      P.emit({ x: cx, y: cy, z: cz, vx: rr * Math.cos(a) * sp, vy: (Math.abs(z) * 0.8 + 0.2) * sp, vz: rr * Math.sin(a) * sp, life: 1.6 + 0.6 * rng(), size: 0.034 * scale, kind: 1, r: c[0] * 0.5 + 0.5, g: c[1] * 0.5 + 0.5, b: c[2] * 0.5 + 0.5, a: 0.95 * ga, drag: 1.8, fade: 2 });
    }
    this.stats.burstParticles += P.emitted - before;
  }

  /**
   * One shock ring through the governor (>= 500 ms apart from ANY other ring), or its calm-mode fade. `escalation` = one of the 6.3 table's
   * rings (counted for the probe); the Legendary+ landing "wobble ring" of DESIGN 5.3 is not, but it obeys the same gap.
   */
  protected spawnRing(v: BodyView, x: number, z: number, gain: number, escalation = true): void {
    if (this.calm) { v.fx.spawn('ring', { x, y: 0, z }, gain); if (escalation) this.stats.fades++; return; }   // the view's Fx is in calm mode: a soft fade disc
    if (this.host.flash.ring(this.host.now())) { v.fx.spawn('ring', { x, y: 0, z }, gain); if (escalation) this.stats.rings++; }
  }

  /**
   * The Mythic prism dome after the burst: it swells (radius x1.9, height x1.8 over 0.6 s) and fades. An expanding shell of light THINS as
   * it grows (strength / swept area), so it never adds a second luminance peak right after the burst flash (the flash probe counts those).
   */
  protected expandDome(dome: PrismDome, x: number, z: number, r0: number, h0: number, s0: number, age: number, t: number): void {
    const g = smooth(0, 0.6, age);
    let rx = r0 * (1 + 0.9 * g), ry = h0 * (1 + 0.8 * g);
    // it never swells past the sides of the frame (a narrow portrait phone shows ~1.5 m: the full 1.9x dome crossed both sides by 110..150 px)
    const room = 0.92 * this.host.viewHalfWidth() - Math.abs(x);
    if (rx > room) { const k = Math.max(r0 * 0.9, room) / rx; rx *= k; ry *= Math.max(k, 0.8); }
    dome.set(x, z, rx, ry, s0 * ((r0 * h0) / (rx * ry)) * (1 - smooth(0.4, 1.4, age)), t);
  }

  /** Rings: staggered >= 500 ms apart through the governor (fades in calm mode: same count and spacing). */
  protected ringSchedule(t0: number): number[] {
    const n = RINGS[this.style.index], out: number[] = [];
    for (let i = 0; i < n; i++) out.push(t0 + i * 0.6);
    return out;
  }
}

/* ───────────────────────────── capsule reveal ───────────────────────────── */

export class CapsuleRun extends Run {
  private readonly cap: Capsule;
  private readonly spec: CapsuleRevealSpec;
  private readonly others: BodyView[];
  /** spec.keepCurrent: the current squishy slides ASIDE and stays (not the primary any more), instead of sliding off and being removed. */
  private readonly keep: boolean;
  private readonly asideX: number;
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
  private fadeIn = 0;
  /** Squeeze the capsule already had when the reveal started (the shell's hold-to-open): B0 continues from it, never jumps back. */
  private readonly sq0: number;

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
    this.cap = host.takeCapsule();
    if (!this.cap.landed && this.cap.group.visible === false) this.cap.appear(0, 0.25);
    this.sq0 = this.cap.squeezeAmount;
    this.others = host.allViews().filter((v) => v.visible);
    this.keep = !!spec.keepCurrent;
    this.asideX = -Math.min(1.3, Math.max(0.75, host.viewHalfWidth() * 0.62));
    this.pillar = i === 4 ? new LightPillar() : null;
    this.dome = i === 5 ? new PrismDome() : null;
    if (this.pillar) host.addToScene(this.pillar.mesh);
    if (this.dome) host.addToScene(this.dome.mesh);
    this.rings = this.ringSchedule(this.tb.burstAt);
    // prepay the result's GPU cost now, hidden: the burst frame must not hitch. A throwing createBody leaves the stage as it was:
    // pillar / dome out of the scene, the capsule back on the table (tappable again), the play body untouched; then the error goes up.
    try {
      this.resultView = host.createOwned(spec.result.genome, spec.createBody, tier);
    } catch (e) {
      if (this.pillar) { host.removeFromScene(this.pillar.mesh); this.pillar.dispose(); }
      if (this.dome) { host.removeFromScene(this.dome.mesh); this.dome.dispose(); }
      host.returnCapsule(this.cap);
      this.finished = true; this.resolveDone();
      throw e;
    }
    this.resultView.setVisible(false);
    this.resultView.rarity.strength = 0;
    this.beat('grab');
  }

  protected tick(dt: number): number {
    const { b0, b1, burstAt } = this.tb;
    const t = this.t, st = this.style, i = st.index, host = this.host, cap = this.cap;
    // --- the player's current squishy slides off; the capsule slides to the centre ---
    const slide = smooth(0, Math.max(0.38, 0.5 * this.ks), t);   // never a fast exit, not even in a 0.8 s quick pop (a step in the frame's light)
    if (this.keep) for (const v of this.others) v.proxy.offset.x = this.asideX * v.scale * slide;
    // ... its own aura, dome and motes fade as it leaves (a bright Mythic sliding out in 0.2 s of a quick pop was a luminance drop of its own)
    else for (const v of this.others) { v.proxy.offset.x = -3.4 * slide; v.rarity.strength = 1 - slide; if (slide >= 1) v.setVisible(false); }
    cap.slideTo(0, 0.25, 1 - Math.exp(-dt * 7));
    this.cx = cap.pos.x; this.cz = cap.pos.z;
    // --- B0: grab ---
    if (t < b0) {
      cap.setSqueeze(this.sq0 + (1 - this.sq0) * smooth(0, b0, t));
      if (!this.calm) cap.wobble(0.9 * Math.sin(t * 52) * dt * 12);
    }
    // --- B1: crack (+ the tier pre-roll): light leaks through the cracks in the TIER colour ---
    if (t >= b0 && t < burstAt) {
      this.beat('crack');
      const p1 = clamp01((t - b0) / b1);
      const fam = host.flash.tint(host.now(), st.tellFamily);
      const tell: Rgb = fam === st.tellFamily ? st.tell : NEUTRAL_TELL;
      const crack = smooth(0, 0.7, p1);
      const leak = LEAK[i] * (this.calm ? 0.7 : 1) * (i >= 3 ? Math.pow(p1, 1.6) : smooth(0.05, 1, p1));   // Epic and up: a slow ramp, not a pulse
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
    if (i >= 2 && t >= 0.65 * this.ks) this.beat('preroll');   // Rare+: the audio swell starts here, PREROLL_S[i] before the burst
    // --- B2: burst ---
    let ts = 1;
    if (t >= burstAt && !this.burst) this.doBurst();
    if (this.burst) {
      // time-scale dip (physics and particles only)
      const dipScale = DIP[i][0], dipLen = DIP[i][1];
      if (dipLen > 0 && !this.calm) {   // calm: no slow-motion at all (not even for the result's hop)
        const a = t - burstAt;
        const w = smooth(0, 0.04, a) * (1 - smooth(dipLen, dipLen + 0.09, a));
        ts = 1 - (1 - dipScale) * w;
      }
      this.tickResult(dt * ts, dt);
      cap.setCrack(1, Math.max(0, LEAK[i] * this.gain * (1 - (t - burstAt) * 2.2)), st.tell, st.prism);
      // rings
      while (this.ringIdx < this.rings.length && t >= this.rings[this.ringIdx]) {
        this.ringIdx++;
        const v = this.resultView;
        if (v) this.spawnRing(v, this.cx, this.cz, (RING_GAIN[this.ringIdx - 1] ?? 0.3) * this.gain);
      }
      if (this.pillar) this.pillar.set(this.cx, this.cz, 0.22 + 0.5 * (t - burstAt), 3.2, st.tell, 0.2 * this.gain * Math.max(0, 1 - (t - burstAt) * 1.3));
      if (this.dome) this.expandDome(this.dome, this.cx, this.cz, 0.62, 0.8, 0.85 * this.gain, t - burstAt, t);
    }
    if (t >= this.tb.revealAt) this.beat('reveal');
    // the 6.3 camera column, exactly (Common: none): push / pull-back / arc from the burst, eased back before the end
    this.camera(burstAt, 0.5 * this.ks + 0.2, this.duration, 0.3 * this.tb.b3);
    return ts;
  }

  private doBurst(): void {
    this.burst = true;
    this.beat('burst');
    const host = this.host;
    this.startRamp();                      // first: it decides how much light this burst may make (gain)
    this.cap.burst(this.gain);
    host.particles.attractK = 0;
    host.particles.clear();
    // the result view appears at the capsule and drops out (calm and soft bursts: it grows in from smaller, over longer: no one-frame pop)
    const v = this.resultView as BodyView;
    v.setVisible(true);
    this.drop = { y: this.calm ? 0.12 : 0.3, vy: this.calm ? 0 : 0.6, bounces: this.calm ? 1 : 0, landed: false, age: 0 };
    v.proxy.setOffset(this.cx, this.drop.y, this.cz);
    v.proxy.scale = this.gain < 1 ? POP_IN_SOFT[0] : POP_IN[0];
    host.setFraming(v.scale, this.calm);   // calm: no camera moves, the framing cuts to the result under the burst instead of easing
    this.burstParticles(this.cx, 0.4, this.cz, v.scale);
    this.cap.wobble(0);
  }

  private tickResult(dt: number, realDt: number): void {   // dt: time-scaled (the hop, physics); realDt: wall (the fades)
    const v = this.resultView;
    if (!v) return;
    const d = this.drop, off = v.proxy.offset;
    d.age += dt;
    const pop = this.gain < 1 ? POP_IN_SOFT : POP_IN;
    v.proxy.scale = pop[0] + (1 - pop[0]) * smooth(0, pop[1], d.age);
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
    // the result's tier FX arrive UNDER the burst light, so the scene only dims after the flash (soft / calm: slower, there is no flash)
    this.fadeIn = Math.min(1, this.fadeIn + realDt / (this.gain < 1 ? 0.7 : 0.3));
    v.rarity.strength = smooth(0, 1, this.fadeIn);
    const u = v.mats.uniforms;
    u.uTierAmt.value = Math.max(0, CAP_TELL_AT_BURST[this.style.index] * this.gain * (1 - d.age / 0.9));
    u.uTierCol.value.setRGB(this.style.tell[0], this.style.tell[1], this.style.tell[2], THREE.LinearSRGBColorSpace);
    v.extraPool = Math.max(0, 0.5 * this.gain * (1 - d.age / 1.2)); v.extraPoolTell = 1;
  }

  protected finalize(skipped: boolean): void {
    const host = this.host;
    host.particles.attractK = 0;
    if (skipped) host.particles.clear();   // a natural end lets the last motes / sparkles live out their own short lives
    host.cameraFx.dist = 1; host.cameraFx.yaw = 0; host.cameraFx.pitch = 0;
    this.cap.hide(); host.releaseCapsule(this.cap);
    if (this.pillar) { host.removeFromScene(this.pillar.mesh); this.pillar.dispose(); }
    if (this.dome) { host.removeFromScene(this.dome.mesh); this.dome.dispose(); }
    if (this.keep) for (const o of this.others) o.proxy.offset.x = this.asideX * o.scale;
    else for (const o of this.others) host.removeView(o);
    const v = this.resultView as BodyView;
    v.setVisible(true);
    v.proxy.setOffset(0, 0, 0); v.proxy.scale = 1; v.proxy.popFrom(0, 0);
    if (skipped || !this.drop.landed) v.proxy.inner.reset();
    v.rarity.strength = 1; v.extraPool = 0; v.extraPoolTell = 0; v.core.boost = 0;
    v.mats.uniforms.uTierAmt.value = 0; v.mats.uniforms.uMixAmt.value = 0;
    host.makePrimary(v);
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
  /** Each parent's slide axis (unit, toward the pad), precomputed: no per-frame objects. */
  private readonly dirX: number[] = []; private readonly dirZ: number[] = [];
  /** The ceremony framing factor over the play framing (1 = none). */
  private framing = 1;
  /** The ball's own inner-glow colour (linear) before the charge leans it toward the tell. */
  private readonly coreCol0: Rgb = [1, 0.5, 0.3];
  private readonly pillar: LightPillar | null;
  private readonly dome: PrismDome | null;
  private readonly rings: number[] = [];
  private ringIdx = 0;
  private burst = false;
  private drop = { y: 0, vy: 0, landed: false, age: 0, hopped: false };
  private moteAcc = 0;
  private readonly moteSpec: EmitSpec = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.55, size: 0.02, kind: 0, r: 1, g: 1, b: 1, a: 0.9, attract: 1, spin: 6, drag: 0.6, grav: 0, fade: 1 };
  private sparkled = false;
  private fadeIn = 0;
  private readonly mixCol: Rgb;
  private bodyScale = 1;
  private ballCx = 0; private ballCy = 0.4; private ballCz = 0;
  /**
   * 2 parents: a pair side by side. 3 parents: in a ROW (left, middle, right; the middle one is pressed from both sides) where the frame is
   * wide enough, else a TRIANGLE (one in front, two behind) whose back pair closes its eyes once pressed in behind the front one.
   */
  private readonly layout: 'pair' | 'row' | 'triangle';

  constructor(host: CeremonyHost, spec: MergeCeremonySpec, hooks: CeremonyHooks | undefined) {
    const tier = spec.result.tier, tierUp = !!spec.result.tierUp, calm = host.calm();
    const D = mergeDuration(tier, { tierUp, calm });
    super(host, tier, D, hooks, spec.result.genome.seed);
    this.spec = spec;
    const i = this.style.index;
    const nominal = MERGE_BUDGET_S[tier] + (tierUp ? TIER_UP_ACCENT_S : 0);
    const ks = this.ks = D / nominal;
    const T0 = 0.4 * ks, T1 = 0.5 * ks, T2 = (MERGE_BURST_AT_S[i] - 0.9) * ks, T3 = 0.2 * ks;
    const T4 = D - (T0 + T1 + T2 + T3);
    this.b = { t0: 0, t1: T0, t2: T0 + T1, t3: T0 + T1 + T2, t4: T0 + T1 + T2 + T3, a1: T0, a2: T1, a3: T2, a4: T4 };
    this.others = host.allViews().filter((v) => v.visible);
    const n = Math.max(2, Math.min(3, spec.parents.length));
    // create every body first (a throwing createBody must leave the stage exactly as it was), then hide the others and lay out
    try {
      for (let k = 0; k < n; k++) {
        const p = spec.parents[k] ?? spec.parents[0];
        this.parents.push(host.createOwned(p.genome, spec.createBody, p.tier ?? 'common'));
      }
      this.resultView = host.createOwned(spec.result.genome, spec.createBody, tier);   // prepay the result's GPU cost now, hidden
    } catch (e) {
      for (const v of this.parents) host.removeView(v);
      this.parents.length = 0;
      if (this.resultView) host.removeView(this.resultView);
      this.resultView = null;
      this.finished = true; this.resolveDone();
      throw e;
    }
    for (const v of this.others) v.setVisible(false);
    host.parkCapsule(true);                // a capsule waiting on the table would stand in the parents' way: away until the end
    this.resultView.setVisible(false);
    this.resultView.rarity.strength = 0;
    let fr = this.resultView.scale;
    for (const v of this.parents) fr = Math.max(fr, v.scale);
    this.bodyScale = this.parents[0].scale;
    { const cc = this.parents[0].mats.uniforms.uCoreCol.value; this.coreCol0[0] = cc.r; this.coreCol0[1] = cc.g; this.coreCol0[2] = cc.b; }
    const hw0 = host.viewHalfWidth(fr);    // half-width of the PLAY framing of these bodies at the pad
    this.layout = n === 2 ? 'pair' : hw0 >= 1.25 ? 'row' : 'triangle';
    // where the parents start: a short slide in on narrow frames, from ~1.2 out on desktop; then the framing that shows them whole
    // (on a frame wide enough for the pair at the play framing they start where both fit it: the Common merge then makes no camera move at all, DESIGN 6.3;
    // starting further out (1.24 m on desktop) widened the framing by 18% for every tier and eased it back at the reveal)
    const reach = Math.max(0.5 * fr, Math.min(1.55, hw0 * 0.9 - 0.15, hw0 - 0.58 * fr - 0.02));
    const need = this.layout === 'row' ? 0 : (this.layout === 'pair' ? reach : reach * 0.97) + 0.58 * fr;
    const fit = Math.min(1.5, Math.max(1, need / Math.max(0.2, hw0)));
    // the burst's peak (the spring-open and the hop) inside the top of the frame, from the result's own rest height (calm: a gentler pop, no widening)
    const peakH = this.resultView.restH * BURST_OVERSHOOT + (HOP_VY[i] * HOP_VY[i]) / (2 * 9.8);
    const top = this.calm ? 1 : Math.min(1.5, host.framingForHeight(peakH, BURST_TOP_MARGIN) / fr);
    const framing = Math.max(fit, this.calm ? 1 : MERGE_FRAMING[i], top);
    host.setFraming(framing * fr, true);  // a cut: the merge starts a new scene (every play body hides), so no zoom move is seen
    const hw = hw0 * framing;
    for (let k = 0; k < n; k++) {
      if (this.layout === 'pair') this.start.push({ x: k === 0 ? -reach : reach, z: 0 });
      else if (this.layout === 'row') this.start.push({ x: k === 0 ? 0 : (k === 1 ? -1 : 1) * Math.max(0.9, hw * 0.95 - 0.3), z: 0 });
      else { const ang = Math.PI / 2 + (k * 2 * Math.PI) / 3; this.start.push({ x: Math.cos(ang) * reach * 0.97, z: Math.sin(ang) * 1.2 }); }
      const s = this.start[k], l = Math.hypot(s.x, s.z);
      this.dirX.push(l > 1e-6 ? s.x / l : 1); this.dirZ.push(l > 1e-6 ? s.z / l : 0);   // the middle of a row sits on the pad: its axis is the row
      this.parents[k].proxy.setOffset(s.x, 0, s.z);
    }
    this.framing = framing;
    // the parents' lineage colour: the average of the others' body colours swirls through the ball
    const avg: Rgb = [0, 0, 0];
    const mixFrom = spec.parents.length > 1 ? spec.parents.slice(1) : spec.parents;   // the ball itself is the first parent
    for (const p of mixFrom) { const pal = genomePalette(p.genome); avg[0] += pal.body[0] / mixFrom.length; avg[1] += pal.body[1] / mixFrom.length; avg[2] += pal.body[2] / mixFrom.length; }
    this.mixCol = avg;
    this.pillar = i === 4 ? new LightPillar() : null;
    this.dome = i === 5 ? new PrismDome() : null;
    if (this.pillar) host.addToScene(this.pillar.mesh);
    if (this.dome) host.addToScene(this.dome.mesh);
    this.beat('press');
  }

  protected tick(dt: number): number {
    const t = this.t, b = this.b, st = this.style, i = st.index, host = this.host;
    const n = this.parents.length;
    const sc = this.bodyScale;
    let ts = 1;
    if (t < b.t3) {
      // ---- T0 press together / T1 fold ----
      const slide = smooth(0, b.a1, t);
      const row = this.layout === 'row';
      // each body's centre distance from the pad once slid in (overlapping = pressed); a row's side bodies press into the middle one
      const gap = (row ? 0.66 : 0.33) * sc;
      const foldP = smooth(b.t1, b.t2, t);
      // the contact plane sits between the bodies, so the flattening starts exactly when they touch; it lets go during the fold
      const squash = 1 - smooth(b.t1 + b.a2 * 0.25, b.t2, t);
      const sideX = row ? Math.abs(this.start[1].x + (-gap - this.start[1].x) * slide) * (1 - foldP) : 0;
      for (let k = 0; k < n; k++) {
        const v = this.parents[k], s = this.start[k], dx = this.dirX[k], dz = this.dirZ[k];
        const middle = row && k === 0;
        const px = middle ? 0 : (s.x + (dx * gap - s.x) * slide) * (1 - foldP), pz = middle ? 0 : (s.z + (dz * gap - s.z) * slide) * (1 - foldP);
        v.proxy.offset.x = px; v.proxy.offset.z = pz;
        v.proxy.squashAx = dx; v.proxy.squashAz = dz; v.proxy.squashAmt = squash; v.proxy.squashTwoSided = middle;
        v.rarity.strength = 1 - foldP;          // the parents' own tier aura gives way to the ball (the RESULT tier's tell is the charge's story)
        v.proxy.squashPlane = row ? sideX * 0.5 : Math.hypot(px, pz) * (n === 2 ? 1 : 0.85);
        // triangle (narrow frames): the back pair overlaps the front parent on screen from the first frame, and their eyes would show
        // through its jelly as stray extra eyes; they keep them closed
        if (this.layout === 'triangle' && k > 0) v.faceHidden = true;
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
      ball.proxy.tremble(this.calm ? 0 : 0.2 + 0.8 * p2);   // calm: no tremble at all
      ball.proxy.charge = 0.3 + 0.7 * p2;
      ball.proxy.scale = 1 - 0.1 * p2;
      ball.core.boost = 1.0 + 1.1 * p2;
      const fam = host.flash.tint(host.now(), st.tellFamily);
      const tellOk = fam === st.tellFamily;
      // the tell lands by ~55% of the charge and holds there: the halfway mix of a warm ball and a cool tell (apricot + lagoon cyan) is a
      // grey-cream, so it must not linger (RENDER-3 filmstrip: an Uncommon charge still read cream at mid-charge)
      const u = ball.mats.uniforms, tc = tellOk ? st.tell : NEUTRAL_TELL, p2s = smooth(0, 0.55, p2);
      u.uTierCol.value.setRGB(tc[0], tc[1], tc[2], THREE.LinearSRGBColorSpace);
      // the ball's inner light is its biggest colour: an ember core glowing at x2 would out-shout any tint of the jelly around it
      if (!st.prism) {
        ball.core.tint(tc[0], tc[1], tc[2], 0.8 * p2s);
        u.uCoreCol.value.setRGB(this.coreCol0[0] + (tc[0] - this.coreCol0[0]) * p2s, this.coreCol0[1] + (tc[1] - this.coreCol0[1]) * p2s, this.coreCol0[2] + (tc[2] - this.coreCol0[2]) * p2s, THREE.LinearSRGBColorSpace);
      }
      // the ball's light drifts toward the result tier colour: its own colour leans into the tell (diffuse AND absorption) while the lineage
      // swirl gives way, plus some tell light. Additive light alone only whitened a warm ball (an Uncommon read cream, an Epic pink); the
      // Mythic prism tell (white) stays light
      u.uTierTint.value = st.prism ? 0 : 0.72 * p2s;
      u.uTierAmt.value = (st.prism ? 0.95 : 0.4) * p2s;
      u.uMixAmt.value = 0.7 * (1 - p2s);
      ball.extraPool = 0.5 * p2; ball.extraPoolTell = tellOk ? p2 : 0;
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
        // one reused spec (this runs every frame of the charge: no per-mote object); same RNG call order as the literal it replaces
        const e = this.moteSpec;
        e.x = this.ballCx + Math.cos(a) * R; e.y = this.ballCy + (this.rng() - 0.4) * 0.6 * sc; e.z = this.ballCz + Math.sin(a) * R;
        e.vx = -Math.sin(a) * 1.4; e.vz = Math.cos(a) * 1.4;
        e.size = (0.02 + 0.018 * this.rng()) * sc; e.kind = this.rng() < 0.4 ? 2 : 0;
        e.r = 0.35 + mixr * 1.4; e.g = 0.35 + mixg * 1.4; e.b = 0.35 + mixb * 1.4;
        P.emit(e);
      }
      if (this.pillar) { const pp = smooth(b.t3 - 0.8 * this.ks, b.t3, t); this.pillar.set(this.ballCx, this.ballCz, 0.25, 3.2, st.tell, 0.3 * pp); }
      if (this.dome) this.dome.set(this.ballCx, this.ballCz, 0.7, 0.9, 0.8 * smooth(0, 1, p2), t);
    }
    // ---- T3 burst ----
    if (t >= b.t3 && !this.burst) this.doBurst();
    if (this.burst) {
      const dipScale = DIP[i][0], dipLen = DIP[i][1];
      if (dipLen > 0 && !this.calm) {   // calm: no slow-motion at all (not even for the result's hop)
        const a = t - b.t3;
        ts = 1 - (1 - dipScale) * smooth(0, 0.04, a) * (1 - smooth(dipLen, dipLen + 0.09, a));
      }
      this.tickResult(dt * ts, dt);
      while (this.ringIdx < this.rings.length && t >= this.rings[this.ringIdx]) {
        this.ringIdx++;
        const v = this.resultView;
        if (v) this.spawnRing(v, 0, 0, (RING_GAIN[this.ringIdx - 1] ?? 0.3) * this.gain);
      }
      if (this.pillar) this.pillar.set(0, 0, 0.25 + 0.5 * (t - b.t3), 3.2, st.tell, 0.2 * this.gain * Math.max(0, 1 - (t - b.t3) * 1.2));
      if (this.dome) this.expandDome(this.dome, 0, 0, 0.7, 0.9, 0.8 * this.gain, t - b.t3, t);
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
    if (t >= b.t4 && !this.fired.has('reveal')) {
      this.beat('reveal');
      if (!this.calm && this.resultView) host.setFraming(this.resultView.scale);   // back to the play framing by the end of T4
    }
    this.camera(b.t3, 0.45 * this.ks + 0.2, this.duration, 0.3 * b.a4);
    return ts;
  }

  private doBurst(): void {
    this.burst = true;
    const host = this.host, st = this.style, i = st.index;
    this.beat('burst');
    this.startRamp();                      // first: it decides how much light this burst may make (gain)
    host.particles.attractK = 0;
    host.particles.clear();
    for (const p of this.parents) { host.removeView(p); }
    this.parents.length = 0;
    const v = this.resultView as BodyView;
    v.setVisible(true);
    v.proxy.setOffset(0, 0, 0); v.proxy.scale = 1;
    if (this.calm) host.setFraming(v.scale, true);   // calm: no camera moves; the framing cuts to the result under the burst
    // springs open: overshoots to 1.25x, then settles (native burstOpen, or the proxy's puppet spring); calm: a gentler pop
    const pop = this.calm ? POP_CALM : POP;
    if (v.proxy.native.burst) v.proxy.burstOpen(this.calm ? 0.45 : 1); else v.proxy.popFrom(pop.x0, pop.v0);
    const mix = v.mats.uniforms;
    mix.uMixCol.value.setRGB(this.mixCol[0], this.mixCol[1], this.mixCol[2], THREE.LinearSRGBColorSpace);
    mix.uMixAmt.value = MIX_AT_BURST;
    mix.uTierAmt.value = TELL_AT_BURST[i] * this.gain;
    mix.uTierTint.value = 0;
    v.extraPoolTell = 1;
    this.drop = { y: 0, vy: this.calm ? HOP_VY_CALM : HOP_VY[i], landed: false, age: 0, hopped: true };
    this.rings.push(...this.ringSchedule(this.b.t3));
    this.burstParticles(0, this.ballCy, 0, v.scale);
    host.shake(KICK[i]);
  }

  private tickResult(dt: number, realDt: number): void {   // dt: time-scaled (the hop, physics); realDt: wall (the fades)
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
        // Legendary and up: it settles with a visible wobble ring (DESIGN 5.3), but never at the cost of an escalation ring: only when none of
        // the 6.3 rings is due within the 500 ms gap (+ a frame of margin), and through the governor like every ring
        const next = this.ringIdx < this.rings.length ? this.rings[this.ringIdx] - this.t : Infinity;
        if (this.style.index >= 4 && next > 0.55) this.spawnRing(v, 0, 0, 0.8, false);
        this.host.shake(0.05 + 0.04 * this.style.index);
      }
      off.y = d.y;
    }
    // the result's tier FX arrive UNDER the burst light, so the scene only dims after the flash (soft / calm: slower, there is no flash)
    this.fadeIn = Math.min(1, this.fadeIn + realDt / (this.gain < 1 ? 0.7 : 0.3));
    v.rarity.strength = smooth(0, 1, this.fadeIn);
    const fall = 1 - smooth(0, 0.5, d.age);   // the tell is RELEASED by the burst (rings, pool, motes carry it on); the body is its own colour by ~0.5 s
    u.uTierAmt.value = TELL_AT_BURST[this.style.index] * this.gain * fall;
    u.uMixAmt.value = MIX_AT_BURST * (1 - smooth(0, 0.9, d.age));
    v.extraPool = Math.max(0, this.gain * (1 - d.age / 1.2));
    v.core.boost = Math.max(0, 0.5 * (1 - d.age / 0.7));
  }

  protected finalize(skipped: boolean): void {
    const host = this.host;
    host.particles.attractK = 0;
    if (skipped) host.particles.clear();   // a natural end lets the last motes / tier-up sparkles live out their own short lives
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
    v.rarity.strength = 1; v.extraPool = 0; v.extraPoolTell = 0; v.core.boost = 0;
    v.mats.uniforms.uTierAmt.value = 0; v.mats.uniforms.uMixAmt.value = 0; v.mats.uniforms.uTierTint.value = 0;
    host.makePrimary(v);
    host.parkCapsule(false);               // a waiting capsule fades back in beside the result
  }
}

/* ───────────────────────────── director ───────────────────────────── */

export class CeremonyDirector {
  private run: Run | null = null;
  private readonly host: CeremonyHost;
  constructor(host: CeremonyHost) { this.host = host; }

  get active(): boolean { return !!this.run && this.run.active; }
  get current(): CeremonyHandle | null { return this.run && this.run.active ? this.run : null; }
  /** Which ceremony is running, if any. */
  get kind(): 'capsule' | 'merge' | null { return this.run && this.run.active ? (this.run instanceof MergeRun ? 'merge' : 'capsule') : null; }

  startCapsule(spec: CapsuleRevealSpec, hooks?: CeremonyHooks): CeremonyHandle {
    this.abort();
    const r = new CapsuleRun(this.host, { ...spec, result: { ...spec.result, tier: safeTier(spec.result.tier) } }, hooks);
    this.run = r;
    return r;
  }
  startMerge(spec: MergeCeremonySpec, hooks?: CeremonyHooks): CeremonyHandle {
    this.abort();
    // MERGE_COST parents (2 or 3); a malformed spec degrades (no parents: the result's genome stands in) instead of throwing mid-frame
    const parents = (spec.parents && spec.parents.length ? spec.parents : [{ genome: spec.result.genome }]).map((p) => ({ genome: p.genome, tier: safeTier(p.tier) }));
    const r = new MergeRun(this.host, { ...spec, parents, result: { ...spec.result, tier: safeTier(spec.result.tier) } }, hooks);
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

