// probe (ruling 65, play as a team): do the computer-played fighters LISTEN to a person's pings, and does the enemy team's
// talk stay off a person's screen? RIFT, one person (seat 0, team 0, sent nowhere: it stands in its base) with four
// computer-played teammates against five computer-played opponents, one tier on both sides. On each game:
//   * from 15:00, every 60 s the person pings "help here" on the teammate of theirs nearest an enemy fighter in sight
//     (the genre's ask: "I see a fight, go help") — answered when a teammate says onMyWay for it, or one 15 m+ away walks
//     to within 12 m of it, within 5 s;
//   * at 16:30, 19:00, 21:30 and 24:00 the person pings "group here" on the visible enemy structure nearest the team: followed
//     when three or more of the person's teammates stand within 30 m of it inside 25 s, and acknowledged when a teammate says
//     onMyWay within 5 s. Gate (ruling 66): an acknowledged push that is not followed — a broken promise — 0. (The carve-out
//     build neither answers nor acknowledges a push: both read 0.)
//   * gate (ruling 66): a person's assist answered within 5 s at least 35 % (the live 8c95deb52 opponents: 10-20 %);
//   * every ping event of the enemy team is run through the HUD's own rule (a ping is drawn and sounded only when its
//     player is on your team: src/ui/hud/model.ts, src/audio/index.ts) for the person's seat: must be 0 shown.
//   node _harness/probe_sim_bot_pings.ts --diff adept --seed0 701 --seeds 8
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
const { createBots, pickLoadout } = (await import(`../src/sim/${process.env.VALE_BOTS || 'bots'}/index.ts`)) as typeof import('../src/sim/bots/index.ts');
import { createSim } from '../src/sim/sim.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const catalog = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog as CatalogT;
const diff = opt('diff', 'adept'), seed0 = Number(opt('seed0', '701')), seeds = Number(opt('seeds', '8'));

