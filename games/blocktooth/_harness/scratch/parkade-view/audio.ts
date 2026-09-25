// L7 PARKADE-6 audio check: renders every PARKADE voice case through an OfflineAudioContext with the real
// AudioEngine chain and the real Sfx.onEvents bridge (a real World with a real PARKADE-6 boss, real telegraphs).
// Sfx swallows synthesis exceptions (cosmetic subsystem), so "it rendered audio" = peak > 0.01, rms > 0.001,
// no NaN. Also renders a CAISSON-4 case with the same events to prove the parkade branch did not leak.
import { createWorld } from '../../../src/core/world.ts';
import { spawnTelegraph } from '../../../src/combat/telegraphs.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { AudioEngine } from '../../../src/audio/audio.ts';
import { Sfx } from '../../../src/audio/sfx.ts';
import type { BossId, SimEvent, World } from '../../../src/core/types.ts';

const SR = 44100;
const world: World = createWorld({ titan: 'molo', biome: 'grideast', seed: 11 });
const T = world.titan;
T.rank = 4; T.height = 60; T.radius = 25;
const cx = T.x, cz = T.z;
const bosses: Partial<Record<BossId, World['boss']>> = {};
function useBoss(id: BossId): NonNullable<World['boss']> {
  if (!bosses[id]) { world.boss = null; spawnBoss(world, id); bosses[id] = world.boss; }
  world.boss = bosses[id] ?? null;
  const b = world.boss!;
  b.x = cx + 60; b.z = cz + 40;
  return b;
}
const at = (dx = 60, dz = 40) => ({ x: cx + dx, z: cz + dz });
const fire = (tag: string): SimEvent[] => {
  const tg = spawnTelegraph(world, { owner: 'boss', style: 'ring', shape: { k: 'ring', x: cx + 60, z: cz + 40, r0: 0, r1: 90 }, windup: 1, dmg: 1, kind: 'stomp', tag });
  return [{ type: 'telegraphFire', id: tg.id, owner: 'boss', hit: true, ...at() }];
};

interface Case { name: string; dur: number; boss: BossId; ev?: () => SimEvent[]; step?: boolean }
const cases: Case[] = [
  { name: 'bossSpawn (siren + reversing beeper)', dur: 4.2, boss: 'parkade6', ev: () => [{ type: 'bossSpawn', boss: 'parkade6' }] },
  { name: 'step hiss (tripod step)', dur: 0.8, boss: 'parkade6', step: true },
  ...['rampLaunch', 'barrierSwing', 'towChain', 'deckDrop', 'levelCollapse'].map((a) => ({ name: `bossAttack ${a}`, dur: 2, boss: 'parkade6' as BossId, ev: () => [{ type: 'bossAttack', attack: a, ...at() } as SimEvent] })),
  ...['barrierSwing', 'deckDrop', 'levelCollapse:A', 'levelCollapse:C'].map((t) => ({ name: `fire ${t}`, dur: 2, boss: 'parkade6' as BossId, ev: () => fire(t) })),
  ...['till', 'legFL', 'booth', 'body'].map((p) => ({ name: `bossHit ${p}`, dur: 0.8, boss: 'parkade6' as BossId, ev: () => [{ type: 'bossHit', part: p, dmg: 900, ...at(20, 20) } as SimEvent] })),
  { name: 'bossStagger (JAMMED)', dur: 2.8, boss: 'parkade6', ev: () => [{ type: 'bossStagger' }] },
  { name: 'bossDefeated (collapse + alarms)', dur: 5, boss: 'parkade6', ev: () => [{ type: 'bossDefeated', ...at(30, 30) }] },
  { name: 'leash on (tow hooks)', dur: 1, boss: 'parkade6', ev: () => [{ type: 'leash', on: true, ...at(20, 0) }] },
  { name: 'CONTROL caisson4 bossAttack hookLane', dur: 2, boss: 'caisson4', ev: () => [{ type: 'bossAttack', attack: 'hookLane', ...at() }] },
  { name: 'CONTROL caisson4 bossStagger', dur: 2.6, boss: 'caisson4', ev: () => [{ type: 'bossStagger' }] },
];

interface Row { name: string; peak: number; rms: number; nan: number; ok: boolean }
async function render(c: Case): Promise<Row> {
  const b = useBoss(c.boss);
  const off = new OfflineAudioContext(2, Math.ceil(c.dur * SR), SR);
  const eng = new AudioEngine({ context: off });
  eng.setVolumes(1, 1, 1);
  const sfx = new Sfx(eng);
  if (c.step) {
    const ping: SimEvent[] = [{ type: 'waveStart', wave: 1 }];
    sfx.onEvents(world, ping, cx, cz);           // init the step tracker
    b.x += 4; sfx.onEvents(world, ping, cx, cz);  // 4 m of travel ≥ one tripod step (3.15 m)
  } else if (c.ev) sfx.onEvents(world, c.ev(), cx, cz);
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let peak = 0, s2 = 0, nan = 0, n = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], bb = R[i];
    if (!Number.isFinite(a) || !Number.isFinite(bb)) { nan++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(bb));
    if (m > peak) peak = m;
    if (m > 1e-4) { s2 += (a * a + bb * bb) / 2; n++; }
  }
  const rms = Math.sqrt(s2 / Math.max(1, n));
  return { name: c.name, peak: +peak.toFixed(4), rms: +rms.toFixed(4), nan, ok: nan === 0 && peak > 0.01 && peak <= 1 && rms > 0.001 };
}

(async () => {
  const rows: Row[] = [];
  for (const c of cases) rows.push(await render(c));
  const txt = rows.map((r) => `${r.ok ? 'OK  ' : 'FAIL'} peak ${r.peak.toFixed(3)} rms ${r.rms.toFixed(4)} nan ${r.nan}  ${r.name}`).join('\n');
  document.getElementById('label')!.textContent = txt;
  const g = window as unknown as { __SNAP_READY__: boolean; __NOTE__: string };
  g.__NOTE__ = txt + `\n${rows.filter((r) => r.ok).length}/${rows.length} OK`;
  g.__SNAP_READY__ = true;
})();
