// Sound lab page + offline render API for _harness/probe_audio.mjs. Imports the game's own audio sources straight from
// the Vite dev server (so the probe measures the shipping code, not a copy).
import { poke, release, land, pop, squish, blend } from '/src/audio/voices.ts';
import { createMasterChain, musicGain } from '/src/audio/chain.ts';
import { createAudio } from '/src/audio/engine.ts';
import * as D from '/src/audio/dsp.ts';
import * as C from '/src/audio/ceremony.ts';
import * as M from '/src/audio/music.ts';
import * as I3 from '/src/audio/interact.ts';
import * as CT from '/src/audio/cut.ts';
import { runEngineTests } from './engine_tests.js';
import { runEngineTests3 } from './engine_tests3.js';
import { runEngineOffline } from './engine_offline.js';

export const SR = 48000;
const BOOSTED = new Set(['poke', 'squish', 'release']);   // everything else (incl. all ceremony voices) goes to the plain bus

const revive = (v) => (v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v);
const reviveAll = (o) => { const r = {}; for (const k of Object.keys(o || {})) r[k] = typeof o[k] === 'string' ? revive(o[k]) : o[k]; return r; };

function b64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const smooth = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };

/** Scripted held-squish gestures: compression c(t), rate = dc/dt (one-pole smoothed ~60 ms like the physics lane's metric). */
function squishScript(name) {
  let c, endAt, secs, marks = [];
  if (name === 'prl') {
    c = (t) => {
      if (t < 0.1) return 0;
      if (t < 1.0) return 0.8 * smooth((t - 0.1) / 0.9);
      if (t < 1.5) return 0.8;
      if (t < 2.3) return 0.8 + 0.1 * Math.sin(2 * Math.PI * 2.5 * (t - 1.5));
      if (t < 2.8) return 0.8;
      if (t < 2.95) return 0.8 * (1 - smooth((t - 2.8) / 0.15));
      return 0;
    };
    endAt = 3.15; secs = 3.7;
    marks = [{ t: 0.1, label: 'PRESS' }, { t: 1.0, label: 'HOLD' }, { t: 1.5, label: 'RUB' }, { t: 2.3, label: 'HOLD' }, { t: 2.8, label: 'RELEASE' }];
  } else if (name === 'sweep') {
    // formant-motion test: squeeze 0 -> 1 over 1.2 s, then spring back 1 -> 0 over 1.2 s (rate = +/- 0.83 /s)
    c = (t) => (t < 1.2 ? t / 1.2 : Math.max(0, 1 - (t - 1.2) / 1.2));
    endAt = 2.4; secs = 2.8;
    marks = [{ t: 0, label: 'SQUEEZE' }, { t: 1.2, label: 'SPRING BACK' }];
  } else if (name === 'still') {
    c = () => 0.6; endAt = 2.0; secs = 2.4;
  } else if (name === 'steps') {
    const lv = [0, 0.3, 0.6, 1.2, 2.5, 0];
    c = null; endAt = lv.length * 0.5; secs = endAt + 0.4;
    const ev = [];
    for (let t = 0; t < endAt; t += 0.01) ev.push({ t, compression: 0.5, rate: lv[Math.min(lv.length - 1, Math.floor(t / 0.5))] });
    return { events: ev, endAt, secs, marks: lv.map((v, i) => ({ t: i * 0.5, label: String(v) })) };
  } else throw new Error('unknown squish script ' + name);
  const dt = 0.01, h = 0.002;
  const events = [];
  let rs = 0;
  for (let t = 0; t < endAt; t += dt) {
    const raw = (c(t + h) - c(t - h)) / (2 * h);
    rs += (raw - rs) * (1 - Math.exp(-dt / 0.06));
    events.push({ t, compression: c(t), rate: rs });
  }
  return { events, endAt, secs, marks };
}

/** Per-frame call times like a real render loop: `hz` with +/-`jitter` (fraction) frame-to-frame variation, from a seeded
 *  stream; `quantum` (s) puts each call on the audio clock's grid as the live engine sees it (ctx.currentTime only moves
 *  once per render quantum / audio callback, so several calls can share one time). */
function frameTimes(dur, { hz = 60, jitter = 0, quantum = 0, seed = 7 } = {}) {
  const r = D.makeRng(seed), out = [];
  for (let t = 0; t < dur; t += (1 / hz) * (1 + jitter * (2 * r() - 1))) out.push(quantum ? Math.ceil(t / quantum) * quantum : t);
  return out;
}

