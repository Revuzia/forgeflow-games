// M7: the replacement for the closed-loop steering stopgap: an OPEN-LOOP scripted parting.  Two centred pieces (frac 0.5, built flush, skins touching) are
// parted along +-x for PART_S with moveTo targets  base +- 0.5 G smoothstep(t / PART_S)  (stiffness 3, horizontal), then moveTo(null).  Measures the
// surface gap along the line of centres (shell's gapBetween) at 0.3 / 0.6 / 1 / 2 / 4 s, the peak centre speed after the release, and how far the
// gap closes again.  The pieces collide with each other every frame (collide()), as in the game.
const G = 'file:///C:/Users/TestRun/Claude%20Claw/squish-keeper-build/games/wobblehoard/';
const { SoftBody } = await import(G + 'src/physics/softbody.ts');
const { speciesTemplateGenome } = await import(G + 'src/data/catalog.ts');
const f = (x: number, d = 3): string => x.toFixed(d);
const support = (b: any, u: number[]): number => { const P = b.positions, c = b.center; let m = -Infinity; for (let i = 0; i < b.vertexCount; i++) m = Math.max(m, (P[i * 3] - c.x) * u[0] + (P[i * 3 + 1] - c.y) * u[1] + (P[i * 3 + 2] - c.z) * u[2]); return m; };
const gap = (a: any, b: any): number => {
  const x = a.center.x - b.center.x, y = a.center.y - b.center.y, z = a.center.z - b.center.z, d = Math.hypot(x, y, z), u = [x / d, y / d, z / d];
  return d - support(b, u) - support(a, [-u[0], -u[1], -u[2]]);
};
const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
console.log('species     PART_S  G     gap at 0.3 / 0.6 / 1 / 2 / 4 s (m)                 peak speed after release (m/s)   max |y drift| (mm)');
for (const sp of ['dollop', 'wrigglo', 'kneadle', 'chunkle', 'diademo']) {
  for (const [partS, Gp] of [[0.3, 0.06], [0.45, 0.16]] as const) {
    const g = speciesTemplateGenome(sp as never);
    const probe = new SoftBody(g, { piece: { frac: 0.5, chunk: false, at: { x: 0, y: 0, z: 0 } } } as never);
    const y0 = probe.center.y, r = probe.restRadius * 1.0;
    const a = new SoftBody(g, { piece: { frac: 0.5, chunk: false, at: { x: -r - 0.02, y: y0, z: 0 } } } as never);
    const b = new SoftBody(g, { piece: { frac: 0.5, chunk: false, at: { x: r + 0.02, y: y0, z: 0 } } } as never);
    for (let s = 0; s < 30; s++) { a.collide([b]); b.collide([a]); a.step(1 / 60); b.step(1 / 60); }   // settle flush
    const ax = a.center.x, bx = b.center.x, g0 = gap(a, b);
    const out: number[] = []; let peak = 0, ydrift = 0, pa = a.center.x;
    for (let s = 1; s <= 240; s++) {
      const t = s / 60;
      if (t <= partS) { const e = smooth(t / partS) * Gp * 0.5; a.moveTo({ x: ax - e, y: a.center.y, z: a.center.z }, 3); b.moveTo({ x: bx + e, y: b.center.y, z: b.center.z }, 3); }
      else if (t - 1 / 60 <= partS) { a.moveTo(null); b.moveTo(null); }
      a.collide([b]); b.collide([a]); a.step(1 / 60); b.step(1 / 60);
      if (t > partS) { peak = Math.max(peak, Math.abs(a.center.x - pa) * 60); }
      pa = a.center.x; ydrift = Math.max(ydrift, Math.abs(a.center.y - y0));
      if ([18, 36, 60, 120, 240].includes(s)) out.push(gap(a, b));
    }
    console.log(`${sp.padEnd(11)} ${f(partS, 2)}   ${f(Gp, 2)}  (start gap ${f(g0, 3)})  ${out.map((x) => f(x, 3)).join(' / ')}     ${f(peak, 2).padStart(5)}                          ${f(ydrift * 1000, 1)}`);
  }
}
