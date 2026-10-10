// GENESIS — spatial audio (CONTRACT §17: PannerNode / HRTF for fires, crowds, storms, impacts, launches, the
// creature). The listener stays at the origin facing −z with +y up (WebAudio's default frame) and every source is
// moved into camera space instead (scene.ts computes listener-local positions), so a camera 10⁷ m from the star never
// feeds huge coordinates to the panner. The panner only places the DIRECTION (its rolloff is off); distance is
// heard through our own gain (scene.ts `attenuate`, sized by altitude), an air-absorption lowpass that darkens far
// sounds, and, for physical one-shots, a delay at the speed of sound.

import { Knob } from './synth.ts';

export const SPEED_OF_SOUND = 343;

/** air absorption: far sounds lose their highs (a far storm is a rumble, a near one hisses) */
export function airCutoff(dist: number): number {
  return Math.max(650, Math.min(20000, 20000 * Math.exp(-dist / 1300)));
}

/** seconds a sound takes to arrive (capped: a god does not wait half a minute for a boom) */
export function soundDelay(dist: number, cap = 5): number {
  return Math.min(cap, Math.max(0, dist) / SPEED_OF_SOUND);
}

/**
 * One spatialised output: sources → `input` → air lowpass → level → panner → destination. `place` moves it (smoothed,
 * so a source sliding past pans without zipper noise).
 */
export class SpatialOut {
  readonly input: GainNode;
  private readonly air: BiquadFilterNode;
  private readonly level: GainNode;
  private readonly panner: PannerNode | StereoPannerNode;
  private readonly kx: Knob | null = null;
  private readonly ky: Knob | null = null;
  private readonly kz: Knob | null = null;
  private readonly kAir: Knob;
  private readonly kLevel: Knob;
  private readonly kPan: Knob | null = null;
  private readonly isPanner: boolean;
  private disposed = false;

  constructor(ctx: BaseAudioContext, dest: AudioNode, hrtf: boolean) {
    this.input = ctx.createGain();
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = 20000;
    this.air.Q.value = 0.5;
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    if (hrtf && typeof ctx.createPanner === 'function') {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1;
      p.rolloffFactor = 0;
      p.coneInnerAngle = 360;
      p.coneOuterAngle = 360;
      this.panner = p;
      this.isPanner = true;
      if (p.positionX) {
        p.positionX.value = 0; p.positionY.value = 0; p.positionZ.value = -1;
        this.kx = new Knob(p.positionX); this.ky = new Knob(p.positionY); this.kz = new Knob(p.positionZ);
      } else {
        (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(0, 0, -1);
      }
    } else {
      const sp = ctx.createStereoPanner();
      this.panner = sp;
      this.isPanner = false;
      this.kPan = new Knob(sp.pan);
    }
    this.kAir = new Knob(this.air.frequency);
    this.kLevel = new Knob(this.level.gain);
    this.input.connect(this.air);
    this.air.connect(this.level);
    this.level.connect(this.panner);
    this.panner.connect(dest);
  }

  /**
   * Put the source at listener-local `local` (m) heard at `level`; `spread` 0..1 pulls it toward the middle of the head
   * (the listener is inside it: a crowd around you, a storm overhead).
   */
  place(local: ArrayLike<number>, level: number, now: number, spread = 0, tau = 0.06): void {
    if (this.disposed) return;
    const d = Math.hypot(local[0], local[1], local[2]);
    let x = 0, y = 0, z = -1;
    if (d > 1e-3) { x = local[0] / d; y = local[1] / d; z = local[2] / d; }
    if (spread > 0) {
      const s = Math.min(1, spread);
      x *= 1 - s; y = y * (1 - s) + 0.1 * s; z = z * (1 - s) - 0.6 * s;
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
    }
    if (this.kx && this.ky && this.kz) { this.kx.set(x, now, tau); this.ky.set(y, now, tau); this.kz.set(z, now, tau); }
    else if (this.kPan) this.kPan.set(Math.max(-1, Math.min(1, x)), now, tau);
    else (this.panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
    this.kAir.set(airCutoff(d), now, 0.15);
    this.kLevel.set(Math.max(0, level), now, tau * 2);
  }

  /** one-shot placement at a future time (an impact heard later than it is seen) */
  placeAt(local: ArrayLike<number>, level: number, t: number, spread = 0): void {
    const d = Math.hypot(local[0], local[1], local[2]);
    let x = 0, y = 0, z = -1;
    if (d > 1e-3) { x = local[0] / d; y = local[1] / d; z = local[2] / d; }
    if (spread > 0) { const s = Math.min(1, spread); x *= 1 - s; y *= 1 - s; z = z * (1 - s) - 0.6 * s; }
    if (this.isPanner) {
      const pn = this.panner as PannerNode;
      if (pn.positionX) { pn.positionX.setValueAtTime(x, t); pn.positionY.setValueAtTime(y, t); pn.positionZ.setValueAtTime(z, t); }
      else (pn as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
    } else (this.panner as StereoPannerNode).pan.setValueAtTime(Math.max(-1, Math.min(1, x)), t);
    this.air.frequency.setValueAtTime(airCutoff(d), t);
    this.level.gain.setValueAtTime(Math.max(0, level), t);
  }

  fadeOut(now: number, tau = 0.15): void {
    if (this.disposed) return;
    this.kLevel.set(0, now, tau);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.panner.disconnect(); } catch { /* already gone */ }
    try { this.input.disconnect(); this.air.disconnect(); this.level.disconnect(); } catch { /* already gone */ }
  }
}