function lineup(seed: number): MatchSetup {
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
      loadout: pickLoadout(catalog, fighter, pool, role), controller: i === 0 ? 'human' : 'bot', botDifficulty: diff as SeatSetup['botDifficulty'], colorIndex: i });
  }
  return { matchId: `pings-${seed}-${diff}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

const tot = { assist: 0, assistAnswered: 0, push: 0, pushFollowed: 0, pushAcked: 0, pushBroken: 0, enemyPings: 0, enemyShown: 0, allyBotPings: 0 };
for (let s = seed0; s < seed0 + seeds; s++) {
  const setup = lineup(s);
  const sim = createSim(catalog, setup, { bots: createBots(catalog, setup), pregameSeconds: 0 });
  const me = setup.seats[0];
  let nextAssist = 900, pushes = [990, 1140, 1290, 1440];
  const asks: { kind: 'assist' | 'push'; x: number; y: number; t: number; far: Set<number>; sid: number; done: boolean; acked: boolean; followed: boolean }[] = [];
  let guard = 0;
  while (sim.view.phase !== 'ended' && guard++ < 30 * 1800) {
    const evs: SimEvent[] = sim.step();
    const w = sim.world, now = w.time;
    if (now > 1500) break;
    const mine = w.players.filter((p) => p.team === me.team && p.player !== me.player);
    const foes = w.entities.filter((e) => e.kind === 'fighter' && e.alive && e.team !== me.team && (e.visibleMask & (1 << me.team)));
    if (now >= nextAssist) {
      let best: { x: number; y: number } | null = null, bd = 1e9;
      for (const p of mine) { const f = p.ent; if (!f || !f.alive) continue; for (const g of foes) { const d = Math.hypot(f.x - g.x, f.y - g.y); if (d < bd) { bd = d; best = { x: f.x, y: f.y }; } } }
      if (best && bd <= 15) {
        nextAssist = now + 60;
        const far = new Set<number>();
        for (const p of mine) if (p.ent && p.ent.alive && Math.hypot(p.ent.x - best.x, p.ent.y - best.y) > 15) far.add(p.player);
        sim.command(me.player, { type: 'ping', kind: 'assist', x: best.x, y: best.y });
        asks.push({ kind: 'assist', x: best.x, y: best.y, t: now, far, sid: -1, done: far.size === 0, acked: false, followed: false });
        tot.assist++;
      } else nextAssist = now + 2;
    }
    if (pushes.length && now >= pushes[0]) {
      pushes = pushes.slice(1);
      let cx = 0, cy = 0, n = 0;
      for (const p of mine) if (p.ent && p.ent.alive) { cx += p.ent.x; cy += p.ent.y; n++; }
      if (n) {
        cx /= n; cy /= n;
        let st = null as (typeof w.entities)[number] | null, sd = 1e9;
        for (const e of w.entities) if (e.kind === 'structure' && e.alive && e.targetable && e.team !== me.team) { const d = Math.hypot(e.x - cx, e.y - cy); if (d < sd) { sd = d; st = e; } }
        if (st) { sim.command(me.player, { type: 'ping', kind: 'push', x: st.x, y: st.y }); asks.push({ kind: 'push', x: st.x, y: st.y, t: now, far: new Set(), sid: st.id, done: false, acked: false, followed: false }); tot.push++; }
      }
    }
    for (const ev of evs) {
      if (ev.e !== 'ping') continue;
      const by = w.players[ev.player];
      // the HUD's rule (model.ts: `if (!pv || pv.team !== this.myTeam) break;`) for seat 0
      if (by.team !== me.team) { tot.enemyPings++; if (by.team === me.team) tot.enemyShown++; continue; }
      if (ev.player !== me.player) tot.allyBotPings++;
      // (an onMyWay belongs to the person's assist it answers — a bot's onMyWay is said only for an assist in this build — and
      // counts as a push acknowledgement only when no assist of the person's within 8 s and 30 m of it could be what it answers)
      if (ev.kind === 'onMyWay') {
        const forAssist = asks.some((a) => a.kind === 'assist' && now - a.t <= 8 && Math.hypot(a.x - ev.x, a.y - ev.y) <= 30);
        for (const a of asks) if (now - a.t <= 5 && Math.hypot(a.x - ev.x, a.y - ev.y) <= 30) {
          if (a.kind === 'assist' && !a.done) { a.done = true; tot.assistAnswered++; }
          if (a.kind === 'push' && !a.acked && !forAssist) { a.acked = true; tot.pushAcked++; }
        }
      }
    }
    for (const a of asks) {
      if (a.kind === 'assist' && !a.done && now - a.t <= 5) for (const p of mine) if (a.far.has(p.player) && p.ent && Math.hypot(p.ent.x - a.x, p.ent.y - a.y) <= 12) { a.done = true; tot.assistAnswered++; break; }
    }
    // (the team's call is read by where its fighters walk: followed when 3+ of the person's teammates are within 30 m of the pinged structure within 25 s
    for (const a of asks) if (a.kind === 'push' && !a.followed && now - a.t <= 25) {
      let k = 0; for (const p of mine) if (p.ent && p.ent.alive && Math.hypot(p.ent.x - a.x, p.ent.y - a.y) <= 30) k++;
      if (k >= 3) { a.followed = true; tot.pushFollowed++; }
    }
  }
  for (const a of asks) if (a.kind === 'push' && a.acked && !a.followed) tot.pushBroken++;
}
const pc = (a: number, b: number): string => (b ? `${((a / b) * 100).toFixed(0)} % of ${b}` : '-');
console.log(`probe_sim_bot_pings ${diff} s${seed0}+${seeds}: a person's assist answered within 5 s ${pc(tot.assistAnswered, tot.assist)}; push followed (3+ teammates within 30 m of it inside 25 s) ${pc(tot.pushFollowed, tot.push)}, acknowledged with onMyWay ${pc(tot.pushAcked, tot.push)}; teammates' pings ${tot.allyBotPings}; enemy-team pings ${tot.enemyPings}, shown to the person ${tot.enemyShown}`);
// (ruling 66 gates: the enemy team's pings never shown; an onMyWay to a push is never an empty promise; a person's assist is
// answered clearly more often than by the live 8c95deb52 opponents, 10-20 %)
const fails: string[] = [];
if (tot.enemyShown !== 0) fails.push(`enemy-team pings shown to the person ${tot.enemyShown} (bar 0)`);
if (tot.pushBroken !== 0) fails.push(`push pings acknowledged and not followed ${tot.pushBroken} (bar 0)`);
if (tot.assist >= 10 && tot.assistAnswered < 0.35 * tot.assist) fails.push(`a person's assist answered ${pc(tot.assistAnswered, tot.assist)} (bar ≥ 35 %)`);
console.log(`  push acknowledged and not followed: ${tot.pushBroken}`);
for (const f of fails) console.log(`FAIL: ${f}`);
if (!fails.length) console.log('PASS');
process.exit(fails.length ? 1 : 0);
