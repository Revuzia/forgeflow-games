// tmp (verifier, lane AI round 1 / ruling 42): FOG HONESTY by hidden-state perturbation + DETERMINISM.
//   node _harness/_tmp_vfy_ai42_fog.ts <diff> <seeds> <seed0> [mode=rift] [checkpoints=360,840,1320]
// For each seed: sim A runs the match; at each checkpoint a twin B_k (stepped in lockstep with A from tick 0, so the two
// instances interleave in one process — a shared-module-state leak shows as a hash mismatch) is checked bit-equal to A,
// then every team-1 entity that team 0 cannot see AND that is > 20 m from every team-0 unit gets perturbed in B_k only
// (fighters: hp ×0.4, ability cooldowns zeroed, nudged 1.2 m; Wicks/summons: hp ×0.5). Team 0's commands (and bot mode /
// fight target / move point) are compared for the next 2 ticks (tick 2 only while every perturbed entity is still hidden
// from team 0 in both sims). Any difference = a decision read hidden state. Symmetric check with teams swapped.
import type { MatchSetup, SeatSetup, Command } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import type { Entity } from '../src/sim/entity.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const [diff = 'veteran', seedsS = '4', seed0S = '301', modeArg = 'rift', cpS = '360,840,1320'] = process.argv.slice(2);
const catalog = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
const CPS = cpS.split(',').map(Number);

