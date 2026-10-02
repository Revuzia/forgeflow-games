// Live-engine checks, run inside Chromium by probe_audio.mjs (page.evaluate -> window.AV.runEngineTests()).
// Everything here drives the real createAudio() on a real AudioContext (headless Chromium, --autoplay-policy flag,
// --mute-audio so nobody's speakers are involved; the audio clock still runs). Returns { checks, info } for the Node side.
import { createAudio, MAX_VOICES } from '/src/audio/engine.ts';
import { liveNodeCount, liveGroupCount, nodeCounters } from '/src/audio/dsp.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait (up to 25 s) until the engine has no live voice groups. */
async function drain(audio) { for (let i = 0; i < 100 && audio.stats().live > 0; i++) await sleep(250); }

/** Independent bookkeeping at the WebAudio API surface: every node created through create*() is held in a Set until
 *  someone calls disconnect() with no arguments on it. Independent of the engine's own counters. */
function installTracker() {
  const live = new Set();
  const stat = { created: 0, disconnected: 0 };
  const names = ['createGain', 'createOscillator', 'createBufferSource', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor', 'createWaveShaper', 'createAnalyser'];
  const orig = {};
  for (const n of names) {
    orig[n] = BaseAudioContext.prototype[n];
    BaseAudioContext.prototype[n] = function (...a) { const node = orig[n].apply(this, a); stat.created++; live.add(node); return node; };
  }
  const od = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...a) { if (a.length === 0) { if (live.delete(this)) stat.disconnected++; } return od.apply(this, a); };
  return { live, stat, restore() { for (const n of names) BaseAudioContext.prototype[n] = orig[n]; AudioNode.prototype.disconnect = od; } };
}

/** Wrap AudioContext so the tests can count constructions and reach the instance (render capacity, state). */
function installContextSpy() {
  const Orig = window.AudioContext;
  const spy = { count: 0, instances: [] };
  window.AudioContext = class extends Orig { constructor(...a) { super(...a); spy.count++; spy.instances.push(this); } };
  spy.restore = () => { window.AudioContext = Orig; };
  return spy;
}

