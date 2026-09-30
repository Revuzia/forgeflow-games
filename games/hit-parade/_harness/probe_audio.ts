// HIT PARADE - audio gate (lane AUDIO; CONTRACT s9, s13). Headless in node: the shipped files, the event -> sound map,
// and the router driven by a synthetic pass over every EV type plus a real sim bout.
//
//   node _harness/probe_audio.ts             # the gate
//   node _harness/probe_audio.ts --files     # only the file / budget / seam / loudness checks
//   node _harness/probe_audio.ts -v          # per-sound play counts, culls
//
// Files: every Ogg + AAC the manifest names exists with the manifest's size; Opus / AAC at 48 kHz with the right channel
// count; the decoded sample count equals the manifest (sample-exact sprites + cues); the AAC edit-list decode is exact and
// the raw decode = + priming; every sprite region is inside its sprite, non-overlapping, not silent, <= -1.0 dBTP, its
// lead-in <= 8 ms (one-shots); every loop seam (sprite beds, music cues) is click-free (<= 1.5 x the 99.5 % sample
// step); looping cues are whole bars; music loudness matches the manifest within 1 LU; Ogg + AAC together <= 12 MB.
// Map: every EV type in core/sim/events.ts has an EVENT_SOUNDS entry; every referenced id exists; every shipped sound is
// referenced (no dead asset); every SFX_CUE alias resolves; every `sfx` name in data/fighters/*.json resolves; the
// music is registered for `hit-parade` in state/music_assignments.json and nowhere else; CREDITS.json covers every
// sound and cue and names the required credits.
// Router: a synthetic event of every EV type is routed without an error or an unknown; a real johnny-vs-bruno bout
// (core/sim/match.ts + scripted inputs) feeds the router through a mock sink with the real 28-voice pool: every emitted
// event type is handled, the round flow plays (stage music, bell, FIGHT), no NaN command, the voice limit holds.
// Exit: 0 all pass, 1 a check failed, 2 setup failure. The last line is the summary.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_ALT_PAYLOAD_BYTES, AUDIO_BUDGET_BYTES, AUDIO_PAYLOAD_BYTES, MUSIC, REGISTERED_TRACKS, SAMPLE_RATE, SFX, SPRITES, SPRITE_GUARD_S,
  type AltCodec, type MusicCueId, type SfxId, type SpriteId } from '../runtime/src/audio/manifest.ts';
