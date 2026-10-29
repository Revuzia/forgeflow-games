// VALE harness — the .m4a path starts a bed on its first piece (final parity AUD-m3, the .m4a half).
//
//   node _harness/probe_audio_pieces.mjs [--bed mus_match_rift] [--out <report.json>]
//
// The REAL engine (src/audio/index.ts) against content/audio.json as it is now, on a browser that cannot decode Ogg
// Opus (canPlayType '' → the session is on .m4a from the start). Only WebAudio is faked, but with REAL samples: every
// decodeAudioData runs ffmpeg on the shipped file at the context's rate (48 kHz, and 44.1 kHz, where each piece is
// resampled on its own like a browser resamples each decode), every AudioParam keeps its scheduled curve, and the
// main stem's output is rendered sample by sample from the scheduled sources × their gain curves.
//   P1  the bed's first request is its first piece: no .ogg, no whole .m4a, no layer before the stitch; the first
//       piece starts the bed while the second is still decoding
//   P2  every later piece is scheduled at its place on the timeline (t0 + its start, offset 0) cross-fading in over the
//       run-on of the one before; the stitched stem takes over at the last piece's start (offset = that start), loops
//       on the bed's length, and only then do the layers load (and join on a bar)
//   P3  what you hear is the whole .m4a: the rendered output within 0.1 s of every joint and of the loop's wrap
//       against the whole .m4a's own decode, below 3.5 kHz (above it AAC's noise substitution draws fresh noise in
//       every decode): ≤ −60 dB at 48 kHz; at 44.1 kHz ≤ −40 dB (two resamplings of the same music)
//   P4  the stitched stem is kept: the bed's next start fetches nothing and starts at once
//   P5  a piece that fails hands over to the whole .m4a at once, where the timeline is (no restart from 0)
// Exit 0 = all hold, 1 = a gate fails. Report → _harness/_reports/fw_W3_pieces.json.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = opt('--out', join(HERE, '_reports', 'fw_W3_pieces.json'));
const BED = opt('--bed', 'mus_match_rift');
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', 'ffmpeg'].find((f) => spawnSync(f, ['-version']).status === 0);

