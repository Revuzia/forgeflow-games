// WOBBLEHOARD audio engine: `createAudio()` implements SquishAudio on top of the procedural voices in voices.ts.
//  - Nothing is created before unlock() (autoplay policy); every method before that is a safe no-op.
//  - Master chain lives in chain.ts (shared with the offline probe).
//  - Polyphony is capped (MAX_VOICES live groups; the oldest one-shot is stolen with a 20 ms fade), every node is
//    disconnected on 'ended', and a 0.5 s housekeeping timer reaps anything whose 'ended' never arrived.
//  - Round 3: a generative music bed (music.ts) runs in "sessions" with their own small polyphony (MAX_LIVE_NOTES), pumped
//    LOOKAHEAD_S ahead by a TICK_MS timer that only runs while music plays; it ducks itself under ceremonies and a loud held
//    squish. New interaction voices bump / lift / toss / strand (interact.ts); bump is rate-limited, strand is held.
import type { SquishAudio, AudioSettings, SquishVoiceHandle, TierName } from '../contracts.ts';
import { clamp } from '../core/rng.ts';
import { c01, fin, liveNodeCount, makeRng, noiseBuffer, type VoiceGroup } from './dsp.ts';
import { createMasterChain, type MasterChain } from './chain.ts';
import { blend, land, poke, pop, release, squish, type SquishVoice } from './voices.ts';
import { TIERS, capsuleBurst, crack, grab, meterFull, mergeStart, mythicDuck, reveal, tierIdx, type MergeVoice } from './ceremony.ts';
import {
  Composer, FADE_OUT_S, LOOKAHEAD_S as MUSIC_LOOKAHEAD_S, MUSIC_DEFAULT, MusicBed, PAUSE_FADE_S, SQUISH_DUCK_HOLD_S,
  SQUISH_DUCK_RATE, TICK_MS,
} from './music.ts';
import { BumpLimiter, bump, lift, strand, strandSnap, toss, type StrandVoice } from './interact.ts';

export const MAX_VOICES = 24;
/** Hard ceiling including voices that are fading out after being stolen. */
const MAX_ALIVE = MAX_VOICES + 16;
const LOOKAHEAD = 0.004;
const GOLDEN = 0.6180339887498949;
const KINDS = ['poke', 'squish', 'release', 'land', 'pop', 'blend', 'meterFull', 'capsule', 'reveal', 'merge', 'mergeBurst', 'duck',
  'bump', 'lift', 'toss', 'strand', 'strandSnap', 'music'] as const;
type Kind = (typeof KINDS)[number];

export interface CreateAudioOptions {
  /** Seed of the engine's variation stream (default fixed: two runs of the same session sound the same). */
  seed?: number;
}

interface Held extends VoiceGroup { lastUpdateT?: number; update?: unknown }
/** A strand nobody has updated for this long is ended by the sweep (its own graph-level dead-man normally gets there first). */
const STRAND_ORPHAN_S = 0.4;
/** Music sessions start at most this often (a setMusic toggle storm cannot allocate a session per call). */
const MUSIC_RESTART_MS = 300;
/** Sessions still fading out; beyond this the oldest is cut (only a hostile toggle storm gets here). */
const MAX_RETIRING = 6;

const NOOP_HANDLE: SquishVoiceHandle = Object.freeze({ update() { /* not unlocked */ }, end() { /* not unlocked */ } });
const NOOP_MERGE = Object.freeze({ burst() { /* nothing charging */ }, stop() { /* nothing charging */ } });
const asTier = (t: unknown): TierName => TIERS[tierIdx(t)];
const prio = (g: VoiceGroup): number => (g.priority ?? 0) + (g.held ? 1 : 0);

