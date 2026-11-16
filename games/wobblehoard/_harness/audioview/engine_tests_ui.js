// UI v3 live-engine checks (_spec/UI.md 7, K09), run inside Chromium by probe_audio.mjs / ui_checks.mjs (page.evaluate ->
// window.AV.runEngineTestsUi()). The REAL createAudio() on a real AudioContext (headless Chromium, --autoplay-policy flag,
// --mute-audio so nobody's speakers are involved; the audio clock and the analyser still run): nothing before unlock, every kind
// counted and under the level ceiling, mute / uiSounds off, ceremonies, priority, a call storm, no leaked node.
// Returns { checks, info } for the Node side. Nobody has listened to any of it.
import { createAudio } from '/src/audio/engine.ts';
import { UI_KINDS, UI_GAP_S, hoverSoundAllowed } from '/src/audio/ui.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Independent bookkeeping at the WebAudio API surface: every node created is held until disconnect() with no argument. */
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

function installContextSpy() {
  const Orig = window.AudioContext;
  const spy = { count: 0, instances: [] };
  window.AudioContext = class extends Orig { constructor(...a) { super(...a); spy.count++; spy.instances.push(this); } };
  spy.restore = () => { window.AudioContext = Orig; };
  return spy;
}

export async function runEngineTestsUi() {
  const checks = [];
  const info = {};
  const check = (name, pass, value, limit) => checks.push({ name, pass: !!pass, value: String(value), limit: String(limit) });
  const caught = [];
  const safe = (label, fn) => { try { return fn(); } catch (e) { caught.push(`${label}: ${e && e.message || e}`); return undefined; } };
  const spy = installContextSpy();
  const tr = installTracker();
  const PK = 0.126;
  const zeros = (st) => Object.values(st.started).every((v) => v === 0);
  const uiTotal = (a) => a.stats().started.ui;
  /** Peak of the output over `ms` of real time, polled so a long sound is never longer than the analyser's ring. */
  const watch = async (a, ms) => { let pk = 0; a.stats(); const t0 = performance.now(); while (performance.now() - t0 < ms) { await sleep(10); pk = Math.max(pk, a.stats().peak); } return pk; };
  try {
    /* ───── 1. before unlock(): every kind is a safe no-op, no AudioContext exists ───── */
    {
      const a = createAudio({ seed: 5 });
      let calls = 0;
      for (const kind of UI_KINDS) for (const calm of [false, true]) { safe('ui', () => a.ui({ kind, calm })); calls++; }
      for (const bad of [undefined, null, {}, { kind: 'bogus' }, { kind: NaN }, { kind: 5 }, { kind: 'tick', calm: 'yes' }, 7, 'tick']) { safe('ui hostile', () => a.ui(bad)); calls++; }
      const st = a.stats();
      check('before unlock(): ui() of all 12 kinds (normal and calm) and 9 hostile calls: 0 exceptions', caught.length === 0, caught.length ? caught.join(' | ') : '0 exceptions', '0');
      check('before unlock(): no AudioContext was constructed', spy.count === 0, spy.count, '0');
      check('before unlock(): nothing started (started.ui and all 12 ui:<kind> are 0), ready=false, state "locked", every call counted as dropped', a.ready === false && st.state === 'locked' && zeros(st) && st.dropped === calls, `${a.ready}/${st.state}, started ${JSON.stringify(Object.fromEntries(Object.entries(st.started).filter(([k, v]) => k.startsWith('ui') && v)))}, dropped ${st.dropped}/${calls}`, 'false/locked/none, dropped = calls');
      check('stats().started has the keys ui and ui:<kind> for all 12 kinds (K09: counted in stats())', 'ui' in st.started && UI_KINDS.every((k) => ('ui:' + k) in st.started), Object.keys(st.started).filter((k) => k.startsWith('ui')).length + ' ui keys', '13');
      a.dispose();
    }

    /* ───── 2. after unlock(): all 12 kinds are counted, each under the ceiling ───── */
    const audio = createAudio({ seed: 2024 });
    await audio.unlock();
    audio.setSettings({ master: 1, muted: false });
    await sleep(1200);
    // warm-up: on a starved machine the first sound after unlock() can arrive late (seen once in a full probe run); it is counted
    // like any other (every check below works with differences)
    audio.ui({ kind: 'select' });
    await sleep(900);
    const baseNodes = tr.live.size;
    info.baselineNodes = baseNodes;
    const peaks = {}, tried = {};
    for (const kind of UI_KINDS) {
      const before = audio.stats().started['ui:' + kind], tot = uiTotal(audio);
      // One reading per kind. If it falls outside the window the machine may be starved (a note scheduled in the past starts at
      // once, so a two-note sound piles into a chord: seen under load, never on an idle machine): up to two more readings, the
      // MEDIAN of the readings that saw a sound is judged and every reading is reported.
      const tries = [];
      for (let a = 0; a < 3; a++) {
        if (a) await sleep(500);
        audio.stats();
        audio.ui({ kind });
        tries.push(await watch(audio, kind === 'trophy' ? 1450 : 800));
        if (tries[a] > 0.02 && tries[a] <= PK) break;
      }
      // a reading of ~0 means the analyser saw no sound at all (a starved machine renders late): not a level, so it is left out of the median
      const seen = tries.filter((v) => v > 0.005).sort((p, q) => p - q);
      peaks[kind] = seen.length ? seen[seen.length >> 1] : 0; tried[kind] = tries.map((v) => +v.toFixed(3));
      const st = audio.stats();
      check(`live ${kind}: counted in stats() (ui:${kind} and ui each +${tries.length})`, st.started['ui:' + kind] === before + tries.length && st.started.ui === tot + tries.length, `ui:${kind} ${before} -> ${st.started['ui:' + kind]}, ui ${tot} -> ${st.started.ui}`, `+${tries.length}`);
    }
    const worst = Math.max(...Object.values(peaks));
    check('live: every kind\'s output peak at master 1 is audible (> 0.02) and <= 0.126 (-18 dBFS) (median of the readings that saw a sound; more readings only if the first is outside)', UI_KINDS.every((k) => peaks[k] > 0.02 && peaks[k] <= PK), UI_KINDS.map((k) => `${k} ${tried[k].join('/')}`).join(', '), '0.02 < peak <= 0.126');
    info.livePeaks = peaks; info.liveReadings = tried; info.worstLivePeak = worst;
    check('live: after all 12, the output state is running and the readout finite', audio.stats().state === 'running' && Number.isFinite(worst), `${audio.stats().state}, worst ${worst.toFixed(4)}`, 'running');

    /* ───── 3. mute and the uiSounds switch: silent and not counted ───── */
    {
      await sleep(300);
      audio.setSettings({ muted: true });
      await sleep(120);
      const s0 = { ...audio.stats().started };
      let pk = 0;
      audio.stats();
      for (const kind of UI_KINDS) { audio.ui({ kind }); await sleep(35); pk = Math.max(pk, audio.stats().peak); }
      await sleep(150); pk = Math.max(pk, audio.stats().peak);
      const s1 = audio.stats().started;
      check('muted: ui() of all 12 kinds starts nothing (ui and ui:<kind> unchanged) and the output is silent (< 1e-4)', UI_KINDS.every((k) => s1['ui:' + k] === s0['ui:' + k]) && s1.ui === s0.ui && pk < 1e-4, `ui ${s0.ui} -> ${s1.ui}, peak ${pk.toExponential(1)}`, 'unchanged, < 1e-4');
      audio.setSettings({ muted: false });
      await sleep(400);
      audio.ui({ kind: 'select' });
      await sleep(60);
      check('unmuted again: ui() plays (started +1)', audio.stats().started.ui === s1.ui + 1, `ui ${s1.ui} -> ${audio.stats().started.ui}`, '+1');
      await sleep(500);

      audio.setSettings({ uiSounds: false });
      const u0 = { ...audio.stats().started };
      audio.stats();
      pk = 0;
      for (const kind of UI_KINDS) { audio.ui({ kind }); await sleep(35); pk = Math.max(pk, audio.stats().peak); }
      await sleep(150); pk = Math.max(pk, audio.stats().peak);
      const u1 = audio.stats().started;
      check('uiSounds off (setSettings({ uiSounds: false })): all 12 kinds are silent and not counted', UI_KINDS.every((k) => u1['ui:' + k] === u0['ui:' + k]) && u1.ui === u0.ui && pk < 1e-4, `ui ${u0.ui} -> ${u1.ui}, peak ${pk.toExponential(1)}`, 'unchanged, < 1e-4');
      audio.setSettings({ uiSounds: 'no' });
      audio.ui({ kind: 'press' });
      check('uiSounds: a non-boolean value is ignored (still off)', audio.stats().started.ui === u1.ui, `ui ${u1.ui} -> ${audio.stats().started.ui}`, 'unchanged');
      audio.setSettings({ uiSounds: true });
      audio.ui({ kind: 'press' });
      await sleep(60);
      check('uiSounds back on: ui() plays again (started +1)', audio.stats().started.ui === u1.ui + 1, `ui ${u1.ui} -> ${audio.stats().started.ui}`, '+1');
      await sleep(400);
    }

    /* ───── 4. touch hover: the helper the delegated listener asks ───── */
    check('hover on touch: hoverSoundAllowed("touch") is false, "mouse" and "pen" true, unknown / empty false', hoverSoundAllowed('touch') === false && hoverSoundAllowed('mouse') === true && hoverSoundAllowed('pen') === true && hoverSoundAllowed('') === false && hoverSoundAllowed(undefined) === false, ['touch', 'mouse', 'pen', '', undefined].map((p) => `${p}:${hoverSoundAllowed(p)}`).join(' '), 'false true true false false');

    /* ───── 5. the per-kind gap, live ───── */
    {
      await sleep(300);
      const before = audio.stats().started['ui:tick'], th0 = audio.detailStats().throttled.ui;
      const t0 = performance.now();
      let n = 0;
      while (performance.now() - t0 < 400) { audio.ui({ kind: 'tick' }); n++; await sleep(4); }
      const played = audio.stats().started['ui:tick'] - before, thr = audio.detailStats().throttled.ui - th0;
      const maxPlayed = Math.ceil(0.4 / UI_GAP_S.tick) + 1;
      check('rate limit, live: a tick every ~4 ms for 0.4 s plays at most one per 40 ms (<= 11) and the rest are counted as throttled', played >= 5 && played <= maxPlayed && played + thr === n, `${n} calls: ${played} played, ${thr} throttled`, `5..${maxPlayed}, played + throttled = calls`);
      await sleep(300);
    }

    /* ───── 6. ceremonies: the interface is quiet, except toast and trophy ───── */
    {
      await sleep(1200);
      const c0 = audio.detailStats().throttled.uiCeremony, s0 = { ...audio.stats().started };
      audio.reveal({ tier: 'rare', isNew: true });
      await sleep(80);
      for (const kind of ['tick', 'press', 'select', 'on', 'off', 'open', 'close', 'back', 'error', 'sticker']) audio.ui({ kind });
      const dropped = audio.detailStats().throttled.uiCeremony - c0;
      const s1 = audio.stats().started;
      check('during a reveal: tick press select on off open close back error sticker are all dropped (10 counted in throttled.uiCeremony, none started)', dropped === 10 && s1.ui === s0.ui, `dropped ${dropped}, ui ${s0.ui} -> ${s1.ui}`, '10, unchanged');
      audio.ui({ kind: 'toast' });
      await sleep(400);
      const s2 = audio.stats().started;
      check('during a reveal: toast plays', s2['ui:toast'] === s0['ui:toast'] + 1, `ui:toast ${s0['ui:toast']} -> ${s2['ui:toast']}`, '+1');
      audio.ui({ kind: 'trophy' });
      await sleep(100);
      const s3 = audio.stats().started;
      check('during a reveal: trophy plays', s3['ui:trophy'] === s0['ui:trophy'] + 1, `ui:trophy ${s0['ui:trophy']} -> ${s3['ui:trophy']}`, '+1');
      // wait until the reveal group is gone, then the grace (0.25 s)
      for (let i = 0; i < 100 && audio.stats().live > 0; i++) await sleep(100);
      await sleep(500);
      const s4 = audio.stats().started.ui;
      audio.ui({ kind: 'press' });
      await sleep(60);
      check('after the reveal has ended (+ the 0.25 s grace): the interface sounds again', audio.stats().started.ui === s4 + 1, `ui ${s4} -> ${audio.stats().started.ui}`, '+1');
      // a merge charge, aborted: the interface comes back at once (+ grace)
      await sleep(400);
      const h = audio.mergeStart({ tier: 'epic', chargeS: 3 });
      await sleep(150);
      const m0 = audio.detailStats().throttled.uiCeremony;
      audio.ui({ kind: 'tick' });
      const heldOff = audio.detailStats().throttled.uiCeremony - m0;
      h.stop();
      await sleep(600);
      const s5 = audio.stats().started.ui;
      audio.ui({ kind: 'select' });
      await sleep(60);
      check('merge charge: tick is dropped while charging; after stop() the interface sounds again within 0.6 s', heldOff === 1 && audio.stats().started.ui === s5 + 1, `held off ${heldOff}, ui ${s5} -> ${audio.stats().started.ui}`, '1, +1');
      await sleep(600);
    }

    /* ───── 7. priority: a trophy is not cut by a press; a second trophy takes over ───── */
    {
      await sleep(800);
      const b0 = audio.detailStats().throttled.uiBusy, s0 = { ...audio.stats().started };
      audio.ui({ kind: 'trophy' });
      await sleep(100);
      audio.ui({ kind: 'press' });
      audio.ui({ kind: 'toast' });
      audio.ui({ kind: 'error' });
      const busy = audio.detailStats().throttled.uiBusy - b0;
      const s1 = audio.stats().started;
      check('a trophy in its protected window (0.7 s) is not cut: press, toast and error are dropped (3 counted in throttled.uiBusy)', busy === 3 && s1.ui === s0.ui + 1, `busy +${busy}, ui ${s0.ui} -> ${s1.ui}`, '+3, +1');
      await sleep(700);
      audio.ui({ kind: 'press' });
      await sleep(60);
      check('after the protected window the press plays (takes over with a crossfade)', audio.stats().started['ui:press'] === s0['ui:press'] + 1, `ui:press ${s0['ui:press']} -> ${audio.stats().started['ui:press']}`, '+1');
      await sleep(500);
    }

    /* ───── 8. a storm of random calls: bounded voices, bounded peak ───── */
    {
      await sleep(600);
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const before = audio.stats().started.ui;
      let maxLive = 0, maxNodes = 0, pk = 0, calls = 0;
      audio.stats();
      const t0 = performance.now();
      while (performance.now() - t0 < 5000) {
        safe('storm', () => audio.ui({ kind: UI_KINDS[Math.floor(rnd() * UI_KINDS.length)], calm: rnd() < 0.3 })); calls++;
        await sleep(6);
        const s = audio.stats();
        maxLive = Math.max(maxLive, s.live); maxNodes = Math.max(maxNodes, s.liveNodes); pk = Math.max(pk, s.peak);
      }
      const played = audio.stats().started.ui - before;
      info.storm = { calls, played, maxLive, maxNodes, peak: pk };
      check('storm: 5 s of random kinds every ~6 ms: 0 exceptions, never more than 3 voice groups alive (one voice + the one fading), output peak <= 0.126', caught.length === 0 && maxLive <= 3 && pk <= PK, `${calls} calls, ${played} played, max live ${maxLive}, max nodes ${maxNodes}, peak ${pk.toFixed(4)}`, 'live <= 3, peak <= 0.126');
    }

    /* ───── 9. nothing leaks ───── */
    {
      for (let i = 0; i < 40 && audio.stats().live > 0; i++) await sleep(250);
      await sleep(300);
      const st = audio.stats();
      check('after the storm and a drain: 0 voice groups, 0 live nodes (engine counters), and every WebAudio node created was disconnected (independent tracker: live set back to the unlock baseline)', st.live === 0 && st.liveNodes === 0 && tr.live.size <= baseNodes, `live ${st.live}, nodes ${st.liveNodes}, tracker live ${tr.live.size} (baseline ${baseNodes})`, '0, 0, <= baseline');
      info.endState = { live: st.live, liveNodes: st.liveNodes, tracker: tr.live.size };
      audio.dispose();
    }
    info.caught = caught;
  } catch (e) {
    check('ui live engine tests ran to the end', false, String(e && e.stack || e), 'no exception');
  } finally {
    tr.restore(); spy.restore();
  }
  return { checks, info };
}