/** Scripted strand gestures (per-frame tension updates at 60 Hz; the `real*` ones at realistic, jittered rates). */
function strandScript(name, o = {}) {
  const ev = [];
  let endAt, secs, snapAt = null, marks = [];
  const sm = (u) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t); };
  if (name === 'real') {
    // a realistic stretch with NO snap (the strand voice alone): 1.2 s pull to tension 0.85, 0.25 s trembling hold; the
    // calls come at o.hz (default 30) with o.jitter, on the audio clock's grid o.quantum
    for (const t of frameTimes(1.45, o)) ev.push({ t, tension: t < 1.2 ? 0.85 * sm(t / 1.2) : 0.85 + 0.02 * Math.sin(2 * Math.PI * 7 * t) });
    endAt = 1.45; secs = 2.0;
    marks = [{ t: 0, label: 'STRETCH' }, { t: 1.2, label: 'HOLD' }, { t: 1.45, label: 'CALLS STOP' }];
  } else if (name === 'realHold') {
    for (const t of frameTimes(1.5, o)) ev.push({ t, tension: o.T ?? 0.8 });
    endAt = 1.5; secs = 2.0;
  } else if (name === 'stretch') {
    // pull the strand out over 1.2 s (tension 0 -> 0.9), hold it trembling 0.25 s, then it snaps
    for (let t = 0; t < 1.45; t += 1 / 60) ev.push({ t, tension: t < 1.2 ? 0.9 * sm(t / 1.2) : 0.9 + 0.02 * Math.sin(2 * Math.PI * 7 * t) });
    snapAt = 1.45; endAt = 1.45; secs = 2.0;
    marks = [{ t: 0, label: 'STRETCH' }, { t: 1.2, label: 'HOLD' }, { t: 1.45, label: 'SNAP' }];
  } else if (name === 'orphan') {
    // the caller simply stops calling at 0.8 s (no end(), no snap): the voice must silence and free itself
    for (let t = 0; t < 0.8; t += 1 / 60) ev.push({ t, tension: 0.7 * sm(t / 0.8) });
    endAt = null; secs = 2.0;
    marks = [{ t: 0, label: 'STRETCH' }, { t: 0.8, label: 'CALLS STOP' }];
  } else if (name === 'hold2' || name === 'hold8') {
    const T = name === 'hold2' ? 0.2 : 0.8;
    for (let t = 0; t < 1.0; t += 1 / 60) ev.push({ t, tension: T });
    endAt = 1.0; secs = 1.4;
  } else throw new Error('unknown strand script ' + name);
  return { events: ev, endAt, secs, snapAt, marks };
}

/**
 * Render one voice offline at 48 kHz.
 * spec: { voice, seed, pitch, pan, jitter, params, secs, master, boost, chain (default true), channels, script, t0 }
 */
async function renderVoice(spec) {
  const sr = spec.sr ?? SR;
  const t0 = spec.t0 ?? 0.01;
  let script = null;
  let secs = spec.secs;
  if (spec.voice === 'squish') { script = squishScript(spec.script ?? 'prl'); secs = secs ?? script.secs; }
  if (spec.voice === 'strand') { script = strandScript(spec.script ?? 'stretch', spec.pattern); secs = secs ?? script.secs; }
  const ctx = new OfflineAudioContext(spec.channels ?? 1, Math.ceil((secs ?? 1) * sr), sr);
  const useChain = spec.chain !== false;
  let chain = null;
  let out = ctx.destination;
  if (useChain) {
    chain = createMasterChain(ctx);
    chain.apply({ master: spec.master ?? 1, squishBoost: spec.boost ?? 0, muted: !!spec.muted }, true);
    out = BOOSTED.has(spec.voice) ? chain.boost : chain.plain;
  }
  const base = { rng: D.makeRng(spec.seed ?? 1), pitch: revive(spec.pitch ?? 1), pan: revive(spec.pan ?? 0), jitter: spec.jitter, ...reviveAll(spec.params) };
  let voice, endOverride;
  switch (spec.voice) {
    case 'poke': voice = poke(ctx, out, t0, base); break;
    case 'release': voice = release(ctx, out, t0, base); break;
    case 'land': voice = land(ctx, out, t0, base); break;
    case 'pop': voice = pop(ctx, out, t0, base); break;
    case 'blend': voice = blend(ctx, out, t0, base); break;
    case 'squish': {
      voice = squish(ctx, out, t0, base);
      for (const e of script.events) if (spec.killAt === undefined || e.t < spec.killAt) voice.update({ compression: revive(e.compression), rate: revive(e.rate), pan: spec.panUpdate }, t0 + e.t);
      if (spec.killAt === undefined) voice.end(0.08, t0 + script.endAt);
      break;
    }
    case 'bump': voice = I3.bump(ctx, out, t0, base); break;
    case 'lift': voice = I3.lift(ctx, out, t0, base); break;
    case 'toss': voice = I3.toss(ctx, out, t0, base); break;
    case 'strandSnap': voice = I3.strandSnap(ctx, out, t0, base); break;
    case 'strand': {
      const sv = I3.strand(ctx, out, t0, base);
      voice = sv;
      for (const e of script.events) if (spec.killAt === undefined || e.t < spec.killAt) sv.update({ tension: revive(e.tension), pan: spec.panUpdate }, t0 + e.t);
      let end = sv.endTime;
      if (script.snapAt !== null && spec.killAt === undefined && spec.snap !== false) {
        sv.end(0.03, t0 + script.snapAt);
        const sn = I3.strandSnap(ctx, out, t0 + script.snapAt, { ...base, rng: D.makeRng((spec.seed ?? 1) + 99), tension: 0.9 });
        end = Math.max(sn.endTime, t0 + script.snapAt + 0.05);
      } else if (script.endAt !== null && spec.killAt === undefined) { sv.end(0.05, t0 + script.endAt); end = t0 + script.endAt + 0.08; }
      endOverride = end;
      break;
    }
    // CUT (cut.ts): the slice, the separation pop, the rejoin (params: frac, family, neckS, calm, all, level)
    case 'cutSlice': voice = CT.cutSlice(ctx, out, t0, base); break;
    case 'cutPop': voice = CT.cutPop(ctx, out, t0, base); break;
    case 'rejoin': voice = CT.rejoin(ctx, out, t0, base); break;
    case 'cutSeq': {
      // a whole cut as the shell plays it: the slice at t0, the separation pop when the neck parts (t0 + neckS)
      const sl = CT.cutSlice(ctx, out, t0, base);
      const pp = CT.cutPop(ctx, out, t0 + CT.neckLen(base.neckS), { ...base, rng: D.makeRng((spec.seed ?? 1) + 101) });
      voice = sl;
      endOverride = Math.max(sl.endTime, pp.endTime);
      break;
    }
    case 'meterFull': voice = C.meterFull(ctx, out, t0, base); break;
    case 'grab': voice = C.grab(ctx, out, t0, base); break;
    case 'crack': voice = C.crack(ctx, out, t0, base); break;
    case 'capBurst': voice = C.capsuleBurst(ctx, out, t0, base); break;
    case 'reveal': voice = C.reveal(ctx, out, t0, base); break;
    case 'mergeBurst': voice = C.mergeBurst(ctx, out, t0, base); break;
    case 'merge': {
      const mv = C.mergeStart(ctx, out, t0, base);
      voice = mv;
      if (spec.burstAt !== undefined) {
        const b = mv.burst({ tier: 'common', ...reviveAll(spec.burst) }, t0 + spec.burstAt);
        endOverride = Math.max(b.endTime, t0 + spec.burstAt + 0.1);
      }
      if (spec.stopAt !== undefined) mv.stop(0.15, t0 + spec.stopAt);
      break;
    }
    default: throw new Error('unknown voice ' + spec.voice);
  }
  if (spec.duck && chain) chain.duck(revive(spec.duck.db), revive(spec.duck.ms), t0 + (spec.duck.at ?? 0));
  if (spec.killAt !== undefined) voice.kill(0.02, t0 + spec.killAt);
  const buf = await ctx.startRendering();
  if (spec.waitEnded) await new Promise((r) => setTimeout(r, 80));   // let the 'ended' events of the render arrive
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(b64(buf.getChannelData(c)));
  return { sr, n: buf.length, channels: chans, t0, endTime: endOverride ?? voice.endTime, script: script && { events: script.events, endAt: script.endAt, marks: script.marks }, counters: { ...D.nodeCounters }, alive: voice.alive, voiceEnd: voice.endTime, onset: voice.onset ?? 0, bubbles: voice.bubbles };
}

