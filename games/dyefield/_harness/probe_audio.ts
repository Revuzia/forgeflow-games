// DYEFIELD — audio gate (CONTRACT_P6_11 §21), headless in node: the shipped files, the event → sound map, and the
// router driven by real bot matches.
//
//   node _harness/probe_audio.ts                 # the gate: files + map + a Lockwell and a Cinder match (70 s each)
//   node _harness/probe_audio.ts --files         # only the file / budget / seam / loudness checks (no match)
//   node _harness/probe_audio.ts --seconds 180   # full-length matches
//   node _harness/probe_audio.ts --verbose       # per-sound play counts and culls
//
// Files: every file the manifest references exists with the manifest's size; ffprobe says Ogg Vorbis, the
// expected channels / 44.1 kHz / duration, ≤ 128 kb/s; the decoded sample count equals the manifest (sample-accurate
// sections); every sprite region is inside the sprite, non-overlapping, not silent and not clipped; every loop seam
// (sprite loops, music sections in their play order) is click-free (seam jump ≤ 1.5 × the 99.5th-percentile
// sample step); looping music sections are whole bars; music loudness matches the manifest; total ≤ 8 MB.
// Map: every SimEvent type in core/match/events.ts has an EVENT_SOUNDS entry; every referenced id exists; every
// shipped sound is referenced (no dead asset); the four tracks are registered for `dyefield` in
// state/music_assignments.json and nowhere else; CREDITS.json names an author + licence for every pack.
// Matches: bots on Lockwell (conveyors) and Cinder (springs), mixed kits, 4 router perspectives (the MIST-RASP,
// SHEET-DRUM, NEEDLE-GLINT and POP-WELL runners as "me") feeding a mock sink with the real 24-voice pool: every
// emitted event type is voiced (or deliberately culled), countdown = 3 beeps, final 10 = 9 ticks, each horn once,
// music cues match → final (at a bar) → boost → stop, the voice limit holds, splats ≤ 14/s, no NaN commands, and
// the state loops (swim, refill, roll, charge, rain, conveyor, spring) all fire somewhere.
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_PAYLOAD_BYTES, MUSIC, REGISTERED_TRACKS, SAMPLE_RATE, SFX, SFX_SPRITE, SPRITE_GUARD_S, type MusicCueId, type SfxId } from '../runtime/src/audio/manifest.ts';
import { loopSlice } from '../runtime/src/audio/seam.ts';
import { AudioRouter, EVENT_SOUNDS, STATE_SOUNDS, type AudioSink, type LoopCmd, type MusicCmd, type PlayCmd, type SoundId } from '../runtime/src/audio/router.ts';
import { VoicePool } from '../runtime/src/audio/voices.ts';
import type { AudioFrame } from '../runtime/src/audio/types.ts';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { mapById } from '../runtime/src/core/data.ts';
import { loadMapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { MatchWorld } from '../runtime/src/core/match/world.ts';
import { defaultRoster } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { buildNav } from '../runtime/src/core/bots/nav.ts';
import { BotDirector } from '../runtime/src/core/bots/director.ts';
import { emptyIntent, type PlayerIntent } from '../runtime/src/core/types.ts';
import { TICK } from '../runtime/src/core/config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const VERBOSE = argv.includes('--verbose');
const FILES_ONLY = argv.includes('--files');
const SECONDS = Number(arg('--seconds', '70'));
const BUDGET = 8 * 1024 * 1024;
const VOICE_LIMIT = 24;
const MIXED_BOT_KITS = ['sheet-drum', 'needle-glint', 'pop-well', 'mist-rasp'];

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f1 = (v: number): string => v.toFixed(1);
const f3 = (v: number): string => v.toFixed(3);

// ───────────────────────────────────────── ffmpeg helpers ─────────────────────────────────────────
interface Probe { codec: string; channels: number; rate: number; duration: number; size: number; kbps: number }
function ffprobe(path: string): Probe {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration,size',
    '-of', 'json', path], { encoding: 'utf8' });
  const j = JSON.parse(out) as { streams: Array<{ codec_name: string; channels: number; sample_rate: string }>; format: { duration: string; size: string } };
  const s = j.streams[0];
  const duration = Number(j.format.duration), size = Number(j.format.size);
  return { codec: s.codec_name, channels: s.channels, rate: Number(s.sample_rate), duration, size, kbps: (size * 8) / duration / 1000 };
}
/** decode to float32 at the file's own rate; channels interleaved */
function decode(path: string, channels: number): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', String(channels), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}
function ebur128(path: string): { i: number; tp: number } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const txt = String(r.stderr ?? '');
  const I = [...txt.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  const P = [...txt.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].pop();
  return { i: I ? Number(I[1]) : NaN, tp: P ? Number(P[1]) : NaN };
}
function step995(x: Float32Array, a: number, b: number, stride: number, ch: number): number {
  const d: number[] = [];
  for (let i = a + 1; i < b; i++) d.push(Math.abs(x[i * stride + ch] - x[(i - 1) * stride + ch]));
  d.sort((p, q) => p - q);
  return d[Math.min(d.length - 1, Math.floor(d.length * 0.995))] || 1e-9;
}
function rmsDb(x: Float32Array, a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20);
}
function peakDb(x: Float32Array, a: number, b: number): number {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i]));
  return 20 * Math.log10(m + 1e-12);
}

