// adversarial verifier (controls r1, SIM lens): an INDEPENDENT Wick stuck sweep. Own detector, own scenarios, fresh seeds.
//   node _harness/_tmp_vfy_ctl_r1_wicks.ts [--seeds 8] [--seed0 101] [--minutes 25]
// scenarios:  bots   all ten seats played by the usual seat players (natural tower falls)
//             falls  fighters stand at spawn; outer towers of EVERY road (both teams) fall at seed-varied times, inners later
//             block  seat 0 scripted: parks on a random road's own outer tower neck, crosses it, shoots in place; others played
// detector (own): FROZEN = a living Wick that for 6 s covers < 0.75 m of ground, starts no swing (atkAnim/windup), no CC/cast,
//   > 8 m from its path's end. Classified: FREE (no attackable enemy within aggro+1.5 m) = stuck; else NEAR-FIGHT (reported).
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { killEntity } from '../src/sim/combat.ts';
import { attackable } from '../src/sim/attack.ts';
import { CC_HARD, CC_ROOT, type Entity } from '../src/sim/entity.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { behaviorOf } from '../src/sim/units/common.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = Number(opt('seeds', '8')), SEED0 = Number(opt('seed0', '101')), MINUTES = Number(opt('minutes', '25'));
const MAPS = opt('maps', 'rift,bridge').split(','), SCENS = opt('scen', 'bots,falls,block').split(',');
const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
const catalog: CatalogT = built.catalog!;
const f1 = (n: number): string => n.toFixed(1);

