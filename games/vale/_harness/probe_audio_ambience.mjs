// VALE harness — the maps sound alive: ambience emitters on RIFT, BRIDGE and FRAY (final parity AUD-8).
//
//   node _harness/probe_audio_ambience.mjs [--out <report.json>] [--seconds N] [--seed N]
//
// REAL matches (the built catalog in dist-catalog/, LocalMatchHost, bot brains on every seat, yours too) drive the
// REAL engine (src/audio/index.ts) against content/audio.json as it is now; only WebAudio is faked. The engine is
// ticked at its own 4 Hz, heard from your fighter (no renderer), so the emitters follow you down your lane.
// Gates, per map:
//   A1  the map's emitters ('ambient.<map>.<source>', 4-6) are built and every one starts its loop on the ambience
//       bus (ambience cues in the engine's cue log > 0)
//   A2  the bed is at full the whole match; at least one positional emitter is heard (> -20 dB) along the way
//   A3  placement (engine ambPlace): on any point of an emitter's group it plays at full; 40 m clear of every point
//       it is silent
//   A4  the combat duck: the bus at 0 dB below fight heat 0.2, -6 dB at 0.6 and above (fight heat counts fighter-vs-
//       fighter damage only: the wave-clear intensity, here held at 1, never ducks it)
//   A5  detach (the match ends): every emitter fades to silence and its source is stopped; nothing is left voiced
// Also reported (not gated; the real metering is _harness/probe_audio_mix.mjs in Chrome): a loudness MODEL of the
// ambience bus vs the music bus over laning (sim 30-210 s) from the cues' measured integrated loudness
// (_harness/_reports/fw_W3_procs_amb_build.json, audio/build.py --json), gains and placement.
// Exit 0 = A1–A5 hold on every map, 1 = a gate fails, 77 = no built catalog. Report → _harness/_reports/fw_W3_ambience.json.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'fw_W3_ambience.json'));
const SECONDS = Number(arg('--seconds', 240));
const SEED = Number(arg('--seed', 3));

// ── a minimal fake WebAudio + DOM (the engine only builds a graph and starts sources) ─────────────────────
class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.gain = new Param(1); }
  connect(d) { this.outs.push(d); return d; }
  disconnect() { this.outs = []; }
}
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node(this, 'destination'); this.started = []; this.live = []; }
  createGain() { return new Node(this, 'gain'); }
  createStereoPanner() { const n = new Node(this, 'panner'); n.pan = new Param(0); return n; }
  createBiquadFilter() { const n = new Node(this, 'biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createDynamicsCompressor() {
    const n = new Node(this, 'limiter');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    return n;
  }
  createBufferSource() {
    const n = new Node(this, 'source');
    n.playbackRate = new Param(1);
    n.start = () => { n.endAt = this.currentTime + (n.loop ? 1e9 : (n.buffer?.duration ?? 1)); this.started.push(n); this.live.push(n); };
    n.stop = (t = this.currentTime) => { n.endAt = Math.min(n.endAt ?? Infinity, t); };
    return n;
  }
  advance(dt) {
    this.currentTime += dt;
    const keep = [];
    for (const n of this.live) { if (n.endAt <= this.currentTime) n.onended?.(); else keep.push(n); }
    this.live = keep;
  }
  decodeAudioData() { return Promise.resolve({ duration: 1, length: 48000, sampleRate: 48000 }); }
  resume() { return Promise.resolve(); }
}
globalThis.AudioContext = FakeCtx;
globalThis.window = globalThis;
globalThis.setInterval = ((orig) => (fn, ms) => (ms === 250 ? 0 : orig(fn, ms)))(globalThis.setInterval);   // the probe ticks the engine itself
globalThis.addEventListener = () => {};
globalThis.document = { hidden: false, addEventListener() {}, createElement: () => ({ canPlayType: () => 'probably' }) };
globalThis.location = { search: '' };
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

