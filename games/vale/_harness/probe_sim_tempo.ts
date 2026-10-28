// probe (lane SIM, wave W4, gameplay G4 + G2): RIFT tempo and the Dialwood on the REAL catalog (built in memory
// from content/) and the real RIFT map. The soak (probe_sim_bot_soak.ts) measures the outcome — median first
// structure 9–12 min, jungler within 1.5 levels of the solo laners at 15:00; this probe pins the rules behind it:
//   1. the Dawn Seal (rules.dawnSeal): every listed Needle carries a seal (a shield sourced by the Needle itself)
//      that soaks damage before its health, re-sets to full on its beat, and is gone at `until`; unlisted
//      structures carry none
//   2. Ringshade (rules.ringshade): fighter damage to a listed structure is × mult with none of the striker's Wicks
//      in its shadow ring, rising evenly to full at `wicks`; the defender's Wicks do not count; Wick damage and
//      damage in sudden death are never shaded
//   3. the Grove tithe (rules.groveTithe): Wick XP fills the team's grove bank; a camp monster pays it out (up to
//      perMonster) only to a fighter trailing its team's highest level, never on an objective camp
//   4. the bots: each jungler opens on a camp in its own half (no camp counted cleared before it spawned), and
//      one fallen Needle before 10:00 does not end the team brain's laning phase
//   5. the gauge (LoL ONLY as a gauge): the new headline numbers are not within 10 % of a counterpart
//   Run: node _harness/probe_sim_tempo.ts
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { TICK_HZ } from '../src/contracts/sim.ts';
import { createBots } from '../src/sim/bots/index.ts';
import { dealDamage, killEntity } from '../src/sim/combat.ts';
import type { Entity, Player } from '../src/sim/entity.ts';
import { createSim, type BotController, type Sim } from '../src/sim/sim.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import { monsterState } from '../src/sim/units/monsters.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { check, finish, near, section } from './fixtures/sim_fixture.ts';

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP probe_sim_tempo: content build failed'); process.exit(77); }
const catalog: CatalogT = built.catalog;
const rift = catalog.modes.find((m) => m.id === 'rift')!;
const R = rift.rules;
if (!R.dawnSeal || !R.ringshade || !R.groveTithe) { console.log('FAIL rift rules carry dawnSeal, ringshade and groveTithe'); process.exit(1); }
const DS = R.dawnSeal, RS = R.ringshade, GT = R.groveTithe;

/** a copy of the catalog whose RIFT sends no Wick waves (so nothing walks into the Needles by itself) */
const quiet: CatalogT = structuredClone(catalog);
delete (quiet.modes.find((m) => m.id === 'rift')!.rules as { minionWaves?: unknown }).minionWaves;

function seat(i: number, team: number, fighter: string): SeatSetup {
  const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? '';
  return { player: i, team, name: `P${i}`, fighter, skin, loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
    controller: 'human', colorIndex: i };
}
const FIGHTERS = catalog.fighters.map((f) => f.id).sort();
function mkSim(cat: CatalogT, seats: SeatSetup[]): Sim {
  const q = cat.queues.find((x) => x.mode === 'rift' && x.kind === 'standard')!;
  const setup: MatchSetup = { matchId: 'tempo', seed: 11, queue: q.id, mode: 'rift', map: rift.map, seats, catalogVersion: cat.version };
  const sim = createSim(cat, setup, { pregameSeconds: 0 });
  for (const p of sim.world.players) if (p?.ent) p.ent.autoAttack = false;
  sim.step();
  return sim;
}
const steps = (sim: Sim, sec: number): SimEvent[] => { const out: SimEvent[] = []; for (let i = 0; i < Math.round(sec * TICK_HZ); i++) out.push(...sim.step()); return out; };
const stepTo = (sim: Sim, t: number): void => { while (sim.world.time + 1e-9 < t) sim.step(); };
const needles = (sim: Sim, unit: string): Entity[] => sim.world.entities.filter((e) => e.kind === 'structure' && e.def === unit && e.alive);
const seal = (e: Entity): number => e.shields.filter((s) => s.src === e.id).reduce((a, s) => a + s.amount, 0);
const place = (sim: Sim, e: Entity, x: number, y: number): void => { e.x = x; e.y = y; e.path.length = 0; sim.world.hashDirty = true; };
const cumXp = [0];
for (const s of R.xpTable) cumXp.push(cumXp[cumXp.length - 1] + s);
const totalXp = (p: Player): number => cumXp[(p.ent?.level ?? 1) - 1] + p.xp;

