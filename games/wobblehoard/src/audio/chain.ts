// WOBBLEHOARD master chain, shared by the live engine and the offline probe so the probe measures what a player hears:
//   voices -> bus gain -> (20 Hz DC/rumble high-pass) -> DynamicsCompressor -> WaveShaper soft-clip safety -> master gain
//          -> AnalyserNode -> destination.
// `boost` is the input for poke/squish/release voices (the "louder squish" setting adds up to +9 dB there); `plain` is the
// input for land/pop/blend and everything newer. Round 3: `music` is the music bed's input (its own volume, music.ts). All
// three feed the bus, so the music goes through the same limiter, master gain and mute as the effects.
import { clamp } from '../core/rng.ts';
import { c01, dbToGain, fin, softClipCurve } from './dsp.ts';

export interface ChainSettings { master: number; squishBoost: number; muted: boolean; music?: number }

export const BOOST_MAX_DB = 9;

/** Perceptual master curve: a squared taper, so 0.5 on the slider is about -12 dB. */
export const masterGain = (m: number): number => { const v = c01(m, 0.8); return v * v; };
export const boostGain = (b: number): number => dbToGain(BOOST_MAX_DB * c01(b, 0));
/** Music volume taper, relative to master. 0.45 (the default) = 0 dB = the designed level; below it a squared taper like the
 *  master (0.225 = -12 dB, 0 = silent); above it a gentle rise to +6 dB at 1 (the bed must stay under the effects). */
export const MUSIC_DEFAULT_VOLUME = 0.45;
export const musicGain = (v: number): number => {
  const x = c01(v, MUSIC_DEFAULT_VOLUME);
  if (x <= 0.001) return 0;
  const d = MUSIC_DEFAULT_VOLUME;
  return dbToGain(x <= d ? 40 * Math.log10(x / d) : (6 * (x - d)) / (1 - d));
};

export interface MasterChain {
  readonly boost: GainNode;
  readonly plain: GainNode;
  /** Round 3: the music bed's input (gain = musicGain(settings.music)). */
  readonly music: GainNode;
  readonly analyser: AnalyserNode;
  readonly nodes: AudioNode[];
  /** `immediate`: set the values with no smoothing (offline renders, first setup). */
  apply(s: ChainSettings, immediate?: boolean): void;
  /**
   * Smoothly duck the output by `db` (negative) for `ms`, then recover. Exponential ramps only (attack tc 18 ms, release
   * tc 70 ms), so there is no zipper noise. A new duck replaces a running one. `atTime` scripts it for offline renders.
   */
  duck(db: number, ms: number, atTime?: number): void;
  /** Peak (linear) of the output over roughly the last `seconds` seconds, from the analyser's ring buffer. */
  peakSince(seconds: number): number;
  disconnect(): void;
}

export function createMasterChain(ctx: BaseAudioContext): MasterChain {
  const nodes: AudioNode[] = [];
  const add = <T extends AudioNode>(n: T): T => { nodes.push(n); return n; };
  const boost = add(ctx.createGain());
  const plain = add(ctx.createGain());
  const music = add(ctx.createGain());
  const bus = add(ctx.createGain());
  const hp = add(ctx.createBiquadFilter());
  hp.type = 'highpass'; hp.frequency.value = 20; hp.Q.value = 0.707;
  const comp = add(ctx.createDynamicsCompressor());
  // A safety limiter, not a sound-shaper. Chromium's DynamicsCompressor starts each event after silence from a reduced
  // gain that recovers at the `release` rate, so a long release eats the front of every short transient (measured:
  // a 5 ms burst loses 7-11 dB at release 0.12-1 s, none at <= 12 ms). Hence the short release.
  comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.012;
  const shaper = add(ctx.createWaveShaper());
  shaper.curve = softClipCurve();
  shaper.oversample = '2x';
  const duckG = add(ctx.createGain());
  const master = add(ctx.createGain());
  const analyser = add(ctx.createAnalyser());
  analyser.fftSize = 32768;
  analyser.smoothingTimeConstant = 0;

  boost.connect(bus); plain.connect(bus); music.connect(bus);
  // Round 3: the bus (and so everything after it) is always stereo. With the default 'max' mode the chain switched between
  // mono and stereo processing whenever a panned voice started or freed itself, and each switch restarted a channel's
  // filter/limiter state (a tiny transient, measured as run-to-run differences of up to 6e-4 at those moments). A mono
  // voice is upmixed L = R, and a mono destination downmixes (L + R) / 2, so mono renders are unchanged.
  bus.channelCount = 2; bus.channelCountMode = 'explicit'; bus.channelInterpretation = 'speakers';
  bus.connect(hp); hp.connect(comp); comp.connect(shaper); shaper.connect(duckG); duckG.connect(master);
  master.connect(analyser); analyser.connect(ctx.destination);

  const buf = new Float32Array(analyser.fftSize);

  return {
    boost, plain, music, analyser, nodes,
    apply(s, immediate = false) {
      const now = ctx.currentTime;
      const m = s.muted ? 0 : masterGain(s.master);
      const b = boostGain(s.squishBoost);
      const mu = musicGain(s.music ?? MUSIC_DEFAULT_VOLUME);
      if (immediate) {
        master.gain.setValueAtTime(m, now);
        boost.gain.setValueAtTime(b, now);
        music.gain.setValueAtTime(mu, now);
      } else {
        master.gain.setTargetAtTime(m, now, 0.015);
        boost.gain.setTargetAtTime(b, now, 0.03);
        music.gain.setTargetAtTime(mu, now, 0.05);
      }
    },
    duck(db, ms, atTime) {
      const at = typeof atTime === 'number' && Number.isFinite(atTime) ? Math.max(0, atTime) : ctx.currentTime;
      const g = dbToGain(clamp(fin(db, -12), -36, 0));
      const hold = clamp(fin(ms, 250), 20, 4000) / 1000;
      const p = duckG.gain;
      p.cancelScheduledValues(at);
      p.setValueAtTime(p.value, at);
      p.setTargetAtTime(g, at, 0.018);
      p.setTargetAtTime(1, at + hold, 0.07);
    },
    peakSince(seconds) {
      analyser.getFloatTimeDomainData(buf);
      const n = clamp(Math.ceil(seconds * ctx.sampleRate) + 256, 256, buf.length);
      let pk = 0;
      for (let i = buf.length - n; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v !== v) return NaN;   // a NaN in the output must show up in the readout, not hide behind `>`
        if (v > pk) pk = v;
      }
      return pk;
    },
    disconnect() { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } },
  };
}
