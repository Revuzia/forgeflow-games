// GENESIS — loudness matching between the two music layers (fix r3 #14).
//
// The authored pieces are mastered to one loudness (about -16.2 LUFS for every stem mix); the procedural score's
// loudness depends on the culture it plays for (its population sets the voices, its density and drums are random,
// the instrument set and the intro bars differ), so a fixed trim put a piece anywhere from 6 LU under to 9 LU over
// the score it took over from. Instead the director meters the procedural sum while it holds the music (BS.1770-style:
// K-weighted, 400 ms blocks, gated), normalised by the players' faders so the figure is the score's own level, and
// each new appearance of a piece takes the trim that puts it a little over that level. The trim is fixed for the
// whole appearance (never adjusted while it plays: no pumping).

/** BS.1770 block length, seconds */
export const BLOCK_S = 0.4;
/** BS.1770 gates: absolute, and relative to the ungated mean of the blocks above the absolute gate */
export const ABS_GATE_LUFS = -70;
export const REL_GATE_LU = -10;

/** loudness of a block from its K-weighted mean square summed over the channels (BS.1770: -0.691 + 10 log10 Σ ms) */
export function lufsOf(ms: number): number {
  return ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity;
}

/**
 * Integrated loudness (BS.1770-4 gating) of a run of blocks given as K-weighted energies (Σ channel mean squares):
 * the blocks under -70 LUFS are dropped, then those more than 10 LU under the mean of the rest. A sparse score's
 * silent bars do not drag its level down, as with ffmpeg's ebur128 `I`. Null when no block passes.
 */
export function gatedLoudness(blocks: readonly number[]): number | null {
  const abs = 10 ** ((ABS_GATE_LUFS + 0.691) / 10);
  let s = 0, n = 0;
  for (const e of blocks) if (e > abs) { s += e; n++; }
  if (!n) return null;
  const rel = (s / n) * 10 ** (REL_GATE_LU / 10);
  let s2 = 0, n2 = 0;
  for (const e of blocks) if (e > abs && e > rel) { s2 += e; n2++; }
  return n2 ? lufsOf(s2 / n2) : null;
}

/**
 * The matching rule. `authored`: every piece's stem mix at unity, measured with ffmpeg ebur128 on the shipped files
 * (title -16.1, era main+day mixes -16.1..-16.3). `over`: a piece arrives this far over the score it takes over from
 * (it should read as the theme arriving, not as a jump: the review asked for <= 3 LU). `wet`: the procedural players'
 * reverb return (the hall), which the meter does not hear (it taps the dry sum) while the pieces carry theirs baked in:
 * calibrated in the lab (the real engine at 1x, music only, ffmpeg ebur128 on the render), the meter read a bronze
 * town's, a stone town's and the orbital score within 0.3 LU of the rendered level (the hall adds ~0.1 LU).
 * `min`/`max`: the trim's range (a piece never vanishes under a near-silent score; at most unity, its mastered level).
 * `secs`: seconds of measured blocks before the measurement is trusted (the first 12 s of the orbital score read
 * 1.2 LU hot). Lab result (2026-10-29): every appearance 0 to +1.6 LU over the score it took over from (was 6 under to
 * 9 over with fixed trims).
 */
export const MATCH = { authored: -16.2, over: 1, wet: 0.1, min: 0.2, max: 1, secs: 16 };

/** a piece's trim for an appearance: matched to the measured score, else the piece's fixed fallback */
export interface Trim { trim: number; measured: boolean; proc: number | null }

/** linear trim that puts a piece (at unity `MATCH.authored` LUFS) `MATCH.over` LU over a score measured at `procLufs` */
export function matchTrim(procLufs: number | null, fallback: number): Trim {
  if (procLufs == null || !Number.isFinite(procLufs)) return { trim: fallback, measured: false, proc: null };
  const db = procLufs + MATCH.wet + MATCH.over - MATCH.authored;
  return { trim: Math.max(MATCH.min, Math.min(MATCH.max, 10 ** (db / 20))), measured: true, proc: procLufs };
}