import { loopSlice } from '../runtime/src/audio/seam.ts';
import { altOffset, oggOffset } from '../runtime/src/audio/engine.ts';
import { AudioRouter, EVENT_SOUNDS, SFX_CUE_ALIASES, STATE_SOUNDS, resolveCue, type AudioSink, type LoopCmd, type MusicCmd, type PlayCmd } from '../runtime/src/audio/router.ts';
import { VoicePool } from '../runtime/src/audio/voices.ts';
import { EV, SC, eventsSince } from '../runtime/src/core/sim/events.ts';
import type { FighterSnap, GameData, MatchSnap, SimEvent } from '../runtime/src/core/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, '..');
const REGISTRY = resolve(GAME, '..', '..', '..', 'state', 'music_assignments.json');
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('-v') || argv.includes('--verbose');
const FILES_ONLY = argv.includes('--files');
const VOICE_LIMIT = 28;
// lead-in rule = build_audio.py gates(): an impact reaches -30 dB of its peak within 8 ms (it must land on its frame);
// a soft-onset sound (voice, announcer, crowd, sting, ui, splat, foley) has no dead air (-45 dB within 8 ms) and swells in
// within 40 ms (a breath before a laugh is part of the sound)
const LEAD_DB = -30;
const SILENCE_DB = -45;
const LEAD_MS = 8;
const SOFT_ONSET_MS = 40;
const SOFT_CATS = new Set(['voice', 'ann', 'crowd', 'sting', 'ui', 'splat', 'foley']);

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  -  ${detail}`);
}
const f1 = (v: number): string => v.toFixed(1);

// ------------------------------------------------------------------------------------------------ ffmpeg helpers
interface Probe { codec: string; channels: number; rate: number; duration: number }
function ffprobe(path: string): Probe {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration', '-of', 'json', path],
    { encoding: 'utf8' });
  const j = JSON.parse(out) as { streams: Array<{ codec_name: string; channels: number; sample_rate: string }>; format: { duration: string } };
  const s = j.streams[0];
  return { codec: s.codec_name, channels: s.channels, rate: Number(s.sample_rate), duration: Number(j.format.duration) };
}
/** decode at 48 kHz, channels interleaved (rawMp4: ignore the MP4 edit list = keep the priming) */
function decode(path: string, channels: number, rawMp4 = false): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...(rawMp4 ? ['-ignore_editlist', '1'] : []), '-i', path, '-ac', String(channels), '-ar', String(SAMPLE_RATE),
    '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}
function ebur128(path: string): { i: number; tp: number } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-nostdin', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const txt = String(r.stderr ?? '');
  const I = [...txt.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  const P = [...txt.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].pop();
  return { i: I ? Number(I[1]) : NaN, tp: P ? Number(P[1]) : NaN };
}
/** one channel of an interleaved buffer, frames [a, b) */
function chan(x: Float32Array, ch: number, c: number, a: number, b: number): Float32Array {
  const o = new Float32Array(Math.max(0, b - a));
  for (let i = a; i < b; i++) o[i - a] = x[i * ch + c];
  return o;
}
function step995(x: Float32Array): number {
  const d: number[] = [];
  for (let i = 1; i < x.length; i++) d.push(Math.abs(x[i] - x[i - 1]));
  d.sort((p, q) => p - q);
  return d[Math.min(d.length - 1, Math.floor(d.length * 0.995))] || 1e-9;
}
/** 4x-oversampled peak (linear interpolation is an under-estimate, so use a 4-tap windowed-sinc upsampler) */
function truePeakDb(x: Float32Array): number {
  let m = 0;
  const taps = 8;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > m) m = v;
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      let s = 0;
      for (let j = -taps + 1; j <= taps; j++) {
        const idx = i + j;
        if (idx < 0 || idx >= x.length) continue;
        const u = t - j;
        const sinc = Math.abs(u) < 1e-9 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
        const w = 0.5 + 0.5 * Math.cos((Math.PI * u) / taps);
        s += x[idx] * sinc * w;
      }
      if (Math.abs(s) > m) m = Math.abs(s);
    }
  }
  return 20 * Math.log10(m + 1e-12);
}
function rmsDb(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, x.length) + 1e-20);
}
function leadMs(x: Float32Array, db: number = LEAD_DB): number {
  let pk = 0;
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  const thr = pk * Math.pow(10, db / 20);
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= thr) return (i * 1000) / SAMPLE_RATE;
  return 0;
}
const urlPath = (u: string): string => fileURLToPath(u);

// ------------------------------------------------------------------------------------------------------- files
function fileChecks(): void {
  const rows: Array<{ what: string; ogg: string; alt: AltCodec; ch: number; samples: number; bytes: number }> = [];
  for (const s of Object.keys(SPRITES) as SpriteId[]) rows.push({ what: `sprite ${s}`, ogg: urlPath(SPRITES[s].url), alt: SPRITES[s].alt, ch: SPRITES[s].channels, samples: SPRITES[s].samples, bytes: SPRITES[s].bytes });
  for (const c of Object.keys(MUSIC) as MusicCueId[]) rows.push({ what: `music ${c}`, ogg: urlPath(MUSIC[c].url), alt: MUSIC[c].alt, ch: 2, samples: MUSIC[c].samples, bytes: MUSIC[c].bytes });
  const bad: string[] = [];
  const out: string[] = [];
  let ogg = 0, aac = 0;
  for (const r of rows) {
    for (const [p, want, kind] of [[r.ogg, r.bytes, 'opus'], [urlPath(r.alt.url), r.alt.bytes, 'aac']] as const) {
      if (!existsSync(p)) { bad.push(`${r.what}: missing ${p}`); continue; }
      const size = statSync(p).size;
      if (kind === 'opus') ogg += size; else aac += size;
      if (size !== want) bad.push(`${r.what} ${kind}: ${size} B on disk != manifest ${want}`);
      const pr = ffprobe(p);
      if (pr.codec !== kind || pr.channels !== r.ch || pr.rate !== SAMPLE_RATE) bad.push(`${r.what}: ${pr.codec} ${pr.channels} ch ${pr.rate} Hz`);
    }
    out.push(`${r.what} ${(r.bytes / 1024).toFixed(0)}+${(r.alt.bytes / 1024).toFixed(0)} KB`);
  }
  check('files: every Ogg-Opus + AAC twin exists, manifest size, codec, 48 kHz, channels', bad.length === 0, bad.length ? bad.join(' | ') : `${rows.length} assets x 2 codecs`);
  const total = ogg + aac;
  check(`shipped audio <= ${(AUDIO_BUDGET_BYTES / 1e6).toFixed(0)} MB (Ogg + AAC together)`, total <= AUDIO_BUDGET_BYTES && ogg === AUDIO_PAYLOAD_BYTES && aac === AUDIO_ALT_PAYLOAD_BYTES,
    `Ogg ${ogg} B + AAC ${aac} B = ${total} B (${(total / 1e6).toFixed(3)} MB); a device downloads one set (Ogg ${(ogg / 1e6).toFixed(3)} MB or AAC ${(aac / 1e6).toFixed(3)} MB)`);
  if (bad.length) return;

  // -- sprites: decoded length, regions, levels, lead-ins, loop seams
  const sBad: string[] = [];
  const seams: string[] = [];
  let regions = 0;
  let worstTp = -99, worstLead = 0, worstSoft = 0, worstAir = 0;
  for (const s of Object.keys(SPRITES) as SpriteId[]) {
    const sp = SPRITES[s];
    const x = decode(urlPath(sp.url), sp.channels);
    const frames = x.length / sp.channels;
    if (frames !== sp.samples) sBad.push(`${s}: decoded ${frames} frames != ${sp.samples}`);
    const spans: Array<{ id: string; a: number; b: number }> = [];
    for (const id of Object.keys(SFX) as SfxId[]) {
      const e = SFX[id];
      if (e.sprite !== s) continue;
      e.v.forEach(([st, d], i) => {
        const a = Math.round(st * SAMPLE_RATE), n = e.n[i], b = a + n;
        regions++;
        if (Math.abs(d * SAMPLE_RATE - n) > 1.01) sBad.push(`${id}#${i}: n ${n} vs ${d} s`);
        if (b > frames) { sBad.push(`${id}#${i} ends past the sprite`); return; }
        spans.push({ id: `${id}#${i}`, a, b });
        for (let c = 0; c < sp.channels; c++) {
          const r = chan(x, sp.channels, c, a, b);
          if (rmsDb(r) < -55) sBad.push(`${id}#${i} silent`);
          const tp = truePeakDb(r);
          worstTp = Math.max(worstTp, tp);
          if (tp > -1.0) sBad.push(`${id}#${i} tp ${tp.toFixed(2)} dBTP`);
          if (!e.loop && c === 0) {
            const L = leadMs(r), S = leadMs(r, SILENCE_DB);
            if (SOFT_CATS.has(e.cat)) {
              worstSoft = Math.max(worstSoft, L);
              worstAir = Math.max(worstAir, S);
              if (S > LEAD_MS || L > SOFT_ONSET_MS) sBad.push(`${id}#${i} dead air ${f1(S)} ms / onset ${f1(L)} ms`);
            } else {
              worstLead = Math.max(worstLead, L);
              if (L > LEAD_MS) sBad.push(`${id}#${i} impact lead-in ${f1(L)} ms`);
            }
          }
          if (e.loop) {
            // exactly what engine.ts loops: the slice with its head crossfaded from the decoded guard
            const guard = Math.round(SPRITE_GUARD_S * SAMPLE_RATE);
            const full = chan(x, sp.channels, c, 0, frames);
            const sl = loopSlice(full, a, n, guard, Math.min(guard, Math.round(0.006 * SAMPLE_RATE)));
            const ratio = Math.abs(sl[0] - sl[n - 1]) / step995(sl);
            if (c === 0) seams.push(`${id} ${ratio.toFixed(2)}`);
            if (ratio > 1.5) sBad.push(`${id} ch${c} seam ${ratio.toFixed(2)}x`);
          }
        }
      });
    }
    spans.sort((p, q) => p.a - q.a);
    for (let i = 1; i < spans.length; i++) if (spans[i].a < spans[i - 1].b) sBad.push(`${spans[i - 1].id} overlaps ${spans[i].id}`);
  }
  check('sprites: sample-exact decode, regions inside + disjoint + audible, <= -1.0 dBTP, impact lead-in <= 8 ms / soft onsets no dead air, bed seams <= 1.5x', sBad.length === 0,
    sBad.length ? sBad.slice(0, 12).join(' | ') + (sBad.length > 12 ? ` (+${sBad.length - 12})` : '')
      : `${regions} regions in ${Object.keys(SPRITES).length} sprites; worst decoded tp ${worstTp.toFixed(2)} dBTP; worst impact lead-in ${f1(worstLead)} ms; soft onsets: worst dead air ${f1(worstAir)} ms, worst swell ${f1(worstSoft)} ms; seams ${seams.join(', ')}`);

  // -- music: decoded length, whole bars, loop seam, loudness, true peak
  const mBad: string[] = [];
  const mRows: string[] = [];
  for (const c of Object.keys(MUSIC) as MusicCueId[]) {
    const m = MUSIC[c];
    const x = decode(urlPath(m.url), 2);
    const frames = x.length / 2;
    if (frames !== m.samples) mBad.push(`${c}: decoded ${frames} != ${m.samples}`);
    if (m.loop) {
      const want = (m.bars * 240 / m.bpm) * SAMPLE_RATE;
      if (Math.abs(want - m.samples) > 1) mBad.push(`${c}: ${m.samples} samples != ${m.bars} bars at ${m.bpm} bpm (${want.toFixed(1)})`);
      let worst = 0;
      for (let ch = 0; ch < 2; ch++) {
        const one = chan(x, 2, ch, 0, frames);
        worst = Math.max(worst, Math.abs(one[0] - one[frames - 1]) / step995(one));
      }
      if (worst > 1.5) mBad.push(`${c}: loop seam ${worst.toFixed(2)}x`);
      mRows.push(`${c} seam ${worst.toFixed(2)}`);
    }
    const L = ebur128(urlPath(m.url));
    if (!(Math.abs(L.i - m.lufs) <= 1.0)) mBad.push(`${c}: ${f1(L.i)} LUFS vs manifest ${m.lufs}`);
    if (!(L.tp <= -1.0)) mBad.push(`${c}: tp ${f1(L.tp)} dBTP`);
    mRows.push(`${c} ${f1(L.i)} LUFS tp ${f1(L.tp)}`);
  }
  check('music: sample-exact, loops = whole bars with seams <= 1.5x, loudness = manifest +-1 LU, tp <= -1.0 dBTP', mBad.length === 0,
    mBad.length ? mBad.join(' | ') : mRows.join(', '));

  // -- AAC twins: exact via the edit list, raw = + priming, engine offsets
  const aBad: string[] = [];
  for (const r of rows) {
    const el = decode(urlPath(r.alt.url), r.ch), raw = decode(urlPath(r.alt.url), r.ch, true);
    const nEl = el.length / r.ch, nRaw = raw.length / r.ch;
    if (nEl !== r.alt.samples) aBad.push(`${r.what}: edit-list decode ${nEl} != ${r.alt.samples}`);
    if (nRaw !== r.alt.samples + r.alt.delay) aBad.push(`${r.what}: raw decode ${nRaw} != ${r.alt.samples} + ${r.alt.delay}`);
    const S = SAMPLE_RATE;
    if (altOffset({ duration: r.alt.samples / S }, r.alt) !== 0) aBad.push(`${r.what}: altOffset(trimmed) != 0`);
    if (altOffset({ duration: (r.alt.samples + r.alt.delay) / S }, r.alt) !== r.alt.delay / S) aBad.push(`${r.what}: altOffset(untrimmed) != delay`);
    if (oggOffset({ duration: r.samples / S }, r.samples) !== 0) aBad.push(`${r.what}: oggOffset(exact) != 0`);
    if (Math.abs(oggOffset({ duration: (r.samples + 312) / S }, r.samples) - 312 / S) > 1e-9) aBad.push(`${r.what}: oggOffset(pre-skip kept) != 312`);
  }
  check('AAC twins: edit-list decode exact, raw = +1024 priming, engine altOffset / oggOffset', aBad.length === 0, aBad.length ? aBad.join(' | ') : `${rows.length} twins`);
}