// ── the catalog: the built one for the sim, content/audio.json as it is now for the engine ───────────────
const catRoot = join(ROOT, 'dist-catalog', 'schema-1');
if (!existsSync(catRoot)) { console.log('SKIP: no dist-catalog/ (run `npm run content`)'); process.exit(77); }
const ver = readdirSync(catRoot).sort().pop();
const raw = JSON.parse(readFileSync(join(catRoot, ver, 'catalog.json'), 'utf8'));
const { Catalog, AudioDef } = await import('../src/contracts/catalog.ts');
let catalog;
try { catalog = Catalog.parse(raw); } catch { catalog = raw; }                 // another lane mid-schema-edit: the built JSON is already defaulted
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
const DUR = {};
for (const c of Object.values(audio.cues)) for (const f of c.files) DUR[f] = oggSeconds(join(ROOT, 'audio', 'out', f.replace(/^assets\/audio\//, '')));

const { LocalMatchHost } = await import('../src/session/match_host.ts');
const { createBots } = await import('../src/sim/bots/index.ts');
const { createAudioEngine } = await import('../src/audio/index.ts');

const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };
const dB = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
// measured integrated loudness per ambience cue (audio/build.py --json); the recipe target otherwise
const LINT = {};
try {
  const b = JSON.parse(readFileSync(join(HERE, '_reports', 'fw_W3_procs_amb_build.json'), 'utf8'));
  for (const r of b.cues ?? []) if (r.kind === 'int') LINT[r.id] = r.got;
} catch { /* model falls back */ }
const failures = [];
const report = { probe: 'probe_audio_ambience', catalog: ver, seed: SEED, seconds: SECONDS, maps: {} };

for (const modeId of ['rift', 'bridge', 'fray']) {
  const mode = catalog.modes.find((m) => m.id === modeId);
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
  const n = mode.teams * mode.perTeam;
  const YOU = Math.min(7, n - 1);
  const seats = [];
  for (let i = 0; i < n; i++) {
    const fighter = catalog.fighters[(i * 7 + 3) % catalog.fighters.length].id;
    seats.push({
      player: i, team: Math.floor(i / mode.perTeam), name: catalog.botNames[i % catalog.botNames.length], fighter,
      skin: catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '',
      role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
      loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
      controller: i === YOU ? 'human' : 'bot', botDifficulty: 'adept', colorIndex: i,
    });
  }
  const setup = { matchId: `probe-audio-ambience-${modeId}`, seed: SEED, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
  const host = new LocalMatchHost(catalog, setup, YOU, { bots: createBots(catalog, setup), pregameSeconds: 0, autopilot: true });
  const view = host.view;
  const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  eng.buffer = (file) => ({ then: (f) => { f({ duration: DUR[file] ?? 8, length: 48000, sampleRate: 48000 }); return { catch() {} }; } });
  eng.ensure();
  eng.attach(host);
  host.start();
  const bound = Object.keys(audio.events).filter((k) => k.startsWith(`ambient.${mode.map}.`));
  const series = {};                                   // role → att samples
  const model = [];                                    // laning: the ambience bus LUFS (model, duck included)
  let samples = 0, ducked = 0;
  const musicDef = audio.music[catalog.maps.find((m) => m.id === mode.map)?.art?.music];
  const musicL = -23 + dB(musicDef?.gain ?? 0.75) + dB(SETTINGS.audio.music);
  const ticks = Math.round(SECONDS * 30);
  for (let i = 0; i < ticks && !host.ended; i++) {
    host.pump(1 / 30);
    eng.ctx.advance(1 / 30);
    if (i % 8 !== 0) continue;
    eng.update(8 / 30);
    let p = 0;
    for (const em of eng.ambience) {
      (series[em.role] ??= []).push(em.att);
      const c = audio.cues[em.cue];
      // a positional emitter is a mono file through a StereoPanner: equal power, -3 dB against the bed's up-mix
      p += (c.gain * em.att) ** 2 * 10 ** ((LINT[em.cue] ?? (c.spatial ? -25 : -23)) / 10) * (c.spatial ? 0.5 : 1);
    }
    const duckG = eng.ambDuck.gain.value;
    if (view.time >= 30 && view.time <= 210) {
      model.push(10 * Math.log10(Math.max(p, 1e-20)) + dB(SETTINGS.audio.ambience) + dB(duckG));
      samples++; if (dB(duckG) < -1) ducked++;
    }
  }
  const ems = eng.ambience;
  const logged = eng.log.filter((c) => audio.cues[c]?.bus === 'ambience');
  const m = {
    map: mode.map, bound: bound.length, emitters: ems.map((e) => ({ role: e.role, cue: e.cue, points: e.points, playing: e.playing })),
    ambienceCues: logged.length, cues: [...new Set(logged)],
    heard: Object.fromEntries(Object.entries(series).map(([r, a]) => {
      const s = [...a].sort((x, y) => x - y);
      return [r, { medianDb: +dB(s[Math.floor(s.length / 2)]).toFixed(1), maxDb: +dB(s[s.length - 1]).toFixed(1), audibleShare: +(a.filter((x) => x > 0.1).length / a.length).toFixed(2) }];
    })),
  };
  // A1
  if (bound.length < 4 || bound.length > 6) failures.push(`A1 ${mode.map}: ${bound.length} emitters bound (want 4-6)`);
  if (ems.length !== bound.length) failures.push(`A1 ${mode.map}: ${bound.length} bound, ${ems.length} built (a source with no points?)`);
  for (const e of ems) if (!e.playing) failures.push(`A1 ${mode.map}: ${e.role} never started its loop`);
  if (!logged.length) failures.push(`A1 ${mode.map}: no ambience cue in the cue log`);
  // A2
  const bed = ems.find((e) => e.points === 0);
  if (!bed) failures.push(`A2 ${mode.map}: no bed`);
  else if (Math.min(...series[bed.role]) < 0.999) failures.push(`A2 ${mode.map}: the bed dipped below full`);
  if (!ems.some((e) => e.points > 0 && Math.max(...series[e.role]) > 0.1)) failures.push(`A2 ${mode.map}: no positional emitter was ever heard`);
  // A3: placement, from the engine's own ambPlace
  const placement = {};
  const amb = eng.amb;
  for (const e of amb) {
    if (!e.pts.length) continue;
    const on = e.pts[Math.floor(e.pts.length / 2)];
    eng.listener(() => on);
    const atPoint = eng.ambPlace(e.pts).att;
    // the far probe: the farthest of a few candidate spots from every point
    const cands = [{ x: -60, y: -60 }, { x: 300, y: 300 }, { x: on.x + 200, y: on.y }];
    const far = cands.map((c) => ({ c, d: Math.min(...e.pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y))) })).sort((a, b) => b.d - a.d)[0];
    eng.listener(() => far.c);
    const farAtt = eng.ambPlace(e.pts).att;
    placement[e.role] = { atPointDb: +dB(atPoint).toFixed(2), farM: +far.d.toFixed(0), farAtt };
    if (atPoint < 0.999) failures.push(`A3 ${mode.map}: ${e.role} plays at ${dB(atPoint).toFixed(1)} dB on its own point`);
    if (far.d > 40 && farAtt > 0) failures.push(`A3 ${mode.map}: ${e.role} audible ${far.d.toFixed(0)} m from every point`);
  }
  eng.listener(null);
  m.placement = placement;
  // A4: the duck
  const duck = {};
  for (const k of [0, 0.15, 0.4, 0.6, 0.9]) { eng.fight = k; eng.intensity = 1; eng.syncAmbience(); duck[k] = +dB(eng.ambDuck.gain.value).toFixed(2); }
  m.duckDb = duck;
  m.duckedShare = +(ducked / Math.max(1, samples)).toFixed(2);
  if (Math.abs(duck[0]) > 0.01 || Math.abs(duck[0.15]) > 0.01) failures.push(`A4 ${mode.map}: the bus ducks below combat (${JSON.stringify(duck)})`);
  if (Math.abs(duck[0.6] + 6) > 0.05 || Math.abs(duck[0.9] + 6) > 0.05) failures.push(`A4 ${mode.map}: the bus is not -6 dB in a fight (${JSON.stringify(duck)})`);
  // A5: detach
  const srcs = amb.map((e) => e.src).filter(Boolean);
  eng.attach(null);
  eng.ctx.advance(5);
  const left = srcs.filter((s) => eng.ctx.live.includes(s)).length;
  const gains = amb.map((e) => e.gain.gain.value);
  m.detach = { emittersAfter: eng.ambience.length, sourcesStillLive: left, maxGain: Math.max(...gains) };
  if (eng.ambience.length || left || Math.max(...gains) > 0) failures.push(`A5 ${mode.map}: after detach ${eng.ambience.length} emitters, ${left} live sources, max gain ${Math.max(...gains)}`);
  // the loudness model over laning
  if (model.length) {
    const s = [...model].sort((a, b) => a - b);
    m.laningModel = { ambienceBusLufs: { p10: +s[Math.floor(s.length * 0.1)].toFixed(1), p50: +s[Math.floor(s.length / 2)].toFixed(1) }, musicBusLufs: +musicL.toFixed(1) };
  }
  report.maps[mode.map] = m;
  console.log(`${mode.map}: ${ems.length}/${bound.length} emitters playing, ${logged.length} ambience cues (${m.cues.join(', ')})`);
  for (const [r, h] of Object.entries(m.heard)) console.log(`  ${r.padEnd(48)} median ${String(h.medianDb).padStart(6)} dB  max ${String(h.maxDb).padStart(6)} dB  audible ${Math.round(h.audibleShare * 100)} %  ${placement[r] ? `on-point ${placement[r].atPointDb} dB, ${placement[r].farM} m away ${placement[r].farAtt}` : '(bed)'}`);
  console.log(`  duck ${JSON.stringify(duck)} · detach ${JSON.stringify(m.detach)}${m.laningModel ? ` · laning model: ambience bus p10 ${m.laningModel.ambienceBusLufs.p10} / p50 ${m.laningModel.ambienceBusLufs.p50} LUFS vs music bus ${m.laningModel.musicBusLufs}, ducked > 1 dB ${Math.round(m.duckedShare * 100)} % of laning` : ''}`);
}

report.failures = failures;
report.pass = failures.length === 0;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: every map has its emitters playing on the ambience bus, placed on their art.ambient points, ducked under fights, gone on detach');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
