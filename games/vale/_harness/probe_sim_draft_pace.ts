// probe (lane W4, client F12 + gameplay G8): the draft's pace and its ban count, on the REAL catalog and the REAL bot
// draft brain (src/sim/bots/draft.ts), driving session/draft.ts DraftHost at the session's 100 ms tick.
//   F12  bots lock 3–8 s into a pick phase or turn (never at the buzzer); a blind or FFA pick phase ends the moment every
//        seat has locked; a person in seat 0 (or any seat) never stops the bots after it from acting; finalize Lock in is
//        a ready flag ({ a: 'ready' }, DraftSeat.ready) and the finalize ends READY_GRACE s after every person is ready;
//        without it the finalize keeps its timer
//   G8   every draft queue's bansPerTeam equals bansForRoster(its bansByRoster, today's playable roster), the steps
//        ascend, and the worst-case gate holds (2 × team size + all bans ≤ roster; r03 §1.6)
//   Run: node _harness/probe_sim_draft_pace.ts
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { DraftAction, DraftState } from '../src/contracts/session.ts';
import { BOT_LOCK_MAX, BOT_LOCK_MIN, bansForRoster, DraftHost, READY_GRACE, type DraftSeatInit, type PickProtocol } from '../src/session/draft.ts';
import { fighterPool } from '../src/session/setup.ts';
import { createDraftBrain } from '../src/sim/bots/draft.ts';
import { Rng } from '../src/sim/rng.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP probe_sim_draft_pace: content build failed'); process.exit(77); }
const catalog: CatalogT = built.catalog;
const POOL = fighterPool(catalog);
const ROLES = catalog.roles.filter((r) => r.assign).sort((a, b) => a.assign!.order - b.assign!.order).map((r) => r.id);
const READY = { a: 'ready' } as DraftAction;
const TICK = 0.1;

interface Run { finalizeAt: number; doneAt: number; botLocks: number[]; turnLocks: number[]; you: number; readyShown: boolean; readyRefusedInPick: boolean }

/** one draft: `human` is the person's seat (it locks `humanLockAfter` s into its pick turn and sends ready `readyAfter` s
 *  into finalize; -1 = never) */
function runDraft(protocol: PickProtocol, seed: number, human: number, o: { readyAfter?: number; humanLockAfter?: number; bans?: number; pick?: number; finalize?: number } = {}): Run {
  const ffa = protocol === 'ffa_pick';
  const seats: DraftSeatInit[] = [];
  for (let t = 0; t < (ffa ? 10 : 2); t++) for (let k = 0; k < (ffa ? 1 : 5); k++) {
    const p = seats.length;
    seats.push({ player: p, team: t, name: `S${p}`, isBot: p !== human, isYou: p === human, role: ffa ? undefined : ROLES[k] });
  }
  const queue = ffa ? 'fray_standard' : protocol === 'draft' ? 'rift_ranked' : 'rift_coop';
  let t = 0;
  const h = new DraftHost({
    queue, mode: ffa ? 'fray' : 'rift', protocol, seats, pool: POOL, bansPerTeam: o.bans ?? 0,
    timers: { ban: 20, pick: o.pick ?? 30, bench: 25, finalize: o.finalize ?? 10 }, bench: { size: 0, rerolls: 0 },
  }, new Rng(seed), {
    brain: (s) => (s.isBot ? createDraftBrain(catalog, seed * 31 + s.player) : null),
    skins: (_s, f) => catalog.skins.filter((x) => x.fighter === f).map((x) => x.id),
    loadout: () => ({ spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() }),
    validLoadout: (_s, _f, l) => l, fighterName: (id) => id,
  });
  h.start();
  const lockAt = new Map<number, number>();
  const turnLocks: number[] = [];
  let turnStart = 0, lastTurnKey = '', finalizeAt = -1, myTurnAt = -1, readySent = false, readyShown = false, readyRefusedInPick = false;
  for (; t < 400 && !h.done; t = Math.round((t + TICK) * 10) / 10) {
    const v: DraftState = h.view(human);
    const key = `${v.phase}:${v.turn?.players.join(',') ?? ''}`;
    if (v.phase === 'pick' && key !== lastTurnKey) { turnStart = t; lastTurnKey = key; }
    const mine = v.phase === 'pick' && !!v.turn?.players.includes(human) && !v.seats.find((s) => s.player === human)!.locked;
    if (mine && myTurnAt < 0) { myTurnAt = t; readyRefusedInPick = !h.act(human, READY).ok; }
    if (mine && t - myTurnAt >= (o.humanLockAfter ?? 4) - 1e-9) {
      h.act(human, { a: 'hover', fighter: v.available[v.available.length - 1] });
      h.act(human, { a: 'lock' });
    }
    if (v.phase === 'ban' && v.turn?.players.includes(human)) h.act(human, { a: 'ban', fighter: v.available[2] });
    if (v.phase === 'finalize') {
      if (finalizeAt < 0) finalizeAt = t;
      if (typeof v.seats[0].ready === 'boolean') readyShown = true;
      if (!readySent && (o.readyAfter ?? -1) >= 0 && t - finalizeAt >= (o.readyAfter ?? 0) - 1e-9) { readySent = true; h.act(human, READY); }
    }
    const before = new Set(lockAt.keys());
    h.advance(TICK);
    for (const s of h.view(null).seats) if (s.locked && !lockAt.has(s.player)) {
      lockAt.set(s.player, t + TICK);
      if (!before.has(s.player) && s.player !== human && v.phase === 'pick') turnLocks.push(t + TICK - turnStart);
    }
  }
  return {
    finalizeAt, doneAt: t, botLocks: [...lockAt].filter(([p]) => p !== human).map(([, x]) => x), turnLocks, you: lockAt.get(human) ?? -1,
    readyShown, readyRefusedInPick,
  };
}

