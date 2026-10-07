// probe (lane SESSION): queue edges and the match host — cancel while searching, decline and
// ready-check timeout with escalating re-queue lockouts, draft dodges, guards (busy, unlock level,
// party size), leave = forfeit loss (ranked rating drops), time-scale policy, the fixed-step pump
// (catch-up cap, backlog drop, alpha), event fan-out, play again, rename/reset.
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { harness, lastOf, probeBots, runFlow, sessionCatalog, waitFor } from './fixtures/session_fixture.ts';
import type { SessionEvent } from '../src/contracts/session.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { TICK_DT } from '../src/contracts/sim.ts';
import { LocalMatchHost, MAX_CATCHUP_TICKS } from '../src/session/match_host.ts';
import { LOCKOUT_BASE, READY_CHECK_SECONDS } from '../src/session/matchmaker.ts';

type QEv = Extract<SessionEvent, { type: 'queue' }>;
const queueEvents = (evs: SessionEvent[]): QEv[] => evs.filter((e): e is QEv => e.type === 'queue');

section('cancel while searching: back to idle, no penalty', () => {
  const h = harness();
  h.session.queue({ queue: 'fx_s_standard' });
  h.clock.advance(1000);
  check('searching', h.session.phase === 'searching');
  h.session.queue({ queue: 'fx_s_standard' });
  check('queueing twice is refused (busy)', lastOf(h, 'error')?.message.includes('busy') === true);
  h.session.cancelQueue();
  const q = lastOf(h, 'queue')!;
  check("idle with reason 'cancelled', no lockout", h.session.phase === 'idle' && q.state === 'idle' && q.reason === 'cancelled' && !q.lockout && h.session.lockout() === 0);
  h.clock.advance(10_000);
  check('no ready check pops after a cancel; no timers left', h.session.phase === 'idle' && h.clock.pending() === 0);
  h.session.queue({ queue: 'fx_s_standard' });
  check('can queue again at once', h.session.phase === 'searching');
});

section('decline + timeout: lockouts that escalate, then reset by accepting', () => {
  const h = harness();
  h.session.queue({ queue: 'fx_s_standard' });
  waitFor(h, () => h.session.phase === 'found');
  h.session.declineMatch();
  const evs = queueEvents(h.events);
  const dec = evs[evs.length - 2], idle = evs[evs.length - 1];
  check(`decline: 'declined' then 'idle', lockout ${LOCKOUT_BASE} s`, dec.state === 'declined' && dec.reason === 'declined' && dec.lockout === LOCKOUT_BASE
    && idle.state === 'idle' && h.session.phase === 'idle', [dec, idle]);
  h.session.queue({ queue: 'fx_s_standard' });
  check('queueing during the lockout is refused', h.session.phase === 'idle' && lastOf(h, 'error')?.message.includes('locked out') === true);
  h.session.queue({ queue: 'fx_s_custom', custom: { mode: 'fx_s_bridge', map: 'fx_lane_map', seats: [{ team: 0, kind: 'you' }, { team: 1, kind: 'bot' }] } });
  check('custom lobbies ignore the matchmaking lockout', h.session.phase === 'draft');
  h.session.cancelQueue();
  check('leaving a custom lobby costs nothing', h.session.phase === 'idle' && lastOf(h, 'queue')?.reason === 'cancelled' && Math.abs(h.session.lockout() - LOCKOUT_BASE) < 0.01);
  h.clock.advance(LOCKOUT_BASE * 1000 + 100);
  h.session.queue({ queue: 'fx_s_standard' });
  check('after the lockout you can queue', h.session.phase === 'searching');
  waitFor(h, () => h.session.phase === 'found');
  const found = lastOf(h, 'queue')!;
  check('ready check counts down from 10 s', found.readyMax === READY_CHECK_SECONDS && (found.readyTimer ?? 0) > 9);
  h.clock.advance(READY_CHECK_SECONDS * 1000 + 100);
  const to = queueEvents(h.events).find((e) => e.state === 'declined' && e.reason === 'timeout');
  check('timeout: declined (timeout), lockout doubled to 10 s', !!to && to.lockout === LOCKOUT_BASE * 2 && h.session.phase === 'idle', to);
  h.clock.advance(LOCKOUT_BASE * 2000 + 100);
  h.session.queue({ queue: 'fx_s_standard' });
  waitFor(h, () => h.session.phase === 'found');
  h.session.acceptMatch();
  check("accepted; bots finish accepting → 'draft'", waitFor(h, () => h.session.phase === 'draft', 5000));
  h.session.cancelQueue();
  const dodge = lastOf(h, 'queue')!;
  check(`dodging the draft: idle (dodged), lockout back to ${LOCKOUT_BASE} s (accepting reset the strikes)`, h.session.phase === 'idle' && dodge.reason === 'dodged'
    && dodge.lockout === LOCKOUT_BASE && h.session.draftView() === null, dodge);
  h.clock.advance(60_000);
  check('nothing keeps running after a dodge', h.clock.pending() === 0 && h.session.phase === 'idle');
});

