// The REAL engine (createAudio(), engine.ts) driven offline (audio-4 fix): an OfflineAudioContext stands in for the live
// context, the audio clock is stepped with suspend()/resume() at every display frame and at every scripted call, and the
// engine's timers (setInterval/setTimeout) and performance.now() are faked and locked to that clock. So the music
// scheduler, the room dips, the bump limiter and the held voices run exactly the code a player runs, sample-reproducibly,
// many times faster than real time. Adapted from the independent audio-3 verifier's driver.
// Output: three stems, each mono (L+R)/2: `mix` (the master output), `music` (chain.music's output: the music after its own
// room dips, slow duck and volume, before the shared limiter) and `fx` (the boost + plain inputs: every effect).
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
  class OAC extends OfflineAudioContext {
    constructor() { super(6, N, SR); theCtx = this; }
    get state() { return 'running'; }
    resume() { return Promise.resolve(); }
    // createMasterChain() makes boost, plain and music first: tap them for the stems
    createGain() { const g = super.createGain(); gainCount++; if (gainCount <= 3) taps[['boost', 'plain', 'music'][gainCount - 1]] = g; return g; }
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
  let errors = 0;
  try {
    audio = createAudio({ seed: spec.seed ?? 0x57a15b00 });
    audio.setSettings({ master: spec.master ?? 1, music: spec.music ?? 0.45 });
    if (spec.musicOn !== false) audio.setMusic({ on: true });
    await audio.unlock();
    window.AudioContext = orig.AC;
    const ctx = theCtx;
    ctx.destination.channelInterpretation = 'discrete';
    const merger = ctx.createChannelMerger(6);
    const sm = ctx.createChannelSplitter(2);
    taps.music.connect(sm); sm.connect(merger, 0, 2); sm.connect(merger, 1, 3);
    const fxSum = ctx.createGain();
    fxSum.channelCount = 2; fxSum.channelCountMode = 'explicit'; fxSum.channelInterpretation = 'speakers';
    taps.boost.connect(fxSum); taps.plain.connect(fxSum);
    const sf = ctx.createChannelSplitter(2);
    fxSum.connect(sf); sf.connect(merger, 0, 4); sf.connect(merger, 1, 5);
    merger.connect(ctx.destination);

    const qz = spec.quantum ?? Q;
    const qt = (t) => Math.max(Q, Math.round(Math.ceil(t / qz - 1e-9) * qz / Q) * Q);
    const evs = (spec.events ?? []).map((e, i) => ({ ...e, i, tq: qt(e.t) })).sort((a, b) => a.tq - b.tq || a.t - b.t || a.i - b.i);
    const frameHz = spec.frameHz ?? 60;
    const stops = new Set();
    for (let t = Q; t < secs - 0.02; t += 1 / frameHz) stops.add(Math.round(qt(t) / Q));
    for (const e of evs) if (e.tq < secs - 0.02) stops.add(Math.round(e.tq / Q));
    const times = [...stops].sort((a, b) => a - b).map((k) => k * Q);
    const handles = new Map();
    let ei = 0, lastStat = -1;
    const doEvent = (e) => {
      try {
        const a = e.a ?? {};
        switch (e.op) {
          case 'squishStart': handles.set(e.id, audio.squishStart(a)); break;
          case 'squishUpdate': { const h = handles.get(e.id); if (h) h.update(a); break; }
          case 'squishEnd': { const h = handles.get(e.id); if (h) h.end(a.fade); handles.delete(e.id); break; }
          default: audio[e.op](a);
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
          statLog.push([+t.toFixed(4), d.music.ducked ? 1 : 0, d.music.liveNotes, s.liveNodes, s.live, d.music.sessions]);
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
  return { sr: SR, n: buf.length, stems, errors, statLog, final: { music: d.music, throttled: d.throttled, stats: s } };
}
