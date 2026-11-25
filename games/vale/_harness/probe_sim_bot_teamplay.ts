// probe (ruling 71, team play second attempt): each team-play switch of the tier profiles does what it says, and only that.
// RIFT, both teams computer-played at one tier, cut at 30:00. Per tier, on --seeds games (default 3, from --seed0 701):
//   * sayPush and hearPersonPlan are off at every tier (ruling 71: the team's own push pings were followed 18-21 % of the time;
//     a person's push is piece 4's): push pings said 0.
//   * sayObjective ("take this" said by the team): on, objective pings are said and another teammate comes to the camp within
//     10 s at least 35 % of the time (35 % leaves room for a 3-game window); off, none are said. Either way objective pings
//     change nothing else: with the switch flipped (mates' help off) the game's every non-ping event is the same (one seed a tier).
//   * hearMatesAssist (a computer-played teammate's "help here" answered): on, every "heading there" said to a mate's help is
//     said by a fighter that has turned to it (mode defend), and the help is reached or answered at least 35 % of the time;
//     off, no "heading there" is said to a mate's help, and the switch forced on for one seed (adept, veteran) still says it
//     only from a fighter that has turned. Novice is off. The retreat half (hearMates) stays off at every tier.
//   * joinAt (a road two allies commit to): finite, a third teammate reaches a structure two fit teammates stand at within
//     20 s at least half the time (from 14:00).
//   * Spam (ruling 66): a fighter twice inside its gap / a team over its budget in 10 s: 0 / 0.
//   node _harness/probe_sim_bot_teamplay.ts [--seed0 701] [--seeds 3] [--diffs novice,adept,veteran]
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout, DIFFICULTIES, type DifficultyId, type DifficultyProfile } from '../src/sim/bots/index.ts';
import { createSim, type BotController } from '../src/sim/sim.ts';
import { structuresOf, isCoreStructure } from '../src/sim/units/structures.ts';
import { hashString } from '../src/sim/rng.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const seed0 = Number(opt('seed0', '701')), seeds = Number(opt('seeds', '3'));
const diffs = opt('diffs', 'novice,adept,veteran').split(',') as DifficultyId[];
const catalog = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog as CatalogT;
const prof = (d: DifficultyId): Record<string, unknown> => DIFFICULTIES[d] as unknown as Record<string, unknown>;

