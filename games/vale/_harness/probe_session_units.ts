// probe (lane SESSION): the session's pure parts — clock, settings ladder, Glicko-2 (Glickman's
// worked example), grants arithmetic, economy rules + invariants, profile creation / migration /
// stores, identity, and the RemoteSession stub.
import { check, finish, near, section } from './fixtures/sim_fixture.ts';
import { PROFILE_V0, sessionCatalog } from './fixtures/session_fixture.ts';
import type { QueueDefT } from '../src/contracts/catalog.ts';
import type { MatchResult, PlayerResult } from '../src/contracts/sim.ts';
import { PROFILE_SCHEMA, type Profile } from '../src/contracts/session.ts';
import { ManualClock, utcDay } from '../src/session/clock.ts';
import { addLedger, checkInvariants, equipSkin, offerAvailable, purchase, type LedgerCtx } from '../src/session/economy.ts';
import { addAccountXp, applyGrants, xpToNext } from '../src/session/grants.ts';
import { LocalIdentityProvider, sanitizeName } from '../src/session/identity.ts';
import {
  HISTORY_CAP, LocalProfileStore, MemoryProfileStore, PROFILE_KEY, migrateProfile, newProfile, reconcileProfile, type ProfileContext,
} from '../src/session/profile_store.ts';
import {
  compositeOpponent, difficultyForRating, glicko2, newRatingRecord, rateMatch, shownTier, tierFor,
} from '../src/session/ratings.ts';
import { RemoteSession } from '../src/session/remote_session.ts';
import { applyPreset, DEFAULT_BINDS, defaultSettings, normalizeSettings, patchSettings, VIDEO_LADDER } from '../src/session/settings.ts';

const cat = sessionCatalog();
let n = 0;
const clock = new ManualClock();
const ctx: ProfileContext = {
  catalog: cat, catalogVersion: cat.version, nowIso: () => new Date(clock.wall()).toISOString(),
  newId: (p) => `${p}-${++n}`, token: () => `tok${n}`, defaultName: () => 'Player 1234',
};
const lctx: LedgerCtx & { wall(): number } = { ...ctx, wall: () => clock.wall() };

section('ManualClock', () => {
  const c = new ManualClock(Date.UTC(2026, 0, 1));
  const log: string[] = [];
  const stop = c.every(100, () => log.push(`e${c.now()}`));
  c.after(250, () => { log.push(`a${c.now()}`); c.after(0, () => log.push(`n${c.now()}`)); });
  const cancelled = c.after(150, () => log.push('never'));
  cancelled();
  c.advance(300);
  check('timers fire in time order (ties: scheduling order), nested timers inside the window, cancel works',
    log.join() === 'e100,e200,a250,n250,e300', log.join());
  stop();
  c.advance(1000);
  check('cancelled interval stops; now() lands on the target', log.length === 5 && c.now() === 1300 && c.pending() === 0, [log.length, c.now(), c.pending()]);
  check('wall() = epoch + now', c.wall() === Date.UTC(2026, 0, 1) + 1300 && utcDay(c.wall()) === '2026-01-01');
  let k = 0;
  check('advanceUntil stops when the predicate holds', c.advanceUntil(() => ++k >= 3, 10_000) && c.now() === 1500);
});

