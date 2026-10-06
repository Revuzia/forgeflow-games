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
      let dSq = false, dHold = false;
      for (let i = 0; i < 40; i++) { h.update({ compression: 0.5, rate: 2 }); await sleep(16); if (i === 30) dSq = audio.detailStats().music.ducked; }
      // audio-4 fix: the music stays down for the activity hold (HELD_ROOM_HOLD_S + ROOM_TAIL_S) after the squish was last
      // loud, then lets go (the return itself is not "ducked")
      const quietS = M.HELD_ROOM_HOLD_S + M.ROOM_TAIL_S + 0.6;
      const tq = performance.now();
      while (performance.now() - tq < quietS * 1000) { h.update({ compression: 0.5, rate: 0.1 }); await sleep(16); if (!dHold && performance.now() - tq > 1000) dHold = audio.detailStats().music.ducked; }
      const dQuiet = audio.detailStats().music.ducked;
      h.end(0.05);
      check(`music ducks under a reveal and recovers after it; ducks under a loud held squish (rate 2), stays down 1 s into a quiet spell (rate 0.1: the activity hold) and lets go ${quietS.toFixed(1)} s into it`, dRev && !dAfter && dSq && dHold && !dQuiet, `reveal ${dRev} -> ${dAfter}; squish loud ${dSq}, quiet 1 s ${dHold}, quiet ${quietS.toFixed(1)} s ${dQuiet}`, 'true, false, true, true, false');
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

    /* ───── 8b. CUT & RECONNECT live: no-ops before unlock, hostile arguments, a storm with the music on, no leak ───── */
    {
      const before = caught.length, ctxBefore = spy.count;
      const fresh = createAudio({ seed: 909 });
      safe('cut (locked)', () => fresh.cut({ phase: 'start', frac: 0.5 }));
      safe('cut sep (locked)', () => fresh.cut({ phase: 'separate', frac: 0.5 }));
      safe('rejoin (locked)', () => fresh.rejoin({ frac: 1, all: true }));
      check('before unlock(): cut / rejoin are safe no-ops (no exception, no AudioContext, counted as dropped)', caught.length === before && spy.count === ctxBefore && fresh.stats().dropped === 3, `${caught.length - before} exceptions, ${spy.count - ctxBefore} contexts, dropped ${fresh.stats().dropped}`, '0, 0, 3');
      safe('dispose fresh', () => fresh.dispose());
    }
    {
      await drain(audio, 3000);
      const before = caught.length;
      const bad = [NaN, -1, 5, Infinity, -Infinity, undefined, null, '0.5', {}, 1e9, -1e9];
      for (const v of bad) {
        safe('cut', () => audio.cut({ phase: 'start', frac: v, neckS: v, family: v, pan: v, calm: v }));
        safe('cut sep', () => audio.cut({ phase: 'separate', frac: v, family: v, pan: v, calm: v }));
        safe('cut phase', () => audio.cut({ phase: v, frac: 0.5 }));
        safe('rejoin', () => audio.rejoin({ frac: v, all: v, pan: v, calm: v }));
        await sleep(40);
      }
      safe('cut()', () => audio.cut()); safe('rejoin()', () => audio.rejoin());
      await sleep(900);
      const st = audio.stats();
      check('cut / rejoin with hostile parameters (NaN, Infinity, strings, objects, 1e9, missing, a wrong phase): 0 exceptions, output finite and <= 0.9', caught.length === before && Number.isFinite(st.peak) && st.peak <= 0.9, `${caught.length - before} exceptions, peak ${st.peak.toFixed(3)}`, '0, <= 0.9');
    }
    {
      await drain(audio, 3000);
      audio.setMusic({ on: true });
      await sleep(400);
      const createdA = tr.stat.created, disconnA = tr.stat.disconnected;
      const c0 = audio.stats().started, th0 = audio.detailStats().throttled;
      let issued = 0, maxLive = 0, maxNodes = 0, maxPeak = 0, nan = false;
      const fams = ['jellygel', 'slimegoo', 'marshmallow', 'beadsqueeze', 'putty', 'popdome', 'nonsense'];
      const t0 = performance.now();
      while (issued < 1500) {
        for (let b = 0; b < 15 && issued < 1500; b++, issued++) {
          const k = issued % 5, fam = fams[issued % fams.length];
          if (k === 0) audio.cut({ phase: 'start', frac: 0.125 + (issued % 7) / 16, neckS: 0.1 + (issued % 4) / 10, family: fam, calm: issued % 3 === 0 });
          else if (k === 1) audio.cut({ phase: 'separate', frac: 0.125 + (issued % 7) / 16, family: fam });
          else if (k === 2) audio.rejoin({ frac: (issued % 8) / 8 });
          else if (k === 3) audio.rejoin({ frac: 1, all: true });
          else audio.poke({ intensity: 0.4 });
        }
        const s = audio.stats();
        maxLive = Math.max(maxLive, s.live); maxNodes = Math.max(maxNodes, s.liveNodes);
        if (!Number.isFinite(s.peak)) nan = true; else maxPeak = Math.max(maxPeak, s.peak);
        await sleep(12);
      }
      const issueS = (performance.now() - t0) / 1000;
      const c1 = audio.stats().started, th1 = audio.detailStats().throttled;
      audio.setMusic({ on: false });
      await sleep(3000);
      await drain(audio, 6000);
      await sleep(300);
      const s1 = audio.stats(), d1 = audio.detailStats();
      const played = { cut: c1.cut - c0.cut, cutPop: c1.cutPop - c0.cutPop, rejoin: c1.rejoin - c0.rejoin };
      info.cutStorm = { issued, issueS, maxLive, maxNodes, maxPeak, played, throttled: { cut: th1.cut - th0.cut, rejoin: th1.rejoin - th0.rejoin }, created: tr.stat.created - createdA, disconnected: tr.stat.disconnected - disconnA };
      check(`1500 cut / rejoin / poke triggers in ${issueS.toFixed(1)} s with the music on: the limiters thin them (slices <= 3 + 1.5/s, pops <= 3 + 2/s), live groups and nodes bounded, output finite and <= 0.9`, played.cut <= 3 + 1.5 * issueS + 1 && played.cutPop <= 3 + 2 * issueS + 1 && maxLive <= MAX_VOICES + 16 && maxNodes < 6000 && !nan && maxPeak <= 0.9, `played ${played.cut} slices, ${played.cutPop} pops, ${played.rejoin} rejoins; throttled ${th1.cut - th0.cut} / ${th1.rejoin - th0.rejoin}; max ${maxLive} groups, ${maxNodes} nodes, peak ${maxPeak.toFixed(3)}`, 'thinned, bounded');
      check(`... then music off and drained: 0 live groups, 0 live nodes, no music session; the API-surface tracker holds only the ${CHAIN_NODES} master-chain nodes`, s1.live === 0 && s1.liveNodes === 0 && d1.music.sessions === 0 && tr.live.size === CHAIN_NODES, `${s1.live} groups, ${s1.liveNodes} nodes, ${d1.music.sessions} sessions; tracker ${tr.live.size} live`, `0 / 0 / 0, ${CHAIN_NODES}`);
    }

    /* ───── 9. a realistic session: music + play at a human pace + a ceremony ───── */
    {
      audio.setMusic({ on: true });
      await sleep(3000);
      const ps = () => (ctx.playoutStats ? { ev: ctx.playoutStats.fallbackFramesEvents, total: ctx.playoutStats.totalFramesDuration } : null);
      const p0 = ps();
      const cost = [], cost3 = [];
      let slowest = { ms: 0, label: '' };
      const timed = (fn, mine = true, label = 'new voice') => { const a = performance.now(); fn(); const c = performance.now() - a; cost.push(c); if (mine) cost3.push(c); if (c > slowest.ms) slowest = { ms: c, label, t: Math.round(performance.now() - t0) }; };
      const t0 = performance.now();
      let n = 0, nextPoke = t0, nextBump = t0 + 100;
      let strandT = -1;
      while (performance.now() - t0 < 9000) {
        const t = performance.now() - t0;
        if (performance.now() >= nextPoke) { timed(() => audio.poke({ intensity: (n++ % 5) / 4 }), false, 'poke'); nextPoke += 125; }
        if (performance.now() >= nextBump) { timed(() => audio.bump({ intensity: 0.3 + (n % 4) / 6 }), true, 'bump'); nextBump += 333; }
        if (t > 2000 && t < 3500) { timed(() => audio.strand({ tension: (t - 2000) / 1500 }), true, 'strand'); strandT = t; }
        if (strandT > 0 && t >= 3500 && t < 3520) timed(() => audio.strand({ tension: 0.9, snap: true }), true, 'snap');
        if (t > 4000 && t < 4020) timed(() => audio.reveal({ tier: 'epic' }), false, 'reveal epic');
        if (t > 6000 && t < 6020) { timed(() => audio.lift({}), true, 'lift'); }
        if (t > 6500 && t < 6520) { timed(() => audio.toss({ speed: 0.7 }), true, 'toss'); }
        await sleep(16);
      }
      const p1 = ps();
      const ms = cost.slice().sort((a, b) => a - b);
      const d = audio.detailStats();
      info.realistic = { slowest, triggers: cost.length, maxMs: ms[ms.length - 1], meanMs: cost.reduce((a, b) => a + b, 0) / cost.length, tickMsRecentMax: d.music.tickMsRecentMax, tickMsRecentP99: d.music.tickMsRecentP99, playout: p0 && { fallbackEvents: p1.ev - p0.ev, playedMs: p1.total - p0.total } };
      if (p0) check('9 s of music + pokes 8/s + bumps 3/s + a strand + an Epic reveal + lift + toss: no audio glitches (AudioPlayoutStats fallback events = 0)', p1.ev - p0.ev === 0 && p1.total - p0.total > 8000, `${p1.ev - p0.ev} fallback events over ${(p1.total - p0.total).toFixed(0)} ms played`, '0, > 8000 ms');
      const m3 = Math.max(...cost3), mean3 = cost3.reduce((a, b) => a + b, 0) / cost3.length;
      // same bounds as rounds 1/2 (mean trigger cost < 1 ms, every trigger <= 30 ms): a single call can catch a GC or JIT pause
      // on this shared container (measured 3.1 ms and 13 ms for the slowest new-voice call in two runs)
      // (music ticks: the mean is the scheduler's cost; a single slow tick on this shared container is the thread being
      // preempted, measured 1.7 and 10.1 ms in two runs, so the worst tick is held to one 60 fps frame, not to its usual ~1 ms)
      check('realistic session, main thread: new-voice calls (bump/lift/toss/strand/snap) mean < 1 ms, every trigger incl. the Epic reveal <= 30 ms, music ticks mean < 0.3 ms and none over one 60 fps frame (16 ms)', mean3 < 1 && ms[ms.length - 1] <= 30 && d.music.tickMsMean < 0.3 && d.music.tickMsRecentMax <= 16, `new voices mean ${mean3.toFixed(3)} ms, max ${m3.toFixed(2)} ms (${cost3.length} calls); slowest call ${slowest.ms.toFixed(2)} ms (${slowest.label} at ${slowest.t} ms); all triggers mean ${(cost.reduce((a, b) => a + b, 0) / cost.length).toFixed(3)} ms; ticks mean ${d.music.tickMsMean.toFixed(3)} ms, slowest of the last 128 ${d.music.tickMsRecentMax.toFixed(2)} ms`, '< 1, <= 30, < 0.3, <= 16');
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

    /* ───── 11. round-3 fixes (fresh engines) ───── */
    await fixChecks(check, tr, info);
  } catch (e) {
    check('round-3 engine tests completed', false, String(e && e.stack || e), 'no exception');
  } finally {
    tr.restore();
    spy.restore();
  }
  info.counters = { ...nodeCounters, liveNodes: liveNodeCount(), liveGroups: liveGroupCount() };
  return { checks, info };
}