/** Full ceremonies, scheduled exactly as the time map at the top of ceremony.ts says. spec: { kind: 'capsule'|'merge', tier, calm, tierUp, isNew, mythicVariant, seed, secs } */
async function renderCeremony(spec) {
  const sr = SR, t0 = 0.01;
  const ctx = new OfflineAudioContext(1, Math.ceil((spec.secs ?? 8) * sr), sr);
  const chain = createMasterChain(ctx);
  chain.apply({ master: 1, squishBoost: 0, muted: false }, true);
  const ti = C.tierIdx(spec.tier), calm = !!spec.calm, k = calm ? C.CALM_SCALE : 1;
  const rng = D.makeRng(spec.seed ?? 1);
  const sub = () => D.makeRng((rng() * 4294967296) >>> 0);
  const ends = [], events = [];
  const add = (name, at, v) => { events.push({ name, at }); ends.push(v.endTime ?? 0); return v; };
  if (spec.kind === 'capsule') {
    add('grab', 0, C.grab(ctx, chain.plain, t0, { rng: sub(), progress: 0.1 }));
    add('grab', 0.18 * k, C.grab(ctx, chain.plain, t0 + 0.18 * k, { rng: sub(), progress: 0.7 }));
    add('crack', 0.35 * k, C.crack(ctx, chain.plain, t0 + 0.35 * k, { rng: sub() }));
    const P = C.PRE_ROLL_S[ti] * k;
    const revealAt = ti < 2 ? 1.0 * k : 0.65 * k;
    const burstAt = ti < 2 ? 0.65 * k : (0.65 + C.PRE_ROLL_S[ti]) * k;
    add('burst', burstAt, C.capsuleBurst(ctx, chain.plain, t0 + burstAt, { rng: sub(), tier: spec.tier, calm }));
    if (ti === 5) { const d = C.mythicDuck(calm); chain.duck(d.db, d.ms, t0 + revealAt); events.push({ name: 'duck', at: revealAt }); }
    add('reveal', revealAt, C.reveal(ctx, chain.plain, t0 + revealAt, { rng: sub(), tier: spec.tier, tierUp: !!spec.tierUp, isNew: !!spec.isNew, mythicVariant: spec.mythicVariant ?? 0, durationS: spec.durationS, calm }));
    if (spec.extraMeter) add('meterFull', 0, C.meterFull(ctx, chain.plain, t0, { rng: sub() }));
    return pack(await ctx.startRendering(), t0, Math.max(...ends), events, { P, revealAt, burstAt, budget: C.CAPSULE_BUDGET_S[ti] * k });
  }
  const mv = C.mergeStart(ctx, chain.plain, t0, { rng: sub(), tier: spec.tier, calm, chargeS: spec.chargeS });
  events.push({ name: 'mergeStart', at: 0 });
  const b = mv.burst({ tier: spec.tier, tierUp: !!spec.tierUp, mythicVariant: spec.mythicVariant ?? 0, durationS: spec.durationS }, t0 + mv.chargeS);
  events.push({ name: 'burst', at: mv.chargeS });
  ends.push(b.endTime, t0 + mv.chargeS + 0.1);
  return pack(await ctx.startRendering(), t0, Math.max(...ends), events, { chargeS: mv.chargeS, budget: C.MERGE_BUDGET_S[ti] * k });
}

function pack(buf, t0, endTime, events, extra) {
  return { sr: buf.sampleRate, n: buf.length, channels: [b64(buf.getChannelData(0))], t0, endTime, events, ...extra, counters: { ...D.nodeCounters } };
}

/** A steady 220 Hz sine through the chain with a scripted duck: proves the master duck is smooth. */
async function renderDuck(spec) {
  const sr = SR;
  const ctx = new OfflineAudioContext(1, Math.ceil((spec.secs ?? 2) * sr), sr);
  const chain = createMasterChain(ctx);
  chain.apply({ master: 1, squishBoost: 0, muted: false }, true);
  const o = ctx.createOscillator(); o.frequency.value = 220; const g = ctx.createGain(); g.gain.value = 0.2;
  o.connect(g); g.connect(chain.plain); o.start(0);
  chain.duck(revive(spec.db), revive(spec.ms), spec.at ?? 0.5);
  const buf = await ctx.startRendering();
  return { sr, n: buf.length, channels: [b64(buf.getChannelData(0))], t0: 0, endTime: spec.secs ?? 2 };
}

