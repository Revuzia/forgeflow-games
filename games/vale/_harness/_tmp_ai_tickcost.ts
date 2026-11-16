// tmp (lane AI, 2026-11-15): sim cost of a 10-seat RIFT bot game, ms per tick, to 20:00.
//   node _harness/_tmp_ai_tickcost.ts [diff=veteran] [seed=3] [seconds=1200]
// Prints avg / p50 / p99 / max ms a tick for the whole sim step (bots included). Same lineup builder as probe_sim_bot_tactics.
import type { SeatSetup, MatchSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim } from '../src/sim/sim.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const [diff = 'veteran', seedS = '3', secS = '1200'] = process.argv.slice(2);
const seed = Number(seedS), seconds = Number(secS);
const catalog = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
const mode = catalog.modes.find((m) => m.id === 'rift' || m.map === 'rift') ?? catalog.modes[0];
const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
const natives = new Map<string, string[]>();
for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
for (const l of natives.values()) l.sort();
const all = catalog.fighters.map((f) => f.id).sort();
const seats: SeatSetup[] = [];
const n = mode.teams * mode.perTeam;
for (let i = 0; i < n; i++) {
  const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam, role = roles[slot % roles.length];
  const pl = natives.get(role) ?? all;
  const fighter = pl[(seed + slot + team) % pl.length];
  const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
  seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
    loadout: pickLoadout(catalog, fighter, mode.rules.itemPool ?? '', role), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
}
const setup: MatchSetup = { matchId: `cost-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
const sim = createSim(catalog, setup, { bots: createBots(catalog, setup), pregameSeconds: 0 });
const times: number[] = [];
const N = seconds * 30;
for (let i = 0; i < N && sim.view.phase !== 'ended'; i++) { const a = performance.now(); sim.step(); times.push(performance.now() - a); }
const s = [...times].sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
console.log(`${mode.id} ${diff} seed ${seed}: ${times.length} ticks, avg ${avg.toFixed(3)} ms, p50 ${s[Math.floor(s.length * 0.5)].toFixed(3)}, p99 ${s[Math.floor(s.length * 0.99)].toFixed(3)}, max ${s[s.length - 1].toFixed(2)} ms`);
