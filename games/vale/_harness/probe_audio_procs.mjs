// VALE harness — passive procs are heard (final parity AUD-6).
//
//   node _harness/probe_audio_procs.mjs [--out <report.json>] [--minutes N] [--seed N] [--modes rift,bridge,fray]
//
// REAL matches (the built catalog in dist-catalog/, LocalMatchHost, bot brains on every seat) drive the REAL engine
// (src/audio/index.ts) against content/audio.json as it is now; only WebAudio is faked (sources end after their
// real file's length). Every 'proc' the sim emits must come to a decision in the engine (its procStats): played,
// held by its owner's window or the cue's cooldown / voices, out of earshot, fogged — never `unbound` (no cue).
// Two listeners hear each match:
//   player   the camera on your fighter (what a player hears)
//   omni     the camera on every proc's subject as it fires (every proc in earshot: the cue choice itself)
// Gates (RIFT runs --minutes, default 9; BRIDGE / FRAY 4 min each):
//   P1  0 unbound procs, and every proc the sim emitted reached a decision (sum of outcomes = proc events), both rigs
//   P2  omni: every passive that fired and was seen played its cue at least once; a fighter's passive plays its own
//       f_<fighter>_passive
//   P3  passive damage with no delivery (a 'damage' carrying a passive id, no 'hit'): voiced by a proc of that
//       passive on that target in the same tick, or within 3 s after one (a burn's ticks) — 0 orphans
// Exit 0 = P1–P3 hold, 1 = a gate fails, 77 = no built catalog. Report → _harness/_reports/fw_W3_procs.json.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'fw_W3_procs.json'));
const MINUTES = Number(arg('--minutes', 9));
const SEED = Number(arg('--seed', 3));
const MODES = arg('--modes', 'rift,bridge,fray').split(',');

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

// passive id → owner kind / id (from the catalog, like the engine)
const owner = new Map();
for (const f of catalog.fighters) owner.set(f.kit.passive.id, { kind: 'fighter', id: f.id });
for (const it of catalog.items) for (const p of it.passives ?? []) owner.set(p.id, { kind: 'item', id: it.id });
for (const b of catalog.setup.boons) owner.set(b.id, { kind: 'boon', id: b.id });
for (const tb of catalog.teamBuffs) for (const p of tb.passives ?? []) owner.set(p.id, { kind: 'team', id: tb.id });
for (const u of catalog.units) if (u.passive) owner.set(u.passive.id, { kind: 'unit', id: u.id });

const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };
const failures = [];
const report = { probe: 'probe_audio_procs', catalog: ver, seed: SEED, modes: {} };

