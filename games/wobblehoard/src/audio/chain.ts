// WOBBLEHOARD master chain, shared by the live engine and the offline probe so the probe measures what a player hears:
//   voices -> bus gain -> (20 Hz DC/rumble high-pass) -> DynamicsCompressor -> WaveShaper soft-clip safety -> master gain
//          -> AnalyserNode -> destination.
// `boost` is the input for poke/squish/release voices (the "louder squish" setting adds up to +9 dB there); `plain` is the
// input for land/pop/blend. Both feed the bus.
import { clamp } from '../core/rng.ts';
import { c01, dbToGain, softClipCurve } from './dsp.ts';

export interface ChainSettings { master: number; squishBoost: number; muted: boolean }

export const BOOST_MAX_DB = 9;

/** Perceptual master curve: a squared taper, so 0.5 on the slider is about -12 dB. */
export const masterGain = (m: number): number => { const v = c01(m, 0.8); return v * v; };
export const boostGain = (b: number): number => dbToGain(BOOST_MAX_DB * c01(b, 0));

export interface MasterChain {
  readonly boost: GainNode;
  readonly plain: GainNode;
  readonly analyser: AnalyserNode;
  readonly nodes: AudioNode[];
  /** `immediate`: set the values with no smoothing (offline renders, first setup). */
  apply(s: ChainSettings, immediate?: boolean): void;
  /** Peak (linear) of the output over roughly the last `seconds` seconds, from the analyser's ring buffer. */
  peakSince(seconds: number): number;
  disconnect(): void;
}

export function createMasterChain(ctx: BaseAudioContext): MasterChain {
  const nodes: AudioNode[] = [];
  const add = <T extends AudioNode>(n: T): T => { nodes.push(n); return n; };
  const boost = add(ctx.createGain());
  const plain = add(ctx.createGain());
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
  const master = add(ctx.createGain());
  const analyser = add(ctx.createAnalyser());
  analyser.fftSize = 32768;
  analyser.smoothingTimeConstant = 0;

  boost.connect(bus); plain.connect(bus);
  bus.connect(hp); hp.connect(comp); comp.connect(shaper); shaper.connect(master);
  master.connect(analyser); analyser.connect(ctx.destination);

  const buf = new Float32Array(analyser.fftSize);

  return {
    boost, plain, analyser, nodes,
    apply(s, immediate = false) {
      const now = ctx.currentTime;
      const m = s.muted ? 0 : masterGain(s.master);
      const b = boostGain(s.squishBoost);
      if (immediate) {
        master.gain.setValueAtTime(m, now);
        boost.gain.setValueAtTime(b, now);
      } else {
        master.gain.setTargetAtTime(m, now, 0.015);
        boost.gain.setTargetAtTime(b, now, 0.03);
      }
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