// ----------------------------------------------------------------------------------------------------------- map
function mapChecks(): void {
  const evKeys = Object.keys(EV).sort();
  const mapKeys = Object.keys(EVENT_SOUNDS).sort();
  const missing = evKeys.filter((k) => !mapKeys.includes(k));
  const stale = mapKeys.filter((k) => !evKeys.includes(k));
  check('router covers every EV type (EVENT_SOUNDS vs core/sim/events.ts EV)', missing.length === 0 && stale.length === 0,
    `${evKeys.length} EV types, ${mapKeys.length} mapped${missing.length ? ` | missing ${missing.join(',')}` : ''}${stale.length ? ` | stale ${stale.join(',')}` : ''}`);
  const referenced = new Set<string>();
  for (const k of mapKeys) for (const id of EVENT_SOUNDS[k as keyof typeof EV].ids) referenced.add(id);
  for (const s of STATE_SOUNDS) for (const id of s.ids) referenced.add(id);
  for (const t of Object.values(SFX_CUE_ALIASES)) referenced.add(t);
  const voiceRefs = [...referenced].filter((r) => r.startsWith('voice:'));
  const vo = Object.keys(SFX).filter((id) => id.startsWith('vo_'));
  const unknown = [...referenced].filter((r) => !r.startsWith('voice:') && !(r in SFX));
  const dead = Object.keys(SFX).filter((id) => !referenced.has(id) && !(id.startsWith('vo_') && voiceRefs.length));
  check('every referenced sound exists; every shipped sound is referenced (voice banks via voice:*)', unknown.length === 0 && dead.length === 0,
    `${referenced.size} refs, ${Object.keys(SFX).length} sounds (${vo.length} voice-bank sounds)${unknown.length ? ` | unknown ${unknown.join(',')}` : ''}${dead.length ? ` | dead ${dead.join(',')}` : ''}`);
  // SFX_CUE names in the fighter data
  const names = new Map<string, string[]>();
  const fdir = resolve(GAME, 'data', 'fighters');
  if (existsSync(fdir)) {
    for (const f of readdirSync(fdir).filter((n) => n.endsWith('.json'))) {
      try {
        const d = JSON.parse(readFileSync(resolve(fdir, f), 'utf8')) as { moves?: Record<string, { sfx?: [number, string][] }> };
        for (const mv of Object.values(d.moves ?? {})) for (const e of mv.sfx ?? []) {
          const l = names.get(e[1]) ?? [];
          if (!l.includes(f)) l.push(f);
          names.set(e[1], l);
        }
      } catch (e) { names.set(`<unreadable ${f}>`, [String(e)]); }
    }
  }
  const unres = [...names.keys()].filter((n) => resolveCue(n) === null);
  check('every SFX_CUE name in data/fighters/*.json resolves (SFX_CUE_ALIASES or a sound id)', unres.length === 0,
    `${names.size} names: ${[...names.keys()].sort().map((n) => `${n}->${resolveCue(n) ?? '??'}`).join(', ')}${unres.length ? ` | UNRESOLVED ${unres.join(',')}` : ''}`);
  // registry
  let regOk = false, regDetail = '';
  try {
    const reg = JSON.parse(readFileSync(REGISTRY, 'utf8')) as { assignments: Record<string, unknown>; used: Record<string, number> };
    const mine = reg.assignments['hit-parade'];
    const list = Array.isArray(mine) ? (mine as string[]) : [];
    const want = [...REGISTERED_TRACKS].sort();
    const others = Object.entries(reg.assignments).filter(([k, v]) => k !== 'hit-parade' && want.some((t) => v === t || (Array.isArray(v) && (v as string[]).includes(t))));
    regOk = JSON.stringify([...list].sort()) === JSON.stringify(want) && others.length === 0 && want.every((t) => (reg.used[t] ?? 0) >= 1);
    regDetail = `assignments['hit-parade'] = ${list.length} tracks; used ${want.map((t) => reg.used[t] ?? 0).join('/')}; other slugs on these tracks: ${others.length}`;
  } catch (e) { regDetail = `unreadable: ${String(e)}`; }
  check('music registered for hit-parade in state/music_assignments.json, used by no other slug', regOk, regDetail);
  // credits
  let crOk = false, crDetail = '';
  try {
    const cr = JSON.parse(readFileSync(resolve(GAME, 'runtime', 'src', 'audio', 'CREDITS.json'), 'utf8')) as {
      lines: string[]; music: Array<{ cues: string[]; author: string }>; sfx: Array<{ author: string; license: string; sounds: string[] }>; other: Array<{ source: string }>;
    };
    const covered = new Set(cr.sfx.flatMap((p) => p.sounds));
    const uncovered = Object.keys(SFX).filter((id) => !covered.has(id));
    const cues = new Set(cr.music.flatMap((m) => m.cues));
    const uncCues = Object.keys(MUSIC).filter((c) => !cues.has(c));
    const text = JSON.stringify(cr);
    const need = ['Imphenzia', 'Travis Rise', 'Kenney', 'Sonniss', 'CMU', 'Daniel Gooding'];
    const absent = need.filter((n) => !text.includes(n));
    const noLicence = cr.sfx.filter((p) => !p.license || !p.author).length;
    crOk = uncovered.length === 0 && uncCues.length === 0 && absent.length === 0 && noLicence === 0 && cr.lines.length > 0;
    crDetail = `${cr.lines.length} lines, ${cr.music.length} tracks, ${cr.sfx.length} sfx packs${uncovered.length ? ` | uncredited ${uncovered.join(',')}` : ''}${uncCues.length ? ` | uncredited cues ${uncCues.join(',')}` : ''}${absent.length ? ` | missing ${absent.join(',')}` : ''}`;
  } catch (e) { crDetail = `unreadable: ${String(e)}`; }
  check('CREDITS.json: every sound + cue credited with author + licence; Imphenzia / Travis Rise / Kenney / Sonniss / CMU / Gooding named', crOk, crDetail);
}