function lineup(seed: number, diff: string): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === 'rift')!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam, pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  const all = catalog.fighters.map((f) => f.id).sort();
  const roles = catalog.roles.filter((x) => x.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((x) => x.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  for (let i = 0; i < n; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam, role = roles[slot % roles.length];
    const pl = natives.get(role) ?? all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
      loadout: pickLoadout(catalog, fighter, pool, role), controller: 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `teamplay-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

interface Out { play: string; push: number; obj: number; objFollowed: number; help: number; helpOk: number; omwMate: number; omwNotTurned: number;
  joinEp: number; joinOk: number; spamF: number; spamT: number }

function play(seed: number, diff: DifficultyId): Out {
  const setup = lineup(seed, diff);
  const ctrls: (BotController | null)[] = setup.seats.map(() => null);
  const factory = createBots(catalog, setup);
  const sim = createSim(catalog, setup, { bots: (s, h) => { const c = factory(s, h); ctrls[s.player] = c; return c; }, pregameSeconds: 0 });
  const modeOf = (p: number): string => (ctrls[p] as unknown as { mode?: string } | null)?.mode ?? '?';
  const o: Out = { play: '', push: 0, obj: 0, objFollowed: 0, help: 0, helpOk: 0, omwMate: 0, omwNotTurned: 0, joinEp: 0, joinOk: 0, spamF: 0, spamT: 0 };
  let h = 0x811c9dc5;
  const helps: { team: number; p: number; x: number; y: number; t: number; far: Set<number>; ok: boolean }[] = [];
  const objs: { team: number; x: number; y: number; t: number; near: Set<number>; ok: boolean }[] = [];
  const joins = new Map<string, { t: number; ids: Set<number>; done: boolean; gone: number }>();
  const pingT = new Map<number, number[]>(), teamT = new Map<number, number[]>();
  for (let guard = 0; sim.view.phase !== 'ended' && guard < 30 * 1900; guard++) {
    const evs: SimEvent[] = sim.step();
    const w = sim.world, now = w.time;
    for (const ev of evs) {
      if (ev.e !== 'ping') { h = hashString(ev.e === 'end' ? `end:${ev.result.digest}` : JSON.stringify(ev), h); continue; }
      const tm = setup.seats[ev.player].team;
      const pt = pingT.get(ev.player) ?? []; pt.push(now); pingT.set(ev.player, pt);
      const tt = teamT.get(tm) ?? []; tt.push(now); teamT.set(tm, tt);
      if (ev.kind === 'push') o.push++;
      if (ev.kind === 'objective') {
        o.obj++;
        const near = new Set<number>();
        for (const pl of w.players) if (pl.team === tm && pl.ent && pl.ent.alive && Math.hypot(pl.ent.x - ev.x, pl.ent.y - ev.y) <= 30) near.add(pl.player);
        objs.push({ team: tm, x: ev.x, y: ev.y, t: now, near, ok: false });
      }
      if (ev.kind === 'assist') {
        const far = new Set<number>();
        for (const pl of w.players) if (pl.team === tm && pl.player !== ev.player && pl.ent && pl.ent.alive && Math.hypot(pl.ent.x - ev.x, pl.ent.y - ev.y) > 15) far.add(pl.player);
        helps.push({ team: tm, p: ev.player, x: ev.x, y: ev.y, t: now, far, ok: false });
      }
      if (ev.kind === 'onMyWay') {
        let mate = false;
        for (const a of helps) if (a.team === tm && a.p !== ev.player && now - a.t <= 5 && Math.hypot(a.x - ev.x, a.y - ev.y) <= 30) { mate = true; a.ok = true; }
        if (mate) { o.omwMate++; if (modeOf(ev.player) !== 'defend') o.omwNotTurned++; }
      }
    }
    if (w.tick % 6 === 0) {
      for (const a of helps) if (!a.ok && now - a.t <= 5) for (const pl of w.players) if (a.far.has(pl.player) && pl.ent && pl.ent.alive && Math.hypot(pl.ent.x - a.x, pl.ent.y - a.y) <= 12) { a.ok = true; break; }
      for (const a of objs) if (!a.ok && now - a.t <= 10) for (const pl of w.players) if (pl.team === a.team && !a.near.has(pl.player) && pl.ent && pl.ent.alive && Math.hypot(pl.ent.x - a.x, pl.ent.y - a.y) <= 30) { a.ok = true; break; }
      if (now >= 840) for (const st of structuresOf(w)) {
        const e = st.ent;
        if (!e || !e.alive || !e.targetable || isCoreStructure(w, e)) continue;
        const tm = 1 - e.team;
        const ids = new Set<number>();
        for (const pl of w.players) if (pl.team === tm && pl.ent && pl.ent.alive && pl.ent.hp >= pl.ent.maxHp * 0.5 && Math.hypot(pl.ent.x - e.x, pl.ent.y - e.y) <= 22) ids.add(pl.player);
        const key = `${tm}:${e.id}`, ep = joins.get(key);
        if (!ep || ep.done) {
          if (ids.size === 2 && (!ep || now - ep.gone >= 10)) joins.set(key, { t: now, ids, done: false, gone: -1e9 });
          else if (ep && ids.size < 2 && ep.gone < ep.t) ep.gone = now;
        } else {
          let third = false;
          for (const pid of ids) if (!ep.ids.has(pid)) third = true;
          if (third) { ep.done = true; o.joinEp++; o.joinOk++; }
          else if (now - ep.t > 20) { ep.done = true; o.joinEp++; ep.gone = ids.size < 2 ? now : -1e9; }
        }
      }
    }
    if (now >= 1800) break;
  }
  o.play = h.toString(16);
  o.obj = objs.length; o.objFollowed = objs.filter((a) => a.ok).length;
  const hb = helps.filter((a) => setup.seats[a.p].controller === 'bot');
  o.help = hb.length; o.helpOk = hb.filter((a) => a.ok).length;
  const d = DIFFICULTIES[diff];
  for (const ts of pingT.values()) for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] < d.pingGap - 0.01) o.spamF++;
  for (const ts of teamT.values()) for (let i = d.pingTeam; i < ts.length; i++) if (ts[i] - ts[i - d.pingTeam] < 10 - 0.01) o.spamT++;
  return o;
}

const fails: string[] = [];
const pc = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)} % of ${b}` : '-');
for (const diff of diffs) {
  const d: DifficultyProfile = DIFFICULTIES[diff];
  if (d.sayPush) fails.push(`${diff}: sayPush is on (ruling 71: off at every tier)`);
  if (d.hearPersonPlan) fails.push(`${diff}: hearPersonPlan is on (ruling 71: off, piece 4)`);
  if (d.hearMates) fails.push(`${diff}: hearMates (the retreat half) is on (ruling 71: off)`);
  if (diff === 'novice' && d.hearMatesAssist) fails.push('novice: hearMatesAssist is on (ruling 71: adept and veteran only)');
  if (d.regroupWait !== 0 || d.guardPosts || d.teamPush || d.loneStop !== Infinity) fails.push(`${diff}: a ruling 65 switch outside pieces 1-3 is on`);
  const T: Out = { play: '', push: 0, obj: 0, objFollowed: 0, help: 0, helpOk: 0, omwMate: 0, omwNotTurned: 0, joinEp: 0, joinOk: 0, spamF: 0, spamT: 0 };
  for (let s = seed0; s < seed0 + seeds; s++) {
    const g = play(s, diff);
    for (const k of Object.keys(T) as (keyof Out)[]) if (k !== 'play') (T[k] as number) += g[k] as number;
  }
  // (objective pings change nothing else: the same seed with sayObjective flipped plays every non-ping event the same)
  // (with mates' help off: an objective ping spends the team's ping budget, so beside hearMatesAssist it can leave a mate's
  // help unsaid and so unanswered — the budget, not the ping, moves that game)
  const was = d.sayObjective, wasM = d.hearMatesAssist;
  prof(diff).hearMatesAssist = false;
  prof(diff).sayObjective = false;
  const offG = play(seed0, diff);
  prof(diff).sayObjective = true;
  const onG = play(seed0, diff);
  prof(diff).sayObjective = was; prof(diff).hearMatesAssist = wasM;
  console.log(`probe_sim_bot_teamplay ${diff} s${seed0}+${seeds}: push pings ${T.push}; objective pings ${T.obj} (sayObjective ${d.sayObjective ? 'on' : 'off'}), another teammate there in 10 s ${pc(T.objFollowed, T.obj)}; ` +
    `mates' help ${T.help}, answered or reached in 5 s ${pc(T.helpOk, T.help)} (hearMatesAssist ${d.hearMatesAssist ? 'on' : 'off'}), "heading there" to a mate ${T.omwMate}, not turned ${T.omwNotTurned}; ` +
    `joins (joinAt ${d.joinAt}) a third within 20 s ${pc(T.joinOk, T.joinEp)}; spam ${T.spamF} / ${T.spamT}; sayObjective flipped: play ${onG.play === offG.play ? 'identical' : 'DIFFERENT'}`);
  if (T.push !== 0) fails.push(`${diff}: push pings said ${T.push} (bar 0)`);
  if (onG.play !== offG.play) fails.push(`${diff}: flipping sayObjective changed the game (${offG.play} vs ${onG.play})`);
  if (d.sayObjective) {
    if (T.obj === 0) fails.push(`${diff}: sayObjective on but no objective pings said`);
    else if (T.obj >= 8 && T.objFollowed < 0.35 * T.obj) fails.push(`${diff}: objective pings followed in 10 s ${pc(T.objFollowed, T.obj)} (bar ≥ 35 %)`);
  } else if (T.obj !== 0) fails.push(`${diff}: sayObjective off but ${T.obj} objective pings said`);
  if (d.hearMatesAssist) {
    if (T.omwNotTurned !== 0) fails.push(`${diff}: "heading there" to a mate said by a fighter that had not turned: ${T.omwNotTurned} (bar 0)`);
    if (T.help >= 20 && T.helpOk < 0.35 * T.help) fails.push(`${diff}: mates' help answered ${pc(T.helpOk, T.help)} (bar ≥ 35 %)`);
  } else if (T.omwMate !== 0) fails.push(`${diff}: hearMatesAssist off but ${T.omwMate} "heading there" said to a mate's help`);
  // (the mates' help code path is guarded while the switch is off too: forced on for one seed, every "heading there" to a
  // mate's help is said by a fighter that has turned to it)
  if (!d.hearMatesAssist && diff !== 'novice') {
    prof(diff).hearMatesAssist = true;
    const m = play(seed0, diff);
    prof(diff).hearMatesAssist = false;
    console.log(`  ${diff} hearMatesAssist forced on (s${seed0}): "heading there" to a mate ${m.omwMate}, not turned ${m.omwNotTurned}, spam ${m.spamF} / ${m.spamT}`);
    if (m.omwMate === 0) fails.push(`${diff}: hearMatesAssist forced on said no "heading there" to a mate's help`);
    if (m.omwNotTurned !== 0) fails.push(`${diff}: hearMatesAssist forced on: "heading there" said by a fighter that had not turned ${m.omwNotTurned} (bar 0)`);
    if (m.spamF + m.spamT !== 0) fails.push(`${diff}: hearMatesAssist forced on: ping spam ${m.spamF} / ${m.spamT}`);
  }
  if (d.joinAt < Infinity && T.joinEp >= 10 && T.joinOk < 0.5 * T.joinEp) fails.push(`${diff}: joins, a third within 20 s ${pc(T.joinOk, T.joinEp)} (bar ≥ 50 %)`);
  if (T.spamF + T.spamT !== 0) fails.push(`${diff}: ping spam ${T.spamF} / ${T.spamT} (bar 0 / 0)`);
}
for (const f of fails) console.log(`FAIL: ${f}`);
if (!fails.length) console.log('PASS');
process.exit(fails.length ? 1 : 0);
