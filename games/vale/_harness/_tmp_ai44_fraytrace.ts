// TEMP (lane AI round 2, owner_rulings 44): FRAY low-health contact. An episode: a fighter under 25 % with an enemy fighter
// within 10 m. "stayed": the nearest enemy still within 12 m 4 s later and the fighter alive; "retreated": no enemy within 12 m
// then; "died". Logs the mode at 0/1/2/4 s, whether the nearest foe was chasing (its attack target is me), the speeds, and
// the distance walked.
//   node _harness/_tmp_ai44_fraytrace.ts --diff veteran --seeds 4 --seed0 1 [--print 20]
import type { SimEvent } from '../src/contracts/sim.ts';
import type { Entity } from '../src/sim/entity.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import type { SeatSetup, MatchSetup } from '../src/contracts/sim.ts';
import type { CatalogT } from '../src/contracts/catalog.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const DIFF = opt('diff', 'veteran'), SEEDS = Number(opt('seeds', '4')), SEED0 = Number(opt('seed0', '1')), PRINT = Number(opt('print', '15'));

function frayLineup(catalog: CatalogT, seed: number, diff: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === 'fray')!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam, pool = mode.rules.itemPool ?? '';
  const all = catalog.fighters.map((f) => f.id).sort();
  const seats: SeatSetup[] = [];
  const start = (seed * n) % all.length;
  for (let i = 0; i < n; i++) {
    const fighter = all[(start + ((i + seed) % n)) % all.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team: Math.floor(i / mode.perTeam), name: catalog.botNames[i % catalog.botNames.length], fighter, skin,
      loadout: pickLoadout(catalog, fighter, pool), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `diag-fray-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

const catalog = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
const T: Record<string, number> = {};
const add = (k: string, v = 1): void => { T[k] = (T[k] ?? 0) + v; };
let printed = 0;
for (let s = SEED0; s < SEED0 + SEEDS; s++) {
  const setup = frayLineup(catalog, s, DIFF);
  const ctrls: (BotController | null)[] = setup.seats.map(() => null);
  const factory = createBots(catalog, setup);
  const sim = createSim(catalog, setup, { bots: (seat, host) => { const c = factory(seat, host); ctrls[seat.player] = c; return c; }, pregameSeconds: 0 });
  const C = (p: number) => ctrls[p] as unknown as { mode: string; recentDps: number } | null;
  const eps = new Map<number, { t: number; x: number; y: number; modes: string[]; chase: boolean; foe: number; myS: number; foeS: number; dist: number; lx: number; ly: number }>();
  const cool = new Map<number, number>();
  let g = 0;
  while (sim.view.phase !== 'ended' && g++ < 30 * 3700) {
    const evs: SimEvent[] = sim.step();
    const w = sim.world, now = w.time;
    for (const ev of evs) if (ev.e === 'death' && ev.kind === 'fighter') {
      const p = w.players.findIndex((q) => q.entity === ev.dst);
      const ep = eps.get(p); if (ep) { add('died'); add(`died.mode0:${ep.modes[0]}`); eps.delete(p); cool.set(p, now + 8); }
    }
    if (w.tick % 3 !== 0 || w.phase !== 'live') continue;
    const near = (f: Entity): { g: Entity | null; d: number } => {
      let bg: Entity | null = null, bd = Infinity;
      for (const q of w.players) { const h = q.ent; if (!h || h === f || !h.alive || h.team === f.team) continue; const d = Math.hypot(h.x - f.x, h.y - f.y); if (d < bd) { bd = d; bg = h; } }
      return { g: bg, d: bd };
    };
    for (const pl of w.players) {
      const f = pl.ent; if (!f || !f.alive) continue;
      const ep = eps.get(pl.player);
      if (ep) {
        ep.dist += Math.hypot(f.x - ep.lx, f.y - ep.ly); ep.lx = f.x; ep.ly = f.y;
        const dt = now - ep.t;
        if ([1, 2].some((x) => Math.abs(dt - x) < 0.06)) ep.modes.push(C(pl.player)?.mode ?? '?');
        if (dt >= 4) {
          const nn = near(f);
          const k = nn.d <= 12 ? 'stayed' : 'retreated';
          add(k); add(`${k}.mode0:${ep.modes[0]}`); add(`${k}.chase:${ep.chase}`); add(`${k}.faster:${ep.foeS > ep.myS + 0.1}`);
          if (k === 'stayed' && printed++ < PRINT) console.log(`s${s} p${pl.player} t${ep.t.toFixed(1)} modes ${ep.modes.join('>')}>${C(pl.player)?.mode} chase ${ep.chase} ms ${ep.myS.toFixed(2)} vs ${ep.foeS.toFixed(2)} walked ${ep.dist.toFixed(1)} m hp ${(f.hp / f.maxHp * 100).toFixed(0)}% foe d ${nn.d.toFixed(1)} foeHp ${nn.g ? (nn.g.hp / nn.g.maxHp * 100).toFixed(0) : '-'}%`);
          eps.delete(pl.player); cool.set(pl.player, now + 8);
        }
        continue;
      }
      if (f.hp >= f.maxHp * 0.25 || now < (cool.get(pl.player) ?? 0)) continue;
      const nn = near(f);
      if (!nn.g || nn.d > 10) continue;
      add('episodes');
      eps.set(pl.player, { t: now, x: f.x, y: f.y, modes: [C(pl.player)?.mode ?? '?'], chase: nn.g.atkTarget === f.id, foe: nn.g.id, myS: f.stats.moveSpeed, foeS: nn.g.stats.moveSpeed, dist: 0, lx: f.x, ly: f.y });
    }
  }
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(T).sort()), null, 1));