/* ───────────── round 3: music bed, mix, long simulation ───────────── */

/**
 * Render the music bed offline. spec: { seed, secs, sr, channels, music (volume, default 0.45), master, muted, pitch,
 *   sessions: [{ start, stop?, fade? }] (default one session from 0.05 s), ducks: [{ from, until }], rooms: [{ from, until,
 *   db }] (effect dips, MusicBed.makeRoom, in time order; one-go renders only), layers ({ pad, mallet } stem levels), chunk (s: schedule in
 *   live-like slices through suspend(), else all at once) }. Sessions share one Composer, exactly like the engine.
 */
async function renderMusic(spec) {
  const sr = spec.sr ?? SR;
  const secs = spec.secs ?? 30;
  const ctx = new OfflineAudioContext(spec.channels ?? 1, Math.ceil(secs * sr), sr);
  const chain = createMasterChain(ctx);
  chain.apply({ master: spec.master ?? 1, squishBoost: 0, muted: !!spec.muted, music: spec.music ?? M.MUSIC_DEFAULT }, true);
  const comp = new M.Composer(spec.seed ?? 1);
  const sessions = (spec.sessions ?? [{ start: 0.05 }]).map((x) => ({ ...x }));
  const ducks = (spec.ducks ?? []).slice().sort((a, b) => a.from - b.from);
  const beds = [];
  const plan = (until) => {
    for (const s of sessions) {
      if (s.start >= until) continue;
      if (!s.bed) { s.bed = new M.MusicBed(ctx, chain.music, comp, s.start, { log: true, pitch: spec.pitch, layers: spec.layers }); beds.push(s.bed); }
      const stopAt = s.stop ?? Infinity;
      s.bed.advance(Math.min(until, stopAt));
      if (stopAt <= until && !s.stopped) { s.bed.stop(stopAt, s.fade ?? M.FADE_OUT_S); s.stopped = true; }
    }
    for (const d of ducks) {
      if (d.done || d.from >= until) continue;
      const s = sessions.find((q) => q.bed && q.start <= d.from && (q.stop ?? Infinity) > d.from);
      if (s) { s.bed.pollDuck(d.from); s.bed.duckSpan(d.from, d.until); }
      d.done = true;
    }
    for (const s of sessions) if (s.bed) s.bed.pollDuck(until);
  };
  const tick = [];
  if (spec.chunk) {
    const step = spec.chunk;
    let t = 0;
    const next = () => {
      t += step;
      if (t >= secs) return;
      ctx.suspend(t).then(() => { const a = performance.now(); plan(t + M.LOOKAHEAD_S); tick.push(performance.now() - a); next(); ctx.resume(); });
    };
    plan(M.LOOKAHEAD_S);
    next();
  } else {
    plan(secs + 1);
    for (const q of (spec.rooms ?? []).slice().sort((a, b) => a.from - b.from)) {
      const s = sessions.find((x) => x.bed && x.start <= q.from && (x.stop ?? Infinity) > q.from);
      if (s) s.bed.makeRoom(q.from, q.until, q.db, q.gainDb === undefined ? {} : { gainDb: q.gainDb });
    }
  }
  const buf = await ctx.startRendering();
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(b64(buf.getChannelData(c)));
  const log = [];
  beds.forEach((b, i) => { for (const e of b.log) log.push({ ...e, session: i }); });
  log.sort((a, b) => a.t - b.t);
  return { sr, n: buf.length, channels: chans, t0: 0, endTime: secs, log, fieldLog: comp.fieldLog.slice(), stats: beds.map((b) => ({ ...b.stats })), tickMs: tick };
}

/** The music's composition alone (no audio): the field walk and the notes of `bars` bars, for the drift-rule checks. */
function composeOnly(seed, bars) {
  const comp = new M.Composer(seed);
  const out = [];
  for (let i = 0; i < bars; i++) out.push(comp.nextBar());
  return { bars: out, fieldLog: comp.fieldLog.slice() };
}

/**
 * Music + a play sequence through ONE chain. spec: { seed, secs, music: bool, effects: bool, musicVolume, events: [{ at,
 * voice, params, pitch, script, pattern }] }. With music on, the music makes room for every effect by the ENGINE's own rule
 * (music.ts oneShotRoom / squishRoom / strandRoom / roomClearDelay, the same deepening for a music volume above the
 * default), so the music stem here is exactly the music inside the live mix. `at` is when the effect starts sounding; its
 * call is ROOM_LEAD_S earlier, and ROOM_CLEAR_S earlier still for a fast effect that arrives while the music is up (the
 * engine delays such an effect by that much). Returns the effect spans.
 */
