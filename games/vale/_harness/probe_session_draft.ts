// probe (lane SESSION): the DraftHost, protocol by protocol — hidden simultaneous bans (allies see
// theirs, a reveal, ally-hover ban guard), the 1-2-2-2-2-1 snake with turn checks and timeouts
// (hover auto-lock, else random valid), match-unique picks, finalize skins/loadouts/trades; blind
// (duplicates across teams only, enemy picks hidden until finalize); ffa_pick (first lock wins);
// role_preset (preset kept, bots filled by role); random_bench (bench swap, reroll, bench cap);
// bots through the same actions seeing only their seat's view.
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { sessionCatalog } from './fixtures/session_fixture.ts';
import type { DraftState } from '../src/contracts/session.ts';
import type { LoadoutChoice } from '../src/contracts/sim.ts';
import { Rng } from '../src/sim/rng.ts';
import { DraftHost, type DraftConfig, type DraftHooks, type DraftSeatInit, type PickProtocol } from '../src/session/draft.ts';
import { createFallbackDraftBrain, type DraftBrain } from '../src/session/draft_brain.ts';
import { sanitizeLoadout } from '../src/session/setup.ts';

const cat = sessionCatalog();
const pool = cat.fighters.map((f) => f.id);
const rules = cat.modes[0].rules;
const roleOf = new Map(cat.fighters.map((f) => [f.id, f.role]));

function seats(teams: number, perTeam: number, o: { ffa?: boolean; roles?: boolean; youAt?: number; preset?: string } = {}): DraftSeatInit[] {
  const out: DraftSeatInit[] = [];
  const roles = ['fx_role_top', 'fx_role_jungle', 'fx_role_mid', 'fx_role_carry', 'fx_role_support'];
  for (let t = 0; t < teams; t++) for (let k = 0; k < perTeam; k++) {
    const player = t * perTeam + k;
    const isYou = player === (o.youAt ?? -1);
    const s: DraftSeatInit = { player, team: o.ffa ? player : t, name: `S${player}`, isBot: !isYou, isYou };
    if (o.roles) s.role = roles[k % 5];
    if (isYou && o.preset) s.preset = o.preset;
    out.push(s);
  }
  return out;
}
function make(protocol: PickProtocol, ss: DraftSeatInit[], o: { bans?: number; brains?: (s: DraftSeatInit) => DraftBrain | null; bench?: { size: number; rerolls: number }; pool?: string[] } = {}): DraftHost {
  const cfg: DraftConfig = {
    queue: 'fx_s_standard', mode: 'fx_s_rift', protocol, seats: ss, pool: o.pool ?? pool, bansPerTeam: o.bans ?? 0,
    timers: { ban: 6, pick: 8, bench: 10, finalize: 4 }, bench: o.bench ?? { size: 0, rerolls: 0 },
  };
  const hooks: DraftHooks = {
    brain: o.brains ?? (() => null),
    skins: (_s, f) => cat.skins.filter((x) => x.fighter === f).map((x) => x.id),
    loadout: () => sanitizeLoadout(cat, rules, undefined),
    validLoadout: (_s, _f, l: LoadoutChoice) => sanitizeLoadout(cat, rules, l),
    fighterName: (id) => id,
    fits: (f, role) => roleOf.get(f) === role,
  };
  const h = new DraftHost(cfg, new Rng(99), hooks);
  h.start();
  return h;
}
const run = (h: DraftHost, sec: number): void => { for (let i = 0; i < sec * 10 && !h.done; i++) h.advance(0.1); };
const lockedOf = (s: DraftState): (string | undefined)[] => s.seats.map((x) => x.locked);