// ── 1. Dawn Seal ────────────────────────────────────────────────────────────────────────────────
section('dawn seal', () => {
  const sim = mkSim(quiet, [seat(0, 0, FIGHTERS[0]), seat(1, 1, FIGHTERS[1])]);
  const w = sim.world;
  stepTo(sim, 1);
  const outer = needles(sim, 'needle_outer');
  const listed = outer.filter((e) => DS.units.includes(e.def));
  check(`${listed.length} listed Needles carry a full seal of ${DS.amount} at 0:01`, listed.length > 0 && listed.every((e) => near(seal(e), DS.amount, 1e-6)));
  const unlisted = w.entities.filter((e) => e.kind === 'structure' && e.alive && !DS.units.includes(e.def));
  check('unlisted structures carry no seal', unlisted.every((e) => seal(e) === 0 && e.shield === 0));
  const n = listed[0];
  const hp0 = n.hp;
  const got = dealDamage(w, null, n, 300, 'true');
  check('a hit smaller than the seal leaves health untouched (the seal soaks it)', near(got, 300, 1e-6) && near(n.hp, hp0, 1e-6) && near(seal(n), DS.amount - 300, 1e-6), { hp: n.hp, seal: seal(n) });
  stepTo(sim, DS.every + 0.5);
  check(`the seal re-sets to full on its ${DS.every} s beat`, near(seal(n), DS.amount, 1e-6) && n.shields.filter((s) => s.src === n.id).length === 1, { seal: seal(n), shields: n.shields.length });
  dealDamage(w, null, n, DS.amount + 250, 'true');
  check('a hit bigger than the seal breaks through for the rest', near(n.hp, hp0 - 250, 1e-6) && seal(n) === 0, { hp: n.hp });
  stepTo(sim, DS.until - 1);
  check('the seal still holds a second before it ends', near(seal(n), DS.amount, 1e-6));
  stepTo(sim, DS.until + 0.2);
  check(`the seal is gone at ${DS.until} s`, seal(n) === 0 && n.shield === 0, { seal: seal(n) });
  stepTo(sim, DS.until + DS.every + 1);
  check('and never comes back', listed.every((e) => seal(e) === 0));
});

// ── 2. Ringshade ────────────────────────────────────────────────────────────────────────────────
section('ringshade', () => {
  const sim = mkSim(quiet, [seat(0, 0, FIGHTERS[0]), seat(1, 1, FIGHTERS[1])]);
  const w = sim.world;
  stepTo(sim, DS.until + 1); // past the seal: damage lands on health
  const n = needles(sim, 'needle_outer').find((e) => e.team === 1 && RS.units.includes(e.def))!;
  const f = w.players[0].ent!;
  place(sim, f, n.x - 4, n.y);
  const hit = (src: Entity): number => { const before = n.hp; dealDamage(w, src, n, 100, 'true'); return before - n.hp; };
  const expect = (k: number): number => 100 * (RS.mult + (1 - RS.mult) * Math.min(1, k / RS.wicks));
  check(`a fighter's hit with none of its Wicks in the ring lands × ${RS.mult}`, near(hit(f), expect(0), 1e-6));
  const wicks: Entity[] = [];
  const reach = n.stats.range + n.radius;
  for (let k = 1; k <= RS.wicks + 1; k++) {
    wicks.push(spawnUnit(w, 'shieldwick', 0, n.x - reach + 1.5, n.y + (k - 2) * 0.9));
    check(`with ${k} of its Wicks in the ring it lands × ${(expect(k) / 100).toFixed(3)}`, near(hit(f), expect(k), 1e-6));
  }
  check('a Wick\'s own hit is never shaded', near(hit(wicks[0]), 100, 1e-6));
  for (const u of wicks) killEntity(w, u, null);
  sim.step();
  const foe = spawnUnit(w, 'shieldwick', 1, n.x - 3, n.y + 1);
  check('the defending team\'s Wicks do not count', near(hit(f), expect(0), 1e-6));
  killEntity(w, foe, null);
  const far = spawnUnit(w, 'shieldwick', 0, n.x - reach - 4, n.y);
  check('a Wick outside the shadow ring does not count', near(hit(f), expect(0), 1e-6));
  killEntity(w, far, null);
  const hourbell = w.entities.find((e) => e.kind === 'structure' && !RS.units.includes(e.def) && e.alive && !e.invulnerable);
  if (hourbell) { place(sim, f, hourbell.x - 3, hourbell.y); const b = hourbell.hp; dealDamage(w, f, hourbell, 100, 'true'); check(`an unlisted structure (${hourbell.def}) is not shaded`, near(b - hourbell.hp, 100, 1e-6) || hourbell.shield > 0); place(sim, f, n.x - 4, n.y); }
  w.suddenDeath = true;
  check('in sudden death nothing is shaded', near(hit(f), 100, 1e-6));
  w.suddenDeath = false;
});

