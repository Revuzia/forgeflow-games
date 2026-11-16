// TEMP (lane AI round 2, owner_rulings 44): why a partner standing beside a dived carry does not hit the diver.
// For every episode (a carry — marksman, artillery, burst — taking 20 % of its health from enemy fighters in 2.5 s) it
// logs each ally within 6 m: role, mode at 0 / 0.5 / 1 / 2 s, protect utility, whether it damaged or CC'd a diver in 3 s.
//   node _harness/_tmp_ai44_peeltrace.ts --diff veteran --seeds 6 --seed0 1 [--live]   (--live: the live verifier's lineup)
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const DIFF = opt('diff', 'veteran'), SEEDS = Number(opt('seeds', '6')), SEED0 = Number(opt('seed0', '1')), CUT = Number(opt('cut', '1500'));
const LIVE = argv.includes('--live');

export function tacticsLineup(catalog: CatalogT, modeId: string, seed: number, diff: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam;
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const all = catalog.fighters.map((f) => f.id).sort();
  for (let i = 0; i < n; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam, role = roles[slot % roles.length];
    const pl = natives.get(role) ?? all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
      loadout: pickLoadout(catalog, fighter, pool, role), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `t-${modeId}-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}
/** the live verifier's lineup (_harness/web/_tmp_ai_live.ts buildSetup), seat 0 played by a bot of the same tier */
export function liveLineup(catalog: CatalogT, modeId: string, seed: number, diff: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam;
  const ffa = mode.rules.end.kind === 'last_standing_or_score' || mode.pick === 'ffa_pick';
  const fighters = catalog.fighters.map((f) => f.id);
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
  const seats: SeatSetup[] = [];
  for (let i = 0; i < n; i++) {
    const fighter = fighters[(i * 7 + 3) % fighters.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team: ffa ? i : Math.floor(i / mode.perTeam), name: catalog.botNames[(i * 5 + 1) % catalog.botNames.length], fighter, skin,
      role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
      loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
      controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `bench-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

if (process.argv[1]?.endsWith('_tmp_ai44_peeltrace.ts')) {
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  const catalog = r.catalog!;
  const carryStyles = new Set(['marksman', 'artillery', 'burst']);
  const styleOf = new Map(catalog.fighters.map((f) => [f.id, (f as unknown as { ai?: { style?: string } }).ai?.style ?? '']));
  const tally: Record<string, number> = {};
  const add = (k: string): void => { tally[k] = (tally[k] ?? 0) + 1; };
  for (let s = SEED0; s < SEED0 + SEEDS; s++) {
    const setup = LIVE ? liveLineup(catalog, 'rift', s, DIFF) : tacticsLineup(catalog, 'rift', s, DIFF);
    const ctrls: (BotController | null)[] = setup.seats.map(() => null);
    const factory = createBots(catalog, setup);
    const sim = createSim(catalog, setup, { bots: (seat, host) => { const c = factory(seat, host); ctrls[seat.player] = c; return c; }, pregameSeconds: 0 });
    const C = (p: number) => ctrls[p] as unknown as { mode: string; support: boolean; jungle: boolean; lane: number; protectU: number; protectAlly: { id: number } | null; pFight: { id: number } | null; protectDiver: { id: number } | null; dodgeUntil: number; pMoveX: number; pMoveY: number } | null;
    const log = new Map<number, { t: number; a: number; src: number }[]>();
    const eps: { v: number; t: number; divers: Set<number>; helpers: { p: number; id: number; d: number; modes: string[]; pu: number[]; hit: boolean; cc: boolean; heal?: boolean; any?: boolean; anyF?: boolean }[]; done: boolean }[] = [];
    const cool = new Map<number, number>();
    let g = 0;
    while (sim.view.phase !== 'ended' && g++ < 30 * 3700) {
      const evs: SimEvent[] = sim.step();
      const w = sim.world, now = w.time;
      if (now > CUT) break;
      for (const ev of evs) {
        if (ev.e === 'damage') {
          const dst = w.entity(ev.dst), src0 = w.entity(ev.src); const src = src0 ? w.creditFighter(src0) : null;
          if (!dst || !src || dst.kind !== 'fighter' || src.team === dst.team) continue;
          let l = log.get(dst.id); if (!l) { l = []; log.set(dst.id, l); } l.push({ t: now, a: ev.amount, src: src.id });
          for (const ep of eps) if (!ep.done && ep.v === dst.id) for (const h of ep.helpers) if (h.id === src.id) h.any = true;
          for (const ep of eps) if (!ep.done) for (const h of ep.helpers) if (h.id === src.id) h.anyF = true;
          for (const ep of eps) if (!ep.done && ep.divers.has(dst.id)) for (const h of ep.helpers) if (h.id === src.id) h.hit = true;
          if (ep0(dst.id)) ep0(dst.id)!.divers.add(src.id);
        } else if (ev.e === 'heal' || ev.e === 'shield') {
          const src0 = w.entity((ev as { src: number }).src); const src = src0 ? w.creditFighter(src0) : null;
          for (const ep of eps) if (!ep.done && ep.v === (ev as { dst: number }).dst) for (const h of ep.helpers) if (src && h.id === src.id) h.heal = true;
        } else if (ev.e === 'status') {
          const src0 = w.entity((ev as unknown as { src?: number }).src ?? -1); const src = src0 ? w.creditFighter(src0) : null;
          for (const ep of eps) if (!ep.done && ep.divers.has(ev.dst)) for (const h of ep.helpers) if (src && h.id === src.id) h.cc = true;
        }
      }
      function ep0(v: number) { for (const ep of eps) if (!ep.done && ep.v === v) return ep; return null; }
      if (w.tick % 5 !== 0) continue;
      for (const pl of w.players) {
        const v = pl.ent; if (!v || !v.alive) continue;
        if (!carryStyles.has(styleOf.get(v.def) ?? '')) continue;
        const l = log.get(v.id); if (l) while (l.length && now - l[0].t > 2.5) l.shift();
        const burst = l ? l.reduce((a, x) => a + x.a, 0) : 0;
        if (burst < v.maxHp * 0.2 || ep0(v.id) || now < (cool.get(v.id) ?? 0)) continue;
        const helpers = [];
        for (const q of w.players) { const a = q.ent; if (!a || a === v || !a.alive || a.team !== v.team) continue; const d = Math.hypot(a.x - v.x, a.y - v.y); if (d <= 6) helpers.push({ p: q.player, id: a.id, d, modes: [] as string[], pu: [] as number[], hit: false, cc: false }); }
        if (!helpers.length) continue;
        eps.push({ v: v.id, t: now, divers: new Set(l ? l.map((x) => x.src) : []), helpers, done: false });
        cool.set(v.id, now + 6);
      }
      for (const ep of eps) {
        if (ep.done) continue;
        const dt = now - ep.t;
        for (const h of ep.helpers) if ([0, 0.5, 1, 2].some((x) => Math.abs(dt - x) < 0.09)) { const c = C(h.p); const he = w.entity(h.id)!; const pf = c?.pFight ? w.entity(c.pFight.id) : null; h.modes.push(`${c?.mode ?? '?'}[f${c?.pFight?.id ?? '-'} d${c?.protectDiver?.id ?? '-'} dg${(c?.dodgeUntil ?? 0) > now ? 1 : 0} at${he.atkTarget} o${he.order} r${pf ? Math.hypot(pf.x - he.x, pf.y - he.y).toFixed(1) : '-'}/${he.stats.range.toFixed(1)} mv${Math.hypot((c?.pMoveX ?? 0) - he.x, (c?.pMoveY ?? 0) - he.y).toFixed(1)}]`); h.pu.push(+(C(h.p)?.protectU ?? 0).toFixed(2)); }
        if (dt >= 3) {
          ep.done = true;
          for (const h of ep.helpers) {
            const c = C(h.p)!;
            const role = c.support ? 'support' : c.jungle ? 'jungle' : 'lane';
            const resp = h.hit || h.cc || !!h.heal;
            if (!resp) add(`${role}:none.hitOtherFighter:${!!h.anyF}`);
            add(`${role}:${resp ? 'resp' : 'none'}`);
            if (!resp) { add(`none.mode0:${h.modes[0]}`); add(`none.mode1:${h.modes[2] ?? '?'}`); }
            if (!resp && (role === 'support' || argv.includes('--all'))) console.log(`s${s} t${ep.t.toFixed(1)} v${ep.v} ${role} p${h.p} d${h.d.toFixed(1)} modes ${h.modes.join('>')} pu ${h.pu.join('/')} divers ${[...ep.divers].join(',')}`);
          }
        }
      }
    }
  }
  console.log(JSON.stringify(tally, null, 1));
}
