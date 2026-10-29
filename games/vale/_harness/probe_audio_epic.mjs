// VALE harness — the epic objectives sound like themselves (closing AUD-C3) and decoded audio does not pile up across a
// session (closing PERF-C2, the audio half). The REAL engine (src/audio/index.ts) against content/audio.json as it is
// now and the built catalog's units (dist-catalog/); only WebAudio, fetch and the match are faked.
//
//   node _harness/probe_audio_epic.mjs [--out _harness/_reports/fw_CW2_epic.json]
//
// Part E (a stub match: your fighter, Longshade, Sunsplinter, a camp monster), every epic event built from content:
//   E1  autos: an epic unit's attack → u_<unit>_attack_swing at a fighter's multiplier (0.6), its basic attack's damage
//       → u_<unit>_attack_hit at 0.8; its ranged auto's projectile requests nothing generic
//   E2  casts: each of its abilities' cast → u_<unit>_a<n>, else u_<unit>_cast; never events.castMonster
//   E3  areas: each ability's area (its content present.sfx / vfx on the event) → u_<unit>_a<n>_land at the area,
//       held for the area's delay + life; never the library present.sfx
//   E4  ability hits: no library cue (u_<unit>_hit when content has one)
//   E5  death: an epic unit → u_<unit>_death; a camp monster → events.monsterDeath, which is not its hit cue
//   E6  roar: struck from rest → u_<unit>_roar once; struck again 2 s later → none; after ROAR_CALM_S again → roar;
//       its objective coming alive (WorldView.objectives) → roar at the pit
//   E7  presence: a living objective has a pit emitter (objective.<unit>, its u_<unit>_presence, playing); it fades
//       out when the objective falls
//   E8  a camp monster keeps the old path: its own attack present.sfx at the monster multiplier (0.3)
// Part M (memory): the engine's own buffer cache with real decoded sizes (each file's length x channels x 4 bytes, read
// from its Ogg header) through a session Home → draft → match (every sfx / voice / ambience cue the match's fighters
// and map can play) → postgame → Home, on RIFT, BRIDGE and FRAY in turn:
//   M1  decoded audio at Home after each map <= 150 MB
//   M2  a bed change frees the previous bed's files (none of them left in the cache after the change)
//   M3  a match change frees the match's cues (only UI cues and the playing bed's files left after attach(null))
// Exit 0 = PASS, 1 = a gate fails, 77 = no built catalog.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'fw_CW2_epic.json');
const HOME_MB = 150;

