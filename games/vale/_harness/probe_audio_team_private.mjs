// VALE harness — team-private comms stay private in the AUDIO engine (final parity AUD-MISS-1, AUD-MISS-2).
//
//   node _harness/probe_audio_team_private.mjs [--out <report.json>]
//
// A REAL RIFT match (the built catalog in dist-catalog/, LocalMatchHost, bot brains for every other seat) drives
// the REAL engine (src/audio/index.ts) against content/audio.json as it is now; only WebAudio is faked (Node has
// none), so a cue the engine tries is recorded and attributed to the SimEvent that caused it. You are seat 8
// (team 1). For every PingKind of the sim's contract (parsed from src/contracts/sim.ts):
//   · an ENEMY seat pings          → the engine tries 0 cues for that event
//   · an ALLY bot pings            → its ping cue plays
//   · YOU ping                     → its ping cue plays
// so every PingKind must also be bound (events 'ping.<PingKind>', exact spelling) to a cue that exists. Then an
// enemy seat opens a surrender vote and the vote runs out or passes: 0 cues for every team-0 surrender_* announce;
// finally your own vote (you are your team's only voter, so it passes) plays the announce cues.
// Exit 0 = all hold, 1 = a leak / a silent own-team ping / an unbound PingKind, 77 = no built catalog.
// Report → _harness/_reports/fw_W3_team_private.json (or --out).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'fw_W3_team_private.json');

// ── a minimal fake WebAudio + DOM (the engine only builds a graph and starts sources) ─────────────────────
class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.gain = new Param(1); }
  connect(d) { this.outs.push(d); return d; }
  disconnect() { this.outs = []; }
}
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node(this, 'destination'); this.started = []; }
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
    n.start = () => { this.started.push(n); };
    n.stop = () => {};
    return n;
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
// the surrender vote may open from 1 s (the gate under test does not depend on the clock)
const mode = catalog.modes.find((m) => m.id === 'rift') ?? catalog.modes.find((m) => m.rules?.surrender);
if (mode.rules.surrender) mode.rules.surrender = { ...mode.rules.surrender, earliest: 1 };

const PING_KINDS = (() => {
  const src = readFileSync(join(ROOT, 'src', 'contracts', 'sim.ts'), 'utf8');
  const m = /export type PingKind\s*=\s*([^;]+);/.exec(src);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
})();

const { LocalMatchHost } = await import('../src/session/match_host.ts');
const { createBots } = await import('../src/sim/bots/index.ts');
const { createAudioEngine } = await import('../src/audio/index.ts');

const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
const YOU = 8;
const seats = [];
for (let i = 0; i < mode.teams * mode.perTeam; i++) {
  const fighter = catalog.fighters[(i * 7 + 3) % catalog.fighters.length].id;
  seats.push({
    player: i, team: Math.floor(i / mode.perTeam), name: catalog.botNames[i % catalog.botNames.length], fighter,
    skin: catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '',
    role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
    loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
    controller: i === YOU ? 'human' : 'bot', ...(i === YOU ? {} : { botDifficulty: 'adept' }), colorIndex: i,
  });
}
const setup = { matchId: 'probe-audio-team-private', seed: 7, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
const host = new LocalMatchHost(catalog, setup, YOU, { bots: createBots(catalog, setup), pregameSeconds: 0 });

const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } } });
// attribute every cue the engine TRIES to the event that caused it
let cur = null;
const tried = [];
const origOn = eng.onEvent, origCue = eng.cue, origAnn = eng.announce;
eng.onEvent = function (e) { cur = e; try { return origOn.call(this, e); } finally { cur = null; } };
eng.cue = function (id, ...rest) { if (id && cur) tried.push({ id, e: cur }); return origCue.call(this, id, ...rest); };
// an announcer line is queued by its event and spoken after the tick's batch (AUD-3): it counts for the event that queued it
eng.announce = function (role, band, rank, key, t, fallback) {
  const id = this.events[role] ?? (fallback ? this.events[fallback] : undefined);
  if (id && cur) tried.push({ id, e: cur });
  return origAnn.call(this, role, band, rank, key, t, fallback);
};
const events = [];
host.onEvents((evs) => { for (const e of evs) events.push(e); });
eng.attach(host);
host.start();
const ctx = () => eng.ctx;                       // created on the first cue
const flush = () => new Promise((r) => setTimeout(r, 0));
// advance the sim by `s` seconds one tick at a time (a single long pump would hit the host's catch-up cap)
const run = async (s) => {
  for (let i = Math.round(s * 30); i > 0 && !host.ended; i--) host.pump(1 / 30);
  if (ctx()) ctx().currentTime += s + 1;        // +1 s: cue cooldowns never mask a result
  await flush(); await flush();
};