async function renderMix(spec) {
  const sr = SR, secs = spec.secs ?? 20;
  const ctx = new OfflineAudioContext(1, Math.ceil(secs * sr), sr);
  const chain = createMasterChain(ctx);
  const vol = spec.musicVolume ?? M.MUSIC_DEFAULT;
  chain.apply({ master: 1, squishBoost: 0, muted: false, music: vol }, true);
  const gdb = Math.max(0, 20 * Math.log10(Math.max(musicGain(vol), 1e-6)));
  const comp = new M.Composer(spec.seed ?? 1);
  const bed = spec.music ? new M.MusicBed(ctx, chain.music, comp, 0.05, {}) : null;
  if (bed) bed.advance(secs + 1);
  const spans = [], asks = [];
  const oneShot = (kind, at, g) => asks.push({ t: at - M.ROOM_LEAD_S, kind, at, end: g.endTime, onset: g.onset ?? 0 });
  const held = (t, req) => asks.push({ t: t - M.ROOM_LEAD_S, req });
  let k = 0;
  const fx = spec.effects !== false;
  // with effects off, a voice is still built (on a scratch context) for its end time and onset, so the music stem gets
  // exactly the room the mix gets
  const build = (fn, out, t, base) => { if (fx) return fn(ctx, out, t, base); const scratch = new OfflineAudioContext(1, 128, sr); return fn(scratch, scratch.destination, t, base); };
  for (const e of spec.events ?? []) {
    const rng = D.makeRng(1000 + k++);
    const base = { rng, pitch: e.pitch ?? 1, pan: 0, ...(e.params || {}) };
    const out = BOOSTED.has(e.voice) ? chain.boost : chain.plain;
    const t = e.at;
    if (e.voice === 'squish') {
      const sc = squishScript(e.script ?? 'prl');
      const v = fx ? squish(ctx, out, t, base) : null;
      for (const q of sc.events) { if (v) v.update({ compression: q.compression, rate: q.rate }, t + q.t); held(t + q.t, (u) => M.squishRoom(u, q.rate, gdb)); }
      if (v) v.end(0.08, t + sc.endAt);
      spans.push({ voice: 'squish', tag: e.tag ?? 'squish', at: t, end: t + sc.endAt + 0.1, pitch: base.pitch });
    } else if (e.voice === 'strand') {
      // the strand alone (pattern = realistic call times) and, unless snap === false, its snap right after the last call
      const sc = strandScript(e.script ?? 'real', e.pattern);
      const v = fx ? I3.strand(ctx, out, t, base) : null;
      for (const q of sc.events) { if (v) v.update({ tension: q.tension }, t + q.t); held(t + q.t, (u) => M.strandRoom(u, q.tension, gdb)); }
      const last = sc.events[sc.events.length - 1].t;
      spans.push({ voice: 'strand', tag: e.tag ?? 'strand', at: t, end: t + last, pitch: base.pitch });
      if (e.snap !== false) {
        const ts = t + last + 0.016;
        if (v) v.end(0.03, ts);
        const g = build(I3.strandSnap, out, ts, { ...base, rng: D.makeRng(77 + k), tension: 0.9 });
        spans.push({ voice: 'strandSnap', tag: 'snap(strand)', at: ts, end: g.endTime, pitch: base.pitch });
        oneShot('strandSnap', ts, g);
      }
    } else {
      const fn = { poke, release, land, pop, bump: I3.bump, lift: I3.lift, toss: I3.toss, strandSnap: I3.strandSnap }[e.voice];
      const g = build(fn, out, t, base);
      spans.push({ voice: e.voice, tag: e.tag ?? e.voice, at: t, end: g.endTime, pitch: base.pitch });
      oneShot(e.voice, t, g);
    }
  }
  let nRooms = 0;
  if (bed) {
    asks.sort((a, b) => a.t - b.t);
    const ask = (r) => { if (r) { bed.makeRoom(r.from, r.until, r.db, { at: r.at, atk: r.atk, gainDb: r.gainDb }); nRooms++; } };
    for (const q of asks) {
      if (q.req) { ask(q.req(q.t)); continue; }
      // the engine's call time: a fast effect onto music that is up was called ROOM_CLEAR_S earlier (engine.ts accept)
      const call = q.t - M.roomClearDelay(q.kind, bed.roomLevelAt(q.t - M.ROOM_CLEAR_S * (1 + gdb / 6)), gdb);
      for (const r of M.oneShotRoom(q.kind, call, q.at, q.end, q.onset, gdb)) ask(r);
    }
    bed.pollDuck(secs + 1);
  }
  const buf = await ctx.startRendering();
  return { sr, n: buf.length, channels: [b64(buf.getChannelData(0))], t0: 0, endTime: secs, spans, rooms: nRooms };
}

/** The strand's stick-slip AM path alone (interact.ts strandAm + the real slip PeriodicWave): a constant carrier of 1 through
 *  the `am` gain whose gain is driven by the slip oscillator, as in the voice. Returns the min / max of the resulting gain
 *  a(t) for each depth: it must span exactly (1 - depth) .. 1 (audio-4 fix). */
async function strandAmRange(spec) {
  const out = [];
  for (const depth of spec.depths) {
    const ctx = new OfflineAudioContext(1, 4800, SR);
    const pw = D.pulseWave(ctx, 'slip', I3.SLIP_PULSE);
    const g = I3.strandAm(depth, pw.min);
    const one = ctx.createConstantSource(); one.offset.value = 1;
    const slip = ctx.createOscillator(); slip.setPeriodicWave(pw.wave); slip.frequency.value = 50;
    const am = ctx.createGain(); am.gain.value = g.base;
    const mod = ctx.createGain(); mod.gain.value = g.mod;
    slip.connect(mod); mod.connect(am.gain); one.connect(am); am.connect(ctx.destination);
    one.start(0); slip.start(0);
    const b = await ctx.startRendering();
    const x = b.getChannelData(0);
    let lo = Infinity, hi = -Infinity;
    for (let i = 480; i < x.length; i++) { lo = Math.min(lo, x[i]); hi = Math.max(hi, x[i]); }
    // the same arithmetic with the first version's mapping (am.gain = 1 - depth), for the report
    const span = 1 - pw.min;
    out.push({ depth, lo, hi, pwMin: pw.min, oldLo: 1 - depth + (depth / span) * pw.min, oldHi: 1 - depth + depth / span });
  }
  return out;
}

