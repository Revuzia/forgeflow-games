// VALE harness — the world's own moments sound (integration run 2: audio-r2-01..04; src/audio/index.ts `world`).
//
//   node _harness/probe_audio_world.mjs [--out <report.json>] [--seeds 3,5] [--seconds 450]
//
// Part R: REAL RIFT matches (the built catalog in dist-catalog/, LocalMatchHost, bot brains on every seat, vashil in
// seat 4) drive the REAL engine against content/audio.json as it is now; only WebAudio is faked. One omni listener
// (the camera on every event's subject) so the check is which cue the engine CHOOSES. Part S: a stub match for what a
// RIFT run under 8 min never reaches (the Gorge Wind, the Noon Toll) and what the sim does not emit yet (`shaded`).
// Gates:
//   W1  the Dawn Seal setting again: every 'shield' on a structure requests the role shieldStructure's cue at that
//       structure and never the fighters' shield cue; every beat (each `every` s until `until`) is heard
//   W2  the Dawn Seal ending: in the tick the view crosses rules.dawnSeal.until, sealBreak's cue is requested once at
//       every standing sealed structure (and at no other time)
//   W3  Vashil's chord: every area event whose vfx content binds as 'area.<vfx>' (and no sfx) requests that cue at the
//       area; no other area requests it (vacuous if the bots never chord: reported, not failed, with Part S covering it)
//   W4  (stub) each Gorge Wind step requests gorgeWind's cue once, centred; a client attached mid-wind hears no old step
//   W5  (stub) the Noon Toll ('noon_toll' announce bound as world.noon_toll) requests its cue at once, queues no
//       announcer line and ducks nothing; another unbound announce still falls back to the announcer
//   W6  (stub) a damage event with `shaded` on a structure requests hitShaded's cue and the hit at SHADED_GAIN; without
//       it, no hitShaded; on a fighter, no hitShaded; an ability blow's kit 'hit' (before its shaded damage) at SHADED_GAIN
//   W7  levels: every world cue sits under the announcer (recipe max momentary below m_announce_minor's) and none is
//       on the voice bus (only voice-bus lines duck the mix)
// Exit 0 = W1-W7 hold, 1 = a gate fails, 77 = no built catalog. Report → _harness/_reports/integ_audio_world.json.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'integ_audio_world.json'));
const SEEDS = arg('--seeds', '3,5').split(',').map(Number);
const SECONDS = Number(arg('--seconds', 450));

// ── a minimal fake WebAudio + DOM (the engine only builds a graph and starts sources) ─────────────────────
class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } }
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
const ev = audio.events;
const failures = [];
const report = { probe: 'probe_audio_world', catalog: ver, seeds: SEEDS, seconds: SECONDS, bound: {}, R: [], S: {} };
for (const r of ['shieldStructure', 'sealBreak', 'gorgeWind', 'world.noon_toll', 'hitShaded', 'shield', 'announceMinor']) report.bound[r] = ev[r] ?? null;
const areaRoles = Object.entries(ev).filter(([k]) => k.startsWith('area.'));
report.bound.area = Object.fromEntries(areaRoles);
for (const r of ['shieldStructure', 'sealBreak', 'gorgeWind', 'world.noon_toll', 'hitShaded']) if (!ev[r] || !audio.cues[ev[r]]) failures.push(`bind: content binds no cue to ${r}`);
if (!areaRoles.length) failures.push('bind: content binds no area.<vfx> cue (Vashil\'s chord)');

/** wrap the engine: every cue request with its position and gain, every announcer line, every voice duck */
function spy(eng) {
  const log = { cues: [], lines: [], ducks: 0 };
  const cue0 = eng.cue, ann0 = eng.announce, duck0 = eng.voiceDuck;
  eng.cue = function (id, pos, gain = 1, ...rest) { const r = cue0.call(this, id, pos, gain, ...rest); log.cues.push({ id, pos, gain, r, t: this.client?.view?.time ?? null }); return r; };
  eng.announce = function (role, ...rest) { log.lines.push(role); return ann0.call(this, role, ...rest); };
  eng.voiceDuck = function (...a) { log.ducks++; return duck0.apply(this, a); };
  return log;
}

