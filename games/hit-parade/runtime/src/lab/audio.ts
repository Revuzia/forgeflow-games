// HIT PARADE - audio lab page (dev only: runtime/lab/audio.html, never linked from index.html, so never in the build).
// Buttons play every sound / cue through the real engine; window.__AUDIO_LAB__ lets a headless driver
// (runtime/src/audio/build/lab_check.py) run the three proofs: decodeAll (every Ogg + AAC decoded by this browser,
// lengths + regions checked), playAll (every sound variant + every cue played through the engine, output metered),
// boutDemo (a synthetic bout through createAudio().events()).

import { AudioEngine } from '../audio/engine.ts';
import { createAudio } from '../audio/index.ts';
import { MUSIC, SAMPLE_RATE, SFX, SPRITES, type MusicCueId, type SfxId, type SpriteId } from '../audio/manifest.ts';
import { AudioRouter, baseGain, type Bus } from '../audio/router.ts';
import { EV, SC } from '../core/sim/events.ts';
import type { FighterSnap, MatchSnap, SimEvent } from '../core/types.ts';

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const log = (s: string): void => { const el = $('log'); el.textContent = `${s}\n${el.textContent ?? ''}`.slice(0, 20000); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const engine = new AudioEngine(28);
const router = new AudioRouter(1);
const variantIdx: Record<string, number> = {};

function busOf(id: SfxId): Bus {
  const c = SFX[id].cat;
  return c === 'ui' ? 'ui' : c === 'voice' || c === 'ann' ? 'voice' : c === 'crowd' || c === 'bed' ? 'crowd' : 'sfx';
}

async function ensureUnlocked(): Promise<void> {
  await engine.unlock();
  engine.preload(['ui', 'sfx', 'crowd']);
  $('status').textContent = `context ${engine.ctx?.state ?? 'none'} @ ${engine.ctx?.sampleRate ?? 0} Hz`;
}

async function waitSprites(ms = 15000): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if ((['ui', 'sfx', 'crowd'] as SpriteId[]).every((s) => engine.hasSprite(s))) return true;
    await sleep(50);
  }
  return false;
}

function playOne(id: SfxId, variant: number): void {
  const e = SFX[id];
  if (e.loop) {
    engine.loop(`lab:${id}`, { id, gain: baseGain(id), rate: 1, bus: busOf(id) });
    setTimeout(() => engine.loop(`lab:${id}`, null), 1500);
    return;
  }
  engine.play({ id, gain: baseGain(id), rate: 1, pan: 0, pri: 5, bus: busOf(id), variant, delay: 0 });
}

// ------------------------------------------------------------------------------------------------------------ proofs
interface DecodeRow { what: string; codec: 'ogg' | 'aac'; ok: boolean; frames: number; want: string; ms: number; error?: string; silentRegions?: number }