/** The music's tuned bubbles (music.ts musicBubble) alone, one render per MIDI note: the pitch check. */
async function renderMusicBubbles(spec) {
  const out = [];
  for (const midi of spec.midis) {
    const ctx = new OfflineAudioContext(1, Math.round(0.4 * SR), SR);
    M.musicBubble(ctx, ctx.destination, 0.01, M.midiHz(midi) * (spec.pitch ?? 1), 0.1);
    const b = await ctx.startRendering();
    out.push({ midi, channels: [b64(b.getChannelData(0))] });
  }
  return out;
}

/**
 * 10 minutes (or `secs`) of music scheduled exactly like the live engine: suspend() every `stepS` of audio time, then
 * advance(now + LOOKAHEAD_S) and pollDuck(now) (the engine's tick). Measures the tick cost, live notes and live nodes over
 * time; ends with stop() and reports whether the nodes come back to the baseline. Nothing large is sent back.
 */
async function simulateMusic(spec) {
  const sr = spec.sr ?? 22050, secs = spec.secs ?? 600, step = spec.stepS ?? 0.1;
  const stopAt = spec.stopAt ?? secs - 4;
  const ctx = new OfflineAudioContext(1, Math.ceil(secs * sr), sr);
  const chain = createMasterChain(ctx);
  chain.apply({ master: 1, squishBoost: 0, muted: false, music: M.MUSIC_DEFAULT }, true);
  D.noiseBuffer(ctx);                                   // as the engine does in unlock()
  await new Promise((r) => setTimeout(r, 50));
  const base = D.liveNodeCount();
  const comp = new M.Composer(spec.seed ?? 1);
  const bed = new M.MusicBed(ctx, chain.music, comp, 0.05, {});
  const tick = [];
  let maxNodes = 0, maxLive = 0, t = 0, stopped = false, samples = 0, nodeSum = 0;
  const run = () => {
    const a = performance.now();
    const now = t;
    if (!stopped && now >= stopAt) { bed.stop(now, M.FADE_OUT_S); stopped = true; }
    bed.advance(now + M.LOOKAHEAD_S);
    bed.pollDuck(now);
    // a ceremony every 47 s ducks it (exercises the duck path for the whole run)
    if (!stopped && Math.floor(now / 47) !== Math.floor((now - step) / 47)) bed.duckSpan(now, now + 3);
    tick.push(performance.now() - a);
    const ln = D.liveNodeCount() - base;
    maxNodes = Math.max(maxNodes, ln); nodeSum += ln; samples++;
    maxLive = Math.max(maxLive, bed.liveAt(now));
  };
  const next = () => {
    t += step;
    if (t >= secs - step) return;
    ctx.suspend(t).then(() => { run(); next(); ctx.resume(); });
  };
  run();
  next();
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let pk = 0, ss = 0, bad = 0, maxStep = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) { bad++; continue; } const a = Math.abs(v); if (a > pk) pk = a; ss += v * v; if (i) maxStep = Math.max(maxStep, Math.abs(v - d[i - 1])); }
  await new Promise((r) => setTimeout(r, 300));       // let the last 'ended' events arrive
  bed.free();
  await new Promise((r) => setTimeout(r, 50));
  const sorted = tick.slice().sort((a, b) => a - b);
  return {
    secs, sr, ticks: tick.length, tickMeanMs: tick.reduce((a, b) => a + b, 0) / tick.length, tickP99Ms: sorted[Math.floor(sorted.length * 0.99)], tickMaxMs: sorted[sorted.length - 1],
    maxLiveNotes: maxLive, statsMaxLive: bed.stats.maxLive, maxLiveNodes: maxNodes, meanLiveNodes: nodeSum / samples, endLiveNodes: D.liveNodeCount() - base,
    stats: { ...bed.stats }, fieldLog: comp.fieldLog.slice(), peak: pk, rmsDb: 20 * Math.log10(Math.sqrt(ss / d.length) + 1e-12), bad, maxStep,
  };
}

/** The pure cut limiter (cut.ts CutLimiter), driven with synthetic times: [{ t, kind }] -> [{ t, kind, out }] (null = skipped). */
function cutLimiterRun(calls) {
  const L = new CT.CutLimiter();
  return { out: calls.map((c) => ({ t: c.t, kind: c.kind, out: L.admit(c.kind, c.t) })), throttled: L.throttled };
}

/** The pure bump limiter, driven with synthetic times: [{ t, intensity }] -> [{ t, out }] (out null = skipped). */
function bumpLimiterRun(calls) {
  const L = new I3.BumpLimiter();
  return { out: calls.map((c) => ({ t: c.t, in: c.intensity, out: L.admit(c.intensity, c.t) })), throttled: L.throttled };
}

