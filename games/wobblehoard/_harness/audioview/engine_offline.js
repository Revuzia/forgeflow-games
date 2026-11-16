// The REAL engine (createAudio(), engine.ts) driven offline (audio-4 fix): an OfflineAudioContext stands in for the live
// context, the audio clock is stepped with suspend()/resume() at every display frame and at every scripted call, and the
// engine's timers (setInterval/setTimeout) and performance.now() are faked and locked to that clock. So the music
// scheduler, the room dips, the bump limiter and the held voices run exactly the code a player runs, sample-reproducibly,
// many times faster than real time. Adapted from the independent audio-3 verifier's driver.
// Output: three stems, each mono (L+R)/2: `mix` (the master output), `music` (chain.music's output: the music after its own
// room dips, slow duck and volume, before the shared limiter) and `fx` (the boost + plain inputs: every effect).
// PLAYGROUND (PG_AUDIO): with spec.taps the 4th and 5th createGain() calls (chain.ts: chatter, ambience) are tapped too, as stems
// `chatter` and `ambience` (the context then has 10 channels; without spec.taps it is exactly as before, so AU-07's renders are
// unchanged). Ops for the life checks: `creature` (a.phrase as a plain array becomes a Float32Array), `creatureMut` (creature(a), then
// the SAME object and phrase array are scrambled at once: AU-11), `singNextBar` (musicClock, then a sung phrase at the next bar line:
// AU-08). spec.recordReturns keeps every call's return value and musicClock reading in `rets`.
import { createAudio } from '/src/audio/engine.ts';

const SR = 48000;
const Q = 128 / SR;

function b64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * spec: { secs, seed, master (1), music (volume, 0.45), musicOn (true), frameHz (60: when the clock stops even without a
 *   call), quantum (s: the audio-clock grid the calls see, default one render quantum), want (['mix','music','fx']),
 *   events: [{ t, op, a, id }] } with op one of the SquishAudio one-shots (poke, pop, land, bump, lift, toss, release, strand,
 *   blend, meterFull, capsuleBeat, reveal, setMusic, setPaused, ...) or squishStart / squishUpdate / squishEnd (by `id`).
 * Returns { sr, n, stems (base64 Float32), errors, final: { music, throttled, stats }, statLog: [[t, ducked, liveNotes,
 *   liveNodes, live, sessions], ...] every 50 ms }.
 */
