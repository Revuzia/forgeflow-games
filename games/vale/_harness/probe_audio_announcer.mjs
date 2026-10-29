// VALE harness — the announcer speaks one line at a time, and the mix makes room for it (final parity AUD-3, AUD-7,
// AUD-m3, AUD-m4: the engine halves).
//
//   node _harness/probe_audio_announcer.mjs [--out <report.json>]
//
// The REAL engine (src/audio/index.ts) against content/audio.json as it is now, on a stub match (you: player 0, team 0)
// fed scripted SimEvents. Only WebAudio is faked: sources END after their real file's length (the shipped .ogg), and
// every AudioParam keeps its scheduled curve, so a duck is read at any time.
//   A1  a structure that grants an objective (the Lantern: structure + announce + objective + announce in ONE tick)
//       speaks exactly one voice-bus line; its world sound (c_structure_fall) still plays
//   A2  one takedown's first-takedown + shutdown lines (same tick, same killer) are one line
//   A3  merge: a double takedown queued behind a playing line becomes the triple when it comes; only the triple speaks
//   A4  expiry: a band-4 line still waiting after its time-to-live is dropped, never spoken late
//   A5  preemption: a wipe (band 1) cuts a playing structure line short; a takedown (band 2) waits for it
//   A6  one at a time: over the whole script no two voice-bus lines overlap beyond the ring-out allowance
//   A7  ducking: under a line, music and ambience sit −6 dB and sfx −3 dB, a threat to your fighter is not ducked, and
//       the mix is back within 0.5 dB 0.8 s after the line
//   A8  the bell language: every line class resolves to its own cue (first, 2-5 tolls, shutdown, structure yours /
//       theirs, Sunsplinter and Longshade yours / theirs, other objectives, wipe yours / theirs)
//   A9  match flow / personal: match_start, sudden_death (announce), surrender_passed speak no announcer line; a
//       denied purchase is a ui-bus error, not a voice line
//   B1  the global budget: 80 combat events in one tick never hold more than 32 pooled voices
//   B2  heals: a lifesteal heal (self, the tick of its own damage) is silent; one target's heals within 250 ms are one
//   B3  the soft clip: a WaveShaper after the limiter, linear to −3.1 dBFS, never past −1 dBFS
//   B4  accessibility: mono sums the output to 1 channel, softenLoud (session/settings.ts) wires its compressor in (and out)
//   C1  a bed's main stem starts while its layer is still decoding; the layer joins on a bar, phase-locked
//   C2  draft layers: musicPhase / musicUrgency switch the 'phase_*' / 'urgency_*' layers; a 'stem*' layer loops on its
//       own length
//   C3  the shipped draft bed walks its own phases (picks from 16 s, final from 80 s) until musicPhase() drives it
//   C4  draft(s) (AudioPort.draft, the draft screen): s.phase 'ban' | 'pick' | 'finalize' drives the shipped draft bed's
//       phase layers and s.urgent its urgency layer, whether it comes before or after music('mus_draft'); draft(null)
//       hands the bed back to its own walk
//   C5  the .ogg path never fetches a main stem's .m4a piece (a bed's `pieces`; probe_audio_pieces covers the .m4a path)
// Exit 0 = all hold, 1 = a gate fails, 77 = no built catalog. Report → _harness/_reports/fw_W3_announcer.json.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'fw_W3_announcer.json');