/**
 * The K-weighting pre-filter's two stages (BS.1770: a +4 dB shelf near 1.7 kHz with Q 0.707, which is Web Audio's
 * fixed shelf slope; a highpass at 38 Hz with Q 0.5). Web Audio reads a highpass's Q in dB: 0.5 linear is -6.02 dB
 * (a Q of "0.5" would be a resonant 1.06 and over-read a bass-heavy score by several dB).
 */
const SHELF_HZ = 1681, SHELF_DB = 4, HP_HZ = 38, HP_Q_DB = 20 * Math.log10(0.5);
/** blocks kept per score (about three minutes at a normal frame rate; older blocks fall away as a culture grows) */
const KEEP = 450;
/** scores remembered (the towns heard lately and the orbital score) */
const KEYS = 16;

interface Series { blocks: number[]; acc: number; n: number; end: number; last: number }

/**
 * The meter on the procedural sum: the players connect to `input` (which passes the sum on to the music bus
 * unchanged); a K-weighted tap feeds one analyser per channel. `sample()` is called by the director on the frames when
 * the procedural score holds the music alone, with the players' summed fader power (relative to their nominal
 * faders): each reading is that frame's last ~43 ms, normalised, added to the current 400 ms block of that score.
 */
export class ProcMeter {
  readonly input: GainNode;
  private readonly an: AnalyserNode[] = [];
  private readonly buf: Float32Array<ArrayBuffer>;
  private readonly series = new Map<string, Series>();

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.input = ctx.createGain();
    this.input.connect(dest);
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf'; shelf.frequency.value = SHELF_HZ; shelf.gain.value = SHELF_DB;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = HP_HZ; hp.Q.value = HP_Q_DB;
    const split = ctx.createChannelSplitter(2);
    this.input.connect(shelf); shelf.connect(hp); hp.connect(split);
    for (let c = 0; c < 2; c++) {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      split.connect(a, c);
      this.an.push(a);
    }
    this.buf = new Float32Array(2048);
  }

  /** add this frame's reading to score `key`'s current block; `unit2`: Σ (player fader / its nominal fader)² */
  sample(key: string, unit2: number, now: number): void {
    if (!(unit2 > 1e-4)) return;
    let ms = 0;
    for (const a of this.an) {
      a.getFloatTimeDomainData(this.buf);
      let s = 0;
      for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
      ms += s / this.buf.length;
    }
    let sr = this.series.get(key);
    if (!sr) {
      if (this.series.size >= KEYS) {
        let old = '', t = Infinity;
        for (const [k, v] of this.series) if (v.last < t) { t = v.last; old = k; }
        this.series.delete(old);
      }
      sr = { blocks: [], acc: 0, n: 0, end: now + BLOCK_S, last: now };
      this.series.set(key, sr);
    }
    // a reading after a gap (the piece played, the camera was away) starts a fresh block
    if (now >= sr.end || now - sr.last > BLOCK_S) close(sr, now);
    sr.acc += ms / unit2; sr.n++; sr.last = now;
  }

  /** the score's gated loudness at its nominal faders and how many seconds of blocks it rests on */
  loudness(key: string): { lufs: number | null; secs: number } {
    const sr = this.series.get(key);
    if (!sr) return { lufs: null, secs: 0 };
    const bl = sr.n ? [...sr.blocks, sr.acc / sr.n] : sr.blocks;
    return { lufs: gatedLoudness(bl), secs: bl.length * BLOCK_S };
  }

  state(): { key: string; lufs: number | null; secs: number }[] {
    return [...this.series.keys()].map((key) => {
      const l = this.loudness(key);
      return { key, lufs: l.lufs == null ? null : Math.round(l.lufs * 10) / 10, secs: Math.round(l.secs) };
    });
  }
}

function close(sr: Series, now: number): void {
  if (sr.n) { sr.blocks.push(sr.acc / sr.n); if (sr.blocks.length > KEEP) sr.blocks.splice(0, sr.blocks.length - KEEP); }
  sr.acc = 0; sr.n = 0; sr.end = now + BLOCK_S;
}
