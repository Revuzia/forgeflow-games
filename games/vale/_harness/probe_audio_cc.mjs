// VALE harness — threat and control read by ear (final parity AUD-5).
//
//   node _harness/probe_audio_cc.mjs [--out <report.json>] [--baseline <git-rev>] [--minutes N] [--seed N]
//
// Part 1, a REAL RIFT match (the built catalog in dist-catalog/, LocalMatchHost, bot brains on every seat, yours on the
// autopilot) drives the REAL engine (src/audio/index.ts) against content/audio.json as it is now. Only WebAudio is
// faked: sources end after their real file's length (read from the shipped .ogg), so the voice pool fills and frees
// as in a browser; every voice the engine starts is read back from its graph and attributed to its SimEvent. The
// camera is a player's: on your fighter while it lives, on the fight while it is dead (as probe_audio_listener).
//   M1  no control or debuff status is voiced by the buff cue; every status cue tried on a fighter is the one content
//       binds to that kind ('status.<kind>'); statuses on Wicks / monsters / structures try no cue
//   M2  every enemy fighter's ultimate cast the engine hears tries the shade-breath swell (events.enemyUltWindup)
//       placed at the CASTER's position; the ones played are panned by where the caster is (not centred)
//   M2b every enemy fighter's T3 wind-up the engine hears (a non-ult cast with castTime > 0 whose effects, read here
//       from the catalog independently of the engine, control someone else, displace, dash / blink or lay a zone:
//       tokens.vfx.tiers.T3) tries the same swell (events.enemyWindup) at the CASTER; no allied cast and no enemy
//       cast that is not T3+ tries it (the tell stays a tell)
//   M3  the priority lift is live: voices started with +1 (an enemy aiming at you) and −1 (an ally's own action)
// Part 2, the same engine on a stub match (your fighter, an enemy, a Wick), deterministic:
//   S1  every control kind (the sim's CC_<KIND> flags + slow) on YOU from an enemy plays its own bound cue at +3 dB
//       over the same status on an enemy fighter; a buff on you (haste) is not lifted
//   S2  grievous / armor_shred / resist_shred / reveal try no cue; a control status on a Wick tries no cue
//   S3  priority: a pool full of allied (−1) combat voices yields to an enemy hit on you; a pool full of hits on
//       you does not yield to an ally's swing
//   S4  an enemy ultimate cast 9 m to your right: the swell plays panned right at the caster
//   S5  an enemy T3 wind-up (a hard-CC ability with a castTime) 9 m to your left: the swell plays panned left at the
//       caster; the same cast by an ally, an enemy non-T3 cast and an enemy instant T3 cast try no swell
// --baseline <rev> runs part 1 on the engine as it was at <rev> too, for the before / after numbers.
// Exit 0 = all hold, 1 = a gate fails, 77 = no built catalog. Report → _harness/_reports/fw_W3_cc.json (or --out).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, fstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'fw_W3_cc.json'));
const BASELINE = arg('--baseline', null);
const MINUTES = Number(arg('--minutes', 9));
const SEED = Number(arg('--seed', 5));

// ── a fake WebAudio whose sources END (after their buffer's length, or a stop()) ─────────────────────────
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

const STATUS_KINDS = (() => {
  const m = /export const StatusKind = z\.enum\(\[([^\]]+)\]\)/.exec(readFileSync(join(ROOT, 'src', 'contracts', 'catalog.ts'), 'utf8'));
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
})();
const CONTROL = (() => {
  const src = readFileSync(join(ROOT, 'src', 'sim', 'entity.ts'), 'utf8');
  return [...new Set([...src.matchAll(/\bCC_([A-Z]+)\s*=\s*\d/g)].map((x) => x[1].toLowerCase()))].sort().concat(['slow']);
})();
const DEBUFF = ['grievous', 'armor_shred', 'resist_shred', 'reveal'].filter((k) => STATUS_KINDS.includes(k));
const BUFF_CUE = audio.events['status.haste'];
const SWELL = audio.events.enemyUltWindup;
const SWELL_T3 = audio.events.enemyWindup ?? SWELL;
// T3 wind-ups from the catalog, derived here on their own (tokens.vfx.tiers.T3 'crowd control, mobility, zones')
const T3_STATUS = new Set(CONTROL);
const t3 = (n) => Array.isArray(n) ? n.some(t3) : !!n && typeof n === 'object' && (
  ['displace', 'dash', 'blink', 'zone'].includes(n.op) || (n.op === 'status' && T3_STATUS.has(n.status) && n.to !== 'self')
  || Object.values(n).some((v) => v && typeof v === 'object' && t3(v)));
