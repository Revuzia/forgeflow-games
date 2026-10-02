// WOBBLEHOARD audio engine: `createAudio()` implements SquishAudio on top of the procedural voices in voices.ts.
//  - Nothing is created before unlock() (autoplay policy); every method before that is a safe no-op.
//  - Master chain lives in chain.ts (shared with the offline probe).
//  - Polyphony is capped (MAX_VOICES live groups; the oldest one-shot is stolen with a 20 ms fade), every node is
//    disconnected on 'ended', and a 0.5 s housekeeping timer reaps anything whose 'ended' never arrived.
import type { SquishAudio, AudioSettings, SquishVoiceHandle } from '../contracts.ts';
import { clamp } from '../core/rng.ts';
import { c01, fin, liveNodeCount, makeRng, type VoiceGroup } from './dsp.ts';
import { createMasterChain, type MasterChain } from './chain.ts';
import { blend, land, poke, pop, release, squish, type SquishVoice } from './voices.ts';

export const MAX_VOICES = 24;
/** Hard ceiling including voices that are fading out after being stolen. */
const MAX_ALIVE = MAX_VOICES + 16;
const LOOKAHEAD = 0.004;
const GOLDEN = 0.6180339887498949;
const KINDS = ['poke', 'squish', 'release', 'land', 'pop', 'blend'] as const;
type Kind = (typeof KINDS)[number];

export interface CreateAudioOptions {
  /** Seed of the engine's variation stream (default fixed: two runs of the same session sound the same). */
  seed?: number;
}

interface Held extends VoiceGroup { lastUpdateT?: number; update?: unknown }

const NOOP_HANDLE: SquishVoiceHandle = Object.freeze({ update() { /* not unlocked */ }, end() { /* not unlocked */ } });

