// Summarize balance_matrix.sh output. node _harness/scratch/balance_sum.ts <dir> [v]
import { readFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2];
const verbose = process.argv[3] === 'v';
const R = ['I', 'II', 'III', 'IV', 'V'];
let clears = 0, inWin = 0, deaths = 0, to = 0;
const bad: string[] = [];
const BANDS = [[0, 0], [60, 150], [150, 300], [280, 450], [400, 560]];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const txt = readFileSync(dir + '/' + f, 'utf8').trim();
  if (!txt) { console.log(f, 'EMPTY', readFileSync(dir + '/' + f.replace('.json', '.err'), 'utf8').slice(0, 400)); continue; }
  const r = JSON.parse(txt);
  if (r.result === 'clear') { clears++; if (r.endT >= 480 && r.endT <= 720) inWin++; else bad.push(`${r.titan}/${r.biome} clear@${r.endT}`); }
  else if (r.result === 'dead') deaths++; else to++;
  r.rankT.forEach((t: number, k: number) => { if (k > 0 && (t < BANDS[k][0] || t > BANDS[k][1])) bad.push(`${r.titan}/${r.biome} ${R[k]}@${t}`); });
  if (r.bossT > 560) bad.push(`${r.titan}/${r.biome} boss@${r.bossT}`);
  const cells = r.ranks.map((x: any, k: number) => {
    const d = Object.values(x.dmg as Record<string, number>).reduce((s: number, v: number) => s + v, 0);
    return `${R[k]} ${String(x.dt).padStart(3)}s d${String(d).padStart(5)} m${String(Math.round(x.minHp * 100)).padStart(3)}% a${String(x.alive).padStart(4)}/${x.heavy}`;
  });
  console.log(`${(r.titan + '/' + r.biome).padEnd(22)} ${r.result.padEnd(7)} ${String(r.endT).padStart(4)}s LV${String(r.level).padStart(3)} rk ${r.rankT.slice(1).join('/')} | ${cells.slice(2).join(' | ')}`
    + ` dps ${r.fight ? Math.round(r.bossMaxHp * (1 - r.bossHp / 100) / r.fight) : '-'}` + ` || elite@${r.eliteT} m${Math.round(r.eliteMinHp * 100)}% d${r.eliteDmg} | boss@${r.bossT} fight ${r.fight} hp ${r.bossHp}% [${r.bossHpAt.join(',')}] minHp ${Math.round(r.bossMinHp * 100)}% dmg ${r.bossDmg}/${r.maxHp} hits ${r.bossHits}` + (r.result === 'dead' ? ` KILLED BY ${r.lastHurt}@${r.lastHurtT}` : ''));
  if (verbose) {
    r.ranks.forEach((x: any, k: number) => console.log(`     ${R[k]} dmg ${JSON.stringify(x.dmg)} hits ${JSON.stringify(x.hits)} heal ${x.heal} fire ${JSON.stringify(x.fire)} paint ${x.paint} kills ${JSON.stringify(x.kills)}`));
    console.log(`     bossBy ${JSON.stringify(r.bossBy)}`);
    console.log(`     phaseT ${r.phaseT} staggers ${r.staggers} dmgFrac ${r.bossDmgFrac} gapAvg ${r.gapAvg} gapHist(<0,<30,<60,<120,>) ${r.gapHist} atk ${JSON.stringify(r.atk)}`);
  }
}
console.log(`clears ${clears}/12 (in window ${inWin}) deaths ${deaths} timeouts ${to}`);
for (const b of bad) console.log('  X ' + b);
