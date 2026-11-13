// K2a gate audio verification: renders every gatekeeper sfx case (GATEKEEPERS §6.8) through an OfflineAudioContext
// with the real AudioEngine + the real Sfx.onEvents bridge, against a REAL World with each gatekeeper fielded by the
// real spawnGate. Sfx swallows synthesis errors (a thrown voice is silent), so a case passes only with sound:
// no NaN, peak in (0.01, 1], rms > 0.001. Reports window.__AUDIO_REPORT__.
import { createWorld, stepN } from '../../../src/core/world.ts';
import { spawnGate } from '../../../src/ai/bosses/index.ts';
import { AudioEngine } from '../../../src/audio/audio.ts';
import { Sfx } from '../../../src/audio/sfx.ts';
import type { GateId, SimEvent, World } from '../../../src/core/types.ts';

const SR = 44100;
const world: World = createWorld({ titan: 'molo', biome: 'grideast', seed: 11 });
stepN(world, 30);
const T = world.titan;
const cx = T.x, cz = T.z;
const HOME: Record<GateId, [number, number]> = { stencil1: [0, 3.125], cordon2: [1, 10.77], switchboard5: [2, 25.6] };
const bosses: Partial<Record<GateId, World['boss']>> = {};
function useGate(id: GateId | null): void {
  if (!id) { world.boss = null; return; }
  const [rank, H] = HOME[id];
  T.rank = rank as 0; T.height = H; T.radius = H * 0.42;
  if (!bosses[id]) { world.boss = null; spawnGate(world, id, 0); bosses[id] = world.boss; }
  world.boss = bosses[id] ?? null;
  const b = world.boss!;
  b.x = b.px = cx + 2 * H; b.z = b.pz = cz; b.alive = true;
}
interface Case { name: string; gate: GateId | null; dur: number; ev?: () => SimEvent[]; move?: boolean; attack?: string }
const cases: Case[] = [];
const ATK: Record<GateId, string[]> = {
  stencil1: ['stripeRun', 'uTurn', 'doubleLine', 'paintBuckets'],
  cordon2: ['shieldShove', 'sawhorseToss', 'backfire', 'squadBehind'],
  switchboard5: ['callIn', 'putThrough', 'holdMusic', 'relocate'],
};
const PARTS: Record<GateId, string[]> = { stencil1: ['drum', 'cab', 'wheelL'], cordon2: ['pack', 'wallC', 'trackL'], switchboard5: ['dishA', 'base', 'outriggerFL'] };
for (const g of ['stencil1', 'cordon2', 'switchboard5'] as GateId[]) {
  cases.push({ name: `${g} arrival`, gate: g, dur: 3.4, ev: () => [{ type: 'gateSpawn', gate: g, slot: 1, rematch: false }] });
  cases.push({ name: `${g} stagger`, gate: g, dur: 2.4, ev: () => [{ type: 'bossStagger' }] });
  cases.push({ name: `${g} phase chirp`, gate: g, dur: 0.8, ev: () => [{ type: 'bossPhase', phase: 2 }] });
  for (const a of ATK[g]) cases.push({ name: `${g} attack ${a}`, gate: g, dur: 1.8, ev: () => [{ type: 'bossAttack', attack: a, x: world.boss!.x, z: world.boss!.z }] });
  for (const p of PARTS[g]) cases.push({ name: `${g} hit ${p}`, gate: g, dur: 0.6, ev: () => [{ type: 'bossHit', part: p, dmg: 50, x: world.boss!.x, z: world.boss!.z }] });
  cases.push({ name: `${g} running voices (moving)`, gate: g, dur: 1.6, move: true, attack: g === 'stencil1' ? 'stripeRun' : undefined });
}
cases.push({ name: 'gateLocked padlock', gate: null, dur: 1.0, ev: () => [{ type: 'gateLocked', slot: 1, capped: false }] });
cases.push({ name: 'gateEscalate klaxon', gate: 'cordon2', dur: 1.0, ev: () => [{ type: 'gateEscalate', level: 2 }] });
cases.push({ name: 'gateDefeated approved', gate: 'stencil1', dur: 2.2, ev: () => [{ type: 'gateDefeated', gate: 'stencil1', slot: 1, x: cx + 3, z: cz, fightS: 30, rematch: false }] });
cases.push({ name: 'gateRam crunch', gate: 'cordon2', dur: 1.2, ev: () => [{ type: 'gateRam', x: cx + 10, z: cz }] });
cases.push({ name: 'finale brass swell', gate: null, dur: 3.6, ev: () => [{ type: 'finale', on: true }] });

interface Row { name: string; peak: number; rms: number; nan: number; ok: boolean }
async function render(c: Case): Promise<Row> {
  useGate(c.gate);
  const off = new OfflineAudioContext(2, Math.ceil(c.dur * SR), SR);
  const eng = new AudioEngine({ context: off });
  eng.setVolumes(1, 1, 1);
  const sfx = new Sfx(eng);
  if (c.move) {
    const b = world.boss!;
    if (c.attack) b.attack = c.attack;
    const H = b.data.H;
    for (let k = 0; k < 60; k++) {
      const tt = 0.01 + k * (1 / 40);
      off.suspend(tt).then(() => {
        b.x += 0.12 * H; if (b.data.crown !== undefined) b.data.crown += 0.02;
        sfx.onEvents(world, [{ type: 'waveStart', wave: 1 } as unknown as SimEvent], cx, cz);
        off.resume();
      }).catch(() => { /* ignore */ });
    }
  } else if (c.ev) sfx.onEvents(world, c.ev(), cx, cz);
  const buf = await off.startRendering();
  const d0 = buf.getChannelData(0), d1 = buf.getChannelData(1);
  let peak = 0, sum = 0, nan = 0;
  for (let i = 0; i < d0.length; i++) {
    const a = d0[i], b2 = d1[i];
    if (!Number.isFinite(a) || !Number.isFinite(b2)) { nan++; continue; }
    peak = Math.max(peak, Math.abs(a), Math.abs(b2));
    sum += a * a + b2 * b2;
  }
  const rms = Math.sqrt(sum / (2 * d0.length));
  const b = world.boss; if (b && c.attack) b.attack = null;
  return { name: c.name, peak: +peak.toFixed(4), rms: +rms.toFixed(5), nan, ok: nan === 0 && peak > 0.01 && peak <= 1 && rms > 0.001 };
}
(async () => {
  const rows: Row[] = [];
  for (const c of cases) rows.push(await render(c));
  const bad = rows.filter((r) => !r.ok);
  document.getElementById('label')!.textContent = rows.map((r) => `${r.ok ? 'OK ' : 'BAD'} ${r.name}  peak ${r.peak} rms ${r.rms} nan ${r.nan}`).join('\n');
  (window as unknown as { __AUDIO_REPORT__: unknown; __SNAP_READY__: boolean; __NOTE__: string }).__AUDIO_REPORT__ = { rows, bad: bad.length, total: rows.length };
  (window as unknown as { __NOTE__: string }).__NOTE__ = `gate audio cases ${rows.length}, bad ${bad.length}: ${bad.map((r) => r.name).join(', ')}`;
  (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
})();
