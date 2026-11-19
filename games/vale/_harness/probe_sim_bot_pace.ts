// probe (lane AI, ruling 60): a lean pace run of all-bot games — one tier on both sides, role-correct lineups as
// probe_sim_bot_tactics builds them, nothing measured but the length, whether the game ended before the cut, structure
// falls by class (first inner and first base fall, minutes) and fighter deaths. Lighter than the tactics probe,
// for paired pace A/B on many seeds.
//   node _harness/probe_sim_bot_pace.ts --diff adept --seed0 701 --seeds 64 [--cut 1800] [--mode rift] [--out x.json]
// VALE_BOTS=<dir under src/sim> swaps the bots for a paired A/B on the same tree (e.g. a copy of an older src/sim/bots).
// Every match is a pure function of (catalog, setup).
import { writeFileSync } from 'node:fs';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
const { createBots, pickLoadout } = (await import(`../src/sim/${process.env.VALE_BOTS || 'bots'}/index.ts`)) as typeof import('../src/sim/bots/index.ts');
import { createSim } from '../src/sim/sim.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
const catalog = r.catalog as CatalogT;
const modeId = opt('mode', 'rift'), diff = opt('diff', 'adept'), seed0 = Number(opt('seed0', '701')), seeds = Number(opt('seeds', '64')), cut = Number(opt('cut', '1800'));

function lineup(seed: number): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam, pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  const all = catalog.fighters.map((f) => f.id).sort();
  const roles = catalog.roles.filter((x) => x.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((x) => x.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  for (let i = 0; i < n; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam, role = roles[slot % roles.length];
    const pl = natives.get(role) ?? all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
      loadout: pickLoadout(catalog, fighter, pool, role), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `diag-${modeId}-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

const games: unknown[] = [];
for (let s = seed0; s < seed0 + seeds; s++) {
  const setup = lineup(s);
  const factory = createBots(catalog, setup);
  const sim = createSim(catalog, setup, { bots: factory, pregameSeconds: 0 });
  const W = () => sim.world;
  const depthOf = new Map<string, number>();
  {
    const defs = new Map(structuresOf(W()).map((x) => [x.def.id, x.def] as const));
    const dep = (id: string, g = 0): number => {
      if (depthOf.has(id)) return depthOf.get(id)!;
      const d = defs.get(id); if (!d || g > 10) return 0;
      const v = (d.requires ?? []).length ? 1 + Math.max(...(d.requires ?? []).map((q) => dep(q, g + 1))) : 0;
      depthOf.set(id, v); return v;
    };
    for (const id of defs.keys()) dep(id);
  }
  const g = { seed: s, dur: 0, winner: -1, end: false, falls: { outer: 0, inner: 0, base: 0 } as Record<string, number>, firstInner: 0, firstBase: 0, kills: 0 };
  let guard = 0;
  while (sim.view.phase !== 'ended' && guard++ < 30 * 3700) {
    const evs: SimEvent[] = sim.step();
    const w = W();
    if (w.time > cut) break;
    for (const ev of evs) {
      if (ev.e === 'end') { g.winner = ev.result.winningTeam; g.end = true; }
      else if (ev.e === 'structure') {
        const st = w.entity(ev.id); const x = structuresOf(w).find((q) => q.ent === st);
        if (x) { const d = depthOf.get(x.def.id) ?? 0; const c = d === 0 ? 'outer' : d === 1 ? 'inner' : 'base'; g.falls[c]++;
          if (c === 'inner' && !g.firstInner) g.firstInner = w.time / 60; if (c === 'base' && !g.firstBase) g.firstBase = w.time / 60; }
      } else if (ev.e === 'death' && ev.kind === 'fighter') g.kills++;
    }
  }
  g.dur = Math.min(W().time, cut) / 60;
  games.push(g);
}
writeFileSync(opt('out', '/dev/stdout'), JSON.stringify({ bots: process.env.VALE_BOTS || 'bots', diff, games }));
