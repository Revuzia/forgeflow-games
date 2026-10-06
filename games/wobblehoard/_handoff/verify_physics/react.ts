import { SoftBody } from './attack_lib.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const { MATERIAL_FAMILY_IDS } = await import(S + '/head/games/wobblehoard/src/data/materials.ts');
const { makeStarterGenome, quantizeGenome } = await import(S + '/head/games/wobblehoard/src/core/genome.ts');
const g = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5 });
const out: string[] = [];
for (const fam of MATERIAL_FAMILY_IDS) {
  const b: any = new SoftBody(g, { family: fam });
  for (let i = 0; i < 60; i++) b.step(1 / 60);
  const R = b.restRadius, h = b.raycast({ x: b.center.x + 0.3 / 0.5125 * R, y: 6 * R, z: b.center.z }, { x: 0, y: -1, z: 0 });
  b.fingerDown(0, { point: h.point, normal: h.normal, dir: { x: 0, y: -1, z: 0 } });
  let r = 0, p = 0, c = 0, n = 0;
  for (let k = 0; k < 90; k++) { const t = k / 60, x = Math.min(1, Math.max(0, (t - 0.18) / 0.9)); b.fingerPressure(0, 0.55 + 0.45 * x * x * (3 - 2 * x)); b.step(1 / 60); if (k >= 60) { r += b.metrics.reaction; p += b.metrics.press; c += b.metrics.compression; n++; } }
  out.push(`${fam.padEnd(13)} reaction ${(r / n).toFixed(2)}  press ${(p / n).toFixed(2)}  compression ${(c / n).toFixed(2)}  squashDepth ${b.params.squashDepth.toFixed(3)}`);
}
console.log(out.join('\n'));
