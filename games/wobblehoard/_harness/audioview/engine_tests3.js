// Round-3 live-engine checks (music bed + interaction voices), run inside Chromium by probe_audio.mjs
// (page.evaluate -> window.AV.runEngineTests3()). Real createAudio() on a real AudioContext (headless, --mute-audio: the audio
// clock runs, nobody listens). Returns { checks, info } for the Node side.
import { createAudio, MAX_VOICES } from '/src/audio/engine.ts';
import { liveNodeCount, liveGroupCount, nodeCounters } from '/src/audio/dsp.ts';
import * as M from '/src/audio/music.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every node made through create*() is held until someone calls disconnect() on it (independent of the engine's counters). */
function installTracker() {
  const live = new Set();
  const stat = { created: 0, disconnected: 0 };
  const names = ['createGain', 'createOscillator', 'createBufferSource', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor', 'createWaveShaper', 'createAnalyser', 'createDelay', 'createConstantSource'];
  const orig = {};
  for (const n of names) {
    orig[n] = BaseAudioContext.prototype[n];
    BaseAudioContext.prototype[n] = function (...a) { const node = orig[n].apply(this, a); stat.created++; live.add(node); return node; };
  }
  const od = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...a) { if (a.length === 0) { if (live.delete(this)) stat.disconnected++; } return od.apply(this, a); };
  return { live, stat, restore() { for (const n of names) BaseAudioContext.prototype[n] = orig[n]; AudioNode.prototype.disconnect = od; } };
}

function installContextSpy() {
  const Orig = window.AudioContext;
  const spy = { count: 0, instances: [] };
  window.AudioContext = class extends Orig { constructor(...a) { super(...a); spy.count++; spy.instances.push(this); } };
  spy.restore = () => { window.AudioContext = Orig; };
  return spy;
}

