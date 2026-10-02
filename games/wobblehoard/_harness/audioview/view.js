// Sound lab page + offline render API for _harness/probe_audio.mjs. Imports the game's own audio sources straight from
// the Vite dev server (so the probe measures the shipping code, not a copy).
import { poke, release, land, pop, squish, blend } from '/src/audio/voices.ts';
import { createMasterChain } from '/src/audio/chain.ts';
import { createAudio } from '/src/audio/engine.ts';
import * as D from '/src/audio/dsp.ts';
import { runEngineTests } from './engine_tests.js';

export const SR = 48000;
const BOOSTED = new Set(['poke', 'squish', 'release']);

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
  let voice;
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
    default: throw new Error('unknown voice ' + spec.voice);
  }
  if (spec.killAt !== undefined) voice.kill(0.02, t0 + spec.killAt);
  const buf = await ctx.startRendering();
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(b64(buf.getChannelData(c)));
  return { sr, n: buf.length, channels: chans, t0, endTime: voice.endTime, script: script && { events: script.events, endAt: script.endAt, marks: script.marks }, counters: { ...D.nodeCounters } };
}

window.AV = { ready: true, SR, renderVoice, runEngineTests };

/* ───────────── human-facing sound lab (live engine) ───────────── */
const $ = (id) => document.getElementById(id);
const audio = createAudio();
const state = { amt: 0.7, pitch: 1 };
const hist = [];

async function unlock() { await audio.unlock(); sync(); }
function sync() {
  audio.setSettings({ master: +$('master').value, squishBoost: +$('boost').value, muted: $('mute').checked });
  state.amt = +$('amt').value; state.pitch = +$('pitch').value;
  $('pitchV').textContent = state.pitch.toFixed(2); $('amtV').textContent = state.amt.toFixed(2);
  $('masterV').textContent = (+$('master').value).toFixed(2); $('boostV').textContent = (+$('boost').value).toFixed(2);
}
for (const id of ['master', 'boost', 'mute', 'amt', 'pitch']) $(id).addEventListener('input', sync);
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