section('settings: defaults, ladder, patching', () => {
  const s = defaultSettings();
  const need = ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'recall', 'shop', 'scoreboard', 'ping', 'attackMove', 'stop', 'cameraLock', 'centerCamera', 'selfCastMod'];
  check('default binds cover every action, no chat bind, no duplicate keys', need.every((k) => typeof s.controls.binds[k] === 'string') && !('chat' in s.controls.binds)
    && new Set(Object.values(DEFAULT_BINDS)).size === Object.values(DEFAULT_BINDS).length);
  check("default video preset 'high' with the High ladder values", s.video.preset === 'high' && s.video.renderScale === 1 && s.video.shadows === 2 && s.video.bloom && s.video.antialias === 'smaa');
  const low = applyPreset(s.video, 'low');
  check('Low: 0.75 scale, no AO, 1024 hard shadows, no bloom, AA off, particles/scatter 0', low.renderScale === 0.75 && low.ao === 0 && low.shadows === 1
    && !low.bloom && low.antialias === 'off' && low.particles === 0 && low.scatter === 0);
  const ultra = applyPreset({ ...s.video, fpsCap: 144 }, 'ultra');
  check('Ultra: DPR 2, full AO, 4096 shadows; a preset keeps fpsCap', ultra.maxDpr === 2 && ultra.ao === 2 && ultra.shadows === 3 && ultra.fpsCap === 144);
  check('Medium: 0.9, half AO, 2048, bloom, SMAA, 1/1', JSON.stringify(applyPreset(s.video, 'medium')).includes('"renderScale":0.9') && VIDEO_LADDER.medium.ao === 1);
  const p1 = patchSettings(s, { video: { ...s.video, shadows: 3 } });
  check("changing a ladder value by hand → 'custom'", p1.video.preset === 'custom' && p1.video.shadows === 3);
  const p2 = patchSettings(p1, { video: { preset: 'low' } as never });
  check('choosing a preset applies its ladder', p2.video.preset === 'low' && p2.video.renderScale === 0.75);
  const p3 = patchSettings(s, { audio: { master: 7 } as never, controls: { binds: { a1: 'KeyZ' } } as never });
  check('patches clamp values and merge binds key by key', p3.audio.master === 1 && p3.controls.binds.a1 === 'KeyZ' && p3.controls.binds.a2 === 'KeyW' && p3.video.preset === 'high');
  const g = normalizeSettings({ video: { shadows: 9, antialias: 'fxaa' }, access: { colorblind: 'tritan', uiScale: -4 }, junk: true });
  check('normalize: bad values → defaults, good kept, unknown keys dropped', g.video.shadows === 2 && g.video.antialias === 'smaa' && g.access.colorblind === 'tritan'
    && g.access.uiScale === 0.5 && !('junk' in g));
});

section("Glicko-2: Glickman's worked example", () => {
  const r = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [
    { rating: 1400, rd: 30, score: 1 }, { rating: 1550, rd: 100, score: 0 }, { rating: 1700, rd: 300, score: 0 },
  ], 0.5);
  check("r' 1464.06, RD' 151.52, σ' 0.05999", near(r.rating, 1464.06, 0.02) && near(r.rd, 151.52, 0.02) && near(r.vol, 0.05999, 0.00001), r);
  const idle = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, []);
  check('no games: only RD grows', idle.rating === 1500 && idle.rd > 200);
  const c = compositeOpponent([{ rating: 1400, rd: 30 }, { rating: 1600, rd: 40 }]);
  check('composite opponent: mean rating, RMS RD', near(c.rating, 1500) && near(c.rd, Math.sqrt((900 + 1600) / 2)), c);
  let rec = newRatingRecord('fx_s_rating', 'now');
  check('new record: 1500 / 350 / 0.06, provisional', rec.rating === 1500 && rec.rd === 350 && rec.vol === 0.06 && rec.provisional);
  rec = rateMatch(rec, { rating: 1500, rd: 80 }, 1, 2, 'now');
  check('a win vs an equal opponent raises the rating; still provisional after 1 of 2', rec.rating > 1500 && rec.provisional && rec.games === 1 && rec.wins === 1);
  rec = rateMatch(rec, { rating: 1500, rd: 80 }, 0, 2, 'now');
  check('placements done after 2 games; peak set', !rec.provisional && rec.games === 2 && rec.peak === rec.rating);
  check('tiers: highest minRating ≤ rating', tierFor(cat.ranks, 1399)?.id === 'fx_tier_a' && tierFor(cat.ranks, 1400)?.id === 'fx_tier_b' && tierFor(cat.ranks, 2000)?.id === 'fx_tier_d');
  check('no tier is shown while provisional', shownTier(cat.ranks, { ...rec, provisional: true }) === undefined && shownTier(cat.ranks, rec) !== undefined);
  check('by_rating bands: <1350 novice, <1650 adept, else veteran', difficultyForRating(1349) === 'novice' && difficultyForRating(1350) === 'adept' && difficultyForRating(1650) === 'veteran');
});

