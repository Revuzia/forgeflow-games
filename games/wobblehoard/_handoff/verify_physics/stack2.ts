import { argOf, v3 } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = argOf('--root', S + '/c47/games/wobblehoard');
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const DT = 1 / 60;
for (const combo of [['cushlet', 'dimpla', 'swishel', 'granulo', 'wrigglo'], ['glugbean', 'nuzzo', 'tadpolo', 'hooplet', 'gloopsy']]) {
  const bs: any[] = []; let y = 0;
  for (const id of combo) { const p: any = new SoftBody(speciesTemplateGenome(id)); bs.push(new SoftBody(speciesTemplateGenome(id), { piece: { frac: 1, chunk: false, at: v3(0.02 * bs.length, y + p.restRadius + 0.05, 0.01 * bs.length) } })); y += p.restRadius * 2.6; }
  const rows: string[] = [];
  for (let i = 1; i <= 30 * 60; i++) {
    for (const b of bs) b.collide(bs); for (const b of bs) b.step(DT);
    if (i % 180 === 0) rows.push(`t ${(i / 60).toFixed(0)} s kin ${bs.map((b) => b.metrics.kinetic.toFixed(3)).join(',')} cy ${bs.map((b) => b.center.y.toFixed(2)).join(',')} vx ${bs.map((b) => Math.hypot(b.center.x, b.center.z).toFixed(2)).join(',')}`);
  }
  console.log(combo.join('>') + '\n  ' + rows.join('\n  '));
}
