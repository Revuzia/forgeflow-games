// GENESIS — the buffer bank: every synthesized texture (dsp.ts) as an AudioBuffer, rendered lazily and cached per
// context. A layer that needs a buffer asks `get(name)`; if it is not ready the name is queued and rendered in the
// frame loop under a time budget (`pump`), so starting a rainstorm never stalls a frame for long. Short one-shot
// sources (bells, plucks, thunder) can be had synchronously with `need(name)` — they render in a few milliseconds.
//
// Sample rates are chosen per texture: full band for hiss and crickets, 16–22 kHz for rumbles, murmur and lava (the
// engine resamples on playback), which keeps the bank to a few megabytes.

import {
  ANVIL, BELL_CHURCH, CHIME, GLASS, WOOD, renderBabble, renderBell, renderCicadas, renderCrackle, renderCrickets,
  renderFrogs, renderHeartbeat, renderImpulse, renderLava, renderMurmur, renderNoise, renderPatter, renderPluck,
  renderThunder, renderWork, type Channels,
} from './dsp.ts';

export interface Spec { sr: number; render: (sr: number) => Channels }

/** the reference pitch (Hz) each bell buffer was rendered at; players resample by f / base */
export const BELL_BASE: Record<string, number> = { toll: 196, chime: 1046.5, glass: 880, anvil: 1150, wood: 420 };

/** plucked instruments: rendered at roots every 6 semitones, played within ±3 by playbackRate */
export const PLUCKS: Record<string, { bright: number; decay: number; body: number; seconds: number }> = {
  lyre: { bright: 0.55, decay: 3.2, body: 290, seconds: 3.4 },
  harp: { bright: 0.35, decay: 4.5, body: 180, seconds: 4.2 },
  pizz: { bright: 0.3, decay: 0.55, body: 220, seconds: 0.9 },
};

export function pluckRoot(midi: number): number {
  return Math.max(24, Math.min(102, Math.round(midi / 6) * 6));
}

/** how a named texture is rendered (also run inside the DSP worker, dspworker.ts) */
export function specFor(name: string, ctxRate: number): Spec | null {
  const full = Math.min(48000, ctxRate);
  const seedOf = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const seed = seedOf(name);
  const mono = (f: (sr: number) => Float32Array) => (sr: number): Channels => [f(sr)];
  switch (name) {
    case 'white': return { sr: full, render: mono((sr) => renderNoise('white', sr, 2.5, seed)) };
    case 'pink': return { sr: 32000, render: mono((sr) => renderNoise('pink', sr, 3, seed)) };
    case 'brown': return { sr: 16000, render: mono((sr) => renderNoise('brown', sr, 4, seed)) };
    case 'crickets': return { sr: 32000, render: (sr) => renderCrickets(sr, 6, seed) };
    case 'cicadas': return { sr: 32000, render: (sr) => renderCicadas(sr, 8, seed) };
    case 'frogs': return { sr: 22050, render: (sr) => renderFrogs(sr, 7, seed) };
    case 'crackle': return { sr: 32000, render: (sr) => renderCrackle(sr, 4, seed) };
    case 'patter': return { sr: 32000, render: (sr) => renderPatter(sr, 3, seed) };
    case 'hail': return { sr: 32000, render: (sr) => renderPatter(sr, 3, seed, true) };
    case 'babble': return { sr: 22050, render: (sr) => renderBabble(sr, 4, seed) };
    case 'lava': return { sr: 16000, render: (sr) => renderLava(sr, 6, seed) };
    case 'murmur': return { sr: 16000, render: (sr) => renderMurmur(sr, 7, seed) };
    case 'murmur2': return { sr: 16000, render: (sr) => renderMurmur(sr, 6.4, seed, 14) };
    case 'work-stone': return { sr: 22050, render: (sr) => renderWork('stone', sr, 6, seed) };
    case 'work-metal': return { sr: 22050, render: (sr) => renderWork('metal', sr, 6, seed) };
    case 'work-machine': return { sr: 22050, render: (sr) => renderWork('machine', sr, 6, seed) };
    case 'heartbeat': return { sr: 22050, render: mono((sr) => renderHeartbeat(sr)) };
    case 'thunder0': case 'thunder1': case 'thunder2': return { sr: 22050, render: mono((sr) => renderThunder(sr, 7, seed)) };
    case 'toll': return { sr: 32000, render: mono((sr) => renderBell(BELL_BASE.toll, sr, 7, BELL_CHURCH, seed, 0.35)) };
    case 'chime': return { sr: full, render: mono((sr) => renderBell(BELL_BASE.chime, sr, 2.6, CHIME, seed, 0.2)) };
    case 'glass': return { sr: full, render: mono((sr) => renderBell(BELL_BASE.glass, sr, 3.4, GLASS, seed, 0.05)) };
    case 'anvil': return { sr: full, render: mono((sr) => renderBell(BELL_BASE.anvil, sr, 1, ANVIL, seed, 0.9)) };
    case 'wood': return { sr: 32000, render: mono((sr) => renderBell(BELL_BASE.wood, sr, 0.35, WOOD, seed, 1.2)) };
    case 'ir-hall': return { sr: Math.min(ctxRate, 44100), render: (sr) => renderImpulse(sr, seed, { decay: 2.8, predelay: 0.025, bright: 0.45, early: 9 }) };
  }
  if (name.startsWith('pluck:')) {
    const [, inst, m] = name.split(':');
    const p = PLUCKS[inst];
    const midi = Number(m);
    if (!p || !Number.isFinite(midi)) return null;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    return { sr: 32000, render: mono((sr) => renderPluck(f, sr, p.seconds, seed, { bright: p.bright, decay: p.decay, body: p.body })) };
  }
  return null;
}