function fakeResult(o: { won: boolean; placement?: number; duration?: number; controller?: 'human' | 'bot'; ffa?: boolean }): MatchResult {
  const pr = (player: number, team: number, won: boolean, placement: number, controller: 'human' | 'bot'): PlayerResult => ({
    player, team, name: `P${player}`, fighter: 'fx_brawler', skin: 'fx_brawler_skin', controller, kills: 1, deaths: 2, assists: 3, cs: 4, gold: 500, level: 3,
    damageToFighters: 10, damageTaken: 10, healing: 0, structureDamage: 0, items: [], placement, won,
  });
  return {
    matchId: `m${++n}`, queue: 'q', mode: 'm', map: 'map', seed: 1, catalogVersion: cat.version, duration: o.duration ?? 600, winningTeam: o.won ? 0 : 1,
    reason: 'core', players: [pr(0, 0, o.won, o.placement ?? (o.won ? 1 : 2), o.controller ?? 'human'), pr(1, 1, !o.won, o.won ? 2 : 1, 'bot')], goldGraph: [], digest: 'x',
  };
}

section('grants: base + per minute (capped), placement, first win of the day, xp curve', () => {
  check('xp curve 100, 125, 150…', xpToNext(1) === 100 && xpToNext(2) === 125 && xpToNext(3) === 150);
  check('addAccountXp crosses several levels', JSON.stringify(addAccountXp(1, 90, 140)) === JSON.stringify({ level: 3, xp: 5 }));
  const q = cat.queues.find((x) => x.id === 'fx_s_standard') as QueueDefT;   // win 30 loss 10 perMinute 2 cap 60, xp 120/60
  const p = newProfile(ctx);
  const w0 = p.wallet.fx_coin;
  const g1 = applyGrants(p, ctx, { catalog: cat, queue: q, result: fakeResult({ won: false, duration: 7 * 60 + 30 }), you: 0, wall: clock.wall() });
  check('loss: 10 + 2 × 7 min = 24 coin, 60 xp, no first win', g1.currency.fx_coin === 24 && g1.xp === 60 && !g1.firstWin && p.wallet.fx_coin === w0 + 24, g1);
  const g2 = applyGrants(p, ctx, { catalog: cat, queue: q, result: fakeResult({ won: true, duration: 30 * 60 }), you: 0, wall: clock.wall() });
  check('win: 30 + 60 capped at 60, + first win 30 = 90; xp 120 + 120', g2.currency.fx_coin === 90 && g2.firstWin && g2.xp === 240
    && g2.lines.some((l) => l.label === 'cap' && l.amount === -30), g2);
  const g3 = applyGrants(p, ctx, { catalog: cat, queue: q, result: fakeResult({ won: true, duration: 60 }), you: 0, wall: clock.wall() });
  check('second win the same UTC day: no first-win bonus', !g3.firstWin && g3.currency.fx_coin === 32);
  const g4 = applyGrants(p, ctx, { catalog: cat, queue: q, result: fakeResult({ won: true, duration: 60 }), you: 0, wall: clock.wall() + 86_400_000 });
  check('next UTC day: first win again', g4.firstWin);
  check('levels follow the curve', g1.levelBefore === 1 && p.level >= 3 && g4.levelAfter === p.level);
  const reasons = p.ledger.map((e) => e.reason);
  check("ledger: one 'match_grant' per match + 'first_win' entries, refs = matchId", reasons.filter((r) => r === 'match_grant').length === 4
    && reasons.filter((r) => r === 'first_win').length === 2 && p.ledger.filter((e) => e.reason !== 'starter').every((e) => e.ref?.startsWith('m')));
  const fq = cat.queues.find((x) => x.id === 'fx_s_fray') as QueueDefT;
  const g5 = applyGrants(p, ctx, { catalog: cat, queue: fq, result: fakeResult({ won: false, placement: 2, duration: 120 }), you: 0, wall: clock.wall() + 86_400_000 });
  check('Fray: + grants.placement[placement − 1] outside the cap', g5.currency.fx_coin === 10 + 4 + 12 && g5.lines.some((l) => l.label === 'placement' && l.amount === 12), g5);
  const bal = p.wallet.fx_coin;
  const pq = cat.queues.find((x) => x.id === 'fx_s_practice') as QueueDefT;
  const g6 = applyGrants(p, ctx, { catalog: cat, queue: pq, result: fakeResult({ won: true }), you: 0, wall: clock.wall() });
  const g7 = applyGrants(p, ctx, { catalog: cat, queue: q, result: fakeResult({ won: true, controller: 'bot' }), you: 0, wall: clock.wall() });
  const g8 = applyGrants(p, ctx, { catalog: cat, queue: q, result: fakeResult({ won: false }), you: 0, forfeit: true, wall: clock.wall() });
  check('practice, a bot seat, and a forfeit earn nothing', g6.xp === 0 && g7.xp === 0 && g8.xp === 0 && p.wallet.fx_coin === bal
    && g8.lines.some((l) => l.label === 'left_match'));
  check('invariants hold after grants', checkInvariants(p, cat).length === 0, checkInvariants(p, cat));
});

