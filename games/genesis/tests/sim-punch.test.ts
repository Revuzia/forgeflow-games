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

// P02: villagers hunt where game exists. The stone-age band of "Two worlds" knows hunting from the start (it did not, and no
// party went out in the owner's first ten game days), and a town with game in range keeps hunters for two parties by its
// able adults even with the store full (round 4: the hunters were a share of the food workers left after the farmers and
// herders — none at all in 784 of 1341 daylight town-hours over 8 worlds), without taking its priest, healer or teachers.
test('P02 the Two worlds band knows hunting and sends out a party on its first day', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const sim = new Sim({ seed: 1, scenario: 'twoworlds' });
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const k = x.rt.byId.get('hunting');
  const sts = p.people.settlements.filter((st) => st.fallen < 0);
  assert.ok(sts.length && sts.every((st) => k !== undefined && st.library.includes(k)), 'the band on Gaia knows hunting at the start');
  let party = false;
  for (let h = 0; h < 18 && !party; h++) { sim.step(60); party = sts.some((st) => !!st.land?.party); }
  assert.ok(party, 'a hunting party sets out within the first 18 hours');
});

test('P02 a town with game in range keeps hunters for two parties though its store is full, and keeps its priest', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { assignRoles } = await import('../src/sim/people/settlement.ts');
  const { ROLE } = await import('../src/sim/people/defs.ts');
  const { AgentFlag } = await import('../src/sim/types.ts');
  const { HUNT_TWO, PARTY_MIN, bestGame } = await import('../src/sim/people/hunt.ts');
  const sim = new Sim({ seed: 1, scenario: 'twoworlds' });
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const st = p.people.settlements.find((s) => s.fallen < 0)!;
  const adults = (x.ps.members.get(st.id) ?? []).filter((m) => !(x.A.flags[m] & AgentFlag.child) && !x.A.mission[m]);
  assert.ok(adults.length >= HUNT_TWO, `a town of ${HUNT_TWO}+ adults (${adults.length})`);
  assert.ok(bestGame(x, st, st.pos, PARTY_MIN, false), 'game within range');
  // a full store: few food workers wanted
  st.store[x.c.items.idx('berries')] = 20000;
  for (const id of ['hunting', 'religion']) { const k = x.rt.byId.get(id); if (k !== undefined && !st.library.includes(k)) st.library.push(k); }
  assignRoles(x, st);
  let hunters = 0;
  for (const m of adults) if (x.A.role[m] === ROLE.hunter) hunters++;
  assert.ok(st.quota[ROLE.hunter] >= 2 * PARTY_MIN && hunters >= 2 * PARTY_MIN, `hunters for two parties (quota ${st.quota[ROLE.hunter]}, dealt ${hunters})`);
  assert.ok(st.quota[ROLE.priest] >= 1, 'the priest is kept');
});

// P04: a dock stands on the shore with its pier out over the water — on its dry cell's water side, in the outer part
// toward the water (the shore is drawn between the two cell centres), facing the water; before, it stood ~0.3 of the
// way toward the water's centre on any dry spot of a spiral around that point, 25-40 m short of the drawn shore, and
// faced the town.
export async function dockSites(): Promise<{ frac: number; turn: number; dry: boolean }[]> {
  const { Sim } = await import('../src/sim/sim.ts');
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { findSite } = await import('../src/sim/people/buildings.ts');
  const { distM, isLand } = await import('../src/sim/people/world.ts');
  const sim = new Sim({ seed: 1, scenario: 'twoworlds' });
  const out: { frac: number; turn: number; dry: boolean }[] = [];
  for (const p of sim.u.planets) {
    const x = makeCtx(sim.u, p);
    const t = x.c.buildings.list.findIndex((b) => b.id === 'dock');
    const P = p.grid.pos, g = p.grid;
    for (const st of p.people.settlements) {
      if (st.fallen >= 0 || !st.res || !st.res.fish.length) continue;
      const s = findSite(x, st, t);
      assert.ok(s, `a dock site for ${st.name}`);
      // the nearest water cell to the dock and the dock cell's centre: how far across toward that water it stands
      let best = Infinity, wc: number[] = [];
      for (let e = g.nbrStart[s!.cell]; e < g.nbrStart[s!.cell + 1]; e++) {
        const o = g.nbr[e];
        if (isLand(p, o) && p.f.water[o] <= 0.15) continue;
        const q = [P[o * 3], P[o * 3 + 1], P[o * 3 + 2]];
        const d = distM(p, s!.pos, q);
        if (d < best) { best = d; wc = q; }
      }
      assert.ok(best < Infinity, `${st.name}: the dock's cell borders the water`);
      const home = [P[s!.cell * 3], P[s!.cell * 3 + 1], P[s!.cell * 3 + 2]];
      const span = distM(p, home, wc);
      // its heading toward that water (rot: radians from north toward east, as buildings.ts facing())
      const u = s!.pos; const l = Math.hypot(u[0], u[1], u[2]);
      let ex = u[2], ez = -u[0]; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
      const nx = (u[1] * ez) / l, ny = (u[2] * ex - u[0] * ez) / l, nz = (-u[1] * ex) / l;
      const dx = wc[0] - u[0], dy = wc[1] - u[1], dz = wc[2] - u[2];
      const want = Math.atan2(dx * ex + dz * ez, dx * nx + dy * ny + dz * nz);
      const turn = Math.abs(Math.atan2(Math.sin(want - s!.rot), Math.cos(want - s!.rot)));
      out.push({ frac: 1 - best / span, turn, dry: isLand(p, s!.cell) && p.f.water[s!.cell] <= 0.15 });
    }
  }
  return out;
}

test('P04 a dock stands on the shore, its pier facing out over the water', async () => {
  const sites = await dockSites();
  assert.ok(sites.length >= 2, `fishing towns to place docks for (${sites.length})`);
  for (const s of sites) {
    assert.ok(s.dry, 'the dock\'s own cell is dry land');
    assert.ok(s.frac >= 0.38 && s.frac <= 0.55, `on the shore: ${s.frac.toFixed(2)} of the way from its cell's centre to the water's`);
    assert.ok(s.turn < 0.35, `facing the water (off by ${s.turn.toFixed(2)} rad)`);
  }
});

// P02 lever 2: hunters enough for two parties go out as two (after two herds), not as one crowd of four.
test('P02 the Two worlds band sends two hunting parties of two or three out at once', async () => {
  const { Sim } = await import('../src/sim/sim.ts');
  const { parties, PARTY_MIN } = await import('../src/sim/people/hunt.ts');
  const sim = new Sim({ seed: 1, scenario: 'twoworlds' });
  const sts = sim.u.planets[0].people.settlements.filter((st) => st.fallen < 0);
  let most: number[] = [];
  for (let h = 0; h < 48 && most.length < 2; h++) {
    sim.step(60);
    for (const st of sts) { const ps = parties(st); if (ps.length > most.length) most = ps.map((q) => q.members.length); }
  }
  assert.ok(most.length >= 2, `two parties out at once in the first two days (most: ${most.join('+') || 'none'})`);
  assert.ok(most.every((n) => n >= PARTY_MIN && n <= 3), `parties of two or three (${most.join('+')})`);
  assert.notEqual(new Set(sts.flatMap((st) => parties(st).map((q) => q.herd))).size, 1, 'after two herds');
});
