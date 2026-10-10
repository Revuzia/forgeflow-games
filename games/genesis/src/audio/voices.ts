// GENESIS — the voice budget. Every one-shot (an SFX, a bird call, a thunder roll) asks for a voice: an output gain
// with an end time and a priority. When the budget is full the quietest-priority, oldest voice is faded out in 30 ms
// and stopped to make room — or, if everything playing matters more, the new sound is dropped. Ended voices are
// disconnected so the graph never grows.

export interface Voice {
  /** sources connect here; it feeds the destination given at allocation */
  out: GainNode;
  pri: number;
  start: number;
  end: number;
  sources: AudioScheduledSourceNode[];
  /** extra nodes to disconnect when the voice ends (spatial outs, sends) */
  extra: { disconnect(): void }[];
  done: boolean;
}

export class VoicePool {
  private readonly ctx: BaseAudioContext;
  max: number;
  private live: Voice[] = [];
  /** voices refused or stolen (state) */
  dropped = 0;
  stolen = 0;

  constructor(ctx: BaseAudioContext, max: number) {
    this.ctx = ctx;
    this.max = max;
  }

  /** a fresh voice feeding `dest`, or null when the budget is full of more important sounds */
  alloc(pri: number, dest: AudioNode, t: number): Voice | null {
    const now = this.ctx.currentTime;
    this.prune(now);
    if (this.live.length >= this.max) {
      let worst = -1;
      for (let i = 0; i < this.live.length; i++) {
        const v = this.live[i];
        if (worst < 0 || v.pri < this.live[worst].pri || (v.pri === this.live[worst].pri && v.start < this.live[worst].start)) worst = i;
      }
      if (worst < 0 || this.live[worst].pri > pri) { this.dropped++; return null; }
      this.kill(this.live[worst], now);
      this.live.splice(worst, 1);
      this.stolen++;
    }
    const out = this.ctx.createGain();
    out.connect(dest);
    const v: Voice = { out, pri, start: t, end: t + 0.1, sources: [], extra: [], done: false };
    this.live.push(v);
    return v;
  }

  /** register a source with a voice (so stealing can stop it) and extend the voice's end */
  add(v: Voice, s: AudioScheduledSourceNode, end: number): void {
    v.sources.push(s);
    if (end > v.end) v.end = end;
  }

  /** drop finished voices */
  prune(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i];
      if (now > v.end + 0.25) { this.release(v); this.live.splice(i, 1); }
    }
  }

  get active(): number { return this.live.length; }

  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.live) this.kill(v, now);
    this.live.length = 0;
  }

  private kill(v: Voice, now: number): void {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + 0.03);
    for (const s of v.sources) { try { s.stop(now + 0.04); } catch { /* not started / already stopped */ } }
    const vv = v;
    setTimeout(() => this.release(vv), 120);
  }

  private release(v: Voice): void {
    if (v.done) return;
    v.done = true;
    try { v.out.disconnect(); } catch { /* gone */ }
    for (const e of v.extra) { try { e.disconnect(); } catch { /* gone */ } }
  }
}
