// probe (lane SESSION): a full LocalSession flow for every queue kind — queue → search (2–6 s,
// estimate shown) → ready check → accept → draft (your seat by a test driver or the bot brain) →
// loading → match (pumped at time scale 16, every seat bot-driven) → post-game → grants/history:
// standard draft, quick role_preset, ranked (rating moves, provisional → tier), coop, bridge
// random_bench (bench swap + reroll), fray ffa_pick (placement grants), custom lobby (rules
// override reaches the sim), practice smoke; plus same-seed determinism.
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { countOf, harness, lastOf, PROBE_TIME_LIMIT, runFlow, type FlowResult, type Harness } from './fixtures/session_fixture.ts';
import type { DraftAction, DraftState, SessionEvent } from '../src/contracts/session.ts';
import type { MatchSetup } from '../src/contracts/sim.ts';
import { checkInvariants } from '../src/session/economy.ts';
import { difficultyForRating } from '../src/session/ratings.ts';

const DAY = 86_400_000;

/** your draft seat, played by hand: ban, hover a fighter of your role, lock on your turn, pick a skin + loadout in finalize */
function driver(o: { skin?: (s: DraftState) => string | null } = {}): (s: DraftState) => DraftAction | null {
  let banned = false, finalized = 0;
  return (s) => {
    const me = s.seats.find((x) => x.isYou);
    if (!me) return null;
    const myTurn = !!s.turn?.players.includes(me.player);
    if (s.phase === 'ban' && myTurn && !banned) {
      banned = true;
      const hovers = new Set(s.seats.filter((x) => x.team === me.team && x.hover).map((x) => x.hover));
      return { a: 'ban', fighter: s.available.find((f) => !hovers.has(f)) ?? s.available[0] };
    }
    if (s.phase === 'pick' && !me.locked) {
      if (!me.hover || !s.available.includes(me.hover)) return { a: 'hover', fighter: s.available[s.available.length - 1] };
      return myTurn ? { a: 'lock' } : null;
    }
    if (s.phase === 'finalize' && me.locked) {
      finalized++;
      if (finalized === 1) { const k = o.skin?.(s); if (k) return { a: 'skin', skin: k }; }
      if (finalized === 2) return { a: 'loadout', loadout: { spells: ['fx_spell_heal', 'fx_spell_blink'], boons: [] } };
    }
    return null;
  };
}