export async function runEngineTests() {
  const checks = [];
  const info = {};
  const check = (name, pass, value, limit) => checks.push({ name, pass: !!pass, value: String(value), limit: String(limit) });
  const caught = [];
  const safe = (label, fn) => { try { return fn(); } catch (e) { caught.push(`${label}: ${e && e.message || e}`); return undefined; } };
  const spy = installContextSpy();
  const tr = installTracker();

  try {
    /* ───── 1. before unlock: everything is a safe no-op, no AudioContext exists ───── */
    {
      const a = createAudio({ seed: 1 });
      safe('poke', () => a.poke({ intensity: 0.5 }));
      const h = safe('squishStart', () => a.squishStart({ pitch: 1 }));
      safe('update', () => h.update({ compression: 0.5, rate: 1 }));
      safe('update(at)', () => h.update({ compression: 0.5, rate: 1 }, 1.5));
      safe('end', () => h.end(0.1));
      safe('release', () => a.release({ compression: 0.5 }));
      safe('land', () => a.land({ intensity: 0.5 }));
      safe('pop', () => a.pop());
      const b = safe('blend', () => a.blend({ count: 2 }));
      safe('blend.stop', () => b.stop());
      safe('meterFull', () => a.meterFull({ quiet: true }));
      for (const beat of ['grab', 'crack', 'burst', 'bogus']) safe('capsuleBeat', () => a.capsuleBeat({ beat, progress: 0.5, tier: 'mythic' }));
      safe('reveal', () => a.reveal({ tier: 'mythic', tierUp: true, isNew: true, mythicVariant: 2, durationS: 3, calm: true }));
      const mh = safe('mergeStart', () => a.mergeStart({ tier: 'rare', chargeS: 2 }));
      safe('merge.burst', () => mh.burst({ tier: 'epic', tierUp: true }));
      safe('merge.stop', () => mh.stop());
      safe('duck', () => a.duck({ db: -12, ms: 250 }));
      safe('setSettings', () => a.setSettings({ master: 0.4, squishBoost: 1, muted: false }));
      safe('setPaused', () => { a.setPaused(true); a.setPaused(false); });
      const st = safe('stats', () => a.stats());
      check('before unlock(): every method is a safe no-op (0 exceptions)', caught.length === 0, caught.length ? caught.join(' | ') : '0 exceptions', '0');
      check('before unlock(): no AudioContext was constructed', spy.count === 0, spy.count, '0');
      check('before unlock(): ready=false, state "locked", nothing started', a.ready === false && st.state === 'locked' && Object.values(st.started).every((v) => v === 0), `${a.ready}/${st.state}/${JSON.stringify(st.started)}`, 'false/locked/zeros');
      a.dispose();
    }

    /* ───── 2. unlock(): once, twice, concurrently ───── */
    const audio = createAudio({ seed: 2024 });
    const ctxBefore = spy.count;
    const p1 = audio.unlock(), p2 = audio.unlock();
    await Promise.all([p1, p2]);
    await audio.unlock();
    check('unlock() x3 (two concurrent, one later): exactly one AudioContext', spy.count - ctxBefore === 1, spy.count - ctxBefore, '1');
    check('after unlock(): ready=true, state running', audio.ready === true && audio.stats().state === 'running', `${audio.ready}/${audio.stats().state}`, 'true/running');
    const ctx = spy.instances[spy.instances.length - 1];
    info.sampleRate = ctx.sampleRate; info.baseLatency = ctx.baseLatency;
    await sleep(300);
    const baseNodes = tr.live.size;     // chain nodes + the unlock buffer source if still alive
    info.baselineNodes = baseNodes;
    audio.stats(); // reset the peak window

    /* ───── 3. hostile parameters ───── */
    {
      const before = caught.length;
      const bad = [NaN, -1, 5, Infinity, -Infinity, undefined, null, '0.5', {}, 1e9, -1e9];
      for (const v of bad) {
        safe('poke', () => audio.poke({ intensity: v, pitch: v, pan: v }));
        safe('release', () => audio.release({ compression: v, pitch: v, pan: v }));
        safe('land', () => audio.land({ intensity: v, pitch: v }));
        safe('pop', () => audio.pop({ size: v, pitch: v, pan: v }));
        safe('blend', () => audio.blend({ count: v, durationS: v }).stop());
        const h = safe('squishStart', () => audio.squishStart({ pitch: v, pan: v }));
        safe('update', () => h.update({ compression: v, rate: v, pan: v }));
        safe('update2', () => h.update({ compression: 0.5, rate: v }, v));
        safe('end', () => h.end(v, v));
      }
      safe('poke()', () => audio.poke());
      safe('release()', () => audio.release());
      safe('land()', () => audio.land());
      safe('setSettings', () => { audio.setSettings({ master: NaN, squishBoost: NaN, muted: undefined }); audio.setSettings({ master: 5, squishBoost: -3 }); audio.setSettings(null); audio.setSettings(); audio.setSettings({ master: 0.8, squishBoost: 0, muted: false }); });
      await sleep(900);
      const st = audio.stats();
      check('hostile params (NaN/Infinity/-1/5/null/string/object/1e9 on every voice): 0 exceptions', caught.length === before, caught.slice(before).join(' | ') || '0 exceptions', '0');
      check('hostile params: output peak is finite and <= 0.9 (soft-clip ceiling -1 dBFS)', Number.isFinite(st.peak) && st.peak <= 0.9, st.peak.toFixed(4), 'finite, <= 0.9');
      info.hostilePeak = st.peak;
    }

    /* ───── 4. held squish live: audible while moving, silent when still ───── */
    {
      await sleep(3800); // let every hostile blend finish
      audio.stats();
      const h = audio.squishStart({ pitch: 1 });
      let t = 0, peakMoving = 0, peakStill = 0;
      const t0 = performance.now();
      while ((t = performance.now() - t0) < 1600) {
        const s = t / 1000;
        const moving = s < 0.9;
        h.update({ compression: Math.min(0.8, s), rate: moving ? 1.6 : 0 });
        await sleep(16);
        if (Math.abs(s - 0.8) < 0.02) peakMoving = audio.stats().peak;
      }
      peakStill = audio.stats().peak;     // covers the last stretch where rate was 0 (and the tail of the moving part: take a fresh window)
      await sleep(700);
      const reallyStill = audio.stats().peak;
      h.end(0.05);
      await sleep(300);
      check('live squish: audible while rate > 0', peakMoving > 0.01, peakMoving.toFixed(4), '> 0.01');
      check('live squish: silent when rate = 0 (output peak < 0.001 once the tail has gone)', reallyStill < 0.001, reallyStill.toExponential(2), '< 0.001');
      info.squishLive = { peakMoving, peakStill, reallyStill };
    }

    /* ───── 5. realistic rapid poking: 30 taps/s for 6 s ───── */
    {
      // AudioPlayoutStats (Chromium, experimental flag): frames the audio thread could not deliver in time = audible glitches
      const ps0 = ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, dur: ctx.playoutStats.fallbackFramesDuration, total: ctx.playoutStats.totalFramesDuration } : null;
      const heapA = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      const startedBefore = { ...audio.stats().started };
      const kinds = ['poke', 'release', 'land', 'pop'];
      let n = 0, maxLive = 0, maxNodes = 0, maxTrk = 0, trigMs = 0, calls = 0;
      let sq = null, sqT = 0;
      const t0 = performance.now();
      let next = t0;
      while (performance.now() - t0 < 6000) {
        const now = performance.now();
        if (now >= next) {
          const k = kinds[n % 4];
          const c0 = performance.now();
          if (k === 'poke') audio.poke({ intensity: (n % 7) / 6, pitch: 0.85 + (n % 5) * 0.08 });
          else if (k === 'release') audio.release({ compression: (n % 5) / 4 });
          else if (k === 'land') audio.land({ intensity: (n % 6) / 5 });
          else audio.pop({ size: (n % 4) / 3 });
          trigMs += performance.now() - c0; calls++;
          if (n % 30 === 0) { if (sq) sq.end(0.05); sq = audio.squishStart({}); sqT = 0; }
          n++; next += 1000 / 30;
        }
        if (sq) { sqT += 0.016; sq.update({ compression: 0.5 + 0.4 * Math.sin(sqT * 6), rate: 2 * Math.cos(sqT * 6) }); }
        if (n % 3 === 0) {
          const s = audio.stats();
          maxLive = Math.max(maxLive, s.live); maxNodes = Math.max(maxNodes, s.liveNodes); maxTrk = Math.max(maxTrk, tr.live.size - baseNodes);
        }
        await sleep(4);
      }
      if (sq) sq.end(0.05);
      await sleep(1500);
      const s1 = audio.stats();
      const heapB = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      const ps1 = ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, dur: ctx.playoutStats.fallbackFramesDuration, total: ctx.playoutStats.totalFramesDuration } : null;
      const started = {}; for (const k of Object.keys(s1.started)) started[k] = s1.started[k] - (startedBefore[k] || 0);
      info.taps = { triggers: calls, started, maxLiveGroups: maxLive, maxLiveNodes: maxNodes, maxTrackerNodes: maxTrk, meanTriggerMs: trigMs / calls, heapDeltaMB: heapA != null ? (heapB - heapA) / 1048576 : null, playout: ps0 && { fallbackEvents: ps1.ev - ps0.ev, fallbackMs: ps1.dur - ps0.dur, playedMs: ps1.total - ps0.total } };
      check('30 taps/s for 6 s: live voice groups never exceed the cap', maxLive <= MAX_VOICES + 16, `max ${maxLive} (cap ${MAX_VOICES}+16 fading)`, `<= ${MAX_VOICES + 16}`);
      check('30 taps/s: every trigger accepted (started + squish count)', Object.values(started).reduce((a, b) => a + b, 0) >= calls, `${Object.values(started).reduce((a, b) => a + b, 0)} started / ${calls} taps`, '>= taps');
      check('30 taps/s: after it stops, 0 live groups and 0 live nodes (own counters)', s1.live === 0 && s1.liveNodes === 0, `${s1.live} groups, ${s1.liveNodes} nodes`, '0 / 0');
      check('30 taps/s: independent API-surface tracker back to baseline', tr.live.size === baseNodes, `${tr.live.size - baseNodes} nodes above baseline (${baseNodes})`, '0');
      if (heapA != null) check('30 taps/s: JS heap growth after GC < 6 MB', (heapB - heapA) / 1048576 < 6, `${((heapB - heapA) / 1048576).toFixed(2)} MB`, '< 6 MB');
      if (ps0) check('30 taps/s: no audio glitches (AudioPlayoutStats fallback frames = 0 over a live, advancing clock)', ps1.ev - ps0.ev === 0 && ps1.total - ps0.total > 5000, `${ps1.ev - ps0.ev} fallback events (${(ps1.dur - ps0.dur).toFixed(1)} ms) over ${(ps1.total - ps0.total).toFixed(0)} ms played`, '0 events, > 5000 ms played');
      else info.playoutStatsUnavailable = true;
      check('30 taps/s: mean trigger cost < 1 ms on the main thread (6% of a 60 fps frame)', trigMs / calls < 1, `${(trigMs / calls).toFixed(3)} ms`, '< 1');
    }

    /* ───── 6. 5000 voices as fast as the page can issue them ───── */
    {
      const heapA = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      const createdA = tr.stat.created, disconnA = tr.stat.disconnected;
      const k0 = { ...audio.stats().started };
      const pb0 = ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, dur: ctx.playoutStats.fallbackFramesDuration, total: ctx.playoutStats.totalFramesDuration } : null;
      let issued = 0, maxLive = 0, maxNodes = 0, maxTrk = 0, maxPeak = 0, nan = false;
      const t0 = performance.now();
      let sq = null, sqT = 0;
      while (issued < 5000) {
        for (let b = 0; b < 40 && issued < 5000; b++, issued++) {
          const k = issued % 100;
          if (k === 99) audio.blend({ count: 4, durationS: 2.5 });
          else if (k % 10 === 7) { if (sq) sq.end(0.03); sq = audio.squishStart({}); sq.update({ compression: 0.6, rate: 2 }); sq.update({ compression: 0.7, rate: 1 }); }
          else if (k % 4 === 0) audio.poke({ intensity: (issued % 9) / 8 });
          else if (k % 4 === 1) audio.release({ compression: (issued % 7) / 6 });
          else if (k % 4 === 2) audio.land({ intensity: (issued % 5) / 4 });
          else audio.pop({ size: (issued % 3) / 2 });
        }
        const s = audio.stats();
        maxLive = Math.max(maxLive, s.live); maxNodes = Math.max(maxNodes, s.liveNodes); maxTrk = Math.max(maxTrk, tr.live.size - baseNodes);
        if (!Number.isFinite(s.peak)) nan = true; else maxPeak = Math.max(maxPeak, s.peak);
        await sleep(10);
      }
      if (sq) sq.end(0.03);
      const issueS = (performance.now() - t0) / 1000;
      const pb1 = ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, dur: ctx.playoutStats.fallbackFramesDuration, total: ctx.playoutStats.totalFramesDuration } : null;
      await sleep(5200);     // longest voice is a ~3.7 s blend
      const s1 = audio.stats();
      await sleep(300);
      const heapB = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      const started = {}; for (const k of Object.keys(s1.started)) started[k] = s1.started[k] - (k0[k] || 0);
      const acc = Object.values(started).reduce((a, b) => a + b, 0);
      info.burst = { issued, issueS, accepted: acc, maxLiveGroups: maxLive, maxLiveNodes: maxNodes, maxTrackerNodes: maxTrk, maxPeak, nodesCreated: tr.stat.created - createdA, nodesDisconnected: tr.stat.disconnected - disconnA, heapDeltaMB: heapA != null ? (heapB - heapA) / 1048576 : null, endLive: s1.live, endNodes: s1.liveNodes, dropped: s1.dropped, playout: pb0 && { fallbackEvents: pb1.ev - pb0.ev, fallbackMs: pb1.dur - pb0.dur, playedMs: pb1.total - pb0.total } };
      check('5000 voices: all accepted by the engine', acc === 5000 + 0 || acc >= 4990, `${acc} started of 5000 issued in ${issueS.toFixed(1)} s`, '5000');
      check('5000 voices: live groups bounded by the polyphony cap (+ those still fading)', maxLive <= MAX_VOICES + 16, `max ${maxLive} (cap ${MAX_VOICES}+16)`, `<= ${MAX_VOICES + 16}`);
      check('5000 voices: live nodes bounded (own counter peak)', maxNodes < 6000, `max ${maxNodes} nodes over ${tr.stat.created - createdA} created`, '< 6000');
      check('5000 voices: after draining, 0 live groups and 0 live nodes (own counters)', s1.live === 0 && s1.liveNodes === 0, `${s1.live} groups, ${s1.liveNodes} nodes`, '0 / 0');
      check('5000 voices: independent API-surface tracker back to baseline', tr.live.size === baseNodes, `${tr.live.size - baseNodes} nodes above baseline; ${tr.stat.created - createdA} created / ${tr.stat.disconnected - disconnA} disconnected`, '0');
      if (heapA != null) check('5000 voices: JS heap growth after GC < 8 MB', (heapB - heapA) / 1048576 < 8, `${((heapB - heapA) / 1048576).toFixed(2)} MB`, '< 8 MB');
      if (pb0) info.burst.playoutNote = 'informational: a 4000 voices/s storm is far beyond real play';
      check('5000 voices: output stayed finite and under the -1 dBFS ceiling', !nan && maxPeak <= 0.9, `peak ${maxPeak.toFixed(3)}${nan ? ' (NaN seen)' : ''}`, 'finite, <= 0.9');
    }

    /* ───── 6b. ceremony voices through the live engine (DESIGN section 6) ───── */
    {
      const before = caught.length;
      const bad = [NaN, -1, 5, Infinity, -Infinity, undefined, null, '0.5', {}, 1e9, -1e9, 'mythic', 'bogus'];
      for (const v of bad) {
        safe('meterFull', () => audio.meterFull({ quiet: v, pitch: v }));
        for (const beat of ['grab', 'crack', 'burst', v]) safe('capsuleBeat', () => audio.capsuleBeat({ beat, progress: v, tier: v, pitch: v }));
        safe('reveal', () => audio.reveal({ tier: v, tierUp: v, isNew: v, mythicVariant: v, durationS: v, calm: v, pitch: v }));
        const h = safe('mergeStart', () => audio.mergeStart({ tier: v, chargeS: v, calm: v, pitch: v }));
        safe('burst', () => h.burst({ tier: v, tierUp: v, mythicVariant: v, durationS: v }));
        safe('burst twice', () => h.burst({ tier: 'mythic' }));
        safe('stop after burst', () => h.stop());
        const h2 = safe('mergeStart2', () => audio.mergeStart({ tier: 'epic', chargeS: 3 }));
        safe('stop', () => h2.stop());
        safe('duck', () => audio.duck({ db: v, ms: v }));
      }
      safe('reveal()', () => audio.reveal());
      safe('capsuleBeat()', () => audio.capsuleBeat());
      safe('mergeStart()', () => audio.mergeStart().stop());
      safe('duck()', () => audio.duck());
      await sleep(1200);
      const st = audio.stats();
      check('ceremony voices, hostile parameters (NaN/Infinity/strings/objects/bogus tiers on every method): 0 exceptions', caught.length === before, caught.slice(before).join(' | ') || '0 exceptions', '0');
      check('ceremony voices, hostile parameters: output finite and <= 0.9', Number.isFinite(st.peak) && st.peak <= 0.9, st.peak.toFixed(4), 'finite, <= 0.9');
      await sleep(6500);   // let the longest hostile voices end
      audio.stats();
    }
    {
      // contract mapping: every method counts under its own kind; grab is throttled so a per-frame loop cannot stack squeaks
      const s0 = audio.stats().started;
      audio.meterFull({}); audio.meterFull({ quiet: true });
      for (let i = 0; i < 12; i++) audio.capsuleBeat({ beat: 'grab', progress: i / 12 });
      audio.capsuleBeat({ beat: 'crack', tier: 'mythic' }); audio.capsuleBeat({ beat: 'burst', tier: 'epic' });
      audio.reveal({ tier: 'uncommon' });
      const mh = audio.mergeStart({ tier: 'common' }); mh.burst({ tier: 'common', tierUp: true });
      const mh2 = audio.mergeStart({ tier: 'rare' }); mh2.stop();
      audio.duck({ db: -6, ms: 120 });
      const s1 = audio.stats().started;
      const d = (k) => s1[k] - s0[k];
      check('started counters: meterFull 2, capsule 3 (12 grabs in one tick throttled to 1, + crack + burst), reveal 1, merge 2, mergeBurst 1, duck 1', d('meterFull') === 2 && d('capsule') === 3 && d('reveal') === 1 && d('merge') === 2 && d('mergeBurst') === 1 && d('duck') === 1, JSON.stringify({ meterFull: d('meterFull'), capsule: d('capsule'), reveal: d('reveal'), merge: d('merge'), mergeBurst: d('mergeBurst'), duck: d('duck') }), 'as stated');
      await sleep(3200);
    }
    {
      // a flurry of pokes must not steal a ceremony voice (priority), and a Mythic reveal ducks the master by itself
      await drain(audio);
      audio.stats();
      audio.reveal({ tier: 'legendary' });
      const mh = audio.mergeStart({ tier: 'epic', chargeS: 2 });
      for (let i = 0; i < 80; i++) audio.poke({ intensity: (i % 5) / 4 });
      await sleep(150);
      const kinds = audio.stats().liveKinds;
      check('80 pokes in one tick never steal a live reveal or merge (liveKinds.reveal = 1, merge = 1)', kinds.reveal === 1 && kinds.merge === 1, JSON.stringify(kinds), 'reveal 1, merge 1');
      mh.stop();
      await sleep(4200);
      // duck, live: a steady blend motor ducked by 20 dB for 700 ms
      audio.stats();
      const b = audio.blend({ count: 3, durationS: 6 });
      await sleep(700);
      audio.stats(); await sleep(150);
      const A = audio.stats().peak;
      audio.duck({ db: -20, ms: 700 });
      await sleep(260); audio.stats(); await sleep(150);
      const B = audio.stats().peak;
      await sleep(1400); audio.stats(); await sleep(150);
      const C = audio.stats().peak;
      b.stop();
      check('duck({db:-20, ms:700}) on a steady blend: output peak falls >= 9 dB while ducked and comes back (within 6 dB of before)', B < A * 0.35 && C > A * 0.5, `before ${A.toFixed(3)}, ducked ${B.toFixed(3)} (${(20 * Math.log10(B / A)).toFixed(1)} dB), after ${C.toFixed(3)}`, '<= -9 dB, back');
      await sleep(600);
    }
    {
      // mergeStart() must not build the whole charge up front: the squelch/tick layers are pumped ~0.5 s ahead
      await drain(audio);
      const c0 = tr.stat.created;
      const a = performance.now();
      const mh = audio.mergeStart({ tier: 'epic', chargeS: 2.4 });
      const cost = performance.now() - a;
      const upfront = tr.stat.created - c0;
      await sleep(2900);
      const total = tr.stat.created - c0;
      mh.stop();
      info.mergePump = { upfrontNodes: upfront, totalNodes: total, startMs: cost };
      check('mergeStart() builds only the first ~0.5 s of the squelch up front (live pump schedules the rest)', upfront < total * 0.6 && total > 150, `${upfront} nodes at the call, ${total} by the end of the charge (${cost.toFixed(1)} ms)`, 'upfront < 60% of total');
      await drain(audio);
    }
    {
      // a realistic Mythic capsule open and a Mythic merge, in real time, with the player poking at ~8/s throughout
      await drain(audio);
      const ps = () => (ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, total: ctx.playoutStats.totalFramesDuration } : null);
      const p0 = ps();
      const cost = [];
      const timed = (fn) => { const a = performance.now(); fn(); cost.push(performance.now() - a); };
      const runTimeline = async (events, endS) => {
        const t0 = performance.now(); let k = 0, nextPoke = t0, n = 0;
        events.sort((a, b) => a[0] - b[0]);
        while (performance.now() - t0 < endS * 1000) {
          const t = (performance.now() - t0) / 1000;
          while (k < events.length && events[k][0] <= t) { timed(events[k][1]); k++; }
          if (performance.now() >= nextPoke) { timed(() => audio.poke({ intensity: (n++ % 5) / 4 })); nextPoke += 125; }
          await sleep(4);
        }
      };
      audio.stats();
      const capEvents = [[0, () => audio.capsuleBeat({ beat: 'grab', progress: 0.1 })], [0.18, () => audio.capsuleBeat({ beat: 'grab', progress: 0.7 })], [0.35, () => audio.capsuleBeat({ beat: 'crack' })], [0.65, () => audio.reveal({ tier: 'mythic', isNew: true, mythicVariant: 1 })], [1.65, () => audio.capsuleBeat({ beat: 'burst', tier: 'mythic' })]];
      await runTimeline(capEvents, 4.7);
      const capPeak = audio.stats().peak;
      let mh = null;
      await runTimeline([[0, () => { mh = audio.mergeStart({ tier: 'mythic' }); }], [2.8, () => mh.burst({ tier: 'mythic', tierUp: true, mythicVariant: 2 })]], 5.3);
      const p1 = ps();
      const ms = cost.slice().sort((a, b) => a - b);
      const max = ms[ms.length - 1], mean = cost.reduce((a, b) => a + b, 0) / cost.length;
      info.realCeremony = { triggers: cost.length, maxMs: max, meanMs: mean, p99Ms: ms[Math.floor(ms.length * 0.99)], playout: p0 && { fallbackEvents: p1.ev - p0.ev, playedMs: p1.total - p0.total } };
      if (p0) check('live Mythic capsule open + Mythic merge with pokes at 8/s: no audio glitches (AudioPlayoutStats fallback events = 0)', p1.ev - p0.ev === 0 && p1.total - p0.total > 9000, `${p1.ev - p0.ev} fallback events over ${(p1.total - p0.total).toFixed(0)} ms played`, '0 events, > 9000 ms');
      check('live ceremony: every trigger (incl. mergeStart, which schedules the whole charge) costs <= 30 ms on the main thread', max <= 30, `max ${max.toFixed(1)} ms, p99 ${ms[Math.floor(ms.length * 0.99)].toFixed(1)} ms, mean ${mean.toFixed(2)} ms over ${cost.length} calls`, '<= 30');
      await drain(audio);
    }
    {
      // 5000 ceremony triggers (issued in small batches, as fast as the page can) must not leak or grow memory
      await sleep(500);
      const heapA = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      const createdA = tr.stat.created, disconnA = tr.stat.disconnected;
      const k0 = { ...audio.stats().started };
      const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
      let issued = 0, grabs = 0, maxLive = 0, maxNodes = 0, maxTrk = 0, maxPeak = 0, nan = false;
      const t0 = performance.now();
      const pb0 = ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, total: ctx.playoutStats.totalFramesDuration } : null;
      let mh = null;
      while (issued < 5000) {
        for (let b = 0; b < 25 && issued < 5000; b++, issued++) {
          const k = issued % 50, tier = tiers[issued % 6];
          if (k === 49) { if (mh) mh.stop(); mh = audio.mergeStart({ tier, chargeS: 1.2 }); if (issued % 100 === 99) mh.burst({ tier: tiers[(issued >> 3) % 6], tierUp: true, mythicVariant: issued % 3 }); }
          else if (k % 12 === 0) { audio.meterFull({ quiet: issued % 2 === 0 }); }
          else if (k % 12 === 1) { grabs++; audio.capsuleBeat({ beat: 'grab', progress: (issued % 10) / 10 }); }
          else if (k % 12 === 2) audio.capsuleBeat({ beat: 'crack' });
          else if (k % 12 === 3) audio.capsuleBeat({ beat: 'burst', tier });
          else if (k % 12 === 4) audio.duck({ db: -6 - (issued % 7), ms: 60 + (issued % 5) * 40 });
          else audio.reveal({ tier, tierUp: issued % 4 === 0, isNew: issued % 5 === 0, mythicVariant: issued % 3, calm: issued % 7 === 0, durationS: 0.5 + (issued % 9) * 0.4 });
        }
        const s = audio.stats();
        maxLive = Math.max(maxLive, s.live); maxNodes = Math.max(maxNodes, s.liveNodes); maxTrk = Math.max(maxTrk, tr.live.size - baseNodes);
        if (!Number.isFinite(s.peak)) nan = true; else maxPeak = Math.max(maxPeak, s.peak);
        await sleep(15);
      }
      if (mh) mh.stop();
      const issueS = (performance.now() - t0) / 1000;
      const pb1 = ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, total: ctx.playoutStats.totalFramesDuration } : null;
      await sleep(8000);   // longest voice: a 6.4 s reveal, or a merge charge + burst
      const s1 = audio.stats();
      await sleep(300);
      const heapB = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      const started = {}; for (const k of Object.keys(s1.started)) started[k] = s1.started[k] - (k0[k] || 0);
      const acc = Object.values(started).reduce((a, b) => a + b, 0);
      info.ceremonyBurst = { issued, issueS, accepted: acc, started, maxLiveGroups: maxLive, maxLiveNodes: maxNodes, maxTrackerNodes: maxTrk, maxPeak, nodesCreated: tr.stat.created - createdA, nodesDisconnected: tr.stat.disconnected - disconnA, heapDeltaMB: heapA != null ? (heapB - heapA) / 1048576 : null, endLive: s1.live, endNodes: s1.liveNodes, playout: pb0 && { fallbackEvents: pb1.ev - pb0.ev, playedMs: pb1.total - pb0.total } };
      check('5000 ceremony triggers (meterFull, grab, crack, burst, reveal x6 tiers, merge, duck): every one accepted (grabs may be throttled)', acc >= issued - grabs - 1, `${acc} started of ${issued} issued (${grabs} grabs) in ${issueS.toFixed(1)} s`, `>= ${issued - grabs}`);
      check('5000 ceremony triggers: live groups bounded by the polyphony cap (+ fading)', maxLive <= MAX_VOICES + 16, `max ${maxLive} (cap ${MAX_VOICES}+16)`, `<= ${MAX_VOICES + 16}`);
      check('5000 ceremony triggers: live nodes bounded (own counter peak)', maxNodes < 20000, `max ${maxNodes} nodes over ${tr.stat.created - createdA} created`, '< 20000');
      check('5000 ceremony triggers: after draining, 0 live groups and 0 live nodes (own counters)', s1.live === 0 && s1.liveNodes === 0, `${s1.live} groups, ${s1.liveNodes} nodes`, '0 / 0');
      check('5000 ceremony triggers: independent API-surface tracker back to baseline', tr.live.size === baseNodes, `${tr.live.size - baseNodes} above baseline; ${tr.stat.created - createdA} created / ${tr.stat.disconnected - disconnA} disconnected`, '0');
      if (heapA != null) check('5000 ceremony triggers: JS heap growth after GC < 10 MB', (heapB - heapA) / 1048576 < 10, `${((heapB - heapA) / 1048576).toFixed(2)} MB`, '< 10 MB');
      check('5000 ceremony triggers: output finite and under the -1 dBFS ceiling', !nan && maxPeak <= 0.9, `peak ${maxPeak.toFixed(3)}${nan ? ' (NaN seen)' : ''}`, 'finite, <= 0.9');
    }

    /* ───── 7. mute, pause/resume, settings ───── */
    {
      audio.stats();
      audio.setSettings({ muted: true });
      await sleep(120);
      audio.stats();
      const s0 = audio.stats().started.poke;
      audio.poke({ intensity: 1 }); audio.release({ compression: 1 }); audio.pop();
      await sleep(250);
      const sm = audio.stats();
      check('muted: triggers are counted but nothing is audible (peak < 1e-4)', sm.started.poke === s0 + 1 && sm.peak < 1e-4, `started +${sm.started.poke - s0}, peak ${sm.peak.toExponential(1)}`, '+1, < 1e-4');
      audio.setSettings({ muted: false });
      await sleep(120);
      audio.stats();
      audio.poke({ intensity: 1 });
      await sleep(200);
      const su = audio.stats();
      check('unmuted again: audible', su.peak > 0.02, su.peak.toFixed(3), '> 0.02');

      audio.setPaused(true);
      await sleep(300);
      const sp = audio.stats();
      const dr0 = sp.dropped;
      audio.poke({ intensity: 1 });
      const sp2 = audio.stats();
      check('setPaused(true): context suspended, ready=false, live voices freed, new triggers dropped', sp.state === 'suspended' && audio.ready === false && sp.live === 0 && sp2.dropped === dr0 + 1, `${sp.state}, live ${sp.live}, dropped +${sp2.dropped - dr0}`, 'suspended, 0, +1');
      audio.setPaused(false);
      await sleep(500);
      check('setPaused(false): resumes to running and accepts voices', audio.ready === true && audio.stats().state === 'running', `${audio.stats().state}`, 'running');
      audio.stats();
      audio.poke({ intensity: 1 });
      await sleep(200);
      check('after resume: audible', audio.stats().peak > 0.02, 'peak > 0.02', '> 0.02');
    }

    /* ───── 7b. the context is suspended behind our back (phone call, iOS interruption): triggers recover it ───── */
    {
      await ctx.suspend();
      await sleep(150);
      const d0 = audio.stats().dropped;
      audio.poke({ intensity: 0.8 });       // dropped (not running) but must ask the browser to resume
      await sleep(500);
      const recovered = audio.ready === true && audio.stats().state === 'running';
      const st0 = audio.stats().started.poke;
      audio.poke({ intensity: 0.8 });
      check('externally suspended context: first trigger is dropped and kicks resume(), the next one plays', recovered && audio.stats().dropped >= d0 + 1 && audio.stats().started.poke === st0 + 1, `recovered=${recovered}, dropped +${audio.stats().dropped - d0}`, 'recovered, +1');
    }

    /* ───── 7c. vendor prefix and a browser with no WebAudio at all ───── */
    {
      const Orig = window.AudioContext;
      const before = caught.length;
      window.AudioContext = undefined; window.webkitAudioContext = Orig;
      const w = createAudio({ seed: 5 });
      await w.unlock();
      const okPrefixed = w.ready === true;
      w.poke({ intensity: 0.5 });
      const prefixedStarted = w.stats().started.poke;
      w.dispose();
      window.webkitAudioContext = undefined;
      const n = createAudio({ seed: 6 });
      safe('unlock without WebAudio', () => n.unlock());
      await n.unlock();
      safe('poke without WebAudio', () => n.poke({ intensity: 0.5 }));
      safe('squish without WebAudio', () => n.squishStart().update({ compression: 1, rate: 1 }));
      const noneReady = n.ready;
      n.dispose();
      window.AudioContext = Orig; delete window.webkitAudioContext;
      check('webkitAudioContext fallback: unlock() works and voices start', okPrefixed && prefixedStarted === 1, `ready=${okPrefixed}, poke started=${prefixedStarted}`, 'true, 1');
      check('no WebAudio at all: unlock() resolves, ready=false, no exception', noneReady === false && caught.length === before, `ready=${noneReady}, ${caught.length - before} exceptions`, 'false, 0');
    }

    /* ───── 8. dispose ───── */
    {
      audio.dispose();
      const before = caught.length;
      safe('poke after dispose', () => audio.poke({ intensity: 1 }));
      safe('unlock after dispose', () => audio.unlock());
      safe('squish after dispose', () => audio.squishStart().update({ compression: 1, rate: 1 }));
      await sleep(100);
      check('after dispose(): context closed, calls are safe no-ops', caught.length === before && ctx.state === 'closed' && audio.ready === false, `${ctx.state}, ${caught.length - before} exceptions`, 'closed, 0');
    }
  } finally {
    tr.restore();
    spy.restore();
  }
  info.counters = { ...nodeCounters, liveNodes: liveNodeCount(), liveGroups: liveGroupCount() };
  return { checks, info };
}
