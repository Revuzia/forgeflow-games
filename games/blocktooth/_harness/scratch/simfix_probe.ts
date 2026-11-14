// Sim-fix scratch probe (harness scratch, not gate code). One run → one JSON line on stdout.
//   node _harness/scratch/simfix_probe.ts voltkite lockwater [seed] [minutes] [react]
// react: 'bot' (gate bot defaults) | 'human' (≈ fullrun.py: 0.25 s + small spread, no lapses)
// Reports: level-up gaps per Size, max gap at Size III, alive pickups (max / mean) per Size,
// kills at 58 s, hostile telegraph hit rates by tag (boss + enemies), boss fight summary,
// closest boss-part-to-titan clearance while the titan is leashed.
import type { BiomeId, TitanId, World } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { BOT_TUNE, botInput, botPickUpgrade } from '../bot.ts';

const [titan, biome, seedS, minS, react] = process.argv.slice(2);
const seed = Number(seedS ?? 1337), minutes = Number(minS ?? 13);
if (react === 'human') { BOT_TUNE.lapseP = 0; BOT_TUNE.reactionScale = 0.6; }
const w: World = createWorld({ titan: titan as TitanId, biome: biome as BiomeId, seed });

const tagOf = new Map<number, string>();
const tg: Record<string, [number, number]> = {};
const levelT: number[] = [];
const rankAt: number[] = [];
const pk = [0, 0, 0, 0, 0].map(() => ({ max: 0, sum: 0, n: 0 }));
const groundAt: string[] = [];
let kills58 = -1, bossT = NaN, leashMinClear = Infinity, bossMinClear = Infinity, bossMinHp = 1;
const maxTicks = Math.round(minutes * 60 * 30);
for (let i = 0; i < maxTicks && !w.run.result; i++) {
  let g = 0;
  while (hasPendingDraft(w) && g++ < 200) {
    const chest = w.upgrades.chestDrafts > 0;
    const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, chest);
    if (!offer.length) break;
    pickUpgrade(w, botPickUpgrade(w, offer));
  }
  stepWorld(w, botInput(w));
  for (const t of w.telegraphs) if (t.owner !== 'titan' && !tagOf.has(t.id)) tagOf.set(t.id, `${t.owner}/${t.tag || t.style}`);
  for (const ev of w.events) {
    if (ev.type === 'levelUp') levelT.push(w.t);
    else if (ev.type === 'rankUp') rankAt.push(w.t);
    else if (ev.type === 'bossSpawn') bossT = w.t;
    else if (ev.type === 'telegraphFire' && ev.owner !== 'titan') {
      const k = tagOf.get(ev.id) ?? `${ev.owner}/?`;
      const a = tg[k] ?? (tg[k] = [0, 0]);
      a[0]++; if (ev.hit) a[1]++;
    }
  }
  const T = w.titan;
  if (kills58 < 0 && w.t >= 58) kills58 = w.titan.kills;
  if (i % 15 === 0) {
    let n = 0; for (const p of w.pickups) if (p.alive) n++;
    const b = pk[T.rank]; b.max = Math.max(b.max, n); b.sum += n; b.n++;
  }
  for (const ev of w.events) if (ev.type === 'rankUp') {
    let gm = 0, near = 0; const mr = 1.6 * T.height + 2;
    for (const p of w.pickups) if (p.alive) { gm += p.mass; if (Math.hypot(p.x - T.x, p.z - T.z) < 3 * mr) near += p.mass; }
    groundAt.push(`${Math.round(gm)}(near ${Math.round(near)})`);
  }
  const B = w.boss;
  if (B && B.alive && B.introT <= 0) {
    bossMinHp = Math.min(bossMinHp, T.hp / T.maxHp);
    let c = Infinity; for (const p of B.parts) c = Math.min(c, Math.hypot(p.x - T.x, p.z - T.z) - p.r - T.radius);
    bossMinClear = Math.min(bossMinClear, c);
    if (T.leash) leashMinClear = Math.min(leashMinClear, c);
  }
}
const T = w.titan;
// level gaps grouped by the Size the titan was in when the gap ended
const rankOfT = (t: number) => { let r = 0; for (const x of rankAt) if (t >= x) r++; return r; };
const gaps: Record<string, number[]> = {};
let prev = 0;
for (const t of levelT) { const r = rankOfT(t); (gaps[r] ??= []).push(+(t - prev).toFixed(1)); prev = t; }
const maxGap: Record<string, number> = {};
for (const [r, a] of Object.entries(gaps)) maxGap[r] = Math.max(...a);
const tgOut: Record<string, string> = {};
let bossN = 0, bossH = 0;
for (const [k, [n, h]] of Object.entries(tg).sort()) {
  tgOut[k] = `${h}/${n} (${Math.round(100 * h / Math.max(1, n))}%)`;
  if (k.startsWith('boss/')) { bossN += n; bossH += h; }
}
console.log(JSON.stringify({
  titan, biome, seed, react: react ?? 'bot', result: w.run.result ?? 'timeout', endT: Math.round(w.run.result ? w.run.endT : w.t),
  rankT: rankAt.map((x) => +x.toFixed(1)), groundMassAtRankUp: groundAt, level: T.level, kills58, kills: w.titan.kills, bossT: +bossT.toFixed(1),
  maxGapBySize: maxGap, gapsSize1: gaps['0'], gapsSize3: gaps['2'],
  pickups: pk.map((b) => `${b.max}/${Math.round(b.sum / Math.max(1, b.n))}`),
  bossTelegraphs: `${bossH}/${bossN} (${Math.round(100 * bossH / Math.max(1, bossN))}%)`, bossMinHp: +bossMinHp.toFixed(2),
  bossMinClear: +bossMinClear.toFixed(1), leashMinClear: +leashMinClear.toFixed(1), telegraphs: tgOut,
}));