function seatsOk(h: Harness, setup: MatchSetup | undefined, n: number): boolean {
  if (!setup || setup.seats.length !== n) return false;
  const names = setup.seats.map((s) => s.name);
  const you = setup.seats.filter((s) => s.controller === 'human');
  return you.length === 1 && you[0].name === h.session.identity.displayName && new Set(names).size === n
    && setup.seats.every((s) => h.catalog.skins.some((k) => k.id === s.skin && k.fighter === s.fighter) && s.loadout.spells.length === 2)
    && setup.seats.filter((s) => s.controller === 'bot').every((s) => !!s.botDifficulty && h.catalog.botNames.includes(s.name))
    && setup.catalogVersion === h.catalog.version && Number.isInteger(setup.seed);
}
const evTypes = (h: Harness, from = 0): string[] => {
  const out: string[] = [];
  for (const e of h.events.slice(from)) {
    const k = e.type === 'queue' ? `queue:${e.state}` : e.type;
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out;
};
const report = (name: string, r: FlowResult): void => {
  console.log(`  info: ${name}: ${r.ok ? `${r.result?.reason} t=${r.result?.duration.toFixed(1)} you won=${r.result?.players.find((p) => p.controller === 'human')?.won}` : r.why} (${r.drafts.length} draft events)`);
};

section('standard draft: the whole flow, your seat by a test driver', () => {
  const h = harness({ autopilot: 'match' });
  const coin0 = h.session.profile().wallet.fx_coin;
  const t0 = h.clock.now();
  const r = runFlow(h, { queue: 'fx_s_standard', roles: ['fx_role_mid', 'fx_role_top'] }, { driver: driver({ skin: (s) => {
    const me = s.seats.find((x) => x.isYou)!;
    return h.catalog.skins.find((k) => k.fighter === me.locked)?.id ?? null;
  } }) });
  report('standard', r);
  check('flow completes', r.ok, r.why);
  const types = evTypes(h);
  const flow = types.filter((t) => t !== 'profile').filter((t, i, a) => t !== a[i - 1]);   // finalize skin/loadout choices save the profile mid-draft
  check('event order: queue searching → found → accepted → draft → loading → match → profile → postgame',
    flow.join(' ') === 'queue:searching queue:found queue:accepted draft loading match postgame' && types.slice(-2).join() === 'profile,postgame', types.join(' '));
  const searching = h.events.filter((e): e is Extract<SessionEvent, { type: 'queue' }> => e.type === 'queue' && e.state === 'searching');
  const found = h.events.find((e) => e.type === 'queue' && e.state === 'found') as Extract<SessionEvent, { type: 'queue' }>;
  const foundAt = searching[searching.length - 1].elapsed ?? 0;
  check('search shows elapsed + an estimate in 2–6 s, and pops within 2–6 s', searching.length >= 4 && searching.every((e) => (e.estimate ?? 0) >= 2 && (e.estimate ?? 0) <= 6)
    && foundAt >= 1.75 && foundAt <= 6, [foundAt, searching[0].estimate]);
  check('ready check: 10 s window, bots accept, total = 10 seats', found.readyMax === 10 && found.readyTimer === 10 && found.total === 10
    && h.events.some((e) => e.type === 'queue' && e.state === 'accepted' && e.accepted === 10), found);
  const d0 = r.drafts[0];
  check('draft opens with bans (2 per team) and your role preference honoured', d0.phase === 'ban' && d0.seats.find((s) => s.isYou)?.role === 'fx_role_mid');
  const last = r.drafts[r.drafts.length - 1];
  const myRole = last.seats.find((s) => s.isYou)!.role;
  check('enemy roles and hovers stay hidden from you', last.seats.filter((s) => s.team !== last.seats.find((x) => x.isYou)!.team).every((s) => s.role === undefined && s.hover === undefined));
  check('10 seats: you (human, your name) + 9 named bots, valid skins + loadouts', seatsOk(h, r.setup, 10), r.setup?.seats);
  const st = r.setup!;
  check('2 teams × 5, colorIndex = player, every seat has a role, no duplicate fighters', [0, 1].every((t) => st.seats.filter((s) => s.team === t).length === 5)
    && st.seats.every((s) => s.colorIndex === s.player && !!s.role) && new Set(st.seats.map((s) => s.fighter)).size === 10 && myRole === 'fx_role_mid');
  const human = st.seats.find((s) => s.controller === 'human')!;
  check('your finalize choices reached the setup (loadout heal+blink) and the profile', human.loadout.spells.join() === 'fx_spell_heal,fx_spell_blink'
    && h.session.profile().loadouts[human.fighter]?.spells.join() === 'fx_spell_heal,fx_spell_blink');
  check('bots: queue difficulty (adept)', st.seats.filter((s) => s.controller === 'bot').every((s) => s.botDifficulty === 'adept'));
  check('a real end condition', !!r.result && ['core', 'time'].includes(r.result.reason) && r.result.duration <= PROBE_TIME_LIMIT + 0.1);
  const me = r.result!.players.find((p) => p.controller === 'human')!;
  const g = r.postgame!.grants;
  const expect = Math.min(60, (me.won ? 30 : 10) + 2 * Math.floor(r.result!.duration / 60)) + (me.won ? 30 : 0);
  check('grants follow the queue (and first win of the day on a win)', g.currency.fx_coin === expect && g.firstWin === me.won && h.session.profile().wallet.fx_coin === coin0 + expect, [g, me.won]);
  const p = h.session.profile();
  check('history entry (newest first) with grants', p.history.length === 1 && p.history[0].matchId === st.matchId && p.history[0].won === me.won && p.history[0].grants.xp === g.xp);
  check('post-game names you; the match client is gone', r.postgame!.you === human.player && h.session.currentMatch() === null && h.session.phase === 'postgame');
  check('ledger/ownership invariants hold; profile saved', checkInvariants(p, h.catalog).length === 0 && JSON.parse(h.store.raw()!).history.length === 1);
  check('no timers left running', h.clock.pending() === 0, h.clock.pending());
  check('took simulated time ≥ search + ready + draft', h.clock.now() - t0 > 10_000);
});

section('quick: role_preset — your fighter chosen at queue time, bots fill instantly', () => {
  const h = harness();
  h.session.queue({ queue: 'fx_s_quick' });
  check('no preset → error, nothing queued', lastOf(h, 'error')?.message.includes('preset') === true && h.session.phase === 'idle');
  const r = runFlow(h, { queue: 'fx_s_quick', preset: { fighter: 'fx_s_seer', role: 'fx_role_support' } });
  report('quick', r);
  check('flow completes', r.ok, r.why);
  const d0 = r.drafts[0];
  check('draft starts in a short finalize with everyone locked', d0.phase === 'finalize' && d0.timerMax === 3 && d0.seats.every((s) => s.locked || !s.isYou));
  const me = r.setup!.seats.find((s) => s.controller === 'human')!;
  check('you play the preset fighter in the preset role', me.fighter === 'fx_s_seer' && me.role === 'fx_role_support');
  check('team-unique fighters', [0, 1].every((t) => { const l = r.setup!.seats.filter((s) => s.team === t).map((s) => s.fighter); return new Set(l).size === 5; }));
  check('10 valid seats', seatsOk(h, r.setup, 10));
});

section('ranked: Glicko-2 moves, provisional through placements, then a tier; by_rating bots', () => {
  const h = harness();
  h.session.setPartyBots(2);
  h.session.queue({ queue: 'fx_s_ranked' });
  check('party of 3 > partyMax 2 → refused', lastOf(h, 'error')?.message.includes('party') === true && h.session.phase === 'idle');
  check('setPartyBots builds the party', h.session.party().length === 3 && h.session.party().slice(1).every((m) => m.isBot));
  h.session.setPartyBots(1);
  const ratings: number[] = [];
  for (let game = 1; game <= 3; game++) {
    const before = h.session.profile().ratings.fx_s_rating?.rating ?? 1500;
    const r = runFlow(h, { queue: 'fx_s_ranked', roles: ['fx_role_top'] });
    report(`ranked #${game}`, r);
    if (!r.ok) { check(`ranked game ${game} completes`, false, r.why); break; }
    const rec = h.session.profile().ratings.fx_s_rating;
    const g = r.postgame!.grants;
    ratings.push(rec.rating);
    const won = r.result!.players.find((p) => p.controller === 'human')!.won;
    check(`game ${game}: rating ${before.toFixed(1)} → ${rec.rating.toFixed(1)} (${won ? 'win' : 'loss'}) in the grants + history`, rec.rating !== before && (won ? rec.rating > before : rec.rating < before)
      && g.ratingBefore === before && g.ratingAfter === rec.rating && h.session.profile().history[0].ratingDelta === Math.round((rec.rating - before) * 100) / 100);
    check(`game ${game}: bots at the by_rating band of ${before.toFixed(0)}`, r.setup!.seats.filter((s) => s.controller === 'bot').every((s) => s.botDifficulty === difficultyForRating(before)));
    check(`game ${game}: party bot on your team`, (() => { const you = r.setup!.seats.find((s) => s.controller === 'human')!; return r.setup!.seats.filter((s) => s.team === you.team).length === 5; })());
    if (game === 1) check('after 1 of 2 placements: provisional, no tier, RD shrinks', rec.provisional && g.tierAfter === undefined && rec.rd < 350 && rec.games === 1);
    if (game === 2) check('after placements: a tier from catalog.ranks', !rec.provisional && rec.games === 2 && g.tierBefore === undefined && !!g.tierAfter
      && h.catalog.ranks.some((t) => t.id === g.tierAfter), g);
    if (game === 3) check('game 3: tier before and after shown', !!g.tierBefore && !!g.tierAfter && rec.games === 3);
  }
  check('three ranked games played', ratings.length === 3 && h.session.profile().history.length === 3);
});

section('coop: blind pick vs novice bots', () => {
  const h = harness();
  const r = runFlow(h, { queue: 'fx_s_coop' });
  report('coop', r);
  check('flow completes', r.ok, r.why);
  check("blind: every seat picks at once ('pick' turn for all)", r.drafts[0].phase === 'pick' && r.drafts[0].turn?.players.length === 10);
  check('opponents are novice', r.setup!.seats.filter((s) => s.controller === 'bot').every((s) => s.botDifficulty === 'novice'));
  const me = r.result!.players.find((p) => p.controller === 'human')!;
  check('coop grants (20 win / 8 loss base)', r.postgame!.grants.lines[0].amount === (me.won ? 20 : 8));
});

section('bridge: random_bench — bench swap + reroll by hand', () => {
  const h = harness({ autopilot: 'match' });
  let swapped = '', rerolled = false, before = '', benchAfterSwap: string[] = [];
  const r = runFlow(h, { queue: 'fx_s_bridge' }, { driver: (s) => {
    const me = s.seats.find((x) => x.isYou)!;
    if (s.phase !== 'bench' || !me.locked) return null;
    if (!swapped) { before = me.locked; swapped = s.bench[me.team][0]; return { a: 'benchSwap', fighter: swapped }; }
    if (!rerolled && me.locked === swapped) { benchAfterSwap = [...s.bench[me.team]]; rerolled = true; return { a: 'reroll' }; }
    return null;
  } });
  report('bridge', r);
  check('flow completes', r.ok, r.why);
  const d0 = r.drafts[0];
  const me0 = d0.seats.find((s) => s.isYou)!;
  check("starts in 'bench' with an assigned fighter, a bench of 2, one reroll", d0.phase === 'bench' && !!me0.locked && d0.bench[me0.team].length === 2 && me0.rerolls === 1);
  const after = r.drafts.find((s) => s.seats.find((x) => x.isYou)!.rerolls === 0);
  check('the swap took the bench fighter and put the old one on the bench; the reroll benched the swapped one', !!swapped && benchAfterSwap.includes(before)
    && !!after && after.seats.find((x) => x.isYou)!.locked !== swapped && after.bench[me0.team].includes(swapped) && after.bench[me0.team].length === 2);
  check('3v3 setup with valid seats', seatsOk(h, r.setup, 6) && [0, 1].every((t) => r.setup!.seats.filter((s) => s.team === t).length === 3));
  check('your final fighter is the rerolled one', r.setup!.seats.find((s) => s.controller === 'human')!.fighter === after?.seats.find((x) => x.isYou)!.locked);
});

section('fray: ffa_pick — six teams of one, player colors, placement grants', () => {
  const h = harness();
  const r = runFlow(h, { queue: 'fx_s_fray' });
  report('fray', r);
  check('flow completes', r.ok, r.why);
  const st = r.setup!;
  check('six seats, team = seat, colorIndex = seat, no duplicate fighters', st.seats.length === 6 && st.seats.every((s) => s.team === s.player && s.colorIndex === s.player)
    && new Set(st.seats.map((s) => s.fighter)).size === 6 && seatsOk(h, st, 6));
  const res = r.result!;
  check('placements 1..6 distinct; winner = placement 1', new Set(res.players.map((p) => p.placement)).size === 6 && res.players.every((p) => p.won === (p.placement === 1)));
  const me = res.players.find((p) => p.controller === 'human')!;
  const place = [20, 12, 8, 4, 2, 0][me.placement - 1];
  const line = r.postgame!.grants.lines.find((l) => l.label === 'placement');
  check(`placement grant for #${me.placement} = ${place}`, place === 0 ? !line : line?.amount === place, r.postgame!.grants.lines);
});

section('custom lobby: any mode/map/seats/difficulty, rules override reaches the sim, no rewards', () => {
  const h = harness();
  const r = runFlow(h, { queue: 'fx_s_custom', custom: {
    mode: 'fx_s_bridge', map: 'fx_lane_map',
    seats: [{ team: 0, kind: 'you', fighter: 'fx_brawler' }, { team: 0, kind: 'bot', difficulty: 'veteran' }, { team: 1, kind: 'bot', difficulty: 'novice', fighter: 'fx_ranger' }, { team: 1, kind: 'open' }],
    rulesOverride: { end: { timeLimit: 25 }, goldMult: 2, bogus: 5, startGold: 'lots' },
  } });
  report('custom', r);
  check('flow completes', r.ok, r.why);
  check('no search, no ready check', countOf(h, (e) => e.type === 'queue' && (e.state === 'searching' || e.state === 'found')) === 0);
  const st = r.setup!;
  check("setup: the custom queue on the config's mode + map", st.queue === 'fx_s_custom' && st.mode === 'fx_s_bridge' && st.map === 'fx_lane_map' && st.seats.length === 4);
  check('presets kept; per-seat difficulty; an open seat becomes an adept bot', st.seats[0].fighter === 'fx_brawler' && st.seats[0].controller === 'human' && st.seats[2].fighter === 'fx_ranger'
    && st.seats[1].botDifficulty === 'veteran' && st.seats[2].botDifficulty === 'novice' && st.seats[3].botDifficulty === 'adept');
  check('rulesOverride end.timeLimit 25 ended the match (valid keys applied, junk dropped)', r.result?.reason === 'time' ? Math.abs(r.result.duration - 25) < 0.1 : r.result?.reason === 'core', r.result?.duration);
  check('custom games grant nothing but are recorded', r.postgame!.grants.xp === 0 && r.postgame!.grants.lines.some((l) => l.label === 'no_rewards') && h.session.profile().history.length === 1);
  const h2 = harness();
  const r2 = runFlow(h2, { queue: 'fx_s_custom', custom: { mode: 'fx_s_fray', map: 'fx_fray_map', seats: [{ team: 0, kind: 'you' }, { team: 0, kind: 'bot' }, { team: 0, kind: 'bot' }], rulesOverride: { end: { timeLimit: 15 } } } });
  check('custom FFA: every seat its own team, player colors', r2.ok && r2.setup!.seats.every((s) => s.team === s.player && s.colorIndex === s.player) && r2.result!.reason === 'time', r2.why);
  h2.session.queue({ queue: 'fx_s_custom', custom: { mode: 'fx_s_rift', map: 'fx_rift_map', seats: [{ team: 0, kind: 'bot' }] } });
  check("a lobby without exactly one 'you' is refused", lastOf(h2, 'error')?.message.includes("'you'") === true);
});

section('practice: solo on the mode map, practice switches, practice commands, leave', () => {
  const h = harness({ autopilot: false });
  const from = h.events.length;
  h.session.queue({ queue: 'fx_s_practice', practice: { infiniteGold: true, dummies: 2, startLevel: 3, noCooldowns: true }, preset: { fighter: 'fx_brawler' } });
  check('no search: straight to a short finalize', h.session.phase === 'draft' && h.session.draftView()?.phase === 'finalize' && !evTypes(h, from).includes('queue:searching'));
  h.clock.advanceUntil(() => h.session.phase === 'loading', 10_000);
  const setup = lastOf(h, 'loading')!.setup;
  check('one seat (you) on the queue mode map with the practice switches', setup.seats.length === 1 && setup.seats[0].controller === 'human' && setup.seats[0].fighter === 'fx_brawler'
    && setup.map === 'fx_rift_map' && JSON.stringify(setup.practice) === JSON.stringify({ infiniteGold: true, noCooldowns: true, dummies: 2, startLevel: 3 }), setup);
  h.session.matchReady();
  const c = h.session.currentMatch()!;
  c.setTimeScale(16);
  check('practice may fast-forward (scale 16) without the dev flag', harness({ dev: false }).session && c.timeScale === 16);
  c.pump(1 / 30);
  c.send({ type: 'practice', action: 'level' });
  let ticks = 0;
  for (let i = 0; i < 20; i++) ticks += c.pump(1 / 30);
  const me = c.view.players[0];
  check('practice switches live in the sim: level ≥ 4, infinite gold, dummies', c.view.entity(me.entity)!.level >= 4 && me.gold >= 50_000
    && c.view.entities.filter((e) => e.alive && e.team !== me.team && e.kind === 'minion').length >= 2, [c.view.entity(me.entity)?.level, me.gold]);
  check('pump runs 16 ticks per 1/30 s at scale 16; alpha in [0,1)', ticks === 320 && c.alpha >= 0 && c.alpha < 1);
  c.setTimeScale(0);
  check('pause: scale 0 runs nothing', c.pump(1) === 0 && c.timeScale === 0);
  c.leave();
  const pg = lastOf(h, 'postgame')!;
  check("leave: post-game 'abandon', you lost, no rewards", h.session.phase === 'postgame' && pg.result.reason === 'abandon' && !pg.result.players[0].won && pg.grants.xp === 0);
  const h2 = harness({ autopilot: false });
  h2.session.queue({ queue: 'fx_s_practice' });
  check('practice without a preset: a solo blind pick', h2.session.draftView()?.phase === 'pick' && h2.session.draftView()?.seats.length === 1);
  h2.clock.advanceUntil(() => h2.session.phase === 'loading', 30_000);
  check('…which times out into a random fighter and loads', h2.session.phase === 'loading' && !!lastOf(h2, 'loading')?.setup.seats[0].fighter);
});

section('determinism: same seed, same flow → same setup and same match', () => {
  const a = harness({ seed: 1234 }), b = harness({ seed: 1234 });
  const ra = runFlow(a, { queue: 'fx_s_standard' }), rb = runFlow(b, { queue: 'fx_s_standard' });
  check('identical MatchSetup', ra.ok && rb.ok && JSON.stringify(ra.setup) === JSON.stringify(rb.setup));
  check('identical result digest', ra.result?.digest === rb.result?.digest && ra.result?.digest !== undefined);
  const c = harness({ seed: 4321 });
  const rc = runFlow(c, { queue: 'fx_s_standard' });
  check('another seed → another match', rc.ok && JSON.stringify(rc.setup?.seats.map((s) => s.fighter)) !== JSON.stringify(ra.setup?.seats.map((s) => s.fighter)));
  void DAY;
});

finish('probe_session_flows');