/** Busy-wait the main thread (a shader compile, a GC, a throttled timer). */
function stall(ms) { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* spin */ } }

/** Round-3 fixes, each on a fresh engine (music off unless the check is about the music). */
async function fixChecks(check, tr, info) {
  const P = AudioScheduledSourceNode.prototype;
  const origStart = P.start;
  const fx = {};
  const peakOver = async (a, ms) => { a.stats(); await sleep(ms); return a.stats().peak; };

  /* the music makes room under an effect, and comes back */
  {
    const a = createAudio({ seed: 404 });
    a.setMusic({ on: true });
    await a.unlock();
    await sleep(3200);
    const before = a.detailStats().music.ducked;
    a.poke({ intensity: 0.5 });
    await sleep(40);
    const during = a.detailStats().music.ducked;
    await sleep(2600);
    const held = a.detailStats().music.ducked;
    await sleep((M.ROOM_TAIL_S - 2.6 + 0.9) * 1000);
    const after = a.detailStats().music.ducked;
    // audio-4 fix: the dip is held ROOM_TAIL_S after the effect (the activity hold: casual play no longer pumps the music),
    // then the music returns (dB-linear, ROOM_RETURN_S)
    check(`room: a poke makes the music dip at once (fast duck keyed by the effect), it is still down 2.6 s later (activity hold) and lets go ~${M.ROOM_TAIL_S} s after the poke`, !before && during && held && !after, `before ${before}, 40 ms after the poke ${during}, 2.6 s later ${held}, ${(M.ROOM_TAIL_S + 0.94).toFixed(1)} s later ${after}`, 'false, true, true, false');
    // a session that starts during a ceremony is ducked under it from its first note
    a.setMusic({ on: false });
    await sleep(1800);
    a.reveal({ tier: 'legendary' });
    await sleep(60);
    a.setMusic({ on: true });
    await sleep(400);
    const d = a.detailStats().music;
    check('a music session started during a ceremony (music switched on mid-reveal) is ducked under it', d.playing && d.ducked, `playing ${d.playing}, ducked ${d.ducked}`, 'true, true');
    await sleep(3500);
    // setPaused(true) twice (visibilitychange + pagehide): the second call must not skip the fade or shorten the suspend
    const ctx = a.stats().state;
    a.setPaused(true); a.setPaused(true);
    await sleep(60);
    const mid = { state: a.stats().state, sessions: a.detailStats().music.sessions };
    await sleep(400);
    const end = { state: a.stats().state, sessions: a.detailStats().music.sessions };
    check('setPaused(true) twice in a row: the music still fades (sessions alive and context running 60 ms later), then suspends with nothing left', ctx === 'running' && mid.state === 'running' && mid.sessions >= 1 && end.state === 'suspended' && end.sessions === 0, `60 ms: ${mid.state}, ${mid.sessions} session(s); 460 ms: ${end.state}, ${end.sessions}`, 'running >= 1, suspended 0');
    a.setPaused(false);
    await sleep(300);
    a.dispose();
  }

  /* the held strand at realistic per-frame rates, through the live engine */
  {
    const a = createAudio({ seed: 405 });
    await a.unlock();
    a.setSettings({ master: 1 });
    await sleep(100);
    a.stats();
    let pk = 0, pkHold = 0;
    const t0 = performance.now();
    let k = 0;
    while (performance.now() - t0 < 2200) {
      const t = (performance.now() - t0) / 1000;
      const T = t < 1.2 ? 0.85 * (t / 1.2) * (t / 1.2) * (3 - 2 * (t / 1.2)) : 0.8;
      a.strand({ tension: T });
      await sleep(33 * (0.7 + 0.6 * ((k++ * 0.618) % 1)));     // ~30 Hz with +/-30% jitter
      if (k % 3 === 0) { const s = a.stats(); if (t < 1.4) pk = Math.max(pk, s.peak); else pkHold = Math.max(pkHold, s.peak); }
    }
    await sleep(800);
    const gone = (a.stats().liveKinds.strand ?? 0) === 0;
    const db = (v) => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);
    check('live strand at ~30 Hz jittered calls (master 1): a stretch to 0.85 peaks in -20..-1 dBFS, a held 0.8 stays audible (> -30 dBFS peak), and it frees itself after the calls stop', pk >= 0.1 && pk <= 0.89 && pkHold > 0.0316 && gone, `stretch peak ${db(pk)} dBFS, hold ${db(pkHold)} dBFS, freed ${gone}`, '-20..-1, > -30, true');
    a.dispose();
  }

  /* audit: setPaused(true) used to free a held squish and a charging merge without stopping their sources */
  {
    const a = createAudio({ seed: 406 });
    await a.unlock();
    await sleep(100);
    const st = { started: 0, ended: 0 };
    P.start = function (...args) { st.started++; this.addEventListener('ended', () => { st.ended++; }); return origStart.apply(this, args); };
    try {
      const h = a.squishStart({});
      for (let i = 0; i < 10; i++) { h.update({ compression: 0.5, rate: 2 }); await sleep(16); }
      a.mergeStart({ tier: 'rare', chargeS: 3 });
      await sleep(200);
      a.setPaused(true);
      await sleep(250);
      a.setPaused(false);
      await sleep(1500);
    } finally { P.start = origStart; }
    check('setPaused(true) with a held squish and a charging merge: every source started reaches \"ended\" after the pause cycle (Bag.free stops sources, it no longer only disconnects them)', st.started > 10 && st.ended === st.started, `${st.started} started, ${st.ended} ended, ${a.stats().liveNodes} live nodes`, 'all ended');
    a.dispose();
  }

  /* audit: calm capsule burst reachable through SquishAudio */
  {
    const a = createAudio({ seed: 407 });
    await a.unlock();
    await sleep(100);
    const calm = [], loud = [];
    for (let i = 0; i < 3; i++) {
      a.stats(); a.capsuleBeat({ beat: 'burst', tier: 'rare' }); loud.push(await peakOver(a, 550));
      a.stats(); a.capsuleBeat({ beat: 'burst', tier: 'rare', calm: true }); calm.push(await peakOver(a, 550));
    }
    check('capsuleBeat({calm: true}) reaches the calm burst (low-passed, softer pop): every calm burst peaks below every normal one', Math.max(...calm) < Math.min(...loud), `calm ${calm.map((v) => v.toFixed(3)).join('/')}, normal ${loud.map((v) => v.toFixed(3)).join('/')}`, 'calm < normal');
    a.dispose();
  }

  /* audit: the iOS silent buffer must start inside the gesture, i.e. synchronously in unlock(), before any await */
  {
    const B = AudioBufferSourceNode.prototype, ob = B.start;
    let silent = 0;
    B.start = function (...args) { if (this.buffer && this.buffer.length === 1) silent++; return ob.apply(this, args); };
    let syncCount = -1, state = '';
    // simulate the iOS case: the context starts 'suspended' and resume() settles asynchronously (headless Chromium creates a
    // 'running' context, where the old order was invisible)
    const OrigAC = window.AudioContext;
    window.AudioContext = class extends OrigAC {
      constructor(...args) {
        super(...args);
        let resumed = false;
        Object.defineProperty(this, 'state', { configurable: true, get: () => (resumed ? 'running' : 'suspended') });
        const r = OrigAC.prototype.resume.bind(this);
        this.resume = () => new Promise((ok) => setTimeout(() => { resumed = true; r().then(ok, ok); }, 40));
      }
    };
    const a = createAudio({ seed: 408 });
    try { const p = a.unlock(); syncCount = silent; await p; state = a.stats().state; } finally { B.start = ob; window.AudioContext = OrigAC; }
    check('unlock() on a context that starts suspended (iOS): the one-sample silent buffer is started synchronously inside the call (inside the user gesture), not after awaiting resume()', syncCount === 1 && state === 'running', `${syncCount} started before unlock() returned; state after ${state}`, '1, running');
    a.dispose();
  }

  /* audio-4 fix: unlock() while an earlier unlock is still pending. lifecycle.ts calls unlockAudio() on visibilitychange,
     outside a user gesture; on iOS that resume() stays pending. A tap within the next 1.2 s used to get the same in-flight
     promise with no resume() and no silent buffer inside its gesture, so the context stayed suspended. Mock: the context
     starts 'suspended' and resume() only ever settles when called inside a "gesture". */
  {
    const B = AudioBufferSourceNode.prototype, ob = B.start;
    let silent = 0, resumes = 0, gesture = false;
    B.start = function (...args) { if (this.buffer && this.buffer.length === 1) silent++; return ob.apply(this, args); };
    const OrigAC = window.AudioContext;
    window.AudioContext = class extends OrigAC {
      constructor(...args) {
        super(...args);
        let resumed = false;
        Object.defineProperty(this, 'state', { configurable: true, get: () => (resumed ? 'running' : 'suspended') });
        const r = OrigAC.prototype.resume.bind(this);
        this.resume = () => { resumes++; return gesture ? r().then(() => { resumed = true; }) : new Promise(() => { /* no gesture: pending for ever */ }); };
      }
    };
    const a = createAudio({ seed: 414 });
    const res = {};
    try {
      const p1 = a.unlock();                                    // visibilitychange: no gesture
      await sleep(300);
      const r0 = resumes, s0 = silent;
      gesture = true; const p2 = a.unlock(); gesture = false;   // the player's tap 300 ms later, inside its gesture
      res.inGestureResumes = resumes - r0; res.inGestureSilent = silent - s0;
      await Promise.race([p2, sleep(2000)]);
      res.state = a.stats().state;
      res.same = p1 === p2;
    } finally { B.start = ob; window.AudioContext = OrigAC; }
    check('unlock() while an earlier, gesture-less unlock() is pending (iOS mock): the tap calls resume() and starts the silent buffer again inside its own gesture, and the context runs', res.inGestureResumes === 1 && res.inGestureSilent === 1 && res.state === 'running', `inside the tap: ${res.inGestureResumes} resume(), ${res.inGestureSilent} silent buffer; state after ${res.state}`, '1, 1, running');
    a.dispose();
  }

  /* audit: a main-thread stall during a merge charge must not schedule anything into the past */
  {
    const a = createAudio({ seed: 409 });
    await a.unlock();
    await sleep(100);
    const late = [];
    P.start = function (when = 0, ...rest) { const c = this.context; if (c && when > 0 && when < c.currentTime - 0.003) late.push(c.currentTime - when); return origStart.call(this, when, ...rest); };
    try {
      a.mergeStart({ tier: 'epic', chargeS: 2.4 });
      await sleep(300);
      stall(1200);
      await sleep(1600);
    } finally { P.start = origStart; }
    check('merge charge with a 1.2 s main-thread stall in the middle: nothing is started in the past afterwards (the late slices are skipped, not piled onto "now")', late.length === 0, `${late.length} sources started late${late.length ? ` (up to ${(Math.max(...late) * 1000).toFixed(0)} ms)` : ''}`, '0');
    a.dispose();
  }

  /* audit: capsuleBeat('grab') used to build a new PeriodicWave per call */
  {
    const a = createAudio({ seed: 410 });
    await a.unlock();
    await sleep(100);
    const C = BaseAudioContext.prototype, ow = C.createPeriodicWave;
    let waves = 0;
    C.createPeriodicWave = function (...args) { waves++; return ow.apply(this, args); };
    try { for (let i = 0; i < 10; i++) { a.capsuleBeat({ beat: 'grab', progress: i / 10 }); await sleep(80); } } finally { C.createPeriodicWave = ow; }
    check('10 grab squeaks: the squeak wave is built once per context and cached (at most 1 PeriodicWave)', waves <= 1 && a.stats().started.capsule === 10, `${waves} PeriodicWaves for ${a.stats().started.capsule} grabs`, '<= 1');
    a.dispose();
  }

  /* audit: big one-call scheduling spread over the lookahead pump */
  {
    const a = createAudio({ seed: 411 });
    await a.unlock();
    await sleep(200);
    const cost = (fn) => { const c0 = tr.stat.created, t0 = performance.now(); const r = fn(); return { nodes: tr.stat.created - c0, ms: performance.now() - t0, r }; };
    const bl = cost(() => a.blend({ count: 8, durationS: 8 }));
    await sleep(120);
    const rv = cost(() => a.reveal({ tier: 'mythic', tierUp: true, isNew: true }));
    const mg = cost(() => a.mergeStart({ tier: 'legendary' }));
    // the same Legendary charge built the old way (its first slice 0.5 s ahead), counted with the same counter, into a muted gain
    const Cm = await import('/src/audio/ceremony.ts'), Dm = await import('/src/audio/dsp.ts');
    const oc = new OfflineAudioContext(1, 4800, 48000);      // (node counts do not depend on the kind of context)
    const old = cost(() => Cm.mergeStart(oc, oc.destination, 0.004, { rng: Dm.makeRng(5), tier: 'legendary', lookaheadS: 0.5 }));
    const c0 = tr.stat.created;
    await sleep(8800);
    const later = tr.stat.created - c0;
    // a stopped blend builds nothing more
    const bl2 = a.blend({ count: 8, durationS: 8 });
    await sleep(400);
    bl2.stop();
    await sleep(100);
    const c1 = tr.stat.created;
    await sleep(1500);
    const afterStop = tr.stat.created - c1;
    fx.spread = { blend: bl.nodes, blendMs: bl.ms, reveal: rv.nodes, revealMs: rv.ms, merge: mg.nodes, mergeMs: mg.ms, mergeOld: old.nodes, builtLater: later, afterStop };
    check('one call never builds the whole voice: blend 8 s x 8 <= 150 nodes in the call (was ~586), Mythic reveal + tier-up + new <= 80 (was 137), Legendary mergeStart fewer than with the old 0.5 s first slice; the pump builds the rest later', bl.nodes <= 150 && rv.nodes <= 80 && mg.nodes < old.nodes && later >= 300, `blend ${bl.nodes} nodes (${bl.ms.toFixed(1)} ms), reveal ${rv.nodes} (${rv.ms.toFixed(1)} ms), merge ${mg.nodes} (${mg.ms.toFixed(1)} ms; old first slice: ${old.nodes}); ${later} nodes built by the pump afterwards`, '<= 150, <= 80, < old');
    check('a stopped blend schedules nothing more (its pending bubbles, clinks and flourish are dropped)', afterStop <= 4, `${afterStop} nodes created in the 1.5 s after stop()`, '<= 4');
    a.dispose();
  }

  /* audit: held squish updated twice within one audio-clock step must not double its bubbles (offline, same seed: exact) */
  {
    const V = await import('/src/audio/voices.ts');
    const D = await import('/src/audio/dsp.ts');
    const C = BaseAudioContext.prototype, oo = C.createOscillator;
    let n = 0;
    C.createOscillator = function (...args) { n++; return oo.apply(this, args); };
    const run = (per) => {
      const ctx = new OfflineAudioContext(1, 48000 * 2, 48000);
      const c0 = n;
      const v = V.squish(ctx, ctx.destination, 0, { rng: D.makeRng(77), pitch: 1 });
      for (let i = 0; i < 40; i++) for (let k = 0; k < per; k++) v.update({ compression: 0.5, rate: 2.5 }, 0.05 + i * 0.03);
      v.end(0.05, 1.3);
      return n - c0;
    };
    let one = 0, four = 0;
    try { one = run(1); four = run(4); } finally { C.createOscillator = oo; }
    check('held squish: four update() calls per audio-clock step (same seed) make exactly as many bubbles as one (was +56%)', four === one, `1 call/step: ${one} oscillators, 4 calls/step: ${four}`, 'equal');
  }

  /* audit: iOS audio session opt-in (feature-detected) */
  {
    const nav = window.navigator;
    const had = Object.getOwnPropertyDescriptor(nav, 'audioSession');
    const fake = { type: 'auto' };
    Object.defineProperty(nav, 'audioSession', { value: fake, configurable: true });
    const seen = [];
    const a = createAudio({ seed: 413 });
    try {
      await a.unlock(); seen.push(fake.type);
      a.setSettings({ muted: true }); seen.push(fake.type);
      a.setSettings({ muted: false }); seen.push(fake.type);
    } finally { if (had) Object.defineProperty(nav, 'audioSession', had); else delete nav.audioSession; }
    check('iOS audio session: with sound on the engine asks for "playback" (the ringer switch does not mute the game), hands it back ("ambient") when muted', seen.join(',') === 'playback,ambient,playback', seen.join(','), 'playback,ambient,playback');
    a.dispose();
  }
  info.fixes = fx;
}
