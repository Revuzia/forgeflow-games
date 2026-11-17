// VERIFIER tmp: trace one Wick. node _harness/_tmp_vfy_laneline_trace.ts <map> <seed> <bots 0|1> <id> <t0> <t1>
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import type { SeatSetup, MatchSetup } from '../src/contracts/sim.ts';
const [map, seedS, botsS, idS, t0S, t1S] = process.argv.slice(2);
const seed = +seedS, id = +idS, t0 = +t0S, t1 = +t1S;
const catalog = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
const mode = catalog.modes.find((m) => m.id === map)!;
const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
const roles = catalog.roles.filter((x) => x.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((x) => x.id);
const natives = new Map<string, string[]>();
for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
for (const l of natives.values()) l.sort();
const all = catalog.fighters.map((f) => f.id).sort();
const seats: SeatSetup[] = [];
for (let i = 0; i < mode.teams * mode.perTeam; i++) {
  const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam; const role = mode.roles ? roles[slot % roles.length] : undefined;
  const pl = (role && natives.get(role)) || all; const fighter = pl[(seed + slot + team) % pl.length];
  const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
  seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role, loadout: pickLoadout(catalog, fighter, mode.rules.itemPool ?? '', role), controller: 'bot', botDifficulty: 'adept', colorIndex: i } as SeatSetup);
}
const setup: MatchSetup = { matchId: `vfyll-${map}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
const sim = createSim(catalog, setup, { bots: botsS === '1' ? createBots(catalog, setup) : () => null, pregameSeconds: 0 });
while (worldOf(sim).time < t1) {
  sim.step(); const w = worldOf(sim);
  if (w.time < t0 || w.tick % 3) continue;
  const e = w.entities.find((x) => x.id === id); if (!e) continue;
  const m = minionState(e) as any;
  console.log(`${w.time.toFixed(2)} (${e.x.toFixed(2)},${e.y.toFixed(2)}) v(${e.vx.toFixed(2)},${e.vy.toFixed(2)}) order ${e.order} tgt ${e.orderX?.toFixed?.(1)},${e.orderY?.toFixed?.(1)} atk ${e.atkTarget ?? '-'} chasing ${m?.chasing} flank ${m?.flankUntil > w.tick} pass ${e.passOwn} navpath ${e.path?.length ?? 0} dash ${!!e.dash} cc ${e.ccMask} wp ${m?.wp} last ${m?.lastWpX?.toFixed(1)},${m?.lastWpY?.toFixed(1)} alive ${e.alive}`);
}