section('draft: hidden simultaneous bans, reveal, ally-hover guard', () => {
  const h = make('draft', seats(2, 5, { roles: true }), { bans: 2 });
  const v = h.view(0);
  check("starts in 'ban'; the first two seats of each team ban", v.phase === 'ban' && v.turn?.action === 'ban' && v.turn.players.join() === '0,1,5,6', v.turn);
  check('a seat without a ban slot cannot ban', !h.act(2, { a: 'ban', fighter: pool[0] }).ok);
  check('hover is allowed during bans (intent)', h.act(1, { a: 'hover', fighter: pool[3] }).ok);
  const r = h.act(0, { a: 'ban', fighter: pool[3] });
  check("an ally's hovered fighter cannot be banned", !r.ok && r.reason === 'ally_hover', r);
  check('ban accepted', h.act(0, { a: 'ban', fighter: pool[0] }).ok);
  check('allies see the ban, enemies do not (hidden)', h.view(1).bans.some((b) => b.fighter === pool[0]) && h.view(5).bans.length === 0 && h.view(5).available.includes(pool[0]));
  check('the same team cannot ban one fighter twice', (h.act(1, { a: 'ban', fighter: pool[0] }) as { reason: string }).reason === 'banned');
  check('the other team may ban it too (simultaneous)', h.act(5, { a: 'ban', fighter: pool[0] }).ok);
  check('still hidden until every slot is in', h.view(0).phase === 'ban' && h.view(0).bans.every((b) => b.team === 0));
  h.act(6, { a: 'ban', fighter: pool[1] });
  run(h, 6.1);   // seat 1 never bans: its hover (pool[3]) is banned at the reveal
  const after = h.view(0);
  check('timeout reveals: an open slot bans its hover', after.bans.length === 4 && after.bans.some((b) => b.team === 0 && b.fighter === pool[3]), after.bans);
  check('reveal log + banned fighters leave `available`', after.log.some((l) => l.startsWith('Bans revealed')) && !after.available.includes(pool[0]) && !after.available.includes(pool[1]) && !after.available.includes(pool[3]));
  check("then 'pick' with team 0's first seat", after.phase === 'pick' && after.turn?.players.join() === '0');
});

section('draft: snake 1-2-2-2-2-1, turns, hover visibility, timeouts, no duplicates', () => {
  const h = make('draft', seats(2, 5), {});
  const order: string[] = [];
  let guard = 0;
  let last = -1;
  const seenTurns = new Set<string>();
  check('no bans → straight to picks', h.view(0).phase === 'pick');
  check('not your turn → refused', (h.act(5, { a: 'hover', fighter: pool[4] }), h.act(5, { a: 'lock' }) as { reason: string }).reason === 'not_your_turn');
  check('hover visible to allies only', h.act(0, { a: 'hover', fighter: pool[2] }).ok && h.view(1).seats[0].hover === pool[2] && h.view(5).seats[0].hover === undefined);
  while (!h.done && guard++ < 400) {
    const v = h.view(null);
    if (v.phase !== 'pick') break;
    const key = v.turn!.players.join();
    if (!seenTurns.has(key)) { seenTurns.add(key); order.push(`${v.seats[v.turn!.players[0]].team}:${v.turn!.players.length}`); }
    const turn = v.turn!.players;
    if (turn.includes(5) && turn.includes(6) && last !== 5) {
      // seat 5 hovers a valid fighter and seat 6 hovers nothing: let the timer run out
      h.act(5, { a: 'hover', fighter: v.available[0] });
      last = 5;
      run(h, 8.2);
      continue;
    }
    for (const p of turn) {
      const avail = h.view(p).available;
      h.act(p, { a: 'hover', fighter: avail[avail.length - 1] });
      h.act(p, { a: 'lock' });
    }
  }
  check('turn sizes and sides snake 1-2-2-2-2-1 from team 0', order.join(' ') === '0:1 1:2 0:2 1:2 0:2 1:1', order.join(' '));
  const v = h.view(null);
  const locked = lockedOf(v);
  check('timeout: the hovering seat locked its hover; the other got a random valid fighter', !!locked[5] && !!locked[6] && locked[5] !== locked[6]);
  check('no duplicate fighters in the match', new Set(locked).size === 10 && locked.every((f) => !!f));
  check("then 'finalize' (free actions for everyone)", v.phase === 'finalize' && v.turn?.action === 'free' && v.turn.players.length === 10);
  check('lock is closed in finalize', (h.act(0, { a: 'lock' }) as { reason: string }).reason === 'locked');
  const mySkins = cat.skins.filter((s) => s.fighter === locked[0]).map((s) => s.id);
  check('skin: only a skin of your fighter', !h.act(0, { a: 'skin', skin: 'fx_nope' }).ok && h.act(0, { a: 'skin', skin: mySkins[mySkins.length - 1] }).ok
    && h.view(0).seats[0].skin === mySkins[mySkins.length - 1]);
  check('loadout: sanitized to the pool (unknown ids dropped, topped up)', h.act(0, { a: 'loadout', loadout: { spells: ['fx_spell_heal', 'fx_bogus'], boons: [] } }).ok
    && h.view(0).seats[0].loadout?.spells.join() === 'fx_spell_heal,fx_spell_blink');
  const before = [locked[0], locked[1]];
  check('trade with a bot teammate: accepted at once, fighters swapped', h.act(0, { a: 'tradeRequest', with: 1 }).ok && h.view(0).seats[0].locked === before[1] && h.view(0).seats[1].locked === before[0]);
  check('no trades across teams', !h.act(0, { a: 'tradeRequest', with: 5 }).ok);
  run(h, 4.2);
  const f = h.final();
  check("finalize timer → 'done'; final() has fighter, skin of that fighter and loadout per seat", h.done && h.view(0).phase === 'done' && f.length === 10
    && f.every((s) => cat.skins.some((k) => k.id === s.skin && k.fighter === s.fighter) && s.loadout.spells.length === 2));
  check('closed after done', (h.act(0, { a: 'skin', skin: mySkins[0] }) as { reason: string }).reason === 'closed');
});