// ── a fake WebAudio: params keep their schedule, sources end after their buffer ─────────────────────────────
class Param {
  constructor(v) { this.ev = []; this.v0 = v; this._v = v; }
  get value() { return this._v; }
  set value(v) { this._v = v; if (!this.ev.length) this.v0 = v; }
  setTargetAtTime(v, t, tc) { this.ev.push({ t, v, tc }); this.ev.sort((a, b) => a.t - b.t); this.value = v; }
  setValueAtTime(v, t) { this.ev.push({ t, v, tc: 0 }); this.ev.sort((a, b) => a.t - b.t); this.value = v; }
  cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t); }
  at(t) {
    let v = this.v0;
    const ev = this.ev.filter((e) => e.t <= t);
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i], end = Math.min(t, ev[i + 1]?.t ?? t);
      v = e.tc > 0 ? e.v + (v - e.v) * Math.exp(-(end - e.t) / e.tc) : e.v;
    }
    return v;
  }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.gain = new Param(1); this.channelCount = 2; }
  connect(d) { this.outs.push(d); return d; }
  disconnect() { this.outs = []; }
}
const DUR = {};
const DELAY = {};          // ref → a promise the decode waits for (C1)
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node(this, 'destination'); this.started = []; this.live = []; }
  createGain() { return new Node(this, 'gain'); }
  createStereoPanner() { const n = new Node(this, 'panner'); n.pan = new Param(0); return n; }
  createBiquadFilter() { const n = new Node(this, 'biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createWaveShaper() { const n = new Node(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; }
  createDynamicsCompressor() {
    const n = new Node(this, 'compressor');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    return n;
  }
  createBufferSource() {
    const n = new Node(this, 'source');
    n.playbackRate = new Param(1);
    n.start = (when = this.currentTime, offset = 0) => {
      n.when = Math.max(when, this.currentTime); n.offset = offset;
      n.endAt = n.when + (n.loop ? 1e9 : (n.buffer?.duration ?? 1));
      this.started.push(n); this.live.push(n);
    };
    n.stop = (t = this.currentTime) => { n.stopAt = Math.min(n.stopAt ?? Infinity, t); n.endAt = Math.min(n.endAt ?? Infinity, t); };
    return n;
  }
  advance(dt) {
    this.currentTime += dt;
    const keep = [];
    for (const n of this.live) { if (n.endAt <= this.currentTime) n.onended?.(); else keep.push(n); }
    this.live = keep;
  }
  async decodeAudioData(b) { if (DELAY[b.ref]) await DELAY[b.ref]; return { duration: DUR[b.ref] ?? 1, length: 48000, sampleRate: 48000, ref: b.ref }; }
  resume() { return Promise.resolve(); }
}
globalThis.AudioContext = FakeCtx;
globalThis.window = globalThis;
globalThis.setInterval = ((orig) => (fn, ms) => (ms === 250 ? 0 : orig(fn, ms)))(globalThis.setInterval);   // the engine's 4 Hz tick: driven by hand
globalThis.addEventListener = () => {};
globalThis.document = { hidden: false, addEventListener() {}, createElement: () => ({ canPlayType: () => 'probably' }) };
globalThis.location = { search: '' };
const FETCHED = [];
globalThis.fetch = async (url) => { FETCHED.push(url); return { ok: true, arrayBuffer: async () => ({ ref: url }) }; };

// ── the catalog (built, for the fighters / units) and content/audio.json as it is now ─────────────────────
const catRoot = join(ROOT, 'dist-catalog', 'schema-1');
if (!existsSync(catRoot)) { console.log('SKIP: no dist-catalog/ (run `npm run content`)'); process.exit(77); }
const ver = readdirSync(catRoot).sort().pop();
const raw = JSON.parse(readFileSync(join(catRoot, ver, 'catalog.json'), 'utf8'));
const { Catalog, AudioDef } = await import('../src/contracts/catalog.ts');
let catalog;
try { catalog = Catalog.parse(raw); } catch { catalog = raw; }
const strip = (o) => (Array.isArray(o) ? o.map(strip) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, strip(v)])) : o);
const audio = AudioDef.parse(strip(JSON.parse(readFileSync(join(ROOT, 'content', 'audio.json'), 'utf8'))));
function oggSeconds(path) {
  try {
    const fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(size, 512)); readSync(fd, head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(size, 65536)); readSync(fd, tail, 0, tail.length, size - tail.length);
    closeSync(fd);
    const pre = head.readUInt16LE(head.indexOf('OpusHead') + 10);
    const last = tail.lastIndexOf('OggS');
    return Number(tail.readBigUInt64LE(last + 6) - BigInt(pre)) / 48000;
  } catch { return 1; }
}
for (const c of Object.values(audio.cues)) for (const f of c.files) DUR[f] = oggSeconds(join(ROOT, 'audio', 'out', f.replace(/^assets\/audio\//, '')));
for (const m of Object.values(audio.music)) for (const f of [m.file, ...m.layers.map((l) => l.file)].filter((x) => x.endsWith('.ogg'))) DUR[f] = oggSeconds(join(ROOT, 'audio', 'out', f.replace(/^assets\/audio\//, '')));

const { createAudioEngine } = await import('../src/audio/index.ts');
const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };

// ── the stub match: you (player 0, entity 1, team 0), an ally (player 1, entity 4), two enemies (players 2-3) ──────
const E = {};
const ent = (id, kind, team, x, y, def) => (E[id] = { id, kind, team, x, y, alive: true, visibleMask: 3, statuses: [], def });
const F0 = catalog.fighters[0].id;
ent(1, 'fighter', 0, 100, 100, F0); ent(4, 'fighter', 0, 98, 100, F0);
ent(2, 'fighter', 1, 103, 100, F0); ent(3, 'fighter', 1, 104, 101, F0);
ent(9, 'structure', 1, 110, 100, 'lantern');
const players = [{ player: 0, team: 0, entity: 1, respawnIn: 0, abilities: [] }, { player: 1, team: 0, entity: 4, respawnIn: 0, abilities: [] },
  { player: 2, team: 1, entity: 2, respawnIn: 0, abilities: [] }, { player: 3, team: 1, entity: 3, respawnIn: 0, abilities: [] }];
let batchCb = null;
const stub = { you: 0, setup: { map: 'none' }, view: { time: 60, players, entity: (id) => E[id] }, onEvents: (cb) => { batchCb = cb; return () => { batchCb = null; }; } };
const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
eng.cue('ui_click', null);               // creates the context
const ctx = eng.ctx;
eng.attach(stub);
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
let simT = 60;
/** one sim tick's batch of events */
const batch = async (evs) => { simT += 1 / 30; stub.view.time = simT; batchCb(evs.map((e) => ({ t: simT, ...e }))); await flush(); };
/** let `s` seconds pass (the announcer's own timer is driven by hand) */
const wait = async (s) => { for (let k = 0; k < Math.round(s / 0.05); k++) { ctx.advance(0.05); eng.pumpAnn(); await flush(); } };
const voiceStarts = () => ctx.started.filter((n) => n.buffer && audio.cues[cueOf(n)]?.bus === 'voice');
const cueOf = (n) => Object.entries(audio.cues).find(([, c]) => c.files.includes(n.buffer.ref))?.[0];
const failures = [];
const report = { probe: 'probe_audio_announcer', catalog: ver };
const cueFor = (role) => audio.events[role];

// A1 — the Lantern (team 1's) falls to your team: one line
let v0 = voiceStarts().length, s0 = ctx.started.length;
await batch([
  { e: 'death', dst: 9, kind: 'structure' },
  { e: 'structure', id: 9, def: 'lantern', team: 1, destroyedBy: 0, final: false },
  { e: 'announce', key: 'structure_destroyed', team: 1, params: { def: 'lantern', by: 0 } },
  { e: 'objective', unit: 'lantern', team: 0, buff: 'lanternwake' },
  { e: 'announce', key: 'objective_taken', team: 0, params: { unit: 'lantern' } },
]);
const a1 = voiceStarts().slice(v0).map(cueOf);
const a1World = ctx.started.slice(s0).map(cueOf).filter((c) => c === cueFor('structureFall'));
report.A1 = { lines: a1, worldSound: a1World };
if (a1.length !== 1 || a1[0] !== cueFor('announce.structure.foe')) failures.push(`A1: the Lantern's fall spoke ${JSON.stringify(a1)} (want exactly [${cueFor('announce.structure.foe')}])`);
if (a1World.length !== 1) failures.push(`A1: the structure's world sound played ${a1World.length}x`);
await wait(4);

// A2 — your first takedown is also a shutdown: one line, the first-takedown toll
v0 = voiceStarts().length;
await batch([{ e: 'death', dst: 2, kind: 'fighter' }, { e: 'takedown', killer: 0, victim: 2 },
  { e: 'announce', key: 'first_blood', team: 0, player: 0 }, { e: 'announce', key: 'shutdown', team: 0, player: 0, params: { gold: 300, victim: 2 } }]);
await wait(4);
report.A2 = { lines: voiceStarts().slice(v0).map(cueOf) };
if (report.A2.lines.length !== 1 || report.A2.lines[0] !== cueFor('announce.first')) failures.push(`A2: first takedown + shutdown spoke ${JSON.stringify(report.A2.lines)}`);

// A3 — a structure line plays; an ally's double then triple queue behind it: only the triple speaks
v0 = voiceStarts().length;
await batch([{ e: 'announce', key: 'structure_destroyed', team: 0, params: { def: 'needle_outer' } }]);
await wait(0.3);
await batch([{ e: 'announce', key: 'multikill', team: 0, player: 1, params: { n: 2 } }]);
const queuedAfter2 = eng.announcer.queued.slice();
await wait(0.5);
await batch([{ e: 'announce', key: 'multikill', team: 0, player: 1, params: { n: 3 } }]);
const queuedAfter3 = eng.announcer.queued.slice();
await wait(5);
report.A3 = { queuedAfterDouble: queuedAfter2, queuedAfterTriple: queuedAfter3, lines: voiceStarts().slice(v0).map(cueOf) };
const want3 = [cueFor('announce.structure.own'), cueFor('announce.multi.3')];
if (JSON.stringify(report.A3.lines) !== JSON.stringify(want3)) failures.push(`A3: spoke ${JSON.stringify(report.A3.lines)} (want ${JSON.stringify(want3)})`);

// A4 — expiry: three lines at once (structure, another objective, a surrender vote that failed): the last one waits
// past its 3 s and is dropped
v0 = voiceStarts().length;
await batch([{ e: 'announce', key: 'structure_destroyed', team: 1, params: { def: 'needle_inner' } }]);
await batch([{ e: 'announce', key: 'objective_taken', team: 1, params: { unit: 'glasshorn' } },
  { e: 'announce', key: 'surrender_failed', team: 0 }]);
await wait(7);
report.A4 = { lines: voiceStarts().slice(v0).map(cueOf) };
if (report.A4.lines.includes(cueFor('announce.surrender_failed'))) failures.push(`A4: a band-4 line spoke after waiting past its time-to-live: ${JSON.stringify(report.A4.lines)}`);
if (report.A4.lines.length !== 2) failures.push(`A4: spoke ${JSON.stringify(report.A4.lines)} (want the structure and the objective)`);

// A5 — preemption: a structure line plays; an enemy multi (band 2) waits; your team wiped (band 1) cuts in
v0 = voiceStarts().length;
await batch([{ e: 'announce', key: 'structure_destroyed', team: 0, params: { def: 'needle_bell' } }]);
await wait(0.4);
const structVoice = voiceStarts().slice(v0)[0];
await batch([{ e: 'announce', key: 'multikill', team: 1, player: 2, params: { n: 2 } }]);
const afterMulti = voiceStarts().length - v0;
E[1].alive = false; E[4].alive = false; players[0].respawnIn = 10; players[1].respawnIn = 10;
await batch([{ e: 'death', dst: 4, kind: 'fighter' }]);
const cut = structVoice?.stopAt !== undefined && structVoice.stopAt < structVoice.when + structVoice.buffer.duration - 0.05;
await wait(5);
report.A5 = { lines: voiceStarts().slice(v0).map(cueOf), multiWaited: afterMulti === 1, structureCut: cut };
if (!cut) failures.push('A5: the wipe did not cut the playing structure line');
if (afterMulti !== 1) failures.push('A5: a band-2 line cut a playing band-3 line (only bands 0-1 preempt)');
if (report.A5.lines[1] !== cueFor('announce.wipe.own')) failures.push(`A5: spoke ${JSON.stringify(report.A5.lines)} (want the wipe second)`);
E[1].alive = true; E[4].alive = true; players[0].respawnIn = 0; players[1].respawnIn = 0;
await batch([{ e: 'respawn', player: 0 }]);
await wait(4);

// A7 — ducking under a line, threats exempt
const g = eng.graph;
const duck = (b, t) => 20 * Math.log10(eng.vduck.get(b).gain.at(t));
const tLine = ctx.currentTime;
await batch([{ e: 'announce', key: 'objective_taken', team: 0, params: { unit: 'sunsplinter' } }]);
await batch([{ e: 'damage', src: 2, dst: 1, amount: 30, dtype: 'physical', crit: false }]);
const hitOnYou = ctx.started[ctx.started.length - 1];
let node = hitOnYou; while (node && node.kind !== 'gain') node = node.outs[0];
const threatRoute = node?.outs[0] === eng.threat;
const until = eng.announcer.until;
const mid = tLine + 0.3;
report.A7 = { musicDb: +duck('music', mid).toFixed(2), ambienceDb: +duck('ambience', mid).toFixed(2), sfxDb: +duck('sfx', mid).toFixed(2),
  afterMusicDb: +duck('music', until + 0.8).toFixed(2), afterSfxDb: +duck('sfx', until + 0.8).toFixed(2), threatNotDucked: threatRoute };
if (Math.abs(report.A7.musicDb + 6) > 0.3 || Math.abs(report.A7.ambienceDb + 6) > 0.3 || Math.abs(report.A7.sfxDb + 3) > 0.3) failures.push(`A7: under a line music ${report.A7.musicDb} / ambience ${report.A7.ambienceDb} / sfx ${report.A7.sfxDb} dB (want -6 / -6 / -3)`);
if (report.A7.afterMusicDb < -0.5 || report.A7.afterSfxDb < -0.5) failures.push(`A7: 0.8 s after the line the duck is still ${report.A7.afterMusicDb} / ${report.A7.afterSfxDb} dB`);
if (!threatRoute) failures.push('A7: an enemy hit on you went through the ducked sfx bus');
await wait(4);

// A6 — one at a time over everything spoken so far
const vs = voiceStarts().map((n) => ({ cue: cueOf(n), at: n.when, end: Math.min(n.when + n.buffer.duration, n.stopAt ?? Infinity) })).sort((a, b) => a.at - b.at);
let worst = 0;
for (let i = 1; i < vs.length; i++) worst = Math.max(worst, Math.max(...vs.slice(0, i).map((p) => p.end)) - vs[i].at);
report.A6 = { lines: vs.length, worstOverlapS: +worst.toFixed(3) };
if (worst > 0.6 + 0.2) failures.push(`A6: two voice-bus lines overlap by ${worst.toFixed(2)} s (allowance 0.6 s ring-out + 0.2 s cut fade)`);

// A8 — the bell language: every class its own cue
const classes = {
  first: 'announce.first', toll2: 'announce.multi.2', toll3: 'announce.multi.3', toll4: 'announce.multi.4', toll5: 'announce.multi.5',
  shutdown: 'announce.shutdown', structureYours: 'announce.structure.own', structureTheirs: 'announce.structure.foe',
  sunsplinterYours: 'announce.objective.sunsplinter.own', sunsplinterTheirs: 'announce.objective.sunsplinter.foe',
  longshadeYours: 'announce.objective.longshade.own', longshadeTheirs: 'announce.objective.longshade.foe',
  objectiveYours: 'announce.objective.own', objectiveTheirs: 'announce.objective.foe', wipeYours: 'announce.wipe.own', wipeTheirs: 'announce.wipe.foe',
};
report.A8 = Object.fromEntries(Object.entries(classes).map(([k, r]) => [k, cueFor(r) ?? null]));
const ids = Object.values(report.A8);
if (ids.some((x) => !x || !audio.cues[x])) failures.push(`A8: an unbound line: ${JSON.stringify(report.A8)}`);
if (new Set(ids).size !== ids.length) failures.push('A8: two line classes share a cue');

// A9 — no line for flow events with their own sound; a denied purchase is a ui error
v0 = voiceStarts().length; s0 = ctx.started.length;
await batch([{ e: 'announce', key: 'match_start' }, { e: 'announce', key: 'sudden_death' }, { e: 'announce', key: 'surrender_passed', team: 0 }]);
await wait(1);
const a9Lines = voiceStarts().length - v0;
await batch([{ e: 'announce', key: 'shop_denied', team: 0, player: 0, params: { item: 'x', reason: 'gold' } }]);
await wait(0.5);
const denied = ctx.started.slice(s0).map(cueOf);
report.A9 = { flowLines: a9Lines, deniedPlayed: denied };
if (a9Lines !== 0) failures.push(`A9: match_start / sudden_death / surrender_passed announces spoke ${a9Lines} line(s)`);
if (!denied.includes(cueFor('shopDenied')) || denied.some((c) => audio.cues[c]?.bus === 'voice')) failures.push(`A9: a denied purchase played ${JSON.stringify(denied)}`);

// B1 — the global budget
await wait(3);
let maxPooled = 0;
const pooled = () => eng.voices.filter((v) => v.pooled).length;
const evs = [];
for (let i = 0; i < 80; i++) evs.push({ e: 'damage', src: [1, 2, 3, 4][i % 4], dst: [2, 1, 4, 3][i % 4], amount: 5, dtype: ['physical', 'magic', 'true'][i % 3], crit: i % 7 === 0 },
  { e: 'attack', src: [1, 2, 3, 4][i % 4], dst: [2, 1, 4, 3][i % 4] });
for (let k = 0; k < evs.length; k += 8) { eng.lastPlay.clear(); await batch(evs.slice(k, k + 8)); maxPooled = Math.max(maxPooled, pooled()); }
// then every one-shot combat cue (priority <= 7) at its own maxVoices, near you, yours or an ally's (a teamfight
// beyond any budget)
let tries = 0;
for (const [id, c] of Object.entries(audio.cues)) {
  if (c.loop || c.bus !== 'sfx' || c.priority > 7) continue;
  for (let i = 0; i < c.maxVoices; i++) { eng.lastPlay.clear(); eng.cue(id, { x: 100 + (i % 3), y: 100 }, 1, 0, { lift: i % 2 ? -1 : 0 }); tries++; }
  await flush();
  maxPooled = Math.max(maxPooled, pooled());
}
// a threat on you still gets a voice in the full pool (it outranks the lowest voice)
eng.lastPlay.clear();
const nBefore = ctx.started.length;
await batch([{ e: 'damage', src: 2, dst: 1, amount: 30, dtype: 'physical', crit: false }]);
const threatIn = ctx.started.length > nBefore;
report.B1 = { voicesTried: tries, maxPooledVoices: maxPooled, threatGotAVoice: threatIn };
if (maxPooled > 32) failures.push(`B1: ${maxPooled} pooled voices at once (budget 32)`);
if (maxPooled < 32) failures.push(`B1: the stress never filled the budget (${maxPooled} voices): vacuous`);
if (!threatIn) failures.push('B1: an enemy hit on you was dropped by the full pool');
await wait(3);

// B2 — heals
s0 = ctx.started.length;
await batch([{ e: 'damage', src: 1, dst: 2, amount: 40, dtype: 'physical', crit: false }, { e: 'heal', src: 1, dst: 1, amount: 4 }]);
const vamp = ctx.started.slice(s0).map(cueOf).filter((c) => c === cueFor('heal')).length;
await wait(1);
s0 = ctx.started.length;
await batch([{ e: 'heal', src: 1, dst: 4, amount: 30 }]);
ctx.advance(0.1);
await batch([{ e: 'heal', src: 1, dst: 4, amount: 30 }]);
const merged = ctx.started.slice(s0).map(cueOf).filter((c) => c === cueFor('heal')).length;
ctx.advance(0.3);
await batch([{ e: 'heal', src: 1, dst: 4, amount: 30 }]);
const later = ctx.started.slice(s0).map(cueOf).filter((c) => c === cueFor('heal')).length - merged;
report.B2 = { vampHealCues: vamp, twoHealsIn100ms: merged, healAfter400ms: later };
if (vamp) failures.push('B2: a lifesteal heal was voiced');
if (merged !== 1) failures.push(`B2: two heals on one target 100 ms apart played ${merged} chimes (want 1)`);
if (later !== 1) failures.push(`B2: a heal 400 ms later played ${later} chimes (want 1)`);

// B3 — the soft clip
let shaper = null;
for (let n = eng.graph.limiter; n && !shaper; n = n.outs[0]) if (n.kind === 'shaper') shaper = n;
const curve = shaper?.curve ? Array.from(shaper.curve) : [];
const N = curve.length;
const at = (x) => curve[Math.round(((x + 1) / 2) * (N - 1))];
report.B3 = { shaper: !!shaper, oversample: shaper?.oversample, maxOut: curve.length ? +Math.max(...curve.map(Math.abs)).toFixed(4) : null,
  linearAt0_6: curve.length ? +(at(0.6) - 0.6).toFixed(4) : null, outAt1: curve.length ? +at(1).toFixed(4) : null };
if (!shaper || report.B3.maxOut > 0.8913 || Math.abs(report.B3.linearAt0_6) > 1e-3) failures.push(`B3: soft clip ${JSON.stringify(report.B3)}`);

// B4 — accessibility
eng.settings({ ...SETTINGS.audio, mono: true, softenLoud: true });
// soften sits between the mix and the master volume: mix → compressor (→ makeup → master) when on, mix → master when off
const monoCh = eng.graph.out.channelCount, softIn = eng.mix.outs[0]?.kind === 'compressor' && eng.mix.outs[0] !== eng.graph.limiter
  && eng.mix.outs[0].outs[0]?.outs[0] === eng.master;
eng.settings({ ...SETTINGS.audio });
const stereoCh = eng.graph.out.channelCount, softOut = eng.mix.outs[0] === eng.master && eng.master.outs[0] === eng.graph.limiter;
report.B4 = { monoChannels: monoCh, softenWired: softIn, offChannels: stereoCh, softenUnwired: softOut };
if (monoCh !== 1 || stereoCh !== 2 || !softIn || !softOut) failures.push(`B4: ${JSON.stringify(report.B4)}`);

// C1 — a bed whose layer decodes slowly
const synced = (id) => !id.startsWith('stem') && !id.startsWith('phase_') && !id.startsWith('urgency_') && !id.startsWith('seg_');      // the combat layer
const bedId = Object.keys(audio.music).find((k) => audio.music[k].layers.length && synced(audio.music[k].layers[0].id));
const bdef = audio.music[bedId];
let release;
DELAY[bdef.layers[0].file] = new Promise((r) => { release = r; });
eng.attach(null);
eng.music(bedId);
await flush();
const tMain = ctx.started.find((n) => n.buffer?.ref === bdef.file && !n.c1seen);
const mainStarted = !!tMain;
if (tMain) tMain.c1seen = true;
ctx.advance(7.3);
release(); await flush();
const lay = ctx.started.find((n) => n.buffer?.ref === bdef.layers[0].file);
const bar = (60 / bdef.bpm) * 4;
const posMain = lay && tMain ? ((lay.when - tMain.when) % (DUR[bdef.file])) : null;
report.C1 = { bed: bedId, mainStartedBeforeLayer: mainStarted, layerAt: lay ? +(lay.when - tMain.when).toFixed(3) : null,
  onBar: lay ? Math.abs(((lay.when - tMain.when) / bar) - Math.round((lay.when - tMain.when) / bar)) < 1e-6 : false,
  layerOffset: lay ? +lay.offset.toFixed(3) : null, mainPosition: posMain === null ? null : +posMain.toFixed(3) };
if (!mainStarted) failures.push('C1: the main stem waited for its layer');
if (!lay || !report.C1.onBar || Math.abs(lay.offset - posMain) > 1e-6) failures.push(`C1: the layer joined ${JSON.stringify(report.C1)}`);

// C2 — draft layers on a test bed (phase_*, urgency, stem*)
const testBed = { file: bdef.file, bpm: 90, loopStart: 0, gain: 0.8,
  layers: [{ id: 'phase_pick', file: bdef.file }, { id: 'phase_finalize', file: bdef.file }, { id: 'urgency_local', file: bdef.file }, { id: 'stem_b', file: 'assets/audio/c_zone_loop.ogg' }] };
eng.beds.mus_probe_draft = testBed;
DUR['assets/audio/c_zone_loop.ogg'] = DUR['assets/audio/c_zone_loop.ogg'] ?? 2;
eng.music(bedId === 'x' ? null : 'mus_probe_draft');
await flush();
const bed = eng.bed;
const L = Object.fromEntries(bed.layers.map((l) => [l.id, l]));
const lv = (id, dt) => L[id].gain.gain.at(ctx.currentTime + dt);   // phases switch on the next bar (2.67 s at 90 BPM)
eng.musicPhase('pick'); const p1 = { picks: lv('phase_pick', 6), final: lv('phase_finalize', 6) };
eng.musicPhase('finalize'); const p2 = { picks: lv('phase_pick', 6), final: lv('phase_finalize', 6) };
eng.musicUrgency(true); const u1 = lv('urgency_local', 0.5);
eng.musicUrgency(false); const u0 = lv('urgency_local', 1.0);
eng.musicPhase(null); const p0 = { picks: lv('phase_pick', 6), final: lv('phase_finalize', 6) };
const stemSrc = L.stem_b.src;
report.C2 = { picks: p1, final: p2, none: p0, urgencyOn: +u1.toFixed(3), urgencyOff: +u0.toFixed(3),
  stemLoopEnd: stemSrc?.loopEnd ?? null, stemOwnLength: DUR['assets/audio/c_zone_loop.ogg'], stemGain: +L.stem_b.gain.gain.at(ctx.currentTime + 4).toFixed(3) };
const on = (x) => x > 0.95, off = (x) => x < 0.05;
if (!(on(p1.picks) && off(p1.final) && on(p2.picks) && on(p2.final) && off(p0.picks) && off(p0.final))) failures.push(`C2: phases ${JSON.stringify({ p1, p2, p0 })}`);
if (!(on(u1) && off(u0))) failures.push(`C2: urgency on ${u1} off ${u0}`);
if (!stemSrc || Math.abs(stemSrc.loopEnd - report.C2.stemOwnLength) > 1e-6 || !on(report.C2.stemGain)) failures.push(`C2: stem ${JSON.stringify(report.C2)}`);

// C3 — the real draft bed walks its own phases while nobody drives them, and stops walking once musicPhase() is called
const draft = audio.music.mus_draft;
if (draft?.layers.some((l) => l.id.startsWith('phase_'))) {
  eng.music('mus_draft');
  await flush();
  const D = Object.fromEntries(eng.bed.layers.map((l) => [l.id, l]));
  const t0 = eng.bed.t0;
  const g = (id) => D[id].gain.gain.at(ctx.currentTime + 4);
  const step = (to) => { ctx.currentTime = t0 + to; eng.update(0.25); };
  step(10); const at10 = { picks: g('phase_pick'), final: g('phase_finalize') };
  step(20); const at20 = { picks: g('phase_pick'), final: g('phase_finalize') };
  step(85); const at85 = { picks: g('phase_pick'), final: g('phase_finalize') };
  eng.musicPhase('pick'); step(90); const driven = { picks: g('phase_pick'), final: g('phase_finalize') };
  report.C3 = { at10, at20, at85, drivenPicksAt90: driven };
  if (!(off(at10.picks) && on(at20.picks) && off(at20.final) && on(at85.final) && on(driven.picks) && off(driven.final))) failures.push(`C3: ${JSON.stringify(report.C3)}`);

  // C4 — draft(s), sent by the draft screen before the bed is even playing
  eng.music(null); await flush();
  eng.draft({ phase: 'pick', mine: true, urgent: false });
  eng.music('mus_draft'); await flush();
  const urg = draft.layers.find((l) => l.id.startsWith('urgency_'))?.id;
  const E4 = () => Object.fromEntries(eng.bed.layers.map((l) => [l.id, l]));
  const at = (id) => E4()[id].gain.gain.at(ctx.currentTime + 4);
  const snap = () => ({ pick: +at('phase_pick').toFixed(3), finalize: +at('phase_finalize').toFixed(3), urgent: +at(urg).toFixed(3) });
  const before = snap();
  eng.draft({ phase: 'finalize', mine: true, urgent: true }); const fin = snap();
  eng.draft({ phase: 'ban', mine: false, urgent: false }); const ban = snap();
  eng.draft(null); const t4 = eng.bed.t0; ctx.currentTime = t4 + 20; eng.update(0.25); const released = snap();
  report.C4 = { pickBeforeMusic: before, finalizeUrgent: fin, ban, releasedAt20: released };
  if (!(on(before.pick) && off(before.finalize) && off(before.urgent))) failures.push(`C4: draft() before music() ${JSON.stringify(before)}`);
  if (!(on(fin.pick) && on(fin.finalize) && on(fin.urgent))) failures.push(`C4: finalize + urgent ${JSON.stringify(fin)}`);
  if (!(off(ban.pick) && off(ban.finalize) && off(ban.urgent))) failures.push(`C4: bans ${JSON.stringify(ban)}`);
  if (!(on(released.pick) && off(released.finalize))) failures.push(`C4: draft(null) did not hand back the walk ${JSON.stringify(released)}`);
} else failures.push('C3: content has no draft bed with phase layers');

// C5 — the .ogg path never fetches a piece
const pieceRefs = new Set(Object.values(audio.music).flatMap((m) => [...(m.pieces ?? []).map((p) => p.file), ...m.layers.filter((l) => l.id.startsWith('seg_')).map((l) => l.file)]));
report.C5 = { format: eng.format, pieces: pieceRefs.size, piecesFetched: FETCHED.filter((u) => pieceRefs.has(u)).length };
if (!pieceRefs.size) failures.push('C5: content lists no .m4a pieces');
if (report.C5.piecesFetched) failures.push(`C5: the .ogg path fetched ${report.C5.piecesFetched} pieces`);

report.failures = failures; report.pass = failures.length === 0;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`A1 Lantern: ${JSON.stringify(report.A1)}`);
console.log(`A2 first+shutdown: ${JSON.stringify(report.A2)}`);
console.log(`A3 merge: ${JSON.stringify(report.A3)}`);
console.log(`A4 expiry: ${JSON.stringify(report.A4)}`);
console.log(`A5 preempt: ${JSON.stringify(report.A5)}`);
console.log(`A6 one at a time: ${JSON.stringify(report.A6)}`);
console.log(`A7 duck: ${JSON.stringify(report.A7)}`);
console.log(`A8 lines: ${JSON.stringify(report.A8)}`);
console.log(`A9 flow: ${JSON.stringify(report.A9)}`);
console.log(`B1 ${JSON.stringify(report.B1)} · B2 ${JSON.stringify(report.B2)}`);
console.log(`B3 ${JSON.stringify(report.B3)} · B4 ${JSON.stringify(report.B4)}`);
console.log(`C1 ${JSON.stringify(report.C1)}`);
console.log(`C4 ${JSON.stringify(report.C4)} · C5 ${JSON.stringify(report.C5)}`);
console.log(`C2 ${JSON.stringify(report.C2)}`);
console.log(`C3 ${JSON.stringify(report.C3)}`);
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: one announcer line per event, merged, expired, preempted only by bands 0-1, the mix ducked under it; the voice budget, heal merging, soft clip, mono / soften and the bed layers hold');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