// ── a fake WebAudio with real samples ───────────────────────────────────────────────────────────────────────
class Param {
  constructor(v) { this.v0 = v; this._v = v; this.ev = []; }
  get value() { return this._v; }
  set value(v) { this._v = v; if (!this.ev.length) this.v0 = v; }
  push(e) { this.ev.push(e); this.ev.sort((a, b) => a.t - b.t); }
  setValueAtTime(v, t) { this.push({ k: 'set', t, v }); this._v = v; }
  linearRampToValueAtTime(v, t) { this.push({ k: 'lin', t, v }); this._v = v; }
  setTargetAtTime(v, t, tc) { this.push({ k: 'tgt', t, v, tc }); this._v = v; }
  cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t); }
  at(t) {
    let v = this.v0, tp = 0;
    for (let i = 0; i < this.ev.length; i++) {
      const e = this.ev[i];
      if (e.k === 'lin') {
        if (t < e.t) return e.t > tp ? v + (e.v - v) * (t - tp) / (e.t - tp) : e.v;
        v = e.v; tp = e.t; continue;
      }
      if (e.t > t) break;
      if (e.k === 'set') { v = e.v; tp = e.t; continue; }
      const end = Math.min(t, this.ev[i + 1]?.t ?? Infinity);
      v = e.v + (v - e.v) * Math.exp(-(end - e.t) / e.tc); tp = end;
    }
    return v;
  }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.gain = new Param(1); this.channelCount = 2; }
  connect(d) { this.outs.push(d); return d; }
  disconnect() { this.outs = []; }
}
class Buf {
  constructor(ch, n, sr, ref) { this.numberOfChannels = ch; this.length = n; this.sampleRate = sr; this.duration = n / sr; this.ref = ref; this.data = Array.from({ length: ch }, () => new Float32Array(n)); }
  getChannelData(c) { return this.data[c]; }
}
const fileOf = (ref) => join(ROOT, 'audio', 'out', ref.replace(/^assets\/audio\//, ''));
function decodeFile(ref, sr) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', fileOf(ref), '-f', 'f32le', '-ac', '2', '-ar', String(sr), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  const f = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
  const b = new Buf(2, f.length / 2, sr, ref);
  for (let i = 0, n = b.length; i < n; i++) { b.data[0][i] = f[2 * i]; b.data[1][i] = f[2 * i + 1]; }
  return b;
}
let SR = 48000;
const DELAY = {};          // ref → a promise its decode waits for
const FAIL = new Set();    // refs whose fetch fails
const FETCHED = [];
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = SR; this.destination = new Node(this, 'destination'); this.started = []; }
  createGain() { return new Node(this, 'gain'); }
  createStereoPanner() { const n = new Node(this, 'panner'); n.pan = new Param(0); return n; }
  createBiquadFilter() { const n = new Node(this, 'biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createWaveShaper() { const n = new Node(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createDynamicsCompressor() { const n = new Node(this, 'compressor'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
  createBuffer(ch, n, sr) { return new Buf(ch, n, sr, 'stitched'); }
  createBufferSource() {
    const n = new Node(this, 'source');
    n.playbackRate = new Param(1); n.loop = false; n.loopStart = 0; n.loopEnd = 0;
    n.start = (when = this.currentTime, offset = 0) => { n.when = Math.max(when, this.currentTime); n.offset = offset; this.started.push(n); };
    n.stop = (t = this.currentTime) => { n.stopAt = t; };
    return n;
  }
  async decodeAudioData(b) {
    if (DELAY[b.ref]) await DELAY[b.ref];
    const buf = decodeFile(b.ref, this.sampleRate);
    if (!buf) throw new Error('decode');
    return buf;
  }
  resume() { return Promise.resolve(); }
}
globalThis.AudioContext = FakeCtx;
globalThis.window = globalThis;
globalThis.setInterval = ((orig) => (fn, ms) => (ms === 250 ? 0 : orig(fn, ms)))(globalThis.setInterval);
globalThis.addEventListener = () => {};
globalThis.document = { hidden: false, addEventListener() {}, createElement: () => ({ canPlayType: () => '' }) };   // no Ogg Opus
globalThis.location = { search: '' };
globalThis.fetch = async (url) => { FETCHED.push(url); return FAIL.has(url) ? { ok: false } : { ok: true, arrayBuffer: async () => ({ ref: url }) }; };

// ── content/audio.json as it is now, with the m4a map the content build writes ─────────────────────────────────
const { AudioDef } = await import('../src/contracts/catalog.ts');
const strip = (o) => (Array.isArray(o) ? o.map(strip) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, strip(v)])) : o);
const audio = AudioDef.parse(strip(JSON.parse(readFileSync(join(ROOT, 'content', 'audio.json'), 'utf8'))));
const oggs = [...Object.values(audio.cues).flatMap((c) => c.files), ...Object.values(audio.music).flatMap((m) => [m.file, ...m.layers.map((l) => l.file)])].filter((f) => f.endsWith('.ogg'));
audio.m4a = Object.fromEntries(oggs.map((f) => [f, f.replace(/\.ogg$/, '.m4a')]));
const bdef = audio.music[BED];
if (!bdef) { console.log(`FAIL: no bed ${BED}`); process.exit(1); }
// the bed's `pieces` (older content: its 'seg_<s>' layers)
const pieces = (bdef.pieces?.length ? bdef.pieces.map((p) => ({ at: p.at, file: p.file }))
  : bdef.layers.filter((l) => l.id.startsWith('seg_')).map((l) => ({ at: Number(l.id.slice(4)), file: l.file }))).sort((a, b) => a.at - b.at);
const layers = bdef.layers.filter((l) => !l.id.startsWith('seg_'));
const wholeRef = audio.m4a[bdef.file];
const { createAudioEngine } = await import('../src/audio/index.ts');
const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const failures = [];
const report = { probe: 'probe_audio_pieces', bed: BED, pieces: pieces.map((p) => p.at) };
if (pieces.length < 2) { console.log(`FAIL: ${BED} lists no .m4a pieces`); process.exit(1); }

/** a fresh engine on the .m4a path at context rate `sr` */
function engineAt(sr) {
  SR = sr;
  FETCHED.length = 0;
  const eng = createAudioEngine({ catalog: { audio, fighters: [] }, assetUrl: (r) => r, settings: SETTINGS });
  eng.cue('ui_click', null);
  return eng;
}
/** the main stem's output (channel 0) over [ta, tb) of context time at the context rate, from every started source of
 *  `refs` (the pieces and the stitched stem) × its own gain curve */
