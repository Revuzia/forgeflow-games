// K1b scratch — gatekeeper calibration + behaviour smoke (NOT a gate; probe_gatekeepers is K1a's).
//
// A full bot run exactly as probe_sim drives it (bot.ts botInput incl. K1a's bot_gate, drafts, the director, the
// REAL gate loop in meta/gates.ts — K1a's, landed 2026-09-28 00:02) until SWITCHBOARD-5's kill (or death / maxT).
// Records every gatekeeper fight (gateSpawn → gateDefeated) with the module telemetry at the kill.
// Output: per-run fight seconds per gatekeeper + attack/beat telemetry; per-titan and per-gate medians.
//
//   node _harness/scratch/k1b/cal.ts [--titan a,b] [--biome a,b] [--seeds 1337,7,99] [--gatebot] [--god] [--json f]

import type { BiomeId, GateId, SimEvent, TitanId, TitanInput } from '../../../src/core/types.ts';
import { BIOME_IDS, EMPTY_RUN_META, GATE_IDS, TITAN_IDS } from '../../../src/core/types.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../../bot.ts';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const TITANS = arg('--titan', TITAN_IDS.join(',')).split(',') as TitanId[];
const BIOMES = arg('--biome', BIOME_IDS.join(',')).split(',') as BiomeId[];
const SEEDS = arg('--seeds', '1337,7,99').split(',').map(Number);
const GOD = argv.includes('--god');
const MAX_T = Number(arg('--maxT', '560'));
const JSON_OUT = arg('--json', '');

interface GateRec { tagF: Record<string, number>; tagL: Record<string, number>; hitSum: number; firstHitT: number; rearS: number; nearS: number; farS: number; maxHp: number; overS: number; gate: GateId; spawnT: number; killT: number; fightS: number; died: boolean; data: Record<string, number>; attacks: Record<string, number>; hits: number; tells: number; maxHitFrac: number; minWindup: number; lvl: number }
interface RunRec { titan: TitanId; biome: BiomeId; seed: number; gates: GateRec[]; dead: boolean; endT: number }

function runOne(titan: TitanId, biome: BiomeId, seed: number): RunRec {
  const w = createWorld({ titan, biome, seed, meta: { ...EMPTY_RUN_META, unlocked: [] } });
  if (GOD) w.cheats.god = true;
  const rec: RunRec = { titan, biome, seed, gates: [], dead: false, endT: NaN };
  let cur: GateRec | null = null;
  const G = w.gates;
  for (let i = 0; i < MAX_T * 30 && !w.run.result; i++) {
    let guard = 0;
    while (hasPendingDraft(w) && guard++ < 200) {
      const chest = w.upgrades.chestDrafts > 0;
      const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : rollOffer(w, chest);
      if (!offer || offer.length === 0) break;
      pickUpgrade(w, botPickUpgrade(w, offer));
    }
    const inp: TitanInput = botInput(w);
    stepWorld(w, inp);
    const b = w.boss;
    const live = !!(b && b.alive && b.role === 'gate');
    const T = w.titan;
    const evs: readonly SimEvent[] = w.events;
    for (const ev of evs) {
      if (process.env.K1B_DBG && (ev.type === 'rankUp' || ev.type === 'gateSpawn' || ev.type === 'gateDefeated')) console.log('EV', w.t.toFixed(2), JSON.stringify(ev), 'unlocked', G.unlocked);
      if (ev.type === 'gateSpawn' && !ev.rematch) {
        cur = { tagF: {}, tagL: {}, hitSum: 0, firstHitT: NaN, rearS: 0, nearS: 0, farS: 0, maxHp: w.boss ? w.boss.maxHp : NaN, overS: 0, gate: ev.gate, spawnT: w.t, killT: NaN, fightS: NaN, died: false, data: {}, attacks: {}, hits: 0, tells: 0, maxHitFrac: 0, minWindup: Infinity, lvl: T.level };
        rec.gates.push(cur);
        continue;
      }
      if (!cur) continue;
      if (ev.type === 'bossHit') { cur.hitSum += ev.dmg; if (Number.isNaN(cur.firstHitT)) cur.firstHitT = w.t - cur.spawnT; }
      else if (ev.type === 'bossAttack') cur.attacks[ev.attack] = (cur.attacks[ev.attack] ?? 0) + 1;
      else if (ev.type === 'telegraphStart' && ev.owner === 'boss') {
        const tg = w.telegraphs.find((t) => t.id === ev.id);
        if (tg) cur.minWindup = Math.min(cur.minWindup, tg.windup);
      } else if (ev.type === 'telegraphFire' && ev.owner === 'boss') {
        cur.tells++; if (ev.hit) cur.hits++;
        const tg = w.telegraphs.find((t) => t.id === ev.id);
        const tag = (tg ? tg.tag : '?').replace(/:\d+$/, '');
        cur.tagF[tag] = (cur.tagF[tag] ?? 0) + 1; if (ev.hit) cur.tagL[tag] = (cur.tagL[tag] ?? 0) + 1;
      }
      else if (ev.type === 'titanHurt') cur.maxHitFrac = Math.max(cur.maxHitFrac, ev.dmg / Math.max(1, T.maxHp));
      else if (ev.type === 'gateDefeated') {
        if (process.env.K1B_DBG) console.log("DEFEATED", w.t, JSON.stringify(ev), w.boss?.hp, w.boss?.maxHp, w.boss?.data.fatigue, G.engagedS, G.liveFightS);
        cur.killT = w.t; cur.fightS = w.t - cur.spawnT;
        cur.data = { ...w.boss!.data };
        cur = null;
      }
    }
    if (cur && live) {
      const H = b!.data.H || T.height, dd = Math.hypot(T.x - b!.x, T.z - b!.z) / H;
      if ((b!.data.rear ?? 0) > 0) cur.rearS += w.dt;
      if (dd <= (b!.data.bandMaxH ?? 4) + 0.5) cur.nearS += w.dt; else cur.farS += w.dt;
      if ((b!.data.weakMask ?? 0) > 0) cur.overS += w.dt;
    }
    if (!T.alive) { rec.dead = true; if (cur) { cur.died = true; cur.data = { ...w.boss!.data }; } break; }
    if (G.unlocked >= 3 && !live) break;
  }
  rec.endT = w.t;
  if (process.env.K1B_DBG) console.log("END", w.run.result, w.boss?.id, w.boss?.alive, w.boss?.role, w.director.bossT, w.titan.rank);
  return rec;
}

