// M5: what does building one piece cost today (the swap frame builds TWO bodies in one frame, cut.ts part())?  Baseline for the budget of the
// true-cut build: the region clip + radial remesh has to fit in what is left of a 16.7 ms frame after these two constructors.
const G = 'file:///C:/Users/TestRun/Claude%20Claw/squish-keeper-build/games/wobblehoard/';
const { SoftBody } = await import(G + 'src/physics/softbody.ts');
const { speciesTemplateGenome } = await import(G + 'src/data/catalog.ts');
const ms = (f: () => void, n: number): { median: number; max: number; min: number } => {
  const t: number[] = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); f(); t.push(performance.now() - a); }
  t.sort((x, y) => x - y);
  return { median: t[Math.floor(n / 2)], max: t[n - 1], min: t[0] };
};
for (const sp of ['dollop', 'twangle', 'marigel', 'skeinara']) {
  const g = speciesTemplateGenome(sp as never);
  new SoftBody(g); new SoftBody(g, { piece: { frac: 0.5, chunk: true, cutNormal: { x: 1, y: 0, z: 0 } } } as never);   // warm the JIT
  const whole = ms(() => { new SoftBody(g); }, 15);
  const face = ms(() => { new SoftBody(g, { piece: { frac: 0.5, chunk: false } } as never); }, 15);
  const chunk = ms(() => { new SoftBody(g, { piece: { frac: 0.5, chunk: true, cutNormal: { x: 1, y: 0, z: 0 } } } as never); }, 15);
  const small = ms(() => { new SoftBody(g, { piece: { frac: 0.2, chunk: true, cutNormal: { x: 1, y: 0, z: 0 } } } as never); }, 15);
  const f = (r: { median: number; max: number }): string => `${r.median.toFixed(1)} (max ${r.max.toFixed(1)})`;
  console.log(`${sp.padEnd(9)} constructor ms, median (max) of 15:  whole ${f(whole)}   face piece 0.5 ${f(face)}   chunk 0.5 ${f(chunk)}   chunk 0.2 (detail 2) ${f(small)}`);
}
