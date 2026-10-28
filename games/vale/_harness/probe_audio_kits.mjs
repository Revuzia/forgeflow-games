// VALE harness — fighters are told apart by ear (final parity AUD-1): the engine's kit resolver in real matches.
//
//   node _harness/probe_audio_kits.mjs [--out <report.json>] [--minutes N] [--seeds 3,5] [--modes rift,fray]
//
// REAL matches (the built catalog in dist-catalog/, LocalMatchHost, bot brains on every seat) drive the REAL engine
// (src/audio/index.ts) against content/audio.json as it is now; only WebAudio is faked (sources end after their real
// file's length). The seats hold every fighter with a whole kit (f_<fighter>_<slot> for all ten slots) plus fighters
// without one (the fallback). One omni listener: the camera on every event's subject, fog lifted (this checks which
// cue the engine CHOOSES; fog and earshot are other probes' business). Every cue request is recorded with the event
// that caused it, and every file the engine fetched.
// Gates:
//   K1  a kitted fighter's attack → f_<id>_attack_swing; its basic attack's damage → f_<id>_attack_hit (a crit:
//       the crit cue AND f_<id>_attack_hit); its a1/a2/a3 cast → f_<id>_<slot>; its ult cast → f_<id>_ult_windup; its
//       death → f_<id>_death. 0 misses; every kitted fighter attacked, hit and cast a1-a3 at least once
//   K2  ult release: the sim commits an ult's cooldown at its release (an independent signal: the ult's AbilityView
//       cooldown jumps up, its ability id unchanged — a form swap restoring a stashed cooldown is no release); every such release of a kitted fighter requests f_<id>_ult_release within 2 ticks of it,
//       and no release is requested without one (a cancelled wind-up stays silent)
//   K3  round-robin: every kitted attack_swing / attack_hit cue played >= 9 times fetched all 3 of its files
//   K4  a fighter WITHOUT a kit keeps its catalog / generic cues (attack → its present.sfx, ult cast → present.sfx
//       or the castUlt role) and requests no f_* kit cue but its passive
//   K5  fighterCall(id): true and f_<id>_call for a kitted fighter, false and silent for one without a call
// Exit 0 = K1-K5 hold, 1 = a gate fails, 77 = no built catalog. Report → _harness/_reports/fw_W3_kits.json.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'fw_W3_kits.json'));
const MINUTES = Number(arg('--minutes', 10));
const SEEDS = arg('--seeds', '3,5').split(',').map(Number);
const MODES = arg('--modes', 'rift,fray').split(',');
const SLOTS = ['attack_swing', 'attack_hit', 'a1', 'a2', 'a3', 'ult_windup', 'ult_release', 'passive', 'death', 'call'];

// ── a minimal fake WebAudio + DOM (the engine only builds a graph and starts sources) ─────────────────────
class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.gain = new Param(1); }
  connect(d) { this.outs.push(d); return d; }
  disconnect() { this.outs = []; }
}
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node(this, 'destination'); this.live = []; }
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
    n.start = () => { n.endAt = this.currentTime + (n.loop ? 1e9 : (n.buffer?.duration ?? 1)); this.live.push(n); };
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

const kitted = catalog.fighters.filter((f) => SLOTS.every((s) => audio.cues[`f_${f.id}_${s}`])).map((f) => f.id);
const bare = catalog.fighters.filter((f) => !kitted.includes(f.id)).map((f) => f.id);
const fdef = new Map(catalog.fighters.map((f) => [f.id, f]));
const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };
const failures = [];
const report = { probe: 'probe_audio_kits', catalog: ver, seeds: SEEDS, kitted, bare, modes: {} };
console.log(`kitted (${kitted.length}): ${kitted.join(' ')}\nwithout a kit (${bare.length}): ${bare.join(' ') || '-'}`);
if (!kitted.length) failures.push('no fighter has a whole kit: the probe is vacuous');