/** every asset in both codecs, decoded by THIS browser on an OfflineAudioContext at 48 kHz (no gesture needed) */
async function decodeAll(): Promise<{ rows: DecodeRow[]; errors: number; ok: number }> {
  const off = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  const rows: DecodeRow[] = [];
  const items: Array<{ what: string; url: string; alt: { url: string; samples: number; delay: number }; samples: number; sprite?: SpriteId }> = [];
  for (const s of Object.keys(SPRITES) as SpriteId[]) items.push({ what: `sprite ${s}`, url: SPRITES[s].url, alt: SPRITES[s].alt, samples: SPRITES[s].samples, sprite: s });
  for (const c of Object.keys(MUSIC) as MusicCueId[]) items.push({ what: `music ${c}`, url: MUSIC[c].url, alt: MUSIC[c].alt, samples: MUSIC[c].samples });
  for (const it of items) {
    for (const codec of ['ogg', 'aac'] as const) {
      const url = codec === 'ogg' ? it.url : it.alt.url;
      const t0 = performance.now();
      try {
        const bytes = await (await fetch(url)).arrayBuffer();
        const buf = await off.decodeAudioData(bytes);
        const frames = buf.length;
        let ok: boolean, want: string, lead = 0;
        if (codec === 'ogg') {
          ok = frames === it.samples || frames === it.samples + 312;      // pre-skip honoured (normal) or kept
          lead = frames - it.samples;
          want = `${it.samples}`;
        } else {
          ok = frames === it.alt.samples || frames === it.alt.samples + it.alt.delay;
          lead = frames === it.alt.samples + it.alt.delay ? it.alt.delay : 0;
          want = `${it.alt.samples} or +${it.alt.delay}`;
        }
        const row: DecodeRow = { what: it.what, codec, ok, frames, want, ms: Math.round(performance.now() - t0) };
        if (it.sprite) {
          // every region of this sprite must be audible at the manifest offsets (+ the detected lead)
          const d = buf.getChannelData(0);
          let silent = 0;
          for (const id of Object.keys(SFX) as SfxId[]) {
            const e = SFX[id];
            if (e.sprite !== it.sprite) continue;
            e.v.forEach(([st], i) => {
              const a = Math.round(st * SAMPLE_RATE) + lead, n = e.n[i];
              let sq = 0;
              for (let k = a; k < a + n && k < d.length; k++) sq += d[k] * d[k];
              if (10 * Math.log10(sq / n + 1e-20) < -55) silent++;
            });
          }
          row.silentRegions = silent;
          if (silent) row.ok = false;
        }
        rows.push(row);
      } catch (e) {
        rows.push({ what: it.what, codec, ok: false, frames: 0, want: '', ms: Math.round(performance.now() - t0), error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      }
      const r = rows[rows.length - 1];
      log(`${r.ok ? 'OK ' : 'BAD'} decode ${r.what} ${codec} ${r.frames} frames (want ${r.want}) ${r.ms} ms${r.error ? ' ' + r.error : ''}${r.silentRegions !== undefined ? ` silent regions ${r.silentRegions}` : ''}`);
    }
  }
  return { rows, errors: rows.filter((r) => r.error).length, ok: rows.filter((r) => r.ok).length };
}

/** every sound variant, then every music cue, through the realtime engine; the limiter output is metered per cue */
async function playAll(): Promise<Record<string, unknown>> {
  await ensureUnlocked();
  const ready = await waitSprites();
  const perSound: Record<string, number> = {};
  let n = 0, loops = 0;
  engine.meterRead();
  for (const id of Object.keys(SFX) as SfxId[]) {
    let peak = -120;
    for (let v = 0; v < SFX[id].v.length; v++) {
      playOne(id, v);
      if (SFX[id].loop) loops++; else n++;          // loops run through engine.loop(), not engine.played
      for (let k = 0; k < 4; k++) { await sleep(25); engine.tick(); }
      peak = Math.max(peak, engine.meterRead().peakDb);
    }
    perSound[id] = peak;
  }
  await sleep(3500);                                // let the last crowd one-shots ring out before metering the music
  engine.meterRead();
  const perCue: Record<string, number> = {};
  for (const c of Object.keys(MUSIC) as MusicCueId[]) {
    engine.music({ t: 'play', cue: c, fade: 0.05 });
    const t0 = performance.now();
    while (engine.cue !== c && performance.now() - t0 < 8000) await sleep(40);
    engine.meterRead();
    for (let k = 0; k < 20; k++) { await sleep(40); engine.tick(); }
    perCue[c] = engine.cue === c ? engine.meterRead().peakDb : -999;
  }
  engine.music({ t: 'stop', fade: 0.2 });
  const quiet = Object.entries(perSound).filter(([, p]) => p < -60).map(([k]) => k);
  const quietCues = Object.entries(perCue).filter(([, p]) => p < -40).map(([k]) => k);
  const res = { ready, sampleRate: engine.ctx?.sampleRate, state: engine.ctx?.state, played: engine.played, requested: n, loopsPlayed: loops, notReady: engine.notReady,
    errors: [...engine.errors], codecs: { ...engine.codecs }, quietSounds: quiet, quietCues, perCue, soundsMetered: Object.keys(perSound).length };
  log(`playAll: ${JSON.stringify(res).slice(0, 600)}`);
  return res;
}

function fighter(x: number, over: Partial<FighterSnap> = {}): FighterSnap {
  return {
    x, y: 0, facing: 1, state: 0, stateName: 'idle', moveId: -1, moveName: '', moveKind: '', moveFrame: 0, animId: 0, animFrame: 0, prevAnimId: -1,
    prevAnimFrame: 0, blendT: 1, animSec: 0, hp: 10000, hpMax: 10000, greyHp: 0, showtime: 0, nerve: 60000, stageFright: false, combo: 0,
    comboDamage: 0, lastDamage: 0, hitstop: 0, stun: 0, airborne: false, crouching: false,
    flags: { invuln: false, armor: false, counter: false, stance: 0, taunting: false, ko: false }, unique: [0, 0, 0, 0], ...over,
  };
}

/** a synthetic bout through the public API (createAudio): intro, FIGHT, exchanges, a wall splat, a super, a KO */
async function boutDemo(): Promise<Record<string, unknown>> {
  const audio = createAudio();
  await audio.unlock();
  audio.bout({ fighters: ['johnny', 'bruno'], stage: 'rust_theater', mode: 'versus', local: 0, sfxNames: ['whoosh_heavy', 'fire_whoosh'] });
  audio.preload();
  let frame = 0;
  const snap = (over: Partial<MatchSnap>): MatchSnap => ({ frame, phase: 'fight', phaseFrame: 0, round: 1, timer: 99, wins: [0, 0],
    cinematic: { active: false, fighter: -1, cueId: -1, frame: 0, frames: 0 }, winner: -1, draw: false, roundWinner: -1, slowmo: false, freeze: 0, ...over });
  let show = 0;
  const f = (): [FighterSnap, FighterSnap] => [fighter(-1.0, { showtime: show }), fighter(1.1, { hp: 6000 })];
  const script: Array<[number, Partial<MatchSnap>, SimEvent[]]> = [];
  const ev = (type: number, a: number, b: number, c = 0): SimEvent => ({ frame: 0, type, a, b, c, d: 120 });
  script.push([0, { phase: 'intro' }, []]);
  script.push([100, { phase: 'fight' }, []]);
  for (let k = 0; k < 8; k++) script.push([140 + k * 20, {}, [ev(EV.HIT, k % 2, 1 - (k % 2), [SC.L, SC.M, SC.H, SC.L][k % 4])]]);
  script.push([320, {}, [ev(EV.BLOCK, 1, 0, SC.H)]]);
  script.push([360, {}, [ev(EV.THROW, 0, 1)]]);
  script.push([390, {}, [ev(EV.HIT, 0, 1, SC.THROW)]]);
  script.push([450, {}, [ev(EV.WALL_SPLAT, 1, 1)]]);
  script.push([520, {}, [ev(EV.METER_BAR, 0, 3)]]);
  script.push([560, {}, [ev(EV.SUPER_FREEZE, 0, 3), ev(EV.CINEMATIC_START, 0, 5)]]);
  script.push([700, {}, [ev(EV.SUPER_HIT, 0, 1, SC.SUPER), ev(EV.HIT, 0, 1, SC.SUPER)]]);
  script.push([760, { phase: 'ko' }, [ev(EV.KO, 0, 1, 1)]]);
  script.push([900, { phase: 'roundEnd', roundWinner: 0 }, []]);
  script.push([1000, { phase: 'matchEnd', winner: 0 }, []]);
  let si = 0;
  for (frame = 0; frame <= 1060; frame++) {
    show = Math.min(30000, frame * 40);
    const evs: SimEvent[] = [];
    let over: Partial<MatchSnap> = {};
    while (si < script.length && script[si][0] === frame) { over = { ...over, ...script[si][1] }; for (const e of script[si][2]) evs.push({ ...e, frame }); si++; }
    audio.events(evs, snap(over), f());
    await sleep(1000 / 60);
  }
  const st = audio.stats();
  audio.bout(null);
  log(`boutDemo: played ${st.played}, errors ${st.errors.length}, unknown ${st.unknown.join(',')}, cue ${st.cue}`);
  return st as unknown as Record<string, unknown>;
}

// ----------------------------------------------------------------------------------------------------------- page
function build(): void {
  for (const c of Object.keys(MUSIC) as MusicCueId[]) {
    const b = document.createElement('button');
    b.textContent = `${c} (${MUSIC[c].track}${MUSIC[c].loop ? `, ${MUSIC[c].bars} bars` : ', sting'})`;
    b.onclick = async () => { await ensureUnlocked(); engine.music({ t: 'play', cue: c, fade: 0.4 }); log(`music ${c}`); };
    $('music').appendChild(b);
  }
  for (const u of ['move', 'confirm', 'back', 'error', 'toggle', 'start', 'lock', 'vs', 'pause', 'resume', 'tick', 'cash', 'unlock', 'ladder']) {
    const b = document.createElement('button');
    b.textContent = u;
    b.onclick = async () => { await ensureUnlocked(); router.ui(u, engine); };
    $('ui').appendChild(b);
  }
  for (const a of ['3', '2', '1', 'go', 'ready', 'fight', 'bonus', 'begin', 'gameover', 'victory', 'win', 'lose'] as const) {
    const b = document.createElement('button');
    b.textContent = a;
    b.onclick = async () => { await ensureUnlocked(); router.announce(a, engine); };
    $('announce').appendChild(b);
  }
  for (const id of Object.keys(SFX) as SfxId[]) {
    const b = document.createElement('button');
    b.textContent = `${id}${SFX[id].v.length > 1 ? ` x${SFX[id].v.length}` : ''}`;
    b.title = `${SFX[id].sprite} / ${SFX[id].cat}`;
    b.onclick = async () => {
      await ensureUnlocked();
      await waitSprites(8000);
      const v = variantIdx[id] = ((variantIdx[id] ?? -1) + 1) % SFX[id].v.length;
      playOne(id, v);
    };
    $('sfx').appendChild(b);
  }
  // results land in __AUDIO_LAB__.results (a headless driver clicks the buttons: a click is a user activation, an evaluate is not)
  const run = (key: string, fn: () => Promise<unknown>) => async (): Promise<void> => {
    lab.results[key] = { running: true };
    try { lab.results[key] = { done: true, value: await fn() }; } catch (e) { lab.results[key] = { done: true, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
  };
  $('b-decode').onclick = run('decode', decodeAll);
  $('b-playall').onclick = run('playAll', playAll);
  $('b-bout').onclick = run('bout', boutDemo);
  $('b-stop').onclick = () => engine.music({ t: 'stop', fade: 0.5 });
}

const lab = { decodeAll, playAll, boutDemo, engine, ready: true, results: {} as Record<string, unknown> };
build();
(window as unknown as { __AUDIO_LAB__: unknown }).__AUDIO_LAB__ = lab;
log('lab ready');