section('economy: purchase rules, equip, invariants', () => {
  const p = newProfile(ctx);
  check('unknown sku', JSON.stringify(purchase(p, cat, 'fx_nope', lctx)) === '{"ok":false,"reason":"unknown_sku"}');
  check('expired and future offers are unavailable', !purchase(p, cat, 'fx_offer_expired', lctx).ok && (purchase(p, cat, 'fx_offer_future', lctx) as { reason: string }).reason === 'unavailable');
  const offer = cat.store.offers.find((o) => o.sku === 'fx_offer_future')!;
  check('date windows: [from, until)', !offerAvailable(offer, Date.parse('2026-12-31T23:59:59Z')) && offerAvailable(offer, Date.parse('2027-01-01T00:00:00Z')));
  check('not enough funds (25 < 40)', (purchase(p, cat, 'fx_offer_brawler_alt', lctx) as { reason: string }).reason === 'funds' && p.wallet.fx_coin === 25);
  check('gem offer with no gems → funds', (purchase(p, cat, 'fx_offer_gem', lctx) as { reason: string }).reason === 'funds');
  addLedger(p, ctx, 'fx_coin', 100, 'match_grant', 'm-test');
  const r = purchase(p, cat, 'fx_offer_brawler_alt', lctx);
  check('purchase: ledger −40, ownership record with txn + price + catalogVersion', r.ok && p.wallet.fx_coin === 85 && r.record.txn === p.ledger[p.ledger.length - 1].txn
    && r.record.price?.amount === 40 && r.record.catalogVersion === cat.version && r.record.source === 'purchase' && r.record.sku === 'fx_offer_brawler_alt', r);
  check('buying it again → owned', (purchase(p, cat, 'fx_offer_brawler_alt', lctx) as { reason: string }).reason === 'owned' && p.wallet.fx_coin === 85);
  check('equip: unowned refused, wrong fighter refused, owned ok', !equipSkin(p, cat, 'fx_ranger', 'fx_ranger_alt').ok && !equipSkin(p, cat, 'fx_ranger', 'fx_brawler_alt').ok
    && equipSkin(p, cat, 'fx_brawler', 'fx_brawler_alt').ok && p.equipped.fx_brawler === 'fx_brawler_alt');
  check('invariants hold', checkInvariants(p, cat).length === 0, checkInvariants(p, cat));
  const bad = structuredClone(p) as Profile;
  bad.wallet.fx_coin += 5;
  bad.owned.push({ ...bad.owned[0], id: 'dup' });
  bad.equipped.fx_ranger = 'fx_ranger_alt';
  const issues = checkInvariants(bad, cat);
  check('invariants catch a forged balance, a duplicate entitlement and an unowned equip', issues.some((i) => i.includes('wallet')) && issues.some((i) => i.includes('owned twice'))
    && issues.some((i) => i.includes('not owned')), issues);
  let threw = false;
  try { addLedger(p, ctx, 'fx_coin', -10_000, 'purchase'); } catch { threw = true; }
  check('the ledger never goes negative', threw && p.wallet.fx_coin === 85);
});