function render(ctx, srcs, ta, tb) {
  const sr = ctx.sampleRate, n = Math.round((tb - ta) * sr), out = new Float64Array(n);
  for (const s of srcs) {
    const d = s.buffer.getChannelData(0), g = s.outs[0].gain;
    const le = s.loop ? (s.loopEnd || s.buffer.duration) : Infinity, ls = s.loopStart || 0;
    for (let k = 0; k < n; k++) {
      const t = ta + k / sr;
      if (t < s.when - 1e-9 || t >= (s.stopAt ?? Infinity)) continue;
      let p = s.offset + (t - s.when);
      if (p >= le) p = ls + ((p - le) % (le - ls));
      const x = p * sr, i = Math.floor(x + 1e-6);
      if (i >= d.length) continue;
      const fr = Math.max(0, x - i);
      out[k] += (d[i] * (1 - fr) + (d[i + 1] ?? 0) * fr) * g.at(t);
    }
  }
  return out;
}
/** zero-phase brick-wall low-pass (DFT; windows are short) */
function low(x, sr, hz = 3500) {
  const n = x.length, kmax = Math.floor(hz * n / sr), re = new Float64Array(kmax + 1), im = new Float64Array(kmax + 1);
  for (let k = 0; k <= kmax; k++) { let a = 0, b = 0; const w = -2 * Math.PI * k / n; for (let j = 0; j < n; j++) { a += x[j] * Math.cos(w * j); b += x[j] * Math.sin(w * j); } re[k] = a; im[k] = b; }
  const y = new Float64Array(n);
  for (let j = 0; j < n; j++) { let v = re[0]; for (let k = 1; k <= kmax; k++) { const w = 2 * Math.PI * k * j / n; v += 2 * (re[k] * Math.cos(w) - im[k] * Math.sin(w)); } y[j] = v / n; }
  return y;
}
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
/** the rendered output against the whole .m4a's decode at bed positions [p0, p1), below 3.5 kHz, dB re its level */
function errAt(ctx, srcs, t0, whole, p0, p1) {
  const y = render(ctx, srcs, t0 + p0, t0 + p1);
  const sr = ctx.sampleRate, d = whole.getChannelData(0), n = whole.length, r = new Float64Array(y.length);
  for (let k = 0; k < r.length; k++) r[k] = d[(Math.round((p0 + k / sr) * sr) % n + n) % n];
  const e = y.map((v, k) => v - r[k]);
  const lr = low(r, sr), le = low(e, sr), m = Math.floor(y.length / 4);
  return 20 * Math.log10((rms(le.slice(m, -m)) + 1e-12) / (rms(lr.slice(m, -m)) + 1e-12));
}