// -------------------------------------------------------------------------------------------------------- router
class MockSink implements AudioSink {
  t = 0;
  readonly pool = new VoicePool(VOICE_LIMIT);
  readonly plays: Record<string, number> = {};
  readonly loops = new Map<string, LoopCmd>();
  readonly loopStarts: Record<string, number> = {};
  readonly musicCmds: MusicCmd[] = [];
  bad: string[] = [];
  maxVoices = 0;
  ducks = 0;
  play(c: PlayCmd): void {
    for (const [k, v] of [['gain', c.gain], ['rate', c.rate], ['pan', c.pan], ['delay', c.delay]] as const) if (!Number.isFinite(v)) this.bad.push(`${c.id} ${k} ${v}`);
    if (c.gain < 0 || c.gain > 4.01 || c.rate < 0.25 || c.rate > 4 || Math.abs(c.pan) > 1) this.bad.push(`${c.id} out of range g${c.gain} r${c.rate} p${c.pan}`);
    if (!(c.id in SFX)) this.bad.push(`unknown id ${c.id}`);
    this.plays[c.id] = (this.plays[c.id] ?? 0) + 1;
    const n = SFX[c.id]?.n[c.variant];
    if (n === undefined) this.bad.push(`${c.id} variant ${c.variant}`);
    this.pool.acquire(this.t, c.pri + Math.min(1, c.gain), this.t + c.delay + (n ?? 0) / SAMPLE_RATE / Math.max(0.25, c.rate), () => undefined);
    this.maxVoices = Math.max(this.maxVoices, this.pool.count);
  }
  loop(key: string, c: LoopCmd | null): void {
    if (!c) { this.loops.delete(key); return; }
    if (!Number.isFinite(c.gain)) this.bad.push(`loop ${key} gain ${c.gain}`);
    if (!this.loops.has(key)) this.loopStarts[c.id] = (this.loopStarts[c.id] ?? 0) + 1;
    this.loops.set(key, c);
  }
  music(c: MusicCmd): void { this.musicCmds.push(c); }
  duck(): void { this.ducks++; }
}