const team = (p) => seats.find((s) => s.player === p)?.team;
const ENEMY = seats.find((s) => s.team !== team(YOU)).player;
const ALLY = seats.find((s) => s.team === team(YOU) && s.player !== YOU).player;
const failures = [];
const rows = [];
const ping = (who, kind) => { const cmd = { type: 'ping', kind, x: 60, y: 60 }; if (who === YOU) host.send(cmd); else host.sim.command(who, cmd); };
const triedFor = (pred) => tried.filter((t) => pred(t.e)).map((t) => t.id);

await run(0.5);
for (const kind of PING_KINDS) {
  const bound = audio.events[`ping.${kind}`];
  if (!bound || !audio.cues[bound]) failures.push(`PingKind "${kind}" has no cue: audio.events["ping.${kind}"] = ${JSON.stringify(bound)}`);
  const row = { kind, bound: bound ?? null };
  for (const [who, label] of [[ENEMY, 'enemy'], [ALLY, 'ally'], [YOU, 'you']]) {
    const n0 = events.length;
    ping(who, kind);
    await run(1.0);
    const evs = events.slice(n0).filter((e) => e.e === 'ping' && e.player === who && e.kind === kind);
    const cues = triedFor((e) => evs.includes(e));
    row[label] = { events: evs.length, cues };
    if (evs.length !== 1) failures.push(`${label} ${kind} ping: ${evs.length} ping events (expected 1; the sim did not take the command)`);
    else if (label === 'enemy' && cues.length) failures.push(`LEAK: enemy ${kind} ping played ${cues.join(', ')}`);
    else if (label !== 'enemy' && !(bound && cues.includes(bound))) failures.push(`${label} ${kind} ping is silent (tried ${JSON.stringify(cues)}, bound ${bound})`);
  }
  rows.push(row);
}

// the enemy team's surrender vote, run out (or passed by its bots): every team-0 surrender_* announce is silent
const enemyTeam = team(ENEMY);
const nS = events.length;
host.sim.command(ENEMY, { type: 'surrenderVote', yes: true });
for (let i = 0; i < 80 && !host.ended; i++) {
  await run(1.0);
  if (events.slice(nS).some((e) => e.e === 'announce' && e.team === enemyTeam && /^surrender_(failed|passed)$/.test(e.key))) break;
}
const enemySurr = events.slice(nS).filter((e) => e.e === 'announce' && /^surrender_/.test(e.key) && e.team === enemyTeam);
const enemySurrCues = triedFor((e) => enemySurr.includes(e));
if (!enemySurr.some((e) => e.key === 'surrender_vote')) failures.push('the enemy surrender vote never opened (no team-0 surrender_vote announce): the check is vacuous');
if (enemySurrCues.length) failures.push(`LEAK: the enemy team's surrender announces played ${enemySurrCues.join(', ')}`);

// your own vote: you are your team's only human voter, so it passes; both announces sound for you
let ownSurr = [], ownSurrCues = [];
if (!host.ended) {
  const nO = events.length;
  host.send({ type: 'surrenderVote', yes: true });
  for (let i = 0; i < 5; i++) await run(0.5);
  ownSurr = events.slice(nO).filter((e) => e.e === 'announce' && /^surrender_/.test(e.key) && e.team === team(YOU));
  ownSurrCues = triedFor((e) => ownSurr.includes(e));
  if (!ownSurr.length) failures.push('your own surrender vote raised no announce (the positive control is vacuous)');
  else if (!ownSurrCues.length) failures.push(`your team's surrender announces are silent (${ownSurr.map((e) => e.key).join(', ')})`);
}

const report = {
  probe: 'probe_audio_team_private', catalog: ver, mode: mode.id, you: YOU, myTeam: team(YOU), enemy: ENEMY, ally: ALLY,
  pingKinds: PING_KINDS, pings: rows,
  enemySurrender: { announces: enemySurr.map((e) => [e.key, e.team, +e.t.toFixed(2)]), cues: enemySurrCues },
  ownSurrender: { announces: ownSurr.map((e) => [e.key, e.team, +e.t.toFixed(2)]), cues: ownSurrCues },
  played: eng.log.slice(), failures, pass: failures.length === 0,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
for (const r of rows) console.log(`ping ${r.kind.padEnd(10)} enemy ${String(r.enemy.cues.length).padStart(1)} cue(s) · ally ${r.ally.cues.join(',') || '-'} · you ${r.you.cues.join(',') || '-'}`);
console.log(`enemy surrender: ${enemySurr.map((e) => e.key).join(', ') || '(none)'} → ${enemySurrCues.length} cue(s)`);
console.log(`own surrender:   ${ownSurr.map((e) => e.key).join(', ') || '(none)'} → ${ownSurrCues.join(', ') || '(none)'}`);
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: enemy pings and surrender votes are silent; every own-team PingKind sounds');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
