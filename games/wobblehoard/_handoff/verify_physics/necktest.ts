// Neck creases at the shell's timing on random cut planes (off-centre, tilted), vs centre planes. node necktest.ts --root <tree> [--n 8] [--only id] [--plane px,py,pz,nx,ny,nz]
import { argOf, v3, makeFoldMeter, foldOf, volumeOf } from '../verify_repair_a/common.ts';
const S = '/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/phys_verify';
const root = argOf('--root', S + '/c47/games/wobblehoard');
const N = Number(argOf('--n', '8')), ONLY = argOf('--only', ''), PL = argOf('--plane', '');
const { SoftBody } = await import(root + '/src/physics/softbody.ts');
const { CATALOG, speciesTemplateGenome } = await import(root + '/src/data/catalog.ts');
const { quantizeGenome } = await import(root + '/src/core/genome.ts');
const { mulberry32 } = await import(root + '/src/core/rng.ts');
const DT = 1 / 60;
const NECK_S: Record<string, number> = { firmsilicone: 0.4, popdome: 0.4, putty: 0.34, mochidough: 0.34, slowrise: 0.3, marshmallow: 0.3, stickystretch: 0.3, slimegoo: 0.3 };
const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
let tot = 0, bad = 0, badCentre = 0, totCentre = 0, worstAll = 0;
const lines: string[] = [];
for (const d of CATALOG) for (const gn of ['tmpl', 'soft']) {
  if (ONLY && d.id !== ONLY) continue;
  const t = speciesTemplateGenome(d.id), g = gn === 'soft' ? quantizeGenome({ ...t, firmness: 0, bounce: 1, stretch: 1, size: 1 }) : t;
  const rng = mulberry32((d.id.length * 7919 + (gn === 'soft' ? 1 : 0)) >>> 0);
  const planes: any[] = [];
  for (let k = 0; k < N + 2; k++) planes.push(null);
  for (let k = 0; k < planes.length; k++) {
    const b: any = new SoftBody(g);
    for (let i = 0; i < 30; i++) b.step(DT);
    const r = b.restRadius, c = { x: b.center.x, y: b.center.y, z: b.center.z };
    let plane: any;
    if (PL) { const a = PL.split(',').map(Number); plane = { point: v3(c.x + a[0] * r, c.y + a[1] * r, c.z + a[2] * r), normal: v3(a[3], a[4], a[5]) }; }
    else if (k === 0) plane = { point: v3(c.x, c.y, c.z), normal: v3(1, 0, 0) };          // the probe's centre plane
    else if (k === 1) plane = { point: v3(c.x, c.y, c.z), normal: v3(0, 0, 1) };
    else {
      const a = rng() * Math.PI * 2, e = Math.acos(2 * rng() - 1), n = v3(Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a)), off = (rng() - 0.5) * r;
      plane = { point: v3(c.x + n.x * off, c.y + n.y * off, c.z + n.z * off), normal: n };
    }
    const fa = b.measureCut(plane);
    if (fa === null || Math.min(fa, 1 - fa) < 0.125) continue;
    const m = makeFoldMeter(b), v0 = volumeOf(b.positions, b.indices), neckS = NECK_S[b.family] ?? 0.25, nk = Math.round((neckS + 0.1) / DT);
    let worst = 0, f120 = 0, at = -1, vmin = 9;
    for (let i = 0; i < nk; i++) { b.setNeck(plane, smooth((i * DT) / neckS)); b.step(DT); const fo = foldOf(b, m).worst; if (fo > worst) { worst = fo; at = i; } if (fo > 120) f120++; vmin = Math.min(vmin, volumeOf(b.positions, b.indices) / v0); }
    const centre = k < 2 && !PL;
    if (centre) { totCentre++; if (f120) badCentre++; } else { tot++; if (f120) bad++; }
    worstAll = Math.max(worstAll, worst);
    if (f120 || PL) lines.push(`${d.id} ${gn} ${b.family} ${centre ? 'CENTRE ' : ''}plane point ${((plane.point.x - c.x) / r).toFixed(2)},${((plane.point.y - c.y) / r).toFixed(2)},${((plane.point.z - c.z) / r).toFixed(2)} R normal ${plane.normal.x.toFixed(2)},${plane.normal.y.toFixed(2)},${plane.normal.z.toFixed(2)} fa ${fa.toFixed(2)}: worst ${worst.toFixed(0)} deg at neck frame ${at}/${nk}, ${f120} frames over 120, volume min ${vmin.toFixed(3)}`);
  }
}
console.log(`random planes: ${bad} of ${tot} necks crease over 120; centre planes: ${badCentre} of ${totCentre}; worst ${worstAll.toFixed(0)}`);
for (const l of lines.slice(0, 40)) console.log('  ' + l);