const med = (a: number[]) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] * 0.5 + s[Math.ceil((s.length - 1) / 2)] * 0.5 : NaN; };
const runs: RunRec[] = [];
const t0 = Date.now();
for (const titan of TITANS) for (const biome of BIOMES) for (const seed of SEEDS) {
  const r = runOne(titan, biome, seed);
  runs.push(r);
  const line = r.gates.map((g) => `[first hit ${g.firstHitT.toFixed(1)}s fatigue ${(100 * (1 - g.hitSum / g.maxHp)).toFixed(0)}% near ${g.nearS.toFixed(0)} far ${g.farS.toFixed(0)} weakOpen ${g.overS.toFixed(0)}s rear ${g.rearS.toFixed(0)}s] ${g.gate} ${Number.isFinite(g.fightS) ? g.fightS.toFixed(1) + 's' : (g.died ? 'DIED' : 'open')} @${g.spawnT.toFixed(0)} LV${g.lvl} hit ${g.hits}/${g.tells} maxHit ${(100 * g.maxHitFrac).toFixed(0)}% minWU ${g.minWindup.toFixed(2)} ${Object.entries(g.attacks).map(([k, v]) => k + ':' + v).join(',')}`
    + (g.gate === 'stencil1' ? ` refills ${g.data.refills} tipped ${g.data.tipped} drum ${((g.data.part_drum ?? 0) / Math.max(1, (g.data.part_drum ?? 0) + (g.data.part_other ?? 0)) * 100).toFixed(0)}% open-share ${((g.data.open_drum ?? 0) / Math.max(1, g.data.open_all ?? 0) * 100).toFixed(0)}%` : '')
    + (g.gate === 'cordon2' ? ` shoves ${g.data.shoves} overheats ${g.data.overheats} stalls ${g.data.stalls} squads ${g.data.squads} pack ${((g.data.part_pack ?? 0) / Math.max(1, (g.data.part_pack ?? 0) + (g.data.part_other ?? 0)) * 100).toFixed(0)}% open-share ${((g.data.open_pack ?? 0) / Math.max(1, g.data.open_all ?? 0) * 100).toFixed(0)}%` : '')
    + (g.gate === 'switchboard5' ? ` relocs ${g.data.relocates} caught ${g.data.caught} puts ${g.data.putThroughs} adds ${g.data.addsSummoned} linesDown ${g.data.linesDown} dish ${((g.data.part_dish ?? 0) / Math.max(1, (g.data.part_dish ?? 0) + (g.data.part_other ?? 0)) * 100).toFixed(0)}% open-share ${((g.data.open_dish ?? 0) / Math.max(1, g.data.open_all ?? 0) * 100).toFixed(0)}%` : '')
  ).join('\n      ');
  console.log(`${titan.padEnd(10)} ${biome.padEnd(11)} ${String(seed).padEnd(5)} ${r.dead ? 'DEAD' : 'ok  '} t ${r.endT.toFixed(0)}\n      ${line}`);
}
console.log(`\nwall ${((Date.now() - t0) / 1000).toFixed(1)} s · god ${GOD}`);
for (const g of GATE_IDS) {
  const all: number[] = [];
  const per: string[] = [];
  for (const t of TITANS) {
    const f = runs.filter((r) => r.titan === t).flatMap((r) => r.gates.filter((x) => x.gate === g).map((x) => x.fightS));
    all.push(...f);
    const reached = runs.filter((r) => r.titan === t).flatMap((r) => r.gates.filter((x) => x.gate === g)).length;
    per.push(`${t} ${med(f).toFixed(1)} (${f.filter(Number.isFinite).length}/${reached})`);
  }
  const tmed = TITANS.map((t) => med(runs.filter((r) => r.titan === t).flatMap((r) => r.gates.filter((x) => x.gate === g).map((x) => x.fightS))));
  console.log(`${g.padEnd(13)} per-titan median: ${per.join(' · ')} | median of titan medians ${med(tmed).toFixed(1)} | all-fight median ${med(all).toFixed(1)}`);
}
for (const g of GATE_IDS) {
  const F: Record<string, number> = {}, L: Record<string, number> = {};
  for (const r of runs) for (const x of r.gates) if (x.gate === g) { for (const [k, v] of Object.entries(x.tagF)) F[k] = (F[k] ?? 0) + v; for (const [k, v] of Object.entries(x.tagL)) L[k] = (L[k] ?? 0) + v; }
  const tf = Object.values(F).reduce((a, b) => a + b, 0), tl = Object.values(L).reduce((a, b) => a + b, 0);
  console.log(`${g.padEnd(13)} landed ${tl}/${tf} = ${(100 * tl / Math.max(1, tf)).toFixed(1)} % · ` + Object.keys(F).map((k) => `${k} ${L[k] ?? 0}/${F[k]}`).join(' · '));
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(runs, null, 1));