section('draft: player trades need the other seat to accept', () => {
  const ss = seats(2, 2);
  ss[1].isBot = false;               // two humans on team 0 (a remote build would have this)
  const h = make('draft', ss, {});
  for (let i = 0; i < 4 && !h.done; i++) {
    const v = h.view(null);
    for (const p of v.turn!.players) { h.act(p, { a: 'hover', fighter: h.view(p).available[0] }); h.act(p, { a: 'lock' }); }
  }
  const a = h.view(null).seats[0].locked, b = h.view(null).seats[1].locked;
  h.act(0, { a: 'tradeRequest', with: 1 });
  check('a pending request shows on both seats, nothing swapped yet', h.view(1).trades?.[0]?.from === 0 && h.view(0).seats[0].locked === a && h.view(2).trades === undefined);
  check('tradeAccept swaps', h.act(1, { a: 'tradeAccept', with: 0 }).ok && h.view(0).seats[0].locked === b && h.view(0).seats[1].locked === a && !h.view(0).trades);
});

section('blind: simultaneous, duplicates across teams only, enemy picks hidden until finalize', () => {
  const h = make('blind', seats(2, 3), {});
  const v = h.view(0);
  check('everyone picks at once', v.phase === 'pick' && v.turn?.players.length === 6);
  h.act(0, { a: 'hover', fighter: pool[0] }); h.act(0, { a: 'lock' });
  check('enemy team may lock the same fighter', (h.act(3, { a: 'hover', fighter: pool[0] }), h.act(3, { a: 'lock' })).ok);
  check('…but a teammate may not', !h.act(1, { a: 'hover', fighter: pool[0] }).ok && !h.view(1).available.includes(pool[0]) && h.view(4).available.includes(pool[1]));
  check("the enemy's pick is hidden during picks", h.view(0).seats[3].locked === undefined && h.view(1).seats[0].locked === pool[0] && !h.view(0).log.some((l) => l.includes('locked')));
  run(h, 8.2);
  const f = h.view(0);
  check('timeout locks everyone; finalize reveals', f.phase === 'finalize' && f.seats.every((s) => s.locked) && f.seats[3].locked === pool[0] && f.log.includes('Picks revealed'));
  const t0 = f.seats.filter((s) => s.team === 0).map((s) => s.locked), t1 = f.seats.filter((s) => s.team === 1).map((s) => s.locked);
  check('unique within each team', new Set(t0).size === 3 && new Set(t1).size === 3);
});

section('ffa_pick: simultaneous, first lock wins, no duplicates', () => {
  const h = make('ffa_pick', seats(6, 1, { ffa: true }), {});
  check('six teams of one', new Set(h.view(null).seats.map((s) => s.team)).size === 6);
  h.act(0, { a: 'hover', fighter: pool[5] }); h.act(1, { a: 'hover', fighter: pool[5] });
  check('both may hover it; first lock wins and clears the loser\'s hover', h.act(1, { a: 'lock' }).ok && h.view(0).seats[0].hover === undefined
    && (h.act(0, { a: 'lock' }) as { reason: string }).reason === 'no_hover' && !h.act(0, { a: 'hover', fighter: pool[5] }).ok);
  check("others' hovers are hidden (everyone is an enemy)", h.view(2).seats[0].hover === undefined && h.view(0).seats[1].locked === pool[5]);
  for (let p = 0; p < 6; p++) if (!h.view(p).seats[p].locked) { h.act(p, { a: 'hover', fighter: h.view(p).available[0] }); h.act(p, { a: 'lock' }); }
  const v = h.view(null);
  check('all locked → finalize early; no duplicates', v.phase === 'finalize' && new Set(lockedOf(v)).size === 6);
});

section('role_preset: your preset stays, bots fill by role at once', () => {
  const h = make('role_preset', seats(2, 5, { roles: true, youAt: 2, preset: 'fx_s_mystic' }), {});
  const v = h.view(2);
  check('straight to finalize with every seat locked', v.phase === 'finalize' && v.seats.every((s) => s.locked));
  check('the human keeps the preset', v.seats[2].locked === 'fx_s_mystic');
  const all = h.view(null).seats;
  check('bots got a fighter of their role (the pool has one for each)', all.filter((s) => !s.isYou).every((s) => roleOf.get(s.locked!) === s.role || all.filter((o) => o.team === s.team && roleOf.get(o.locked!) === s.role).length > 0));
  check('no duplicates within a team', [0, 1].every((t) => new Set(all.filter((s) => s.team === t).map((s) => s.locked)).size === 5));
});

