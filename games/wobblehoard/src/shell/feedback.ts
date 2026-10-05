// SoftEvent -> audio, haptics, screen shake and FX; the held squelch voices; the round-3 play-mat voices.
//
//   poke     audio.poke, 8 ms tick, small shake                       press   a held squelch voice for that finger
//   release  ends the voice; audio.release, 18 ms thump, shake, and (a proper squeeze) bubbles + 1-3 pops (CALIBRATION in feel.ts)
//   land     audio.land, dust (+ a ring when hard), shake               grab    a stretch voice for that finger
//   snap     ends the voice; audio.release by pull level, thump, shake, bubbles / glitter, 1-3 pops
// The squelch is driven every frame from max(compression, press) when the body reports press (contracts.ts), else from compression.
//
// Round 3 play-mat voices (SOUND.md "When the shell should call what"), each feature-detected on the audio engine:
//   lift    the rising edge of "grabbed and lifted off the mat" (table mode only: a floating body is never grounded) held 0.1 s
//   toss    on the snap that ends a lifted pull, speed = |centre velocity| / 4 m/s, only above 0.1
//   strand  a body that reports SoftMetrics.strands (contracts.ts: the physics' own sticky strings, a pull or a press lifting off a tacky
//           body): every frame while strands >= 0.02, tension = strands; when they let go from >= 0.3 that was a break: snap: true.
//           A body without the metric: every frame while a TACKY family (Sticky Stretch, Slime Goo) is pulled, tension = pull level;
//           snap: true on the snap event.
//   bump    SEAM ONLY: needs two bodies touching (stage B). `bumpCheck` is the place: the rising edge of distance(cA, cB) < 0.95 (rA + rB).
import type { SoftBodyLike, SoftEvent, SquishAudio, SquishVoiceHandle, StageLike, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { pitchRatio } from '../core/genome.ts';
import { clamp, mulberry32 } from '../core/rng.ts';
import { familyOf, getSpecies } from '../data/catalog.ts';
import type { Haptics } from '../input/haptics.ts';
import type { SimTimers } from './clock.ts';
import type { TouchState } from './driver.ts';
import { clamp01, hasPress, pullLevel, pullScale, releaseFxLevel, squeezeDepth } from './feel.ts';

export type StatKey = 'pokes' | 'squishes' | 'pulls' | 'releases';

interface Voice { handle: SquishVoiceHandle; mode: 'press' | 'pull'; prevStretch: number; stretchRate: number }

export interface Feedback {
  handle(ev: SoftEvent): void;
  /** every sim step after the events: drive the held voices, the strand, lift detection, haptic squeeze pulses */
  update(dt: number): void;
  /** a voice must never outlive its finger (release events are not guaranteed): end voices of lifted fingers */
  sweep(): void;
  endAll(fade?: number): void;
  /** a new play body: forget per-body state (lift, strand, velocity) */
  resetBody(): void;
  readonly liveVoices: number;
}

export interface FeedbackDeps {
  audio: SquishAudio;
  haptics: Haptics;
  stage: StageLike;
  touch: TouchState;
  timers: SimTimers;
  body(): SoftBodyLike;
  genome(): Genome;
  simTime(): number;
  stepCount(): number;
  gravity(): boolean;
  panOfPoint(p: V3): number;
  bump(stat: StatKey): void;
  report(e: unknown): void;
}

const TACKY = new Set<string>(['stickystretch', 'slimegoo']);
/** metrics.strands: a strand voice runs from STRAND_ON; strings that let go from STRAND_BREAK or more broke (a snap), weaker ones just fade */
const STRAND_ON = 0.02, STRAND_BREAK = 0.3;

export function createFeedback(d: FeedbackDeps): Feedback {
  const voices: Array<Voice | null> = [null, null];
  const rng = mulberry32(0x57155);
  const pitch = (): number => pitchRatio(d.genome());
  const { touch } = d;
  // round 3 state
  let lifted = false, liftSince = -1, wasGroundedAtGrab = false;
  let strandOn = false, strandLast = 0;
  let pcx = 0, pcy = 0, pcz = 0, vx = 0, vy = 0, vz = 0, haveC = false;
  const tacky = (): boolean => { try { const g = d.genome(); return !!getSpecies(g.species) && TACKY.has(familyOf(g.species)); } catch { return false; } };

  function endVoice(f: number, fade?: number): void {
    const v = voices[f];
    if (!v) return;
    voices[f] = null;
    try { v.handle.end(fade); } catch (e) { d.report(e); }
  }
  function startVoice(f: number, mode: 'press' | 'pull', at: V3): void {
    if (f !== 0 && f !== 1) return;
    if (!(touch.fingerDown[f] || touch.grabActive[f])) return; // the finger is already up: nothing to hold a voice for
    endVoice(f, 0.04);
    const pan = d.panOfPoint(at);
    const handle = d.audio.squishStart({ pitch: pitch() * (mode === 'pull' ? 1.12 : 1), pan });
    if (!handle) return;
    touch.fingerPan[f] = pan;
    voices[f] = { handle, mode, prevStretch: d.body().metrics.stretch, stretchRate: 0 };
  }

  /** one to three bubble pops, 40-120 ms apart */
  function pops(n: number, at: V3, size: number): void {
    const pan = d.panOfPoint(at);
    let delay = 0;
    for (let i = 0; i < n; i++) {
      delay += 40 + rng() * 80;
      const sz = clamp01(size * (0.55 + rng() * 0.6));
      d.timers.schedule(d.simTime() + delay / 1000, () => { d.audio.pop({ size: sz, pitch: pitch(), pan }); d.haptics.pop(); });
    }
  }

  function handle(ev: SoftEvent): void {
    const I = clamp01(ev.intensity);
    const f = ev.finger;
    const body = d.body();
    switch (ev.kind) {
      case 'poke':
        d.bump('pokes');
        d.audio.poke({ intensity: I, pitch: pitch(), pan: d.panOfPoint(ev.at) });
        d.haptics.poke();
        d.stage.shake(0.06 + 0.14 * I);
        break;
      case 'press':
        d.bump('squishes');
        startVoice(f, 'press', ev.at);
        break;
      case 'release': {
        endVoice(f);
        if ((f === 0 || f === 1) && touch.skipRelease[f] === d.stepCount()) break; // the contact became a pull (or was cancelled): no bloop
        d.bump('releases');
        d.audio.release({ compression: I, pitch: pitch(), pan: d.panOfPoint(ev.at) });
        d.haptics.release();
        d.stage.shake(0.15 + 0.5 * I);
        const peak = f === 0 || f === 1 ? touch.peakPress[f] : 0;
        const fx = releaseFxLevel(I, peak, hasPress(body.metrics));
        if (fx > 0) {
          d.stage.spawnFx('bubbles', ev.at, Math.max(I, fx));
          pops(1 + Math.min(2, Math.floor(fx * 2.999)), ev.at, Math.max(I, 0.3 + 0.3 * fx));
        }
        break;
      }
      case 'land':
        d.audio.land({ intensity: I, pitch: pitch() });
        d.stage.spawnFx('dust', ev.at, I);
        if (I > 0.45) d.stage.spawnFx('ring', ev.at, I);
        d.stage.shake(0.1 + 0.4 * I);
        break;
      case 'grab':
        d.bump('pulls');
        startVoice(f, 'pull', ev.at);
        wasGroundedAtGrab = body.metrics.grounded;
        lifted = false; liftSince = -1;
        break;
      case 'snap': {
        endVoice(f);
        d.bump('releases');
        const S = pullLevel(I, hasPress(body.metrics)); // how hard the pull was, 0..1 (CALIBRATION.stretchFull)
        d.audio.release({ compression: S, pitch: pitch(), pan: d.panOfPoint(ev.at) });
        d.haptics.release();
        d.stage.shake(0.1 + 0.4 * S);
        if (S > 0.25) d.stage.spawnFx('bubbles', ev.at, S);
        if (S > 0.55) d.stage.spawnFx('glitter', ev.at, S);
        if (strandOn && d.audio.strand) {
          // the strand's own snap carries 1-3 tiny bubbles (SOUND.md): no extra pops for it. With metrics.strands the strings may outlast
          // the snap event: update() plays their break when they let go.
          if (typeof (body.metrics as { strands?: number }).strands !== 'number') {
            try { d.audio.strand({ tension: S, snap: true, pitch: pitch(), pan: d.panOfPoint(ev.at) }); } catch (e) { d.report(e); }
            strandOn = false;
          }
        } else pops(1 + Math.min(2, Math.floor(S * 2.999)), ev.at, Math.max(0.4, S));
        if (lifted && d.audio.toss) {
          const speed = clamp(Math.hypot(vx, vy, vz) / 4, 0, 1);
          if (speed > 0.1) { try { d.audio.toss({ speed, pan: d.panOfPoint(ev.at) }); } catch (e) { d.report(e); } }
        }
        lifted = false; liftSince = -1;
        break;
      }
    }
  }

  function update(dt: number): void {
    const body = d.body();
    const m = body.metrics;
    // centre velocity (toss), no allocation
    const c = body.center;
    if (haveC && dt > 0) {
      const k = 1 - Math.exp(-dt / 0.05);
      vx += ((c.x - pcx) / dt - vx) * k; vy += ((c.y - pcy) / dt - vy) * k; vz += ((c.z - pcz) / dt - vz) * k;
    }
    pcx = c.x; pcy = c.y; pcz = c.z; haveC = true;

    let rate = 0;
    const depth = squeezeDepth(m);
    for (let f = 0; f < 2; f++) {
      const v = voices[f];
      if (!v) continue;
      let comp: number;
      let r: number;
      if (v.mode === 'press') { comp = depth; r = m.compressionRate; }
      else {
        const raw = (m.stretch - v.prevStretch) / Math.max(dt, 1e-3);
        v.stretchRate += (clamp(raw, -12, 12) - v.stretchRate) * 0.35;
        v.prevStretch = m.stretch;
        const k = pullScale(hasPress(m)); // 1 / stretchFull while the rescale applies (feel.ts CALIBRATION)
        comp = m.stretch * k; r = v.stretchRate * k;
      }
      if (Math.abs(r) > Math.abs(rate)) rate = r;
      try { v.handle.update({ compression: clamp01(comp), rate: Number.isFinite(r) ? r : 0, pan: touch.fingerPan[f] }); } catch (e) { d.report(e); }
    }
    if (rate !== 0) d.haptics.squeeze(rate);

    // ---- round 3: lift / strand (feature-detected) ----
    const grabbed = touch.grabActive[0] || touch.grabActive[1];
    if (grabbed && d.audio.lift && !lifted && d.gravity() && wasGroundedAtGrab) {
      const off = !m.grounded || m.stretch >= 1;
      if (off) { if (liftSince < 0) liftSince = d.simTime(); else if (d.simTime() - liftSince >= 0.1) { lifted = true; try { d.audio.lift({ pitch: pitch(), pan: d.panOfPoint(c) }); } catch (e) { d.report(e); } } }
      else liftSince = -1;
    }
    if (d.audio.strand) {
      const sm = (m as { strands?: number }).strands;   // read through a cast: the field is the physics lane's round-3 addition
      if (typeof sm === 'number') {
        // the physics reports its strings: the voice follows them (a press lifting off a tacky body makes them too, not only a pull)
        if (sm >= STRAND_ON) {
          strandOn = true; strandLast = sm;
          try { d.audio.strand({ tension: clamp01(sm), pitch: pitch(), pan: d.panOfPoint(c) }); } catch (e) { d.report(e); }
        } else if (strandOn) {
          strandOn = false;
          if (strandLast >= STRAND_BREAK) { try { d.audio.strand({ tension: clamp01(strandLast), snap: true, pitch: pitch(), pan: d.panOfPoint(c) }); } catch (e) { d.report(e); } }
          strandLast = 0;   // weaker strings: stop calling, the engine fades the held voice itself
        }
      } else if (grabbed && tacky()) {
        const tension = pullLevel(m.stretch, hasPress(m));
        if (tension >= STRAND_ON || strandOn) {
          strandOn = true;
          try { d.audio.strand({ tension, pitch: pitch(), pan: d.panOfPoint(c) }); } catch (e) { d.report(e); }
        }
      } else if (strandOn) strandOn = false; // no snap event (a cancelled pull): just stop calling, the engine ends the held voice itself
    }
  }

  return {
    handle,
    update,
    sweep() { for (let f = 0; f < 2; f++) if (voices[f] && !touch.fingerDown[f] && !touch.grabActive[f]) endVoice(f, 0.08); },
    endAll(fade) { endVoice(0, fade); endVoice(1, fade); strandOn = false; strandLast = 0; },
    resetBody() { lifted = false; liftSince = -1; strandOn = false; strandLast = 0; haveC = false; vx = vy = vz = 0; },
    get liveVoices() { return (voices[0] ? 1 : 0) + (voices[1] ? 1 : 0); },
  };
}

/**
 * Stage B seam (bump): call once per frame with the shell's bodies when more than one is on the mat. Fires audio.bump on the rising edge
 * of two bodies touching (SOUND.md: distance(cA, cB) < 0.95 (rA + rB)), intensity from the closing speed / 2.5 m/s. Not wired yet: the
 * shell has one play body until PHYS stage B adds body-to-body contact.
 */
export function bumpCheck(audio: SquishAudio, a: SoftBodyLike, b: SoftBodyLike, wasTouching: boolean, closingSpeed: number, pan: number, pitch: number): boolean {
  const dx = a.center.x - b.center.x, dy = a.center.y - b.center.y, dz = a.center.z - b.center.z;
  const touching = Math.hypot(dx, dy, dz) < 0.95 * (a.restRadius + b.restRadius);
  if (touching && !wasTouching && audio.bump) audio.bump({ intensity: clamp(Math.abs(closingSpeed) / 2.5, 0, 1), pitch, pan });
  return touching;
}
