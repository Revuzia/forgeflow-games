// GENESIS — climate equilibrium regression (phase-2 review, fields/climate): a terran world's year-mean land temperature
// must not drift. The scenario build spins the energy-balance climate up against the runtime sky (cloud fraction,
// humidity greenhouse, snow and sea-ice albedo); before that fix Gaia cooled steadily for years — snow piled up, sea
// ice spread, forage died back — with no people and no herds involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';

/** year-mean land temperature per planet over `years` of each planet's own year (people and herds removed) */
function yearMeans(scenario: string, names: string[], years: number): Map<string, number[]> {
  const sim = new Sim({ seed: 20261008, scenario, overrides: { n: 24 } });
  const u = sim.u;
  for (const p of u.planets) if (p.people) {
    p.people.eco.immigration = false;
    p.people.herds = [];
    p.people.settlements.length = 0;
    const A = p.people.agents;
    for (let s = 0; s < A.hi; s++) if (A.alive[s]) A.release(s);
  }
  const planets = u.planets.filter((p) => names.includes(p.name));
  assert.equal(planets.length, names.length, `planets ${names.join(', ')} in ${scenario}`);
  const land = planets.map((p) => { const l: number[] = []; for (let c = 0; c < p.count; c++) if (p.f.water[c] < 0.1 && !p.s.ocean[c]) l.push(c); return l; });
  const acc = planets.map(() => ({ sum: 0, n: 0, years: [] as number[] }));
  const step = 360;
  const total = Math.max(...planets.map((p) => p.st.orbit.period)) * years;
  for (let t = 0; t < total; t += step) {
    sim.step(step);
    planets.forEach((p, i) => {
      let s = 0;
      for (const c of land[i]) s += p.f.temperature[c];
      const a = acc[i];
      a.sum += s / Math.max(1, land[i].length);
      a.n++;
      const yr = p.st.orbit.period;
      if (Math.floor((t + step) / yr) > Math.floor(t / yr) && a.years.length < years) { a.years.push(a.sum / a.n); a.sum = 0; a.n = 0; }
    });
  }
  return new Map(planets.map((p, i) => [p.name, acc[i].years]));
}

/** least-squares slope of a series (per step) */
function slope(v: number[]): number {
  const n = v.length, mx = (n - 1) / 2, my = v.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (v[i] - my); den += (i - mx) * (i - mx); }
  return num / den;
}

for (const [scenario, names] of [['sandbox', ['Gaia']], ['twoworlds', ['Gaia', 'Rust']]] as [string, string[]][]) {
  test(`${scenario}: the year-mean land temperature drifts by less than 0.5 °C a year over five years`, () => {
    const means = yearMeans(scenario, names, 5);
    for (const [name, v] of means) {
      assert.equal(v.length, 5, `${name}: five years measured`);
      const k = slope(v);
      assert.ok(Math.abs(k) < 0.5, `${name}: ${k.toFixed(2)} °C/yr (year means ${v.map((x) => x.toFixed(1)).join(' ')})`);
    }
  });
}
