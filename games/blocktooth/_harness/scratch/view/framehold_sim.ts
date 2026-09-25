// BLOCKTOOTH — boss-frame hysteresis, sim level (node, THREE-free). Companion of framepump.py (the
// real-Chrome measurement); this one is fast and deterministic, for tuning BOSS_FRAME.
//
//   node _harness/scratch/view/framehold_sim.ts [--level 37] [--secs 60] [--seeds 1,2]
//
// Per boss × titan × seed: grow to --level (god, noSpawns, bot drafts), spawn the biome boss, drive the
// titan with bot.ts botInput (a real policy: approach, strafe, dodge tells), force phase 2 half-way.
// Every 0.1 s of sim time logs the director's held framing (bossFrameD) and this tick's raw need.
// Reports: zigzag legs / pumps / tv÷range of the held series (same metric as framepump.py), the same
// metrics for the round-1 rule (hold 1.6 s, release at 1/s, replayed on the raw need series), and
// whether held ≥ need on every tick (a live tell never outgrows the held framing).
import type { BiomeId, BossId, TitanId, TitanInput, World } from '../../../src/core/types.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { BOSS_FRAME, bossFrameNeed, bossFrameFitAt, cameraDistance } from '../../../src/core/config.ts';
import { gainGrowth } from '../../../src/titans/titansim.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const LEVEL = +arg('--level', '37'), SECS = +arg('--secs', '60');
const SEEDS = arg('--seeds', '1,2').split(',').map(Number);
const DUMP = process.argv.includes('--dump');
// --set holdMaxS=15,keepFrac=0.75 — tune BOSS_FRAME in-process (the object is `as const` in type only)
for (const kv of arg('--set', '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); (BOSS_FRAME as unknown as Record<string, number>)[k] = +v; }
console.log('BOSS_FRAME ' + JSON.stringify(BOSS_FRAME));
const ONLY = arg('--boss', '');
const BOSSES: [BossId, BiomeId][] = [['parkade6', 'grideast'], ['irongully', 'whitestacks'], ['caisson4', 'lockwater']];
const TITANS: TitanId[] = ['molo', 'voltkite'];
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };

function drafts(w: World): void {
  let g = 0;
  while (hasPendingDraft(w) && g++ < 200) {
    const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0);
    if (!o.length) break;
    pickUpgrade(w, botPickUpgrade(w, o));
  }
}

export function pumpMetrics(xs: number[]): { legs: number; pumps: number; tvr: number; min: number; max: number; list: string } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length, thr = 0.02 * mean;
  const legs: [number, number, number][] = [];
  let piv = xs[0], ext = xs[0], d = 0;
  for (const x of xs.slice(1)) {
    if (d === 0) { if (x - piv >= thr) { d = 1; ext = x; } else if (piv - x >= thr) { d = -1; ext = x; } }
    else if (d === 1) { if (x > ext) ext = x; else if (ext - x >= thr) { legs.push([1, piv, ext]); piv = ext; ext = x; d = -1; } }
    else { if (x < ext) ext = x; else if (x - ext >= thr) { legs.push([-1, piv, ext]); piv = ext; ext = x; d = 1; } }
  }
  if (d !== 0) legs.push([d, piv, ext]);
  let pumps = 0;
  for (let i = 0; i + 1 < legs.length; i++) {
    const a = legs[i], b = legs[i + 1];
    if (a[0] === -1 && b[0] === 1 && a[1] - a[2] >= 0.03 * a[1] && b[2] - b[1] >= 0.03 * b[1]) pumps++;
  }
  let tv = 0; for (let i = 1; i < xs.length; i++) tv += Math.abs(xs[i] - xs[i - 1]);
  const mn = Math.min(...xs), mx = Math.max(...xs);
  return { legs: legs.length, pumps, tvr: mx - mn > 1e-6 ? tv / (mx - mn) : 1, min: mn, max: mx, list: legs.map(l => (l[0] > 0 ? '+' : '-') + l[1].toFixed(0) + '>' + l[2].toFixed(0)).join(' ') };
}

