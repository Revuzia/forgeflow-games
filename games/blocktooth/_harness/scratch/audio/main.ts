// Audio lane scratch verification: renders EVERY sfx case and 8 s of every music track through an
// OfflineAudioContext using the real AudioEngine master chain, the real Sfx.onEvents bridge fed with
// SimEvents built against a REAL World (createWorld + stepN, real telegraphs, real bosses), and the
// real Music look-ahead scheduler (pumped from OfflineAudioContext.suspend()).
// Reports peak / RMS / NaN / clip fraction / tail / spectral centroid per sound in
// window.__AUDIO_REPORT__ and draws every waveform.
import { createWorld, stepN } from '../../../src/core/world.ts';
import { RANKS } from '../../../src/core/config.ts';
import { spawnTelegraph } from '../../../src/combat/telegraphs.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { AudioEngine, MAX_VOICES } from '../../../src/audio/audio.ts';
import { Sfx } from '../../../src/audio/sfx.ts';
import type { UiSound } from '../../../src/audio/sfx.ts';
import { Music } from '../../../src/audio/music.ts';
import type { MusicTrack } from '../../../src/audio/music.ts';
import type {
  BossId, EnemyKind, PropKind, RankIndex, SimEvent, TelegraphStyle, TitanId, World,
} from '../../../src/core/types.ts';

const SR = 44100;

interface Row { name: string; peak: number; rms: number; nan: number; clip: number; tail: number; centroid: number; ok: boolean; group: string; }

// ─────────────────────────────── analysis ───────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function analyze(buf: AudioBuffer): Omit<Row, 'name' | 'ok' | 'group'> & { mono: Float32Array } {
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  const mono = new Float32Array(n);
  let peak = 0, sum = 0, nan = 0, clip = 0;
  for (let i = 0; i < n; i++) {
    const a = L[i], b = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) { nan++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    if (m > 0.95) clip++;
    sum += (a * a + b * b) / 2;
    mono[i] = (a + b) / 2;
  }
  // RMS over the audible span (first → last sample above −50 dB of peak), so long tails don't dilute it
  const thr = peak * 0.00316;
  let first = 0, last = 0;
  for (let i = 0; i < n; i++) if (Math.abs(mono[i]) > thr) { first = i; break; }
  for (let i = n - 1; i >= 0; i--) if (Math.abs(mono[i]) > thr) { last = i; break; }
  let s2 = 0;
  for (let i = first; i <= last; i++) s2 += mono[i] * mono[i];
  const rms = last > first ? Math.sqrt(s2 / (last - first + 1)) : Math.sqrt(sum / Math.max(1, n));
  // spectral centroid: magnitude-weighted over up to 8 windows of 4096 across the audible span
  const N = 4096;
  let num = 0, den = 0;
  const span = Math.max(1, last - first);
  const wins = Math.max(1, Math.min(8, Math.floor(span / N)));
  for (let wv = 0; wv < wins; wv++) {
    const off = first + Math.floor((span - N) * (wins === 1 ? 0 : wv / (wins - 1)));
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const idx = off + i;
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = idx >= 0 && idx < n ? mono[idx] * hann : 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      num += mag * mag * (k * SR / N); den += mag * mag;
    }
  }
  return { peak, rms, nan, clip: clip / n, tail: last / SR, centroid: den > 0 ? num / den : 0, mono };
}

