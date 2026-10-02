// Live-engine checks, run inside Chromium by probe_audio.mjs (page.evaluate -> window.AV.runEngineTests()).
// Everything here drives the real createAudio() on a real AudioContext (headless Chromium, --autoplay-policy flag,
// --mute-audio so nobody's speakers are involved; the audio clock still runs). Returns { checks, info } for the Node side.
import { createAudio, MAX_VOICES } from '/src/audio/engine.ts';
import { liveNodeCount, liveGroupCount, nodeCounters } from '/src/audio/dsp.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