// ── 3. Grove tithe ──────────────────────────────────────────────────────────────────────────────
section('grove tithe', () => {
  const sim = mkSim(quiet, [seat(0, 0, FIGHTERS[0]), seat(1, 0, FIGHTERS[1]), seat(2, 1, FIGHTERS[2])]);
  const w = sim.world;
  const P0 = w.players[0], P1 = w.players[1];
  stepTo(sim, 62); // camps are up
  // P1 (the team's lead) takes Wicks in a lane: the bank fills by share × their XP
  const wickXp = catalog.units.find((u) => u.id === 'shieldwick')!.bounty.xp * R.xpMult;
  place(sim, P0.ent!, 20, 100); place(sim, P1.ent!, 30, 100);
  const bank = (): number => (w.ext.econ as { grove: number[] }).grove[0];
  const n = Math.ceil((GT.perMonster * 1.5) / (wickXp * GT.share));
  for (let i = 0; i < n; i++) { const u = spawnUnit(w, 'shieldwick', 1, 31, 100); killEntity(w, u, P1.ent!); }
  check(`${n} Wicks taken by a fighter put share × their XP in its team's grove`, near(bank(), Math.min(GT.bankMax, n * wickXp * GT.share), 1e-6), { bank: bank() });
  check('the bank never touches the laner\'s own XP (it gets the full Wick XP)', P1.ent!.level > P0.ent!.level);
  // P0 (trailing) finishes a camp monster of a non-objective camp: monster XP + the tithe
  const camps = w.entities.filter((e) => e.kind === 'monster' && e.alive && monsterState(e) && !monsterState(e)!.camp.def.objective);
  const m0 = camps[0];
  place(sim, P0.ent!, m0.x + 1, m0.y); place(sim, P1.ent!, 20, 100);
  let b0 = bank(), x0 = totalXp(P0);
  killEntity(w, m0, P0.ent!);
  check(`a trailing fighter's camp monster pays its XP plus up to ${GT.perMonster} from the grove`, near(totalXp(P0) - x0, m0.unit!.bounty.xp * R.xpMult + Math.min(b0, GT.perMonster), 1e-6) && near(bank(), b0 - Math.min(b0, GT.perMonster), 1e-6),
    { gained: totalXp(P0) - x0, bank: bank() });
  // the team's lead finishing one gets no tithe
  const m1 = camps.find((e) => e !== m0 && e.alive)!;
  place(sim, P1.ent!, m1.x + 1, m1.y); place(sim, P0.ent!, 20, 100);
  b0 = bank(); x0 = totalXp(P1);
  killEntity(w, m1, P1.ent!);
  check('the team\'s highest-level fighter gets no tithe', near(totalXp(P1) - x0, m1.unit!.bounty.xp * R.xpMult, 1e-6) && near(bank(), b0, 1e-6));
  // an objective camp never pays it
  const objCamp = catalog.maps.find((m) => m.id === rift.map)!.camps.filter((c) => c.objective).sort((a, b) => a.firstSpawn - b.firstSpawn)[0];
  stepTo(sim, objCamp.firstSpawn + 1);
  const obj = w.entities.find((e) => e.kind === 'monster' && e.alive && monsterState(e)?.camp.def.objective);
  check(`an objective camp (${objCamp.id}) is up at ${objCamp.firstSpawn + 1} s`, !!obj);
  if (obj) {
    place(sim, P0.ent!, obj.x + 1, obj.y);
    b0 = bank();
    killEntity(w, obj, P0.ent!);
    check('an objective monster never pays the tithe', near(bank(), b0, 1e-6) && b0 > 0, { b0, bank: bank() });
  }
  // the bank is capped
  for (let i = 0; i < Math.ceil(GT.bankMax / (wickXp * GT.share)) + 20; i++) { const u = spawnUnit(w, 'shieldwick', 1, 31, 100); killEntity(w, u, P1.ent!); }
  check(`the bank holds at most ${GT.bankMax}`, near(bank(), GT.bankMax, 1e-6), { bank: bank() });
});