function lineup(modeId: string, seed: number): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam, pool = mode.rules.itemPool ?? '';
  const all = catalog.fighters.map((f) => f.id).sort();
  const seats: SeatSetup[] = [];
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  for (let i = 0; i < n; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length] : undefined;
    const pl = role ? natives.get(role) ?? all : all;
    const fighter = role ? pl[(seed * 3 + slot * 5 + team * 7) % pl.length] : all[(seed * n + i * 3) % all.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, ...(role ? { role } : {}),
      loadout: pickLoadout(catalog, fighter, pool, role), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `vfy-${modeId}-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

interface Inst { sim: ReturnType<typeof createSim>; cmds: Map<number, string>; ctrls: (BotController | null)[] }
function make(setup: MatchSetup): Inst {
  const factory = createBots(catalog, setup);
  const cmds = new Map<number, string>();
  const ctrls: (BotController | null)[] = setup.seats.map(() => null);
  const bots = (seat: SeatSetup, host: Parameters<typeof factory>[1]): BotController | null => {
    const c = factory(seat, host); ctrls[seat.player] = c ?? null;
    if (!c) return null;
    return { think(w, p) { const r: readonly Command[] = c.think(w, p); cmds.set(p.player, JSON.stringify(r)); return r; } };
  };
  return { sim: createSim(catalog, setup, { bots, pregameSeconds: 0 }), cmds, ctrls };
}
function fnv(s: string, h = 2166136261): number { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function hashWorld(i: Inst): number {
  const w = i.sim.world; let h = fnv(`${w.tick}|${w.time}`);
  for (const e of w.entities) if (!e.removed) h = fnv(`${e.id},${e.kind},${e.x},${e.y},${e.hp},${e.alive ? 1 : 0},${e.atkTarget},${e.order}`, h);
  for (const t of w.teams) h = fnv(`${t.team}:${t.gold}`, h);
  return h;
}
function decision(i: Inst, p: number): string {
  const c = i.ctrls[p] as unknown as { mode?: string; pFight?: Entity | null; pMoveX?: number; pMoveY?: number; pMove?: boolean } | null;
  return `${i.cmds.get(p) ?? ''}|${c?.mode}|${c?.pFight?.id ?? -1}|${c?.pMove ? `${c?.pMoveX},${c?.pMoveY}` : '-'}`;
}

let checks = 0, diffs1 = 0, diffs2 = 0, checks2 = 0, hashMis = 0, perturbedN = 0, noTargets = 0;
const report: string[] = [];
const t0 = Date.now();
for (let s = 0; s < Number(seedsS); s++) {
  const seed = Number(seed0S) + s;
  const setup = lineup(modeArg, seed);
  const teams = new Set(setup.seats.map((x) => x.team)).size;
  const A = make(setup);
  const Bs = CPS.flatMap((cp) => [0, 1].map((obs) => ({ cp, obs, b: make(setup), done: false, pert: [] as number[], step: 0 })));
  const endT = Math.max(...CPS) + 1;
  while (A.sim.view.phase !== 'ended' && A.sim.world.time < endT) {
    A.sim.step();
    for (const B of Bs) {
      if (B.done) continue;
      if (B.step === 0) {
        B.b.sim.step();
        if (B.b.sim.world.tick !== A.sim.world.tick) { hashMis++; report.push(`seed ${seed}: tick skew`); B.done = true; continue; }
        if (A.sim.world.time >= B.cp) {
          // determinism across interleaved instances
          if (hashWorld(A) !== hashWorld(B.b)) { hashMis++; report.push(`seed ${seed} cp ${B.cp}: A/B hash differ before perturbation`); B.done = true; continue; }
          const obs = B.obs, w = B.b.sim.world, bit = 1 << obs;
          const mine = w.entities.filter((e) => !e.removed && e.alive && e.team === obs);
          for (const e of w.entities) {
            if (e.removed || !e.alive || e.team === obs || e.team < 0 || e.team >= teams) continue;
            if (e.kind !== 'fighter' && e.kind !== 'minion' && e.kind !== 'summon') continue;
            // (CONTROL=1: positive control — perturb what team obs CAN see, to prove the diff is sensitive)
            if (process.env.CONTROL) { if ((e.visibleMask & bit) === 0) continue; }
            else if (process.env.NEAR) { if ((e.visibleMask & bit) !== 0 || !mine.some((m) => (m.x - e.x) ** 2 + (m.y - e.y) ** 2 <= 20 * 20)) continue; }
            else if ((e.visibleMask & bit) !== 0 || mine.some((m) => (m.x - e.x) ** 2 + (m.y - e.y) ** 2 <= 20 * 20)) continue;
            // (NEAR=1: hidden units within 20 m of the observers — thicket / fog-edge — hp only, so nothing moves)
            if (process.env.NEAR) e.hp = Math.max(1, e.hp * 0.6);
            else if (e.kind === 'fighter') {
              e.hp = Math.max(1, e.hp * 0.4);
              for (const sl of e.slots) if (sl) { sl.cooldown = 0; }
              e.x += 0.85; e.y += 0.85;
            } else e.hp = Math.max(1, e.hp * 0.5);
            B.pert.push(e.id);
          }
          if (!B.pert.length) { noTargets++; B.done = true; continue; }
          perturbedN += B.pert.length;
          B.step = 1;
        }
        continue;
      }
      // after the perturbation: step, compare the observing team's decisions
      B.b.sim.step();
      const obs = B.obs, bit = 1 << obs;
      const players = setup.seats.filter((x) => x.team === obs).map((x) => x.player);
      const hiddenA = B.pert.every((id) => { const e = A.sim.world.entity(id); return !e || ((e.visibleMask & bit) === 0); });
      const hiddenB = B.pert.every((id) => { const e = B.b.sim.world.entity(id); return !e || ((e.visibleMask & bit) === 0); });
      for (const p of players) {
        const da = decision(A, p), db = decision(B.b, p);
        if (B.step === 1) { checks++; if (da !== db) { diffs1++; report.push(`seed ${seed} cp ${B.cp} obs ${obs} p${p} tick+1: ${da.slice(0, 200)}  VS  ${db.slice(0, 200)}`); } }
        else if (B.step === 2 && B.stillHidden) { checks2++; if (da !== db) { diffs2++; report.push(`seed ${seed} cp ${B.cp} obs ${obs} p${p} tick+2: ${da.slice(0, 200)}  VS  ${db.slice(0, 200)}`); } }
      }
      (B as { stillHidden?: boolean }).stillHidden = hiddenA && hiddenB;
      B.step++;
      if (B.step > 2) B.done = true;
    }
  }
  // cross-process determinism record
  console.log(`seed ${seed} ${modeArg} ${diff}: end tick ${A.sim.world.tick} hash ${hashWorld(A).toString(16)}`);
}
console.log(`\n${modeArg} ${diff}: perturbation checks tick+1 ${checks} (diffs ${diffs1}), tick+2 still-hidden ${checks2} (diffs ${diffs2}); entities perturbed ${perturbedN}; checkpoints with no hidden far target ${noTargets}; interleaved-instance hash mismatches ${hashMis}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const r of report.slice(0, 30)) console.log('  ' + r);
