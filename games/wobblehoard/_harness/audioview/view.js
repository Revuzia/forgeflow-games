// Sound lab page + offline render API for _harness/probe_audio.mjs. Imports the game's own audio sources straight from
// the Vite dev server (so the probe measures the shipping code, not a copy).
import { poke, release, land, pop, squish, blend } from '/src/audio/voices.ts';
import { createMasterChain } from '/src/audio/chain.ts';
import { createAudio } from '/src/audio/engine.ts';
import * as D from '/src/audio/dsp.ts';
import * as C from '/src/audio/ceremony.ts';
import { runEngineTests } from './engine_tests.js';

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
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(b64(buf.getChannelData(c)));
  return { sr, n: buf.length, channels: chans, t0, endTime: endOverride ?? voice.endTime, script: script && { events: script.events, endAt: script.endAt, marks: script.marks }, counters: { ...D.nodeCounters } };
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

window.AV = { ready: true, SR, renderVoice, renderCeremony, renderDuck, runEngineTests, consts: {
  TIERS: C.TIERS, CAPSULE_BUDGET_S: C.CAPSULE_BUDGET_S, MERGE_BUDGET_S: C.MERGE_BUDGET_S, PRE_ROLL_S: C.PRE_ROLL_S, REVEAL_DEFAULT_S: C.REVEAL_DEFAULT_S,
  MERGE_CHARGE_S: C.MERGE_CHARGE_S, MERGE_BURST_S: C.MERGE_BURST_S, BURST_GAP_S: C.BURST_GAP_S, CALM_SCALE: C.CALM_SCALE, MYTHIC_MOTIFS: C.MYTHIC_MOTIFS,
} };
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