section('profile: new, reconcile, migrate schema 0, stores', () => {
  const p = newProfile(ctx);
  const fighters = cat.fighters.map((f) => f.id);
  check('new profile: schema, level 1, identity local-<token>', p.schema === PROFILE_SCHEMA && p.level === 1 && p.identity.id.startsWith('local-') && p.identity.kind === 'local');
  check('starter ownership records for every store.starterOwnership skin', cat.store.starterOwnership.every((s) => p.owned.some((o) => o.ref === s && o.source === 'starter' && o.sku === `starter:${s}`)));
  check("starter wallet as 'starter' ledger entries; every currency has a wallet key", p.wallet.fx_coin === 25 && p.wallet.fx_gem === 0 && p.ledger.length === 1 && p.ledger[0].reason === 'starter');
  check('every fighter has its base skin equipped', fighters.every((f) => p.equipped[f] === `${f}_skin`));
  check('default settings', JSON.stringify(p.settings) === JSON.stringify(defaultSettings()));
  // catalog update: a new starter skin appears, an equipped skin vanishes
  p.owned = p.owned.filter((o) => o.ref !== 'fx_s_scout_skin');
  delete p.equipped.fx_s_scout;
  p.equipped.fx_brawler = 'fx_brawler_alt';
  for (let i = 0; i < 60; i++) p.history.push({} as never);
  const changed = reconcileProfile(p, ctx);
  check('reconcile: new starter skins granted, unowned equips replaced by base, history capped', changed && p.owned.some((o) => o.ref === 'fx_s_scout_skin')
    && p.equipped.fx_s_scout === 'fx_s_scout_skin' && p.equipped.fx_brawler === 'fx_brawler_skin' && p.history.length === HISTORY_CAP);

  const m = migrateProfile(structuredClone(PROFILE_V0), ctx);
  const mp = m.profile;
  check('schema 0 → 1', !!mp && m.profile !== null && 'migrated' in m && m.migrated && m.from === 0 && mp.schema === 1);
  if (mp) {
    reconcileProfile(mp, ctx);
    check('identity kept, name sanitized', mp.identity.id === 'local-legacy0001' && mp.identity.displayName === 'Old Timer' && mp.identity.createdAt === '2026-09-01T10:00:00.000Z');
    check("coins → one 'migration' ledger entry per known currency (unknown dropped)", mp.wallet.fx_coin === 70 && mp.ledger.length === 1 && mp.ledger[0].reason === 'migration'
      && !('fx_unknown_currency' in mp.wallet));
    check("owned skins → OwnershipRecords (source 'grant'), vanished skins dropped, starter skins added", mp.owned.some((o) => o.ref === 'fx_brawler_alt' && o.source === 'grant' && o.sku === 'migration:fx_brawler_alt')
      && !mp.owned.some((o) => o.ref === 'fx_gone_skin') && mp.owned.filter((o) => o.ref === 'fx_brawler_skin').length === 1 && mp.owned.some((o) => o.ref === 'fx_ranger_skin' && o.source === 'starter'));
    check('equipped kept when owned, else the base skin', mp.equipped.fx_brawler === 'fx_brawler_alt' && mp.equipped.fx_ranger === 'fx_ranger_skin');
    check('level/xp, ratings kept; history dropped; settings merged onto defaults', mp.level === 4 && mp.xp === 35 && mp.ratings.fx_s_rating?.rating === 1620
      && mp.ratings.fx_s_rating.games === 12 && mp.history.length === 0 && mp.settings.audio.master === 0.3 && mp.settings.audio.music === 0.6 && mp.settings.video.preset === 'low');
    check('no starter wallet for a migrated profile; invariants hold', mp.ledger.every((e) => e.reason !== 'starter') && checkInvariants(mp, cat).length === 0, checkInvariants(mp, cat));
  }
  check('a newer schema is refused, garbage is corrupt, nothing is empty', migrateProfile({ schema: PROFILE_SCHEMA + 1 }, ctx).profile === null
    && (migrateProfile({ schema: PROFILE_SCHEMA + 1 }, ctx) as { reason: string }).reason === 'future'
    && (migrateProfile(42, ctx) as { reason: string }).reason === 'corrupt' && (migrateProfile(null, ctx) as { reason: string }).reason === 'empty');

  const ms = new MemoryProfileStore(undefined, ctx);
  ms.save(p);
  check('MemoryProfileStore round-trips through JSON', JSON.stringify(ms.load()) === JSON.stringify(p) && ms.load() !== p);
  ms.reset();
  check('reset empties it', ms.load() === null);
  const map = new Map<string, string>();
  const fake = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const ls = new LocalProfileStore(ctx, PROFILE_KEY, fake);
  ls.save(p);
  check(`LocalProfileStore writes localStorage['${PROFILE_KEY}']`, map.has('vale.profile.v1') && JSON.stringify(ls.load()) === JSON.stringify(p) && !ls.degraded);
  map.set(PROFILE_KEY, '{not json');
  check('corrupt text → null, copied to <key>.corrupt', ls.load() === null && map.get(`${PROFILE_KEY}.corrupt`) === '{not json');
  const throwing = { getItem: (): string | null => { throw new Error('SecurityError'); }, setItem: (): void => { throw new Error('QuotaExceeded'); }, removeItem: (): void => { throw new Error('x'); } };
  const ts = new LocalProfileStore(ctx, PROFILE_KEY, throwing);
  ts.save(p);
  check('throwing storage → in-memory fallback, still round-trips', ts.degraded && JSON.stringify(ts.load()) === JSON.stringify(p));
  const none = new LocalProfileStore(ctx);
  none.save(p);
  check('no localStorage at all (Node) → memory', none.degraded && none.load()?.identity.id === p.identity.id);
  const v0 = new MemoryProfileStore(PROFILE_V0, ctx);
  check('a store with a context migrates on load()', v0.load()?.schema === 1);
  check('a store without a context loads only the current schema', new MemoryProfileStore(PROFILE_V0).load() === null && new MemoryProfileStore(p).load()?.schema === 1);
});

