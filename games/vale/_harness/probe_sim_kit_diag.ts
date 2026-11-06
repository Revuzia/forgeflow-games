// probe (lane SIM, balance:real-seat, owner_rulings 22): pilot or kit? Plays a named fighter on its native role with shuffled
// natives elsewhere and reads what its casts do: per slot, the bot mode at the cast, the nearest enemy fighter, the damage to
// enemy fighters the ability did in the next 2 s, and how often it did none; statuses it landed and how they ended; its deaths
// (mode, enemies and allies within 10 m, damage taken in the last 5 s); its final items. Report only, not a gate.
//   node _harness/probe_sim_kit_diag.ts --fighters nurrow,kemdo --seeds 12 --seed0 7000 --diff veteran
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { hasStatus } from '../src/sim/status.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const FIGHTERS = opt('fighters', 'nurrow').split(',');
const SEEDS = Number(opt('seeds', '12')), SEED0 = Number(opt('seed0', '7000')), DIFF = opt('diff', 'veteran');

function loadCatalog(): CatalogT {
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) throw new Error('content build failed');
  return r.catalog;
}
function mulberry(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function lineup(c: CatalogT, focus: string, seed: number): MatchSetup {
  const mode = c.modes.find((m) => m.id === 'rift')!; const queue = c.queues.find((q) => q.mode === 'rift' && q.kind === 'standard') ?? c.queues.find((q) => q.mode === 'rift')!;
  const roles = c.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const nat = new Map<string, string[]>();
  for (const f of c.fighters) { const l = nat.get(f.role) ?? []; l.push(f.id); nat.set(f.role, l); }
  const rnd = mulberry(seed), seats: SeatSetup[] = [], fr = c.fighters.find((f) => f.id === focus)!.role;
  const draw: Record<string, string[]> = {};
  for (const r of roles) { const l = [...(nat.get(r) ?? [])].sort(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } draw[r] = l; }
  const dr = draw[fr].filter((f) => f !== focus); draw[fr] = [focus, ...dr];
  if (seed % 2) draw[fr] = [dr[0], focus, ...dr.slice(1)];
  for (let i = 0; i < mode.perTeam * 2; i++) {
    const team = Math.floor(i / mode.perTeam), role = roles[i % mode.perTeam], fighter = draw[role][team];
    const skin = c.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '';
    seats.push({ player: i, team, name: c.botNames[i % c.botNames.length], fighter, skin, role, loadout: pickLoadout(c, fighter, mode.rules.itemPool ?? '', role), controller: 'bot', botDifficulty: DIFF as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `diag-${focus}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: c.version };
}
interface Pending { slot: string; ability: string; t: number; mode: string; d: number; asleep: boolean; dmg: number; hit: boolean }
const catalog = loadCatalog();
for (const F of FIGHTERS) {
  const slots: Record<string, { n: number; hits: number; dmg: number; dist: number; asleep: number; modes: Record<string, number> }> = {};
  const deaths: { mode: string; en: number; al: number; t: number }[] = [];
  const statuses: Record<string, number> = {}; const items: Record<string, number> = {};
  let wins = 0, games = 0, mins = 0, kills = 0, dth = 0;
  for (let s = SEED0; s < SEED0 + SEEDS; s++) {
    const setup = lineup(catalog, F, s);
    const me = setup.seats.find((x) => x.fighter === F)!;
    const ctrls: (BotController | null)[] = setup.seats.map(() => null);
    const factory = createBots(catalog, setup);
    const sim = createSim(catalog, setup, { bots: (seat, host) => { const k = factory(seat, host); if (k) ctrls[seat.player] = k; return k; }, pregameSeconds: 0 });
    const pend: Pending[] = [];
    const flush = (p: Pending): void => { const a = slots[p.slot] ??= { n: 0, hits: 0, dmg: 0, dist: 0, asleep: 0, modes: {} }; a.n++; a.dist += p.d; if (p.asleep) a.asleep++; a.dmg += p.dmg; if (p.dmg > 0 || p.hit) a.hits++; a.modes[p.mode] = (a.modes[p.mode] ?? 0) + 1; };
    let done = false;
    for (let i = 0; i < 30 * 60 * 45 && !done; i++) {
      const evs: SimEvent[] = sim.step();
      const w = sim.world, ent = w.players[me.player].ent ?? w.entity(w.players[me.player].entity);
      const mode = (ctrls[me.player] as unknown as { mode?: string } | null)?.mode ?? '?';
      while (pend.length && sim.view.time - pend[0].t > 2) flush(pend.shift()!);
      for (const e of evs) {
        if (!ent) continue;
        if (e.e === 'cast' && e.src === ent.id) {
          let d = 99, asleep = false;
          for (const pl of w.players) { const f = pl.ent; if (f && f.alive && pl.team !== ent.team) { const dd = Math.hypot(f.x - ent.x, f.y - ent.y); if (dd < d) { d = dd; asleep = hasStatus(f, 'sleep'); } } }
          pend.push({ slot: e.slot, ability: e.ability, t: e.t, mode, d, asleep, dmg: 0, hit: false });
        } else if (e.e === 'damage') {
          const dst = w.entity(e.dst), cf = w.creditFighter(w.entity(e.src) ?? null);
          if (cf?.id === ent.id && dst?.kind === 'fighter' && dst.team !== ent.team && e.ability) for (let j = pend.length - 1; j >= 0; j--) if (pend[j].ability === e.ability) { pend[j].dmg += e.amount; break; }
        } else if (e.e === 'hit' && e.src === ent.id && e.ability && w.entity(e.dst)?.kind === 'fighter') {
          for (let j = pend.length - 1; j >= 0; j--) if (pend[j].ability === e.ability) { pend[j].hit = true; break; }
        } else if (e.e === 'death' && e.dst === ent.id) {
          let en = 0, al = 0;
          for (const pl of w.players) { const f = pl.ent; if (f && f.alive && f !== ent && Math.hypot(f.x - ent.x, f.y - ent.y) <= 10) { if (pl.team === ent.team) al++; else en++; } }
          deaths.push({ mode, en, al, t: e.t });
        }
      }
      if (sim.view.phase === 'ended') {
        done = true;
        for (const p of pend) flush(p);
        games++; mins += sim.view.time / 60;
        if (sim.view.result?.winningTeam === me.team) wins++;
        const pl = w.players[me.player]; kills += pl.kills ?? 0; dth += pl.deaths ?? 0;
        for (const id of pl.items) if (id) items[id] = (items[id] ?? 0) + 1;
      }
    }
  }
  console.log(`== ${F}: ${games} games, wins ${wins}, ${(mins / Math.max(1, games)).toFixed(1)} min, K ${(kills / Math.max(1, games)).toFixed(1)} D ${(dth / Math.max(1, games)).toFixed(1)}`);
  for (const [k, a] of Object.entries(slots).sort()) {
    if (!/^(a[123]|ult)$/.test(k)) continue;
    console.log(`  ${k}: ${(a.n / Math.max(1, mins)).toFixed(2)}/min, hit a fighter ${(100 * a.hits / a.n).toFixed(0)} %, dmg per cast ${(a.dmg / a.n).toFixed(0)}, per hit ${(a.dmg / Math.max(1, a.hits)).toFixed(0)}, nearest enemy ${(a.dist / a.n).toFixed(1)} m, nearest asleep ${(100 * a.asleep / a.n).toFixed(0)} %, modes ${Object.entries(a.modes).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([m, v]) => `${m} ${(100 * v / a.n).toFixed(0)}`).join(' ')}`);
  }
  const dm: Record<string, number> = {}; let en = 0, al = 0;
  for (const d of deaths) { dm[d.mode] = (dm[d.mode] ?? 0) + 1; en += d.en; al += d.al; }
  console.log(`  deaths ${deaths.length}: modes ${Object.entries(dm).sort((x, y) => y[1] - x[1]).map(([m, v]) => `${m} ${v}`).join(' ')}; enemies near ${(en / Math.max(1, deaths.length)).toFixed(1)}, allies near ${(al / Math.max(1, deaths.length)).toFixed(1)}`);
  console.log(`  items: ${Object.entries(items).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([m, v]) => `${m} ${v}`).join(' ')}`);
  void statuses;
}