function lineup(modeId: string, seed: number, human0: boolean, diff: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const all = catalog.fighters.map((f) => f.id).sort();
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  for (let i = 0; i < mode.teams * mode.perTeam; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length] : undefined;
    const pl = all.filter((f) => !role || catalog.fighters.find((x) => x.id === f)!.role === role);
    const fighter = (pl.length ? pl : all)[(seed * 7 + slot * 3 + team * 5) % (pl.length || all.length)];
    const skin = catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: `p${i}`, fighter, skin, role, loadout: pickLoadout(catalog, fighter, pool, role),
      controller: i === 0 && human0 ? 'human' : 'bot', botDifficulty: diff, colorIndex: i } as SeatSetup);
  }
  return { matchId: `vfy-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

const near: Entity[] = [];
function fighting(w: ReturnType<typeof worldOf>, e: Entity): boolean {
  const r = (e.unit ? behaviorOf(e.unit).aggroRange : 7) + 1.5;
  const n = w.query(e.x, e.y, r, near);
  for (let i = 0; i < n; i++) if (near[i] !== e && attackable(w, e, near[i])) return true;
  return false;
}

interface Ep { map: string; scen: string; seed: number; t: string; id: number; team: number; at: string; kind: string; struct: string; order: number; path: number }
const eps: Ep[] = [];
let totalWicks = 0, runs = 0;
for (const map of MAPS) for (const scen of SCENS) for (let seed = SEED0; seed < SEED0 + SEEDS; seed++) {
  const t0 = Date.now();
  const diffs = ['novice', 'adept', 'veteran'];
  const setup = lineup(map, seed, scen !== 'bots', diffs[seed % 3]);
  const fac = scen === 'falls' ? null : createBots(catalog, setup);
  const sim = createSim(catalog, setup, { bots: fac ?? (() => null), pregameSeconds: 0 });
  const w0 = worldOf(sim);
  const roads = w0.mapDef.lanes;
  const sched: { t: number; team: number; road: string; tier: RegExp; done: boolean }[] = [];
  if (scen === 'falls') {
    roads.forEach((l, i) => {
      for (const team of [0, 1]) {
        const ta = 150 + ((seed * 37 + i * 61 + team * 23) % 420);
        sched.push({ t: ta, team, road: l.id, tier: /outer/, done: false });
        sched.push({ t: ta + 120 + ((seed + i) % 4) * 60, team, road: l.id, tier: /inner/, done: false });
      }
    });
  }
  const me = w0.players[0].ent!;
  const roadB = roads[seed % roads.length].id;
  let phase = 0, until = 0;
  const seen = new Set<number>();
  const trk = new Map<number, { t: number; x: number; y: number }>();
  const limit = MINUTES * 60 * 30;
  let tick = 0;
  for (; sim.view.phase !== 'ended' && tick < limit; tick++) {
    sim.step();
    const w = worldOf(sim);
    if (w.phase !== 'live') continue;
    for (const sc of sched) {
      if (sc.done || w.time < sc.t) continue;
      sc.done = true;
      for (const s of structuresOf(w)) if (s.ent.alive && s.ent.team === sc.team && (s.def.lane ?? '') === sc.road && sc.tier.test(s.def.unit)) { killEntity(w, s.ent, null); break; }
    }
    if (scen === 'block' && me.alive && w.time > 70) {
      const tw = structuresOf(w).filter((s) => s.ent.team === me.team && (s.def.lane ?? '') === roadB && s.ent.alive && s.def.unit !== undefined)
        .sort((a, b) => /outer/.test(a.def.unit) ? -1 : /outer/.test(b.def.unit) ? 1 : 0)[0];
      if (tw) {
        const road = roads.find((l) => l.id === roadB)!.path;
        // the road point nearest the tower and the road direction (team 0 marches path order or reverse: use next point)
        let bi = 0, bd = Infinity;
        for (let i = 0; i < road.length; i++) { const d = Math.hypot(road[i][0] - tw.ent.x, road[i][1] - tw.ent.y); if (d < bd) { bd = d; bi = i; } }
        const a = road[Math.max(0, bi - 1)], b = road[Math.min(road.length - 1, bi + 1)];
        const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / dl, uy = (b[1] - a[1]) / dl;
        const cx = (road[bi][0] + tw.ent.x) / 2, cy = (road[bi][1] + tw.ent.y) / 2;
        if (w.tick >= until) {
          phase++; until = w.tick + 30 * (2 + (phase % 4));
          if (me.hp < me.maxHp * 0.25) sim.command(0, { type: 'recall' });
          else if (phase % 3 === 0) sim.command(0, { type: 'move', x: cx, y: cy });
        }
        if (phase % 3 === 1 && w.tick % 15 === 0) sim.command(0, { type: 'move', x: cx + ux * 8, y: cy + uy * 8 });
        if (phase % 3 === 2 && w.tick % 3 === 0) sim.command(0, { type: 'attackAt', x: cx - ux * 6 + (w.tick % 7) - 3, y: cy - uy * 6 });
      }
    }
    const TR = process.env.TR ? process.env.TR.split(',').map(Number) : null;   // id,from,to (s)
    if (TR && w.time >= TR[1] && w.time <= TR[2] && w.tick % 15 === 0) {
      const e = w.entity(TR[0]);
      if (e && e.alive) {
        const ot = w.entity(e.orderTarget);
        const touch = w.entities.filter((o) => o !== e && o.alive && o.kind === 'minion' && o.team === e.team && Math.hypot(o.x - e.x, o.y - e.y) < e.radius + o.radius + 0.3).length;
        const foes = w.entities.filter((o) => o.alive && o.team !== e.team && o.team >= 0 && o.kind !== 'projectile' && o.kind !== 'zone' && Math.hypot(o.x - e.x, o.y - e.y) < 6).map((o) => `${o.kind[0]}${o.unit ?? o.def}@${f1(Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius)}${o.targetable ? '' : 'U'}${(o.visibleMask >> e.team) & 1 ? '' : 'H'}`);
        console.log(`  tr t${f1(w.time)} ${e.unit} (${f1(e.x)},${f1(e.y)}) r${f1(e.radius)} rng${f1(e.attackDef?.range ?? 0)} ord${e.order} ot ${ot ? `${ot.kind}:${ot.unit ?? ot.def} gap ${f1(Math.hypot(ot.x - e.x, ot.y - e.y) - ot.radius - e.radius)} ${ot.alive ? '' : 'DEAD'}` : '-'} cd${f1(e.atkCd)} wd${f1(e.atkWindup)} np${e.noProgress} touch${touch} foes[${foes.join(' ')}]`);
      }
    }
    if (w.tick % 10 !== 0) continue;
    for (const e of w.entities) {
      if (e.kind !== 'minion' || !e.alive) continue;
      const m = minionState(e); if (!m) continue;
      if (!seen.has(e.id)) { seen.add(e.id); totalWicks++; }
      const end = m.path[m.path.length - 1];
      const tr = trk.get(e.id);
      const reset = !tr || e.atkWindup >= 0 || e.atkAnim > 0 || e.cast || (e.ccMask & (CC_HARD | CC_ROOT)) !== 0
        || Math.hypot(e.x - tr.x, e.y - tr.y) >= 0.75 || Math.hypot(e.x - end[0], e.y - end[1]) < 8;
      if (reset) { trk.set(e.id, { t: w.tick, x: e.x, y: e.y }); continue; }
      if (w.tick - tr.t >= 180) {
        let sd = Infinity, sn = '';
        for (const s of structuresOf(w)) { const d = Math.hypot(s.ent.x - e.x, s.ent.y - e.y) - s.ent.radius; if (d < sd) { sd = d; sn = `${s.def.id}${s.ent.alive ? '' : '(fallen)'} ${f1(d)}`; } }
        eps.push({ map, scen, seed, t: `${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`, id: e.id, team: e.team,
          at: `(${f1(e.x)},${f1(e.y)})`, kind: fighting(w, e) ? 'near-fight' : 'FREE', struct: sn, order: e.order, path: e.path.length >> 1 });
        trk.set(e.id, { t: w.tick, x: e.x, y: e.y });
      }
    }
    for (const id of trk.keys()) { const e = w.entity(id); if (!e || !e.alive) trk.delete(id); }
  }
  runs++;
  const mine = eps.filter((p) => p.map === map && p.scen === scen && p.seed === seed);
  console.log(`${map} ${scen} s${seed}: ${f1(worldOf(sim).time / 60)} min, FREE ${mine.filter((p) => p.kind === 'FREE').length}, near-fight ${mine.filter((p) => p.kind !== 'FREE').length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  for (const p of mine.slice(0, 5)) console.log('   ', JSON.stringify(p));
}
const free = eps.filter((p) => p.kind === 'FREE').length;
console.log(`RESULT runs ${runs} wicks ${totalWicks} FREE-frozen ${free} near-fight-frozen ${eps.length - free}`);