for (const modeId of MODES) {
  const mode = catalog.modes.find((m) => m.id === modeId);
  if (!mode) { failures.push(`no mode ${modeId}`); continue; }
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
  const n = mode.teams * mode.perTeam;
  const YOU = Math.min(7, n - 1);
  const seats = [];
  for (let i = 0; i < n; i++) {
    // every fighter of the roster across the three modes (16 fighters, 10 seats per match, offset per mode)
    const fighter = catalog.fighters[(i * 7 + 3 + MODES.indexOf(modeId) * 5) % catalog.fighters.length].id;
    seats.push({
      player: i, team: mode.teams > 1 ? Math.floor(i / mode.perTeam) : i, name: catalog.botNames[i % catalog.botNames.length], fighter,
      skin: catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '',
      role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
      loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
      controller: i === YOU ? 'human' : 'bot', botDifficulty: 'adept', colorIndex: i,
    });
  }
  const setup = { matchId: `probe-audio-procs-${modeId}`, seed: SEED, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
  const host = new LocalMatchHost(catalog, setup, YOU, { bots: createBots(catalog, setup), pregameSeconds: 0, autopilot: true });
  const view = host.view;

  let cur = null;
  const rig = (name, focus) => {
    const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
    if (focus) eng.listener(focus);
    eng.buffer = (file) => ({ then: (f) => { f({ duration: DUR[file] ?? 1, length: 48000, sampleRate: 48000 }); return { catch() {} }; } });
    eng.ensure();
    const plays = {};                      // passive → cue → count
    const origCue = eng.cue;
    eng.cue = function (id, ...rest) {
      const r = origCue.call(this, id, ...rest);
      if (cur?.e === 'proc' && r === 'played') ((plays[cur.ability] ??= {})[id] = (plays[cur.ability]?.[id] ?? 0) + 1);
      return r;
    };
    const outcomes = {};                   // passive → outcome → count (the engine's procStats, attributed)
    const origOn = eng.onEvent;
    eng.onEvent = function (e) {
      cur = e;
      const before = e.e === 'proc' ? { ...this.procStats } : null;
      try { return origOn.call(this, e); } finally {
        if (before) for (const [k, v] of Object.entries(this.procStats)) if (v !== before[k]) ((outcomes[e.ability] ??= {})[k] = (outcomes[e.ability]?.[k] ?? 0) + v - before[k]);
        cur = null;
      }
    };
    eng.attach(host);
    return { name, eng, plays, outcomes };
  };
  const subjectAt = () => { if (!cur) return null; const s = view.entity(cur.dst ?? cur.src); return s ? { x: s.x, y: s.y } : null; };
  const player = rig('player', null);
  const omni = rig('omni', subjectAt);
  const rigs = [player, omni];

  // the sim's own record: procs per passive, and passive damage with / without its proc
  const procs = {};
  let procEvents = 0;
  const pd = { sameTick: 0, afterProc: 0, orphan: 0, orphans: {} };
  const lastProc = new Map();             // `${passive}:${dst}` → sim time
  host.onEvents((evs) => {
    const hits = new Set(evs.filter((e) => e.e === 'hit').map((e) => `${e.ability}:${e.dst}`));
    const tickProcs = new Set(evs.filter((e) => e.e === 'proc').map((e) => `${e.ability}:${e.dst}`));
    for (const e of evs) {
      if (e.e === 'proc') {
        procEvents++;
        const o = owner.get(e.ability);
        const k = `${o ? `${o.kind}:${o.id}` : '?'} ${e.ability}`;
        (procs[k] ??= { n: 0, on: {} }).n++;
        procs[k].on[e.on] = (procs[k].on[e.on] ?? 0) + 1;
        lastProc.set(`${e.ability}:${e.dst}`, e.t);
      }
      if (e.e === 'damage' && e.ability && owner.has(e.ability) && !hits.has(`${e.ability}:${e.dst}`)) {
        const key = `${e.ability}:${e.dst}`;
        if (tickProcs.has(key)) pd.sameTick++;
        else if (e.t - (lastProc.get(key) ?? -1e9) <= 3) pd.afterProc++;
        else { pd.orphan++; pd.orphans[e.ability] = (pd.orphans[e.ability] ?? 0) + 1; }
      }
    }
  });

  host.start();
  const mins = modeId === MODES[0] ? MINUTES : Math.min(MINUTES, 4);
  const ticks = Math.round(mins * 60 * 30);
  for (let i = 0; i < ticks && !host.ended; i++) {
    host.pump(1 / 30);
    for (const r of rigs) { r.eng.ctx.advance(1 / 30); if (i % 8 === 0) r.eng.update(8 / 30); }
  }

  const m = { simSeconds: +view.time.toFixed(1), fighters: seats.map((s) => s.fighter), procEvents, procs, passiveDamage: pd, rigs: {} };
  for (const r of rigs) {
    const st = { ...r.eng.procStats };
    const sum = Object.values(st).reduce((a, b) => a + b, 0);
    m.rigs[r.name] = { outcomes: st, decided: sum, plays: r.plays };
    if (st.unbound) failures.push(`P1 ${modeId}/${r.name}: ${st.unbound} proc(s) with no cue`);
    if (sum !== procEvents) failures.push(`P1 ${modeId}/${r.name}: ${procEvents} proc events but ${sum} decisions (a proc fell through the engine)`);
  }
  // P2: omni — every passive that fired where your team could see it sounded: its cue played, or the very same
  // cue had just started for the same instant (e.g. a shield passive whose 'shield' event plays the shield cue)
  for (const k of Object.keys(procs)) {
    const id = k.split(' ')[1];
    const o = owner.get(id);
    const played = omni.plays[id] ?? {};
    const out = omni.outcomes[id] ?? {};
    const total = Object.values(played).reduce((a, b) => a + b, 0);
    const seen = (procs[k].n - (out.unseen ?? 0));
    procs[k].omni = out;
    if (seen > 0 && !total && !out.cooldown) failures.push(`P2 ${modeId}: ${k} fired ${seen}x in sight and never sounded (omni: ${JSON.stringify(out)})`);
    if (o?.kind === 'fighter' && total && !played[`f_${o.id}_passive`]) failures.push(`P2 ${modeId}: ${k} played ${Object.keys(played).join(',')} instead of f_${o.id}_passive`);
  }
  if (pd.orphan) failures.push(`P3 ${modeId}: ${pd.orphan} passive damage event(s) with no delivery and no proc (${JSON.stringify(pd.orphans)})`);
  if (!procEvents) failures.push(`${modeId}: no procs at all: the check is vacuous`);
  report.modes[modeId] = m;
  const o = m.rigs.omni.outcomes, p = m.rigs.player.outcomes;
  console.log(`${modeId}: ${m.simSeconds} s, ${procEvents} procs from ${Object.keys(procs).length} passives`);
  console.log(`  player  ${Object.entries(p).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  omni    ${Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  passive damage without delivery: ${pd.sameTick} voiced by the proc in the same tick, ${pd.afterProc} ticks within 3 s of one, ${pd.orphan} orphans`);
  for (const [k, v] of Object.entries(procs).sort((a, b) => b[1].n - a[1].n)) {
    const id = k.split(' ')[1];
    console.log(`    ${String(v.n).padStart(5)}  ${k.padEnd(50)} → ${Object.entries(omni.plays[id] ?? {}).map(([c, n]) => `${c} x${n}`).join(', ') || '-'}  [${Object.entries(omni.outcomes[id] ?? {}).map(([c, n]) => `${c} ${n}`).join(' ')}]`);
  }
}

report.failures = failures;
report.pass = failures.length === 0;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: every proc reaches a decision, none unbound; every passive that fired was heard; passive damage is voiced by its proc');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
