// VALE harness — the audio listener follows the camera (final parity AUD-9; CONTRACT §11 'listener at the camera target').
//
//   node _harness/probe_audio_listener.mjs [--out <report.json>] [--baseline <git-rev>] [--minutes N] [--seed N]
//
// A REAL RIFT match (the built catalog in dist-catalog/, LocalMatchHost, bot brains on EVERY seat, yours too, so your
// fighter lanes, fights and dies) drives the REAL engine (src/audio/index.ts) against content/audio.json as it is now.
// Only WebAudio is faked (Node has none): sources end after their real file's length (read from the shipped .ogg), so
// the voice pool fills and frees as in a browser, and every voice the engine starts is read back from its graph (gain,
// pan, low-pass), so a cue's placement is attributed to the SimEvent that caused it. Three listeners hear the same match:
//   spectate  the camera as a player drives it: on your fighter while it lives; while it is dead the camera is free
//             and sits on the fight (the centroid of the last 1.5 s of fighter-vs-fighter damage, anywhere)
//   scout     hold-to-scout at its far edge: the camera 40 m east of your LIVING fighter (beyond the 30 m roll-off)
//   baseline  (--baseline <rev>) the engine as it was at <rev>, which hears from your fighter's entity, alive or dead
// Gates:
//   A  dead-spectating: fighter combat cues within 8 m of the camera focus while you are dead: >= 95 % audible (not
//      culled by distance) at >= -3 dB placement (spectate listener)
//   B  awareness: enemy fighter / tower / monster casts and attacks within 10 m of your living fighter while the camera
//      scouts 40 m away: 100 % audible at >= -2 dB placement (scout listener)
//   C  the camera still rules: your allies' attacks near you (not threats) while scouting 40 m away are culled
//   D  the placement curve (engine place()): full volume to 12 m (the screen's half-width at default zoom), silent
//      beyond 30 m, |pan| <= 0.6, low-pass only beyond 15 m
// Exit 0 = A–D hold, 1 = a gate fails, 77 = no built catalog. Report → _harness/_reports/fw_W3_listener.json.

import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'fw_W3_listener.json'));
const BASELINE = arg('--baseline', null);
const MINUTES = Number(arg('--minutes', 20));
const SEED = Number(arg('--seed', 3));
const FIGHT_R = 8, AWARE_R = 10, SCOUT_DX = 40;

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
globalThis.setInterval = ((orig) => (fn, ms) => (ms === 250 ? 0 : orig(fn, ms)))(globalThis.setInterval);   // the engine's 4 Hz tick: not needed
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

// every shipped cue's real length (Ogg: the last page's granule minus the OpusHead pre-skip, at 48 kHz)
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
let createBaseline = null;
if (BASELINE) {
  const dir = mkdtempSync(join(tmpdir(), 'vale_listener_base_'));
  const file = join(dir, 'index.ts');
  writeFileSync(file, execFileSync('git', ['show', `${BASELINE}:./src/audio/index.ts`], { cwd: ROOT, encoding: 'utf8' }));
  createBaseline = (await import(pathToFileURL(file).href)).createAudioEngine;
}