// ── a minimal fake WebAudio + DOM ─────────────────────────────────────────────────────────────────────
class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } }
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; this.gain = new Param(1); }
  connect(d) { this.outs.push(d); return d; }
  disconnect() { this.outs = []; }
}
const FILE_OF = new WeakMap();                     // fetched bytes → the file they are
const DUR = {}, CH = {};
class FakeCtx {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = new Node(this, 'destination'); this.live = []; }
  createGain() { return new Node(this, 'gain'); }
  createStereoPanner() { const n = new Node(this, 'panner'); n.pan = new Param(0); return n; }
  createBiquadFilter() { const n = new Node(this, 'biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createWaveShaper() { return new Node(this, 'shaper'); }
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
  decodeAudioData(b) {
    const f = FILE_OF.get(b);
    const d = DUR[f] ?? 1;
    return Promise.resolve({ duration: d, length: Math.round(d * 48000), numberOfChannels: CH[f] ?? 2, sampleRate: 48000 });
  }
  resume() { return Promise.resolve(); }
}
globalThis.AudioContext = FakeCtx;
globalThis.window = globalThis;
globalThis.setInterval = ((orig) => (fn, ms) => (ms === 250 ? 0 : orig(fn, ms)))(globalThis.setInterval);
globalThis.addEventListener = () => {};
globalThis.document = { hidden: false, addEventListener() {}, createElement: () => ({ canPlayType: () => 'probably' }) };
globalThis.location = { search: '' };
globalThis.fetch = async (url) => { const b = new ArrayBuffer(8); FILE_OF.set(b, url); return { ok: true, arrayBuffer: async () => b }; };

// ── the catalog ───────────────────────────────────────────────────────────────────────────────────────
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
const ev = audio.events;
// every file's real length and channel count (Ogg Opus header + last granule)
function oggInfo(path) {
  try {
    const fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(size, 512)); readSync(fd, head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(size, 65536)); readSync(fd, tail, 0, tail.length, size - tail.length);
    closeSync(fd);
    const h = head.indexOf('OpusHead');
    const pre = head.readUInt16LE(h + 10);
    const last = tail.lastIndexOf('OggS');
    return { d: Number(tail.readBigUInt64LE(last + 6) - BigInt(pre)) / 48000, ch: head[h + 9] };
  } catch { return { d: 1, ch: 2 }; }
}
const allFiles = [...Object.values(audio.cues).flatMap((c) => c.files), ...Object.values(audio.music).flatMap((m) => [m.file, ...m.layers.map((l) => l.file)])];
for (const f of allFiles) { const i = oggInfo(join(ROOT, 'audio', 'out', f.replace(/^assets\/audio\//, ''))); DUR[f] = i.d; CH[f] = i.ch; }

const { createAudioEngine } = await import('../src/audio/index.ts');
const SETTINGS = { audio: { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9, ui: 0.7, ambience: 0.6, muteInBackground: true } };
const failures = [];
const report = { probe: 'probe_audio_epic', catalog: ver, E: {}, M: {} };
const flush = () => new Promise((r) => setTimeout(r, 0));

function spy(eng) {
  const log = [];
  const cue0 = eng.cue;
  eng.cue = function (id, pos, gain = 1, hold = 0, ...rest) { const r = cue0.call(this, id, pos, gain, hold, ...rest); log.push({ id, pos, gain, hold, r }); return r; };
  return log;
}

// ── Part E ────────────────────────────────────────────────────────────────────────────────────────────
const objUnits = new Set();
for (const m of catalog.maps ?? []) for (const c of m.camps ?? []) if (c.objective) for (const u of c.units) objUnits.add(u.unit);
const epic = catalog.units.filter((u) => objUnits.has(u.id));
const camp = catalog.units.find((u) => u.kind === 'monster' && !objUnits.has(u.id) && u.attack?.present?.sfx);
report.E.epic = epic.map((u) => u.id); report.E.camp = camp?.id;
if (!epic.length) failures.push('E: no objective unit in the catalog (vacuous)');
{
  const E = {};
  const ent = (id, kind, team, x, y, def) => (E[id] = { id, kind, team, x, y, alive: true, visibleMask: 7, statuses: [], def });
  ent(1, 'fighter', 0, 100, 100, catalog.fighters[0].id);
  epic.forEach((u, i) => ent(20 + i, 'monster', 2, 102 + i, 101, u.id));
  if (camp) ent(30, 'monster', 2, 99, 102, camp.id);
  const players = [{ player: 0, team: 0, entity: 1, respawnIn: 0, abilities: [] }];
  const objectives = epic.map((u, i) => ({ id: `obj_${u.id}`, unit: u.id, at: [104 + i, 100], alive: false, respawnIn: 30 }));
  let cb = null;
  const view = { time: 600, mode: 'stub', map: 'none', gorgeWind: 0, players, objectives, entities: Object.values(E), entity: (id) => E[id] };
  const stub = { you: 0, setup: { map: 'none', mode: 'stub' }, view, onEvents: (f) => { cb = f; return () => { cb = null; }; } };
  const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  eng.ensure();
  eng.listener(() => ({ x: 100, y: 100 }));
  eng.attach(stub);
  const log = spy(eng);
  const step = (dt = 0.25) => { view.time += dt; eng.ctx.advance(dt); eng.update(dt); };
  const batch = (evs) => { view.time += 1 / 30; const k = log.length; cb(evs.map((e) => ({ t: view.time, ...e }))); return log.slice(k); };
  const lib = (rows, uid) => rows.filter((c) => c.id && !c.id.startsWith(`u_${uid}_`));   // (a request with no cue id is silence)
  for (const [i, u] of epic.entries()) {
    const id = 20 + i, uid = u.id, kit = (s) => audio.cues[`u_${uid}_${s}`] ? `u_${uid}_${s}` : undefined;
    const r = report.E[uid] = {};
    // E6 first (the unit is fresh): struck from rest, again 2 s later, again after the calm
    const hitIt = () => batch([{ e: 'damage', src: 1, dst: id, amount: 50, dtype: 'phys', crit: false, shielded: 0 }]);
    const roar0 = hitIt().filter((c) => c.id === kit('roar')).length;
    for (let k = 0; k < 8; k++) step(0.25);
    const roar1 = hitIt().filter((c) => c.id === kit('roar')).length;
    for (let k = 0; k < 48; k++) step(0.25);
    const roar2 = hitIt().filter((c) => c.id === kit('roar')).length;
    r.E6 = { fromRest: roar0, after2s: roar1, afterCalm: roar2 };
    if (roar0 !== 1 || roar1 !== 0 || roar2 !== 1) failures.push(`E6 ${uid}: roars from rest / 2 s later / after the calm = ${roar0}/${roar1}/${roar2} (want 1/0/1)`);
    // E1
    const sw = batch([{ e: 'attack', src: id, dst: 1, windup: 0.4, crit: false }]);
    const ht = batch([{ e: 'damage', src: id, dst: 1, amount: 90, dtype: u.attack?.damageType ?? 'phys', crit: false, shielded: 0 }]);
    const pj = batch([{ e: 'projectile', id: 99, src: id, ability: 'attack' }]);
    r.E1 = { swing: sw.map((c) => `${c.id}@${c.gain}`), hit: ht.map((c) => `${c.id}@${c.gain}`), projectile: pj.map((c) => c.id) };
    if (!(sw.length === 1 && sw[0].id === kit('attack_swing') && sw[0].gain === 0.6)) failures.push(`E1 ${uid}: attack → ${r.E1.swing.join(',') || 'nothing'} (want ${kit('attack_swing')}@0.6)`);
    if (!(ht.length === 1 && ht[0].id === kit('attack_hit') && Math.abs(ht[0].gain - 0.8) < 1e-9)) failures.push(`E1 ${uid}: auto damage → ${r.E1.hit.join(',') || 'nothing'} (want ${kit('attack_hit')}@0.8)`);
    if (pj.length) failures.push(`E1 ${uid}: its auto's projectile requested ${r.E1.projectile.join(',')}`);
    // E2-E4 per ability
    r.abilities = {};
    (u.abilities ?? []).forEach((ab, n) => {
      const slot = `a${n + 1}`;
      const cast = batch([{ e: 'cast', src: id, slot, ability: ab.id, x: 101, y: 101, castTime: ab.castTime ?? 0 }]);
      const eff = (ab.effects ?? []).find((x) => x.op === 'area' || x.op === 'zone');
      const area = eff ? batch([{ e: 'area', src: id, ability: ab.id, x: 101.5, y: 101.5, shape: eff.shape, delay: eff.delay ?? 0, vfx: eff.present?.vfx, sfx: eff.present?.sfx,
        telegraph: 'everyone', ...(eff.op === 'zone' ? { life: eff.duration } : {}) }]) : [];
      const hit = batch([{ e: 'hit', src: id, dst: 1, ability: ab.id }]);
      const want = kit(`${slot}_land`);
      r.abilities[ab.id] = { cast: cast.map((c) => c.id), area: area.map((c) => `${c.id} hold ${c.hold}`), hit: hit.map((c) => c.id), present: eff?.present?.sfx };
      if (!cast.length || cast[0].id !== (kit(slot) ?? kit('cast')) || lib(cast, uid).length) failures.push(`E2 ${uid} ${ab.id}: cast → ${r.abilities[ab.id].cast.join(',') || 'nothing'}`);
      if (eff) {
        const hold = (eff.delay ?? 0) + (eff.op === 'zone' ? eff.duration ?? 0 : 0);
        if (!(area.length === 1 && area[0].id === want && area[0].pos?.x === 101.5 && Math.abs(area[0].hold - hold) < 1e-9))
          failures.push(`E3 ${uid} ${ab.id}: area → ${r.abilities[ab.id].area.join(',') || 'nothing'} (want ${want} hold ${hold})`);
      }
      if (lib(hit, uid).length) failures.push(`E4 ${uid} ${ab.id}: ability hit requested ${lib(hit, uid).map((c) => c.id).join(',')}`);
    });
    // E7 / E6 (spawn): the objective comes alive → roar at the pit, a pit emitter; it falls → the emitter goes
    const o = objectives[i];
    let k0 = log.length;
    o.alive = true; o.respawnIn = 0;
    step(); await flush(); await flush(); step();
    const spawnRoar = log.slice(k0).filter((c) => c.id === kit('roar'));
    const pit = eng.pitEmitters.find((p) => p.role === `objective.${uid}`);
    r.E7 = { spawnRoar: spawnRoar.map((c) => c.pos), pit: pit ?? null };
    if (spawnRoar.length !== 1 || spawnRoar[0].pos?.x !== o.at[0]) failures.push(`E6 ${uid}: coming alive roared ${spawnRoar.length}x (want 1 at the pit)`);
    if (!pit || pit.cue !== kit('presence') || !pit.playing) failures.push(`E7 ${uid}: no playing pit emitter while it lives (${JSON.stringify(pit)})`);
    // E5: its death
    k0 = log.length;
    const dead = batch([{ e: 'death', dst: id, killer: 1, by: 0, assists: [], gold: 100, kind: 'monster' }]);
    o.alive = false; o.respawnIn = 300;
    step(); step();
    r.E5 = { death: dead.map((c) => c.id), pitAfter: eng.pitEmitters.filter((p) => p.role === `objective.${uid}`).length };
    if (!(dead.length === 1 && dead[0].id === kit('death'))) failures.push(`E5 ${uid}: death → ${r.E5.death.join(',') || 'nothing'} (want ${kit('death')})`);
    if (r.E5.pitAfter) failures.push(`E7 ${uid}: the pit emitter outlived the objective`);
  }
  // E8 / E5: a camp monster keeps the old path; its death is the fall, not its hit
  if (camp) {
    const sw = batch([{ e: 'attack', src: 30, dst: 1, windup: 0.4, crit: false }]);
    const de = batch([{ e: 'death', dst: 30, killer: 1, by: 0, assists: [], gold: 50, kind: 'monster' }]);
    report.E.camp8 = { swing: sw.map((c) => `${c.id}@${c.gain}`), death: de.map((c) => c.id) };
    if (!(sw.length === 1 && sw[0].id === camp.attack.present.sfx && sw[0].gain === 0.3)) failures.push(`E8 ${camp.id}: attack → ${report.E.camp8.swing.join(',')}`);
    if (!(de.length === 1 && de[0].id === ev.monsterDeath && de[0].id !== camp.attack.present.hitSfx)) failures.push(`E5 ${camp.id}: death → ${report.E.camp8.death.join(',')} (want ${ev.monsterDeath}, not its hit)`);
  }
  eng.attach(null);
}

// ── Part M ────────────────────────────────────────────────────────────────────────────────────────────
{
  const eng = createAudioEngine({ catalog: { ...catalog, audio }, assetUrl: (r) => r, settings: SETTINGS });
  eng.ensure();
  const MB = (b) => +(b / 1048576).toFixed(1);
  const settle = async () => { for (let i = 0; i < 6; i++) { await flush(); eng.ctx.advance(0.5); } };
  const cached = () => [...eng.buffers.keys()];
  const bedFiles = (id) => { const d = audio.music[id]; return d ? [d.file, ...d.layers.map((l) => l.file), ...(d.pieces ?? []).map((p) => p.file)] : []; };
  const uiFiles = new Set(Object.values(audio.cues).filter((c) => c.bus === 'ui').flatMap((c) => c.files));
  const screens = audio.screens ?? { menu: 'mus_menu', draft: 'mus_draft', postgame: 'mus_postgame' };
  let prevBed = null;
  const toBed = async (id, tag) => {
    eng.music(id);
    await settle();
    if (prevBed && prevBed !== id) {
      const left = bedFiles(prevBed).filter((f) => eng.buffers.has(f) && !bedFiles(id).includes(f));
      (report.M.bedChanges ??= []).push({ from: prevBed, to: id, left: left.length });
      if (left.length) failures.push(`M2 ${tag}: ${prevBed} → ${id} left ${left.length} file(s) of the old bed decoded (${left.slice(0, 3).join(', ')})`);
    }
    prevBed = id;
  };
  report.M.maps = {};
  for (const m of ['rift', 'bridge', 'fray']) {
    const map = (catalog.maps ?? []).find((x) => x.id === `map_${m}` || x.id === m);
    const matchBed = map?.art?.music ?? `mus_match_${m}`;
    await toBed(screens.menu, `${m} home`);
    await toBed(screens.draft, `${m} draft`);
    await toBed(matchBed, `${m} match`);
    // the match: every sfx / voice / ambience cue it could play (an upper bound: every kit, every role, the map's ambience)
    const view = { time: 0, mode: m, map: map?.id ?? m, gorgeWind: 0, players: [], objectives: [], entities: [], entity: () => undefined };
    eng.attach({ you: 0, setup: { map: map?.id ?? m, mode: m }, view, onEvents: () => () => {} });
    for (const [id, c] of Object.entries(audio.cues)) if (c.bus !== 'ui' && c.bus !== 'music') for (const f of c.files) void eng.buffer(f);
    for (const id of Object.values(audio.stings ?? {})) { const c = audio.cues[id]; if (c) for (const f of c.files) void eng.buffer(f); }
    await settle();
    const inMatch = await eng.decoded();
    eng.attach(null);
    await settle();
    const after = cached().filter((f) => !uiFiles.has(f) && !bedFiles(matchBed).includes(f));
    if (after.length) failures.push(`M3 ${m}: ${after.length} match file(s) still decoded after the match (${after.slice(0, 3).join(', ')})`);
    await toBed(screens.postgame, `${m} postgame`);
    await toBed(screens.menu, `${m} home again`);
    for (let i = 0; i < 12; i++) { await flush(); eng.ctx.advance(1); }
    const home = await eng.decoded();
    report.M.maps[m] = { matchBed, inMatchMb: MB(inMatch.bytes), inMatchFiles: inMatch.files, homeMb: MB(home.bytes), homeFiles: home.files };
    console.log(`M ${m}: decoded in the match ${MB(inMatch.bytes)} MB (${inMatch.files} files), at Home after it ${MB(home.bytes)} MB (${home.files} files)`);
    if (MB(home.bytes) > HOME_MB) failures.push(`M1 ${m}: decoded audio at Home ${MB(home.bytes)} MB > ${HOME_MB}`);
  }
}

for (const [k, v] of Object.entries(report.E)) if (v && typeof v === 'object' && !Array.isArray(v)) console.log(`E ${k}: ${JSON.stringify(v).slice(0, 400)}`);
report.failures = failures;
report.pass = failures.length === 0;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : `PASS: ${epic.map((u) => u.id).join(' and ')} sound only their own kit (autos at a fighter's level, casts, landings on the sim's delay, roar, death, a pit presence while alive); camps keep theirs and fall on their own fall; decoded audio at Home <= ${HOME_MB} MB after every map, the old bed and the match's cues freed`);
console.log(`report → ${OUT}`);
process.exit(failures.length ? 1 : 0);