let totPumps = 0, totLegacyPumps = 0, violations = 0;
for (const [boss, biome] of BOSSES.filter(([b]) => !ONLY || ONLY.split(',').includes(b))) {
  for (const titan of TITANS) {
    for (const seed of SEEDS) {
      const w = createWorld({ titan, biome, seed });
      w.cheats.god = true; w.cheats.noSpawns = true;
      for (let g = 0; g < 200 && w.titan.level < LEVEL; g++) { gainGrowth(w, 1); drafts(w); }
      for (let i = 0; i < 150; i++) { drafts(w); stepWorld(w, NO); }
      w.enemies.length = 0;
      spawnBoss(w, boss);
      // intro walk
      for (let i = 0; i < 30 * 40 && w.boss && w.boss.introT > 0; i++) { drafts(w); stepWorld(w, botInput(w)); }
      for (let i = 0; i < 90; i++) { drafts(w); stepWorld(w, botInput(w)); }
      const held: number[] = [], legacy: number[] = [];
      let lh = 0, lt = 0, minSlack = Infinity, ticks = 0, prevNeed = 0;
      const needS: number[] = [];
      const N = SECS * 30;
      for (let i = 0; i < N && w.boss && w.boss.alive; i++) {
        if (i === N >> 1) { const b = w.boss; if (b.hp > b.maxHp * 0.6) b.hp = b.maxHp * 0.6; }
        drafts(w);
        stepWorld(w, botInput(w));
        const dat = w.director.data;
        const need = bossFrameNeed(w);          // same state the director saw this tick (pure, scratch only)
        const fit = bossFrameFitAt(dat.camOx ?? 0, dat.camOz ?? 0);
        const curve = cameraDistance(w.titan.height);
        const needD = Math.max(curve, need.d);
        // round-1 rule replayed on the raw need
        if (needD >= lh) { lh = needD; lt = 0; } else { lt += w.dt; if (lt > 1.6) lh += (needD - lh) * (1 - Math.exp(-1.0 * w.dt)); }
        const hd = dat.bossFrameD || curve;
        if (prevNeed > 0) minSlack = Math.min(minSlack, hd - prevNeed);   // held(i) vs need(i-1): the director runs before stepBoss
        prevNeed = Math.max(needD, fit);
        ticks++;
        if (i % 3 === 0) { held.push(hd); legacy.push(Math.max(lh, fit, curve)); needS.push(Math.max(needD, fit)); }
      }
      const m = pumpMetrics(held), l = pumpMetrics(legacy);
      totPumps += m.pumps; totLegacyPumps += l.pumps;
      if (minSlack < -1e-6) violations++;
      if (DUMP) { console.log('  NEW legs: ' + m.list); console.log('  need (1 s max): ' + needS.reduce((a: string[], x, j) => { if (j % 10 === 0) a.push(Math.max(...needS.slice(j, j + 10)).toFixed(0)); return a; }, []).join(' ')); console.log('  held (1 s): ' + held.filter((_, j) => j % 10 === 0).map(x => x.toFixed(0)).join(' ')); }
      console.log(`${boss.padEnd(9)} ${titan.padEnd(8)} seed ${seed} · ${ticks} ticks · NEW legs ${m.legs} pumps ${m.pumps} tv/range ${m.tvr.toFixed(2)} D ${m.min.toFixed(0)}–${m.max.toFixed(0)}`
        + ` · ROUND-1 legs ${l.legs} pumps ${l.pumps} tv/range ${l.tvr.toFixed(2)} D ${l.min.toFixed(0)}–${l.max.toFixed(0)} · min(held − need) ${minSlack.toFixed(2)} m`);
    }
  }
}
console.log(`TOTAL pumps NEW ${totPumps} · ROUND-1 (replayed) ${totLegacyPumps} · held < need on ${violations} runs`);