window.AV = { ready: true, SR, renderVoice, renderCeremony, renderDuck, runEngineTests, runEngineTests3, runEngineOffline, renderMusic, renderMix, renderMusicBubbles, simulateMusic, composeOnly, bumpLimiterRun, cutLimiterRun, strandAmRange, consts: {
  TIERS: C.TIERS, CAPSULE_BUDGET_S: C.CAPSULE_BUDGET_S, MERGE_BUDGET_S: C.MERGE_BUDGET_S, PRE_ROLL_S: C.PRE_ROLL_S, REVEAL_DEFAULT_S: C.REVEAL_DEFAULT_S,
  MERGE_CHARGE_S: C.MERGE_CHARGE_S, MERGE_BURST_S: C.MERGE_BURST_S, BURST_GAP_S: C.BURST_GAP_S, CALM_SCALE: C.CALM_SCALE, MYTHIC_MOTIFS: C.MYTHIC_MOTIFS,
}, musicConsts: {
  BPM: M.MUSIC_BPM, BEAT_S: M.BEAT_S, BAR_S: M.BAR_S, SLOT_S: M.SLOT_S, SWING: M.SWING, MAX_LIVE_NOTES: M.MAX_LIVE_NOTES, LOOKAHEAD_S: M.LOOKAHEAD_S, TICK_MS: M.TICK_MS,
  FADE_IN_S: M.FADE_IN_S, FADE_OUT_S: M.FADE_OUT_S, PAUSE_FADE_S: M.PAUSE_FADE_S, FIRST_NOTE_S: M.FIRST_NOTE_S, DUCK_DB: M.DUCK_DB, DUCK_ATTACK_TC: M.DUCK_ATTACK_TC, DUCK_RELEASE_TC: M.DUCK_RELEASE_TC,
  ECHO_S: M.ECHO_S, MUSIC_DEFAULT: M.MUSIC_DEFAULT, MEL_LO: M.MEL_LO, MEL_HI: M.MEL_HI,
  ROOM_DB: M.ROOM_DB, ROOM_PAD_SHARE: M.ROOM_PAD_SHARE, ROOM_ATTACK_TC: M.ROOM_ATTACK_TC, ROOM_PAD_ATTACK_TC: M.ROOM_PAD_ATTACK_TC, ROOM_RETURN_S: M.ROOM_RETURN_S, ROOM_STEP_S: M.ROOM_STEP_S, ROOM_CLEAR_S: M.ROOM_CLEAR_S,
  ROOM_LEAD_S: M.ROOM_LEAD_S, ROOM_TAIL_S: M.ROOM_TAIL_S, HELD_ROOM_HOLD_S: M.HELD_ROOM_HOLD_S, ROOM_KINDS: M.ROOM_KINDS,
  SQUISH_ROOM_RATE: M.SQUISH_ROOM_RATE, SQUISH_ROOM_MIN_RATE: M.SQUISH_ROOM_MIN_RATE, STRAND_ROOM_T: M.STRAND_ROOM_T, STRAND_ROOM_MIN_T: M.STRAND_ROOM_MIN_T,
  FIELDS: M.FIELDS, FIELD_NEXT: M.FIELD_NEXT, FIELD_BARS: M.FIELD_BARS,
}, limiterConsts: { MIN_INTENSITY: I3.BumpLimiter.MIN_INTENSITY, MIN_GAP_S: I3.BumpLimiter.MIN_GAP_S, CAPACITY: I3.BumpLimiter.CAPACITY, REFILL_PER_S: I3.BumpLimiter.REFILL_PER_S, RECENT_S: I3.BumpLimiter.RECENT_S },
  strandConsts: { SILENCE_S: I3.STRAND_SILENCE_S, STOP_S: I3.STRAND_STOP_S },
  cutConsts: { FLAVOURS: CT.CUT_FLAVOURS, FAMILY_FLAVOUR: CT.FAMILY_FLAVOUR, REJOIN_RUN: CT.REJOIN_RUN, CALM_DB: CT.CUT_CALM_DB, SLICE: CT.CutLimiter.SLICE, POP: CT.CutLimiter.POP, REJOIN: CT.CutLimiter.REJOIN, ALL_GAP_S: CT.CutLimiter.ALL_GAP_S } };
window.AV.noteOnsets = (tier, durationS, calm, burst) => { const ti = C.tierIdx(tier); const lay = C.layout(ti, durationS, !!calm, !!burst); return { lay, onsets: C.noteOnsets(ti, lay) }; };

/* ───────────── human-facing sound lab (live engine) ───────────── */
const $ = (id) => document.getElementById(id);
const audio = createAudio();
const state = { amt: 0.7, pitch: 1 };
const hist = [];