const ABILITIES = new Map();                 // ability id → { fighter, slot, castTime, t3 }
for (const f of catalog.fighters) {
  const abs = Object.entries(f.kit);
  for (const fm of Object.values(f.kit.passive?.forms ?? {})) abs.push(...Object.entries(fm.kit ?? {}));
  for (const [slot, a] of abs) if (a && slot !== 'passive') ABILITIES.set(a.id, { fighter: f.id, slot, castTime: a.castTime ?? 0, t3: slot !== 'ult' && (a.castTime ?? 0) > 0 && t3(a.effects) });
}
const T3_IDS = [...ABILITIES].filter(([, a]) => a.t3).map(([id]) => id).sort();

const { LocalMatchHost } = await import('../src/session/match_host.ts');
const { createBots } = await import('../src/sim/bots/index.ts');
const { createAudioEngine } = await import('../src/audio/index.ts');
let createBaseline = null;
if (BASELINE) {
  const dir = mkdtempSync(join(tmpdir(), 'vale_cc_base_'));
  const file = join(dir, 'index.ts');
  writeFileSync(file, execFileSync('git', ['show', `${BASELINE}:./src/audio/index.ts`], { cwd: ROOT, encoding: 'utf8' }));
  createBaseline = (await import(pathToFileURL(file).href)).createAudioEngine;
}
const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };
const failures = [];

/** an engine whose every cue try is recorded with what it started (gain / pan / priority read from its graph) */
function rig(name, create, client, audioDef, focus) {
  const eng = create({ catalog: { ...catalog, audio: audioDef }, assetUrl: (r) => r, settings: SETTINGS });
  if (focus && eng.listener) eng.listener(focus);
  eng.buffer = (file) => ({ then: (f) => { f({ duration: DUR[file] ?? 1, length: 48000, sampleRate: 48000 }); return { catch() {} }; } });
  const rows = [];
  let cur = null;
  const origOn = eng.onEvent, origCue = eng.cue;
  eng.onEvent = function (e) { cur = e; try { return origOn.call(this, e); } finally { cur = null; } };
  eng.cue = function (id, pos, gainMul = 1, ...rest) {
    const n0 = this.ctx ? this.ctx.started.length : 0;
    const v0 = this.voices ? this.voices.length : 0;
    const r = origCue.call(this, id, pos, gainMul, ...rest);
    if (!cur || !id) return r;
    const c = audioDef.cues[id];
    const started = this.ctx && this.ctx.started.length > n0 ? this.ctx.started[this.ctx.started.length - 1] : null;
    const row = { id, e: cur, pos: pos ? { ...pos } : null, gainMul, played: !!started };
    if (started && c) {
      let node = started;
      row.pan = 0; row.lpf = 0;
      while (node && node.kind !== 'gain') {
        if (node.kind === 'panner') row.pan = node.pan.value;
        if (node.kind === 'biquad') row.lpf = node.frequency.value;
        node = node.outs[0];
      }
      row.gain = node ? node.gain.value : NaN;
      const v = this.voices?.find((x) => x.src === started);
      if (v) row.lift = v.priority - c.priority;
      row.voicesBefore = v0;
    }
    rows.push(row);
    return r;
  };
  if (client) eng.attach(client);
  return { name, eng, rows };
}