function fakeFighter(x: number, over: Partial<FighterSnap> = {}): FighterSnap {
  return {
    x, y: 0, facing: 1, state: 0, stateName: 'idle', moveId: -1, moveName: '', moveKind: '', moveFrame: 0, animId: 0, animFrame: 0, prevAnimId: -1,
    prevAnimFrame: 0, blendT: 1, animSec: 0, hp: 10000, hpMax: 10000, greyHp: 0, showtime: 0, nerve: 60000, stageFright: false, combo: 0,
    comboDamage: 0, lastDamage: 0, hitstop: 0, stun: 0, airborne: false, crouching: false,
    flags: { invuln: false, armor: false, counter: false, stance: 0, taunting: false, ko: false }, unique: [0, 0, 0, 0], ...over,
  };
}
function fakeMatch(frame: number, over: Partial<MatchSnap> = {}): MatchSnap {
  return { frame, phase: 'fight', phaseFrame: 0, round: 1, timer: 99, wins: [0, 0], cinematic: { active: false, fighter: -1, cueId: -1, frame: 0, frames: 0 },
    winner: -1, draw: false, roundWinner: -1, slowmo: false, freeze: 0, ...over };
}

function syntheticRouter(): void {
  const r = new AudioRouter(7);
  const sink = new MockSink();
  r.setBout({ fighters: ['johnny', 'zambini'], stage: 'wheel_of_pain', mode: 'versus', local: 0, sfxNames: ['whoosh_heavy', 'fire_whoosh', 'grab_cloth', 'crowd_cheer_burst', 'kiai'] }, sink);
  const f: [FighterSnap, FighterSnap] = [fakeFighter(-1.2), fakeFighter(1.2)];
  const silentOk = new Set(['STAGE_FRIGHT_OFF', 'CAMERA_CUE']);
  const bad: string[] = [];
  let frame = 10;
  // intro -> fight via phase (music + bell + FIGHT) first
  r.onEvents([], fakeMatch(1, { phase: 'intro' }), f, sink);
  r.onEvents([], fakeMatch(2, { phase: 'fight' }), f, sink);
  for (const k of Object.keys(EV) as (keyof typeof EV)[]) {
    frame += 90;
    for (let i = 0; i < 90; i++) { r.update(1 / 60, sink); sink.t += 1 / 60; }
    const before = Object.values(sink.plays).reduce((a, b) => a + b, 0) + sink.musicCmds.length;
    const e: SimEvent = { frame, type: EV[k], a: 0, b: 1, c: k === 'METER_BAR' ? 3 : k === 'SFX_CUE' ? 0 : SC.H, d: 120 };
    const snap = k === 'ROUND_END' ? fakeMatch(frame, { phase: 'fight', roundWinner: 0, round: 1 }) : k === 'MATCH_END' ? fakeMatch(frame, { winner: 0 })
      : k === 'ROUND_INTRO' || k === 'FIGHT' ? fakeMatch(frame, { round: 2 }) : fakeMatch(frame);
    try { r.onEvents([e], snap, f, sink); } catch (err) { bad.push(`${k}: threw ${String(err)}`); continue; }
    const after = Object.values(sink.plays).reduce((a, b) => a + b, 0) + sink.musicCmds.length;
    if (after === before && !silentOk.has(k)) bad.push(`${k}: nothing played`);
    if (r.events[k] !== 1) bad.push(`${k}: handled ${r.events[k] ?? 0}x`);
  }
  // a rollback re-emit of the same event must not double-play
  const dupBefore = sink.plays.hit_h ?? 0;
  r.onEvents([{ frame: 5000, type: EV.HIT, a: 0, b: 1, c: SC.H, d: 100 }, { frame: 5000, type: EV.HIT, a: 0, b: 1, c: SC.H, d: 100 }], fakeMatch(5000), f, sink);
  if ((sink.plays.hit_h ?? 0) - dupBefore !== 1) bad.push(`dedupe: ${(sink.plays.hit_h ?? 0) - dupBefore} hit_h plays for a re-emitted event`);
  // splatter setting swaps the layer
  r.splatter = 'confetti';
  for (let i = 0; i < 20; i++) { r.update(0.2, sink); sink.t += 0.2; }
  r.onEvents([{ frame: 6000, type: EV.WALL_SPLAT, a: 1, b: 1, c: 0, d: 0 }], fakeMatch(6000), f, sink);
  if (!sink.plays.confetti) bad.push('splatter=confetti did not play confetti on WALL_SPLAT');
  if (sink.bad.length) bad.push(...sink.bad.slice(0, 5));
  if (r.unknown.length) bad.push(`unknown: ${r.unknown.join(',')}`);
  const musicSeq = sink.musicCmds.map((c) => (c.t === 'play' ? c.cue : 'stop')).join(' ');
  if (!musicSeq.startsWith('wheel_of_pain')) bad.push(`stage music: ${musicSeq}`);
  check('router: a synthetic event of every EV type plays (silent by design: STAGE_FRIGHT_OFF, CAMERA_CUE), dedupes re-emits, splatter setting', bad.length === 0,
    bad.length ? bad.join(' | ') : `${Object.keys(EV).length} types, ${Object.values(sink.plays).reduce((a, b) => a + b, 0)} plays, music "${musicSeq}", beds ${Object.keys(sink.loopStarts).join('+')}`);
  if (VERBOSE) console.log(`    plays: ${Object.entries(sink.plays).sort().map(([k, v]) => `${k}:${v}`).join(' ')}\n    culled: ${JSON.stringify(r.culled)}`);
}