export function createAudio(opts: CreateAudioOptions = {}): SquishAudio {
  let ctx: AudioContext | null = null;
  let chain: MasterChain | null = null;
  let disposed = false;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unlockP: Promise<void> | null = null;
  let lastResumeTry = -1e9;
  let lastStatsT = 0;
  let dropped = 0;
  const settings: AudioSettings = { master: 0.8, squishBoost: 0, muted: false };
  const started: Record<string, number> = {};
  for (const k of KINDS) started[k] = 0;
  const groups: VoiceGroup[] = [];
  const order = new Map<VoiceGroup, number>();
  let serial = 0;
  const engRng = makeRng((opts.seed ?? 0x57a15b00) >>> 0);
  // per-kind golden-ratio round-robin: consecutive calls of one kind are always >= ~2.3% apart in pitch
  const phase: Record<Kind, number> = {} as Record<Kind, number>;
  for (const k of KINDS) phase[k] = engRng();

  const now = (): number => (ctx ? ctx.currentTime : 0);

  function prune(): void {
    for (let i = groups.length - 1; i >= 0; i--) {
      if (!groups[i].alive) { order.delete(groups[i]); groups.splice(i, 1); }
    }
  }

  function freeAll(): void {
    for (const g of groups.slice()) g.free();
    prune();
  }

  function killAll(fade = 0.03): void {
    for (const g of groups) g.kill(fade);
  }

  /** Reap stragglers: groups past their end time whose 'ended' never fired, and held voices nobody updates any more. */
  function sweep(): void {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const g of groups.slice()) {
      if (!g.alive) continue;
      const h = g as Held;
      if (g.held) {
        if (t - (h.lastUpdateT ?? t) > 6) g.kill(0.15);
      } else if (t > g.endTime + 1.5) {
        g.free();
      }
    }
    prune();
  }

  function stealIfNeeded(): void {
    prune();
    const active = groups.filter((g) => !g.dying);
    if (active.length >= MAX_VOICES) {
      let victim: VoiceGroup | null = null;
      for (const g of active) {
        if (g.held) continue;
        if (!victim || (order.get(g) ?? 0) < (order.get(victim) ?? 0)) victim = g;
      }
      if (!victim) victim = active.reduce((a, b) => ((order.get(a) ?? 0) <= (order.get(b) ?? 0) ? a : b));
      victim.kill(0.02);
    }
    if (groups.length >= MAX_ALIVE) {
      // too many voices still fading out: cut the oldest dying one dead rather than let nodes pile up
      const dying = groups.filter((g) => g.dying).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      for (const g of dying.slice(0, groups.length - MAX_ALIVE + 1)) g.free();
      prune();
    }
  }

  function tryResume(): void {
    if (!ctx || paused || disposed) return;
    if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
      const t = typeof performance !== 'undefined' ? performance.now() : 0;
      if (t - lastResumeTry > 250) { lastResumeTry = t; ctx.resume().catch(() => { /* needs a gesture; unlock() will retry */ }); }
    }
  }

  function ready(): boolean { return !!ctx && !disposed && !paused && ctx.state === 'running'; }

  /** Accept a trigger: bookkeeping, mute/pause handling, polyphony. Returns the context and a seeded call config, or null. */
  function accept(kind: Kind): { c: AudioContext; seed: number; jitter: number } | null {
    if (!ctx || disposed) { dropped++; return null; }
    if (!ready()) { dropped++; tryResume(); return null; }
    started[kind]++;
    if (settings.muted) return null;
    phase[kind] = (phase[kind] + GOLDEN) % 1;
    const seed = (engRng() * 4294967296) >>> 0;
    sweep();
    stealIfNeeded();
    return { c: ctx, seed, jitter: 1 + 0.03 * (2 * phase[kind] - 1) };
  }

  function register(g: VoiceGroup): void {
    groups.push(g);
    order.set(g, ++serial);
  }

  function build(): void {
    const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    try { ctx = new Ctor({ latencyHint: 'interactive' }); } catch { ctx = new Ctor(); }
    chain = createMasterChain(ctx);
    chain.apply(settings, true);
    lastStatsT = ctx.currentTime;
    if (!timer) timer = setInterval(sweep, 500);
  }

  async function doUnlock(): Promise<void> {
    if (disposed) return;
    try {
      if (!ctx) build();
      const c = ctx;
      if (!c) return;
      if (c.state !== 'running' && !paused) {
        // resume() can stay pending for ever without a user gesture, so never await it unbounded
        await Promise.race([c.resume(), new Promise<void>((res) => setTimeout(res, 1200))]);
      }
      // iOS Safari: a one-sample silent buffer started inside the gesture fully unlocks output
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.onended = () => { try { s.disconnect(); } catch { /* gone */ } };
        s.start(0);
      } catch { /* not needed everywhere */ }
    } catch { /* an unlock failure must never break the game: ready stays false */ }
  }

  const self: SquishAudio = {
    get ready() { return ready(); },

    unlock(): Promise<void> {
      if (!unlockP) unlockP = doUnlock().finally(() => { unlockP = null; });
      return unlockP;
    },

    setSettings(s) {
      if (!s || typeof s !== 'object') return;
      if (s.master !== undefined) settings.master = c01(s.master, settings.master);
      if (s.squishBoost !== undefined) settings.squishBoost = c01(s.squishBoost, settings.squishBoost);
      if (s.muted !== undefined) settings.muted = !!s.muted;
      if (chain) chain.apply(settings);
      if (settings.muted) killAll(0.03);
    },

    poke(p) {
      const a = accept('poke');
      if (!a) return;
      try {
        register(poke(a.c, chain!.boost, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, intensity: c01(p?.intensity, 0.5),
          pitch: clamp(fin(p?.pitch, 1), 0.5, 2), pan: clamp(fin(p?.pan, 0), -1, 1),
        }));
      } catch { dropped++; }
    },

    squishStart(p) {
      const a = accept('squish');
      if (!a) return NOOP_HANDLE;
      let v: SquishVoice;
      try {
        v = squish(a.c, chain!.boost, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, pitch: clamp(fin(p?.pitch, 1), 0.5, 2), pan: clamp(fin(p?.pan, 0), -1, 1),
        });
      } catch { dropped++; return NOOP_HANDLE; }
      register(v);
      return {
        // `atTime` exists for offline scripting; live callers get "now" (a far-future time would strand the voice)
        update(q, atTime) {
          if (disposed || !q) return;
          try {
            const now = a.c.currentTime;
            const at = typeof atTime === 'number' && Number.isFinite(atTime) ? clamp(atTime, now, now + 0.25) : undefined;
            v.update(q, at);
          } catch { /* never throw into the render loop */ }
        },
        end(fadeS) {
          try { v.end(fadeS); } catch { /* ignore */ }
        },
      };
    },

    release(p) {
      const a = accept('release');
      if (!a) return;
      try {
        register(release(a.c, chain!.boost, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, compression: c01(p?.compression, 0.5),
          pitch: clamp(fin(p?.pitch, 1), 0.5, 2), pan: clamp(fin(p?.pan, 0), -1, 1),
        }));
      } catch { dropped++; }
    },

    land(p) {
      const a = accept('land');
      if (!a) return;
      try {
        register(land(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, intensity: c01(p?.intensity, 0.5), pitch: clamp(fin(p?.pitch, 1), 0.5, 2),
        }));
      } catch { dropped++; }
    },

    pop(p) {
      const a = accept('pop');
      if (!a) return;
      try {
        register(pop(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, size: c01(p?.size, 0.5),
          pitch: clamp(fin(p?.pitch, 1), 0.5, 2), pan: clamp(fin(p?.pan, 0), -1, 1),
        }));
      } catch { dropped++; }
    },

    blend(p) {
      const a = accept('blend');
      if (!a) return { stop() { /* nothing playing */ } };
      try {
        const v = blend(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, count: fin(p?.count, 3), durationS: fin(p?.durationS, 2.2),
        });
        register(v);
        return { stop() { try { v.stop(); } catch { /* ignore */ } } };
      } catch { dropped++; return { stop() { /* failed to start */ } }; }
    },

    stats() {
      prune();
      const t = now();
      let peak = 0;
      if (chain && ctx && ctx.state === 'running') {
        try { peak = chain.peakSince(Math.max(0, t - lastStatsT)); } catch { peak = 0; }
      }
      lastStatsT = t;
      return {
        started: { ...started },
        state: ctx ? ctx.state : 'locked',
        sampleRate: ctx ? ctx.sampleRate : 0,
        peak,
        live: groups.length,
        liveNodes: liveNodeCount(),
        dropped,
      };
    },

    setPaused(p) {
      paused = !!p;
      if (!ctx || disposed) return;
      if (paused) {
        freeAll();                      // 'ended' events do not arrive while suspended: disconnect now
        ctx.suspend().catch(() => { /* already suspended or closed */ });
      } else {
        ctx.resume().catch(() => { /* needs a gesture: unlock() will retry */ });
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) { clearInterval(timer); timer = null; }
      freeAll();
      if (chain) chain.disconnect();
      if (ctx) { ctx.close().catch(() => { /* already closed */ }); }
    },
  };
  return self;
}