for (const sr of [48000, 44100]) {
  const key = sr === 48000 ? 'at48k' : 'at44k';
  const eng = engineAt(sr);
  const ctx = eng.ctx;
  const R = (report[key] = {});
  let release = {};
  for (const p of pieces.slice(1)) DELAY[p.file] = new Promise((r) => { release[p.file] = r; });
  eng.music(BED);
  await flush();
  const first = FETCHED.filter((u) => u.includes('/music/'));
  const src0 = ctx.started.find((s) => s.buffer?.ref === pieces[0].file);
  R.P1 = { firstRequests: first.slice(0, 2), firstPieceStarted: !!src0, beforeSecondDecoded: !!src0 };
  if (first[0] !== pieces[0].file) failures.push(`${key} P1: the first request was ${first[0]}`);
  if (!src0) failures.push(`${key} P1: the first piece did not start the bed`);
  const t0 = src0?.when ?? 0;
  // the rest decode one after another, the bed playing on (from the second piece's decode, 20.3 s in)
  for (const [i, p] of pieces.slice(1).entries()) {
    if (i === 1) ctx.currentTime = t0 + 20.3;
    release[p.file](); await flush(); await flush();
  }
  const all = FETCHED.slice();
  const early = all.slice(0, all.indexOf(pieces[pieces.length - 1].file) + 1);
  const srcs = ctx.started.filter((s) => s.buffer && (s.buffer.ref === 'stitched' || pieces.some((p) => p.file === s.buffer.ref)));
  const stitched = srcs.find((s) => s.buffer.ref === 'stitched');
  const sched = pieces.slice(1, -1).map((p) => { const s = srcs.find((x) => x.buffer.ref === p.file); return s ? { at: p.at, when: +(s.when - t0).toFixed(6), offset: s.offset } : null; });
  R.P2 = { scheduled: sched, stitched: stitched ? { when: +(stitched.when - t0).toFixed(6), offset: stitched.offset, loop: stitched.loop, loopEnd: stitched.loopEnd, length: stitched.buffer.length } : null,
    layersBeforeStitch: early.filter((u) => layers.some((l) => audio.m4a[l.file] === u)).length, wholeFetched: all.includes(wholeRef), oggFetched: all.some((u) => u.endsWith('.ogg') && u.includes('/music/')) };
  if (sched.some((s, i) => !s || Math.abs(s.when - pieces[i + 1].at) > 1e-6 || s.offset !== 0)) failures.push(`${key} P2: pieces scheduled ${JSON.stringify(sched)}`);
  const last = pieces[pieces.length - 1].at;
  if (!stitched || Math.abs(stitched.when - t0 - last) > 1e-6 || Math.abs(stitched.offset - last) > 1e-6 || !stitched.loop) failures.push(`${key} P2: take-over ${JSON.stringify(R.P2.stitched)}`);
  if (R.P2.layersBeforeStitch || R.P2.wholeFetched || R.P2.oggFetched) failures.push(`${key} P2: fetched early ${JSON.stringify({ layers: R.P2.layersBeforeStitch, whole: R.P2.wholeFetched, ogg: R.P2.oggFetched })}`);
  const lay = ctx.started.find((s) => layers.some((l) => audio.m4a[l.file] === s.buffer?.ref));
  if (layers.length) {
    const bar = (60 / bdef.bpm) * 4, k = lay ? (lay.when - t0) / bar : NaN;
    R.P2.layer = lay ? { when: +(lay.when - t0).toFixed(3), onBar: Math.abs(k - Math.round(k)) < 1e-6 } : null;
    if (!lay || !R.P2.layer.onBar) failures.push(`${key} P2: layer ${JSON.stringify(R.P2.layer)}`);
  }
  // P3: what you hear at every joint and at the wrap
  const whole = decodeFile(wholeRef, sr);
  const len = whole.duration;
  const joints = [...pieces.slice(1).map((p) => p.at), len];
  R.P3 = Object.fromEntries(joints.map((j) => [j === len ? `wrap ${len}` : `${j}`, +errAt(ctx, srcs, t0, whole, j - 0.1, j + 0.1).toFixed(1)]));
  const gate = sr === 48000 ? -60 : -40;
  for (const [j, v] of Object.entries(R.P3)) if (!(v <= gate)) failures.push(`${key} P3: at ${j} s the output is ${v} dB off the whole .m4a (gate ${gate})`);
  // P4: the next start of the bed
  if (sr === 48000) {
    eng.music(null); await flush();
    const n0 = FETCHED.length, s0 = ctx.started.length;
    eng.music(BED); await flush();
    const main = ctx.started.slice(s0).find((s) => s.buffer?.ref === 'stitched');
    R.P4 = { fetched: FETCHED.slice(n0).filter((u) => u === wholeRef || pieces.some((p) => p.file === u)).length, startedFromCache: !!main, offset: main?.offset ?? null };
    if (R.P4.fetched || !main || main.offset !== 0) failures.push(`P4: restart ${JSON.stringify(R.P4)}`);
  }
}

// P5: the second piece fails → the whole .m4a takes over where the timeline is
{
  const eng = engineAt(48000);
  const ctx = eng.ctx;
  for (const k of Object.keys(DELAY)) delete DELAY[k];
  FAIL.add(pieces[1].file);
  let rel;
  DELAY[wholeRef] = new Promise((r) => { rel = r; });
  eng.music(BED);
  await flush();
  const t0 = ctx.started.find((s) => s.buffer?.ref === pieces[0].file)?.when ?? 0;
  ctx.currentTime = t0 + 5;
  rel(); await flush();
  const w = ctx.started.find((s) => s.buffer?.ref === wholeRef);
  const pos = w ? w.offset - (w.when - t0) : null;      // the whole's offset against the timeline at its start
  {
    report.P5 = { wholeStarted: !!w, at: w ? +(w.when - t0).toFixed(3) : null, offset: w ? +w.offset.toFixed(3) : null, onTimeline: pos !== null && Math.abs(pos) < 1e-6 };
    if (!w || !report.P5.onTimeline || w.offset < 4.9) failures.push(`P5: fallback ${JSON.stringify(report.P5)}`);
  }
  FAIL.clear();
}

report.failures = failures; report.pass = failures.length === 0;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
for (const k of ['at48k', 'at44k']) console.log(`${k}: P1 ${JSON.stringify(report[k].P1)}\n  P2 ${JSON.stringify(report[k].P2)}\n  P3 (dB) ${JSON.stringify(report[k].P3)}`);
console.log(`P4 ${JSON.stringify(report.at48k.P4)} · P5 ${JSON.stringify(report.P5)}`);
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : `PASS: the .m4a path starts ${BED} on its first ${pieces[1].at} s piece, joins the rest on its timeline and hands over to the stitched stem without a seam`);
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