// ── Part R: real RIFT matches ─────────────────────────────────────────────────────────────────────────
const mode = catalog.modes.find((m) => m.id === 'rift');
const seal = mode.rules?.dawnSeal;
if (!seal) failures.push('R: rift has no rules.dawnSeal');
const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
let chordsTotal = 0;
for (const SEED of SEEDS) {
  const n = mode.teams * mode.perTeam;
  const YOU = 8;
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
  const setup = { matchId: `probe-audio-world-${SEED}`, seed: SEED, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
  const host = new LocalMatchHost(catalog, setup, YOU, { bots: createBots(catalog, setup), pregameSeconds: 0, autopilot: true });
  const view = host.view;
  const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  eng.buffer = (file) => ({ then: (f) => { f({ duration: DUR[file] ?? 1, length: 48000, sampleRate: 48000 }); return { catch() {} }; } });
  eng.ensure();
  // one omni listener: the camera on every event's subject (which cue is CHOSEN; earshot is probe_audio_listener's)
  let focus = { x: 0, y: 0 };
  eng.listener(() => focus);
  eng.attach(host);
  const log = spy(eng);
  // every event this run, with the cue requests it caused
  const rows = [];
  host.onEvents((evs) => { for (const e of evs) rows.push(e); });
  const on0 = eng.onEvent;
  eng.onEvent = function (e) {
    const s = e.dst != null ? view.entity(e.dst) : e.src != null ? view.entity(e.src) : null;
    if (e.e === 'area') focus = { x: e.x, y: e.y }; else if (s) focus = { x: s.x, y: s.y };
    const k = log.cues.length;
    const r = on0.call(this, e);
    e.__cues = log.cues.slice(k);
    return r;
  };
  host.start();
  const sealed = () => view.entities.filter((u) => u.kind === 'structure' && u.alive && seal.units.includes(u.def));
  let standingAtEnd = null, breakRows = [], tickOfEnd = null;
  const ticks = Math.round(SECONDS * 30);
  for (let i = 0; i < ticks && !host.ended; i++) {
    const t0 = view.time;
    host.pump(1 / 30);
    eng.ctx.advance(1 / 30);
    const t1 = view.time;
    if (seal && t0 < seal.until && t1 >= seal.until) {
      standingAtEnd = sealed().map((u) => ({ id: u.id, x: u.x, y: u.y }));
      focus = standingAtEnd[0] ? { x: standingAtEnd[0].x, y: standingAtEnd[0].y } : focus;
      const k = log.cues.length;
      eng.update(1 / 30);
      breakRows = log.cues.slice(k).filter((c) => c.id === ev.sealBreak);
      tickOfEnd = t1;
    } else if (i % 8 === 0) eng.update(8 / 30);
  }
  // W1: structure shields → shieldStructure; beats heard
  const sh = rows.filter((e) => e.e === 'shield' && view.entity(e.dst)?.kind === 'structure');
  const shWrong = sh.filter((e) => !e.__cues?.some((c) => c.id === ev.shieldStructure) || e.__cues?.some((c) => c.id === ev.shield));
  const beats = [...new Set(sh.map((e) => Math.round(e.t)))].sort((a, b) => a - b);
  const wantBeats = seal ? Math.floor((Math.min(SECONDS, seal.until) - 1e-6) / seal.every) + 1 : 0;
  // W2: the seal's end
  const breaksElsewhere = log.cues.filter((c) => c.id === ev.sealBreak).length - breakRows.length;
  // W3: Vashil's chord
  const boundAreas = new Map(areaRoles.map(([k, c]) => [k.slice('area.'.length), c]));
  const areas = rows.filter((e) => e.e === 'area' && !e.sfx && boundAreas.has(e.vfx));
  const areaMiss = areas.filter((e) => !e.__cues?.some((c) => c.id === boundAreas.get(e.vfx) && Math.abs(c.pos.x - e.x) < 1e-6 && Math.abs(c.pos.y - e.y) < 1e-6));
  const areaStray = rows.filter((e) => e.e === 'area' && !(boundAreas.has(e.vfx) && !e.sfx) && e.__cues?.some((c) => [...boundAreas.values()].includes(c.id)));
  chordsTotal += areas.length;
  const run = {
    seed: SEED, simSeconds: +view.time.toFixed(1), ended: host.ended,
    W1: { structureShields: sh.length, wrong: shWrong.length, beats, wantBeats },
    W2: { at: tickOfEnd, standing: standingAtEnd?.length ?? null, breaks: breakRows.length, breaksAtStructures: breakRows.filter((c) => standingAtEnd?.some((u) => Math.hypot(u.x - c.pos.x, u.y - c.pos.y) < 1e-6)).length, breaksElsewhere },
    seats: seats.map((x) => x.fighter), vashilProcs: rows.filter((e) => e.e === 'proc' && /vashil/.test(e.ability)).length,
    W3: { chords: areas.length, missed: areaMiss.length, stray: areaStray.length, played: areas.filter((e) => e.__cues?.some((c) => c.r === 'played')).length },
  };
  report.R.push(run);
  if (!sh.length) failures.push(`W1 seed ${SEED}: no shield on a structure (the Dawn Seal never set?)`);
  if (shWrong.length) failures.push(`W1 seed ${SEED}: ${shWrong.length}/${sh.length} structure shields did not request ${ev.shieldStructure} (or requested ${ev.shield})`);
  if (seal && SECONDS >= seal.until && beats.length < wantBeats) failures.push(`W1 seed ${SEED}: ${beats.length} seal beats heard, want ${wantBeats}`);
  if (seal && SECONDS > seal.until) {
    if (standingAtEnd === null) failures.push(`W2 seed ${SEED}: the run never crossed ${seal.until} s`);
    else if (!standingAtEnd.length) failures.push(`W2 seed ${SEED}: no sealed structure standing at ${seal.until} s (vacuous)`);
    else if (run.W2.breaksAtStructures !== standingAtEnd.length || breakRows.length !== standingAtEnd.length) failures.push(`W2 seed ${SEED}: ${breakRows.length} seal breaks (${run.W2.breaksAtStructures} at a structure) for ${standingAtEnd.length} standing sealed structures`);
  }
  if (breaksElsewhere) failures.push(`W2 seed ${SEED}: ${breaksElsewhere} seal breaks outside the seal's end`);
  if (areaMiss.length) failures.push(`W3 seed ${SEED}: ${areaMiss.length}/${areas.length} bound areas did not request their cue at the area`);
  if (areaStray.length) failures.push(`W3 seed ${SEED}: ${areaStray.length} other areas requested a bound area cue`);
  console.log(`rift#${SEED}: ${run.simSeconds} s · W1 ${sh.length} structure shields (${shWrong.length} wrong), beats ${beats.join(',')} · W2 at ${tickOfEnd} s ${breakRows.length} breaks for ${standingAtEnd?.length} standing · W3 ${areas.length} chords, ${areaMiss.length} missed, ${areaStray.length} stray`);
}
if (!chordsTotal) console.log('W3: the bots never chorded in these runs (Part S checks the binding)');

// ── Part S: a stub match ─────────────────────────────────────────────────────────────────────────────
{
  const E = {};
  const ent = (id, kind, team, x, y, def) => (E[id] = { id, kind, team, x, y, alive: true, visibleMask: 3, statuses: [], def });
  const F0 = catalog.fighters[0].id;
  ent(1, 'fighter', 0, 100, 100, F0); ent(2, 'fighter', 1, 103, 100, F0);
  ent(9, 'structure', 1, 106, 100, seal?.units?.[0] ?? 'needle_outer');
  const players = [{ player: 0, team: 0, entity: 1, respawnIn: 0, abilities: [] }, { player: 1, team: 1, entity: 2, respawnIn: 0, abilities: [] }];
  let cb = null;
  const view = { time: 600, mode: 'stub', map: 'none', gorgeWind: 2, players, entities: Object.values(E), entity: (id) => E[id] };
  const stub = { you: 0, setup: { map: 'none', mode: 'stub' }, view, onEvents: (f) => { cb = f; return () => { cb = null; }; } };
  const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  eng.buffer = (file) => ({ then: (f) => { f({ duration: DUR[file] ?? 1, length: 48000, sampleRate: 48000 }); return { catch() {} }; } });
  eng.ensure();
  eng.listener(() => ({ x: 100, y: 100 }));
  eng.attach(stub);
  const log = spy(eng);
  const step = (dt = 0.25) => { view.time += dt; eng.ctx.advance(dt); eng.update(dt); };
  const batch = (evs) => { view.time += 1 / 30; cb(evs.map((e) => ({ t: view.time, ...e }))); };
  const since = (k, id) => log.cues.slice(k).filter((c) => c.id === id);
  // W4: attached at step 2: nothing; then 3, 4: one gust each, centred
  let k = log.cues.length;
  step(); step();
  const old = since(k, ev.gorgeWind).length;
  view.gorgeWind = 3; step(); view.gorgeWind = 4; step(); step();
  const gusts = since(k, ev.gorgeWind);
  report.S.W4 = { attachedMidWind: old, steps: 2, gusts: gusts.length, centred: gusts.every((c) => c.pos === null), bus: audio.cues[ev.gorgeWind]?.bus };
  if (old) failures.push(`W4: a client attached at step 2 heard ${old} old step(s)`);
  if (gusts.length !== 2 || !report.S.W4.centred) failures.push(`W4: 2 Gorge Wind steps requested ${gusts.length} gusts (centred ${report.S.W4.centred})`);
  // W5: the Noon Toll: its cue at once, no line, no duck; an unbound key still reaches the announcer
  for (let i = 0; i < 40; i++) step(0.1);                     // let anything pending clear
  k = log.cues.length;
  const lines0 = log.lines.length, ducks0 = log.ducks;
  batch([{ e: 'announce', key: 'noon_toll', params: { n: 6 } }]);
  for (let i = 0; i < 20; i++) step(0.1);
  const bells = since(k, ev['world.noon_toll']);
  const tollLines = log.lines.slice(lines0);
  report.S.W5 = { bells: bells.length, played: bells.filter((c) => c.r === 'played').length, lines: tollLines, ducks: log.ducks - ducks0, bus: audio.cues[ev['world.noon_toll']]?.bus };
  if (bells.length !== 1 || bells[0].r !== 'played') failures.push(`W5: the Noon Toll requested ${bells.length} bell(s) (${bells.map((c) => c.r).join(',')})`);
  if (tollLines.length) failures.push(`W5: the Noon Toll queued announcer line(s) ${tollLines.join(',')}`);
  if (log.ducks !== ducks0) failures.push(`W5: the Noon Toll ducked the mix (${log.ducks - ducks0} voice ducks)`);
  const lines1 = log.lines.length;
  batch([{ e: 'announce', key: 'probe_unbound_key' }]);
  report.S.W5.unboundStillAnnounced = log.lines.slice(lines1);
  if (!log.lines.slice(lines1).includes('announce.probe_unbound_key')) failures.push('W5: an unbound announce key no longer reaches the announcer');
  // W6: a shaded blow on a structure; an unshaded one; a shaded flag on a fighter
  k = log.cues.length;
  batch([{ e: 'damage', src: 2, dst: 9, amount: 40, dtype: 'physical', crit: false, shielded: 0, shaded: true }]);
  const shadedRows = log.cues.slice(k);
  k = log.cues.length;
  batch([{ e: 'damage', src: 2, dst: 9, amount: 40, dtype: 'physical', crit: false, shielded: 0 }]);
  const plainRows = log.cues.slice(k);
  k = log.cues.length;
  batch([{ e: 'damage', src: 2, dst: 1, amount: 40, dtype: 'physical', crit: false, shielded: 0, shaded: true }]);
  const fighterRows = log.cues.slice(k);
  const hitOf = (rs) => rs.find((c) => c.id !== ev.hitShaded);
  report.S.W6 = {
    shaded: shadedRows.map((c) => `${c.id}@${c.gain.toFixed(3)}`), plain: plainRows.map((c) => `${c.id}@${c.gain.toFixed(3)}`), onFighter: fighterRows.map((c) => `${c.id}@${c.gain.toFixed(3)}`),
  };
  if (!shadedRows.some((c) => c.id === ev.hitShaded)) failures.push('W6: a shaded blow on a structure requested no hitShaded cue');
  if (!(hitOf(shadedRows) && hitOf(plainRows) && hitOf(shadedRows).gain < hitOf(plainRows).gain * 0.6)) failures.push(`W6: the shaded hit is not muffled (${report.S.W6.shaded} vs ${report.S.W6.plain})`);
  if (plainRows.some((c) => c.id === ev.hitShaded)) failures.push('W6: an unshaded blow requested hitShaded');
  if (fighterRows.some((c) => c.id === ev.hitShaded)) failures.push('W6: a shaded flag on a fighter requested hitShaded');
  // W6 (ability): an ability blow voices through its 'hit' (the kit hit), which comes BEFORE its damage in the same
  // tick: a shaded one plays that kit hit at SHADED_GAIN too, an unshaded one at full gain
  const A1 = catalog.fighters[0].kit?.a1?.id ?? 'probe_ability';
  const abil = (shaded) => {
    const k0 = log.cues.length;
    batch([{ e: 'hit', src: 2, dst: 9, ability: A1 }, { e: 'damage', src: 2, dst: 9, amount: 40, dtype: 'magic', crit: false, ability: A1, shielded: 0, ...(shaded ? { shaded: true } : {}) }]);
    return log.cues.slice(k0);
  };
  const abShaded = abil(true), abPlain = abil(false);
  report.S.W6.ability = { ability: A1, shaded: abShaded.map((c) => `${c.id}@${c.gain.toFixed(3)}`), plain: abPlain.map((c) => `${c.id}@${c.gain.toFixed(3)}`) };
  if (!abShaded.some((c) => c.id === ev.hitShaded)) failures.push('W6: a shaded ability blow on a structure requested no hitShaded cue');
  if (!(hitOf(abShaded) && hitOf(abPlain) && hitOf(abShaded).gain < hitOf(abPlain).gain * 0.6)) failures.push(`W6: the shaded ability hit is not muffled (${report.S.W6.ability.shaded} vs ${report.S.W6.ability.plain})`);
  if (abPlain.some((c) => c.id === ev.hitShaded)) failures.push('W6: an unshaded ability blow requested hitShaded');
  // W3 (stub): an area with a bound vfx and no sfx; the same vfx with its own sfx keeps that sfx
  for (const [role, c] of areaRoles) {
    k = log.cues.length;
    batch([{ e: 'area', src: 2, ability: 'probe', x: 101, y: 100, shape: { kind: 'circle', radius: 3.5 }, delay: 0, vfx: role.slice('area.'.length), telegraph: 'none' }]);
    const got = log.cues.slice(k);
    k = log.cues.length;
    batch([{ e: 'area', src: 2, ability: 'probe', x: 101, y: 100, shape: { kind: 'circle', radius: 3.5 }, delay: 0, vfx: role.slice('area.'.length), sfx: 'ui_click', telegraph: 'none' }]);
    const own = log.cues.slice(k);
    (report.S.W3 ??= {})[role] = { bound: got.map((x) => x.id), withOwnSfx: own.map((x) => x.id) };
    if (!got.some((x) => x.id === c && x.pos?.x === 101)) failures.push(`W3: ${role} did not request ${c} at the area`);
    if (own.some((x) => x.id === c)) failures.push(`W3: an area with its own sfx also requested ${c}`);
  }
}

// ── W7: levels ────────────────────────────────────────────────────────────────────────────────────────
{
  const { execFileSync } = await import('node:child_process');
  const py = join(process.env.HOME ?? '', 'Developer', 'forgeflow-games', '.venv', 'bin', 'python3');
  const ids = [...new Set([ev.shieldStructure, ev.sealBreak, ev.gorgeWind, ev['world.noon_toll'], ev.hitShaded, ...areaRoles.map(([, c]) => c)])].filter(Boolean);
  let targets = {};
  try {
    const out = execFileSync(existsSync(py) ? py : 'python3', ['-c', `import sys, json; sys.path.insert(0, 'audio'); import cues; from cuelib import REGISTRY; print(json.dumps({k: REGISTRY[k].target[1] for k in sys.argv[1:] if k in REGISTRY}))`, ...ids, ev.announceMinor],
      { cwd: ROOT, encoding: 'utf8' });
    targets = JSON.parse(out.trim().split('\n').pop());
  } catch (e) { failures.push(`W7: could not read the recipes' targets (${String(e).slice(0, 120)})`); }
  const ann = targets[ev.announceMinor];
  report.W7 = { announceMinor: ann, cues: Object.fromEntries(ids.map((id) => [id, { targetMaxMomentary: targets[id] ?? null, bus: audio.cues[id]?.bus, gain: audio.cues[id]?.gain }])) };
  for (const id of ids) {
    if (audio.cues[id]?.bus === 'voice') failures.push(`W7: ${id} is on the voice bus (it would duck the mix)`);
    if (!(targets[id] < ann)) failures.push(`W7: ${id} targets ${targets[id]} max momentary, not under the announcer's ${ann}`);
  }
}

report.failures = failures;
report.pass = failures.length === 0;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`W4 ${JSON.stringify(report.S.W4)}`);
console.log(`W5 ${JSON.stringify(report.S.W5)}`);
console.log(`W6 ${JSON.stringify(report.S.W6)}`);
console.log(`W3 stub ${JSON.stringify(report.S.W3)}`);
console.log(`W7 ${JSON.stringify(report.W7)}`);
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: the Dawn Seal sets and ends, Vashil\'s chord, the Gorge Wind, the Noon Toll and a Ringshade-muffled blow each sound their own cue, under the announcer, ducking nothing');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