async function unlock() { await audio.unlock(); sync(); }
function sync() {
  audio.setSettings({ master: +$('master').value, squishBoost: +$('boost').value, muted: $('mute').checked });
  state.amt = +$('amt').value; state.pitch = +$('pitch').value;
  audio.setMusic({ on: $('musicOn').checked, volume: +$('music').value });
  $('musicV').textContent = (+$('music').value).toFixed(2);
  $('pitchV').textContent = state.pitch.toFixed(2); $('amtV').textContent = state.amt.toFixed(2);
  $('masterV').textContent = (+$('master').value).toFixed(2); $('boostV').textContent = (+$('boost').value).toFixed(2);
}
for (const id of ['master', 'boost', 'mute', 'amt', 'pitch', 'musicOn', 'music']) $(id).addEventListener('input', sync);
$('musicOn').addEventListener('change', async () => { await unlock(); sync(); });
for (const b of document.querySelectorAll('button[data-r]')) {
  b.addEventListener('pointerdown', async () => {
    await unlock();
    const v = b.dataset.r;
    if (v === 'bump') audio.bump({ intensity: state.amt, pitch: state.pitch });
    else if (v === 'lift') audio.lift({ pitch: state.pitch });
    else if (v === 'toss') audio.toss({ speed: state.amt });
  });
}
{
  // strand: hold = stretch (tension rises over ~1.2 s, called every frame like the shell will), release = snap
  const el = $('strand');
  let held = false, t0 = 0;
  const loop = () => { if (!held) return; audio.strand({ tension: Math.min(1, (performance.now() - t0) / 1200), pitch: state.pitch }); requestAnimationFrame(loop); };
  el.addEventListener('pointerdown', async (e) => { await unlock(); el.setPointerCapture(e.pointerId); held = true; t0 = performance.now(); requestAnimationFrame(loop); });
  const up = () => { if (!held) return; held = false; audio.strand({ tension: Math.min(1, (performance.now() - t0) / 1200), snap: true, pitch: state.pitch }); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
{
  // cut and reconnect: a cut is the slice ('start') and, when the neck parts, the separation pop ('separate')
  const cv = () => ({ family: $('cutFam').value, frac: +$('frac').value, neckS: +$('neck').value, calm: $('cutCalm').checked });
  const upd = () => { $('fracV').textContent = (+$('frac').value).toFixed(2); $('neckV').textContent = (+$('neck').value).toFixed(2); };
  for (const id of ['frac', 'neck']) $(id).addEventListener('input', upd);
  for (const b of document.querySelectorAll('button[data-x]')) {
    b.addEventListener('pointerdown', async () => {
      await unlock();
      const p = cv(), v = b.dataset.x;
      if (v === 'cut') { audio.cut({ phase: 'start', ...p }); setTimeout(() => audio.cut({ phase: 'separate', ...p }), p.neckS * 1000); }
      else if (v === 'sep') audio.cut({ phase: 'separate', ...p });
      else if (v === 'rejoin') audio.rejoin({ frac: p.frac, calm: p.calm });
      else audio.rejoin({ frac: 1, all: true, calm: p.calm });
    });
  }
}
$('unlock').addEventListener('click', unlock);
for (const b of document.querySelectorAll('button[data-v]')) {
  b.addEventListener('pointerdown', async () => {
    await unlock();
    const v = b.dataset.v;
    if (v === 'poke') audio.poke({ intensity: state.amt, pitch: state.pitch });
    else if (v === 'release') audio.release({ compression: state.amt, pitch: state.pitch });
    else if (v === 'land') audio.land({ intensity: state.amt, pitch: state.pitch });
    else if (v === 'pop') audio.pop({ size: state.amt, pitch: state.pitch });
    else if (v === 'blend') audio.blend({ count: 3, durationS: 2.2 });
  });
}
{
  const tier = () => $('tier').value, variant = () => +$('variant').value, calm = () => $('calm').checked, up = () => $('tierUp').checked, nw = () => $('isNew').checked;
  let gp = 0;
  const later = (ms, fn) => setTimeout(fn, ms * (calm() ? C.CALM_SCALE : 1));
  const act = {
    meter: () => audio.meterFull({ quiet: calm() }),
    grab: () => audio.capsuleBeat({ beat: 'grab', progress: (gp = (gp + 0.17) % 1) }),
    crack: () => audio.capsuleBeat({ beat: 'crack' }),
    burst: () => audio.capsuleBeat({ beat: 'burst', tier: tier() }),
    reveal: () => audio.reveal({ tier: tier(), tierUp: up(), isNew: nw(), mythicVariant: variant(), calm: calm() }),
    duck: () => audio.duck({ db: -12, ms: 400 }),
    capsule: () => {
      const t = tier(), ti = C.tierIdx(t), pre = C.PRE_ROLL_S[ti] * 1000;
      audio.capsuleBeat({ beat: 'grab', progress: 0.1 });
      later(180, () => audio.capsuleBeat({ beat: 'grab', progress: 0.7 }));
      later(350, () => audio.capsuleBeat({ beat: 'crack' }));
      if (ti < 2) { later(650, () => audio.capsuleBeat({ beat: 'burst', tier: t })); later(1000, act.reveal); }
      else { later(650, act.reveal); later(650 + pre, () => audio.capsuleBeat({ beat: 'burst', tier: t })); }
    },
    merge: () => {
      const t = tier(), ti = C.tierIdx(t);
      const h = audio.mergeStart({ tier: t, calm: calm() });
      later(C.MERGE_CHARGE_S[ti] * 1000, () => h.burst({ tier: t, tierUp: up(), mythicVariant: variant() }));
    },
  };
  for (const b of document.querySelectorAll('button[data-c]')) b.addEventListener('pointerdown', async () => { await unlock(); act[b.dataset.c](); });
}
{
  let h = null, y0 = 0, lastY = 0, lastT = 0, comp = 0, rate = 0, raf = 0;
  const loop = () => {
    if (!h) return;
    h.update({ compression: comp, rate });
    rate *= 0.85;
    raf = requestAnimationFrame(loop);
  };
  const sq = $('squish');
  sq.addEventListener('pointerdown', async (e) => {
    await unlock();
    sq.setPointerCapture(e.pointerId);
    h = audio.squishStart({ pitch: state.pitch });
    y0 = lastY = e.clientY; lastT = performance.now(); comp = 0; rate = 0;
    audio.poke({ intensity: 0.5, pitch: state.pitch });
    raf = requestAnimationFrame(loop);
  });
  sq.addEventListener('pointermove', (e) => {
    if (!h) return;
    const now = performance.now();
    const nc = Math.min(1, Math.max(0, (e.clientY - y0) / 160));
    const dt = Math.max(0.004, (now - lastT) / 1000);
    rate = (nc - comp) / dt * 0.5 + rate * 0.5;
    comp = nc; lastT = now; lastY = e.clientY;
  });
  const up = () => {
    if (!h) return;
    const c = comp;
    h.end(0.06); h = null; cancelAnimationFrame(raf);
    if (c > 0.08) audio.release({ compression: c, pitch: state.pitch });
  };
  sq.addEventListener('pointerup', up);
  sq.addEventListener('pointercancel', up);
}
setInterval(() => {
  const s = audio.stats();
  hist.push(s.peak); if (hist.length > 140) hist.shift();
  $('state').textContent = s.state;
  $('out').textContent = JSON.stringify(s, null, 1);
  const cv = $('scope'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#59d6e6'; g.lineWidth = 2; g.beginPath();
  hist.forEach((p, i) => { const x = (i / 140) * cv.width, y = cv.height - Math.min(1, p) * (cv.height - 8) - 4; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
  g.strokeStyle = '#ff5a4d'; g.setLineDash([6, 6]); g.beginPath(); const yc = cv.height - 0.89 * (cv.height - 8) - 4; g.moveTo(0, yc); g.lineTo(cv.width, yc); g.stroke(); g.setLineDash([]);
}, 120);
sync();
document.addEventListener('visibilitychange', () => audio.setPaused?.(document.hidden));