section('identity + remote stub', () => {
  check('sanitizeName: trims, collapses, strips markup, clamps, falls back', sanitizeName('  a  b ', 'F') === 'a b' && sanitizeName('<b>x</b>yz', 'F') === 'bx/byz'
    && sanitizeName('x', 'F') === 'F' && sanitizeName('a'.repeat(40), 'F').length === 16 && sanitizeName(5, 'F') === 'F');
  const seen: string[] = [];
  const idp = new LocalIdentityProvider({ id: 'local-abc', displayName: 'One', kind: 'local', createdAt: 'x' }, (i) => seen.push(i.displayName));
  check('local provider: canSignIn false, rename changes only the display name', !idp.canSignIn && idp.rename('Two').displayName === 'Two' && idp.current().id === 'local-abc' && seen.join() === 'Two');
  idp.rename('');
  check('an invalid rename keeps the old name', idp.current().displayName === 'Two' && seen.length === 1);
  const r = new RemoteSession();
  let all = true;
  for (const f of [() => r.queue({ queue: 'x' }), () => r.profile(), () => r.purchase('x'), () => r.identity, () => r.currentMatch(), () => r.draft({ a: 'lock' })]) {
    try { f(); all = false; } catch (e) { if (!String(e).includes('not available in this build')) all = false; }
  }
  check("RemoteSession: kind 'remote', every method throws 'not available in this build'", r.kind === 'remote' && all);
});

finish('probe_session_units');