function draw(parent: HTMLElement, name: string, mono: Float32Array, r: Row, wide = false): void {
  const d = document.createElement('div');
  d.className = 't' + (r.ok ? '' : ' bad');
  const c = document.createElement('canvas');
  const W = wide ? 680 : 332, Hh = wide ? 88 : 88;
  c.width = W; c.height = Hh;
  if (wide) { c.style.width = '338px'; c.style.height = '44px'; }
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0b14'; g.fillRect(0, 0, W, Hh);
  g.strokeStyle = '#2a2438'; g.beginPath(); g.moveTo(0, Hh / 2); g.lineTo(W, Hh / 2); g.stroke();
  g.fillStyle = r.ok ? '#3fae7f' : '#ff4f6a';
  const per = Math.max(1, Math.floor(mono.length / W));
  for (let x = 0; x < W; x++) {
    let lo = 0, hi = 0;
    for (let i = x * per; i < Math.min(mono.length, (x + 1) * per); i++) { const v = mono[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y0 = Hh / 2 - hi * Hh / 2, y1 = Hh / 2 - lo * Hh / 2;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  d.appendChild(c);
  const nm = document.createElement('div'); nm.className = 'n'; nm.textContent = name; d.appendChild(nm);
  const m = document.createElement('div'); m.className = 'm';
  m.textContent = `pk ${r.peak.toFixed(2)} rms ${r.rms.toFixed(3)} ${Math.round(r.centroid)}Hz`;
  d.appendChild(m);
  parent.appendChild(d);
}

// ─────────────────────────────── world + cases ───────────────────────────────

const world: World = createWorld({ titan: 'molo', biome: 'grideast', seed: 11 });
stepN(world, 90);
const T = world.titan;
const cx = T.x, cz = T.z;

function setTitan(id: TitanId, rank: RankIndex): void {
  world.titanId = id;
  T.id = id;
  T.rank = rank;
  T.height = RANKS[rank].height;
  T.radius = T.height * 0.42;
}

interface Case { name: string; group: string; dur: number; titan?: TitanId; rank?: RankIndex; boss?: BossId; ev?: () => SimEvent[]; ui?: UiSound; }
const cases: Case[] = [];
const add = (c: Case) => cases.push(c);
const at = (dx = 0, dz = 0) => ({ x: cx + dx, z: cz + dz });

// footsteps by rank (pitched by 1/height) + per titan colour
for (let r = 0; r < 5; r++) add({ name: `footstep Size ${RANKS[r].name}`, group: 'body', dur: 2, titan: 'molo', rank: r as RankIndex, ev: () => [{ type: 'footstep', ...at(), heavy: r / 4 }] });
for (const id of ['voltkite', 'hearthback', 'briarwick'] as TitanId[]) add({ name: `footstep II ${id}`, group: 'body', dur: 1.5, titan: id, rank: 1, ev: () => [{ type: 'footstep', ...at(), heavy: 0.25 }] });
// props
const PROPS: PropKind[] = ['car', 'taxi', 'van', 'bus', 'truck', 'kiosk', 'hydrant', 'lamp', 'tree', 'bench', 'vending', 'signpost', 'barrier', 'drum', 'forklift', 'container', 'bollard', 'boat', 'pylon', 'snowbank'];
for (const k of PROPS) add({ name: `prop ${k}`, group: 'city', dur: 1.4, rank: 0, ev: () => [{ type: 'propDestroyed', id: 1, kind: k, ...at(2, 1), crushed: true }] });
for (let tr = 0; tr < 5; tr++) {
  add({ name: `floorBreak tier ${tr}`, group: 'city', dur: 1.6, rank: tr as RankIndex, ev: () => [{ type: 'floorBreak', id: 1, remaining: 3, ...at(3, 0), tier: tr as 0 }] });
  add({ name: `collapse tier ${tr}`, group: 'city', dur: 4.8, rank: tr as RankIndex, ev: () => [{ type: 'buildingCollapse', id: 1, ...at(3, 0), tier: tr as 0, w: 20, d: 20, h: 12 + tr * 25 }] });
}
add({ name: 'smash', group: 'city', dur: 0.6, ev: () => [{ type: 'smash', ...at(), tier: 0 }] });
add({ name: 'bump (too big)', group: 'city', dur: 0.8, ev: () => [{ type: 'bump', ...at(), tier: 2 }] });
// kit attacks + hooks
const ATK: [TitanId, string][] = [['molo', 'curbBite'], ['voltkite', 'forkArc'], ['hearthback', 'magmaStomp'], ['briarwick', 'vineLash']];
for (const [id, a] of ATK) add({ name: `attack ${a}`, group: 'kit', dur: 1, titan: id, rank: 1, ev: () => [{ type: 'titanAttack', attack: a, ...at(1, 1), dir: 0, r: 4, hits: 2 }] });
add({ name: 'arc (upgrade zap)', group: 'kit', dur: 0.8, ev: () => [{ type: 'arc', pts: [cx, cz, cx + 4, cz + 2], kind: 'upgrade' }] });
add({ name: 'pulse (MOLO)', group: 'kit', dur: 1, titan: 'molo', ev: () => [{ type: 'pulse', ...at(), r: 5 }] });
add({ name: 'dash', group: 'kit', dur: 1, titan: 'molo', rank: 1, ev: () => [{ type: 'dash', x0: cx - 6, z0: cz + 6, x1: cx + 6, z1: cz - 6 }] });
add({ name: 'dash voltkite', group: 'kit', dur: 1, titan: 'voltkite', rank: 1, ev: () => [{ type: 'dash', x0: cx - 6, z0: cz + 6, x1: cx + 6, z1: cz - 6 }] });
for (const id of ['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) add({ name: `hook ${id}`, group: 'kit', dur: 2.6, titan: id, rank: 2, ev: () => [{ type: 'ability', titan: id, ...at(), power: 1 }] });
add({ name: 'wireDetonate x4', group: 'kit', dur: 1, titan: 'voltkite', ev: () => [{ type: 'wireDetonate', pts: [cx, cz, cx + 5, cz, cx, cz + 3, cx + 5, cz + 3, cx - 3, cz, cx - 3, cz + 6, cx + 2, cz - 2, cx + 6, cz - 2] }] });
add({ name: 'vent hiss', group: 'kit', dur: 1.6, titan: 'hearthback', ev: () => [{ type: 'vent', ...at(), r: 8, power: 0.8 }] });
add({ name: 'bloomSpawn', group: 'kit', dur: 0.8, titan: 'briarwick', ev: () => [{ type: 'bloomSpawn', id: 3, ...at(2, 2) }] });
add({ name: 'spore', group: 'kit', dur: 1.2, titan: 'briarwick', ev: () => [{ type: 'spore', ...at(), r: 5 }] });
// enemies
const KINDS: EnemyKind[] = ['android', 'squad', 'drone', 'buggy', 'apc', 'tank', 'walker', 'elite'];
for (const k of KINDS) add({ name: `fire ${k}`, group: 'enemy', dur: 1.8, rank: 1, ev: () => [{ type: 'enemyFire', id: 5, kind: k, ...at(8, -4), tx: cx, tz: cz }] });
for (const k of KINDS) add({ name: `killed ${k}`, group: 'enemy', dur: 2.2, rank: 1, ev: () => [{ type: 'enemyKilled', id: 5, kind: k, ...at(5, 0), crushed: false }] });
add({ name: 'crushed (clank-boing)', group: 'enemy', dur: 0.9, rank: 1, ev: () => [{ type: 'enemyKilled', id: 5, kind: 'android', ...at(), crushed: true }] });
add({ name: 'enemyHit', group: 'enemy', dur: 0.5, ev: () => [{ type: 'enemyHit', id: 5, ...at(3, 0), dmg: 5, crit: false }] });
add({ name: 'enemyHit crit', group: 'enemy', dur: 0.5, ev: () => [{ type: 'enemyHit', id: 5, ...at(3, 0), dmg: 9, crit: true }] });
// titan hurt / heal / progression
const HURT: [TitanId, string, number][] = [['molo', 'shell', 0.2], ['voltkite', 'bullet', 0.03], ['hearthback', 'rocket', 0.1], ['briarwick', 'breath', 0.06]];
for (const [id, src, f] of HURT) add({ name: `hurt ${id} (${src})`, group: 'titan', dur: 1.2, titan: id, rank: 1, ev: () => [{ type: 'titanHurt', dmg: T.maxHp * f, ...at(), src: src as 'shell' }] });
add({ name: 'hurt DoT nibble', group: 'titan', dur: 0.5, ev: () => [{ type: 'titanHurt', dmg: T.maxHp * 0.002, ...at(), src: 'magma' }] });
add({ name: 'titanHeal', group: 'titan', dur: 1, ev: () => [{ type: 'titanHeal', amount: T.maxHp * 0.1 }] });
add({ name: 'pickup rubble x1', group: 'titan', dur: 0.4, ev: () => [{ type: 'pickup', kind: 'rubble', xp: 1, ...at(1, 0) }] });
add({ name: 'pickup combo x40 (scrap)', group: 'titan', dur: 0.4, ev: () => Array.from({ length: 40 }, () => ({ type: 'pickup' as const, kind: 'scrap' as const, xp: 1, ...at(1, 0) })) });
add({ name: 'pickup heal', group: 'titan', dur: 1, ev: () => [{ type: 'pickup', kind: 'heal', xp: 0, ...at(1, 0) }] });
add({ name: 'pickup chest', group: 'titan', dur: 1.6, ev: () => [{ type: 'pickup', kind: 'chest', xp: 0, ...at(1, 0) }] });
add({ name: 'levelUp chime', group: 'titan', dur: 1.8, ev: () => [{ type: 'levelUp', level: 5 }] });
for (let r = 1; r < 5; r++) add({ name: `MASS BREACH -> ${RANKS[r].name} (molo)`, group: 'titan', dur: 4.5, titan: 'molo', rank: r as RankIndex, ev: () => [{ type: 'rankUp', rank: r as RankIndex }] });
for (const id of ['voltkite', 'hearthback', 'briarwick'] as TitanId[]) add({ name: `MASS BREACH -> II (${id})`, group: 'titan', dur: 3.5, titan: id, rank: 1, ev: () => [{ type: 'rankUp', rank: 1 }] });
// telegraphs (real telegraph records for position/kind lookups)
const STYLES: TelegraphStyle[] = ['circle', 'cone', 'lane', 'ring', 'oval', 'chain'];
for (const st of STYLES) add({ name: `warn ${st}`, group: 'tell', dur: 0.8, ev: () => {
  const tg = spawnTelegraph(world, { owner: 'enemy', style: st, shape: { k: 'circle', x: cx + 4, z: cz, r: 3 }, windup: 1, dmg: 1, kind: 'shell' });
  return [{ type: 'telegraphStart', id: tg.id, owner: 'enemy', style: st }];
} });
add({ name: 'warn ring (boss)', group: 'tell', dur: 1.2, boss: 'caisson4', ev: () => {
  const tg = spawnTelegraph(world, { owner: 'boss', style: 'ring', shape: { k: 'ring', x: cx, z: cz, r0: 0, r1: 50 }, windup: 1.2, dmg: 1, kind: 'slam' });
  return [{ type: 'telegraphStart', id: tg.id, owner: 'boss', style: 'ring' }];
} });
const IMPACTS: [string, 'enemy' | 'boss', string][] = [['shell', 'enemy', 'lane'], ['dive', 'enemy', 'circle'], ['hook', 'boss', 'circle'], ['breath', 'boss', 'cone'], ['slam', 'boss', 'ring'], ['ram', 'enemy', 'lane']];
for (const [kind, owner, style] of IMPACTS) add({ name: `tell lands ${kind}`, group: 'tell', dur: 2, ev: () => {
  const tg = spawnTelegraph(world, { owner, style: style as TelegraphStyle, shape: { k: 'circle', x: cx + 3, z: cz, r: 6 }, windup: 1, dmg: 1, kind: kind as 'shell' });
  return [{ type: 'telegraphFire', id: tg.id, owner, hit: true, x: cx + 3, z: cz }];
} });
for (const k of ['pellet', 'seed', 'spark', 'rubbleShot'] as const) add({ name: `projectileHit ${k}`, group: 'tell', dur: 0.6, ev: () => [{ type: 'projectileHit', ...at(2, 0), kind: k }] });
for (const k of ['stomp', 'arc', 'shockwave', 'plate', 'rocket', 'mortar', 'shell', 'seed'] as const) add({ name: `explosion ${k}`, group: 'tell', dur: 2.2, rank: 1, ev: () => [{ type: 'explosion', ...at(3, 0), r: 6, kind: k }] });
// broadcast
for (const k of ['contractors', 'elite', 'boss', 'bossPhase2', 'bossPhase3', 'lowHp', 'chest'] as const) add({ name: `alert ${k}`, group: 'news', dur: k === 'boss' ? 4.2 : 2.2, ev: () => [{ type: 'alert', key: k }] });
add({ name: 'eliteSpawn horn', group: 'news', dur: 2, ev: () => [{ type: 'eliteSpawn', id: 9 }] });
add({ name: 'chest drop', group: 'news', dur: 1.6, ev: () => [{ type: 'chest', ...at(2, 2) }] });
add({ name: 'bossSpawn siren', group: 'news', dur: 4.2, ev: () => [{ type: 'bossSpawn', boss: 'caisson4' }] });
add({ name: 'bossPhase 3 sting', group: 'news', dur: 2.2, ev: () => [{ type: 'bossPhase', phase: 3 }] });
// boss
const BATK: [BossId, string][] = [['caisson4', 'hookLane'], ['caisson4', 'hookDrop'], ['caisson4', 'winchLeash'], ['caisson4', 'boomSweep'], ['caisson4', 'legStomp'],
  ['irongully', 'coneBreath'], ['irongully', 'pawSlam'], ['irongully', 'plateVolley'], ['irongully', 'ridgeCharge'], ['irongully', 'breathSlam']];
for (const [b, a] of BATK) add({ name: `boss ${a}`, group: 'boss', dur: 2.2, boss: b, rank: 4, ev: () => [{ type: 'bossAttack', attack: a, ...at(40, 40) }] });
add({ name: 'bossHit caisson leg', group: 'boss', dur: 0.8, boss: 'caisson4', rank: 4, ev: () => [{ type: 'bossHit', part: 'legFL', dmg: 900, ...at(20, 20) }] });
add({ name: 'bossHit irongully sail', group: 'boss', dur: 0.8, boss: 'irongully', rank: 4, ev: () => [{ type: 'bossHit', part: 'sail', dmg: 900, ...at(20, 20) }] });
add({ name: 'stagger caisson (groan)', group: 'boss', dur: 2.6, boss: 'caisson4', ev: () => [{ type: 'bossStagger' }] });
add({ name: 'stagger irongully (groan)', group: 'boss', dur: 2.6, boss: 'irongully', ev: () => [{ type: 'bossStagger' }] });
add({ name: 'bossDefeated caisson', group: 'boss', dur: 5, boss: 'caisson4', rank: 4, ev: () => [{ type: 'bossDefeated', ...at(30, 30) }] });
add({ name: 'bossDefeated irongully', group: 'boss', dur: 5, boss: 'irongully', rank: 4, ev: () => [{ type: 'bossDefeated', ...at(30, 30) }] });
add({ name: 'leash on', group: 'boss', dur: 1, ev: () => [{ type: 'leash', on: true, ...at(20, 0) }] });
add({ name: 'leash off', group: 'boss', dur: 1, ev: () => [{ type: 'leash', on: false, ...at(20, 0) }] });
add({ name: 'upgradeProc', group: 'boss', dur: 0.6, ev: () => [{ type: 'upgradeProc', id: 'x', ...at() }] });
add({ name: 'runEnd clear', group: 'news', dur: 3, ev: () => [{ type: 'runEnd', result: 'clear' }] });
add({ name: 'runEnd dead', group: 'news', dur: 3, ev: () => [{ type: 'runEnd', result: 'dead' }] });
for (const u of ['move', 'confirm', 'back', 'draft', 'pick', 'slate', 'print'] as UiSound[]) add({ name: `ui ${u}`, group: 'ui', dur: u === 'print' || u === 'slate' ? 2 : 1.3, ui: u });

// ─────────────────────────────── run ───────────────────────────────

const bossCache: Partial<Record<BossId, World['boss']>> = {};
function useBoss(id: BossId | undefined): void {
  if (!id) { world.boss = null; return; }
  if (!bossCache[id]) { world.boss = null; spawnBoss(world, id); bossCache[id] = world.boss; }
  world.boss = bossCache[id] ?? null;
}

async function renderCase(c: Case): Promise<{ row: Row; mono: Float32Array }> {
  setTitan(c.titan ?? 'molo', c.rank ?? 0);
  useBoss(c.boss);
  const off = new OfflineAudioContext(2, Math.ceil(c.dur * SR), SR);
  const eng = new AudioEngine({ context: off });
  eng.setVolumes(1, 1, 1);
  const sfx = new Sfx(eng);
  if (c.ui) sfx.ui(c.ui);
  else if (c.ev) sfx.onEvents(world, c.ev(), cx, cz);
  const buf = await off.startRendering();
  const a = analyze(buf);
  const ok = a.nan === 0 && a.peak > 0.01 && a.peak <= 1.0 && a.rms > 0.001;
  return { row: { name: c.name, group: c.group, peak: a.peak, rms: a.rms, nan: a.nan, clip: a.clip, tail: a.tail, centroid: a.centroid, ok }, mono: a.mono };
}

async function renderMusic(track: MusicTrack, secs: number, intensity: number, switchTo?: { t: number; track: MusicTrack }): Promise<{ row: Row; mono: Float32Array }> {
  const off = new OfflineAudioContext(2, Math.ceil(secs * SR), SR);
  const eng = new AudioEngine({ context: off });
  eng.setVolumes(1, 1, 1);
  const m = new Music(eng);
  m.setIntensity(intensity);
  m.play(track);
  for (let t = 0.025; t < secs; t += 0.025) {
    const tt = t;
    off.suspend(tt).then(() => {
      if (switchTo && Math.abs(tt - switchTo.t) < 0.0126) m.play(switchTo.track);
      m.pump();
      off.resume();
    }).catch(() => { /* ignore */ });
  }
  const buf = await off.startRendering();
  const a = analyze(buf);
  const ok = a.nan === 0 && a.peak > 0.02 && a.peak <= 1.0 && a.rms > 0.01;
  const name = switchTo ? `${track} -> ${switchTo.track} @${switchTo.t}s` : `${track} (I=${intensity})`;
  return { row: { name, group: 'music', peak: a.peak, rms: a.rms, nan: a.nan, clip: a.clip, tail: a.tail, centroid: a.centroid, ok }, mono: a.mono };
}

/** Voice limiter under load: 31 frames × a fat batch of mixed events, advancing real time. */
async function stress(): Promise<{ maxVoices: number; frames: number; nan: number; peak: number }> {
  setTitan('molo', 4); useBoss(undefined);
  const secs = 1.6;
  const off = new OfflineAudioContext(2, Math.ceil(secs * SR), SR);
  const eng = new AudioEngine({ context: off });
  eng.setVolumes(1, 1, 1);
  const sfx = new Sfx(eng);
  let maxVoices = 0, frames = 0;
  const batch = (): SimEvent[] => {
    const ev: SimEvent[] = [];
    for (let i = 0; i < 40; i++) ev.push({ type: 'floorBreak', id: i, remaining: 2, x: cx + i, z: cz, tier: 3 });
    for (let i = 0; i < 20; i++) ev.push({ type: 'propDestroyed', id: i, kind: 'car', x: cx - i, z: cz, crushed: true });
    for (let i = 0; i < 10; i++) ev.push({ type: 'buildingCollapse', id: i, x: cx, z: cz + i, tier: 3, w: 20, d: 20, h: 60 });
    for (let i = 0; i < 30; i++) ev.push({ type: 'enemyFire', id: i, kind: i % 2 ? 'tank' : 'android', x: cx + 10, z: cz, tx: cx, tz: cz });
    for (let i = 0; i < 30; i++) ev.push({ type: 'pickup', kind: 'rubble', xp: 1, x: cx, z: cz });
    ev.push({ type: 'footstep', x: cx, z: cz, heavy: 1 });
    ev.push({ type: 'titanAttack', attack: 'curbBite', x: cx, z: cz, dir: 0, r: 30, hits: 9 });
    return ev;
  };
  for (let k = 0; k < 30; k++) {
    const tt = 0.01 + k * (1 / 60);
    off.suspend(tt).then(() => {
      sfx.onEvents(world, batch(), cx, cz);
      frames++;
      maxVoices = Math.max(maxVoices, sfx.activeVoices);
      off.resume();
    }).catch(() => { /* ignore */ });
  }
  const buf = await off.startRendering();
  const a = analyze(buf);
  return { maxVoices, frames, nan: a.nan, peak: a.peak };
}

/** Pickup combo ladder: 14 single pickups 70 ms apart in one context; dominant pitch of each tick. */
async function comboLadder(): Promise<number[]> {
  setTitan('molo', 0); useBoss(undefined);
  const off = new OfflineAudioContext(2, Math.ceil(1.4 * SR), SR);
  const eng = new AudioEngine({ context: off });
  eng.setVolumes(1, 1, 1);
  const sfx = new Sfx(eng);
  const times: number[] = [];
  for (let k = 0; k < 14; k++) {
    const tt = 0.02 + k * 0.07;
    off.suspend(tt).then(() => { times.push(off.currentTime); sfx.onEvents(world, [{ type: 'pickup', kind: 'rubble', xp: 1, x: cx, z: cz }], cx, cz); off.resume(); }).catch(() => { /* ignore */ });
  }
  const buf = await off.startRendering();
  const mono = buf.getChannelData(0);
  const out: number[] = [];
  for (const t0 of times) {
    const N = 2048, a = Math.floor((t0 + 0.006) * SR);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (mono[a + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    let bk = 0, bm = 0;
    for (let k = 8; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); if (m > bm) { bm = m; bk = k; } }
    out.push(Math.round(bk * SR / N));
  }
  return out;
}

/** One car crunch rendered at an offset from the camera target: returns [peak, rmsL, rmsR]. */
async function placed(dx: number, dz: number): Promise<[number, number, number]> {
  setTitan('molo', 0); useBoss(undefined);
  const off = new OfflineAudioContext(2, Math.ceil(1.2 * SR), SR);
  const eng = new AudioEngine({ context: off });
  eng.setVolumes(1, 1, 1);
  const sfx = new Sfx(eng);
  sfx.onEvents(world, [{ type: 'propDestroyed', id: 1, kind: 'car', x: cx + dx, z: cz + dz, crushed: true }], cx, cz);
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let pk = 0, sl = 0, sr = 0;
  for (let i = 0; i < L.length; i++) { pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); sl += L[i] * L[i]; sr += R[i] * R[i]; }
  return [pk, Math.sqrt(sl / L.length), Math.sqrt(sr / R.length)];
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const num = (v: number, d: number, n: number) => { const s = v.toFixed(d); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };

async function main(): Promise<void> {
  const head = document.getElementById('head')!;
  const grid = document.getElementById('grid')!;
  const grid2 = document.getElementById('grid2')!;
  const rows: Row[] = [];
  const t0 = performance.now();
  for (const c of cases) {
    try {
      const { row, mono } = await renderCase(c);
      rows.push(row); draw(grid, c.name, mono, row);
    } catch (e) {
      const row: Row = { name: c.name + ' THREW ' + String(e), group: c.group, peak: 0, rms: 0, nan: -1, clip: 0, tail: 0, centroid: 0, ok: false };
      rows.push(row);
    }
    head.textContent = `rendering sfx ${rows.length}/${cases.length}…`;
  }
  const mrows: Row[] = [];
  const tracks: MusicTrack[] = ['title', 'select', 'grideast', 'whitestacks', 'lockwater', 'boss', 'tabloid'];
  for (const tr of tracks) {
    const { row, mono } = await renderMusic(tr, 8, 1);
    mrows.push(row); draw(grid2, row.name, mono, row, true);
    head.textContent = `rendering music ${mrows.length}/${tracks.length + 3}…`;
  }
  const low = await renderMusic('grideast', 8, 0.05);
  mrows.push(low.row); draw(grid2, low.row.name, low.mono, low.row, true);
  const xf = await renderMusic('grideast', 8, 1, { t: 3, track: 'boss' });
  mrows.push(xf.row); draw(grid2, xf.row.name, xf.mono, xf.row, true);
  const ts = await renderMusic('title', 8, 1, { t: 3, track: 'select' });
  mrows.push(ts.row); draw(grid2, ts.row.name, ts.mono, ts.row, true);
  const st = await stress();
  const ladder = await comboLadder();
  const d0 = await placed(0, 0), d1 = await placed(4.7, 4.7), d3 = await placed(14, 14), d6 = await placed(28, 28);
  const pr = await placed(5, -5), pl = await placed(-5, 5);

  const all = rows.concat(mrows);
  const bad = all.filter((r) => !r.ok);
  const maxPeak = Math.max(...all.map((r) => r.peak));
  const lines: string[] = [];
  lines.push(`AUDIO REPORT — ${rows.length} sfx + ${mrows.length} music renders in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  lines.push(`checks: non-silent+finite+peak<=1: ${all.length - bad.length}/${all.length} OK · max peak ${maxPeak.toFixed(3)} · NaN renders ${all.filter((r) => r.nan !== 0).length}`);
  lines.push(`voice limiter stress: ${st.frames} frames x 132 events → max live voices ${st.maxVoices} (cap ${MAX_VOICES}) · nan ${st.nan} · peak ${st.peak.toFixed(3)}`);
  lines.push(`layering: grideast RMS @I=1 ${mrows[2].rms.toFixed(3)} vs @I=0.05 ${low.row.rms.toFixed(3)}`);
  lines.push(`pickup combo ladder (dominant Hz per tick, 70 ms apart): ${ladder.join(' ')}`);
  lines.push(`distance (car crunch peak; ref radius 6.6 m at Size I): 0 m ${d0[0].toFixed(3)} · 6.6 m ${d1[0].toFixed(3)} · 19.8 m ${d3[0].toFixed(3)} · 39.6 m ${d6[0].toFixed(3)}`);
  lines.push(`pan (screen-right event L/R rms): ${pr[1].toFixed(4)}/${pr[2].toFixed(4)} · screen-left: ${pl[1].toFixed(4)}/${pl[2].toFixed(4)}`);
  lines.push(pad('sound', 34) + ' group   peak    rms  nan  clip%  tail_s  centroidHz(power)');
  for (const r of all) {
    lines.push(`${pad(r.name, 34)} ${pad(r.group, 6)} ${num(r.peak, 3, 6)} ${num(r.rms, 4, 6)} ${num(r.nan, 0, 4)} ${num(r.clip * 100, 2, 6)} ${num(r.tail, 2, 7)} ${num(r.centroid, 0, 10)}${r.ok ? '' : '  <-- FAIL'}`);
  }
  const table = lines.join('\n');
  head.textContent = lines.slice(0, 7).join('\n');
  (window as unknown as Record<string, unknown>).__AUDIO_REPORT__ = {
    ok: bad.length === 0 && st.maxVoices <= MAX_VOICES && st.nan === 0,
    ladder, distance: [d0[0], d1[0], d3[0], d6[0]], pan: { right: pr, left: pl },
    sfx: rows.length, music: mrows.length, fails: bad.map((r) => r.name), maxPeak, stress: st, table,
  };
  (window as unknown as Record<string, unknown>).__SNAP_READY__ = true;
  console.log(table);
}

main().catch((e) => {
  const head = document.getElementById('head');
  if (head) head.textContent = 'FAILED: ' + String(e);
  (window as unknown as Record<string, unknown>).__AUDIO_REPORT__ = { ok: false, error: String(e) };
  (window as unknown as Record<string, unknown>).__SNAP_READY__ = true;
});