/** what a fresh engine renders first, in order: what most scenes need */
export const PRELOAD = [
  'pink', 'brown', 'white', 'ir-hall', 'chime', 'toll', 'glass', 'wood', 'crackle', 'patter', 'crickets', 'murmur', 'babble',
  'heartbeat', 'thunder0', 'thunder1', 'thunder2', 'hail', 'anvil', 'cicadas', 'murmur2', 'lava', 'frogs',
];

/** a rendered texture coming back from the DSP worker */
export interface DspReply { name: string; sr: number; chs: Float32Array[] | null }

export class BufferBank {
  readonly ctx: BaseAudioContext;
  private cache = new Map<string, AudioBuffer>();
  private queue: string[] = [];
  private queued = new Set<string>();
  private failed = new Set<string>();
  private worker: Worker | null = null;
  private inWorker = new Set<string>();
  /** milliseconds spent rendering on the main thread so far (state / perf) */
  renderMs = 0;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
  }

  /**
   * Render lazily-requested textures in a Web Worker instead of the frame loop (the DSP is pure JS; the arrays come
   * back as transferables). Whatever was queued so far moves to the worker. Without one, `pump` renders them here.
   */
  useWorker(w: Worker): void {
    this.worker = w;
    w.onmessage = (e: MessageEvent<DspReply>) => {
      const { name, sr, chs } = e.data;
      this.inWorker.delete(name);
      if (!chs) { this.failed.add(name); return; }
      if (!this.cache.has(name)) this.adopt(name, chs, sr);
    };
    w.onerror = () => {
      // the worker died: everything it held goes back to the main-thread queue
      this.worker = null;
      for (const n of this.inWorker) if (!this.cache.has(n)) { this.queued.add(n); this.queue.push(n); }
      this.inWorker.clear();
    };
    for (const n of this.queue.splice(0)) { this.queued.delete(n); this.request(n); }
  }

  private request(name: string): void {
    if (this.worker) {
      if (this.inWorker.has(name)) return;
      this.inWorker.add(name);
      this.worker.postMessage({ name, rate: this.ctx.sampleRate });
    } else if (!this.queued.has(name)) { this.queued.add(name); this.queue.push(name); }
  }

  /** the buffer if ready; otherwise ask for it and return null */
  get(name: string): AudioBuffer | null {
    const b = this.cache.get(name);
    if (b) return b;
    if (!this.failed.has(name)) this.request(name);
    return null;
  }

  private adopt(name: string, chs: Float32Array[], sr: number): AudioBuffer {
    const buf = this.ctx.createBuffer(chs.length, chs[0].length, sr);
    for (let c = 0; c < chs.length; c++) buf.getChannelData(c).set(chs[c]);
    this.cache.set(name, buf);
    return buf;
  }

  /** the buffer now, rendering it synchronously if needed (null only for an unknown name) */
  need(name: string): AudioBuffer | null {
    return this.cache.get(name) ?? this.render(name);
  }

  has(name: string): boolean { return this.cache.has(name); }

  preload(names: string[]): void { for (const n of names) this.get(n); }

  /** render queued buffers until `budgetMs` is spent (at least one per call when any is queued) */
  pump(budgetMs: number, clock: () => number): void {
    const t0 = clock();
    while (this.queue.length) {
      const name = this.queue.shift()!;
      this.queued.delete(name);
      if (!this.cache.has(name)) this.render(name);
      if (clock() - t0 > budgetMs) break;
    }
  }

  pending(): number { return this.queue.length + this.inWorker.size; }

  /** rendering off the main thread right now */
  get threaded(): boolean { return !!this.worker; }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
  ready(): number { return this.cache.size; }

  private render(name: string): AudioBuffer | null {
    const spec = specFor(name, this.ctx.sampleRate);
    if (!spec) { this.failed.add(name); return null; }
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const buf = this.adopt(name, spec.render(spec.sr), spec.sr);
    if (typeof performance !== 'undefined') this.renderMs += performance.now() - t0;
    return buf;
  }
}