// ── part 1: a real match ─────────────────────────────────────────────────────────────────────────────────
const mode = catalog.modes.find((m) => m.id === 'rift');
const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id);
const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
const YOU = 6;
const seats = [];
for (let i = 0; i < mode.teams * mode.perTeam; i++) {
  const fighter = catalog.fighters[(i * 5 + 2) % catalog.fighters.length].id;
  seats.push({
    player: i, team: Math.floor(i / mode.perTeam), name: catalog.botNames[i % catalog.botNames.length], fighter,
    skin: catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '',
    role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
    loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
    controller: i === YOU ? 'human' : 'bot', botDifficulty: 'adept', colorIndex: i,
  });
}
const setup = { matchId: 'probe-audio-cc', seed: SEED, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
const host = new LocalMatchHost(catalog, setup, YOU, { bots: createBots(catalog, setup), pregameSeconds: 0, autopilot: true });
const view = host.view;
const myTeam = seats[YOU].team;
const youEnt = () => view.entity(view.players.find((p) => p.player === YOU).entity);
const fights = [];
let focus = null;
const now = rig('now', createAudioEngine, host, audio, () => focus);
const base = createBaseline ? rig(`baseline@${BASELINE}`, createBaseline, host, AudioDef.parse(strip(JSON.parse(execFileSync('git', ['show', `${BASELINE}:./content/audio.json`], { cwd: ROOT, encoding: 'utf8' })))), null) : null;
const rigs = [now, base].filter(Boolean);
// what each event was about, at the moment the engines heard it (the engines listen first)
const info = new Map();
host.onEvents((evs) => {
  for (const e of evs) {
    const s = view.entity(e.src), d = view.entity(e.dst);
    info.set(e, { srcKind: s?.kind, srcTeam: s?.team, srcPos: s ? { x: s.x, y: s.y } : null, dstKind: d?.kind, dstTeam: d?.team });
    if (e.e === 'damage' && s?.kind === 'fighter' && d?.kind === 'fighter') fights.push({ t: e.t, x: d.x, y: d.y });
  }
});
host.start();
for (let i = 0, n = Math.round(MINUTES * 60 * 30); i < n && !host.ended; i++) {
  const y = youEnt();
  while (fights.length && fights[0].t < view.time - 1.5) fights.shift();
  if (y?.alive) focus = { x: y.x, y: y.y };
  else if (fights.length) focus = { x: fights.reduce((a, f) => a + f.x, 0) / fights.length, y: fights.reduce((a, f) => a + f.y, 0) / fights.length };
  host.pump(1 / 30);
  for (const r of rigs) r.eng.ctx?.advance(1 / 30);
}

function matchSummary(r) {
  const st = r.rows.filter((x) => x.e.e === 'status');
  const byKind = {};
  for (const x of st) {
    const k = x.e.status, i = info.get(x.e);
    const b = (byKind[k] ??= { onFighters: 0, onOthers: 0, cues: {} });
    if (i?.dstKind === 'fighter') b.onFighters++; else b.onOthers++;
    b.cues[x.id] = (b.cues[x.id] ?? 0) + 1;
  }
  const evs = [...info.entries()].filter(([e]) => e.e === 'status');
  const statusEvents = {};
  for (const [e, i] of evs) { const b = (statusEvents[e.status] ??= { fighters: 0, others: 0 }); if (i.dstKind === 'fighter') b.fighters++; else b.others++; }
  const buffForHarm = st.filter((x) => x.id === BUFF_CUE && (CONTROL.includes(x.e.status) || DEBUFF.includes(x.e.status))).length;
  const wrongCue = st.filter((x) => info.get(x.e)?.dstKind === 'fighter' && audio.events[`status.${x.e.status}`] !== x.id).length;
  const nonFighter = st.filter((x) => info.get(x.e)?.dstKind !== 'fighter').length;
  const ults = [...info.entries()].filter(([e, i]) => e.e === 'cast' && e.slot === 'ult' && i.srcKind === 'fighter' && i.srcTeam !== myTeam);
  const heardUlts = new Set(r.rows.filter((x) => x.e.e === 'cast' && x.e.slot === 'ult').map((x) => x.e));
  const swell = r.rows.filter((x) => x.e.e === 'cast' && x.e.slot === 'ult' && x.id === SWELL);
  const atCaster = swell.filter((x) => { const p = info.get(x.e)?.srcPos; return x.pos && p && Math.abs(x.pos.x - p.x) < 1e-6 && Math.abs(x.pos.y - p.y) < 1e-6; });
  const played = swell.filter((x) => x.played);
  const lifts = {};
  for (const x of r.rows) if (x.played && x.lift !== undefined) lifts[x.lift] = (lifts[x.lift] ?? 0) + 1;
  // M2b: enemy T3 wind-ups (non-ult)
  const heardCasts = new Set(r.rows.filter((x) => x.e.e === 'cast').map((x) => x.e));
  const castsBy = (pred) => [...info.entries()].filter(([e, i]) => e.e === 'cast' && e.slot !== 'ult' && i.srcKind === 'fighter' && pred(e, i) && heardCasts.has(e));
  const t3Enemy = castsBy((e, i) => i.srcTeam !== myTeam && ABILITIES.get(e.ability)?.t3 && (e.castTime ?? 0) > 0);
  const swellOf = (e) => r.rows.filter((x) => x.e === e && x.id === SWELL_T3);
  const t3Swell = t3Enemy.map(([e, i]) => ({ e, i, s: swellOf(e) }));
  const t3AtCaster = t3Swell.filter(({ i, s }) => s.some((x) => x.pos && i.srcPos && Math.abs(x.pos.x - i.srcPos.x) < 1e-6 && Math.abs(x.pos.y - i.srcPos.y) < 1e-6));
  const t3Played = t3Swell.flatMap(({ s }) => s.filter((x) => x.played));
  const notT3Enemy = castsBy((e, i) => i.srcTeam !== myTeam && !ABILITIES.get(e.ability)?.t3);
  const allied = castsBy((e, i) => i.srcTeam === myTeam);
  const abilitiesHeard = {};
  for (const { e, s } of t3Swell) { const k = e.ability; const b = (abilitiesHeard[k] ??= { heard: 0, swell: 0 }); b.heard++; if (s.length) b.swell++; }
  return {
    statusEvents, statusCues: byKind, buffForHarm, wrongCue, nonFighterStatusCues: nonFighter,
    enemyUlts: { casts: ults.length, heard: ults.filter(([e]) => heardUlts.has(e)).length, swellTried: swell.length, swellAtCaster: atCaster.length, swellCentred: swell.filter((x) => !x.pos).length,
      swellPlayed: played.length, swellPans: played.map((x) => +(x.pan ?? 0).toFixed(2)), swellPanned: played.filter((x) => Math.abs(x.pan ?? 0) > 0.01).length },
    voicesByLift: lifts,
    enemyT3: { heard: t3Enemy.length, swellAtCaster: t3AtCaster.length, swellCentred: t3Swell.filter(({ s }) => s.some((x) => !x.pos)).length,
      swellPlayed: t3Played.length, swellPanned: t3Played.filter((x) => Math.abs(x.pan ?? 0) > 0.01).length,
      abilities: abilitiesHeard, abilitiesHeardN: Object.keys(abilitiesHeard).length,
      notT3EnemyHeard: notT3Enemy.length, notT3EnemySwell: notT3Enemy.filter(([e]) => swellOf(e).length).length,
      alliedHeard: allied.length, alliedSwell: allied.filter(([e]) => swellOf(e).length).length },
  };
}
const M = { now: matchSummary(now), ...(base ? { baseline: matchSummary(base) } : {}) };
const mn = M.now;
if (mn.buffForHarm) failures.push(`M1: ${mn.buffForHarm} control/debuff status cue(s) voiced by the buff cue ${BUFF_CUE}`);
if (mn.wrongCue) failures.push(`M1: ${mn.wrongCue} status cue(s) on fighters were not the kind's bound cue`);
if (mn.nonFighterStatusCues) failures.push(`M1: ${mn.nonFighterStatusCues} status cue(s) tried on non-fighters`);
if (!Object.values(mn.statusEvents).some((b) => b.fighters)) failures.push('M1: no status landed on a fighter: vacuous — run longer');
if (!mn.enemyUlts.heard) failures.push('M2: no enemy ultimate cast was heard: vacuous — run longer');
else {
  if (mn.enemyUlts.swellAtCaster !== mn.enemyUlts.heard) failures.push(`M2: ${mn.enemyUlts.heard} enemy ult casts heard, but ${mn.enemyUlts.swellAtCaster} swells tried at the caster`);
  if (mn.enemyUlts.swellCentred) failures.push(`M2: ${mn.enemyUlts.swellCentred} swell(s) tried with no position (centre-panned)`);
}
if (!(mn.voicesByLift['1'] > 0) || !(mn.voicesByLift['-1'] > 0)) failures.push(`M3: the priority lift is not live (voices by lift ${JSON.stringify(mn.voicesByLift)})`);
const t3m = mn.enemyT3;
if (!SWELL_T3) failures.push('M2b: no events.enemyWindup / enemyUltWindup bound');
if (!t3m.heard) failures.push('M2b: no enemy T3 wind-up was heard: vacuous — run longer');
else {
  if (t3m.swellAtCaster !== t3m.heard) failures.push(`M2b: ${t3m.heard} enemy T3 wind-ups heard, but ${t3m.swellAtCaster} swells tried at the caster`);
  if (t3m.swellCentred) failures.push(`M2b: ${t3m.swellCentred} T3 swell(s) tried with no position (centre-panned)`);
}
if (t3m.notT3EnemySwell) failures.push(`M2b: ${t3m.notT3EnemySwell} enemy cast(s) that are not T3+ tried the swell`);
if (t3m.alliedSwell) failures.push(`M2b: ${t3m.alliedSwell} allied cast(s) tried the swell`);

// ── part 2: a stub match, deterministic ──────────────────────────────────────────────────────────────────
const E = {};
const ent = (id, kind, team, x, y, statuses = []) => (E[id] = { id, kind, team, x, y, alive: true, visibleMask: 3, statuses, def: kind === 'fighter' ? catalog.fighters[0].id : 'shieldwick' });
ent(1, 'fighter', 1, 100, 100);           // you
ent(2, 'fighter', 0, 103, 100);           // an enemy
ent(3, 'minion', 0, 101, 101);            // an enemy Wick
ent(4, 'fighter', 1, 98, 100);            // an ally
ent(5, 'fighter', 0, 109, 100);           // an enemy 9 m to your right
const stub = {
  you: 0, view: { time: 60, players: [{ player: 0, team: 1, entity: 1 }, { player: 1, team: 0, entity: 2 }], entity: (id) => E[id] },
  onEvents: () => () => {},
};
const S = rig('stub', createAudioEngine, stub, audio, () => ({ x: 100, y: 100 }));
const se = S.eng;
let t = 0;
const fire = (e, wait = 1) => { se.ctx?.advance(wait); t += 1; se.onEvent({ t, ...e }); return S.rows.filter((r) => r.e.t === t); };
const S1 = {};
for (const k of CONTROL) {
  E[1].statuses = [{ kind: k, src: 2 }]; E[2].statuses = [{ kind: k, src: 1 }];
  const onYou = fire({ e: 'status', dst: 1, status: k, duration: 1 });
  const onEnemy = fire({ e: 'status', dst: 2, status: k, duration: 1 });
  const bound = audio.events[`status.${k}`];
  const a = onYou[0], b = onEnemy[0];
  const liftDb = a?.played && b?.played ? 20 * Math.log10(a.gain / b.gain) : null;
  S1[k] = { bound, onYou: a?.id ?? null, onEnemy: b?.id ?? null, youOverEnemyDb: liftDb === null ? null : +liftDb.toFixed(2), priorityLiftOnYou: a?.lift ?? null };
  if (!bound || bound === BUFF_CUE) failures.push(`S1: control ${k} is bound to ${bound}`);
  if (a?.id !== bound || b?.id !== bound) failures.push(`S1: ${k} played ${a?.id} on you / ${b?.id} on an enemy (bound ${bound})`);
  // the enemy fighter sits 3 m away: inside the 12 m inner radius, so placement is 0 dB for both
  else if (liftDb === null || Math.abs(liftDb - 3) > 0.1) failures.push(`S1: ${k} on you is ${liftDb} dB over the same on an enemy (expected +3)`);
}
E[1].statuses = [{ kind: 'haste', src: 4 }]; E[2].statuses = [{ kind: 'haste', src: 2 }];
const hy = fire({ e: 'status', dst: 1, status: 'haste', duration: 1 })[0], he = fire({ e: 'status', dst: 2, status: 'haste', duration: 1 })[0];
S1.haste = { onYou: hy?.id ?? null, youOverEnemyDb: hy?.played && he?.played ? +(20 * Math.log10(hy.gain / he.gain)).toFixed(2) : null };
if (S1.haste.youOverEnemyDb !== 0) failures.push(`S1: an allied haste on you is lifted ${S1.haste.youOverEnemyDb} dB (a buff is not a threat)`);
const S2 = {};
for (const k of DEBUFF) { E[1].statuses = [{ kind: k, src: 2 }]; S2[k] = fire({ e: 'status', dst: 1, status: k, duration: 1 }).map((r) => r.id); if (S2[k].length) failures.push(`S2: ${k} tried ${S2[k]}`); }
E[3].statuses = [{ kind: 'stun', src: 1 }];
S2.stunOnWick = fire({ e: 'status', dst: 3, status: 'stun', duration: 1 }).map((r) => r.id);
if (S2.stunOnWick.length) failures.push(`S2: a stun on a Wick tried ${S2.stunOnWick}`);

// S3: the pool. Allied swings (6 - 1 = 5) fill it; an enemy hit on you (6 + 1 = 7) must get a voice
se.ctx.advance(10);
const pool = () => se.voices.filter((v) => v.bus === 'sfx').length;
const prioOf = (id) => audio.cues[id].priority;
// spread over distinct cues so no cue's own maxVoices stops the fill: allied (-1) actions on cues of every kind
const allyCues = Object.entries(audio.cues).filter(([, c]) => c.bus === 'sfx' && c.spatial && !c.loop).map(([id]) => id);
for (const id of allyCues) for (let i = 0; i < audio.cues[id].maxVoices && pool() < 40; i++) { se.lastPlay.clear(); se.cue(id, { x: 98, y: 100 }, 1, 0, { lift: -1 }); }
const fullAlly = pool();
const minAlly = Math.min(...se.voices.filter((v) => v.bus === 'sfx').map((v) => v.priority));
se.lastPlay.clear();
const r1 = fire({ e: 'damage', src: 2, dst: 1, amount: 10, dtype: 'phys', crit: false }, 0)[0];
const S3 = { poolFullOfAllies: fullAlly, lowestAllyPriority: minAlly, enemyHitOnYou: { cue: r1?.id, priority: r1 ? prioOf(r1.id) + 1 : null, played: !!r1?.played } };
if (!r1?.played) failures.push(`S3: with the pool full of allied voices (lowest priority ${minAlly}) an enemy hit on you was dropped`);
// now fill the pool with hits on you (+1), then an ally's swing (-1) must be the one dropped
for (const v of [...se.voices]) se.stopVoice(v, 0.01);
se.voices.length = 0;
// threats: combat cues of priority >= 6, lifted to >= 7 (hits and casts aimed at you)
for (const id of allyCues.filter((x) => prioOf(x) >= 6)) for (let i = 0; i < audio.cues[id].maxVoices && pool() < 40; i++) { se.lastPlay.clear(); se.cue(id, { x: 100, y: 100 }, 1, 0, { lift: 1 }); }
const minThreat = Math.min(...se.voices.filter((v) => v.bus === 'sfx').map((v) => v.priority));
se.lastPlay.clear();
const r2 = fire({ e: 'attack', src: 4, dst: 3, windup: 0.2, crit: false }, 0)[0];
S3.poolFullOfThreats = pool();
S3.lowestThreatPriority = minThreat;
S3.allySwing = { cue: r2?.id ?? null, priority: r2 ? prioOf(r2.id) - 1 : null, played: !!r2?.played };
if (!r2) failures.push('S3: the ally swing tried no cue (the check is vacuous)');
if (r2?.played) failures.push('S3: with the pool full of threats to you an ally\'s swing still took a voice');
for (const v of [...se.voices]) se.stopVoice(v, 0.01);
se.voices.length = 0;
// S4: an enemy ult cast 9 m to your right
se.ctx.advance(5);
const r4 = fire({ e: 'cast', src: 5, slot: 'ult', ability: 'x', x: 109, y: 100, castTime: 0.3 }).find((r) => r.id === SWELL);
const S4 = { cue: r4?.id ?? null, at: r4?.pos ?? null, played: !!r4?.played, pan: r4?.pan ?? null, gain: r4?.gain ?? null };
if (!r4?.played || !(r4.pan > 0.3) || r4.pos?.x !== 109) failures.push(`S4: the enemy ult swell 9 m right played ${JSON.stringify(S4)}`);
// S5: an enemy T3 wind-up 9 m to your left (a hard-CC ability with a castTime, from the catalog)
const HARD = new Set(['stun', 'root', 'sleep', 'fear', 'silence', 'taunt', 'airborne', 'disarm']);
const hardT3 = T3_IDS.find((id) => { const a = ABILITIES.get(id); const f = catalog.fighters.find((x) => x.id === a.fighter);
  return JSON.stringify(f.kit[a.slot]?.effects ?? []).match(/"status":"([a-z]+)"/g)?.some((m) => HARD.has(m.slice(10, -1))); });
const plain = [...ABILITIES].find(([, a]) => !a.t3 && a.slot !== 'ult' && a.castTime > 0)?.[0];
ent(6, 'fighter', 0, 91, 100);           // an enemy 9 m to your left
const swellIn = (rows) => rows.find((r) => r.id === SWELL_T3);
se.ctx.advance(5);
const r5 = swellIn(fire({ e: 'cast', src: 6, slot: ABILITIES.get(hardT3)?.slot ?? 'a1', ability: hardT3, x: 95, y: 100, castTime: ABILITIES.get(hardT3)?.castTime ?? 0.25 }));
const r5ally = swellIn(fire({ e: 'cast', src: 4, slot: ABILITIES.get(hardT3)?.slot ?? 'a1', ability: hardT3, x: 100, y: 100, castTime: ABILITIES.get(hardT3)?.castTime ?? 0.25 }));
const r5plain = plain ? swellIn(fire({ e: 'cast', src: 6, slot: ABILITIES.get(plain).slot, ability: plain, x: 95, y: 100, castTime: ABILITIES.get(plain).castTime })) : null;
const r5inst = swellIn(fire({ e: 'cast', src: 6, slot: ABILITIES.get(hardT3)?.slot ?? 'a1', ability: hardT3, x: 95, y: 100, castTime: 0 }));
const S5 = { ability: hardT3 ?? null, cue: r5?.id ?? null, at: r5?.pos ?? null, played: !!r5?.played, pan: r5?.pan ?? null,
  allyTried: r5ally?.id ?? null, plainAbility: plain ?? null, plainTried: r5plain?.id ?? null, instantTried: r5inst?.id ?? null, t3Abilities: T3_IDS.length };
if (!hardT3) failures.push('S5: no hard-CC T3 ability with a castTime in the catalog (vacuous)');
else if (!r5?.played || !(r5.pan < -0.3) || r5.pos?.x !== 91) failures.push(`S5: the enemy T3 wind-up swell 9 m left played ${JSON.stringify(S5)}`);
if (r5ally || r5plain || r5inst) failures.push(`S5: a swell for an ally's / a non-T3 / an instant cast: ${JSON.stringify(S5)}`);

const report = {
  probe: 'probe_audio_cc', catalog: ver, seed: SEED, minutes: MINUTES, simSeconds: +view.time.toFixed(1), you: YOU, fighter: seats[YOU].fighter,
  controlKinds: CONTROL, debuffKinds: DEBUFF, buffCue: BUFF_CUE, swellCue: SWELL,
  t3Abilities: T3_IDS, match: M, stub: { S1, S2, S3, S4, S5 }, failures, pass: failures.length === 0,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
const line = (name, m) => {
  console.log(`[${name}] status events on fighters: ${Object.entries(m.statusEvents).map(([k, b]) => `${k} ${b.fighters}`).join(', ')}`);
  console.log(`[${name}]   cues: ${Object.entries(m.statusCues).map(([k, b]) => `${k}→${Object.entries(b.cues).map(([c, n]) => `${c}×${n}`).join('+')}`).join('  ')}`);
  console.log(`[${name}]   buff cue for harm ${m.buffForHarm} · wrong cue ${m.wrongCue} · on non-fighters ${m.nonFighterStatusCues}`);
  console.log(`[${name}] enemy ults: ${m.enemyUlts.casts} cast, ${m.enemyUlts.heard} heard → swell tried ${m.enemyUlts.swellTried} (at caster ${m.enemyUlts.swellAtCaster}, centred ${m.enemyUlts.swellCentred}), played ${m.enemyUlts.swellPlayed}, panned ${m.enemyUlts.swellPanned}`);
  console.log(`[${name}] voices by priority lift: ${JSON.stringify(m.voicesByLift)}`);
  if (m.enemyT3) console.log(`[${name}] enemy T3 wind-ups: ${m.enemyT3.heard} heard (${m.enemyT3.abilitiesHeardN} abilities) → swell at caster ${m.enemyT3.swellAtCaster}, centred ${m.enemyT3.swellCentred}, played ${m.enemyT3.swellPlayed}, panned ${m.enemyT3.swellPanned}; not-T3 enemy casts ${m.enemyT3.notT3EnemyHeard} → swell ${m.enemyT3.notT3EnemySwell}; allied casts ${m.enemyT3.alliedHeard} → swell ${m.enemyT3.alliedSwell}`);
};
console.log(`sim ${report.simSeconds} s, you ${seats[YOU].fighter}`);
line('now', M.now);
if (M.baseline) line('baseline', M.baseline);
console.log(`S1 control on you vs on an enemy: ${Object.entries(S1).map(([k, v]) => `${k} ${v.onYou ?? '-'} ${v.youOverEnemyDb ?? '-'}dB`).join(' · ')}`);
console.log(`S2 silent: ${Object.entries(S2).map(([k, v]) => `${k} ${v.length ? v.join(',') : 'none'}`).join(' · ')}`);
console.log(`S3 pool: ${JSON.stringify(S3)}`);
console.log(`S4 enemy ult 9 m right: ${JSON.stringify(S4)}`);
console.log(`S5 enemy T3 wind-up 9 m left: ${JSON.stringify(S5)}`);
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: control reads by ear, the enemy wind-up swell sits at the caster, threats outrank allies');
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