async function realBout(): Promise<void> {
  let data: GameData | null = null;
  let note = '';
  const dataMod = await import('../runtime/src/core/data.ts');
  try { data = dataMod.loadGameData(); note = 'loadGameData()'; } catch (e) {
    // the full data set is mid-edit by other lanes: build just the two P1 test kits
    try {
      const nfs = process.getBuiltinModule('node:fs') as Parameters<typeof dataMod.readDataDir>[0];
      const raw = dataMod.rawFromFiles(dataMod.readDataDir(nfs, resolve(GAME, 'data')));
      raw.fighters = Object.fromEntries(Object.entries(raw.fighters).filter(([k]) => k === 'johnny' || k === 'bruno'));
      data = dataMod.buildGameData(raw);
      note = `johnny+bruno only (loadGameData threw: ${String((e as Error).message).split('\n')[0].slice(0, 80)})`;
    } catch (e2) {
      check('router: a real sim bout (johnny vs bruno) through the router', false, `SETUP: the sim data does not build: ${String((e2 as Error).message).split('\n').slice(0, 2).join(' / ').slice(0, 300)}`);
      return;
    }
  }
  const sim = await import('../runtime/src/core/sim/match.ts');
  const { inputStream, IN } = await import('../runtime/src/core/net/testinputs.ts');
  const FR = 60 * 150;
  const m = sim.createMatch({ mode: 'versus', stage: 'rust_theater', seed: 11, p: [{ fighter: 'johnny', color: 0, scheme: 0, cpu: -1 }, { fighter: 'bruno', color: 0, scheme: 0, cpu: -1 }] }, data);
  const i1 = inputStream(101, IN.R, FR), i2 = inputStream(202, IN.L, FR);
  const r = new AudioRouter(3);
  const sink = new MockSink();
  r.setBout({ fighters: ['johnny', 'bruno'], stage: 'rust_theater', mode: 'versus', local: 0, sfxNames: m.tab.sfx }, sink);
  const emitted: Record<string, number> = {};
  const seenKeys = new Set<string>();
  const evName: Record<number, string> = {};
  for (const k of Object.keys(EV) as (keyof typeof EV)[]) evName[EV[k]] = k;
  let last = 0;
  const buf: SimEvent[] = [];
  let phases = new Set<string>();
  for (let fr = 0; fr < FR; fr++) {
    sim.step(m, i1[fr], i2[fr]);
    buf.length = 0;
    eventsSince(m.events, last, buf);
    last = m.frame();
    // eventsSince(frame >= last) hands same-frame events over twice (the rollback-style re-emit game.ts dedupes too):
    // count each (frame, type, a, b) once
    for (const e of buf) {
      const key = `${e.frame}|${e.type}|${e.a}|${e.b}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      emitted[evName[e.type] ?? `#${e.type}`] = (emitted[evName[e.type] ?? `#${e.type}`] ?? 0) + 1;
    }
    const ms = sim.readMatch(m);
    phases.add(ms.phase);
    r.onEvents(buf, ms, [sim.readFighter(m, 0), sim.readFighter(m, 1)], sink);
    r.update(1 / 60, sink);
    sink.t += 1 / 60;
    if (ms.phase === 'matchEnd' && ms.frame > 0) break;
  }
  const bad: string[] = [];
  const unhandled = Object.keys(emitted).filter((k) => !(k in r.events) || r.events[k] === 0);
  if (unhandled.length) bad.push(`unhandled ${unhandled.join(',')}`);
  if (sink.bad.length) bad.push(...sink.bad.slice(0, 5));
  if (r.unknown.length) bad.push(`unknown ${r.unknown.join(',')}`);
  if (sink.maxVoices > VOICE_LIMIT) bad.push(`voices ${sink.maxVoices} > ${VOICE_LIMIT}`);
  const musicSeq = sink.musicCmds.map((c) => (c.t === 'play' ? c.cue : 'stop')).join(' ');
  if (!musicSeq.startsWith('rust_theater')) bad.push(`music "${musicSeq}"`);
  if (!sink.plays.bell_round || !sink.plays.ann_fight) bad.push(`round flow: bell ${sink.plays.bell_round ?? 0}, FIGHT ${sink.plays.ann_fight ?? 0}`);
  const hits = (sink.plays.hit_l ?? 0) + (sink.plays.hit_m ?? 0) + (sink.plays.hit_h ?? 0) + (sink.plays.hit_sp ?? 0);
  if ((emitted.HIT ?? 0) > 0 && hits === 0) bad.push('HIT events but no hit sounds');
  const total = Object.values(sink.plays).reduce((a, b) => a + b, 0);
  const report = { data: note, frames: m.frame(), phases: [...phases], emitted, handled: r.events, plays: sink.plays, culled: r.culled, music: musicSeq, maxVoices: sink.maxVoices,
    stolen: sink.pool.stolen, rejected: sink.pool.rejected, loopStarts: sink.loopStarts, unknown: r.unknown };
  try { mkdirSync(resolve(HERE, '_reports'), { recursive: true }); writeFileSync(resolve(HERE, '_reports', 'probe_audio_bout.json'), JSON.stringify(report, null, 1)); } catch { /* reports are optional */ }
  check('router: a real sim bout (johnny vs bruno, scripted inputs) - every emitted type handled, round flow, no NaN, voice limit', bad.length === 0,
    `${bad.length ? bad.join(' | ') + ' || ' : ''}data ${note}; ${m.frame()} frames, phases ${[...phases].join('>')}; emitted ${Object.entries(emitted).map(([k, v]) => `${k}:${v}`).join(' ')}; ${total} plays, peak voices ${sink.maxVoices}/${VOICE_LIMIT} (stolen ${sink.pool.stolen}), music "${musicSeq}"`);
  if (VERBOSE) console.log(`    plays: ${Object.entries(sink.plays).sort().map(([k, v]) => `${k}:${v}`).join(' ')}\n    culled: ${JSON.stringify(r.culled)}`);
}

// ------------------------------------------------------------------------------------------------------- main
try {
  fileChecks();
  if (!FILES_ONLY) {
    mapChecks();
    syntheticRouter();
    await realBout();
  }
} catch (e) {
  console.log(`probe_audio: SETUP FAILURE ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(2);
}
const failed = checks.filter((c) => !c.pass);
console.log(`probe_audio: ${failed.length ? 'FAIL' : 'PASS'} ${checks.length - failed.length}/${checks.length} checks${failed.length ? ` - failed: ${failed.map((c) => c.name.split(':')[0]).join('; ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