const mode = catalog.modes.find((m) => m.id === 'rift');
const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
// your seat: 8 (rishal, shaftlight with the content catalog) dies often enough that gate A has a fight to hear
// (5/7/6 deaths in 17 min on seeds 3/5/7); seat 7 (hesmi, a dialcross plinth) survives too well (2/0/2), so A was empty
const YOU = 8;
const seats = [];
for (let i = 0; i < mode.teams * mode.perTeam; i++) {
  const fighter = catalog.fighters[(i * 7 + 3) % catalog.fighters.length].id;
  seats.push({
    player: i, team: Math.floor(i / mode.perTeam), name: catalog.botNames[i % catalog.botNames.length], fighter,
    skin: catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '',
    role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
    loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
    controller: i === YOU ? 'human' : 'bot', botDifficulty: 'adept', colorIndex: i,
  });
}
const setup = { matchId: 'probe-audio-listener', seed: SEED, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
const host = new LocalMatchHost(catalog, setup, YOU, { bots: createBots(catalog, setup), pregameSeconds: 0, autopilot: true });
const view = host.view;
const myTeam = seats[YOU].team;
const youEnt = () => view.entity(view.players.find((p) => p.player === YOU).entity);

// ── engines: each hears the same match through its own listener; every started voice is read back ───────
const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };
function rig(name, create, focus) {
  const eng = create({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  if (focus) eng.listener(focus);
  // voices start inside cue() (attributable), with the real file's length
  eng.buffer = (file) => ({ then: (f) => { f({ duration: DUR[file] ?? 1, length: 48000, sampleRate: 48000 }); return { catch() {} }; } });
  const rows = [];
  let cur = null;
  const last = new Map();
  const origOn = eng.onEvent, origCue = eng.cue;
  eng.onEvent = function (e) { cur = e; try { return origOn.call(this, e); } finally { cur = null; } };
  eng.cue = function (id, pos, gainMul = 1, ...rest) {
    const ctx = this.ctx;
    const n0 = ctx ? ctx.started.length : 0;
    const r = origCue.call(this, id, pos, gainMul, ...rest);
    const c = id ? audio.cues[id] : null;
    if (!cur || !c || !pos || !c.spatial) return r;
    const now = this.ctx.currentTime;
    const started = this.ctx.started.length > n0 ? this.ctx.started[this.ctx.started.length - 1] : null;
    let row;
    if (started) {
      let node = started, lpf = 0, pan = 0, gain = 1;
      while (node && node.kind !== 'gain') {
        if (node.kind === 'biquad') lpf = node.frequency.value;
        if (node.kind === 'panner') pan = node.pan.value;
        node = node.outs[0];
      }
      if (node) gain = node.gain.value;
      const att = gain / ((c.gain || 1) * (gainMul || 1));
      row = { id, e: cur, at: pos, att, pan, lpf, state: 'played' };
      last.set(id, now);
    } else {
      const cool = c.cooldown > 0 && now - (last.get(id) ?? -1e9) < c.cooldown;
      row = { id, e: cur, at: pos, att: 0, pan: 0, lpf: 0, state: cool ? 'cooldown' : 'culled' };
    }
    rows.push(row);
    return r;
  };
  eng.attach(host);
  return { name, eng, rows };
}

// the spectate camera: on your fighter while it lives, on the fight while it is dead
const recentFights = [];   // { t, x, y }
let spectFocus = null;
const spectate = rig('spectate', createAudioEngine, () => spectFocus);
const scout = rig('scout', createAudioEngine, () => { const y = youEnt(); return y ? { x: y.x + SCOUT_DX, y: y.y } : null; });
const baseline = createBaseline ? rig(`baseline@${BASELINE}`, createBaseline, null) : null;
const rigs = [spectate, scout, baseline].filter(Boolean);

// per-event context, recorded once (the camera focus and your fighter's state at the moment the event is heard)
const ctxOf = new Map();
host.onEvents((evs) => {
  for (const e of evs) {
    if (e.e === 'damage') {
      const s = view.entity(e.src), d = view.entity(e.dst);
      if (s?.kind === 'fighter' && d?.kind === 'fighter') recentFights.push({ t: e.t, x: d.x, y: d.y });
    }
  }
});
// the engines listen first (attached above), so this listener records the focus they used
const order = [];
host.onEvents((evs) => {
  const y = youEnt();
  for (const e of evs) ctxOf.set(e, { focus: spectFocus ? { ...spectFocus } : null, alive: !!y?.alive, you: y ? { x: y.x, y: y.y } : null });
  order.push(...evs);
});

host.start();
const ticks = Math.round(MINUTES * 60 * 30);
let deadTicks = 0, deaths = 0, wasAlive = true;
for (let i = 0; i < ticks && !host.ended; i++) {
  // the camera before this tick's events
  const y = youEnt();
  const t = view.time;
  while (recentFights.length && recentFights[0].t < t - 1.5) recentFights.shift();
  if (y?.alive) spectFocus = { x: y.x, y: y.y };
  else if (recentFights.length) {
    spectFocus = { x: recentFights.reduce((a, f) => a + f.x, 0) / recentFights.length, y: recentFights.reduce((a, f) => a + f.y, 0) / recentFights.length };
  }
  if (y && !y.alive) { deadTicks++; if (wasAlive) deaths++; }
  wasAlive = !!y?.alive;
  host.pump(1 / 30);
  for (const r of rigs) r.eng.ctx?.advance(1 / 30);
}

// ── gates ────────────────────────────────────────────────────────────────────────────────────────────────
const failures = [];
const dB = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
const posOf = (e) => { const ent = view.entity(e.dst ?? e.src); return ent ? { x: ent.x, y: ent.y } : null; };
const isFighter = (id) => view.entity(id)?.kind === 'fighter';
function summary(rows) {
  const heard = rows.filter((r) => r.state !== 'cooldown');
  const played = heard.filter((r) => r.state === 'played');
  const atts = played.map((r) => dB(r.att)).sort((a, b) => a - b);
  return {
    cues: heard.length, played: played.length, culled: heard.length - played.length,
    audiblePct: heard.length ? +(100 * played.length / heard.length).toFixed(1) : null,
    medianDb: atts.length ? +atts[Math.floor(atts.length / 2)].toFixed(2) : null,
    p10Db: atts.length ? +atts[Math.floor(atts.length * 0.1)].toFixed(2) : null,
    minDb: atts.length ? +atts[0].toFixed(2) : null,
    lowPassed: played.filter((r) => r.lpf > 0).length,
  };
}

// A: while you are dead, fighter combat cues at the camera focus
const COMBAT = new Set(['attack', 'damage', 'hit', 'cast', 'status', 'dash', 'blink', 'projectile']);
const atFocus = (r) => {
  const c = ctxOf.get(r.e);
  if (!c || c.alive || !c.focus || !COMBAT.has(r.e.e)) return false;
  if (!(isFighter(r.e.src) || isFighter(r.e.dst))) return false;
  return Math.hypot(r.at.x - c.focus.x, r.at.y - c.focus.y) <= FIGHT_R;
};
const A = { spectate: summary(spectate.rows.filter(atFocus)) };
if (baseline) {
  A.baseline = summary(baseline.rows.filter(atFocus));
  // how far those fights were from your corpse (the baseline listener)
  const ds = baseline.rows.filter(atFocus).map((r) => { const c = ctxOf.get(r.e); return c.you ? Math.hypot(r.at.x - c.you.x, r.at.y - c.you.y) : NaN; }).filter(Number.isFinite).sort((a, b) => a - b);
  A.baselineDistanceM = ds.length ? { median: +ds[Math.floor(ds.length / 2)].toFixed(1), max: +ds[ds.length - 1].toFixed(1) } : null;
}
if (!A.spectate.cues) failures.push(`A: no fighter combat at the camera focus while you were dead (deaths ${deaths}, dead ${(deadTicks / 30).toFixed(0)} s): the check is vacuous — run longer`);
else {
  if (A.spectate.audiblePct < 95) failures.push(`A: only ${A.spectate.audiblePct} % of the fight at the camera focus is audible while dead`);
  if (A.spectate.minDb < -3) failures.push(`A: a fight cue at the camera focus played at ${A.spectate.minDb} dB (< -3 dB)`);
}

// B: scouting 40 m away, enemy threats within 10 m of your living fighter
const threatNearYou = (r) => {
  const c = ctxOf.get(r.e);
  if (!c?.alive || !c.you || !(r.e.e === 'cast' || r.e.e === 'attack')) return false;
  const s = view.entity(r.e.src);
  if (!s || s.team === myTeam || s.kind === 'minion') return false;
  return Math.hypot(r.at.x - c.you.x, r.at.y - c.you.y) <= AWARE_R;
};
const B = { scout: summary(scout.rows.filter(threatNearYou)) };
if (!B.scout.cues) failures.push('B: no enemy cast / attack within 10 m of your living fighter: the check is vacuous — run longer');
else {
  if (B.scout.audiblePct < 100) failures.push(`B: ${B.scout.culled} enemy cast(s)/attack(s) within 10 m of you were culled while scouting`);
  if (B.scout.minDb < -2.01) failures.push(`B: an enemy threat near you played at ${B.scout.minDb} dB while scouting (< -2 dB)`);
}
// C: allies' attacks near you while scouting (not threats): the camera listener culls them
const allyNearYou = (r) => {
  const c = ctxOf.get(r.e);
  if (!c?.alive || !c.you || r.e.e !== 'attack') return false;
  const s = view.entity(r.e.src);
  if (!s || s.team !== myTeam || r.e.dst === youEnt()?.id || r.e.src === youEnt()?.id) return false;
  return Math.hypot(r.at.x - c.you.x, r.at.y - c.you.y) <= AWARE_R;
};
const C = { scout: summary(scout.rows.filter(allyNearYou)) };
if (C.scout.cues && C.scout.played) failures.push(`C: ${C.scout.played} allied attack(s) near you played while the camera was 40 m away (the camera should rule)`);

// D: the placement curve, read from the engine itself
const probeEng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
probeEng.listener(() => ({ x: 100, y: 100 }));
probeEng.client = { view: { players: [], entity: () => undefined }, you: -1 };
const D = [0, 6, 11.7, 12, 15, 17.7, 20, 24, 26, 29, 30, 31].map((d) => {
  const p = probeEng.place({ x: 100 + d, y: 100 }, false);
  return { m: d, db: Number.isFinite(dB(p.att)) ? +dB(p.att).toFixed(2) : null, pan: +p.pan.toFixed(3), lpfHz: Math.round(p.lpf) };
});
for (const r of D) {
  if (r.m <= 12 && r.db !== 0) failures.push(`D: ${r.m} m from the focus plays at ${r.db} dB (expected 0)`);
  if (r.m >= 30 && r.db !== null) failures.push(`D: ${r.m} m from the focus is audible (${r.db} dB)`);
  if (Math.abs(r.pan) > 0.6 + 1e-9) failures.push(`D: pan ${r.pan} at ${r.m} m`);
  if (r.m <= 15 && r.lpfHz) failures.push(`D: low-pass ${r.lpfHz} Hz at ${r.m} m`);
}

const report = {
  probe: 'probe_audio_listener', catalog: ver, seed: SEED, minutes: MINUTES, simSeconds: +view.time.toFixed(1), you: YOU, fighter: seats[YOU].fighter,
  deaths, deadSeconds: +(deadTicks / 30).toFixed(1),
  A_deadSpectating: A, B_awarenessWhileScouting: B, C_alliesWhileScouting: C, D_placement: D,
  totals: Object.fromEntries(rigs.map((r) => [r.name, summary(r.rows)])),
  failures, pass: failures.length === 0,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
const fmt = (s) => (s ? `${s.cues} cues, ${s.audiblePct} % audible, median ${s.medianDb} dB, p10 ${s.p10Db} dB, min ${s.minDb} dB, ${s.lowPassed} low-passed` : '-');
console.log(`sim ${report.simSeconds} s · your fighter ${seats[YOU].fighter} died ${deaths}x, dead ${report.deadSeconds} s`);
console.log(`A dead, fight at the camera focus  spectate: ${fmt(A.spectate)}`);
if (A.baseline) console.log(`                                   baseline: ${fmt(A.baseline)} (fight ${A.baselineDistanceM?.median} m median from your corpse)`);
console.log(`B scouting 40 m, enemy threat <= 10 m of you: ${fmt(B.scout)}`);
console.log(`C scouting 40 m, allied attacks near you:     ${fmt(C.scout)}`);
console.log(`D placement: ${D.map((r) => `${r.m}m ${r.db ?? 'off'}dB pan ${r.pan}${r.lpfHz ? ` lp ${r.lpfHz}` : ''}`).join(' · ')}`);
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: the listener follows the camera; threats to your living fighter stay audible');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