section('guards: unlock level, party size, stray calls', () => {
  const h = harness();
  h.session.queue({ queue: 'fx_s_locked' });
  check('a queue above your level is refused', lastOf(h, 'error')?.message.includes('level 30') === true && h.session.phase === 'idle');
  h.session.queue({ queue: 'fx_nope' });
  check('unknown queue → error', lastOf(h, 'error')?.message.includes('unknown queue') === true);
  h.session.setPartyBots(1);
  h.session.queue({ queue: 'fx_s_fray' });
  check('party over partyMax → error', lastOf(h, 'error')?.message.includes('party') === true);
  h.session.setPartyBots(0);
  h.session.acceptMatch(); h.session.matchReady(); h.session.draft({ a: 'lock' });
  const errs = h.events.filter((e) => e.type === 'error').length;
  check('accept / matchReady / draft outside their phase → errors, no state change', errs >= 6 && h.session.phase === 'idle');
  let got = 0;
  const off = h.session.on(() => got++);
  off();
  h.session.rename('Somebody');
  check('on() returns an unsubscribe', got === 0);
  check("rename: identity + profile + a 'profile' event", h.session.identity.displayName === 'Somebody' && h.session.profile().identity.displayName === 'Somebody'
    && lastOf(h, 'profile')?.profile.identity.displayName === 'Somebody' && JSON.parse(h.store.raw()!).identity.displayName === 'Somebody');
});

section('leave = forfeit: abandon result, counted as a ranked loss, no rewards', () => {
  const h = harness();
  h.session.queue({ queue: 'fx_s_ranked' });
  waitFor(h, () => h.session.phase === 'found');
  h.session.acceptMatch();
  waitFor(h, () => h.session.phase === 'loading', 120_000);
  const c = h.session.currentMatch()!;
  check('during loading the client exists but its clock does not run', !!c && c.pump(1) === 0 && c.view.tick === 0);
  h.session.matchReady();
  c.setTimeScale(16);
  for (let i = 0; i < 20; i++) c.pump(1 / 30);
  const coin = h.session.profile().wallet.fx_coin;
  c.leave();
  const pg = lastOf(h, 'postgame')!;
  const me = pg.result.players.find((p) => p.player === pg.you)!;
  check("post-game at once: reason 'abandon', you lost (placement 2), the other team 'won'", h.session.phase === 'postgame' && pg.result.reason === 'abandon' && !me.won
    && me.placement === 2 && pg.result.winningTeam === 1 - me.team && pg.result.players.filter((p) => p.team === me.team).every((p) => !p.won));
  const rec = h.session.profile().ratings.fx_s_rating;
  check('ranked: the forfeit is a loss (rating < 1500), one game played', !!rec && rec.rating < 1500 && rec.games === 1 && rec.wins === 0);
  check("no currency or XP; 'left_match' line; history says lost", h.session.profile().wallet.fx_coin === coin && pg.grants.xp === 0 && pg.grants.lines.some((l) => l.label === 'left_match')
    && h.session.profile().history[0].won === false);
  check('the client stops: send/pump are no-ops after leaving', (c.send({ type: 'stop' }), c.pump(1)) === 0 && h.session.currentMatch() === null);
  h.session.playAgain();
  check('play again re-queues the same request', h.session.phase === 'searching' && lastOf(h, 'queue')?.queue === 'fx_s_ranked');
  h.session.cancelQueue();
});

