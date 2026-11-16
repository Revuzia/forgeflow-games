// M2: how far does a piece slide on the table from a separating push (open-loop parting, no steering)?  The pieces are built as the
// physics builds a CENTRED piece today (chunk:false: no flat-goal propulsion), standing on the table, with an initial velocity v along +x.
const G = 'file:///C:/Users/TestRun/Claude%20Claw/squish-keeper-build/games/wobblehoard/';
const { SoftBody } = await import(G + 'src/physics/softbody.ts');
const { speciesTemplateGenome, familyOf } = await import(G + 'src/data/catalog.ts');
const f = (x: number, d = 3): string => x.toFixed(d);
console.log('species (family)          v0 m/s   travel at 0.25 s / 0.5 s / 1 s / 2 s (m)   peak height above rest (mm)');
for (const sp of ['dollop', 'wrigglo', 'kneadle', 'thudge', 'chunkle', 'diademo', 'somnuff', 'crumbit']) {
  for (const v0 of [0.22, 0.6, 1.2]) {
    const g = speciesTemplateGenome(sp as never);
    const probe = new SoftBody(g, { piece: { frac: 0.5, chunk: false, at: { x: 0, y: 0, z: 0 } } } as never);
    const y0 = probe.center.y;
    const b = new SoftBody(g, { piece: { frac: 0.5, chunk: false, at: { x: 0, y: y0, z: 0 }, vel: { x: v0, y: 0, z: 0 } } } as never);
    const x0 = b.center.x, rest = b.center.y;
    const t: number[] = []; let up = 0;
    for (let s = 1; s <= 120; s++) {
      b.step(1 / 60);
      up = Math.max(up, b.center.y - rest);
      if (s === 15 || s === 30 || s === 60 || s === 120) t.push(b.center.x - x0);
    }
    console.log(`${(sp + ' (' + familyOf(sp as never) + ')').padEnd(26)} ${f(v0, 2).padStart(5)}    ${t.map((x) => f(x).padStart(6)).join(' / ')}        ${f(up * 1000, 1)}`);
  }
}