section('random_bench: assignment, bench swap, reroll, bench cap', () => {
  const h = make('random_bench', seats(2, 3), { bench: { size: 2, rerolls: 1 } });
  const v = h.view(null);
  const assigned = lockedOf(v);
  check("'bench' phase, every seat assigned, benches of 2", v.phase === 'bench' && assigned.every((f) => !!f) && v.bench[0].length === 2 && v.bench[1].length === 2);
  check('no duplicates across seats and benches while the pool lasts', new Set([...assigned, ...v.bench[0], ...v.bench[1]]).size === 10);
  check('your view shows only your bench; rerolls on your team', Object.keys(h.view(0).bench).join() === '0' && h.view(0).seats[0].rerolls === 1 && h.view(0).seats[3].rerolls === undefined);
  const b0 = [...v.bench[0]];
  const mine = assigned[0]!;
  check('swap with a bench fighter: the old one takes its bench spot', h.act(0, { a: 'benchSwap', fighter: b0[1] }).ok && h.view(0).seats[0].locked === b0[1] && h.view(0).bench[0][1] === mine);
  check("cannot take the other team's bench", (h.act(0, { a: 'benchSwap', fighter: v.bench[1][0] }) as { reason: string }).reason === 'not_on_bench');
  const cur = h.view(0).seats[0].locked!, benchBefore = [...h.view(0).bench[0]];
  check('reroll: a new fighter, the old one joins the bench, oldest drops (cap 2)', h.act(0, { a: 'reroll' }).ok && h.view(0).seats[0].locked !== cur
    && h.view(0).bench[0].length === 2 && h.view(0).bench[0][1] === cur && h.view(0).bench[0][0] === benchBefore[1]);
  check('rerolls run out', (h.act(0, { a: 'reroll' }) as { reason: string }).reason === 'no_rerolls' && h.view(0).seats[0].rerolls === 0);
  const fin = h.view(null);
  check('still no duplicates', new Set([...lockedOf(fin), ...fin.bench[0], ...fin.bench[1]]).size === 10);
  run(h, 10.1);
  check('bench window → finalize → done', h.view(0).phase === 'finalize' && (run(h, 4.2), h.done));
  check('bench actions are closed outside the bench window', !make('blind', seats(2, 1)).act(0, { a: 'reroll' }).ok);
});

section('bots: the fallback brain drafts every protocol through DraftActions with their own view', () => {
  for (const proto of ['draft', 'blind', 'ffa_pick', 'random_bench', 'role_preset'] as PickProtocol[]) {
    let leaks = 0, calls = 0;
    const ffa = proto === 'ffa_pick';
    const brains = (s: DraftSeatInit): DraftBrain => {
      const inner = createFallbackDraftBrain(cat, 1000 + s.player);
      return { act(st, seat) {
        calls++;
        const me = st.seats.find((x) => x.player === seat)!;
        for (const o of st.seats) if (o.team !== me.team && o.hover !== undefined) leaks++;
        if (st.phase === 'ban' && st.bans.some((b) => b.team !== me.team)) leaks++;
        return inner.act(st, seat);
      } };
    };
    const h = make(proto, ffa ? seats(6, 1, { ffa: true }) : seats(2, 5, { roles: true }), { bans: proto === 'draft' ? 2 : 0, brains, bench: { size: 2, rerolls: 1 } });
    run(h, 200);
    const f = h.final();
    const uniq = proto === 'draft' || proto === 'ffa_pick' ? new Set(f.map((s) => s.fighter)).size === f.length
      : [...new Set(f.map((s) => s.team))].every((t) => { const l = f.filter((s) => s.team === t).map((s) => s.fighter); return new Set(l).size === l.length; });
    check(`${proto}: done, everyone has a fighter, uniqueness holds, bots saw no hidden info, paced (${calls} brain calls)`, h.done && f.every((s) => !!s.fighter) && uniq && leaks === 0 && calls < 600, { leaks, calls });
  }
  const h = make('draft', seats(2, 5, { roles: true }), { bans: 2, brains: (s) => createFallbackDraftBrain(cat, s.player) });
  run(h, 200);
  const f = h.final();
  check('draft bots pick their role when the pool allows', f.filter((s) => roleOf.get(s.fighter) === s.role).length >= 7, f.map((s) => [s.role, roleOf.get(s.fighter)]));
});

finish('probe_session_draft');