section('time scale policy: matchmade queues stay at 1 without the dev flag', () => {
  const h = harness({ dev: false });
  h.session.queue({ queue: 'fx_s_standard' });
  waitFor(h, () => h.session.phase === 'found');
  h.session.acceptMatch();
  waitFor(h, () => h.session.phase === 'loading', 120_000);
  h.session.matchReady();
  const c = h.session.currentMatch()!;
  c.setTimeScale(16);
  const a = c.timeScale;
  c.setTimeScale(0);
  check('setTimeScale(16) and (0) are ignored → 1', a === 1 && c.timeScale === 1);
  check('a 1/30 s pump runs one tick', c.pump(1 / 30) === 1);
  c.leave();
  const h2 = harness({ dev: true });
  const r = runFlow(h2, { queue: 'fx_s_coop' });
  check('the dev flag allows fast-forward in matchmade queues (the probes rely on it)', r.ok);
});

section('match host: fixed step, catch-up cap, backlog drop, alpha, event fan-out, end once', () => {
  const cat = sessionCatalog();
  const h = harness();
  const r = runFlow(h, { queue: 'fx_s_standard' }, { maxGameSeconds: 1, beforeMatch: () => {} });
  const setup = r.setup!;
  let ends = 0;
  const host = new LocalMatchHost(cat, setup, setup.seats.find((s) => s.controller === 'human')!.player, { pregameSeconds: 0, maxTimeScale: 16, bots: probeBots, onEnd: () => ends++ });
  check('nothing runs before start()', host.pump(1) === 0);
  host.start();
  const batches: SimEvent[][] = [];
  const off = host.onEvents((b) => batches.push(b));
  check(`a 5 s stall at scale 1 runs at most ${MAX_CATCHUP_TICKS} ticks, then drops the backlog`, host.pump(5) === MAX_CATCHUP_TICKS && host.pump(TICK_DT * 0.5) === 0 && host.alpha > 0.4 && host.alpha < 0.6);
  check('the next half step completes a tick', host.pump(TICK_DT * 0.5) === 1);
  host.setTimeScale(4);
  check('scale 4: 1/30 s → 4 ticks', host.pump(1 / 30) === 4 && host.timeScale === 4);
  host.setTimeScale(99);
  check('scale clamps to 16', host.timeScale === 16);
  for (let i = 0; i < 30; i++) host.pump(1 / 30);   // 16 s: the first minion wave spawns at 10 s
  check('every non-empty tick batch reaches listeners', batches.length > 0 && batches.every((b) => b.length > 0));
  off();
  const n = batches.length;
  host.pump(1 / 30);
  check('unsubscribe stops the fan-out', batches.length === n);
  for (let i = 0; i < 2000 && !host.ended; i++) host.pump(1 / 30);
  check("the match ends once (sim 'end' → onEnd), then pump is a no-op", host.ended && ends === 1 && host.pump(1) === 0 && host.view.phase === 'ended');
});

section('robustness: matchReady from the first loading event; a draft that cannot start returns to idle', () => {
  const h = harness();
  let readied = false;
  h.session.on((e) => { if (e.type === 'loading' && e.progress === 0 && !readied) { readied = true; h.session.matchReady(); } });
  h.session.queue({ queue: 'fx_s_practice', preset: { fighter: 'fx_brawler' } });
  waitFor(h, () => h.session.phase !== 'draft', 10_000);
  check('matchReady() inside the progress-0 listener starts the match once the sim is built', readied && h.session.phase === 'match'
    && !h.events.some((e) => e.type === 'error') && !!h.session.currentMatch());
  h.session.currentMatch()!.leave();
  const broken = { ...sessionCatalog(), skins: [] };
  const h2 = harness({ catalog: broken });
  h2.session.queue({ queue: 'fx_s_practice' });
  check('no draftable fighters → error, back to idle, no timers', h2.session.phase === 'idle' && lastOf(h2, 'error')?.message.includes('no draftable fighters') === true
    && h2.clock.pending() === 0);
});

section('reset profile', () => {
  const h = harness();
  const r = runFlow(h, { queue: 'fx_s_coop' });
  const id = h.session.identity.id;
  check('played one game', r.ok && h.session.profile().history.length === 1);
  h.session.resetProfile();
  const p = h.session.profile();
  check('reset in post-game: fresh profile (starter wallet, no history), same identity', p.history.length === 0 && p.wallet.fx_coin === 25 && p.level === 1 && p.identity.id === id);
});

finish('probe_session_queue');
