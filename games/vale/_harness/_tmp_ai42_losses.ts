// tmp (lane AI pass 2, 2026-11-16): why does veteran lose a mirror to novice? Replays one soak mirror game
// (--lineup shuffle seating) and, at every structure the given team loses, prints each fighter's mode, distance, health
// and the bodies at the structure. Observes only.
//   node _harness/_tmp_ai42_losses.ts <seed> <diff team0> <diff team1> [watchTeam]
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const [seedS = '17', d0 = 'novice', d1 = 'veteran', wS] = process.argv.slice(2);
const seed = Number(seedS);
const catalog = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
const mode = catalog.modes.find((m) => m.id === 'rift')!;
const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
const natives = new Map<string, string[]>();
for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
for (const l of natives.values()) l.sort();
function shuffled(): Record<string, string[]> {
  let a = (seed * 2654435761) >>> 0;
  const rnd = (): number => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: Record<string, string[]> = {};
  for (const role of roles) { const l = (natives.get(role) ?? []).slice(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } out[role] = l; }
  return out;
}
const sh = shuffled();
const seats: SeatSetup[] = [];
for (let i = 0; i < 10; i++) {
  const team = Math.floor(i / 5), slot = i % 5, role = roles[slot % roles.length];
  const fighter = sh[role][team];
  const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '';
  seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role, loadout: pickLoadout(catalog, fighter, mode.rules.itemPool ?? '', role),
    controller: 'bot', botDifficulty: (team === 0 ? d0 : d1) as SeatSetup['botDifficulty'], colorIndex: i });
}
const setup: MatchSetup = { matchId: `soak-rift-${seed}-${d0}-${d1}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
const ctrls: (BotController | null)[] = seats.map(() => null);
const factory = createBots(catalog, setup);
const sim = createSim(catalog, setup, { bots: (s, h) => { const c = factory(s, h); ctrls[s.player] = c; return c; }, pregameSeconds: 0 });
const watch = wS !== undefined ? Number(wS) : d0 === 'veteran' ? 0 : 1;
const C = (p: number) => ctrls[p] as unknown as { mode: string; brain?: { group: boolean; press: boolean; window: boolean; rush: boolean; stage: boolean; siege: { x: number; y: number } | null; guard: Map<number, { sid: string }>; gleamLead: number; objective: { camp?: { id?: string } } | null; splitSeat: number } };
const f1 = (x: number) => x.toFixed(0);
let kills = [0, 0];
let nextT = 600;
while (sim.view.phase !== 'ended' && sim.world.time < 3600) {
  const evs: SimEvent[] = sim.step();
  const w = sim.world;
  for (const e of evs) {
    if (e.e === 'death' && e.kind === 'fighter') { const pi = w.players.findIndex((p) => p.entity === e.dst); if (pi >= 0) kills[1 - w.players[pi].team]++; }
    if (e.e === 'structure') {
      const ent = w.entity(e.id);
      const tag = e.team === watch ? 'LOST' : 'took';
      const sx = ent?.x ?? 0, sy = ent?.y ?? 0;
      let line = `${(e.t / 60).toFixed(1)}m ${tag} ${e.def} (team ${e.team}) k ${kills.join('-')} |`;
      for (const pl of w.players) {
        const f = pl.ent; const c = C(pl.player);
        const d = f ? Math.hypot(f.x - sx, f.y - sy) : -1;
        line += ` ${pl.team === watch ? 'W' : 'o'}${pl.player}:${f && f.alive ? `${c.mode}@${f1(d)}m/${Math.round(f.hp / f.maxHp * 100)}%` : `dead${f ? '(' + ')' : ''}`}`;
      }
      const b = C(watch * 5).brain;
      if (b) line += ` | brain group ${b.group} press ${b.press} window ${b.window} rush ${b.rush} stage ${b.stage} lead ${Math.round(b.gleamLead)} obj ${b.objective?.camp?.id ?? '-'} split ${b.splitSeat} guard ${[...b.guard].map(([p, g]) => p + '>' + g.sid).join(',')}`;
      console.log(line);
    }
  }
  if (w.time >= nextT) {
    nextT += 120;
    const b = C(watch * 5).brain;
    let line = `-- ${(w.time / 60).toFixed(0)}m k ${kills.join('-')} modes:`;
    for (const pl of w.players) { const f = pl.ent; line += ` ${pl.team === watch ? 'W' : 'o'}${pl.player}:${f && f.alive ? C(pl.player).mode : 'dead'}`; }
    if (b) line += ` | group ${b.group} press ${b.press} window ${b.window} rush ${b.rush} stage ${b.stage} lead ${Math.round(b.gleamLead)}`;
    console.log(line);
  }
}
console.log('winner', (sim.view as unknown as { winner?: number }).winner, 'at', (sim.world.time / 60).toFixed(1));