// ───────────────────────────────────────── files ─────────────────────────────────────────
function fileChecks(): void {
  const spritePath = fileURLToPath(SFX_SPRITE.url);
  const files: Array<{ what: string; path: string; bytes: number; seconds: number; samples: number; channels: number }> = [
    { what: 'sfx sprite', path: spritePath, bytes: SFX_SPRITE.bytes, seconds: SFX_SPRITE.seconds, samples: SFX_SPRITE.samples, channels: 1 },
  ];
  for (const cue of Object.keys(MUSIC) as MusicCueId[]) {
    const m = MUSIC[cue];
    const samples = m.sections.reduce((s, x) => s + x[2], 0);
    files.push({ what: `music ${cue}`, path: fileURLToPath(m.url), bytes: m.bytes, seconds: m.seconds, samples, channels: 2 });
  }
  let total = 0;
  const bad: string[] = [];
  const rows: string[] = [];
  for (const f of files) {
    if (!existsSync(f.path)) { bad.push(`${f.what}: missing ${f.path}`); continue; }
    const size = statSync(f.path).size;
    total += size;
    const p = ffprobe(f.path);
    rows.push(`${f.what} ${(size / 1024).toFixed(0)} KB ${f1(p.kbps)} kb/s ${f3(p.duration)} s ${p.codec} ${p.channels}ch ${p.rate} Hz`);
    if (size !== f.bytes) bad.push(`${f.what}: ${size} B on disk ≠ manifest ${f.bytes}`);
    if (p.codec !== 'vorbis' && p.codec !== 'opus') bad.push(`${f.what}: codec ${p.codec}`);
    if (p.channels !== f.channels) bad.push(`${f.what}: ${p.channels} ch`);
    if (p.rate !== SAMPLE_RATE) bad.push(`${f.what}: ${p.rate} Hz`);
    if (Math.abs(p.duration - f.seconds) > 0.005) bad.push(`${f.what}: ${f3(p.duration)} s ≠ manifest ${f3(f.seconds)}`);
    if (p.kbps > 128) bad.push(`${f.what}: ${f1(p.kbps)} kb/s > 128`);
  }
  check('files: exist, Ogg Vorbis/Opus, channels, 44.1 kHz, duration, ≤ 128 kb/s', bad.length === 0, bad.length ? bad.join(' · ') : rows.join(' | '));
  check('payload ≤ 8 MB', total <= BUDGET && total === AUDIO_PAYLOAD_BYTES,
    `${(total / 1024 / 1024).toFixed(2)} MB on disk (manifest ${(AUDIO_PAYLOAD_BYTES / 1024 / 1024).toFixed(2)} MB, budget 8 MB)`);
  if (bad.length) return;

  // ── sprite: decoded length, regions, levels, loop seams ──
  const sp = decode(spritePath, 1);
  check('sprite decodes sample-exact', sp.length === SFX_SPRITE.samples, `${sp.length} decoded vs ${SFX_SPRITE.samples} in the manifest`);
  const regions: Array<{ id: string; a: number; b: number }> = [];
  const regionBad: string[] = [];
  const seamRows: string[] = [];
  const seamBad: string[] = [];
  for (const id of Object.keys(SFX) as SfxId[]) {
    const e = SFX[id];
    e.v.forEach(([s, d], i) => {
      const a = Math.round(s * SAMPLE_RATE), n = e.n[i], b = a + n;
      if (Math.abs(d * SAMPLE_RATE - n) > 1.01) regionBad.push(`${id}#${i} n ${n} vs ${f3(d)} s`);
      if (b > sp.length) { regionBad.push(`${id}#${i} ends past the sprite`); return; }
      regions.push({ id: `${id}#${i}`, a, b });
      const r = rmsDb(sp, a, b), pk = peakDb(sp, a, b);
      if (r < -50) regionBad.push(`${id}#${i} silent (${f1(r)} dBFS)`);
      if (pk > 0.0) regionBad.push(`${id}#${i} clips (${f1(pk)} dBFS)`);
      if (e.loop) {
        // exactly what engine.ts loops: the slice with its head crossfaded from the decoded guard
        const guard = Math.round(SPRITE_GUARD_S * SAMPLE_RATE);
        const sl = loopSlice(sp, a, n, guard, Math.min(guard, Math.round(0.006 * SAMPLE_RATE)));
        const typ = step995(sl, 0, n, 1, 0);
        const seam = Math.abs(sl[0] - sl[n - 1]);
        const ratio = seam / typ;
        seamRows.push(`${id} ${ratio.toFixed(2)}`);
        if (ratio > 1.5) seamBad.push(`${id} seam ${ratio.toFixed(2)}× the 99.5 % step`);
      }
    });
  }
  regions.sort((p, q) => p.a - q.a);
  for (let i = 1; i < regions.length; i++) if (regions[i].a < regions[i - 1].b) regionBad.push(`${regions[i - 1].id} overlaps ${regions[i].id}`);
  check('sprite regions: inside, non-overlapping, not silent, not clipped', regionBad.length === 0,
    regionBad.length ? regionBad.join(' · ') : `${regions.length} regions in ${f1(SFX_SPRITE.seconds)} s`);
  check('sprite loop seams click-free (≤ 1.5 × the 99.5 % sample step)', seamBad.length === 0, seamBad.length ? seamBad.join(' · ') : seamRows.join(', '));

  // ── music: decoded length, whole bars, seams in play order, loudness ──
  const mBad: string[] = [];
  const mSeam: string[] = [];
  const mRows: string[] = [];
  for (const cue of Object.keys(MUSIC) as MusicCueId[]) {
    const m = MUSIC[cue];
    const path = fileURLToPath(m.url);
    const x = decode(path, 2);
    const frames = x.length / 2;
    const want = m.sections.reduce((s, v) => s + v[2], 0);
    if (frames !== want) mBad.push(`${cue}: decoded ${frames} frames ≠ ${want}`);
    let pos = 0;
    for (const [s, d, n] of m.sections) {
      if (Math.abs(s * SAMPLE_RATE - pos) > 1.01) mBad.push(`${cue}: section at ${f3(s)} s not contiguous`);
      if (Math.abs(d * SAMPLE_RATE - n) > 1.01) mBad.push(`${cue}: section ${f3(d)} s ≠ ${n} samples`);
      if (m.loop) {
        const bars = (d * m.bpm) / 240;
        if (Math.abs(bars - Math.round(bars)) > 0.01) mBad.push(`${cue}: section of ${f3(d)} s = ${bars.toFixed(3)} bars at ${m.bpm} bpm`);
      }
      pos += n;
    }
    if (m.loop) {
      // every transition the player makes: intro → … → cycle → cycle wrap
      const order = [...m.intro, ...m.cycle, m.cycle[0]];
      const seen = new Set<string>();
      for (let k = 0; k + 1 < order.length; k++) {
        const i = order[k], j = order[k + 1];
        const key = `${i}>${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [ai, , ni] = m.sections[i];
        const [aj, , nj] = m.sections[j];
        const endI = Math.round(ai * SAMPLE_RATE) + ni - 1, startJ = Math.round(aj * SAMPLE_RATE);
        let worst = 0;
        for (let c = 0; c < 2; c++) {
          const typ = Math.max(step995(x, Math.round(ai * SAMPLE_RATE), Math.round(ai * SAMPLE_RATE) + ni, 2, c),
            step995(x, startJ, startJ + nj, 2, c));
          worst = Math.max(worst, Math.abs(x[endI * 2 + c] - x[startJ * 2 + c]) / typ);
        }
        mSeam.push(`${cue} ${key} ${worst.toFixed(2)}`);
        if (worst > 1.5) mBad.push(`${cue}: seam ${key} ${worst.toFixed(2)}× the 99.5 % step`);
      }
    }
    const L = ebur128(path);
    mRows.push(`${cue} ${f1(L.i)} LUFS (manifest ${m.lufs}) tp ${f1(L.tp)}`);
    if (!(Math.abs(L.i - m.lufs) <= 1.0)) mBad.push(`${cue}: ${f1(L.i)} LUFS vs manifest ${m.lufs}`);
    if (!(L.tp <= -0.5)) mBad.push(`${cue}: true peak ${f1(L.tp)} dBTP`);
  }
  check('music: sample-exact sections, whole bars, click-free seams in play order, loudness', mBad.length === 0,
    mBad.length ? mBad.join(' · ') : `${mSeam.join(', ')} | ${mRows.join(', ')}`);
}

// ───────────────────────────────────────── map / registry / credits ─────────────────────────────────────────
function mapChecks(): void {
  const src = readFileSync(resolve(GAME, 'runtime/src/core/match/events.ts'), 'utf8');
  const union = src.slice(src.indexOf('export type SimEvent ='), src.indexOf('export type SimEventType'));
  const types = [...union.matchAll(/\{\s*t:\s*'(\w+)'/g)].map((m) => m[1]);
  const keys = Object.keys(EVENT_SOUNDS);
  const missing = types.filter((t) => !keys.includes(t));
  const extra = keys.filter((k) => !types.includes(k));
  check('every SimEvent type (events.ts) has an EVENT_SOUNDS entry', types.length > 0 && missing.length === 0 && extra.length === 0,
    `${types.length} types in the union${missing.length ? ` · missing ${missing.join(',')}` : ''}${extra.length ? ` · stale ${extra.join(',')}` : ''}`);
  const referenced = new Set<string>();
  for (const k of keys) for (const id of EVENT_SOUNDS[k as keyof typeof EVENT_SOUNDS].ids) referenced.add(id);
  for (const s of STATE_SOUNDS) for (const id of s.ids) referenced.add(id);
  const unknown = [...referenced].filter((id) => id !== 'charge' && !(id in SFX));
  const dead = (Object.keys(SFX) as SfxId[]).filter((id) => !referenced.has(id));
  check('every referenced sound exists; every shipped sound is referenced', unknown.length === 0 && dead.length === 0,
    `${referenced.size} ids referenced, ${Object.keys(SFX).length} in the sprite${unknown.length ? ` · unknown ${unknown.join(',')}` : ''}${dead.length ? ` · dead ${dead.join(',')}` : ''}`);

  const regPath = resolve(GAME, '../../../state/music_assignments.json');
  let regOk = false, regDetail = '';
  try {
    const reg = JSON.parse(readFileSync(regPath, 'utf8')) as { assignments: Record<string, unknown>; used: Record<string, number> };
    const mine = reg.assignments.dyefield;
    const list = Array.isArray(mine) ? (mine as string[]) : [];
    const want: string[] = [...REGISTERED_TRACKS];
    const others = Object.entries(reg.assignments).filter(([k, v]) => k !== 'dyefield' && (Array.isArray(v) ? v : [v]).some((t) => want.includes(String(t))));
    const used = want.every((t) => (reg.used[t] ?? 0) >= 1);
    regOk = want.every((t) => list.includes(t)) && used && others.length === 0;
    regDetail = `assignments.dyefield = [${list.join(', ')}]; used ${want.map((t) => reg.used[t] ?? 0).join('/')}; other slugs on these tracks: ${others.length}`;
  } catch (e) {
    regDetail = `cannot read ${regPath}: ${(e as Error).message}`;
  }
  check('music registered for dyefield in state/music_assignments.json (and nowhere else)', regOk, regDetail);

  let crOk = false, crDetail = '';
  try {
    const cr = JSON.parse(readFileSync(resolve(GAME, 'runtime/src/audio/CREDITS.json'), 'utf8')) as {
      lines: string[]; music: Array<{ title: string; author: string; license: string }>; sfx: Array<{ pack: string; author: string; license: string; sounds: string[] }>;
    };
    const tracks = new Set(Object.values(MUSIC).map((m) => m.track));
    const musicOk = [...tracks].every((t) => cr.music.some((m) => m.title === t && m.author && m.license));
    const sfxOk = cr.sfx.length > 0 && cr.sfx.every((p) => p.pack && p.author && p.license && p.sounds.length > 0);
    const covered = new Set(cr.sfx.flatMap((p) => p.sounds));
    const uncovered = (Object.keys(SFX) as SfxId[]).filter((id) => !covered.has(id));
    crOk = cr.lines.length > 0 && musicOk && sfxOk && uncovered.length === 0;
    crDetail = `${cr.lines.length} lines · ${cr.music.length} tracks · ${cr.sfx.length} sfx packs${uncovered.length ? ` · uncredited ${uncovered.join(',')}` : ''}`;
  } catch (e) {
    crDetail = `CREDITS.json: ${(e as Error).message}`;
  }
  check('CREDITS.json: every track + pack has an author and a licence; every sound credited', crOk, crDetail);
}

// ───────────────────────────────────────── matches ─────────────────────────────────────────
class MockSink implements AudioSink {
  readonly pool = new VoicePool(VOICE_LIMIT);
  readonly plays: Record<string, number> = {};
  readonly loopStarts: Record<string, number> = {};
  readonly active = new Map<string, SoundId>();
  readonly musicCmds: MusicCmd[] = [];
  readonly splatSecs: number[] = [];
  maxLoops = 0;
  ducks = 0;
  nan = 0;
  hornRejected = 0;
  private readonly clock: () => number;
  constructor(clock: () => number) { this.clock = clock; }
  play(c: PlayCmd): void {
    if (!Number.isFinite(c.gain) || !Number.isFinite(c.rate) || !Number.isFinite(c.est) || (c.pos && !(Number.isFinite(c.pos.x) && Number.isFinite(c.pos.y) && Number.isFinite(c.pos.z)))) this.nan++;
    const now = this.clock();
    const dur = c.id === 'charge' ? 0.2 : SFX[c.id].v[Math.min(c.variant, SFX[c.id].v.length - 1)][1] / Math.max(0.25, c.rate);
    const h = this.pool.acquire(now, c.pri + Math.min(1, c.est), now + dur, () => undefined);
    if (!h && c.pri >= 10) this.hornRejected++;
    this.plays[c.id] = (this.plays[c.id] ?? 0) + 1;
    if (c.id === 'splat') this.splatSecs.push(now);
  }
  loop(key: string, c: LoopCmd | null): void {
    if (!c) { this.active.delete(key); return; }
    if (!Number.isFinite(c.gain) || !Number.isFinite(c.rate) || (c.pos && !Number.isFinite(c.pos.x))) this.nan++;
    if (!this.active.has(key)) this.loopStarts[c.id] = (this.loopStarts[c.id] ?? 0) + 1;
    this.active.set(key, c.id);
    this.maxLoops = Math.max(this.maxLoops, this.active.size);
  }
  music(c: MusicCmd): void { this.musicCmds.push(c); }
  duck(): void { this.ducks++; }
}

interface Persp { me: number; kit: string; router: AudioRouter; sink: MockSink }

async function runMatch(mapId: string, seed: number): Promise<{ persp: Persp[]; emitted: Record<string, number>; features: string; seconds: number }> {
  const R = await loadRapier();
  const def = mapById(mapId);
  const geo = await loadMapGeometry(def);
  const nav = buildNav(geo, new PhysicsWorld(R, geo), def);
  const physics = new PhysicsWorld(R, geo);
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill: 'swell', botKits: MIXED_BOT_KITS });
  roster[0].bot = true;
  const world = new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: SECONDS });
  const director = new BotDirector(world, nav, seed, 'swell');
  const intents: PlayerIntent[] = roster.map(() => emptyIntent());
  const feats = geo.features;
  const persp: Persp[] = [0, 1, 2, 3].map((me) => {
    const router = new AudioRouter(0x5eed + me);
    const sink = new MockSink(() => router.t);
    router.music('lobby', mapId, sink);
    router.setMap(mapId);
    return { me, kit: roster[me].kit, router, sink };
  });
  const ev: SimEvent[] = [];
  const emitted: Record<string, number> = {};
  const frameFor = (me: number): AudioFrame => {
    const r = world.runners[me];
    const yaw = r.aimYaw;
    return {
      listener: { x: r.x - Math.sin(yaw) * 4, y: r.y + 2.3, z: r.z - Math.cos(yaw) * 4, fx: Math.sin(yaw), fy: -0.25, fz: Math.cos(yaw) },
      runners: world.runners, me, phase: world.phase, timeLeft: world.timeLeft, countdown: world.countdown,
      projectiles: world.projectiles, conveyors: feats?.conveyors,
    };
  };
  let endTicks = -1;
  let guard = 0;
  // Deterministic spring coverage: bots take a tide-spring only 0-2 times per Cinder match, so waiting for one made
  // the 'spring' sound check a coin flip. At 30 s of a map with springs, place runner 0 on the first spring pad (the
  // dev teleport hook); stepping on the pad launches it like any player, and the router must play the spring sound.
  const springTick = Math.round((world.countdown + 30) / TICK);
  while (guard++ < (SECONDS + 20) / TICK) {
    director.think(intents);
    if (guard === springTick && feats && feats.springs.length && world.runners[0].alive) {
      const sp = feats.springs[0];
      world.devTeleport(0, sp.x, sp.y + 0.05, sp.z, world.runners[0].yaw);
    }
    world.step(intents);
    ev.length = 0;
    world.drainEvents(ev);
    for (const e of ev) emitted[e.t] = (emitted[e.t] ?? 0) + 1;
    for (const p of persp) {
      p.router.onEvents(ev, frameFor(p.me), p.sink);
      p.router.update(TICK, p.sink);
    }
    if (world.phase === 'ended') { if (endTicks < 0) endTicks = 0; if (++endTicks > 2 / TICK) break; }
  }
  return { persp, emitted, features: `${feats?.conveyors.length ?? 0} conveyors, ${feats?.springs.length ?? 0} springs`, seconds: SECONDS };
}

function matchChecks(mapId: string, r: Awaited<ReturnType<typeof runMatch>>): Record<string, number> {
  const tag = `[${mapId}]`;
  const emittedTypes = Object.keys(r.emitted);
  // voiced: an emitted type had one of its sounds played, or every instance was culled on purpose
  const unvoiced: string[] = [];
  for (const t of emittedTypes) {
    const ids = EVENT_SOUNDS[t as keyof typeof EVENT_SOUNDS].ids;
    const played = r.persp.reduce((s, p) => s + ids.reduce((q, id) => q + (p.sink.plays[id] ?? p.sink.loopStarts[id] ?? 0), 0), 0);
    const culled = r.persp.reduce((s, p) => s + Object.entries(p.router.culled).filter(([k]) => k.startsWith(`${t}:`) || ids.some((id) => k.startsWith(`${id}:`))).reduce((q, [, v]) => q + v, 0), 0);
    if (played === 0 && culled === 0) unvoiced.push(t);
  }
  check(`${tag} every emitted event type is voiced (or deliberately culled)`, unvoiced.length === 0,
    `${emittedTypes.length} types emitted (${emittedTypes.map((t) => `${t}:${r.emitted[t]}`).join(' ')})${unvoiced.length ? ` · UNVOICED ${unvoiced.join(',')}` : ''}`);
  const flowBad: string[] = [];
  for (const p of r.persp) {
    const pl = p.sink.plays;
    const want: Array<[string, number]> = [['beep', 3], ['tick', 9], ['horn_start', 1], ['beep_go', 1], ['horn_minute', 1], ['horn_final', 1], ['horn_end', 1]];
    for (const [id, n] of want) if ((pl[id] ?? 0) !== n) flowBad.push(`me=${p.me} ${id} ${pl[id] ?? 0}≠${n}`);
    const seq = p.sink.musicCmds.map((c) => (c.t === 'play' ? `${c.cue}@${c.at}` : c.t)).join(' ');
    const expect = 'lobby@now stop prefetch match@now final@bar boost stop';
    if (seq !== expect) flowBad.push(`me=${p.me} music "${seq}"`);
    if (p.sink.hornRejected) flowBad.push(`me=${p.me} ${p.sink.hornRejected} priority-10 sounds rejected`);
  }
  check(`${tag} match flow: 3 beeps, 9 final ticks, each horn once, music lobby → (countdown: stop + prefetch) → match → final@bar → boost → stop`, flowBad.length === 0,
    flowBad.length ? flowBad.join(' · ') : `4 perspectives · music "${r.persp[0].sink.musicCmds.map((c) => (c.t === 'play' ? `${c.cue}@${c.at}` : c.t)).join(' ')}"`);
  const vBad: string[] = [];
  const vRows: string[] = [];
  let splatMax = 0;
  for (const p of r.persp) {
    const s = p.sink;
    if (s.pool.peak > VOICE_LIMIT) vBad.push(`me=${p.me} peak ${s.pool.peak}`);
    if (s.nan) vBad.push(`me=${p.me} ${s.nan} non-finite commands`);
    if (s.maxLoops > 12) vBad.push(`me=${p.me} ${s.maxLoops} loops`);
    const t = s.splatSecs;
    for (let i = 0, j = 0; i < t.length; i++) { while (t[i] - t[j] >= 1) j++; splatMax = Math.max(splatMax, i - j + 1); }
    const total = Object.values(s.plays).reduce((a, b) => a + b, 0);
    vRows.push(`me=${p.me}(${p.kit}) ${total} plays, peak ${s.pool.peak} voices, ${s.pool.stolen} stolen, ${s.pool.rejected} dropped, ≤ ${s.maxLoops} loops`);
  }
  if (splatMax > 14) vBad.push(`${splatMax} splats in one second`);
  check(`${tag} voice limit ${VOICE_LIMIT} holds, splats ≤ 14/s, loops ≤ 12, no NaN`, vBad.length === 0, vBad.length ? vBad.join(' · ') : `${vRows.join(' | ')} · splats ≤ ${splatMax}/s`);
  if (VERBOSE) {
    for (const p of r.persp) {
      console.log(`    me=${p.me} plays: ${Object.entries(p.sink.plays).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
      console.log(`    me=${p.me} loops: ${Object.entries(p.sink.loopStarts).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
      console.log(`    me=${p.me} culled: ${Object.entries(p.router.culled).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
    }
  }
  const union: Record<string, number> = {};
  for (const p of r.persp) {
    for (const [k, v] of Object.entries(p.sink.plays)) union[k] = (union[k] ?? 0) + v;
    for (const [k, v] of Object.entries(p.sink.loopStarts)) union[k] = (union[k] ?? 0) + v;
  }
  return union;
}

async function main(): Promise<number> {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
  } catch {
    console.log('SETUP FAILED: ffprobe/ffmpeg not on PATH');
    return 2;
  }
  fileChecks();
  mapChecks();
  if (!FILES_ONLY) {
    const union: Record<string, number> = {};
    for (const [mapId, seed] of [['lockwell', 1], ['cinder', 2]] as const) {
      let res: Awaited<ReturnType<typeof runMatch>>;
      const t0 = performance.now();
      try { res = await runMatch(mapId, seed); } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
      console.log(`match ${mapId} seed ${seed}: ${res.seconds} s, ${res.features}, ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
      const u = matchChecks(mapId, res);
      for (const [k, v] of Object.entries(u)) union[k] = (union[k] ?? 0) + v;
    }
    const needed = ['swim_loop', 'refill_loop', 'roll_loop', 'charge', 'rain_loop', 'thunder', 'conveyor_loop', 'spring', 'amb_works', 'amb_harbor',
      'shot_mist', 'shot_drum', 'shot_needle', 'shot_pop', 'burst', 'splat', 'hit_dealt', 'hit_taken', 'washed', 'washed_me', 'respawn', 'slick_in', 'slick_out',
      'sub_throw', 'sub_land', 'sub_pop', 'special_ready', 'cloud_throw', 'leap', 'slam', 'flick'];
    const never = needed.filter((id) => !(union[id] > 0));
    check('state + kit sounds all fire across both matches', never.length === 0,
      never.length ? `never: ${never.join(', ')}` : needed.map((id) => `${id}:${union[id]}`).join(' '));
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? ` — FAILED: ${failed.map((c) => c.name).join('; ')}` : ''}`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.log('SETUP FAILED:', e); process.exit(2); });