export function createAudio(opts: CreateAudioOptions = {}): SquishAudio {
  let ctx: AudioContext | null = null;
  let chain: MasterChain | null = null;
  let disposed = false;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unlockP: Promise<void> | null = null;
  let lastResumeTry = -1e9;
  let lastGrab = -1e9;
  // merge charges that still have squelch/tick events to schedule (pumped ~0.5 s ahead every 80 ms)
  const pumped: MergeVoice[] = [];
  let pumpTimer: ReturnType<typeof setInterval> | null = null;
  let lastStatsT = 0;
  let dropped = 0;
  const settings: AudioSettings & { music: number } = { master: 0.8, squishBoost: 0, muted: false, music: MUSIC_DEFAULT };
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

  /* ───── round 3 state: music sessions, rate limiters, the held strand ───── */
  // the composer has its own seeded stream (derived from the engine seed) so turning music on never shifts the effects' variation
  const composer = new Composer(((opts.seed ?? 0x57a15b00) ^ 0x2f6b3c1d) >>> 0);
  let musicWanted = false;
  let musicInst: MusicBed | null = null;
  const retiring: MusicBed[] = [];
  let musicTimer: ReturnType<typeof setInterval> | null = null;
  let lastMusicStart = -1e9;
  let pendingStart = false;
  let pauseToken = 0;
  const mstat = { ticks: 0, tickMsTotal: 0, tickMsMax: 0, notes: 0, dropped: 0, maxLive: 0 };
  /** The last 128 tick costs (ms): detailStats() reports their p99 and max (the cumulative max also counts JIT warm-up). */
  const tickRing = new Float64Array(128);
  const bumpLimiter = new BumpLimiter();
  const throttled: Record<string, number> = { bump: 0, strand: 0 };
  let strandV: StrandVoice | null = null;
  let lastStrandUpd = -1e9;
  const perfS = (): number => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

  function musicWantPlay(): boolean {
    return musicWanted && !disposed && !paused && !settings.muted && settings.music > 0.001;
  }

  function foldStats(m: MusicBed): void {
    mstat.notes += m.stats.notes + m.stats.bubbles;
    mstat.dropped += m.stats.dropped + m.stats.late;
    mstat.maxLive = Math.max(mstat.maxLive, m.stats.maxLive);
  }

  function retireMusic(m: MusicBed, fadeS: number): void {
    try { m.stop((ctx ? ctx.currentTime : 0) + 0.005, fadeS); } catch { /* closed */ }
    retiring.push(m);
    while (retiring.length > MAX_RETIRING) { const o = retiring.shift() as MusicBed; foldStats(o); o.free(); }
  }

  function freeMusic(): void {
    if (musicInst) { foldStats(musicInst); musicInst.free(); musicInst = null; }
    for (const m of retiring) { foldStats(m); m.free(); }
    retiring.length = 0;
    pendingStart = false;
  }

  function ensureMusicTimer(): void {
    if (!musicTimer && !disposed) musicTimer = setInterval(musicTick, TICK_MS);
  }

  /** Start or retire the music session so it matches the wanted state. Safe to call any time. */
  function syncMusic(): void {
    if (!ctx || !chain || disposed) return;
    const want = musicWantPlay();
    if (!want) {
      pendingStart = false;
      if (musicInst) { retireMusic(musicInst, paused ? PAUSE_FADE_S : FADE_OUT_S); musicInst = null; }
    } else if (!musicInst && ctx.state === 'running') {
      const t = perfS() * 1000;
      if (t - lastMusicStart < MUSIC_RESTART_MS) pendingStart = true;
      else {
        lastMusicStart = t;
        pendingStart = false;
        try {
          const t0 = ctx.currentTime + 0.03;
          musicInst = new MusicBed(ctx, chain.music, composer, t0);
          musicInst.advance(t0 + MUSIC_LOOKAHEAD_S);
          started.music++;
        } catch { musicInst = null; dropped++; }
      }
    }
    if (musicInst || retiring.length || pendingStart) ensureMusicTimer();
  }

  function musicTick(): void {
    const a = perfS();
    if (ctx && !disposed) {
      const t = ctx.currentTime;
      try {
        if (musicInst) { musicInst.advance(t + MUSIC_LOOKAHEAD_S); musicInst.pollDuck(t); }
      } catch { /* never throw from a timer */ }
      for (let i = retiring.length - 1; i >= 0; i--) {
        if (t > retiring[i].endTime + 0.05) { foldStats(retiring[i]); retiring[i].free(); retiring.splice(i, 1); }
      }
      if (pendingStart) syncMusic();
    }
    if ((!musicInst && !retiring.length && !pendingStart) || disposed) { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
    const ms = (perfS() - a) * 1000;
    tickRing[mstat.ticks % tickRing.length] = ms;
    mstat.ticks++; mstat.tickMsTotal += ms; mstat.tickMsMax = Math.max(mstat.tickMsMax, ms);
  }

  /** Duck the music (DUCK_DB, smooth) from now until `until` (context time); later calls extend it. No-op without music. */
  function musicDuck(until: number): void {
    if (!musicInst || !ctx) return;
    try { musicInst.duckSpan(ctx.currentTime, until); } catch { /* ignore */ }
  }

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
        if (g.kind === 'strand' && t - (h.lastUpdateT ?? t) > STRAND_ORPHAN_S) g.kill(0.05);
        else if (t - (h.lastUpdateT ?? t) > 6) g.kill(0.15);
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
      // lowest priority first (one-shots < held squish < ceremony voices), oldest first within a priority
      const victim = active.reduce((a, b) => {
        const pa = prio(a), pb = prio(b);
        if (pa !== pb) return pa < pb ? a : b;
        return (order.get(a) ?? 0) <= (order.get(b) ?? 0) ? a : b;
      });
      victim.kill(0.02);
    }
    if (groups.length >= MAX_ALIVE) {
      // too many voices still fading out: cut the oldest dying one dead rather than let nodes pile up
      const dying = groups.filter((g) => g.dying).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      for (const g of dying.slice(0, groups.length - MAX_ALIVE + 1)) g.free();
      prune();
    }
  }

  function pump(): void {
    if (!ctx) return;
    const until = ctx.currentTime + 0.5;
    for (let i = pumped.length - 1; i >= 0; i--) {
      let done = true;
      try { done = pumped[i].advance(until); } catch { /* ended */ }
      if (done || !pumped[i].alive) pumped.splice(i, 1);
    }
    if (!pumped.length && pumpTimer) { clearInterval(pumpTimer); pumpTimer = null; }
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
    // the shared 2.5 s seeded noise buffer is built here, inside the unlock gesture, instead of lazily by the first voice
    // that needs it (measured: that made the first music note's tick, and the first poke, ~20-30 ms slower)
    try { noiseBuffer(ctx); } catch { /* the first voice will build it */ }
    // the music (re)starts whenever the context reaches 'running' and music is wanted (unlock, resume after a pause or an interruption)
    try { ctx.addEventListener('statechange', () => { if (ctx && ctx.state === 'running') syncMusic(); }); } catch { /* old browsers: unlock()/setPaused() still sync */ }
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
      syncMusic();
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
      if (s.music !== undefined) settings.music = c01(s.music, settings.music);
      if (chain) chain.apply(settings);
      if (settings.muted) killAll(0.03);
      syncMusic();
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
            // a loud held squish ducks the music (each loud update extends the hold; the tick releases it smoothly)
            if (musicInst && Math.abs(fin(q.rate, 0)) >= SQUISH_DUCK_RATE && v.alive && !v.dying) musicDuck(now + SQUISH_DUCK_HOLD_S);
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

    meterFull(p) {
      const a = accept('meterFull');
      if (!a) return;
      try {
        register(meterFull(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, quiet: p?.quiet === true, pitch: clamp(fin(p?.pitch, 1), 0.5, 2),
        }));
      } catch { dropped++; }
    },

    capsuleBeat(p) {
      const beat = p?.beat;
      if (beat !== 'grab' && beat !== 'crack' && beat !== 'burst') { dropped++; return; }
      if (beat === 'grab') {
        // a caller driving this from a per-frame loop must not stack a squeak per frame
        const t = typeof performance !== 'undefined' ? performance.now() : 0;
        if (t - lastGrab < 70) return;
        lastGrab = t;
      }
      const a = accept('capsule');
      if (!a) return;
      const base = { rng: makeRng(a.seed), jitter: a.jitter, pitch: clamp(fin(p.pitch, 1), 0.5, 2) };
      const t0 = a.c.currentTime + LOOKAHEAD;
      try {
        // grab and crack take NO tier: the shell must not spoil the result before the burst
        let g: VoiceGroup;
        if (beat === 'grab') g = grab(a.c, chain!.plain, t0, { ...base, progress: c01(p.progress, 0) });
        else if (beat === 'crack') g = crack(a.c, chain!.plain, t0, base);
        else g = capsuleBurst(a.c, chain!.plain, t0, { ...base, tier: asTier(p.tier) });
        register(g);
        musicDuck(g.endTime);
      } catch { dropped++; }
    },

    reveal(p) {
      const a = accept('reveal');
      if (!a) return;
      const tier = asTier(p?.tier);
      const calm = p?.calm === true;
      try {
        if (tier === 'mythic') { const d = mythicDuck(calm); chain!.duck(d.db, d.ms); }
        const g = reveal(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, tier, tierUp: p?.tierUp === true, isNew: p?.isNew === true,
          mythicVariant: fin(p?.mythicVariant, 0), durationS: p?.durationS === undefined ? undefined : fin(p.durationS, NaN),
          calm, pitch: clamp(fin(p?.pitch, 1), 0.5, 2),
        });
        register(g);
        musicDuck(g.endTime);
      } catch { dropped++; }
    },

    mergeStart(p) {
      const a = accept('merge');
      if (!a) return NOOP_MERGE;
      let v: MergeVoice;
      try {
        v = mergeStart(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, tier: asTier(p?.tier), calm: p?.calm === true,
          chargeS: p?.chargeS === undefined ? undefined : fin(p.chargeS, NaN), pitch: clamp(fin(p?.pitch, 1), 0.5, 2),
          lookaheadS: 0.5,
        });
      } catch { dropped++; return NOOP_MERGE; }
      register(v);
      musicDuck(v.endTime);
      pumped.push(v);
      if (!pumpTimer) pumpTimer = setInterval(pump, 80);
      let done = false;
      return {
        burst(q) {
          if (done || disposed) return;
          done = true;
          try {
            const b = accept('mergeBurst');
            if (!b) { v.stop(0.1); return; }
            const g = v.burst({
              tier: asTier(q?.tier), tierUp: q?.tierUp === true, mythicVariant: fin(q?.mythicVariant, 0),
              durationS: q?.durationS === undefined ? undefined : fin(q.durationS, NaN),
            });
            if (g) { register(g); musicDuck(g.endTime); }
          } catch { dropped++; }
        },
        stop() {
          if (done) return;
          done = true;
          try { v.stop(0.15); } catch { /* ignore */ }
        },
      };
    },

    duck(p) {
      if (!chain || !ready()) { dropped++; return; }
      started.duck++;
      try { chain.duck(fin(p?.db, -12), fin(p?.ms, 250)); } catch { dropped++; }
    },

    /* ───── round 3 ───── */

    setMusic(p) {
      if (!p || typeof p !== 'object') { dropped++; return; }
      if (p.on !== undefined) musicWanted = p.on === true;
      if (p.volume !== undefined) settings.music = c01(p.volume, settings.music);
      if (chain) chain.apply(settings);
      syncMusic();
    },

    bump(p) {
      if (!ctx || disposed || !ready()) { dropped++; tryResume(); return; }
      const I = bumpLimiter.admit(fin(p?.intensity, 0), perfS());
      throttled.bump = bumpLimiter.throttled;
      if (I === null) return;
      const a = accept('bump');
      if (!a) return;
      try {
        register(bump(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, intensity: I, pitch: clamp(fin(p?.pitch, 1), 0.5, 2), pan: clamp(fin(p?.pan, 0), -1, 1),
        }));
      } catch { dropped++; }
    },

    lift(p) {
      const a = accept('lift');
      if (!a) return;
      try {
        register(lift(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, pitch: clamp(fin(p?.pitch, 1), 0.5, 2), pan: clamp(fin(p?.pan, 0), -1, 1),
        }));
      } catch { dropped++; }
    },

    toss(p) {
      const a = accept('toss');
      if (!a) return;
      try {
        register(toss(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
          rng: makeRng(a.seed), jitter: a.jitter, speed: c01(p?.speed, 0.5), pan: clamp(fin(p?.pan, 0), -1, 1),
        }));
      } catch { dropped++; }
    },

    strand(p) {
      if (!p || typeof p !== 'object') { dropped++; return; }
      const T = c01(p.tension, 0);
      const pan = clamp(fin(p.pan, 0), -1, 1);
      if (p.snap === true) {
        if (strandV) { try { strandV.end(0.03); } catch { /* gone */ } strandV = null; }
        const a = accept('strandSnap');
        if (!a) return;
        try {
          register(strandSnap(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
            rng: makeRng(a.seed), jitter: a.jitter, tension: T, pitch: clamp(fin(p.pitch, 1), 0.5, 2), pan,
          }));
        } catch { dropped++; }
        return;
      }
      if (!ctx || disposed || !ready()) { dropped++; tryResume(); return; }
      if (settings.muted) return;                  // a per-frame caller while muted: nothing to start, nothing to count
      let v = strandV;
      if (!v || !v.alive || v.dying) {
        strandV = null;
        if (T < 0.02) return;                      // nothing to sound yet
        const a = accept('strand');
        if (!a) return;
        try {
          v = strand(a.c, chain!.plain, a.c.currentTime + LOOKAHEAD, {
            rng: makeRng(a.seed), jitter: a.jitter, pitch: clamp(fin(p.pitch, 1), 0.5, 2), pan,
          });
        } catch { dropped++; return; }
        register(v);
        strandV = v;
      } else {
        // the held voice: faster-than-display callers are thinned to one update per 8 ms
        const t = perfS();
        if (t - lastStrandUpd < 0.008) { throttled.strand++; return; }
      }
      lastStrandUpd = perfS();
      try { v.update({ tension: T, pan }); } catch { /* never throw into the render loop */ }
    },

    detailStats() {
      const t = now();
      const sessions = [...retiring, ...(musicInst ? [musicInst] : [])];
      let notes = mstat.notes, drop = mstat.dropped, maxLive = mstat.maxLive;
      const recent = Array.from(tickRing.subarray(0, Math.min(mstat.ticks, tickRing.length))).sort((p, q) => p - q);
      for (const m of sessions) { notes += m.stats.notes + m.stats.bubbles; drop += m.stats.dropped + m.stats.late; maxLive = Math.max(maxLive, m.stats.maxLive); }
      return {
        music: {
          on: musicWanted, playing: !!musicInst, sessions: sessions.length, field: composer.field,
          liveNotes: musicInst ? musicInst.liveAt(t) : 0, maxLiveNotes: maxLive, notes, dropped: drop,
          ticks: mstat.ticks, tickMsMean: mstat.ticks ? mstat.tickMsTotal / mstat.ticks : 0, tickMsMax: mstat.tickMsMax,
          tickMsRecentP99: recent.length ? recent[Math.min(recent.length - 1, Math.floor(recent.length * 0.99))] : 0,
          tickMsRecentMax: recent.length ? recent[recent.length - 1] : 0,
          ducked: musicInst ? musicInst.isDucked : false, volume: settings.music,
        },
        throttled: { ...throttled },
      };
    },

    stats() {
      prune();
      const t = now();
      let peak = 0;
      if (chain && ctx && ctx.state === 'running') {
        try { peak = chain.peakSince(Math.max(0, t - lastStatsT)); } catch { peak = 0; }
      }
      lastStatsT = t;
      const liveKinds: Record<string, number> = {};
      for (const g of groups) if (!g.dying) liveKinds[g.kind] = (liveKinds[g.kind] ?? 0) + 1;
      return {
        started: { ...started },
        state: ctx ? ctx.state : 'locked',
        sampleRate: ctx ? ctx.sampleRate : 0,
        peak,
        live: groups.length,
        liveNodes: liveNodeCount(),
        dropped,
        liveKinds,
      };
    },

    setPaused(p) {
      paused = !!p;
      if (!ctx || disposed) return;
      const c = ctx;
      const token = ++pauseToken;
      if (paused) {
        pumped.length = 0;
        const fading = !!musicInst;
        syncMusic();                    // a playing music session fades out over PAUSE_FADE_S
        const suspend = (): void => {
          if (token !== pauseToken || !paused || disposed) return;
          freeAll();                    // 'ended' events do not arrive while suspended: disconnect now
          freeMusic();
          c.suspend().catch(() => { /* already suspended or closed */ });
        };
        if (fading) { killAll(0.03); setTimeout(suspend, (PAUSE_FADE_S + 0.03) * 1000); }
        else suspend();
      } else {
        c.resume().then(() => { if (token === pauseToken) syncMusic(); }).catch(() => { /* needs a gesture: unlock() will retry */ });
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) { clearInterval(timer); timer = null; }
      if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = null; }
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      pumped.length = 0;
      freeAll();
      freeMusic();
      if (chain) chain.disconnect();
      if (ctx) { ctx.close().catch(() => { /* already closed */ }); }
    },
  };
  return self;
}
