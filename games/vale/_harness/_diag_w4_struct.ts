// diagnostic (W4 G3, scratch): who takes a team's structures in one mirrored game
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
const argv = process.argv.slice(2);
const seed = Number(argv[0] ?? 10), d0 = argv[1] ?? 'veteran', d1 = argv[2] ?? 'novice', modeId = argv[3] ?? 'rift';
const c = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog as CatalogT;
const mode = c.modes.find((m) => m.id === modeId)!;
const queue = c.queues.find((q) => q.mode === mode.id && q.kind === 'standard')!;
const roles = c.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
const natives = new Map<string, string[]>();
for (const f of c.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
for (const l of natives.values()) l.sort();
const seats: SeatSetup[] = [];
for (let i = 0; i < 10; i++) {
  const team = Math.floor(i / 5), slot = i % 5, role = roles[slot % roles.length];
  const pl = natives.get(role)!; const fighter = pl[(seed + slot + team) % pl.length];
  const skin = c.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '';
  seats.push({ player: i, team, name: `b${i}`, fighter, skin, role, loadout: pickLoadout(c, fighter, mode.rules.itemPool ?? '', role), controller: 'bot', botDifficulty: (team === 0 ? d0 : d1) as SeatSetup['botDifficulty'], colorIndex: i });
}
const setup: MatchSetup = { matchId: 'diag', seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: c.version };
const ctrls: (BotController | null)[] = [];
const f = createBots(c, setup);
const sim = createSim(c, setup, { bots: (s, h) => { const b = f(s, h); ctrls[s.player] = b; return b; }, pregameSeconds: 0 });
const modeOf = (p: number) => (ctrls[p] as unknown as { mode?: string; lane?: number } | null);
let guard = 0;
while (sim.view.phase !== 'ended' && guard++ < 30 * 3700) {
  const evs: SimEvent[] = sim.step();
  for (const e of evs) {
    if (e.e !== 'structure') continue;
    const w = sim.world; const st = w.entity(e.id);
    const x = st?.x ?? 0, y = st?.y ?? 0;
    const near = (team: number, kind: string, r: number) => w.entities.filter((u) => u.alive && u.kind === kind && u.team === team && (u.x - x) ** 2 + (u.y - y) ** 2 <= r * r).length;
    const ef = near(1 - e.team, 'fighter', 14), af = near(e.team, 'fighter', 14), ew = near(1 - e.team, 'minion', 12);
    const own = w.players.filter((p) => p.team === e.team).map((p) => `${modeOf(p.player)?.mode ?? '?'}${p.ent?.alive ? '' : '(dead)'}`).join(',');
    const b = (sim as unknown as { world: unknown });
    void b;
    console.log(`${(e.t / 60).toFixed(1)}m ${e.def} t${e.team} by ${e.destroyedBy}: enemy fighters ${ef}, enemy wicks ${ew}, own fighters ${af} | own modes ${own}`);
  }
}
const r = sim.view.result!;
console.log(`end ${(r.duration / 60).toFixed(1)} winner ${r.winningTeam}; kills ${r.players.slice(0, 5).reduce((a, p) => a + p.kills, 0)}-${r.players.slice(5).reduce((a, p) => a + p.kills, 0)}`);
