// GENESIS — the sim items of the final punch list (_harness/scratch/continue/final-reports/punch.json): each test fails
// on the tree before its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const powers = JSON.parse(readFileSync(new URL('../src/data/powers.json', import.meta.url), 'utf8')) as { powers?: unknown[] } | unknown[];
const lexicon = JSON.parse(readFileSync(new URL('../src/data/lexicon.json', import.meta.url), 'utf8')) as { fantasyAnimals: Record<string, string> };
type Pw = { id: string; name: string; desc: string; synonyms?: string[]; category: string; command: string };
const list = (Array.isArray(powers) ? powers : (powers.powers ?? [])) as Pw[];

// P01: real animals only — no power promises a fantasy beast in its name, description or search words.
test('P01 no power offers a fantasy animal (names, descriptions, search words)', () => {
  const fantasy = Object.keys(lexicon.fantasyAnimals).map((w) => w.toLowerCase());
  const bad: string[] = [];
  for (const p of list) {
    for (const t of [p.name, p.desc, ...(p.synonyms ?? [])]) {
      const words = String(t).toLowerCase();
      for (const f of fantasy) if (new RegExp(`\\b${f}\\b`).test(words)) bad.push(`${p.id}: "${t}" (${f})`);
    }
  }
  assert.deepEqual(bad, []);
  const pw = list.find((p) => p.command === 'content.animal');
  assert.ok(pw, 'the new-animal power exists');
  assert.ok(!/invent|never had/i.test(pw!.name + ' ' + pw!.desc), `named and described as a real animal brought to this world: ${pw!.name} — ${pw!.desc}`);
  assert.match(pw!.desc, /real/i);
});

// P09: the "Tidal wave" power (water.tsunami) draws its wall of water: the sim gives the render a tsunami view at the
// wave's origin, as tall as the wave, for the wave's run — and the view adds no second blow (one impulse, no area harm).
test('P09 the tidal wave power gives the render a tsunami to draw, and strikes once', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { conservedVolume } = await import('../src/sim/fields/hydrology.ts');
  const run = (cast: boolean) => {
    const sim = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n: 24 } });
    const p = sim.u.planets[0];
    let deep = -1;
    for (let c = 0; c < p.count; c++) if (p.s.ocean[c] && (deep < 0 || p.f.surface[c] < p.f.surface[deep])) deep = c;
    const P = p.grid.pos;
    const pos = [P[deep * 3], P[deep * 3 + 1], P[deep * 3 + 2]];
    const v0 = conservedVolume(p);
    const r = cast ? sim.applyNow({ k: 'water.tsunami', pos, radius: 300, height: 12 }) : null;
    return { sim, p, pos, r, v0 };
  };
  const { sim, p, pos, r } = run(true);
  assert.ok(r!.ok, r!.msg);
  const { disasterViews } = await import('../src/sim/god/disasters.ts');
  const views = () => disasterViews(sim.u, p);
  const v = views().filter((d) => d.kind === 'tsunami');
  assert.equal(v.length, 1, 'one tsunami view');
  const dot = v[0].pos[0] * pos[0] + v[0].pos[1] * pos[1] + v[0].pos[2] * pos[2];
  assert.ok(dot > 0.9999, 'drawn at the wave\'s origin');
  // the render's crest height: max(6, height * sqrt(intensity)) — the wave's own 12 m
  const H = Math.max(6, v[0].params.height * Math.sqrt(Math.max(0.2, v[0].params.intensity)));
  assert.ok(Math.abs(H - 12) < 0.5, `crest ${H} m`);
  assert.ok(r!.created?.some((x) => x.kind === 'disaster'), 'the result names the wave');
  // the view does nothing of its own: a disaster record that never fires an effector, gone when the wave has run
  const rec = sim.u.god.disasters.find((d) => d.kind === 'tsunami')!;
  sim.step(rec.life + 2);
  assert.equal(rec.fired.length, 0, 'no effector fired');
  assert.equal(rec.dead + rec.ruined, 0);
  assert.equal(views().filter((d) => d.kind === 'tsunami').length, 0, 'the view ends with the wave');
});

// P20: chronicle wording — a knowledge name may be plural ("Hand axes"): no template hangs a singular verb on it; and the
// wonder reading says what they speak of (it is shown alone in the HUD ticker)
test('P20 chronicle templates read right with plural knowledge, and the wonder line stands alone', () => {
  const ev = JSON.parse(readFileSync(new URL('../src/data/events.json', import.meta.url), 'utf8')) as { templates: { id: string; text: string[] }[] };
  const bad = ev.templates.flatMap((t) => t.text.filter((s) => /\{knowledge\} (was|is|has)\b/.test(s)).map((s) => `${t.id}: ${s}`));
  assert.deepEqual(bad, []);
  const w = ev.templates.find((t) => t.id === 'reading.wonder')!;
  for (const s of w.text) assert.ok(!/nothing else\.?$/.test(s) && /god/i.test(s), s);
});