export async function runEngineTests3() {
  const checks = [];
  const info = {};
  const check = (name, pass, value, limit) => checks.push({ name, pass: !!pass, value: String(value), limit: String(limit) });
  const caught = [];
  const safe = (label, fn) => { try { return fn(); } catch (e) { caught.push(`${label}: ${e && e.message || e}`); return undefined; } };
  const spy = installContextSpy();
  const tr = installTracker();
  const CHAIN_NODES = 10;   // boost, plain, music, bus (gains), high-pass, compressor, waveshaper, duck, master, analyser
  const drain = async (a, ms = 25000) => { const t0 = performance.now(); while (performance.now() - t0 < ms && (a.stats().live > 0 || a.detailStats().music.sessions > 0)) await sleep(200); };

  try {
    /* ───── 1. before unlock: music and the new voices are safe no-ops, no context is created ───── */
    const audio = createAudio({ seed: 303 });
    {
      safe('setMusic', () => audio.setMusic({ on: true, volume: 0.45 }));
      safe('bump', () => audio.bump({ intensity: 0.7 }));
      safe('lift', () => audio.lift({}));
      safe('toss', () => audio.toss({ speed: 0.5 }));
      safe('strand', () => audio.strand({ tension: 0.5 }));
      safe('strand snap', () => audio.strand({ tension: 0.5, snap: true }));
      safe('settings', () => audio.setSettings({ music: 0.45 }));
      const d = safe('detailStats', () => audio.detailStats());
      check('before unlock(): setMusic/bump/lift/toss/strand are safe no-ops, no AudioContext, music not playing', caught.length === 0 && spy.count === 0 && d && d.music.playing === false && d.music.on === true, `${caught.length} exceptions, ${spy.count} contexts, playing=${d && d.music.playing}`, '0, 0, false');
    }

    /* ───── 2. unlock: the music that was asked for before starts now, with its fade-in ───── */
    await audio.unlock();
    const ctx = spy.instances[spy.instances.length - 1];
    await sleep(50);
    audio.stats();
    const fade = [];
    for (let i = 0; i < 14; i++) { await sleep(250); fade.push(audio.stats().peak); }
    const d0 = audio.detailStats();
    info.fadeInPeaks = fade;
    check('after unlock(): the music requested before unlock starts (one session, started.music = 1)', d0.music.playing && audio.stats().started.music === 1, `playing=${d0.music.playing}, started.music=${audio.stats().started.music}`, 'true, 1');
    const early = Math.max(...fade.slice(0, 2)), late = Math.max(...fade.slice(10));
    check('live fade-in: the first 0.5 s peaks < 40% of the peaks 2.75-3.5 s in; audible after (> 0.01)', early < 0.4 * late && late > 0.01, `first 0.5 s ${early.toFixed(4)}, 2.75-3.5 s ${late.toFixed(4)}`, '< 40%, > 0.01');

    /* ───── 3. scheduler cost and polyphony while it plays (8 s) ───── */
    {
      const t0 = performance.now();
      let maxLive = 0, maxNodes = 0;
      const tk0 = audio.detailStats().music.ticks;
      while (performance.now() - t0 < 8000) {
        const d = audio.detailStats();
        maxLive = Math.max(maxLive, d.music.liveNotes); maxNodes = Math.max(maxNodes, audio.stats().liveNodes);
        await sleep(100);
      }
      const d = audio.detailStats();
      const ticks = d.music.ticks - tk0;
      info.scheduler = { ticks, tickMsMean: d.music.tickMsMean, tickMsMax: d.music.tickMsMax, p99: d.music.tickMsRecentP99, recentMax: d.music.tickMsRecentMax, maxLive, maxNodes, notes: d.music.notes };
      // (a tick that builds a pad chord, ~33 nodes, costs about 2 ms; every other tick ~0.1 ms. With ~80 ticks a "p99" is just
      // the 2nd-slowest tick and moved 2.1 -> 3.6 ms between runs on this shared container, so it is reported, not gated;
      // the gate is the mean and the slowest tick against half a 60 fps frame. The offline 6000-tick run gates p99.)
      check(`live scheduler: one tick every ~${M.TICK_MS} ms (70..90 in 8 s), main-thread cost per tick mean < 0.3 ms, slowest tick (incl. JIT warm-up since unlock) < 8 ms`, ticks >= 70 && ticks <= 90 && d.music.tickMsMean < 0.3 && d.music.tickMsMax < 8, `${ticks} ticks, mean ${d.music.tickMsMean.toFixed(3)} ms, slowest ${d.music.tickMsMax.toFixed(2)} ms (2nd-slowest of the last 128: ${d.music.tickMsRecentP99.toFixed(2)} ms)`, '70..90, < 0.3, < 8');
      check(`live: music notes sounding never exceed ${M.MAX_LIVE_NOTES}; live audio nodes bounded (< 200)`, maxLive <= M.MAX_LIVE_NOTES && d.music.maxLiveNotes <= M.MAX_LIVE_NOTES && maxNodes < 200, `max ${maxLive} sampled, ${d.music.maxLiveNotes} by the bed's own count, max ${maxNodes} nodes, ${d.music.notes} notes so far`, `<= ${M.MAX_LIVE_NOTES}, < 200`);
    }

    /* ───── 4. ducking under a ceremony and under a loud held squish ───── */
    {
      audio.reveal({ tier: 'rare' });
      await sleep(60);
      const dRev = audio.detailStats().music.ducked;
      await sleep(2000 + 1500);
      const dAfter = audio.detailStats().music.ducked;
      const h = audio.squishStart({});
      let dSq = false;
      for (let i = 0; i < 40; i++) { h.update({ compression: 0.5, rate: 2 }); await sleep(16); if (i === 30) dSq = audio.detailStats().music.ducked; }
      for (let i = 0; i < 40; i++) { h.update({ compression: 0.5, rate: 0.1 }); await sleep(16); }
      const dQuiet = audio.detailStats().music.ducked;
      h.end(0.05);
      check('music ducks under a reveal and recovers after it; ducks under a loud held squish (rate 2) and recovers when it goes quiet (rate 0.1)', dRev && !dAfter && dSq && !dQuiet, `reveal ${dRev} -> ${dAfter}; squish loud ${dSq}, quiet ${dQuiet}`, 'true, false, true, false');
      await sleep(500);
    }

    /* ───── 5. mute, music volume, pause/resume ───── */
    {
      audio.setSettings({ muted: true });
      await sleep(80);
      const m1 = audio.detailStats().music.playing;
      await sleep(1700);
      audio.stats(); await sleep(200);
      const pk = audio.stats().peak;
      const sessMuted = audio.detailStats().music.sessions;
      audio.setSettings({ muted: false });
      await sleep(500);
      const m2 = audio.detailStats().music.playing;
      check('mute stops the music (no session left after its fade, output silent) and unmute starts it again', !m1 && sessMuted === 0 && pk < 1e-4 && m2, `playing while muted ${m1}, sessions ${sessMuted}, peak ${pk.toExponential(1)}, after unmute ${m2}`, 'false, 0, < 1e-4, true');
      audio.setMusic({ volume: 0 });
      await sleep(1700);
      const v0 = audio.detailStats().music;
      audio.setSettings({ music: 0.45 });
      await sleep(500);
      const v1 = audio.detailStats().music;
      check('music volume 0 stops scheduling; setSettings({music: 0.45}) starts it again (setMusic.volume and settings.music are one value)', !v0.playing && v0.sessions === 0 && v0.volume === 0 && v1.playing && v1.volume === 0.45, `vol 0: playing ${v0.playing}, sessions ${v0.sessions}; vol 0.45: playing ${v1.playing}`, 'stop, start');
      await sleep(1500);
      audio.setPaused(true);
      await sleep(400);
      const p1 = audio.detailStats().music, s1 = audio.stats();
      check('setPaused(true) while music plays: 0.15 s fade, then suspended with no session and no voice left', p1.sessions === 0 && !p1.playing && s1.state === 'suspended' && s1.live === 0, `${s1.state}, sessions ${p1.sessions}, live ${s1.live}`, 'suspended, 0, 0');
      audio.setPaused(false);
      await sleep(700);
      const p2 = audio.detailStats().music;
      check('setPaused(false): running again and the music resumes (a new session with its fade-in)', audio.stats().state === 'running' && p2.playing, `${audio.stats().state}, playing ${p2.playing}`, 'running, true');
    }

    /* ───── 6. hostile setMusic and a toggle storm ───── */
    {
      const before = caught.length;
      const bad = [NaN, -1, 5, Infinity, undefined, null, 'on', {}, [], 1e9];
      for (const v of bad) { safe('setMusic', () => audio.setMusic({ on: v, volume: v })); safe('setMusic raw', () => audio.setMusic(v)); safe('settings', () => audio.setSettings({ music: v })); }
      let maxSess = 0;
      for (let i = 0; i < 200; i++) { safe('toggle', () => audio.setMusic({ on: i % 2 === 0, volume: 0.45 })); if (i % 10 === 0) { maxSess = Math.max(maxSess, audio.detailStats().music.sessions); await sleep(5); } }
      audio.setMusic({ on: true, volume: 0.45 });
      await sleep(600);
      const d = audio.detailStats().music;
      info.toggleStorm = { maxSess, after: d };
      check('hostile setMusic/setSettings values: 0 exceptions; 200 on/off toggles: <= 7 sessions alive at once, and it settles playing', caught.length === before && maxSess <= 7 && d.playing && d.sessions <= 7, `${caught.length - before} exceptions, max ${maxSess} sessions, then playing ${d.playing} (${d.sessions} sessions)`, '0, <= 7, true');
    }

    /* ───── 7. the new voices: hostile parameters, rate limit, held strand ───── */
    {
      const before = caught.length;
      const bad = [NaN, -1, 5, Infinity, -Infinity, undefined, null, '0.5', {}, 1e9, -1e9];
      for (const v of bad) {
        safe('bump', () => audio.bump({ intensity: v, pitch: v, pan: v }));
        safe('lift', () => audio.lift({ pitch: v, pan: v }));
        safe('toss', () => audio.toss({ speed: v, pan: v }));
        safe('strand', () => audio.strand({ tension: v, snap: v, pitch: v, pan: v }));
        safe('strand snap', () => audio.strand({ tension: v, snap: true }));
      }
      safe('bump()', () => audio.bump()); safe('lift()', () => audio.lift()); safe('toss()', () => audio.toss()); safe('strand()', () => audio.strand());
      await sleep(600);
      const st = audio.stats();
      check('bump/lift/toss/strand with hostile parameters (NaN, Infinity, strings, objects, 1e9, missing): 0 exceptions, output finite and <= 0.9', caught.length === before && Number.isFinite(st.peak) && st.peak <= 0.9, `${caught.length - before} exceptions, peak ${st.peak.toFixed(3)}`, '0, <= 0.9');
      await sleep(1000);
    }
    {
      const s0 = audio.stats().started.bump, th0 = audio.detailStats().throttled.bump;
      const t0 = performance.now();
      for (let i = 0; i < 120; i++) { audio.bump({ intensity: 0.5 }); await sleep(16); }
      const dur = (performance.now() - t0) / 1000;
      const acc = audio.stats().started.bump - s0, thr = audio.detailStats().throttled.bump - th0;
      await sleep(1100);
      const s1 = audio.stats().started.bump;
      audio.bump({ intensity: 0.5 });
      const lone = audio.stats().started.bump - s1;
      const maxAcc = Math.ceil(4 + 6 * dur) + 1;
      info.bumpLimit = { calls: 120, secs: dur, accepted: acc, throttled: thr, lone };
      check(`live bump rate limit: 120 calls at ~60 Hz (${dur.toFixed(1)} s) -> 6..${maxAcc} played (burst 4 + 6/s), the rest counted as throttled; a lone bump after 1 s plays`, acc >= 6 && acc <= maxAcc && thr === 120 - acc && lone === 1, `${acc} played, ${thr} throttled, lone ${lone}`, `6..${maxAcc}`);
    }
    {
      await drain(audio, 4000);
      const s0 = audio.stats().started.strand;
      let during = 0;
      for (let i = 0; i < 60; i++) { audio.strand({ tension: Math.min(0.8, i / 60), pan: 0.2 }); await sleep(16); if (i === 45) during = audio.stats().liveKinds.strand ?? 0; }
      const voices = audio.stats().started.strand - s0;
      await sleep(800);
      const after = audio.stats().liveKinds.strand ?? 0;
      check('held strand: 60 per-frame calls make ONE voice; when the calls stop it is gone 0.8 s later (no end(), no snap)', voices === 1 && during === 1 && after === 0, `voices ${voices}, live during ${during}, live 0.8 s after the last call ${after}`, '1, 1, 0');
      const sn0 = audio.stats().started.strandSnap;
      for (let i = 0; i < 30; i++) { audio.strand({ tension: 0.3 + i / 60 }); await sleep(16); }
      audio.strand({ tension: 0.8, snap: true });
      await sleep(100);
      const k = audio.stats().liveKinds;
      check('strand snap: ends the held voice at once and plays the snap', (k.strand ?? 0) === 0 && audio.stats().started.strandSnap === sn0 + 1, `strand live ${k.strand ?? 0}, snaps +${audio.stats().started.strandSnap - sn0}`, '0, +1');
    }

    /* ───── 8. 5000 triggers of the new voices with the music playing: no leak ───── */
    {
      await drain(audio, 3000);
      const heapA = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      const createdA = tr.stat.created, disconnA = tr.stat.disconnected;
      let issued = 0, maxLive = 0, maxNodes = 0, maxPeak = 0, nan = false, maxSess = 0;
      const t0 = performance.now();
      while (issued < 5000) {
        for (let b = 0; b < 40 && issued < 5000; b++, issued++) {
          const k = issued % 10;
          if (k === 0) audio.bump({ intensity: (issued % 9) / 8 });
          else if (k === 1) audio.lift({ pitch: 0.8 + (issued % 5) * 0.1 });
          else if (k === 2) audio.toss({ speed: (issued % 7) / 6 });
          else if (k <= 5) audio.strand({ tension: (issued % 11) / 10, pan: ((issued % 5) - 2) / 2 });
          else if (k === 6) audio.strand({ tension: 0.7, snap: true });
          else if (k === 7) audio.poke({ intensity: 0.4 });
          else if (k === 8) audio.pop({ size: 0.3 });
          else { const h = audio.squishStart({}); h.update({ compression: 0.6, rate: 2 }); h.end(0.03); }
        }
        const s = audio.stats(), d = audio.detailStats();
        maxLive = Math.max(maxLive, s.live); maxNodes = Math.max(maxNodes, s.liveNodes); maxSess = Math.max(maxSess, d.music.sessions);
        if (!Number.isFinite(s.peak)) nan = true; else maxPeak = Math.max(maxPeak, s.peak);
        await sleep(10);
      }
      const issueS = (performance.now() - t0) / 1000;
      audio.setMusic({ on: false });
      await sleep(3000);
      await drain(audio, 6000);
      await sleep(300);
      const s1 = audio.stats(), d1 = audio.detailStats();
      const heapB = (window.gc && window.gc(), performance.memory ? performance.memory.usedJSHeapSize : null);
      info.burst3 = { issued, issueS, maxLive, maxNodes, maxPeak, created: tr.stat.created - createdA, disconnected: tr.stat.disconnected - disconnA, endLive: s1.live, endNodes: s1.liveNodes, sessions: d1.music.sessions, heapMB: heapA != null ? (heapB - heapA) / 1048576 : null, started: s1.started, throttled: d1.throttled };
      check('5000 new-voice triggers (+ pokes, pops, squishes) with music on: live groups <= cap + fading, nodes bounded', maxLive <= MAX_VOICES + 16 && maxNodes < 6000 && maxSess <= 1, `max ${maxLive} groups, ${maxNodes} nodes, ${maxSess} music session(s), issued in ${issueS.toFixed(1)} s`, `<= ${MAX_VOICES + 16}, < 6000`);
      check(`... then music off and drained: 0 live groups, 0 live nodes (own counters), no music session; the API-surface tracker holds only the ${CHAIN_NODES} master-chain nodes`, s1.live === 0 && s1.liveNodes === 0 && d1.music.sessions === 0 && tr.live.size === CHAIN_NODES, `${s1.live} groups, ${s1.liveNodes} nodes, ${d1.music.sessions} sessions; tracker ${tr.live.size} live (${tr.stat.created - createdA} created / ${tr.stat.disconnected - disconnA} disconnected in this section)`, `0 / 0 / 0, ${CHAIN_NODES}`);
      if (heapA != null) check('5000 new-voice triggers: JS heap growth after GC < 8 MB', (heapB - heapA) / 1048576 < 8, `${((heapB - heapA) / 1048576).toFixed(2)} MB`, '< 8 MB');
      check('5000 new-voice triggers: output finite and under the -1 dBFS ceiling', !nan && maxPeak <= 0.9, `peak ${maxPeak.toFixed(3)}${nan ? ' (NaN)' : ''}`, '<= 0.9');
      const ticks = audio.detailStats().music.ticks;
      await sleep(500);
      check('with music off and nothing retiring, the music timer is stopped (no ticks)', audio.detailStats().music.ticks === ticks, `${audio.detailStats().music.ticks - ticks} ticks in 0.5 s`, '0');
    }

    /* ───── 9. a realistic session: music + play at a human pace + a ceremony ───── */
    {
      audio.setMusic({ on: true });
      await sleep(3000);
      const ps = () => (ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, total: ctx.playoutStats.totalFramesDuration } : null);
      const p0 = ps();
      const cost = [], cost3 = [];
      const timed = (fn, mine = true) => { const a = performance.now(); fn(); const c = performance.now() - a; cost.push(c); if (mine) cost3.push(c); };
      const t0 = performance.now();
      let n = 0, nextPoke = t0, nextBump = t0 + 100;
      let strandT = -1;
      while (performance.now() - t0 < 9000) {
        const t = performance.now() - t0;
        if (performance.now() >= nextPoke) { timed(() => audio.poke({ intensity: (n++ % 5) / 4 }), false); nextPoke += 125; }
        if (performance.now() >= nextBump) { timed(() => audio.bump({ intensity: 0.3 + (n % 4) / 6 })); nextBump += 333; }
        if (t > 2000 && t < 3500) { timed(() => audio.strand({ tension: (t - 2000) / 1500 })); strandT = t; }
        if (strandT > 0 && t >= 3500 && t < 3520) timed(() => audio.strand({ tension: 0.9, snap: true }));
        if (t > 4000 && t < 4020) timed(() => audio.reveal({ tier: 'epic' }), false);
        if (t > 6000 && t < 6020) { timed(() => audio.lift({})); }
        if (t > 6500 && t < 6520) { timed(() => audio.toss({ speed: 0.7 })); }
        await sleep(16);
      }
      const p1 = ps();
      const ms = cost.slice().sort((a, b) => a - b);
      const d = audio.detailStats();
      info.realistic = { triggers: cost.length, maxMs: ms[ms.length - 1], meanMs: cost.reduce((a, b) => a + b, 0) / cost.length, tickMsRecentMax: d.music.tickMsRecentMax, tickMsRecentP99: d.music.tickMsRecentP99, playout: p0 && { fallbackEvents: p1.ev - p0.ev, playedMs: p1.total - p0.total } };
      if (p0) check('9 s of music + pokes 8/s + bumps 3/s + a strand + an Epic reveal + lift + toss: no audio glitches (AudioPlayoutStats fallback events = 0)', p1.ev - p0.ev === 0 && p1.total - p0.total > 8000, `${p1.ev - p0.ev} fallback events over ${(p1.total - p0.total).toFixed(0)} ms played`, '0, > 8000 ms');
      const m3 = Math.max(...cost3);
      check('realistic session, main thread: every new-voice call (bump/lift/toss/strand/snap) <= 5 ms, any trigger incl. the Epic reveal <= 30 ms (the round-2 bound), slowest music tick of the last 12.8 s <= 3 ms', m3 <= 5 && ms[ms.length - 1] <= 30 && d.music.tickMsRecentMax <= 3, `new voices max ${m3.toFixed(2)} ms (${cost3.length} calls), all triggers max ${ms[ms.length - 1].toFixed(2)} ms (mean ${(cost.reduce((a, b) => a + b, 0) / cost.length).toFixed(3)}), tick max ${d.music.tickMsRecentMax.toFixed(2)} ms (p99 ${d.music.tickMsRecentP99.toFixed(2)})`, '<= 5, <= 30, <= 3');
    }

    /* ───── 10. dispose while the music plays ───── */
    {
      const before = caught.length;
      audio.dispose();
      await sleep(150);
      const ticks = audio.detailStats().music.ticks;
      safe('setMusic after dispose', () => audio.setMusic({ on: true }));
      safe('bump after dispose', () => audio.bump({ intensity: 1 }));
      safe('strand after dispose', () => audio.strand({ tension: 1 }));
      await sleep(400);
      check('dispose() with music playing: context closed, timer stopped, later calls are safe no-ops', caught.length === before && ctx.state === 'closed' && audio.detailStats().music.ticks === ticks && !audio.detailStats().music.playing, `${ctx.state}, ${caught.length - before} exceptions, ticks after ${audio.detailStats().music.ticks - ticks}`, 'closed, 0, 0');
    }
  } catch (e) {
    check('round-3 engine tests completed', false, String(e && e.stack || e), 'no exception');
  } finally {
    tr.restore();
    spy.restore();
  }
  info.counters = { ...nodeCounters, liveNodes: liveNodeCount(), liveGroups: liveGroupCount() };
  return { checks, info };
}