export async function runEngineOffline(spec) {
  const secs = spec.secs;
  const N = Math.ceil(secs * SR);
  let fakeMs = 1000;
  const timers = new Map();
  let nid = 1;
  const orig = { si: window.setInterval, ci: window.clearInterval, st: window.setTimeout, ct: window.clearTimeout, pn: performance.now, AC: window.AudioContext };
  let theCtx = null;
  let gainCount = 0;
  const taps = {};
  const NCH = spec.taps ? 10 : 6;
  class OAC extends OfflineAudioContext {
    constructor() { super(NCH, N, SR); theCtx = this; }
    get state() { return 'running'; }
    resume() { return Promise.resolve(); }
    // createMasterChain() makes boost, plain and music first (PLAYGROUND: then chatter and ambience): tap them for the stems
    createGain() { const g = super.createGain(); gainCount++; if (gainCount <= 5) taps[['boost', 'plain', 'music', 'chatter', 'ambience'][gainCount - 1]] = g; return g; }
  }
  const runTimers = (to) => {
    for (let guard = 0; guard < 100000; guard++) {
      let best = null, bid = 0;
      for (const [id, t] of timers) if (t.at <= to && (!best || t.at < best.at)) { best = t; bid = id; }
      if (!best) break;
      if (best.rep) best.at += best.ms; else timers.delete(bid);
      try { best.fn(); } catch (e) { console.error('timer', e); }
    }
  };
  window.setInterval = (fn, ms) => { const id = nid++; const p = Math.max(1, +ms || 0); timers.set(id, { fn, ms: p, at: fakeMs + p, rep: true }); return id; };
  window.setTimeout = (fn, ms) => { const id = nid++; timers.set(id, { fn, ms: 0, at: fakeMs + Math.max(0, +ms || 0), rep: false }); return id; };
  window.clearInterval = (id) => { timers.delete(id); };
  window.clearTimeout = (id) => { timers.delete(id); };
  performance.now = () => fakeMs;
  window.AudioContext = OAC;
  let audio, buf;
  const statLog = [];
  const rets = [];
  let errors = 0;
  try {
    audio = createAudio({ seed: spec.seed ?? 0x57a15b00 });
    audio.setSettings({ master: spec.master ?? 1, music: spec.music ?? 0.45 });
    if (spec.musicOn !== false) audio.setMusic({ on: true });
    await audio.unlock();
    window.AudioContext = orig.AC;
    const ctx = theCtx;
    ctx.destination.channelInterpretation = 'discrete';
    const merger = ctx.createChannelMerger(NCH);
    const sm = ctx.createChannelSplitter(2);
    taps.music.connect(sm); sm.connect(merger, 0, 2); sm.connect(merger, 1, 3);
    const fxSum = ctx.createGain();
    fxSum.channelCount = 2; fxSum.channelCountMode = 'explicit'; fxSum.channelInterpretation = 'speakers';
    taps.boost.connect(fxSum); taps.plain.connect(fxSum);
    const sf = ctx.createChannelSplitter(2);
    fxSum.connect(sf); sf.connect(merger, 0, 4); sf.connect(merger, 1, 5);
    if (spec.taps) {
      // through an explicitly stereo gain (like fxSum): a mono voice is upmixed L = R, so the stem's (L + R) / 2 is its true level
      for (const [k, ch] of [['chatter', 6], ['ambience', 8]]) {
        const st = ctx.createGain(); st.channelCount = 2; st.channelCountMode = 'explicit'; st.channelInterpretation = 'speakers';
        const sp = ctx.createChannelSplitter(2); taps[k].connect(st); st.connect(sp); sp.connect(merger, 0, ch); sp.connect(merger, 1, ch + 1);
      }
    }
    merger.connect(ctx.destination);
    // PLAYGROUND: a place's ambience bed from the start (the away chunk and the place recipe are imported now, in real time)
    if (spec.ambience) { await audio.loadAmbience(spec.ambience); audio.setAmbience({ place: spec.ambience, on: true }); }
    // PLAYGROUND: unlock() started the lazy import of life_voices.ts; give it real time to arrive before the clock starts
    if (spec.preload) { for (let k = 0; k < 40; k++) await new Promise((r) => orig.st.call(window, r, 10)); }

    const qz = spec.quantum ?? Q;
    const qt = (t) => Math.max(Q, Math.round(Math.ceil(t / qz - 1e-9) * qz / Q) * Q);
    const evs = (spec.events ?? []).map((e, i) => ({ ...e, i, tq: qt(e.t) })).sort((a, b) => a.tq - b.tq || a.t - b.t || a.i - b.i);
    const frameHz = spec.frameHz ?? 60;
    const stops = new Set();
    for (let t = Q; t < secs - 0.02; t += 1 / frameHz) stops.add(Math.round(qt(t) / Q));
    for (const e of evs) if (e.tq < secs - 0.02) stops.add(Math.round(e.tq / Q));
    const times = [...stops].sort((a, b) => a - b).map((k) => k * Q);
    const handles = new Map();
    const clock = new Float64Array(5);
    const f32 = (a) => (a && Array.isArray(a.phrase) ? { ...a, phrase: Float32Array.from(a.phrase) } : a);
    let ei = 0, lastStat = -1;
    const doEvent = (e) => {
      try {
        const a = f32(e.a ?? {});
        switch (e.op) {
          case 'creature': { const r = audio.creature(a); if (spec.recordReturns) rets.push([e.t, 'creature', r]); break; }
          case 'creatureMut': {
            const r = audio.creature(a);
            a.phrase.fill(0); a.phrase[0] = 5; a.phrase[3] = 2; a.n = 4; a.pitch = 2; a.level = 1; a.flavour = 5; a.pan = -1; a.at = 0; a.echo = true; a.group = 3;
            if (spec.recordReturns) rets.push([e.t, 'creatureMut', r]);
            break;
          }
          case 'clock': { const ok = audio.musicClock(clock); rets.push([e.t, 'clock', ok, clock[0], clock[1], ctx.currentTime]); break; }
          case 'touch': audio.setTouching(!!a.on); break;
          case 'singNextBar': {
            const ok = audio.musicClock(clock);
            const now = ctx.currentTime;
            const at = ok ? clock[1] + Math.ceil((now + 0.05 - clock[1]) / (8 * clock[4]) - 1e-9) * (8 * clock[4]) : now + 0.05;
            const r = audio.creature({ ...a, at, sing: true });
            if (spec.recordReturns) rets.push([e.t, 'sing', r, ok, at, clock[0], clock[1], clock[4], now]);
            break;
          }
          case 'squishStart': handles.set(e.id, audio.squishStart(a)); break;
          case 'squishUpdate': { const h = handles.get(e.id); if (h) h.update(a); break; }
          case 'squishEnd': { const h = handles.get(e.id); if (h) h.end(a.fade); handles.delete(e.id); break; }
          default: { const r = audio[e.op](a); if (spec.recordReturns) rets.push([e.t, e.op, r === undefined ? null : r]); }
        }
      } catch (err) { errors++; console.error(e.op, err); }
    };
    for (const t of times) {
      ctx.suspend(t).then(() => {
        fakeMs = 1000 + t * 1000;
        runTimers(fakeMs);
        while (ei < evs.length && evs[ei].tq <= t + 1e-9) { fakeMs = 1000 + Math.max(evs[ei].t, 0) * 1000; doEvent(evs[ei++]); }
        fakeMs = 1000 + t * 1000;
        if (t - lastStat >= 0.05) {
          lastStat = t;
          const d = audio.detailStats(), s = audio.stats();
          statLog.push([+t.toFixed(4), d.music.ducked ? 1 : 0, d.music.liveNotes, s.liveNodes, s.live, d.music.sessions, (s.liveKinds && s.liveKinds.creature) || 0]);
        }
        OfflineAudioContext.prototype.resume.call(ctx);
      });
    }
    buf = await ctx.startRendering();
  } finally {
    window.setInterval = orig.si; window.clearInterval = orig.ci; window.setTimeout = orig.st; window.clearTimeout = orig.ct; performance.now = orig.pn;
    window.AudioContext = orig.AC;
  }
  const mono = (a, b) => { const x = buf.getChannelData(a), y = buf.getChannelData(b); const o = new Float32Array(x.length); for (let i = 0; i < o.length; i++) o[i] = 0.5 * (x[i] + y[i]); return o; };
  const d = audio.detailStats(), s = audio.stats();
  try { audio.dispose(); } catch { /* offline context: close() rejects */ }
  const want = spec.want ?? ['mix', 'music', 'fx'];
  const stems = {};
  if (want.includes('mix')) stems.mix = b64(mono(0, 1));
  if (want.includes('music')) stems.music = b64(mono(2, 3));
  if (want.includes('fx')) stems.fx = b64(mono(4, 5));
  if (spec.taps && want.includes('chatter')) stems.chatter = b64(mono(6, 7));
  if (spec.taps && want.includes('ambience')) stems.ambience = b64(mono(8, 9));
  return { sr: SR, n: buf.length, stems, errors, statLog, final: { music: d.music, throttled: d.throttled, stats: s }, rets: spec.recordReturns ? rets : undefined };
}
