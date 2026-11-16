// PG_AUDIO page-side render API for life_checks.mjs: creature phrases synthesised straight from src/audio/creature.ts (no engine), the
// node bookkeeping (AU-11) and the DelayNode count (AU-12). Loaded by view.js into window.AV.
import { createMasterChain } from '/src/audio/chain.ts';
import * as D from '/src/audio/dsp.ts';
import * as CR from '/src/audio/creature.ts';

const SR = 48000;
function b64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Render phrases offline through the real master chain at master 1. spec: { secs, voices (the Voices setting, default 1), phrases: [{ at,
 * syl: [[id, deg, start, len], ...], flavour, register, pitch, pan, level, group, echo, sing, field }], chain (default true) }.
 * Returns { channels: [mono b64], meta: [{ base, notes, nodes }], delays (createDelay calls) }.
 */
async function renderPhrases(spec) {
  const ctx = new OfflineAudioContext(1, Math.ceil((spec.secs ?? 1.5) * SR), SR);
  let delays = 0;
  const cd = ctx.createDelay.bind(ctx);
  ctx.createDelay = (...a) => { delays++; return cd(...a); };
  let out = ctx.destination;
  if (spec.chain !== false) {
    const chain = createMasterChain(ctx);
    chain.apply({ master: 1, squishBoost: 0, muted: false, chatter: spec.voices ?? 1 }, true);
    out = CR.chatterBus(ctx, chain.chatter).norm;
  }
  const rng = D.makeRng(spec.seed ?? 5);
  const meta = [];
  for (const ph of spec.phrases) {
    const syl = new Float32Array(16);
    ph.syl.forEach((q, k) => syl.set(q, k * 4));
    const n = ph.syl.length;
    const reg = ph.register === 1 ? 1 : 0, group = ph.group ?? 1;
    const amp = CR.WHOLE_PEAK * (ph.level ?? 1) * (reg ? D.dbToGain(CR.PIECE_DB + (group >= 2 ? CR.GROUP_DB : 0)) : 1);
    const before = D.nodeCounters.created;
    const base = { syl, n, flavour: ph.flavour ?? 0, register: reg, pitch: ph.pitch ?? 1, pan: ph.pan ?? 0, group, sing: !!ph.sing, fieldAt: () => ph.field ?? 0, rng };
    CR.creaturePhrase(ctx, out, ph.at ?? 0.05, { ...base, amp });
    const nodes = D.nodeCounters.created - before;
    let echoNodes = 0;
    if (ph.echo) { const b2 = D.nodeCounters.created; CR.creaturePhrase(ctx, out, (ph.at ?? 0.05) + CR.ECHO_S, { ...base, amp: amp * D.dbToGain(CR.ECHO_DB), echo: true }); echoNodes = D.nodeCounters.created - b2; }
    const b = CR.baseNote(base.pitch, reg);
    const notes = ph.syl.map((q) => (ph.sing ? CR.sungNote(b, q[1], ph.field ?? 0) : CR.degNote(b, q[1])));
    meta.push({ base: b, notes, nodes, echoNodes, len: CR.phraseLen(syl, n) });
  }
  const buf = await ctx.startRendering();
  return { sr: SR, n: buf.length, channels: [b64(buf.getChannelData(0))], meta, delays };
}

/** AU-11: `count` random phrases (1..4 syllables, every flavour, register, group, pan, echo) built densely on one offline context and
 *  rendered; returns the node counters before, right after building, and after every 'ended' has arrived. */
async function phraseLeak(spec) {
  const count = spec.count ?? 1250, secs = spec.secs ?? 40;
  const ctx = new OfflineAudioContext(1, Math.ceil(secs * 22050), 22050);
  const chain = createMasterChain(ctx);
  chain.apply({ master: 1, squishBoost: 0, muted: false }, true);
  const bus = CR.chatterBus(ctx, chain.chatter);
  await new Promise((r) => setTimeout(r, 30));
  const base = D.liveNodeCount();
  const r = D.makeRng(spec.seed ?? 9);
  let syllables = 0, maxPer = 0;
  for (let i = 0; i < count; i++) {
    const n = 1 + Math.floor(r() * 4);
    const syl = new Float32Array(16);
    let t = 0;
    for (let k = 0; k < n; k++) { const id = Math.floor(r() * 8); syl.set([id, Math.floor(r() * 9) - 4, t, 0.5 + 1.5 * r()], k * 4); t += CR.SYL_S[id] * 2 + 0.05; }
    const reg = r() < 0.3 ? 1 : 0, echo = r() < 0.2;
    const before = D.nodeCounters.created;
    const p = { syl, n, flavour: Math.floor(r() * 6), register: reg, pitch: 0.7 + 0.7 * r(), pan: r() < 0.5 ? 0 : 2 * r() - 1, group: 1 + Math.floor(r() * 3), sing: r() < 0.2, fieldAt: () => Math.floor(r() * 4), rng: r, amp: 0.05, echo };
    CR.creaturePhrase(ctx, bus.norm, (i / count) * (secs - 3), p);
    maxPer = Math.max(maxPer, (D.nodeCounters.created - before) / Math.min(n, 1e9));
    syllables += n;
  }
  const built = D.liveNodeCount();
  await ctx.startRendering();
  await new Promise((r2) => setTimeout(r2, 300));
  return { base, built, after: D.liveNodeCount(), syllables, maxPerSyllable: maxPer };
}

export const lifeApi = { renderPhrases, phraseLeak, CR_CONST: { SYL_S: CR.SYL_S, WHOLE_PEAK: CR.WHOLE_PEAK, FIELD_REST: CR.FIELD_REST } };