// K5: the lock-in call
{
  const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  eng.buffer = () => ({ then: (f) => { f({ duration: 1 }); return { catch() {} }; } });
  eng.ensure();
  const asked = [];
  const orig = eng.cue;
  eng.cue = function (id, ...rest) { asked.push(id); return orig.call(this, id, ...rest); };
  const calls = {};
  for (const f of catalog.fighters) {
    asked.length = 0;
    const ok = eng.fighterCall(f.id);
    calls[f.id] = { ok, cues: [...asked] };
    const has = !!audio.cues[`f_${f.id}_call`];
    if (ok !== has) failures.push(`K5 fighterCall(${f.id}) returned ${ok} but content ${has ? 'has' : 'has no'} f_${f.id}_call`);
    if (has && asked[0] !== `f_${f.id}_call`) failures.push(`K5 fighterCall(${f.id}) played ${asked.join(',') || 'nothing'}`);
    if (!has && asked.length) failures.push(`K5 fighterCall(${f.id}) played ${asked.join(',')} with no call in content`);
  }
  report.calls = calls;
}

for (const SEED of SEEDS) for (const [mi, modeId] of MODES.entries()) {
  const run = `${modeId}#${SEED}`;
  const mode = catalog.modes.find((m) => m.id === modeId);
  if (!mode) { failures.push(`no mode ${modeId}`); continue; }
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
  const n = mode.teams * mode.perTeam;
  const YOU = Math.min(7, n - 1);
  // the kitted fighters first (alternating teams), the rest of the seats from the fighters without a kit
  const order = [...kitted.slice(mi % 2), ...kitted.slice(0, mi % 2), ...bare];
  const seats = [];
  for (let i = 0; i < n; i++) {
    const fighter = order[i % order.length];
    seats.push({
      player: i, team: mode.teams > 1 ? i % mode.teams : i, name: catalog.botNames[i % catalog.botNames.length], fighter,
      skin: catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '',
      role: mode.roles ? roles[Math.floor(i / mode.teams) % mode.perTeam]?.id : undefined,
      loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
      controller: i === YOU ? 'human' : 'bot', botDifficulty: 'adept', colorIndex: i,
    });
  }
  const setup = { matchId: `probe-audio-kits-${run}`, seed: SEED, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
  const host = new LocalMatchHost(catalog, setup, YOU, { bots: createBots(catalog, setup), pregameSeconds: 0, autopilot: true });
  const view = host.view;

  let cur = null;
  const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  eng.listener(() => { if (!cur) return null; const s = view.entity(cur.dst ?? cur.src ?? cur.id); return s ? { x: s.x, y: s.y } : null; });
  const files = {};                                        // cue → file → fetches
  eng.buffer = (file) => ({ then: (f) => { f({ duration: DUR[file] ?? 1, length: 48000, sampleRate: 48000 }); return { catch() {} }; } });
  eng.ensure();
  eng.seen = () => true; eng.seenAt = () => true;          // fog lifted: the cue CHOICE is under test
  const asks = [];                                         // { t, cue, r } for every request an event made
  const byEv = new Map();                                  // event → the cue ids it requested
  const origCue = eng.cue;
  eng.cue = function (id, ...rest) {
    const r = origCue.call(this, id, ...rest);
    asks.push({ t: view.time, cue: id, r });             // (a release with no effect sounds after its batch: no event)
    if (cur) {
      let l = byEv.get(cur);
      if (!l) byEv.set(cur, (l = []));
      l.push(id);
    }
    return r;
  };
  const fileCue = new Map(Object.entries(audio.cues).flatMap(([id, d]) => d.files.map((f) => [f, id])));
  const origBuffer = eng.buffer;
  eng.buffer = function (file) {
    const c = fileCue.get(file);
    if (c) ((files[c] ??= {})[file] = (files[c]?.[file] ?? 0) + 1);
    return origBuffer.call(this, file);
  };
  const origOn = eng.onEvent;
  eng.onEvent = function (e) { cur = e; try { return origOn.call(this, e); } finally { cur = null; } };
  eng.attach(host);

  // the sim's own record of every event, by kind and fighter
  const evs = [];
  host.onEvents((batch) => { for (const e of batch) evs.push(e); });
  // K2's independent signal: the ult's cooldown committed (it jumps up) → a release at that tick
  const ultCd = new Map();                                 // player → the ult's last { id, cooldown }
  const releases = [];                                     // { t, fighter, entity }

  host.start();
  const mins = mi === 0 ? MINUTES : Math.min(MINUTES, 5);
  const ticks = Math.round(mins * 60 * 30);
  for (let i = 0; i < ticks && !host.ended; i++) {
    host.pump(1 / 30);
    eng.ctx.advance(1 / 30);
    if (i % 8 === 0) eng.update(8 / 30);
    for (const p of view.players) {
      const u = p.abilities.find((a) => a.slot === 'ult');
      if (!u) continue;
      // a form swap (Ervet's Hilt) restores a stashed cooldown: the same ability id on both ticks, or it is no release
      const prev = ultCd.get(p.player) ?? { id: u.id, cd: 0 };
      if (u.id === prev.id && u.cooldown > prev.cd + 1 && u.cooldown > 1) releases.push({ t: view.time, fighter: p.fighter, entity: p.entity });
      ultCd.set(p.player, { id: u.id, cd: u.cooldown });
    }
  }

  // ── judge ─────────────────────────────────────────────────────────────────────────────────────
  const fighterOf = (id) => { const e = view.entity(id); return e?.kind === 'fighter' ? e.def : undefined; };
  const asked = (e) => byEv.get(e) ?? [];
  const per = {};
  const miss = [];
  const tally = (f, k, ok) => { const r = ((per[f] ??= {})[k] ??= { n: 0, ok: 0 }); r.n++; if (ok) r.ok++; };
  for (const e of evs) {
    if (e.e === 'attack') {
      const f = fighterOf(e.src);
      if (!f) continue;
      const got = asked(e);
      if (kitted.includes(f)) { const ok = got.includes(`f_${f}_attack_swing`); tally(f, 'attack_swing', ok); if (!ok) miss.push(`${f} attack → ${got.join(',') || 'nothing'}`); }
      else {
        const want = fdef.get(f)?.attack?.present?.sfx ?? audio.events.attack;
        if (!got.includes(want) || got.some((c) => c.startsWith('f_'))) failures.push(`K4 ${run}: ${f} (no kit) attack → ${got.join(',')} (want ${want})`);
        tally(f, 'attack_swing', got.includes(want));
      }
    } else if (e.e === 'damage' && !e.ability) {
      const f = fighterOf(e.src);
      if (!f || !kitted.includes(f)) continue;
      const got = asked(e);
      const ok = got.includes(`f_${f}_attack_hit`) && (!e.crit || got.includes(audio.events.crit));
      tally(f, e.crit ? 'attack_hit (crit)' : 'attack_hit', ok);
      if (!ok) miss.push(`${f} ${e.crit ? 'crit' : 'hit'} → ${got.join(',') || 'nothing'}`);
    } else if (e.e === 'cast') {
      const f = fighterOf(e.src);
      if (!f || !['a1', 'a2', 'a3', 'ult'].includes(e.slot)) continue;
      const got = asked(e);
      if (kitted.includes(f)) {
        const want = e.slot === 'ult' ? `f_${f}_ult_windup` : `f_${f}_${e.slot}`;
        const ok = got.includes(want);
        tally(f, e.slot === 'ult' ? 'ult_windup' : e.slot, ok);
        if (!ok) miss.push(`${f} ${e.slot} cast → ${got.join(',') || 'nothing'}`);
      } else if (e.slot === 'ult') {
        const want = fdef.get(f)?.kit?.ult?.present?.sfx ?? audio.events.castUlt;
        if (!got.includes(want) || got.some((c) => c.startsWith('f_'))) failures.push(`K4 ${run}: ${f} (no kit) ult cast → ${got.join(',')} (want ${want})`);
      }
    } else if (e.e === 'death' && e.kind === 'fighter') {
      const f = fighterOf(e.dst);
      if (!f) continue;
      const got = asked(e);
      if (kitted.includes(f)) { const ok = got.includes(`f_${f}_death`); tally(f, 'death', ok); if (!ok) miss.push(`${f} death → ${got.join(',') || 'nothing'}`); }
      else if (got.some((c) => c.startsWith('f_'))) failures.push(`K4 ${run}: ${f} (no kit) death → ${got.join(',')}`);
    }
  }
  // K2: releases. Sim-side release ticks vs the engine's f_<id>_ult_release requests
  const relAsks = asks.filter((a) => /^f_.+_ult_release$/.test(a.cue));
  const used = new Set();
  const rel = { sim: 0, matched: 0, late: [], orphanAsks: 0 };
  for (const r of releases) {
    if (!kitted.includes(r.fighter)) continue;
    rel.sim++;
    const m = relAsks.find((a, i) => !used.has(i) && a.cue === `f_${r.fighter}_ult_release` && Math.abs(a.t - r.t) <= 2 / 30 + 1e-6 && ((used.add(i)) || true));
    if (m) { rel.matched++; tally(r.fighter, 'ult_release', true); }
    else { tally(r.fighter, 'ult_release', false); rel.late.push(`${r.fighter} @${r.t.toFixed(2)}`); }
  }
  rel.orphanAsks = relAsks.length - used.size;
  if (rel.late.length) failures.push(`K2 ${run}: ${rel.late.length} ult release(s) the sim committed with no f_<id>_ult_release within 2 ticks: ${rel.late.slice(0, 6).join(', ')}`);
  if (rel.orphanAsks) failures.push(`K2 ${run}: ${rel.orphanAsks} f_<id>_ult_release request(s) with no committed release (a cancelled wind-up must stay silent)`);
  // release timing: the request lands castTime after its wind-up
  const timing = [];
  for (const a of relAsks) {
    const f = a.cue.slice(2, -'_ult_release'.length);
    const c = [...evs].reverse().find((e) => e.e === 'cast' && e.slot === 'ult' && fighterOf(e.src) === f && e.t <= a.t + 1e-6);
    if (c) timing.push(+(a.t - c.t - c.castTime).toFixed(3));
  }
  // K3: round-robin
  const rr = {};
  for (const f of kitted) for (const s of ['attack_swing', 'attack_hit']) {
    const c = `f_${f}_${s}`;
    const plays = asks.filter((a) => a.cue === c && a.r === 'played').length;
    const used3 = Object.keys(files[c] ?? {}).length;
    rr[c] = { plays, files: used3, of: audio.cues[c].files.length };
    if (plays >= 9 && used3 < 3) failures.push(`K3 ${run}: ${c} played ${plays}x but fetched only ${used3} of its files`);
  }
  if (miss.length) failures.push(`K1 ${run}: ${miss.length} kitted event(s) missed their kit cue: ${miss.slice(0, 8).join(' · ')}`);
  report.modes[run] = { simSeconds: +view.time.toFixed(1), seats: seats.map((s) => s.fighter), perFighter: per, releases: rel, releaseLagS: timing, roundRobin: rr };
  console.log(`${run}: ${view.time.toFixed(0)} s, seats ${seats.map((s) => s.fighter).join(' ')}`);
  for (const [f, r] of Object.entries(per)) console.log(`  ${f.padEnd(8)} ${Object.entries(r).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join(' · ')}`);
  console.log(`  ult releases: sim ${rel.sim}, matched ${rel.matched}, orphan requests ${rel.orphanAsks}; lag after wind-up (s): ${[...new Set(timing)].join(' ') || '-'}`);
}

// coverage: every kitted fighter attacked, hit and cast a1-a3 (across the modes); every slot exercised by someone
const cover = {};
for (const m of Object.values(report.modes)) for (const [f, r] of Object.entries(m.perFighter)) for (const [k, v] of Object.entries(r)) ((cover[f] ??= {})[k] = (cover[f]?.[k] ?? 0) + v.n);
for (const f of kitted) for (const k of ['attack_swing', 'attack_hit', 'a1', 'a2', 'a3']) if (!cover[f]?.[k]) failures.push(`coverage: ${f} never exercised ${k} (vacuous)`);
for (const k of ['ult_windup', 'ult_release', 'death']) if (!kitted.some((f) => cover[f]?.[k])) failures.push(`coverage: no kitted fighter exercised ${k} (vacuous)`);
report.coverage = cover;
report.failures = failures;
report.pass = failures.length === 0;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: every kitted fighter sounds its own kit (attacks, hits, casts, wind-ups, releases on the sim\'s commit, deaths); round-robin in use; fighters without a kit keep their catalog cues; the lock-in call resolves');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