const LATE = BOT_LOCK_MAX + 0.15;   // lockAfter ≤ BOT_LOCK_MAX − 0.9, + at most one re-hover (≤ 0.9 s), on a 100 ms tick
const fmt = (xs: number[]): string => `${Math.min(...xs).toFixed(1)}-${Math.max(...xs).toFixed(1)} s`;

section('F12 blind (Co-op): bots lock in 3-8 s, the pick phase ends when everyone has locked', () => {
  for (const human of [0, 4, 9]) for (const seed of [1, 2, 3]) {
    const r = runDraft('blind', seed, human, { readyAfter: -1 });
    check(`blind seat ${human} seed ${seed}: 9 bot locks in ${BOT_LOCK_MIN}-${LATE} s (${fmt(r.botLocks)}), finalize at ${r.finalizeAt.toFixed(1)} s (timer 30)`,
      r.botLocks.length === 9 && r.botLocks.every((x) => x >= BOT_LOCK_MIN - 1e-9 && x <= LATE) && r.finalizeAt <= LATE + 0.2, r);
  }
});

section('F12 FFA pick (FRAY): same pace, ends when every seat has locked', () => {
  for (const seed of [1, 2, 3]) {
    const r = runDraft('ffa_pick', seed, 0, { readyAfter: -1, pick: 25 });
    check(`ffa seed ${seed}: 9 bot locks in ${fmt(r.botLocks)}, finalize at ${r.finalizeAt.toFixed(1)} s (timer 25)`,
      r.botLocks.length === 9 && r.botLocks.every((x) => x >= BOT_LOCK_MIN - 1e-9 && x <= LATE) && r.finalizeAt <= LATE + 0.2, r);
  }
});

section('F12 snake draft: each bot locks 3-8 s into its turn', () => {
  for (const seed of [1, 2]) {
    const r = runDraft('draft', seed, 0, { readyAfter: -1, bans: 1, pick: 20, finalize: 15 });
    check(`draft seed ${seed}: 9 bot turn locks in ${fmt(r.turnLocks)} of their turn`, r.turnLocks.length === 9 &&
      r.turnLocks.every((x) => x >= BOT_LOCK_MIN - 1e-9 && x <= LATE), r.turnLocks);
  }
});

section('F12 finalize Lock in is a ready flag with a short grace', () => {
  const r = runDraft('blind', 4, 0, { readyAfter: 2 });
  check('DraftSeat.ready is reported in finalize', r.readyShown);
  check("'ready' is refused outside finalize", r.readyRefusedInPick);
  const ended = r.doneAt - r.finalizeAt;
  check(`ready 2 s into a 10 s finalize: the draft ends ${ended.toFixed(1)} s in (<= 2 + ${READY_GRACE} + 0.2)`, ended <= 2 + READY_GRACE + 0.2 + 1e-9, r);
  const r2 = runDraft('blind', 4, 0, { readyAfter: -1 });
  const ended2 = r2.doneAt - r2.finalizeAt;
  check(`without ready the finalize keeps its 10 s (${ended2.toFixed(1)} s)`, ended2 >= 9.8, r2);
});

section('G8 bans follow the roster (bansByRoster), and the worst-case gate holds', () => {
  const R = POOL.length;
  for (const q of catalog.queues) {
    const d = q.draft;
    // draft-protocol queues that ban (a queue with no bans and no steps, like practice, has nothing to derive)
    if (!d || (q.pick ?? catalog.modes.find((m) => m.id === q.mode)?.pick) !== 'draft' || (d.bansPerTeam === 0 && !d.bansByRoster)) continue;
    const mode = catalog.modes.find((m) => m.id === q.mode)!;
    const steps = d.bansByRoster ?? [];
    check(`${q.id}: has bansByRoster steps, ascending`, steps.length > 0 && steps.every((s, i) => i === 0 || (s.roster > steps[i - 1].roster && s.bans >= steps[i - 1].bans)), steps);
    const want = bansForRoster(d, R);
    check(`${q.id}: bansPerTeam ${d.bansPerTeam} = bansForRoster(${R}) ${want}`, d.bansPerTeam === want);
    const C = mode.teams * mode.perTeam + mode.teams * d.bansPerTeam;
    check(`${q.id}: worst case ${C} fighters used <= roster ${R}, the last picker keeps ${R - C}`, C <= R);
  }
  const ranked = catalog.queues.find((q) => q.id === 'rift_ranked')?.draft;
  check('the ladder: 1 ban per team at 16, 2 at 28, 5 at 40', bansForRoster(ranked, 16) === 1 && bansForRoster(ranked, 28) === 2 && bansForRoster(ranked, 40) === 5);
});

finish('probe_sim_draft_pace');