// ── 4. bots ─────────────────────────────────────────────────────────────────────────────────────
section('bots: jungle opening and the laning phase', () => {
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const seed of [1, 2, 3]) {
    const seats: SeatSetup[] = [];
    for (let i = 0; i < rift.teams * rift.perTeam; i++) {
      const team = Math.floor(i / rift.perTeam), role = roles[(i % rift.perTeam) % roles.length];
      const pl = (natives.get(role) ?? FIGHTERS).slice().sort();
      const fighter = pl[(seed + i) % pl.length];
      seats.push({ ...seat(i, team, fighter), role, controller: 'bot', botDifficulty: 'adept' });
    }
    const q = catalog.queues.find((x) => x.mode === 'rift' && x.kind === 'standard')!;
    const setup: MatchSetup = { matchId: `tempo-bots-${seed}`, seed, queue: q.id, mode: 'rift', map: rift.map, seats, catalogVersion: catalog.version };
    const ctrls: (BotController | null)[] = seats.map(() => null);
    const factory = createBots(catalog, setup);
    const sim = createSim(catalog, setup, { bots: (s, host) => { const c = factory(s, host); ctrls[s.player] = c; return c; }, pregameSeconds: 0 });
    const w = sim.world;
    const bases = rift.map ? catalog.maps.find((m) => m.id === rift.map)!.bases : [];
    const homeTeam = (x: number, y: number): number => { let bt = -1, bd = Infinity; for (const b of bases) { const d = Math.hypot(b.spawn[0] - x, b.spawn[1] - y); if (d < bd) { bd = d; bt = b.team; } } return bt; };
    const junglers = seats.filter((s) => s.role === 'grovehunter').map((s) => s.player);
    const first = new Map<number, number>();
    let earlyReady = true;
    while (w.time < 100 && first.size < junglers.length) {
      for (const ev of sim.step()) {
        if (ev.e !== 'death' || ev.kind !== 'monster') continue;
        const k = w.entity(ev.killer); const cf = k ? w.creditFighter(k) : null;
        const pi = cf?.player?.player ?? -1;
        const d = w.entity(ev.dst);
        if (junglers.includes(pi) && !first.has(pi) && d) first.set(pi, homeTeam(d.x, d.y) === w.players[pi].team ? 1 : 0);
      }
      if (w.time < 59) for (const p of junglers) {
        const b = (ctrls[p] as unknown as { brain: { campReady: Float64Array } | null }).brain;
        if (b && [...b.campReady].some((r, i) => r > 61 && !catalog.maps.find((m) => m.id === rift.map)!.camps[i].objective)) earlyReady = false;
      }
    }
    check(`seed ${seed}: both junglers open on a camp in their own half by 1:40`, junglers.every((p) => first.get(p) === 1), Object.fromEntries(first));
    check(`seed ${seed}: no camp is counted cleared before its first spawn`, earlyReady);
    if (seed === 1) {
      // one outer Needle falls at 1:40: the team brains keep the laning phase ('early') until 10:00 or a second
      const n = needles(sim, 'needle_outer')[0];
      killEntity(w, n, null);
      steps(sim, 2);
      const phases = ctrls.map((c) => (c as unknown as { brain: { phase: string } | null }).brain?.phase);
      check('one fallen Needle before 10:00 leaves both team brains in the laning phase', phases.every((p) => p === 'early'), phases);
      killEntity(w, needles(sim, 'needle_outer')[0], null);
      steps(sim, 2);
      const phases2 = ctrls.map((c) => (c as unknown as { brain: { phase: string } | null }).brain?.phase);
      check('a second one moves them on to the mid game', phases2.every((p) => p === 'mid'), phases2);
    }
  }
});

// ── 5. gauge ────────────────────────────────────────────────────────────────────────────────────
section('gauge', () => {
  // Reference-genre counterparts, recalled approximately for the gauge only (never copied): outer turret ~5,000 health
  // with its plates; its no-minion protection cuts champion damage by two thirds (× 0.33); there is no grove bank.
  const needle = catalog.units.find((u) => u.id === 'needle_outer')!;
  const rows = [
    { what: 'outer Needle health', vale: needle.base.hp ?? 0, lol: 5000 },
    { what: 'Ringshade damage share with no Wick in the ring', vale: RS.mult, lol: 1 / 3 },
  ];
  for (const r of rows) {
    const off = Math.abs(r.vale / r.lol - 1);
    check(`${r.what}: VALE ${r.vale.toFixed(2)} vs ${r.lol.toFixed(2)} (${(off * 100).toFixed(0)} % apart, ≥ 10 %)`, off >= 0.1);
  }
  check('Ringshade is graded by Wick count (full damage only at ≥ 2 Wicks), not one on/off threshold', RS.wicks >= 2);
  check('the Dawn Seal is a re-setting seal, not a damage cut', DS.amount > 0 && DS.every > 0 && DS.every < DS.until);
});

finish('probe_sim_tempo');
